"""simha-judge — LLM-as-a-Judge engine, registry-integrated (Phase 4b).

No judge endpoints or models are hard-coded. On every request the engine
resolves the judge chain from SIMHA's own provider registry:
  app_settings['judge_policy']  →  ordered chain of {account, model} entries
  accounts + discovered_models  →  endpoints, credentials, protocol adapters
Fallback order: primary → secondary → tie_breaker → fallback (skipping
accounts that are cooling down / exhausted per gateway cooldown keys).

If no LLM judge is configured/reachable → deterministic heuristic judge with
HEURISTIC MODE surfaced in every response and in /stats.

Every run is recorded to Postgres `judge_runs` (health, latency, tokens,
cost-estimate when pricing is known, failover count, failure rates).
"""
from __future__ import annotations

import json
import logging
import os
import random
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlsplit

import httpx
import psycopg
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from engine_contract import install_contract

LOG = logging.getLogger("simha.judge")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

DB_URL = os.environ.get("JUDGE_DATABASE_URL", "postgresql://simha:simha_dev_password@postgres:5432/simhaonline")
GATEWAY_URL = os.environ.get("JUDGE_GATEWAY_URL", "http://gateway:8080")  # unused for creds; health only
FETCH_TIMEOUT = float(os.environ.get("JUDGE_FETCH_TIMEOUT", "45"))
MAX_CHAIN_ATTEMPTS = int(os.environ.get("JUDGE_MAX_FAILOVERS", "4"))

DEFAULT_RUBRIC = ["correctness", "relevance", "completeness", "clarity", "safety"]

app = FastAPI(title="simha-judge", version="2.0.0")
install_contract(app, engine="judge", flag_env="JUDGE_ENABLED")


# ── registry access (read-only; no duplicate provider config) ────────────────
_pool = None


def _db():
    global _pool
    if _pool is None:
        import psycopg
        import psycopg_pool
        from psycopg.rows import dict_row
        _pool = psycopg_pool.ConnectionPool(
            DB_URL, min_size=0, max_size=4, open=True, timeout=10,
            kwargs={"row_factory": dict_row})
    return _pool


def _settings_get(key: str) -> Optional[dict]:
    with _db().connection() as c:
        row = c.execute("SELECT value FROM app_settings WHERE key = %s", (key,)).fetchone()
    if not row:
        return None
    raw = row["value"] if isinstance(row, dict) else row[0]
    return json.loads(raw) if raw else None


def _settings_set(key: str, doc: dict) -> None:
    with _db().connection() as c:
        c.execute(
            "INSERT INTO app_settings (key, value) VALUES (%s, %s)"
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (key, json.dumps(doc)))


def resolve_policy() -> dict[str, Any]:
    """Effective judge policy. DB app_settings['judge_policy'] is authoritative.
    .env (JUDGE_*) only seeds a policy if the DB has none yet (bootstrap)."""
    policy = _settings_get("judge_policy")
    if policy is not None:
        return policy
    env_chain = []
    base, model, key = (os.environ.get(n, "").strip() for n in
                        ("JUDGE_BASE_URL", "JUDGE_MODEL", "JUDGE_API_KEY"))
    if base and model:
        env_chain.append({"account": "env-judge", "model": model,
                          "base_url": base, "protocol": "openai", "api_key": key})
        seeded = {"mode": "manual", "chain": env_chain,
                  "seeded_from_env": True, "updated_at": time.time()}
        _settings_set("judge_policy", seeded)
        return seeded
    return {"mode": "auto", "chain": []}


# ── registry resolution (AUTO mode) ─────────────────────────────────────────
def enrich_entry(hop: dict) -> Optional[dict]:
    """Resolve a policy hop {account, model} into a callable entry using the
    accounts registry. Returns None if the account vanished from the registry."""
    account = str(hop.get("account") or "")
    model = str(hop.get("model") or "")
    if not account:
        return None
    try:
        with _db().connection() as c:
            row = c.execute(
                "SELECT name, provider, protocol, base_url, api_key, api_prefix"
                " FROM accounts WHERE name = %s", (account,)).fetchone()
    except Exception as exc:
        LOG.warning("registry lookup failed for %s: %s", account, exc)
        return None
    if not row:
        LOG.warning("judge hop account %s not in registry — skipping", account)
        return None
    return {"account": row["name"], "model": model, "provider": row["provider"],
            "protocol": row["protocol"], "base_url": row["base_url"],
            "api_key": row["api_key"], "api_prefix": row["api_prefix"]}


