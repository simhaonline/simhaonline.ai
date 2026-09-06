"""simha-reverse — standalone reverse-engineering engine (gitreverse-inspired).

Analyzes and extracts structure, dependencies, and insights from projects
(git URLs, tarballs, uploaded sources) and websites. Fully isolated: own
container, own port (8112), no imports from the main stack, no DB.

Endpoints
  GET  /healthz
  POST /analyze/git       {repo_url, ref?, max_files?}      -> full project report
  POST /analyze/tarball   (multipart file)                   -> full project report
  POST /analyze/sources   {files: [{path, content}]}         -> full project report
  POST /analyze/website   {url, fetch_sitemap?}              -> tech + structure report
  POST /compare           {report_a, report_b}               -> structural delta

Report shape (uniform for git/tarball/sources):
  {meta, languages, files, tree, dependencies {internal, external},
   entry_points, frameworks, insights, risks}
"""
from __future__ import annotations

import ast
import io
import json
import logging
import os
import re
import shutil
import tarfile
import tempfile
import time
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

LOG = logging.getLogger("simha.reverse")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

FETCH_TIMEOUT = float(os.environ.get("REVERSE_FETCH_TIMEOUT", "20"))
CLONE_TIMEOUT = int(os.environ.get("REVERSE_CLONE_TIMEOUT", "120"))
MAX_FILES = int(os.environ.get("REVERSE_MAX_FILES", "3000"))
MAX_FILE_BYTES = 400_000

app = FastAPI(title="simha-reverse", version="1.0.0")

# ── language & manifest tables ───────────────────────────────────────────────
LANG_BY_EXT = {
    ".py": "python", ".go": "go", ".js": "javascript", ".mjs": "javascript",
    ".cjs": "javascript", ".jsx": "javascript", ".ts": "typescript",
    ".tsx": "typescript", ".rs": "rust", ".java": "java", ".rb": "ruby",
    ".php": "php", ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp",
    ".hpp": "cpp", ".cs": "csharp", ".swift": "swift", ".kt": "kotlin",
    ".go": "go", ".sh": "shell", ".bash": "shell", ".sql": "sql",
    ".html": "html", ".css": "css", ".scss": "css", ".vue": "vue",
    ".svelte": "svelte", ".dart": "dart", ".kt.kts": "kotlin", ".yml": "yaml",
    ".yaml": "yaml", ".toml": "toml", ".json": "json",
}

SKIP_DIRS = {
    "node_modules", ".git", ".next", "dist", "build", "out", "vendor",
    "__pycache__", ".venv", "venv", "target", ".gradle", ".idea", ".vscode",
    "coverage", ".pytest_cache", ".mypy_cache", ".turbo", ".cache", "bin", "obj",
}

MANIFESTS = {
    "package.json": "node", "package-lock.json": "node", "pnpm-lock.yaml": "node",
    "yarn.lock": "node", "go.mod": "go", "go.sum": "go",
    "requirements.txt": "python", "pyproject.toml": "python", "Pipfile": "python",
    "setup.py": "python", "Cargo.toml": "rust", "pom.xml": "java",
    "build.gradle": "java", "build.gradle.kts": "java", "composer.json": "php",
    "Gemfile": "ruby", "pubspec.yaml": "dart", "docker-compose.yml": "docker",
    "Dockerfile": "docker", "Makefile": "make", "CMakeLists.txt": "cmake",
}

ENTRY_PATTERNS = [
    ("main.go", "go"), ("main.py", "python"), ("app.py", "python"),
    ("manage.py", "python"), ("server.py", "python"), ("wsgi.py", "python"),
    ("asgi.py", "python"), ("index.js", "javascript"), ("server.js", "javascript"),
    ("app.js", "javascript"), ("main.ts", "typescript"), ("index.ts", "typescript"),
    ("main.rs", "rust"), ("Main.java", "java"), ("App.java", "java"),
    ("src/main.py", "python"), ("src/index.js", "javascript"), ("src/main.ts", "typescript"),
    ("src/app/page.tsx", "typescript"), ("src/app/layout.tsx", "typescript"),
    ("app/page.tsx", "typescript"), ("app/layout.tsx", "typescript"),
    ("src/main/java", "java"),
]

