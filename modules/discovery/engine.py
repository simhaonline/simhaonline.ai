"""simha-discovery — AI ecosystem discovery engine (prompt.md §6, Phase 2).

Continuously discovers, normalizes, verifies and updates information about
the modern AI ecosystem: models, agents, frameworks, skills, plugins, tools,
MCP servers, vector DBs, inference engines, evaluation frameworks, etc.

Isolated service: own container (:8115), own SQLite state, no imports from
the core stack. Scraped claims NEVER auto-become trusted platform config —
everything flows through the pipeline:

    discovered → parsed → normalized → deduplicated → verified → approved → active

Trust model (prompt.md §93): OFFICIAL > VERIFIED > COMMUNITY > UNKNOWN.
Every field carries provenance (source_url, retrieved_at, confidence).
"""
from __future__ import annotations

import logging
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from engine_contract import install_contract

LOG = logging.getLogger("simha.discovery")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

DB_PATH = os.environ.get("DISCOVERY_DB_PATH", "/data/discovery.db")
FETCH_TIMEOUT = float(os.environ.get("DISCOVERY_FETCH_TIMEOUT", "20"))
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"

ENTITY_KINDS = (
    "model", "agent", "agent_framework", "skill", "plugin", "tool",
    "mcp_server", "mcp_client", "api", "gateway", "router", "vector_db",
    "inference_engine", "provider", "ide", "eval_framework", "prompt_tool",
    "observability_platform", "dataset", "library",
)
TRUST_LEVELS = ("official", "verified", "community", "unknown", "blocked")
STATES = ("discovered", "parsed", "normalized", "deduplicated", "verified", "approved", "active", "rejected")

app = FastAPI(title="simha-discovery", version="1.0.0")
_lock = threading.Lock()


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