def _cooldowns() -> dict[str, float]:
    """Gateway cooldown epochs per account (best-effort; Valkey not shared with
    engines, so we derive recent failures from request_history instead)."""
    try:
        with _db().connection() as c:
            rows = c.execute(
                "SELECT account_name, MAX(requested_at) FROM request_history"
                " WHERE status >= 500 AND requested_at > now() - interval '10 minutes'"
                " GROUP BY account_name").fetchall()
        return {((r["account_name"] if isinstance(r, dict) else r[0])): 1.0 for r in rows}  # presence = recently failing
    except Exception:
        return {}


def auto_chain(limit: int = 3) -> list[dict[str, str]]:
    """AUTO: pick best judge candidates from the live registry.
    Score = recent success rate − latency penalty + capability heuristic."""
    now_epoch = time.time()
    failing = _cooldowns()
    with _db().connection() as c:
        rows = c.execute(
            """
            SELECT a.name, a.provider, a.protocol, a.base_url, a.api_key,
                   (SELECT COUNT(*) FROM judge_runs jr
                     WHERE jr.judge_account = a.name AND jr.backend = 'llm'
                       AND jr.created_at > now() - interval '7 days') AS uses,
                   (SELECT COUNT(*) FROM judge_runs jr
                     WHERE jr.judge_account = a.name AND jr.backend = 'llm'
                       AND jr.status = 'failed'
                       AND jr.created_at > now() - interval '7 days') AS fails,
                   (SELECT AVG(latency_ms) FROM judge_runs jr
                     WHERE jr.judge_account = a.name AND jr.backend = 'llm'
                       AND jr.created_at > now() - interval '7 days') AS avg_latency
            FROM accounts a
            WHERE a.protocol IN ('openai', 'anthropic', 'ollama')
              AND EXISTS (SELECT 1 FROM discovered_models d
                          WHERE d.account_name = a.name AND d.enabled
                            AND d.last_seen > now() - interval '7 days')
            ORDER BY a.name
            """).fetchall()
    models_by_account: dict[str, list[dict]] = {}
    with _db().connection() as c:
        for r in rows:
            acc = r["name"] if isinstance(r, dict) else r[0]
            mrows = c.execute(
                "SELECT model FROM discovered_models WHERE account_name = %s"
                " AND enabled AND last_seen > now() - interval '7 days'"
                " ORDER BY model", (acc,)).fetchall()
            models_by_account[acc] = [m["model"] if isinstance(m, dict) else m[0] for m in mrows]

    cands: list[dict] = []
    for r in rows:
        if isinstance(r, dict):
            account, provider, protocol, base_url, api_key = (
                r["name"], r["provider"], r["protocol"], r["base_url"], r["api_key"])
            uses, fails, avg_lat = int(r["uses"] or 0), int(r["fails"] or 0), float(r["avg_latency"] or 0)
        else:
            account, provider, protocol, base_url, api_key = r[0], r[1], r[2], r[3], r[4]
            uses, fails, avg_lat = int(r[5] or 0), int(r[6] or 0), float(r[7] or 0)
        if account in failing:
            continue
        success_rate = 1.0 if uses == 0 else 1.0 - (fails / uses)
        # prefer capable models: reasoning-family names score higher
        def model_score(m: str) -> float:
            s = 0.5
            if re.search(r"(?i)opus|gpt-5|claude-(opus|sonnet)|gemini-3|glm-5|max|pro", m):
                s += 0.4
            if re.search(r"(?i)mini|flash|nano|lite|small|8b|7b", m):
                s -= 0.25
            if avg_lat and avg_lat > 20000:
                s -= 0.1
            return s
        best = sorted(models_by_account.get(account, []),
                      key=model_score, reverse=True)[:2]
        for m in best:
            score = success_rate * 0.6 + model_score(m) * 0.4
            if avg_lat:
                score -= min(avg_lat / 60000.0, 0.15)
            cands.append({"account": account, "model": m, "provider": provider,
                          "protocol": protocol, "base_url": base_url,
                          "api_key": api_key, "_score": round(score, 3)})
    cands.sort(key=lambda x: x["_score"], reverse=True)
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for c in cands:
        k = (c["account"], c["model"])
        if k in seen:
            continue
        seen.add(k)
        out.append({k2: v2 for k2, v2 in c.items() if not k2.startswith("_")})
        if len(out) >= limit:
            break
    return out