FRAMEWORK_SIGS = [
    ("next", ["next"], ["package.json"]),
    ("react", ["react"], ["package.json"]),
    ("vue", ["vue"], ["package.json"]),
    ("svelte", ["svelte"], ["package.json"]),
    ("angular", ["@angular/core"], ["package.json"]),
    ("express", ["express"], ["package.json"]),
    ("fastify", ["fastify"], ["package.json"]),
    ("nestjs", ["@nestjs/core"], ["package.json"]),
    ("fastapi", ["fastapi"], ["requirements.txt", "pyproject.toml", "setup.py"]),
    ("flask", ["flask"], ["requirements.txt", "pyproject.toml", "setup.py"]),
    ("django", ["django"], ["requirements.txt", "pyproject.toml", "setup.py"]),
    ("celery", ["celery"], ["requirements.txt", "pyproject.toml"]),
    ("gin", ["github.com/gin-gonic/gin"], ["go.mod"]),
    ("fiber", ["github.com/gofiber/fiber"], ["go.mod"]),
    ("echo", ["github.com/labstack/echo"], ["go.mod"]),
    ("cobra", ["github.com/spf13/cobra"], ["go.mod"]),
    ("actix", ["actix-web"], ["Cargo.toml"]),
    ("axum", ["axum"], ["Cargo.toml"]),
    ("rails", ["rails"], ["Gemfile"]),
    ("laravel", ["laravel/framework"], ["composer.json"]),
    ("spring", ["spring-boot"], ["pom.xml", "build.gradle", "build.gradle.kts"]),
    ("timescale", ["timescaledb"], ["docker-compose.yml", "docker-compose.yaml"]),
    ("postgres", ["postgres", "psycopg", "pgx"], ["requirements.txt", "go.mod", "package.json"]),
    ("redis", ["redis", "valkey"], ["requirements.txt", "go.mod", "package.json"]),
    ("stripe", ["stripe"], ["requirements.txt", "package.json", "go.mod"]),
    ("pytest", ["pytest"], ["requirements.txt", "pyproject.toml"]),
]


# ── source collection ────────────────────────────────────────────────────────
def _collect_files(root: Path, limit: int) -> list[tuple[str, bytes]]:
    out: list[tuple[str, bytes]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if any(part in SKIP_DIRS or part.startswith(".eggs") for part in path.parts):
            continue
        if path.stat().st_size > MAX_FILE_BYTES:
            out.append((rel, b""))
            continue
        try:
            data = path.read_bytes()
        except OSError:
            continue
        out.append((rel, data))
        if len(out) >= limit:
            break
    return out


def _shallow_clone(repo_url: str, ref: Optional[str]) -> Path:
    workdir = Path(tempfile.mkdtemp(prefix="simha-reverse-"))
    cmd = ["git", "clone", "--quiet", "--depth", "1", "--single-branch"]
    if ref:
        cmd += ["--branch", ref]
    cmd += [repo_url, str(workdir / "repo")]
    import subprocess
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=CLONE_TIMEOUT)
    if proc.returncode != 0:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(422, f"git clone failed: {proc.stderr.strip()[:300]}")
    return workdir / "repo"


def _extract_tarball(data: bytes) -> Path:
    workdir = Path(tempfile.mkdtemp(prefix="simha-reverse-"))
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as tar:
            tar.extractall(workdir, filter="data")
    except tarfile.TarError as exc:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(422, f"unsupported tarball: {exc}") from exc
    members = list(workdir.iterdir())
    return members[0] if len(members) == 1 else workdir


# ── import extraction per language ───────────────────────────────────────────
def _imports_python(data: bytes) -> tuple[list[str], list[tuple[str, str]]]:
    imports: list[str] = []
    edges: list[tuple[str, str]] = []
    try:
        tree = ast.parse(data.decode("utf-8", "replace"))
    except SyntaxError:
        return imports, edges
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.append(node.module)
    return imports, edges


def _imports_go(data: bytes) -> list[str]:
    imports: list[str] = []
    text = data.decode("utf-8", "replace")
    # single imports and import blocks, e.g. `import "x"` or `import (\n "x"\n)`
    for m in re.finditer(r'^\s*[_a-zA-Z][\w.]*?\s*"([a-zA-Z0-9_./-]+)"\s*$', text, re.M):
        imports.append(m.group(1))
    for m in re.finditer(r'import\s+"([^"]+)"', text):
        imports.append(m.group(1))
    block = re.search(r"import\s*\(([^)]*)\)", text, re.S)
    if block:
        for m in re.finditer(r'"([a-zA-Z0-9_./-]+)"', block.group(1)):
            imports.append(m.group(1))
    return imports


def _imports_js(data: bytes) -> list[str]:
    text = data.decode("utf-8", "replace")
    imports: list[str] = []
    patterns = [
        r"(?:import|export)\s[^;]*?from\s+['\"]([^'\"]+)['\"]",
        r"(?:import|require)\s*\(\s*['\"]([^'\"]+)['\"]\s*\)",
        r"require\s*\(\s*['\"]([^'\"]+)['\"]\s*\)",
        r"import\s+['\"]([^'\"]+)['\"]",
    ]
    for pat in patterns:
        imports.extend(re.findall(pat, text))
    return imports