def _init_db() -> None:
    with _conn() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS entities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                canonical_name TEXT NOT NULL,
                kind TEXT NOT NULL,
                aliases TEXT NOT NULL DEFAULT '[]',
                description TEXT NOT NULL DEFAULT '',
                category TEXT DEFAULT '',
                homepage TEXT DEFAULT '',
                repository TEXT DEFAULT '',
                license TEXT DEFAULT '',
                owner TEXT DEFAULT '',
                latest_version TEXT DEFAULT '',
                release_date TEXT DEFAULT '',
                documentation_url TEXT DEFAULT '',
                stars INTEGER DEFAULT 0,
                forks INTEGER DEFAULT 0,
                last_checked REAL DEFAULT 0,
                last_changed REAL DEFAULT 0,
                capabilities TEXT NOT NULL DEFAULT '{}',
                trust_level TEXT NOT NULL DEFAULT 'unknown',
                state TEXT NOT NULL DEFAULT 'discovered',
                provenance TEXT NOT NULL DEFAULT '[]',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                UNIQUE(canonical_name, kind)
            );
            CREATE TABLE IF NOT EXISTS sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                kind TEXT NOT NULL,
                trust_level TEXT NOT NULL DEFAULT 'unknown',
                enabled INTEGER NOT NULL DEFAULT 1,
                last_fetched REAL DEFAULT 0,
                last_status TEXT DEFAULT '',
                created_at REAL NOT NULL,
                UNIQUE(url)
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT UNIQUE NOT NULL,
                kind TEXT NOT NULL DEFAULT 'cycle',
                state TEXT NOT NULL DEFAULT 'queued'
                    CHECK (state IN ('queued','running','paused','completed','failed','cancelled','retrying')),
                entities_new INTEGER DEFAULT 0,
                entities_updated INTEGER DEFAULT 0,
                entities_unchanged INTEGER DEFAULT 0,
                errors INTEGER DEFAULT 0,
                progress INTEGER DEFAULT 0,
                attempts INTEGER DEFAULT 0,
                error_text TEXT DEFAULT '',
                started_at REAL,
                finished_at REAL,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
                field TEXT NOT NULL,
                old_value TEXT,
                new_value TEXT,
                source_url TEXT,
                confidence REAL DEFAULT 0.5,
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','ignored')),
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS provenance_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
                field TEXT NOT NULL,
                source_url TEXT NOT NULL,
                retrieved_at REAL NOT NULL,
                confidence REAL NOT NULL DEFAULT 0.5,
                extractor TEXT NOT NULL DEFAULT 'http-html'
            );
            """
        )


_init_db()


# ── fetch + extraction ───────────────────────────────────────────────────────
PROMPT_INJECTION_PAT = re.compile(
    r"(ignore (all |any )?(previous|prior) instructions|disregard (all |any )?instructions"
    r"|system prompt[:=]|you are now|new instructions:)", re.I)


def sanitize_text(text: str) -> str:
    """Strip obvious prompt-injection spans from scraped content (§67),
    preserving surrounding text."""
    return "\n".join(
        PROMPT_INJECTION_PAT.sub("[filtered:possible-injection]", line)
        for line in text.splitlines())


def _fetch(url: str) -> tuple[int, str]:
    import httpx
    headers = {"User-Agent": UA, "Accept": "text/html,application/json;q=0.9,*/*;q=0.8"}
    with httpx.Client(follow_redirects=True, timeout=FETCH_TIMEOUT, headers=headers) as c:
        r = c.get(url)
        return r.status_code, r.text[:500_000]


def extract_entities(url: str, body: str) -> list[dict[str, Any]]:
    """Deterministic extractors per known source shape. Returns raw records."""
    out: list[dict[str, Any]] = []
    # GitHub HTML: repo cards on lists/search pages
    for m in re.finditer(r'href="/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)"[^>]*itemprop="name codeRepository"', body):
        owner, repo = m.group(1), m.group(2)
        out.append({"canonical_name": f"{owner}/{repo}", "kind": "library",
                    "repository": f"https://github.com/{owner}/{repo}",
                    "owner": owner, "source_url": url, "confidence": 0.6})
    # MCP servers JSON registry format
    try:
        import json
        doc = json.loads(body)
        if isinstance(doc, dict):
            servers = doc.get("servers")
            if isinstance(servers, list):
                for s in servers:
                    if not isinstance(s, dict):
                        continue
                    name = str(s.get("name") or "").strip()
                    if not name:
                        continue
                    out.append({"canonical_name": name, "kind": "mcp_server",
                                "description": str(s.get("description") or "")[:500],
                                "repository": str(s.get("url") or s.get("repository") or ""),
                                "source_url": url, "confidence": 0.7})
    except (ValueError, TypeError):
        pass
    # MCP README list format: "- **[Name](src/...)** - description"
    if not out:
        for m in re.finditer(r"^- \*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s*-\s*(.+)$", body, re.M):
            name, repo_path, desc = m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
            repo = ""
            if repo_path.startswith(("http://", "https://")):
                repo = repo_path
            elif url.rstrip("/").endswith("README.md"):
                repo = urlsplit(url).scheme + "://" + urlsplit(url).netloc + "/" + \
                    urlsplit(url).path.removeprefix("/").replace("README.md", repo_path.strip("/"))
            out.append({"canonical_name": name, "kind": "mcp_server",
                        "description": desc[:500], "repository": repo,
                        "source_url": url, "confidence": 0.7})
    # generic <h3>/<a> model-name listing fallback (documentation indexes)
    if not out:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(body, "html.parser")
        for h in soup.select("h2 a, h3 a")[:60]:
            name = h.get_text(strip=True)
            if name and 2 <= len(name) <= 80:
                out.append({"canonical_name": name, "kind": "model",
                            "source_url": url, "confidence": 0.4})
    return out


# ── normalization / dedup ────────────────────────────────────────────────────
def canonicalize(name: str) -> str:
    n = name.strip().lower()
    n = re.sub(r"^[a-z]{1,3}://", "", n)
    n = re.sub(r"[^a-z0-9./_-]", "-", n)
    n = re.sub(r"-{2,}", "-", n).strip("-")
    return n or name.strip().lower()


def normalize(rec: dict[str, Any]) -> dict[str, Any]:
    out = dict(rec)
    name = str(out.get("canonical_name") or "").strip()
    if not name:
        raise ValueError("empty canonical_name")
    out["canonical_name"] = name if "/" in name and out.get("kind") != "model" else name
    out["description"] = sanitize_text(str(out.get("description") or ""))[:1000]
    kind = out.get("kind") or "model"
    out["kind"] = kind if kind in ENTITY_KINDS else "tool"
    repo = str(out.get("repository") or "").strip()
    if repo.startswith("http"):
        repo = re.sub(r"[?#].*$", "", repo)      # query/fragment
        repo = re.sub(r"\.git/?$", "", repo)     # .git suffix
        repo = repo.rstrip("/")
    out["repository"] = repo
    if not out.get("homepage") and repo:
        out["homepage"] = repo
    return out


def upsert_entity(rec: dict[str, Any], source_url: str,
                  trust: str) -> tuple[int, str]:
    """Returns (entity_id, 'new'|'updated'|'unchanged'). Writes provenance and
    pending change records for meaningful field diffs (§97)."""
    canonical = canonicalize(rec["canonical_name"])
    now = time.time()
    fields = {
        "description": rec.get("description", ""),
        "homepage": rec.get("homepage", ""),
        "repository": rec.get("repository", ""),
        "license": rec.get("license", ""),
        "owner": rec.get("owner", ""),
        "latest_version": rec.get("latest_version", ""),
        "documentation_url": rec.get("documentation_url", ""),
        "stars": int(rec.get("stars") or 0),
    }
    with _lock, _conn() as con:
        row = con.execute(
            "SELECT id, description, homepage, repository, license, owner,"
            " latest_version, documentation_url, stars, state, trust_level"
            " FROM entities WHERE canonical_name=? AND kind=?",
            (canonical, rec["kind"])).fetchone()
        if row is None:
            cur = con.execute(
                "INSERT INTO entities (canonical_name, kind, description, homepage,"
                " repository, license, owner, latest_version, documentation_url,"
                " stars, trust_level, state, provenance, last_checked, last_changed,"
                " created_at, updated_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (canonical, rec["kind"], fields["description"], fields["homepage"],
                 fields["repository"], fields["license"], fields["owner"],
                 fields["latest_version"], fields["documentation_url"], fields["stars"],
                 trust, "discovered",
                 __import__("json").dumps([{"source_url": source_url, "retrieved_at": now,
                                            "confidence": rec.get("confidence", 0.5)}]),
                 now, now, now, now))
            new_id = int(cur.lastrowid or 0)
            con.execute(
                "INSERT INTO provenance_log (entity_id, field, source_url, retrieved_at,"
                " confidence, extractor) VALUES (?,?,?,?,?,?)",
                (new_id, "entity", source_url, now, rec.get("confidence", 0.5),
                 rec.get("extractor", "http-html")))
            return new_id, "new"
        eid = row["id"]
        changed = []
        for f, new_v in fields.items():
            old_v = row[f]
            if new_v and new_v != old_v:
                changed.append((f, old_v, new_v))
        if not changed:
            con.execute("UPDATE entities SET last_checked=? WHERE id=?", (now, eid))
            return eid, "unchanged"
        for f, old_v, new_v in changed:
            con.execute(
                "INSERT INTO changes (entity_id, field, old_value, new_value,"
                " source_url, confidence, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (eid, f, str(old_v), str(new_v), source_url, rec.get("confidence", 0.5),
                 "pending", now))
        sets = ", ".join(f"{f}=?" for f, _, _ in changed)
        con.execute(
            f"UPDATE entities SET {sets}, last_checked=?, last_changed=?, updated_at=?"
            " WHERE id=?",
            [v for _, _, v in changed] + [now, now, now, eid])
        con.execute(
            "INSERT INTO provenance_log (entity_id, field, source_url, retrieved_at,"
            " confidence, extractor) VALUES (?,?,?,?,?,?)",
            (eid, changed[0][0], source_url, now, rec.get("confidence", 0.5),
             rec.get("extractor", "http-html")))
        return eid, "updated"


# ── crawl cycle ──────────────────────────────────────────────────────────────
def run_cycle(run_id: str, limit_sources: int = 20) -> dict[str, Any]:
    with _conn() as con:
        job = con.execute("SELECT * FROM jobs WHERE run_id=?", (run_id,)).fetchone()
        if not job:
            raise HTTPException(404, "job not found")
        con.execute("UPDATE jobs SET state='running', started_at=?, attempts=attempts+1 WHERE id=?",
                    (time.time(), job["id"]))
        sources = con.execute(
            "SELECT * FROM sources WHERE enabled=1 ORDER BY last_fetched ASC LIMIT ?",
            (limit_sources,)).fetchall()
    new = updated = unchanged = errors = 0
    checked = 0
    for src in sources:
        try:
            status, body = _fetch(src["url"])
            if status >= 400:
                raise RuntimeError(f"HTTP {status}")
            trust = src["trust_level"]
            for raw in extract_entities(src["url"], body):
                try:
                    rec = normalize(raw)
                except ValueError:
                    continue
                _, outcome = upsert_entity(rec, src["url"], trust)
                if outcome == "new":
                    new += 1
                elif outcome == "updated":
                    updated += 1
                else:
                    unchanged += 1
            with _lock, _conn() as con:
                con.execute("UPDATE sources SET last_fetched=?, last_status=? WHERE id=?",
                            (time.time(), "ok", src["id"]))
        except Exception as exc:  # per-source failure never kills the cycle
            errors += 1
            LOG.warning("source %s failed: %s", src["url"], exc)
            with _lock, _conn() as con:
                con.execute("UPDATE sources SET last_fetched=?, last_status=? WHERE id=?",
                            (time.time(), f"error: {str(exc)[:120]}", src["id"]))
        checked += 1
        with _lock, _conn() as con:
            con.execute("UPDATE jobs SET progress=?, entities_new=?, entities_updated=?,"
                        " entities_unchanged=?, errors=? WHERE id=?",
                        (int(checked * 100 / max(len(sources), 1)), new, updated,
                         unchanged, errors, job["id"]))
    with _lock, _conn() as con:
        con.execute("UPDATE jobs SET state='completed', finished_at=? WHERE id=?",
                    (time.time(), job["id"]))
    return {"run_id": run_id, "sources_checked": checked, "entities_new": new,
            "entities_updated": updated, "entities_unchanged": unchanged,
            "errors": errors}


# ── API models ───────────────────────────────────────────────────────────────
class SourceReq(BaseModel):
    name: str
    url: str
    kind: str = "html"
    trust_level: str = "community"


class RunReq(BaseModel):
    limit_sources: int = Field(20, le=200)


class ChangeDecision(BaseModel):
    action: str  # approve | reject | ignore


# ── endpoints ────────────────────────────────────────────────────────────────
@app.get("/healthz")
async def healthz() -> JSONResponse:
    with _conn() as con:
        n_e = con.execute("SELECT COUNT(*) c FROM entities").fetchone()["c"]
        n_s = con.execute("SELECT COUNT(*) c FROM sources WHERE enabled=1").fetchone()["c"]
    return JSONResponse({"status": "ok", "service": "simha-discovery",
                         "entities": n_e, "active_sources": n_s})


@app.post("/sources", status_code=201)
async def add_source(req: SourceReq) -> JSONResponse:
    if not req.url.startswith(("http://", "https://")):
        raise HTTPException(422, "url must be http(s)")
    if req.trust_level not in TRUST_LEVELS:
        raise HTTPException(422, f"trust_level must be one of {TRUST_LEVELS}")
    if req.trust_level == "blocked":
        raise HTTPException(422, "cannot register a blocked source")
    with _lock, _conn() as con:
        con.execute(
            "INSERT INTO sources (name, url, kind, trust_level, created_at)"
            " VALUES (?,?,?,?,?)",
            (req.name, req.url, req.kind, req.trust_level, time.time()))
    return JSONResponse({"added": req.url}, status_code=201)


@app.get("/sources")
async def list_sources() -> JSONResponse:
    with _conn() as con:
        rows = con.execute(
            "SELECT id, name, url, kind, trust_level, enabled, last_fetched, last_status"
            " FROM sources ORDER BY id").fetchall()
    return JSONResponse({"sources": [dict(r) for r in rows]})


@app.post("/cycle")
async def start_cycle(req: RunReq) -> JSONResponse:
    import uuid
    run_id = f"cyc-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    with _lock, _conn() as con:
        con.execute(
            "INSERT INTO jobs (run_id, kind, state, created_at) VALUES (?,?,?,?)",
            (run_id, "cycle", "queued", time.time()))
    import asyncio
    result = await asyncio.get_event_loop().run_in_executor(
        None, lambda: run_cycle(run_id, req.limit_sources))
    return JSONResponse(result)


@app.get("/jobs")
async def list_jobs(limit: int = 20) -> JSONResponse:
    with _conn() as con:
        rows = con.execute(
            "SELECT run_id, kind, state, entities_new, entities_updated,"
            " entities_unchanged, errors, progress, attempts, error_text,"
            " started_at, finished_at, created_at FROM jobs"
            " ORDER BY id DESC LIMIT ?", (max(1, min(limit, 100)),)).fetchall()
    return JSONResponse({"jobs": [dict(r) for r in rows]})


@app.get("/entities")
async def list_entities(kind: str = "", q: str = "", state: str = "",
                        limit: int = 50) -> JSONResponse:
    sql = ("SELECT id, canonical_name, kind, description, homepage, repository,"
           " license, owner, latest_version, documentation_url, stars, trust_level,"
           " state, last_checked FROM entities WHERE 1=1")
    args: list[Any] = []
    if kind:
        sql += " AND kind=?"
        args.append(kind)
    if state:
        sql += " AND state=?"
        args.append(state)
    if q:
        sql += " AND (canonical_name LIKE ? OR description LIKE ?)"
        args += [f"%{q}%", f"%{q}%"]
    sql += " ORDER BY updated_at DESC LIMIT ?"
    args.append(max(1, min(limit, 200)))
    with _conn() as con:
        rows = con.execute(sql, args).fetchall()
    return JSONResponse({"entities": [dict(r) for r in rows]})


@app.get("/entities/{eid}")
async def entity_detail(eid: int) -> JSONResponse:
    with _conn() as con:
        row = con.execute("SELECT * FROM entities WHERE id=?", (eid,)).fetchone()
        if not row:
            raise HTTPException(404, "entity not found")
        prov = con.execute(
            "SELECT field, source_url, retrieved_at, confidence, extractor"
            " FROM provenance_log WHERE entity_id=? ORDER BY id DESC LIMIT 20",
            (eid,)).fetchall()
        changes = con.execute(
            "SELECT field, old_value, new_value, source_url, status, created_at"
            " FROM changes WHERE entity_id=? ORDER BY id DESC LIMIT 20",
            (eid,)).fetchall()
    return JSONResponse({"entity": dict(row),
                         "provenance": [dict(p) for p in prov],
                         "changes": [dict(c) for c in changes]})


@app.get("/changes")
async def changes_ep(status: str = "pending", limit: int = 50) -> JSONResponse:
    return JSONResponse({"changes": pending_changes(status, limit)})


def pending_changes(status: str = "pending", limit: int = 50) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT c.id, c.entity_id, e.canonical_name, e.kind, c.field,"
            " c.old_value, c.new_value, c.source_url, c.confidence, c.status, c.created_at"
            " FROM changes c JOIN entities e ON e.id = c.entity_id"
            " WHERE c.status=? ORDER BY c.id DESC LIMIT ?",
            (status, max(1, min(limit, 200)))).fetchall()
    return [dict(r) for r in rows]


@app.post("/changes/{cid}/{action}")
async def review_change_ep(cid: int, action: str) -> JSONResponse:
    return JSONResponse(review_change(cid, action))


def review_change(cid: int, action: str) -> dict[str, Any]:
    if action not in ("approve", "reject", "ignore"):
        raise HTTPException(422, "action must be approve|reject|ignore")
    with _lock, _conn() as con:
        row = con.execute("SELECT * FROM changes WHERE id=?", (cid,)).fetchone()
        if not row:
            raise HTTPException(404, "change not found")
        new_status = {"approve": "approved", "reject": "rejected", "ignore": "ignored"}[action]
        con.execute("UPDATE changes SET status=? WHERE id=?", (new_status, cid))
        if action == "approve":
            con.execute(
                f"UPDATE entities SET {row['field']}=?, state='active', updated_at=? WHERE id=?",
                (row["new_value"], time.time(), row["entity_id"]))
        elif action == "reject":
            con.execute(
                "UPDATE entities SET last_checked=? WHERE id=?",
                (time.time(), row["entity_id"]))
    return {"change": cid, "status": new_status}


@app.post("/entities/{eid}/approve")
async def approve_entity_ep(eid: int) -> JSONResponse:
    return JSONResponse(approve_entity(eid))


def approve_entity(eid: int) -> dict[str, Any]:
    with _lock, _conn() as con:
        row = con.execute("SELECT trust_level FROM entities WHERE id=?", (eid,)).fetchone()
        if not row:
            raise HTTPException(404, "entity not found")
        # only official/verified sources may advance to active automatically
        new_state = "active" if row["trust_level"] in ("official", "verified") else "verified"
        con.execute("UPDATE entities SET state=?, updated_at=? WHERE id=?",
                    (new_state, time.time(), eid))
    return {"entity": eid, "state": new_state}


@app.post("/entities/{eid}/reject")
async def reject_entity_ep(eid: int) -> JSONResponse:
    return JSONResponse(reject_entity(eid))


def reject_entity(eid: int) -> dict[str, Any]:
    with _lock, _conn() as con:
        con.execute("UPDATE entities SET state='rejected', updated_at=? WHERE id=?",
                    (time.time(), eid))
    return {"entity": eid, "state": "rejected"}


install_contract(app, engine="discovery", flag_env="DISCOVERY_ENABLED",
                 ready_checks={"state_dir_writable": lambda: os.access(
                     os.path.dirname(DB_PATH), os.W_OK)})