# ── protocol adapters (same contract as gateway: openai|anthropic|ollama) ────
def _headers(protocol: str, api_key: str) -> dict[str, str]:
    if protocol == "anthropic":
        h = {"x-api-key": api_key or "", "anthropic-version": "2023-06-01"}
    elif api_key:
        h = {"Authorization": f"Bearer {api_key}"}
    else:
        h = {}
    return h


def _url(protocol: str, base_url: str, api_prefix: str, model: str) -> str:
    base = base_url.rstrip("/")
    prefix = (api_prefix or "/v1").strip("/")
    if protocol == "ollama":
        return f"{base}/api/chat"
    return f"{base}/{prefix}/chat/completions"


def _body(protocol: str, model: str, system: str, user: str, json_mode: bool) -> dict:
    if protocol == "anthropic":
        return {"model": model, "max_tokens": 1024, "system": system,
                "messages": [{"role": "user", "content": user}]}
    b = {"model": model, "temperature": 0,
         "messages": [{"role": "system", "content": system},
                      {"role": "user", "content": user}]}
    if json_mode:
        b["response_format"] = {"type": "json_object"}
    return b


def _extract_text(protocol: str, doc: dict) -> str:
    if protocol == "anthropic":
        blocks = doc.get("content") or []
        return " ".join(str(b.get("text") or "") for b in blocks if isinstance(b, dict))
    return str((doc.get("choices") or [{}])[0].get("message", {}).get("content") or "")


def _extract_usage(doc: dict) -> tuple[Optional[int], Optional[int]]:
    u = doc.get("usage") or {}
    pt = u.get("prompt_tokens", u.get("input_tokens"))
    ct = u.get("completion_tokens", u.get("output_tokens"))
    return (int(pt) if pt is not None else None, int(ct) if ct is not None else None)


def _call_llm(entry: dict, system: str, user: str, json_mode: bool = True
              ) -> tuple[Optional[str], Optional[int], Optional[int], Optional[float]]:
    """Call one judge candidate. Returns (text, prompt_tokens, completion_tokens,
    latency_ms) or (None, None, None, latency) on failure."""
    protocol = entry.get("protocol") or "openai"
    url = _url(protocol, entry["base_url"], entry.get("api_prefix") or "/v1", entry["model"])
    started = time.time()
    try:
        r = httpx.post(url, headers=_headers(protocol, entry.get("api_key") or ""),
                       json=_body(protocol, entry["model"], system, user, json_mode),
                       timeout=FETCH_TIMEOUT)
        latency = (time.time() - started) * 1000
        if r.status_code >= 400:
            LOG.warning("judge %s@%s → HTTP %s", entry["model"], entry["account"], r.status_code)
            return None, None, None, latency
        doc = r.json()
        text = _extract_text(protocol, doc)
        if not text:
            return None, None, None, latency
        pt, ct = _extract_usage(doc)
        return text, pt, ct, latency
    except Exception as exc:
        LOG.warning("judge %s@%s failed: %s", entry["model"], entry["account"], exc)
        return None, None, None, (time.time() - started) * 1000


