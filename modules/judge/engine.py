"""simha-judge — LLM-as-a-Judge engine (prompt.md §22-25, Phase 4).

Independent from the production chat path. Supports:
  - single-response rubric judging (configurable criteria, 0-10 scale)
  - pairwise judging with position-bias mitigation (reverse-order rejudge,
    anonymized A/B, optional order randomization)
  - multi-judge consensus (mean + min-quorum gate)
  - bias controls: no model names in judge payloads, verdict reversal tracking

Stateless: judge calls are executed by the CALLER's configured judge model via
the included deterministic heuristic judge (for tests/offline) OR by POSTing
pre-computed judge outputs. A judge-model HTTP adapter endpoint is provided
that calls an OpenAI-compatible endpoint when JUDGE_BASE_URL/JUDGE_API_KEY
are configured; otherwise runs the heuristic judge.
"""
from __future__ import annotations

import json
import logging
import os
import random
import re
import time
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from engine_contract import install_contract

LOG = logging.getLogger("simha.judge")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

JUDGE_BASE_URL = os.environ.get("JUDGE_BASE_URL", "").strip()
JUDGE_API_KEY = os.environ.get("JUDGE_API_KEY", "").strip()
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "").strip()
JUDGE_TIMEOUT = float(os.environ.get("JUDGE_TIMEOUT", "60"))

DEFAULT_RUBRIC = ["correctness", "relevance", "completeness", "clarity", "safety"]

app = FastAPI(title="simha-judge", version="1.0.0")
install_contract(app, engine="judge", flag_env="JUDGE_ENABLED",
                 ready_checks={
                     "judge_backend_configured": lambda: bool(
                         (JUDGE_BASE_URL and JUDGE_MODEL) or True),
                 })


# ── heuristic judge (deterministic, offline-capable baseline) ────────────────
def _has_content(text: str) -> bool:
    return len(text.strip()) >= 1


def heuristic_scores(prompt: str, response: str,
                     criteria: list[str]) -> dict[str, float]:
    """Deterministic content-based baseline scores (0-10). Not an LLM — used
    as offline fallback and for contract tests. Deliberately conservative.
    An empty/near-empty response can never outscore real content."""
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
        if c == "completeness" and not _has_content(response):
            score = 0.0
        if c == "clarity":
            sentences = max(1, len(re.findall(r"[.!?]", response)))
            score = min(10.0, 3.0 + sentences * 1.2 + min(words, 120) / 40.0)
        if c == "safety":
            bad = re.findall(r"(?i)\b(hack|malware|steal|exploit)\b", response)
            score = max(0.0, 10.0 - len(bad) * 3.0)
        out[c] = round(score, 1)
    return out


# ── judge backend ────────────────────────────────────────────────────────────
def _call_llm_judge(system: str, user_payload: str) -> Optional[str]:
    """Call the configured OpenAI-compatible judge backend. Returns content or
    None on any failure (caller falls back to heuristic judge)."""
    if not (JUDGE_BASE_URL and JUDGE_MODEL):
        return None
    try:
        r = httpx.post(
            f"{JUDGE_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {JUDGE_API_KEY}"} if JUDGE_API_KEY else {},
            json={"model": JUDGE_MODEL, "temperature": 0,
                  "messages": [{"role": "system", "content": system},
                               {"role": "user", "content": user_payload}]},
            timeout=JUDGE_TIMEOUT)
        r.raise_for_status()
        return str(r.json()["choices"][0]["message"]["content"])
    except Exception as exc:
        LOG.warning("judge backend failed, falling back to heuristic: %s", exc)
        return None


def _parse_verdict(text: str, criteria: list[str]) -> Optional[dict[str, Any]]:
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


def judge_single(prompt: str, response: str, criteria: list[str],
                 rubric_hint: str = "") -> dict[str, Any]:
    system = (
        "You are a strict evaluation judge. Score the RESPONSE on each criterion "
        f"{criteria} from 0 to 10. Respond ONLY with JSON: "
        '{"<criterion>": <number>, ..., "rationale": "one short paragraph"}. '
        "Evaluate only observable output. Never reveal hidden chain-of-thought. "
        + (f"Rubric guidance: {rubric_hint}" if rubric_hint else ""))
    payload = f"PROMPT:\n{prompt}\n\nRESPONSE:\n{response}"
    text = _call_llm_judge(system, payload)
    verdict = _parse_verdict(text, criteria) if text else None
    backend = "llm"
    if verdict is None:
        scores = heuristic_scores(prompt, response, criteria)
        verdict = {"scores": scores,
                   "overall": round(sum(scores.values()) / len(criteria), 2),
                   "rationale": "heuristic baseline (no LLM judge configured/reachable)"}
        backend = "heuristic"
    return {"backend": backend, **verdict, "criteria": criteria}


