"""Unit tests for the judge engine (offline / heuristic backend)."""
import os
import sys
import tempfile

os.environ["JUDGE_BASE_URL"] = ""  # force heuristic backend
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())

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


# heuristic judge determinism
crit = ["correctness", "clarity"]
r1 = engine.judge_single("What is 2+2?", "The answer is 4.", crit)
r2 = engine.judge_single("What is 2+2?", "The answer is 4.", crit)
check("deterministic heuristic scores", r1 == r2)
check("heuristic backend flagged", r1["backend"] == "heuristic")
check("overall within 0-10", 0 <= r1["overall"] <= 10)

empty = engine.judge_single("q", "", ["completeness"])
check("empty response scores 0 completeness", empty["scores"]["completeness"] == 0.0)

longer = engine.judge_single("q", "word " * 200, ["clarity"])
short = engine.judge_single("q", "ok.", ["clarity"])
check("longer response clarity >= short", longer["scores"]["clarity"] >= short["scores"]["clarity"])

# pairwise: strong vs empty response must win consistently
res = engine.judge_pairwise("Explain gravity.", "Gravity is the attraction between masses, described by Newton and refined by Einstein's general relativity.", "", crit)
check("strong beats empty", res["winner"] == "a")
check("consistent passes (no position bias)", res["consistency"] == "consistent")

# position bias mitigation: reversed second pass must agree
res2 = engine.judge_pairwise("Explain gravity.", "", "Gravity attracts masses.", crit, reverse_order=True)
check("reversed pass keeps winner identity", res2["winner"] in ("a", "b", "tie"))
check("winner is b when a is empty", res2["winner"] == "b")

# multi-judge consensus shape
m = engine.judge_multi("q", "answer text here", ["correctness"], judges=3, quorum=2)
check("consensus score is mean of per-judge", m["consensus_score"] == round(sum(m["per_judge"]) / 3, 2))
check("quorum met", m["quorum_met"] is True)
check("spread is 0 for deterministic judge", m["spread"] == 0)

# verdict parser accepts judge JSON with noise around it
v = engine._parse_verdict('Sure! {"correctness": 8, "clarity": 7, "rationale": "ok"}', ["correctness", "clarity"])
check("parses embedded JSON verdict", bool(v) and v is not None and v["overall"] == 7.5)
check("rejects out-of-range scores", engine._parse_verdict('{"correctness": 42}', ["correctness"]) is None)

print(f"\nRESULT: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)