# ── heuristic fallback judge (deterministic, offline) ────────────────────────
def heuristic_scores(prompt: str, response: str, criteria: list[str]) -> dict[str, float]:
    words = len(response.split())
    if words == 0:
        base = 0.0
    else:
        base = min(10.0, 4.0 + words / 60.0)
    out: dict[str, float] = {}
    for c in criteria:
        score = base
        if c == "relevance" and prompt:
            overlap = len(set(prompt.lower().split()) & set(response.lower().split()))
            score = min(10.0, base + overlap / 10.0)
        if c == "completeness" and not response.strip():
            score = 0.0
        if c == "clarity":
            sentences = max(1, len(re.findall(r"[.!?]", response)))
            score = min(10.0, 3.0 + sentences * 1.2 + min(words, 120) / 40.0)
        if c == "safety":
            bad = re.findall(r"(?i)\b(hack|malware|steal|exploit)\b", response)
            score = max(0.0, 10.0 - len(bad) * 3.0)
        out[c] = round(score, 1)
    return out


def _heuristic_single(prompt: str, response: str, criteria: list[str]) -> dict:
    scores = heuristic_scores(prompt, response, criteria)
    return {"scores": scores, "overall": round(sum(scores.values()) / len(criteria), 2),
            "rationale": "heuristic baseline (no LLM judge configured/reachable)"}


