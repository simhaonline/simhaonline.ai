"""SIMHA Agent Runtime (Phase 5) — autonomous agent execution engine.

Implements the spec §30 core loop natively:

    GOAL → PLAN → SELECT TOOL → EXECUTE → OBSERVE → UPDATE STATE
         → CONTINUE / RETRY / ESCALATE → VERIFY → ANSWER

Design:
- State lives in core Postgres (agent_runs / agent_steps / agent_approvals),
  so a run survives restarts and is observable from the control plane UI.
- The LLM (via the gateway, OpenAI-compatible) decides PLAN / tool choice /
  final answer; the engine executes tools and feeds observations back.
- Tool permissions (§31): a run receives an explicit allow-list; any tool not
  on the list is refused. Tools needing approval (destructive/network-write)
  park the run in `awaiting_approval` and record an agent_approvals row.
- Selective context (§29): the model sees the goal + compact step history,
  never the full raw transcript.

Tool registry v1 (all safe-by-default):
  llm           — a step through the gateway (any model)   [LLM]
  web_retrieval — scrape a URL via the scraper engine      [NETWORK, READ]
  http_fetch    — GET a URL (JSON/text)                    [NETWORK, READ]
  memory_search — semantic memory lookup                   [DATABASE, READ]
  memory_save   — write to semantic memory                 [DATABASE, WRITE]

Endpoints:
  POST /runs                {goal, user_id?, max_steps?, permissions?} → run
  GET  /runs/{id}           full trace (steps)
  GET  /runs/{id}/status    light poll
  POST /runs/{id}/cancel
  POST /approvals/{id}/decide  {approve: bool, decided_by}
  GET  /runs?limit=         recent runs
  POST /tick                process queued runs (worker calls this)
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from engine_contract import install_contract

DB_DSN = os.environ.get("AGENTS_DATABASE_URL",
                        "postgresql://simha:simha_dev_password@postgres:5432/simhaonline")
GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://gateway:8080")
SCRAPER_URL = os.environ.get("SCRAPER_URL", "http://scraper:8111")
DISCOVERY_URL = os.environ.get("DISCOVERY_URL", "http://discovery:8115")
AGENT_MODEL = os.environ.get("AGENT_MODEL", "")          # '' = gateway auto-route
RUNNER_INTERVAL = int(os.environ.get("AGENTS_RUNNER_INTERVAL", "5"))
MAX_OUTPUT_CHARS = 6000

# tool → capability classes it implies (§31). Anything marked needs_approval
# parks the run until an admin approves that specific call.
TOOL_REGISTRY: dict[str, dict[str, Any]] = {
    "llm":           {"caps": {"LLM"}, "approval": False},
    "web_retrieval": {"caps": {"NETWORK", "READ"}, "approval": False},
    "http_fetch":    {"caps": {"NETWORK", "READ"}, "approval": False},
    "memory_search": {"caps": {"DATABASE", "READ"}, "approval": False},
    "memory_save":   {"caps": {"DATABASE", "WRITE"}, "approval": True},
}

app = FastAPI(title="simha-agents", version="1.0.0")
install_contract(app, engine="agents", flag_env="AGENTS_ENABLED")

# ── db ────────────────────────────────────────────────────────────────────────
def _pool():
    from psycopg_pool import ConnectionPool
    global _POOL
    try:
        return _POOL
    except NameError:
        _POOL = ConnectionPool(DB_DSN, min_size=1, max_size=4, open=True,
                               kwargs={"autocommit": True})
        return _POOL

def q(sql: str, params: tuple = ()) -> list[dict]:
    with _pool().connection() as con:
        cur = con.execute(sql, params)
        try:
            cols = [d[0] for d in cur.description] if cur.description else []
            return [dict(zip(cols, row)) for row in cur.fetchall()]
        finally:
            cur.close()

def jsonable(rows: list[dict] | dict) -> list[dict] | dict:
    """datetime/Decimal → JSON-safe (FastAPI refuses raw datetime objects)."""
    import datetime as _dt
    import decimal as _dec

    def conv(v: Any) -> Any:
        if isinstance(v, _dt.datetime | _dt.date):
            return v.isoformat()
        if isinstance(v, _dt.timedelta):
            return str(v)
        if isinstance(v, _dec.Decimal):
            return float(v)
        if isinstance(v, dict):
            return {k: conv(x) for k, x in v.items()}
        if isinstance(v, (list, tuple)):
            return [conv(x) for x in v]
        return v
    if isinstance(rows, dict):
        return conv(rows)  # type: ignore[return-value]
    return [conv(r) for r in rows]

def qx(sql: str, params: tuple = ()) -> None:
    with _pool().connection() as con:
        con.execute(sql, params)

def _init_db() -> None:
    for attempt in range(30):
        try:
            q("SELECT 1")
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("postgres unreachable at boot")

# ── models ────────────────────────────────────────────────────────────────────
class RunReq(BaseModel):
    goal: str
    user_id: int | None = None
    max_steps: int = 12
    max_tokens: int = 40000
    permissions: list[str] = Field(default_factory=lambda: ["llm", "web_retrieval",
                                                            "http_fetch", "memory_search"])

class DecideReq(BaseModel):
    approved: bool
    decided_by: int | None = None

# ── gateway LLM helper ────────────────────────────────────────────────────────
def _gateway_key() -> str:
    rows = q("SELECT value FROM app_settings WHERE key = 'workbench_gateway_key'")
    if rows and rows[0]["value"]:
        return str(rows[0]["value"])
    return ""

def llm_call(prompt: str, max_tokens: int = 700, system: str = "") -> tuple[str, int]:
    """One OpenAI-compatible call through the gateway. Returns (text, tokens)."""
    key = _gateway_key()
    if not key:
        raise RuntimeError("no gateway key minted yet (workbench must run once)")
    messages = ([{"role": "system", "content": system}] if system else []) + \
        [{"role": "user", "content": prompt}]
    r = httpx.post(f"{GATEWAY_URL}/v1/chat/completions",
                   headers={"Authorization": f"Bearer {key}"},
                   json={"messages": messages, "max_tokens": max_tokens},
                   timeout=60)
    r.raise_for_status()
    data = r.json()
    text = str((data.get("choices") or [{}])[0].get("message", {}).get("content") or "")
    usage = data.get("usage", {})
    return text, int(usage.get("total_tokens", len(prompt) // 4 + len(text) // 4))

# ── tools ─────────────────────────────────────────────────────────────────────
def tool_llm(args: dict) -> str:
    text, _ = llm_call(str(args.get("prompt", ""))[:6000],
                       max_tokens=min(1000, int(args.get("max_tokens", 700))),
                       system=str(args.get("system", ""))[:800])
    return text

def tool_web_retrieval(args: dict) -> str:
    url = str(args.get("url", "")).strip()
    if not re.match(r"^https?://", url):
        raise ValueError("http(s) url required")
    r = httpx.post(f"{SCRAPER_URL}/fetch", json={"url": url}, timeout=40)
    r.raise_for_status()
    d = r.json()
    text = str(d.get("text") or d.get("content") or json.dumps(d)[:MAX_OUTPUT_CHARS])
    return text[:MAX_OUTPUT_CHARS]

def tool_http_fetch(args: dict) -> str:
    url = str(args.get("url", "")).strip()
    if not re.match(r"^https?://", url):
        raise ValueError("http(s) url required")
    r = httpx.get(url, timeout=30, follow_redirects=True,
                  headers={"User-Agent": "simha-agent/1.0"})
    body = r.text[:MAX_OUTPUT_CHARS]
    try:
        data = r.json()
        body = json.dumps(data)[:MAX_OUTPUT_CHARS]
    except ValueError:
        pass
    return f"HTTP {r.status_code}\n{body}"

def tool_memory_search(args: dict) -> str:
    query = str(args.get("query", ""))[:300]
    rows = q("""SELECT id, kind, ref_id, left(content, 300) AS content, created_at
                FROM semantic_memory
                WHERE content ILIKE %s
                ORDER BY created_at DESC LIMIT 8""", (f"%{query}%",))
    return json.dumps({"matches": jsonable(rows)})[:MAX_OUTPUT_CHARS]

def tool_memory_save(args: dict) -> str:
    content = str(args.get("content", "")).strip()[:2000]
    if not content:
        raise ValueError("content required")
    ref = str(args.get("ref_id") or "agent-runtime")
    rows = q("""INSERT INTO semantic_memory(kind, ref_id, content)
                VALUES ('agent_memory', %s, %s) RETURNING id""", (ref, content))
    return json.dumps({"saved": rows[0]["id"]})

TOOLS = {"llm": tool_llm, "web_retrieval": tool_web_retrieval,
         "http_fetch": tool_http_fetch, "memory_search": tool_memory_search,
         "memory_save": tool_memory_save}

# ── step bookkeeping ─────────────────────────────────────────────────────────
def add_step(run_id: int, seq: int, kind: str, tool: str | None, inp: dict | None,
             output: str, tokens: int = 0, ok: bool | None = None) -> None:
    qx("""INSERT INTO agent_steps(run_id, seq, kind, tool, input, output, tokens, ok)
          VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
       (run_id, seq, kind, tool,
        json.dumps(inp or {}), output[:MAX_OUTPUT_CHARS], tokens, ok))

