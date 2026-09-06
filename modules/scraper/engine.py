"""simha-scraper — isolated content-discovery engine (Scrapling-inspired).

Standalone FastAPI service. Clean HTTP interface; zero coupling to the
gateway / control-plane / worker / web services (no shared code, no DB).

Inspirations implemented (re-implemented from concepts, not integrated):
  - fetch + normalized text extraction
  - adaptive element extraction: infer a structural path from one example /
    CSS selector, then auto-expand to repeated siblings (Scrapling's
    "auto-match on feature" idea, simplified)
  - change monitoring with diffing (text | structure | both)
  - bounded polite crawling (BFS, same-origin control, page cap)

Endpoints
  GET  /healthz
  POST /scrape                {url, stealth?, include_links?, css?}
  POST /extract               {url, css?, example?, fields?}
  POST /crawl                 {seeds[], max_pages?, same_origin_only?, max_depth?}
  POST /diff                  {before, after, mode?}
  POST /monitor               {url, name?, css?, mode?, interval_s?, max_snapshots?}
  GET  /monitor               -> list jobs (status + last diff)
  GET  /monitor/{id}          -> job detail + recent diffs
  POST /monitor/{id}/check    -> run one check now
  DELETE /monitor/{id}
"""
from __future__ import annotations

import asyncio
import difflib
import json
import logging
import os
import random
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

LOG = logging.getLogger("simha.scraper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
]

DEFAULT_UA = USER_AGENTS[0]
FETCH_TIMEOUT = float(os.environ.get("SCRAPER_FETCH_TIMEOUT", "20"))
MAX_CONTENT = int(os.environ.get("SCRAPER_MAX_CONTENT", "400000"))
PERSIST_PATH = os.environ.get("SCRAPER_MONITOR_STATE", "/data/monitors.json")

app = FastAPI(title="simha-scraper", version="1.0.0")


# ── fetch helpers ────────────────────────────────────────────────────────────
async def fetch(url: str, *, stealth: bool = False) -> tuple[int, str, str]:
    """GET a page. Returns (status, final_url, body). Stealth rotates a few
    browser-ish headers (light-touch; no headless browser in v1)."""
    headers = {"User-Agent": random.choice(USER_AGENTS) if stealth else DEFAULT_UA,
               "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
               "Accept-Language": "en-US,en;q=0.9"}
    if stealth:
        headers.update({
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
        })
    async with httpx.AsyncClient(follow_redirects=True, timeout=FETCH_TIMEOUT, verify=True) as client:
        resp = await client.get(url, headers=headers)
        ctype = resp.headers.get("content-type", "")
        if "html" not in ctype and "xml" not in ctype and "text" not in ctype and "json" not in ctype:
            raise HTTPException(415, f"unsupported content-type: {ctype or 'unknown'}")
        return resp.status_code, str(resp.url), resp.text[:MAX_CONTENT]