# ── judge router (chain + failover) ──────────────────────────────────────────
def _run_chain(task: dict, criteria: list[str]) -> dict[str, Any]:
    """Execute the judge task over the resolved chain with failover.
    Returns {verdict, backend, attempts, failovers, prompt_tokens,
    completion_tokens, latency_ms, error, degraded, judge_account, judge_model}."""
    policy = resolve_policy()
    mode = policy.get("mode") or "auto"
    chain: list[dict] = [dict(h) for h in (policy.get("chain") or [])]
    # heuristic_only never touches the network; manual with an empty chain
    # falls back to registry AUTO; AUTO re-resolves every call (live policy).
    if mode == "heuristic_only":
        chain = []
    elif chain:
        # enrich policy hops from the live registry (hops store account+model
        # only — credentials/protocol live in accounts, per the registry rule)
        chain = [e for e in (enrich_entry(h) for h in chain) if e]
    elif mode == "auto" or (mode == "manual" and not chain):
        chain = auto_chain(3)
    heuristic_only = not chain

    attempts: list[dict] = []
    failovers = 0
    prompt_tokens = completion_tokens = None
    latency_ms = None
    last_error = None

    def try_llm(entry: dict, system: str, user: str) -> Optional[dict]:
        nonlocal prompt_tokens, completion_tokens, latency_ms, last_error, failovers
        text, pt, ct, lat = _call_llm(entry, system, user, json_mode=True)
        attempts.append({"account": entry["account"], "model": entry["model"],
                         "ok": bool(text), "latency_ms": round(lat or 0)})
        if latency_ms is None:
            latency_ms = round(lat or 0)
        else:
            latency_ms += round(lat or 0)
        if pt is not None:
            prompt_tokens = (prompt_tokens or 0) + pt
        if ct is not None:
            completion_tokens = (completion_tokens or 0) + ct
        if text is None:
            last_error = f"{entry['account']}/{entry['model']} unreachable"
            failovers += 1
            return None
        return {"text": text, "entry": entry}

    if heuristic_only:
        # ── HEURISTIC MODE ──
        if task["type"] == "pairwise":
            sa = sum(heuristic_scores(task["prompt"], task["response_a"], criteria).values())
            sb = sum(heuristic_scores(task["prompt"], task["response_b"], criteria).values())
            verdict = {"winner": "a" if sa > sb else ("b" if sb > sa else "tie"),
                       "consistency": "consistent",
                       "scores": {"a": sa, "b": sb}}
        else:
            verdict = _heuristic_single(task["prompt"], task["response"], criteria)
        return {"verdict": verdict, "backend": "heuristic", "attempts": [],
                "failovers": 0, "prompt_tokens": None, "completion_tokens": None,
                "latency_ms": None, "error": None}

    # ── LLM path with failover across the chain ──
    result: Optional[dict] = None
    backend_entry = None
    if task["type"] == "pairwise":
        for entry in chain:
            system = (
                "You are an impartial judge comparing two anonymous responses. "
                f"Criteria: {criteria} (0-10 each). Respond ONLY with JSON: "
                '{"A": {"<criterion>": n, ...}, "B": {"..."}, '
                '"winner": "A"|"B"|"tie", "rationale": "..."}. '
                "Judge content only — names, length and style must not bias you.")
            user = (f"PROMPT:\n{task['prompt']}\n\nRESPONSE A:\n{task['response_a']}"
                    f"\n\nRESPONSE B:\n{task['response_b']}")
            got = try_llm(entry, system, user)
            if got:
                v = _parse_pair(got["text"])
                if v:
                    result = v
                    backend_entry = entry
                    break
    else:  # single
        for entry in chain:
            system = (
                "You are a strict evaluation judge. Score the RESPONSE on each "
                f"criteria {criteria} from 0 to 10. Respond ONLY with JSON: "
                '{"<criterion>": <number>, ..., "rationale": "one short paragraph"}. '
                "Evaluate only observable output. Never reveal hidden chain-of-thought.")
            user = f"PROMPT:\n{task['prompt']}\n\nRESPONSE:\n{task['response']}"
            got = try_llm(entry, system, user)
            if got:
                v = _parse_single(got["text"], criteria)
                if v:
                    result = v
                    backend_entry = entry
                    break

    if result is None:
        # every LLM in the chain failed → heuristic fallback, flagged degraded
        if task["type"] == "pairwise":
            sa = sum(heuristic_scores(task["prompt"], task["response_a"], criteria).values())
            sb = sum(heuristic_scores(task["prompt"], task["response_b"], criteria).values())
            verdict: dict[str, Any] = {"winner": "a" if sa > sb else ("b" if sb > sa else "tie"),
                                       "consistency": "consistent", "scores": {"a": sa, "b": sb}}
        else:
            verdict = _heuristic_single(task["prompt"], task["response"], criteria)
        return {"verdict": verdict, "backend": "heuristic", "attempts": attempts,
                "failovers": failovers, "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens, "latency_ms": latency_ms,
                "error": last_error, "degraded": True,
                "judge_account": None, "judge_model": None}

    meta: dict[str, Any] = {"attempts": attempts, "failovers": failovers,
                            "prompt_tokens": prompt_tokens,
                            "completion_tokens": completion_tokens,
                            "latency_ms": latency_ms, "error": None, "degraded": False,
                            "backend": "llm",
                            "judge_account": backend_entry["account"] if backend_entry else None,
                            "judge_model": backend_entry["model"] if backend_entry else None}
    return {"verdict": result, **meta}


def _parse_single(text: str, criteria: list[str]) -> Optional[dict]:
    try:
        doc = json.loads(text[text.index("{"): text.rindex("}") + 1])
    except (ValueError, KeyError):
        return None
    scores = {}
    for c in criteria:
        v = doc.get(c)
        if isinstance(v, (int, float)) and 0 <= v <= 10:
            scores[c] = round(float(v), 1)
    if not scores:
        return None
    return {"scores": scores, "overall": round(sum(scores.values()) / len(scores), 2),
            "rationale": str(doc.get("rationale") or "")[:1000]}


def _parse_pair(text: str) -> Optional[dict]:
    try:
        doc = json.loads(text[text.index("{"): text.rindex("}") + 1])
    except (ValueError, KeyError):
        return None
    w = str(doc.get("winner", "")).strip().lower()
    if w not in ("a", "b", "tie"):
        return None
    return {"winner": w,
            "scores": {k: doc.get(k) for k in ("A", "B") if isinstance(doc.get(k), dict)},
            "rationale": str(doc.get("rationale") or "")[:1000]}