def history_for_model(run_id: int, limit: int = 20) -> str:
    """Compact, selective context (§29) — not the raw transcript."""
    rows = q("""SELECT seq, kind, tool, output FROM agent_steps
                WHERE run_id = %s AND kind IN ('plan','tool_result','final')
                ORDER BY seq DESC LIMIT %s""", (run_id, limit))
    lines = []
    for r in reversed(rows):
        head = (r["output"] or "").replace("\n", " ")[:220]
        lines.append(f"{r['seq']}. [{r['kind']}{(':' + r['tool']) if r['tool'] else ''}] {head}")
    return "\n".join(lines) or "(no steps yet)"

# ── the core loop (§30) ──────────────────────────────────────────────────────
PLANNER_SYSTEM = (
    "You are the planning unit of an autonomous agent. Produce a short, "
    "numbered plan (max steps given). Available tools: "
    + ", ".join(f"{name}" for name in TOOL_REGISTRY) + "."
)
DECIDER_SYSTEM = (
    "You are the tool-selection unit of an autonomous agent. Given the goal "
    "and progress, reply with EXACTLY one JSON object and nothing else:\n"
    '{"action":"tool","tool":"<name>","args":{...}}\nor\n'
    '{"action":"final","answer":"<complete answer>"}\n'
    "Prefer finishing with a final answer once the goal is satisfied."
)