def _resolve_python_internal(spec: str, modules: set[str]) -> list[str]:
    """Longest-prefix module matches: `a.b.c` resolves into module `a.b`."""
    out = []
    for mod in modules:
        if spec == mod or spec.startswith(mod + "."):
            out.append(mod)
    return out


# ── core analysis ────────────────────────────────────────────────────────────
def analyze_sources(files: list[tuple[str, bytes]], meta: dict[str, Any]) -> dict[str, Any]:
    languages: Counter[str] = Counter()
    code_files: dict[str, bytes] = {}
    manifests: dict[str, Any] = {}
    docs: list[str] = []
    config_files: list[str] = []
    total_bytes = 0

    for rel, data in files:
        ext = Path(rel).suffix.lower()
        lang = LANG_BY_EXT.get(ext)
        name = Path(rel).name
        if name in MANIFESTS:
            manifests[name] = (data[:200_000]).decode("utf-8", "replace")
        if rel in MANIFESTS or name in MANIFESTS:
            config_files.append(rel)
        if name.lower().startswith("readme") or ext in (".md", ".rst"):
            docs.append(rel)
        if lang in ("python", "go", "javascript", "typescript", "rust", "java",
                    "ruby", "php", "c", "cpp", "csharp"):
            languages[lang] += 1
            code_files[rel] = data
        total_bytes += len(data)

    # module index for python internal resolution
    py_modules: set[str] = set()
    for rel in code_files:
        if rel.endswith(".py"):
            parts = rel[:-3].split("/")
            if parts[-1] == "__init__":
                parts = parts[:-1]
            for i in range(1, len(parts) + 1):
                py_modules.add(".".join(parts[:i]))

    external: Counter[str] = Counter()
    internal_edges: list[dict[str, str]] = []

    for rel, data in code_files.items():
        if rel.endswith(".py"):
            imports, _ = _imports_python(data)
            for spec in imports:
                root_pkg = spec.split(".")[0]
                resolved = _resolve_python_internal(spec, py_modules)
                if resolved and not root_pkg.startswith("_"):
                    for mod in resolved[:2]:
                        internal_edges.append({"from": rel, "to": mod + ".py"})
                else:
                    external[root_pkg] += 1
        elif rel.endswith(".go"):
            for spec in _imports_go(data):
                if "/" not in spec:
                    continue  # stdlib single-word (fmt, net, os …)
                first = spec.split("/")[0]
                if "." not in first:
                    continue  # stdlib path (net/http, encoding/json …)
                if first.startswith(("github.com/", "gitlab.com/", "bitbucket.org/")):
                    external[first + "/" + spec.split("/")[1]] += 1
                else:
                    external[first] += 1
        elif rel.endswith((".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx")):
            for spec in _imports_js(data):
                if spec.startswith("."):
                    target = str(Path(Path(rel).parent, spec).with_suffix(""))
                    internal_edges.append({"from": rel, "to": target})
                elif not spec.startswith(("node:", "http")):
                    # @scope/pkg keeps two segments; plain pkg keeps one
                    pkg = "/".join(spec.split("/")[:2]) if spec.startswith("@") else spec.split("/")[0]
                    external[pkg] += 1

    # entry points
    entry_points = []
    rels = [f[0] for f in files]
    for pat, lang in ENTRY_PATTERNS:
        if any(rel == pat or rel.startswith(pat) for rel in rels):
            entry_points.append({"path": pat, "lang": lang})
    for rel in rels:
        if re.match(r"(cmd|src)/[^/]+/main\.go$", rel):
            entry_points.append({"path": rel, "lang": "go"})

    # frameworks from manifest contents
    frameworks = []
    blob = json.dumps(manifests).lower()
    for fname, sigs, _ in FRAMEWORK_SIGS:
        if fname in blob or fname in external:
            frameworks.append(fname)
    for fw, sigs, manifest_names in FRAMEWORK_SIGS:
        for mn in manifest_names:
            content = manifests.get(mn, "").lower()
            if any(s.lower() in content for s in sigs):
                if fw not in frameworks:
                    frameworks.append(fw)

    # insights
    largest = sorted(code_files.items(), key=lambda kv: len(kv[1]), reverse=True)[:10]
    insights: dict[str, Any] = {
        "total_files": len(files),
        "code_files": len(code_files),
        "total_code_bytes": total_bytes,
        "languages": dict(languages.most_common()),
        "largest_files": [{"path": p, "bytes": len(d)} for p, d in largest],
        "doc_files": docs[:20],
        "manifests": sorted(manifests.keys()),
        "external_dependency_count": len(external),
    }

    risks: list[dict[str, str]] = []
    if not manifests:
        risks.append({"level": "warn", "msg": "no dependency manifest found"})
    if "Dockerfile" not in [f[0] for f in files] and "docker" not in blob:
        risks.append({"level": "info", "msg": "no Dockerfile detected"})
    if not any(rel.lower().startswith("readme") for rel in docs):
        risks.append({"level": "info", "msg": "no README detected"})
    env_like = [rel for rel, _ in files if re.search(r"\.env|secret|credential", rel, re.I)]
    if env_like:
        risks.append({"level": "warn", "msg": f"possible secret files committed: {env_like[:5]}"})
    hard = []
    for rel, data in code_files.items():
        try:
            text = data.decode("utf-8", "replace")
        except Exception:
            continue
        if re.search(r"(api[_-]?key|password|secret)\s*[:=]\s*[\"'][A-Za-z0-9_\-]{16,}", text, re.I):
            hard.append(rel)
            if len(hard) >= 5:
                break
    if hard:
        risks.append({"level": "warn", "msg": f"possible hardcoded credentials: {hard}"})

    return {
        "meta": meta,
        "languages": dict(languages.most_common()),
        "files": [{"path": rel, "bytes": len(data)} for rel, data in files[:MAX_FILES]],
        "dependencies": {
            "internal_edges": internal_edges[:1000],
            "external": dict(external.most_common(200)),
        },
        "entry_points": entry_points[:30],
        "frameworks": frameworks,
        "insights": insights,
        "risks": risks,
    }