def soup_of(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")


def textify(soup: BeautifulSoup) -> str:
    for tag in soup(["script", "style", "noscript", "template", "svg"]):
        tag.decompose()
    text = soup.get_text("\n")
    lines = [ln.strip() for ln in text.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def page_links(soup: BeautifulSoup, base_url: str) -> list[dict]:
    out: dict[str, dict] = {}
    for a in soup.find_all("a", href=True):
        href = urljoin(base_url, a["href"].strip())
        if not href.startswith(("http://", "https://")):
            continue
        rec = out.setdefault(href, {"url": href, "text": "", "count": 0})
        rec["count"] += 1
        if not rec["text"] and a.get_text(strip=True):
            rec["text"] = a.get_text(strip=True)[:200]
    return list(out.values())


# ── adaptive extraction (structural path inference) ─────────────────────────
def _element_chain(el) -> list[dict]:
    """Structural chain root→element: tag + classes at each level."""
    chain = []
    node = el
    while node is not None and getattr(node, "name", None):
        classes = [c for c in (node.get("class") or []) if c]
        chain.append({"tag": node.name, "classes": classes})
        node = node.parent
    chain.reverse()
    return chain


def _chain_matches(candidate: list[dict], pattern: list[dict], strict: bool) -> bool:
    """Lenient structural match: tags must align; classes are subsets."""
    if strict and len(candidate) != len(pattern):
        return False
    for c, p in zip(reversed(candidate), reversed(pattern)):
        if c["tag"] != p["tag"]:
            return False
        pc = set(p["classes"])
        if pc and not pc.issubset(set(c["classes"])):
            return False
    return True


def _find_elements_by_chain(soup: BeautifulSoup, pattern: list[dict], limit: int = 200) -> list:
    tag = pattern[-1]["tag"]
    out = []
    for el in soup.find_all(tag)[:4000]:
        if _chain_matches(_element_chain(el), pattern, strict=False):
            out.append(el)
            if len(out) >= limit:
                break
    return out


def _extract_fields(el, fields: Optional[dict[str, str]]) -> dict:
    """fields: name → css selector relative to the element (or '@attr' syntax)."""
    rec: dict[str, Any] = {}
    if fields:
        for name, sel in fields.items():
            if sel.startswith("@"):
                attr = sel[1:]
                rec[name] = el.get(attr)
                continue
            sub = el.select_one(sel)
            rec[name] = sub.get_text(strip=True) if sub else None
    else:
        rec["text"] = el.get_text(" ", strip=True)[:500]
        a = el.find("a", href=True) if el.name != "a" else el
        rec["href"] = urljoin("http://x/", a["href"]) if (a and a.get("href")) else None
    return rec


def _locate_example(soup: BeautifulSoup, example: dict[str, str]) -> tuple[Optional[Any], Optional[list[dict]]]:
    """Find the element whose text matches ANY example value; infer its chain."""
    wanted = {v.strip().lower() for v in example.values() if v and v.strip()}
    if not wanted:
        return None, None
    for el in soup.find_all(True):
        txt = el.get_text(" ", strip=True).lower()
        if any(w and w in txt for w in wanted):
            return el, _element_chain(el)
    return None, None


# ── diffing ──────────────────────────────────────────────────────────────────
def word_diff(before: str, after: str) -> dict:
    b, a = before.split(), after.split()
    sm = difflib.SequenceMatcher(None, b, a, autojunk=False)
    added, removed = [], []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag in ("insert", "replace"):
            added.extend(b_words for b_words in a[j1:j2])
        if tag in ("delete", "replace"):
            removed.extend(b[i1:i2])
    return {"added": added[:500], "removed": removed[:500],
            "added_count": len(added), "removed_count": len(removed)}


def structure_of(soup: BeautifulSoup) -> list[str]:
    lines = []
    for el in soup.find_all(True):
        if el.name in ("script", "style", "noscript"):
            continue
        ident = el.get("id")
        classes = ".".join(el.get("class") or [])
        lines.append(el.name + (f"#{ident}" if ident else "") + (f".{classes}" if classes else ""))
    return lines


def do_diff(before_html: str, after_html: str, mode: str) -> dict:
    bs, as_ = soup_of(before_html), soup_of(after_html)
    out: dict[str, Any] = {"mode": mode}
    if mode in ("text", "both"):
        out["text"] = word_diff(textify(bs), textify(as_))
    if mode in ("structure", "both"):
        s_before, s_after = structure_of(bs), structure_of(as_)
        d = word_diff(" ".join(s_before), " ".join(s_after))
        out["structure"] = {"added": d["added"][:300], "removed": d["removed"][:300],
                            "added_count": d["added_count"], "removed_count": d["removed_count"]}
    out["changed"] = any(
        (out.get(k, {}).get("added_count", 0) + out.get(k, {}).get("removed_count", 0)) > 0
        for k in ("text", "structure") if k in out
    )
    return out


# ── monitor jobs ─────────────────────────────────────────────────────────────
@dataclass
class MonitorJob:
    id: str
    name: str
    url: str
    mode: str = "both"
    interval_s: int = 3600
    max_snapshots: int = 20
    css: Optional[str] = None
    snapshots: deque = field(default_factory=lambda: deque(maxlen=20))
    diffs: deque = field(default_factory=lambda: deque(maxlen=20))
    last_check: float = 0.0
    last_error: Optional[str] = None
    task: Optional[asyncio.Task] = None

    def to_public(self, detail: bool = False) -> dict:
        snaps = list(self.snapshots) if detail else []
        return {
            "id": self.id, "name": self.name, "url": self.url, "mode": self.mode,
            "interval_s": self.interval_s, "last_check": self.last_check,
            "last_change": (self.diffs[-1] if self.diffs else None),
            "last_error": self.last_error, "snapshot_count": len(self.snapshots),
            **({"snapshots": [{"t": s[0], "changed": s[2]} for s in snaps]} if detail else {}),
            **({"diffs": list(self.diffs)[-10:]} if detail else {}),
        }


MONITORS: dict[str, MonitorJob] = {}


def _persist() -> None:
    try:
        os.makedirs(os.path.dirname(PERSIST_PATH), exist_ok=True)
        data = []
        for job in MONITORS.values():
            data.append({k: (list(v) if isinstance(v, deque) else v)
                         for k, v in job.__dict__.items()
                         if k not in ("task",) and k in
                         ("id", "name", "url", "mode", "interval_s", "max_snapshots", "css",
                          "last_check", "last_error", "snapshots", "diffs")})
        with open(PERSIST_PATH, "w") as f:
            json.dump(data, f)
    except Exception as exc:  # persistence is best-effort
        LOG.warning("monitor persist failed: %s", exc)


def _restore() -> None:
    try:
        with open(PERSIST_PATH) as f:
            data = json.load(f)
        for rec in data:
            job = MonitorJob(
                id=rec["id"], name=rec["name"], url=rec["url"], mode=rec.get("mode", "both"),
                interval_s=rec.get("interval_s", 3600), max_snapshots=rec.get("max_snapshots", 20),
                css=rec.get("css"), last_check=rec.get("last_check", 0.0),
                last_error=rec.get("last_error"),
            )
            job.snapshots = deque(rec.get("snapshots", []), maxlen=job.max_snapshots)
            job.diffs = deque(rec.get("diffs", []), maxlen=job.max_snapshots)
            MONITORS[job.id] = job
        if MONITORS:
            LOG.info("restored %d monitor jobs", len(MONITORS))
    except FileNotFoundError:
        pass
    except Exception as exc:
        LOG.warning("monitor restore failed: %s", exc)


async def _scoped_html(job: MonitorJob) -> str:
    status, _, html = await fetch(job.url, stealth=True)
    if status >= 400:
        raise RuntimeError(f"HTTP {status}")
    if job.css:
        sc = soup_of(html)
        parts = [str(el) for el in sc.select(job.css)]
        html = "\n".join(parts) if parts else html
    return html


async def _check_job(job: MonitorJob) -> dict:
    try:
        html = await _scoped_html(job)
    except Exception as exc:
        job.last_error = str(exc)
        job.last_check = time.time()
        return {"ok": False, "error": job.last_error}
    now = time.time()
    job.last_error = None
    result: dict[str, Any] = {"ok": True, "t": now, "changed": False}
    if job.snapshots:
        prev_t, prev_html, _ = job.snapshots[-1]
        d = do_diff(prev_html, html, job.mode)
        result["changed"] = d["changed"]
        result["diff"] = d
        if d["changed"]:
            job.diffs.append({"t": now, "prev_t": prev_t, **d})
    job.snapshots.append((now, html, result["changed"]))
    job.last_check = now
    return result


async def _job_loop(job: MonitorJob) -> None:
    while True:
        try:
            await _check_job(job)
            _persist()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            LOG.warning("monitor %s loop error: %s", job.id, exc)
        await asyncio.sleep(job.interval_s)


# ── API models ───────────────────────────────────────────────────────────────
class ScrapeReq(BaseModel):
    url: str
    stealth: bool = False
    include_links: bool = True
    css: Optional[str] = None


class ExtractReq(BaseModel):
    url: str
    css: Optional[str] = None
    example: Optional[dict[str, str]] = None
    fields: Optional[dict[str, str]] = None
    limit: int = Field(50, le=500)


class CrawlReq(BaseModel):
    seeds: list[str]
    max_pages: int = Field(30, le=300)
    same_origin_only: bool = True
    max_depth: int = Field(3, le=6)
    stealth: bool = False


class DiffReq(BaseModel):
    before: str
    after: str
    mode: str = "both"


class MonitorReq(BaseModel):
    url: str
    name: Optional[str] = None
    css: Optional[str] = None
    mode: str = "both"
    interval_s: int = Field(3600, ge=60, le=86400)
    max_snapshots: int = Field(20, ge=3, le=100)


# ── endpoints ────────────────────────────────────────────────────────────────
@app.get("/healthz")
async def healthz() -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "simha-scraper",
                         "monitors": len(MONITORS)})