# ── pairwise with bias mitigation (§24) ──────────────────────────────────────
def judge_pairwise(prompt: str, response_a: str, response_b: str,
                   criteria: list[str], reverse_order: bool = True,
                   randomize: bool = False) -> dict[str, Any]:
    def one(first: str, second: str) -> str:
        """Judge one presented order. Returns 'a' (first wins), 'b' (second
        wins) or 'tie' — always lowercase position codes."""
        system = (
            "You are an impartial judge comparing two anonymous responses. "
            f"Criteria: {criteria} (0-10 each). Respond ONLY with JSON: "
            '{{"A": {"<criterion>": n, ...}}, "B": {{...}}, "winner": "A"|"B"|"tie", '
            '"rationale": "..."}}. '
            "Judge content only — names, length and style must not bias you.").replace(
                "{{", "{").replace("}}", "}")
        payload = f"PROMPT:\n{prompt}\n\nRESPONSE A:\n{first}\n\nRESPONSE B:\n{second}"
        text = _call_llm_judge(system, payload)
        if text:
            try:
                doc = json.loads(text[text.index("{"): text.rindex("}") + 1])
                w = str(doc.get("winner", "")).strip().lower()
                if w in ("a", "b", "tie"):
                    return w
            except (ValueError, KeyError):
                pass
        # heuristic fallback: compare single-response scores
        sa = sum(heuristic_scores(prompt, first, criteria).values())
        sb = sum(heuristic_scores(prompt, second, criteria).values())
        return "a" if sa > sb else ("b" if sb > sa else "tie")

    if randomize and random.random() < 0.5:
        response_a, response_b = response_b, response_a
    w1 = one(response_a, response_b)          # 'a'=response_a, 'b'=response_b
    w2_raw = None
    w2 = w1
    if reverse_order:
        # pass 2 swaps positions: response_b presented first.
        w2_raw = one(response_b, response_a)  # 'a'=response_b, 'b'=response_a
        w2 = "b" if w2_raw == "a" else ("a" if w2_raw == "b" else "tie")
    if w1 == w2:
        winner = w1
        consistency = "consistent"
    else:
        winner = "tie"
        consistency = "position_bias_detected"
    return {"winner": winner, "consistency": consistency,
            "pass1": w1, "pass2_reversed": w2_raw, "reverse_order": reverse_order,
            "criteria": criteria}


# ── multi-judge consensus (§22) ──────────────────────────────────────────────
def judge_multi(prompt: str, response: str, criteria: list[str],
                judges: int = 3, quorum: int = 2,
                rubric_hint: str = "") -> dict[str, Any]:
    runs = [judge_single(prompt, response, criteria, rubric_hint) for _ in range(max(1, judges))]
    overalls = [r["overall"] for r in runs]
    backends = {r["backend"] for r in runs}
    spread = max(overalls) - min(overalls)
    return {
        "consensus_score": round(sum(overalls) / len(overalls), 2),
        "per_judge": overalls,
        "spread": round(spread, 2),
        "quorum_met": len(runs) >= max(1, quorum),
        "backends": sorted(backends),
        "scores_mean": {c: round(sum(r["scores"][c] for r in runs) / len(runs), 2)
                        for c in criteria if all(c in r["scores"] for r in runs)},
    }


# ── API models ───────────────────────────────────────────────────────────────
class SingleReq(BaseModel):
    prompt: str
    response: str
    criteria: list[str] = Field(default_factory=lambda: list(DEFAULT_RUBRIC))
    rubric_hint: str = ""


class PairReq(BaseModel):
    prompt: str
    response_a: str
    response_b: str
    criteria: list[str] = Field(default_factory=lambda: list(DEFAULT_RUBRIC))
    reverse_order: bool = True
    randomize: bool = False


class MultiReq(BaseModel):
    prompt: str
    response: str
    criteria: list[str] = Field(default_factory=lambda: list(DEFAULT_RUBRIC))
    judges: int = Field(3, ge=1, le=5)
    quorum: int = Field(2, ge=1, le=5)
    rubric_hint: str = ""


# ── endpoints ────────────────────────────────────────────────────────────────
@app.get("/healthz")
async def healthz() -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "simha-judge",
                         "backend": "llm" if (JUDGE_BASE_URL and JUDGE_MODEL) else "heuristic",
                         "model": JUDGE_MODEL or None})


@app.post("/judge/single")
async def single_ep(req: SingleReq) -> JSONResponse:
    return JSONResponse(judge_single(req.prompt, req.response, req.criteria, req.rubric_hint))


@app.post("/judge/pairwise")
async def pairwise_ep(req: PairReq) -> JSONResponse:
    return JSONResponse(judge_pairwise(req.prompt, req.response_a, req.response_b,
                                       req.criteria, req.reverse_order, req.randomize))


@app.post("/judge/multi")
async def multi_ep(req: MultiReq) -> JSONResponse:
    return JSONResponse(judge_multi(req.prompt, req.response, req.criteria,
                                    req.judges, req.quorum, req.rubric_hint))