# ── website analysis ─────────────────────────────────────────────────────────
TECH_SIGNS = {
    "next": ["__NEXT_DATA__", "_next/static"],
    "react": ["data-reactroot", "react-dom"],
    "vue": ["data-v-", "__VUE__"],
    "angular": ["ng-version", "ng-app"],
    "wordpress": ["wp-content", "wp-includes"],
    "shopify": ["cdn.shopify.com", "shopify"],
    "wix": ["static.wixstatic.com"],
    "squarespace": ["squarespace"],
    "cloudflare": ["cdn-cgi", "cloudflare"],
    "google-analytics": ["gtag/js", "google-analytics.com"],
    "stripe": ["js.stripe.com"],
    "jquery": ["jquery"],
    "bootstrap": ["bootstrap"],
    "tailwind": ["tailwind"],
    "matomo": ["matomo"],
    "plausible": ["plausible.io"],
}


def analyze_website(url: str, fetch_sitemap: bool = True) -> dict[str, Any]:
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"}
    with httpx.Client(follow_redirects=True, timeout=FETCH_TIMEOUT, headers=headers) as client:
        resp = client.get(url)
        html = resp.text
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        text = " ".join(soup.get_text(" ").split())

        server = resp.headers.get("server", "")
        powered = resp.headers.get("x-powered-by", "")
        scripts = [s.get("src", "") for s in BeautifulSoup(resp.text, "html.parser").find_all("script")]
        metas = {m.get("name", m.get("property", "")): m.get("content", "")
                 for m in soup.find_all("meta") if m.get("name") or m.get("property")}
        generator = metas.get("generator", "")

        detected: dict[str, list[str]] = defaultdict(list)
        blob = (resp.text + " " + generator + " " + powered + " " + server).lower()
        for tech, signs in TECH_SIGNS.items():
            for sign in signs:
                if sign.lower() in blob or any(sign.lower() in s.lower() for s in scripts):
                    detected[tech].append(sign)

        title = soup.title.get_text(strip=True) if soup.title else None
        links = []
        for a in soup.find_all("a", href=True):
            href = urljoin(str(resp.url), a["href"])
            if href.startswith("http"):
                links.append({"url": href, "text": a.get_text(strip=True)[:120]})

        sitemap_urls: list[str] = []
        robots: dict[str, Any] = {}
        if fetch_sitemap:
            base = f"{urlsplit(str(resp.url)).scheme}://{urlsplit(str(resp.url)).netloc}"
            try:
                r2 = client.get(base + "/robots.txt")
                if r2.status_code == 200:
                    rules = []
                    sitemaps = []
                    for line in r2.text.splitlines():
                        if line.lower().startswith("sitemap:"):
                            sitemaps.append(line.split(":", 1)[1].strip())
                        elif line.lower().startswith(("user-agent:", "disallow:", "allow:")):
                            rules.append(line.strip())
                    robots = {"found": True, "sitemaps": sitemaps, "rules": rules[:50]}
                    sitemap_urls = sitemaps
                else:
                    robots = {"found": False}
            except httpx.HTTPError:
                robots = {"found": False}
            if sitemap_urls:
                try:
                    r3 = client.get(sitemap_urls[0])
                    locs = re.findall(r"<loc>([^<]+)</loc>", r3.text)
                    sitemap_urls = locs[:200]
                except httpx.HTTPError:
                    sitemap_urls = []

        return {
            "url": str(resp.url),
            "status": resp.status_code,
            "title": title,
            "meta": metas,
            "headers": {"server": server, "x-powered-by": powered,
                        "content-type": resp.headers.get("content-type", "")},
            "technologies": detected,
            "text_preview": text[:3000],
            "link_count": len(links),
            "links": links[:200],
            "robots": robots,
            "sitemap_urls": sitemap_urls,
        }