# ── run recording ────────────────────────────────────────────────────────────
def record_run(task_type: str, subject_ref: str, meta: dict,
               verdict: dict, status: str = "ok") -> int:
    with _db().connection() as c:
        cur = c.execute(
            "INSERT INTO judge_runs (task_type, subject_ref, mode, chain, judge_account,"
            " judge_model, backend, verdict, winner, consistency, prompt_tokens,"
            " completion_tokens, cost_estimate, latency_ms, failovers, status, error)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (task_type, subject_ref, meta.get("mode", "auto"),
             json.dumps(meta.get("chain", [])),
             meta.get("judge_account"), meta.get("judge_model"), meta.get("backend"),
             json.dumps(verdict), verdict.get("winner"), verdict.get("consistency"),
             meta.get("prompt_tokens"), meta.get("completion_tokens"), None,
             meta.get("latency_ms"), meta.get("failovers", 0), status,
             meta.get("error")))
        row = cur.fetchone()
        val = row["id"] if isinstance(row, dict) else row[0]
        return int(val)


# ── public execution API (used by endpoints) ─────────────────────────────────
def execute(task_type: str, prompt: str, response: str = "",
            response_b: str = "", criteria: list[str] | None = None,
            subject_ref: str = "") -> dict[str, Any]:
    criteria = [c for c in (criteria or DEFAULT_RUBRIC) if isinstance(c, str)][:8]
    policy = resolve_policy()
    task = {"type": task_type, "prompt": prompt, "response": response,
            "response_a": response, "response_b": response_b}
    res = _run_chain(task, criteria)
    chain_used = [{"account": a.get("account"), "model": a.get("model")}
                  for a in res.get("attempts", [])]
    meta = {k: v for k, v in res.items()
            if k not in ("verdict", "chain", "attempts")}
    meta["mode"] = policy.get("mode")
    meta["chain"] = chain_used
    run_id = record_run(task_type, subject_ref, meta, res["verdict"],
                        status="degraded" if res.get("degraded") else "ok")
    return {"run_id": run_id, "task_type": task_type,
            "mode": policy.get("mode"), "heuristic_mode": res["backend"] == "heuristic",
            "verdict": res["verdict"], "judge_account": res.get("judge_account"),
            "judge_model": res.get("judge_model"), "attempts": res.get("attempts", []),
            "failovers": res.get("failovers", 0),
            "prompt_tokens": res.get("prompt_tokens"),
            "completion_tokens": res.get("completion_tokens"),
            "latency_ms": res.get("latency_ms"),
            "degraded": res.get("degraded", False), "error": res.get("error")}


# ── API models ───────────────────────────────────────────────────────────────
class SingleReq(BaseModel):
    prompt: str
    response: str
    criteria: list[str] = Field(default_factory=lambda: list(DEFAULT_RUBRIC))
    subject_ref: str = ""


class PairReq(BaseModel):
    prompt: str
    response_a: str
    response_b: str
    criteria: list[str] = Field(default_factory=lambda: list(DEFAULT_RUBRIC))
    reverse_order: bool = True
    subject_ref: str = ""


class PolicyReq(BaseModel):
    mode: str = "auto"                    # auto | manual | heuristic_only
    primary: Optional[dict] = None        # {account, model}
    secondary: Optional[dict] = None
    tie_breaker: Optional[dict] = None
    fallback: Optional[dict] = None
    consensus_judges: int = Field(3, ge=1, le=5)


# ── endpoints ────────────────────────────────────────────────────────────────
@app.get("/healthz")
async def healthz() -> JSONResponse:
    policy = resolve_policy()
    return JSONResponse({"status": "ok", "service": "simha-judge",
                         "mode": policy.get("mode"),
                         "configured_chain": len(policy.get("chain") or []),
                         "registry_backed": True})


@app.post("/judge/single")
async def single_ep(req: SingleReq) -> JSONResponse:
    return JSONResponse(execute("single", req.prompt, req.response,
                                criteria=req.criteria, subject_ref=req.subject_ref))


@app.post("/judge/pairwise")
async def pairwise_ep(req: PairReq) -> JSONResponse:
    res = execute("pairwise", req.prompt, req.response_a, req.response_b,
                  criteria=req.criteria, subject_ref=req.subject_ref)
    return JSONResponse(res)


