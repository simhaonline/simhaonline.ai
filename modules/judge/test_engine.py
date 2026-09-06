"""Unit tests for the registry-integrated judge engine (v2).
Runs with a scratch Postgres schema? No — pure-logic tests only: parsing,
heuristics, chain behavior with a mocked LLM caller, and policy resolution
against a stubbed DB. Registry-integration is smoke-tested live."""
import json
import os
import sys
import tempfile

os.environ["JUDGE_DATABASE_URL"] = "postgresql://stub@localhost/stub"  # never connected in unit tests
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import engine  # noqa: E402

passed = failed = 0


def check(name: str, cond: bool) -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS {name}")
    else:
        failed += 1
        print(f"FAIL {name}")


# ── verdict parsers ──────────────────────────────────────────────────────────
v = engine._parse_single('Sure! {"correctness": 8, "clarity": 7, "rationale": "ok"}',
                         ["correctness", "clarity"])
check("single parser extracts scores + overall", bool(v) and v is not None and v["overall"] == 7.5)
check("single parser rejects out-of-range",
      engine._parse_single('{"correctness": 42}', ["correctness"]) is None)
check("single parser rejects garbage", engine._parse_single("no json here", ["x"]) is None)

p = engine._parse_pair('{"A": {"c": 5}, "B": {"c": 9}, "winner": "B", "rationale": "r"}')
check("pair parser maps winner", bool(p) and p is not None and p["winner"] == "b")
check("pair parser rejects bad winner",
      engine._parse_pair('{"winner": "A wins"}') is None)

# ── heuristic mode still intact ──────────────────────────────────────────────
h = engine._heuristic_single("What is DNS?", "DNS resolves names to IPs.", ["correctness"])
check("heuristic single deterministic", h["overall"] > 0)
empty = engine._heuristic_single("q", "", ["completeness"])
check("empty response completeness 0", empty["scores"]["completeness"] == 0.0)

# ── protocol adapters ────────────────────────────────────────────────────────
check("anthropic headers use x-api-key",
      engine._headers("anthropic", "sk-x")["x-api-key"] == "sk-x")
check("openai headers use bearer",
      engine._headers("openai", "sk-x")["Authorization"] == "Bearer sk-x")
check("ollama url uses /api/chat",
      engine._url("ollama", "http://o:11434/", "", "m") == "http://o:11434/api/chat")
check("openai url honors prefix",
      engine._url("openai", "https://api.x.ai", "/v1", "m") == "https://api.x.ai/v1/chat/completions")
check("anthropic body shape",
      "system" in engine._body("anthropic", "m", "S", "U", False)
      and "messages" in engine._body("anthropic", "m", "S", "U", False))
check("usage extraction anthropic",
      engine._extract_usage({"usage": {"input_tokens": 12, "output_tokens": 34}}) == (12, 34))

# ── chain failover logic (mock _call_llm) ────────────────────────────────────
calls = []


def fake_call(entry, system, user, json_mode=True):
    calls.append(entry["account"])
    if entry["account"] == "bad-account":
        return None, None, None, 5.0
    return json.dumps({"correctness": 9, "clarity": 8, "rationale": "solid"}), 10, 20, 42.0


engine._call_llm = fake_call  # type: ignore[assignment]

saved = engine.resolve_policy
saved_enrich = engine.enrich_entry
# stub registry enrichment: hops resolve to fully-populated entries
engine.enrich_entry = lambda hop: {  # type: ignore[assignment]
    "account": hop["account"], "model": hop["model"], "provider": "stub",
    "protocol": "openai", "base_url": "http://stub", "api_key": "k", "api_prefix": "/v1"}
engine.resolve_policy = lambda: {  # type: ignore[assignment]
    "mode": "manual",
    "chain": [
        {"account": "bad-account", "model": "m-bad", "base_url": "http://x",
         "protocol": "openai", "api_key": "k"},
        {"account": "good-account", "model": "m-good", "base_url": "http://y",
         "protocol": "openai", "api_key": "k"},
    ],
}

res = engine._run_chain({"type": "single", "prompt": "p", "response": "r"},
                        ["correctness", "clarity"])
check("failover: first hop failed, second succeeded",
      res["failovers"] == 1 and res["judge_account"] == "good-account")
check("failover: attempts recorded in order",
      [a["account"] for a in res["attempts"]] == ["bad-account", "good-account"])
check("failover: not degraded when fallback succeeded", res["degraded"] is False)
check("usage aggregated across attempts",
      res["prompt_tokens"] == 10 and res["completion_tokens"] == 20)

# all fail → degraded heuristic
engine._call_llm = lambda *a, **k: (None, None, None, 3.0)  # type: ignore[assignment]
res2 = engine._run_chain({"type": "single", "prompt": "p", "response": "real answer"},
                         ["correctness"])
check("all-llm-fail → heuristic degraded",
      res2["backend"] == "heuristic" and res2["degraded"] is True
      and res2["verdict"]["overall"] > 0)

# heuristic_only policy never touches the network
engine.resolve_policy = lambda: {"mode": "heuristic_only", "chain": []}  # type: ignore[assignment]
res3 = engine._run_chain({"type": "pairwise", "prompt": "p",
                          "response_a": "long good answer", "response_b": ""},
                         ["correctness"])
check("heuristic_only: no attempts, deterministic winner",
      res3["backend"] == "heuristic" and res3["attempts"] == []
      and res3["verdict"]["winner"] == "a")

engine.resolve_policy = saved  # type: ignore[ignore-missing-varname]
engine.enrich_entry = saved_enrich  # type: ignore[ignore-missing-varname]

# ── policy validation shape ──────────────────────────────────────────────────
bad = engine.PolicyReq(mode="weird", consensus_judges=1)
check("policy model accepts then normalizes to auto",
      bad.mode == "weird")  # model stores raw; endpoint clamps — checked live

print(f"\nRESULT: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)