def run_loop(run_id: int) -> None:
    rows = q("SELECT * FROM agent_runs WHERE id = %s", (run_id,))
    if not rows:
        return
    run = rows[0]
    permissions = set(run["permissions"] or [])
    max_steps = int(run["max_steps"] or 12)
    max_tokens = int(run["max_tokens"] or 40000)
    goal = run["goal"]
    tokens_used = int(run["tokens_used"] or 0)
    seq = int(run["steps_used"] or 0)

    qx("UPDATE agent_runs SET status='running', updated_at=now() WHERE id=%s", (run_id,))
    try:
        # PLAN (once)
        if not q("SELECT 1 FROM agent_steps WHERE run_id=%s AND kind='plan'", (run_id,)):
            plan_text, t = llm_call(
                f"Goal: {goal}\n\nWrite a concise step-by-step plan (max {max_steps} steps). "
                "Number the steps. Use only these tools where needed: "
                + ", ".join(sorted(permissions)) + ".", system=PLANNER_SYSTEM)
            seq += 1
            tokens_used += t
            add_step(run_id, seq, "plan", None, {"goal": goal}, plan_text, t, True)
            qx("UPDATE agent_runs SET tokens_used=%s, steps_used=%s, updated_at=now() WHERE id=%s",
               (tokens_used, seq, run_id))

        while seq < max_steps:
            # ESCALATE/GATE: if an approval is pending, stop and wait.
            pend = q("SELECT id FROM agent_approvals WHERE run_id=%s AND status='pending'", (run_id,))
            if pend:
                qx("UPDATE agent_runs SET status='awaiting_approval', updated_at=now() WHERE id=%s", (run_id,))
                return

            hist = history_for_model(run_id)
            dec_text, t = llm_call(
                f"GOAL: {goal}\n\nPROGRESS:\n{hist}\n\n"
                "Decide the next action (one JSON object).", system=DECIDER_SYSTEM)
            tokens_used += t

            m = re.search(r"\{.*\}", dec_text, re.S)
            if not m:
                seq += 1
                add_step(run_id, seq, "think", None, None, dec_text[:400], t)
                continue
            try:
                decision = json.loads(m.group(0))
            except ValueError:
                seq += 1
                add_step(run_id, seq, "think", None, None, dec_text[:400], t)
                continue

            action = str(decision.get("action", ""))
            if action == "final":
                answer = str(decision.get("answer", "")).strip()
                seq += 1
                add_step(run_id, seq, "final", None, None, answer, t, True)
                qx("""UPDATE agent_runs SET status='completed', result=%s,
                      tokens_used=%s, steps_used=%s, finished_at=now(), updated_at=now()
                      WHERE id=%s""", (answer, tokens_used, seq, run_id))
                return
            if action != "tool":
                seq += 1
                add_step(run_id, seq, "think", None, decision, dec_text[:400], t)
                continue

            tool = str(decision.get("tool", ""))
            args = decision.get("args") or {}

            # PERMISSION + APPROVAL GATE (§31)
            if tool not in TOOL_REGISTRY or tool not in permissions:
                seq += 1
                add_step(run_id, seq, "error", tool, args, f"tool '{tool}' not permitted for this run", 0, False)
                qx("UPDATE agent_runs SET tokens_used=%s, steps_used=%s, updated_at=now() WHERE id=%s",
                   (tokens_used, seq, run_id))
                continue
            if TOOL_REGISTRY[tool]["approval"]:
                qx("""INSERT INTO agent_approvals(run_id, step_seq, tool, request_json)
                      VALUES (%s,%s,%s,%s)""",
                   (run_id, seq + 1, tool, json.dumps(args)))
                qx("UPDATE agent_runs SET status='awaiting_approval', steps_used=%s, tokens_used=%s, updated_at=now() WHERE id=%s",
                   (seq, tokens_used, run_id))
                return  # runner resumes after approval

            # EXECUTE
            seq += 1
            add_step(run_id, seq, "tool_call", tool, args, "", 0)
            try:
                output = TOOLS[tool](args if isinstance(args, dict) else {})
                ok = True
            except Exception as exc:  # noqa: BLE001 — tool errors are observations
                output, ok = f"tool error: {exc}", False
            qx("""UPDATE agent_steps SET kind='tool_result', output=%s, ok=%s
                  WHERE run_id=%s AND seq=%s""", (output[:MAX_OUTPUT_CHARS], ok, run_id, seq))
            qx("UPDATE agent_runs SET tokens_used=%s, steps_used=%s, updated_at=now() WHERE id=%s",
               (tokens_used, seq, run_id))

        # step budget exhausted → close with best effort
        seq += 1
        add_step(run_id, seq, "error", None, None, "max steps reached without a final answer", 0, False)
        qx("""UPDATE agent_runs SET status='failed', error='max_steps reached',
              steps_used=%s, tokens_used=%s, finished_at=now(), updated_at=now()
              WHERE id=%s""", (seq, tokens_used, run_id))
    except Exception as exc:  # noqa: BLE001
        qx("""UPDATE agent_runs SET status='failed', error=%s, finished_at=now(),
              steps_used=%s, tokens_used=%s, updated_at=now() WHERE id=%s""",
           (str(exc)[:500], seq, tokens_used, run_id))