@app.post("/scrape")
async def scrape(req: ScrapeReq) -> JSONResponse:
    status, final_url, html = await fetch(req.url, stealth=req.stealth)
    soup = soup_of(html)
    title = soup.title.get_text(strip=True) if soup.title else None
    if req.css:
        nodes = soup.select(req.css)
        body_html = "\n".join(str(el) for el in nodes)
        soup = soup_of(body_html) if nodes else soup
    out: dict[str, Any] = {"status": status, "url": req.url, "final_url": final_url,
                           "title": title, "text": textify(soup)[:20000]}
    if req.include_links:
        out["links"] = page_links(soup_of(html), final_url)[:500]
    return JSONResponse(out)


@app.post("/extract")
async def extract(req: ExtractReq) -> JSONResponse:
    status, final_url, html = await fetch(req.url)
    soup = soup_of(html)
    records: list[dict] = []
    strategy = "none"
    if req.css:
        els = soup.select(req.css)[: req.limit]
        strategy = "css"
        records = [_extract_fields(el, req.fields) for el in els]
    elif req.example:
        el, chain = _locate_example(soup, req.example)
        if el is None or chain is None:
            raise HTTPException(404, "example text not found on page")
        strategy = "adaptive"
        siblings = [s for s in (el.parent.find_all(el.name, recursive=False) if el.parent else [el])]
        if len(siblings) <= 1:
            sibs = _find_elements_by_chain(soup, chain, limit=req.limit)
            siblings = sibs or [el]
        records = [_extract_fields(s, req.fields) for s in siblings[: req.limit]]
    else:
        raise HTTPException(422, "provide css or example")
    return JSONResponse({"url": req.url, "strategy": strategy, "count": len(records),
                         "records": records})


