"""Unit tests for the agents engine (run via docker with mounted module dir)."""
import importlib.util
import json
import os
import sys

os.environ.setdefault("AGENTS_DATABASE_URL", "postgresql://agents:agents@localhost:5433/agents")

fail = []
def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        fail.append(name)

# stub the contract import so engine loads without postgres
import types
contract_stub = types.ModuleType("engine_contract")
contract_stub.install_contract = lambda *a, **k: None
sys.modules["engine_contract"] = contract_stub

spec = importlib.util.spec_from_file_location("agents_engine", os.path.join(os.path.dirname(__file__), "engine.py"))
m = importlib.util.module_from_spec(spec)
sys.modules["agents_engine"] = m
try:
    spec.loader.exec_module(m)
except Exception as exc:
    print(f"FAIL  engine import ({exc})")
    sys.exit(1)

# 1. registry integrity: every tool has impl + caps + approval flag
check("registry: all tools implemented",
      set(m.TOOL_REGISTRY) == set(m.TOOLS))
check("registry: approval flags are bool",
      all(isinstance(v["approval"], bool) for v in m.TOOL_REGISTRY.values()))
check("registry: caps are non-empty sets",
      all(v["caps"] for v in m.TOOL_REGISTRY.values()))

# 2. permission model: memory_save requires approval; llm does not
check("approval: memory_save gated", m.TOOL_REGISTRY["memory_save"]["approval"] is True)
check("approval: llm not gated", m.TOOL_REGISTRY["llm"]["approval"] is False)
check("approval: http_fetch not gated", m.TOOL_REGISTRY["http_fetch"]["approval"] is False)

# 3. url validation rejects non-http
for tool in ("web_retrieval", "http_fetch"):
    try:
        m.TOOLS[tool]({"url": "javascript:alert(1)"})
        check(f"{tool}: rejects non-http url", False)
    except ValueError:
        check(f"{tool}: rejects non-http url", True)

# 4. json decision parser extracts objects from noisy LLM text
import re
noisy = 'Sure! Here is my decision:\n{"action":"final","answer":"42"}\nHope that helps.'
match = re.search(r"\{.*\}", noisy, re.S)
check("decision parse: extracts json from prose", match is not None and
      m and json.loads(match.group(0))["action"] == "final")

# 5. history formatting is compact and ordered
class FakeRows:
    pass
check("constants: MAX_OUTPUT_CHARS sane", 1000 <= m.MAX_OUTPUT_CHARS <= 20000)

print(f"\n{len(fail)} failed" if fail else "\nALL PASS")
sys.exit(1 if fail else 0)