# ── API models ───────────────────────────────────────────────────────────────
class GitReq(BaseModel):
    repo_url: str
    ref: Optional[str] = None
    max_files: int = Field(300, le=MAX_FILES)


class SourcesReq(BaseModel):
    files: list[dict[str, str]]


class WebsiteReq(BaseModel):
    url: str
    fetch_sitemap: bool = True


# ── endpoints ────────────────────────────────────────────────────────────────
@app.get("/healthz")
async def healthz() -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "simha-reverse"})


@app.post("/analyze/git")
async def analyze_git(req: GitReq) -> JSONResponse:
    started = time.time()
    repo = _shallow_clone(req.repo_url, req.ref)
    try:
        files = _collect_files(repo, req.max_files)
        report = analyze_sources(files, {"source": "git", "repo_url": req.repo_url,
                                         "ref": req.ref})
        report["meta"]["analysis_ms"] = int((time.time() - started) * 1000)
        return JSONResponse(report)
    finally:
        shutil.rmtree(repo.parent, ignore_errors=True)


@app.post("/analyze/tarball")
async def analyze_tarball(file: UploadFile = File(...)) -> JSONResponse:
    started = time.time()
    data = await file.read()
    root = _extract_tarball(data)
    try:
        files = _collect_files(root, MAX_FILES)
        report = analyze_sources(files, {"source": "tarball", "name": file.filename})
        report["meta"]["analysis_ms"] = int((time.time() - started) * 1000)
        return JSONResponse(report)
    finally:
        shutil.rmtree(root.parent if root.parent != Path(tempfile.gettempdir()) else root, ignore_errors=True)


@app.post("/analyze/sources")
async def analyze_sources_ep(req: SourcesReq) -> JSONResponse:
    if not req.files:
        raise HTTPException(422, "files required")
    files = [(f["path"], f["content"].encode()) for f in req.files]
    return JSONResponse(analyze_sources(files, {"source": "inline"}))


@app.post("/analyze/website")
async def analyze_website_ep(req: WebsiteReq) -> JSONResponse:
    if not req.url.startswith(("http://", "https://")):
        raise HTTPException(422, "url must start with http(s)://")
    try:
        return JSONResponse(analyze_website(req.url, req.fetch_sitemap))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"fetch failed: {exc}") from exc


@app.post("/compare")
async def compare_ep(payload: dict) -> JSONResponse:
    ra, rb = payload.get("report_a"), payload.get("report_b")
    if not ra or not rb:
        raise HTTPException(422, "report_a and report_b required")

    def fileset(r: dict) -> set[str]:
        return {f["path"] for f in r.get("files", [])}

    fa, fb = fileset(ra), fileset(rb)
    langs_a = ra.get("languages", {})
    langs_b = rb.get("languages", {})
    deps_a = ra.get("dependencies", {}).get("external", {})
    deps_b = rb.get("dependencies", {}).get("external", {})
    return JSONResponse({
        "added_files": sorted(fb - fa)[:200],
        "removed_files": sorted(fa - fb)[:200],
        "common_files": len(fa & fb),
        "language_delta": {k: langs_b.get(k, 0) - langs_a.get(k, 0)
                           for k in set(langs_a) | set(langs_b)},
        "dependency_added": sorted(set(deps_b) - set(deps_a))[:100],
        "dependency_removed": sorted(set(deps_a) - set(deps_b))[:100],
        "frameworks_a": ra.get("frameworks", []),
        "frameworks_b": rb.get("frameworks", []),
        "risk_delta": {
            "a": ra.get("risks", []),
            "b": rb.get("risks", []),
        },
    })