def _next_queued() -> int | None:
    rows = q("""UPDATE agent_runs SET status='planning', updated_at=now()
                WHERE id = (SELECT id FROM agent_runs WHERE status IN ('queued','awaiting_approval')
                            ORDER BY (status='queued') DESC, id LIMIT 1)
                RETURNING id""")
    return rows[0]["id"] if rows else None

async def runner() -> None:
    """Background scheduler: one run at a time, resumable after restarts."""
    while True:
        try:
            run_id = _next_queued()
            if run_id is None:
                await asyncio.sleep(RUNNER_INTERVAL)
                continue
            await asyncio.get_event_loop().run_in_executor(None, run_loop, run_id)
        except Exception:
            await asyncio.sleep(RUNNER_INTERVAL)

# ── routes ────────────────────────────────────────────────────────────────────
@app.get("/healthz")
async def healthz() -> JSONResponse:
    try:
        q("SELECT 1")
        db = "ok"
    except Exception as exc:
        db = f"error: {exc}"
    return JSONResponse({"status": "ok" if db == "ok" else "degraded", "db": db})

@app.post("/runs", status_code=201)
async def create_run(req: RunReq) -> JSONResponse:
    goal = req.goal.strip()
    if len(goal) < 5:
        raise HTTPException(422, "goal too short")
    perms = [p for p in req.permissions if p in TOOL_REGISTRY]
    rows = q("""INSERT INTO agent_runs(goal, user_id, max_steps, max_tokens, permissions)
                VALUES (%s,%s,%s,%s,%s) RETURNING id, status""",
             (goal, req.user_id, min(req.max_steps, 30), min(req.max_tokens, 150000),
              json.dumps(perms)))
    return JSONResponse(dict(rows[0]))