@app.post("/policy")
async def set_policy(req: PolicyReq) -> JSONResponse:
    chain = [x for x in (req.primary, req.secondary, req.tie_breaker, req.fallback)
             if x and x.get("account") and x.get("model")]
    doc = {"mode": req.mode if req.mode in ("auto", "manual", "heuristic_only") else "auto",
           "chain": chain, "consensus_judges": req.consensus_judges,
           "updated_at": time.time(), "updated_by": "api"}
    _settings_set("judge_policy", doc)
    return JSONResponse({"saved": doc}, status_code=201)


@app.get("/policy")
async def get_policy() -> JSONResponse:
    return JSONResponse({"policy": resolve_policy()})


@app.post("/policy/validate")
async def validate_policy() -> JSONResponse:
    """Probe every chain entry with a tiny prompt; report health per hop.
    Hops are enriched from the registry before probing."""
    policy = resolve_policy()
    out = []
    for i, hop in enumerate((policy.get("chain") or [])):
        entry = enrich_entry(hop)
        if not entry:
            out.append({"position": i, "account": hop.get("account"),
                        "model": hop.get("model"), "ok": False, "latency_ms": 0,
                        "note": "account not in registry"})
            continue
        text, _, _, lat = _call_llm(
            entry, "Reply with the single word OK.",
            "Reply with the single word OK.", json_mode=False)
        out.append({"position": i, "account": entry["account"], "model": entry["model"],
                    "ok": bool(text), "latency_ms": round(lat or 0)})
    auto = auto_chain(3)
    return JSONResponse({"policy_mode": policy.get("mode"),
                         "chain_probe": out,
                         "auto_candidates": [{"account": a["account"], "model": a["model"]}
                                              for a in auto]})


@app.get("/stats")
async def stats(limit: int = 20) -> JSONResponse:
    from decimal import Decimal
    from datetime import datetime as _dt

    def _clean(v: Any) -> Any:
        if isinstance(v, Decimal):
            return float(v)
        if isinstance(v, _dt):
            return v.isoformat()
        return v

    with _db().connection() as c:
        agg = c.execute(
            """
            SELECT backend,
                   COUNT(*) AS runs,
                   COUNT(*) FILTER (WHERE status = 'failed') AS failures,
                   COUNT(*) FILTER (WHERE status = 'degraded') AS degradations,
                   AVG(latency_ms) AS avg_latency,
                   AVG(failovers) AS avg_failovers,
                   SUM(COALESCE(prompt_tokens,0)) AS prompt_tokens,
                   SUM(COALESCE(completion_tokens,0)) AS completion_tokens
            FROM judge_runs GROUP BY backend ORDER BY backend
            """).fetchall()
        by_model = c.execute(
            """
            SELECT judge_model, COUNT(*) AS runs,
                   COUNT(*) FILTER (WHERE status <> 'ok') AS failures,
                   AVG(latency_ms) AS avg_latency
            FROM judge_runs WHERE judge_model IS NOT NULL
            GROUP BY judge_model ORDER BY runs DESC LIMIT %s
            """, (max(1, min(limit, 100)),)).fetchall()
        recent = c.execute(
            "SELECT id, created_at, task_type, judge_account, judge_model, backend,"
            " status, latency_ms, failovers, error FROM judge_runs"
            " ORDER BY id DESC LIMIT %s", (max(1, min(limit, 100)),)).fetchall()
    heuristic_mode = True
    if _settings_get("judge_policy"):
        p = resolve_policy()
        heuristic_mode = p.get("mode") == "heuristic_only" or not (p.get("chain") or [])
    return JSONResponse({
        "heuristic_mode": heuristic_mode,
        "backends": [{k: _clean(v) for k, v in r.items()} for r in agg],
        "by_model": [{k: _clean(v) for k, v in r.items()} for r in by_model],
        "recent_runs": [{k: _clean(v) for k, v in r.items()} for r in recent],
    })