@app.post("/crawl")
async def crawl(req: CrawlReq) -> JSONResponse:
    seeds = [s for s in req.seeds if s.startswith("http")]
    if not seeds:
        raise HTTPException(422, "seeds required")
    origin = {urlsplit(s).netloc for s in seeds}
    seen: set[str] = set()
    queue: deque[tuple[str, int]] = deque((s, 0) for s in seeds)
    pages: list[dict] = []
    while queue and len(pages) < req.max_pages:
        url, depth = queue.popleft()
        if url in seen or depth > req.max_depth:
            continue
        seen.add(url)
        try:
            status, final_url, html = await fetch(url, stealth=req.stealth)
        except Exception as exc:
            pages.append({"url": url, "error": str(exc), "depth": depth})
            continue
        soup = soup_of(html)
        pages.append({"url": url, "final_url": final_url, "status": status, "depth": depth,
                      "title": soup.title.get_text(strip=True) if soup.title else None,
                      "text": textify(soup)[:5000]})
        if depth < req.max_depth:
            for link in page_links(soup, final_url):
                if link["url"] in seen:
                    continue
                if req.same_origin_only and urlsplit(link["url"]).netloc not in origin:
                    continue
                queue.append((link["url"], depth + 1))
    return JSONResponse({"pages": pages, "crawled": len([p for p in pages if "error" not in p])})


@app.post("/diff")
async def diff(req: DiffReq) -> JSONResponse:
    if req.mode not in ("text", "structure", "both"):
        raise HTTPException(422, "mode must be text|structure|both")
    return JSONResponse(do_diff(req.before, req.after, req.mode))


@app.post("/monitor")
async def monitor_create(req: MonitorReq) -> JSONResponse:
    if req.mode not in ("text", "structure", "both"):
        raise HTTPException(422, "mode must be text|structure|both")
    mid = f"m{len(MONITORS) + 1:04d}-{abs(hash((req.url, req.name or ''))) % 100000:05d}"
    job = MonitorJob(id=mid, name=req.name or req.url, url=req.url, mode=req.mode,
                     interval_s=req.interval_s, max_snapshots=req.max_snapshots, css=req.css)
    job.snapshots = deque(maxlen=job.max_snapshots)
    job.diffs = deque(maxlen=job.max_snapshots)
    MONITORS[mid] = job
    first = await _check_job(job)
    _persist()
    job.task = asyncio.create_task(_job_loop(job))
    return JSONResponse({"created": mid, "first_check": first}, status_code=201)


@app.get("/monitor")
async def monitor_list() -> JSONResponse:
    return JSONResponse({"jobs": [j.to_public() for j in MONITORS.values()]})


@app.get("/monitor/{mid}")
async def monitor_get(mid: str) -> JSONResponse:
    job = MONITORS.get(mid)
    if not job:
        raise HTTPException(404, "monitor not found")
    return JSONResponse(job.to_public(detail=True))


@app.post("/monitor/{mid}/check")
async def monitor_check(mid: str) -> JSONResponse:
    job = MONITORS.get(mid)
    if not job:
        raise HTTPException(404, "monitor not found")
    return JSONResponse(await _check_job(job))


@app.delete("/monitor/{mid}")
async def monitor_delete(mid: str) -> JSONResponse:
    job = MONITORS.pop(mid, None)
    if not job:
        raise HTTPException(404, "monitor not found")
    if job.task:
        job.task.cancel()
    _persist()
    return JSONResponse({"deleted": mid})


@app.on_event("startup")
async def startup() -> None:
    _restore()
    for job in MONITORS.values():
        job.task = asyncio.create_task(_job_loop(job))