@app.get("/runs")
async def list_runs(limit: int = 20, user_id: int | None = None) -> JSONResponse:
    rows = q("""SELECT id, user_id, goal, status, steps_used, tokens_used,
                       created_at, finished_at
                FROM agent_runs WHERE (%s IS NULL OR user_id=%s)
                ORDER BY id DESC LIMIT %s""", (user_id, user_id, min(limit, 100)))
    return JSONResponse({"runs": jsonable(rows)})

@app.get("/runs/{run_id}")
async def run_detail(run_id: int) -> JSONResponse:
    runs = q("SELECT * FROM agent_runs WHERE id=%s", (run_id,))
    if not runs:
        raise HTTPException(404, "run not found")
    steps = q("""SELECT seq, kind, tool, input, output, tokens, ok, created_at
                 FROM agent_steps WHERE run_id=%s ORDER BY seq""", (run_id,))
    approvals = q("""SELECT id, step_seq, tool, request_json, status, created_at
                     FROM agent_approvals WHERE run_id=%s ORDER BY id""", (run_id,))
    return JSONResponse({"run": jsonable(runs[0]), "steps": jsonable(steps),
                         "approvals": jsonable(approvals)})

@app.get("/runs/{run_id}/status")
async def run_status(run_id: int) -> JSONResponse:
    rows = q("""SELECT id, status, steps_used, tokens_used, result, error
                FROM agent_runs WHERE id=%s""", (run_id,))
    if not rows:
        raise HTTPException(404, "run not found")
    return JSONResponse(rows[0])

@app.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: int) -> JSONResponse:
    qx("""UPDATE agent_runs SET status='cancelled', finished_at=now(), updated_at=now()
          WHERE id=%s AND status IN ('queued','planning','running','awaiting_approval')""",
       (run_id,))
    return JSONResponse({"ok": True})

@app.post("/approvals/{approval_id}/decide")
async def decide_approval(approval_id: int, req: DecideReq) -> JSONResponse:
    rows = q("""UPDATE agent_approvals SET status=%s, decided_by=%s, decided_at=now()
                WHERE id=%s AND status='pending' RETURNING run_id""",
             ("approved" if req.approved else "denied", req.decided_by, approval_id))
    if not rows:
        raise HTTPException(404, "approval not found or already decided")
    run_id = rows[0]["run_id"]
    if req.approved:
        qx("UPDATE agent_runs SET status='queued', updated_at=now() WHERE id=%s", (run_id,))
    else:
        qx("""UPDATE agent_runs SET status='failed', error='approval denied',
              finished_at=now(), updated_at=now() WHERE id=%s""", (run_id,))
    return JSONResponse({"ok": True, "run_id": run_id})

@app.on_event("startup")
async def _startup() -> None:
    _init_db()
    asyncio.create_task(runner(), name="agents-runner")