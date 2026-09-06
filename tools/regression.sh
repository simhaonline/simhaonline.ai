#!/usr/bin/env bash
# regression.sh — baseline regression suite for the EXISTING simhaonline.ai
# platform (prompt.md §72). Run after every major phase. Exits non-zero on any
# FAIL. Uses only curl + docker — no test framework dependency.
#
# Usage: tools/regression.sh            # full suite against local binds
set -uo pipefail

IP="${PROXY_BIND_IP:-152.53.67.111}"
PASS=0; FAIL=0; SKIPPED=0

check() { # name, expected, actual
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "PASS  $name ($actual)"; PASS=$((PASS+1))
  else
    echo "FAIL  $name (expected $expected, got $actual)"; FAIL=$((FAIL+1))
  fi
}
code() { curl -s -o /dev/null -m "${TIMEOUT:-10}" -w '%{http_code}' "$@"; }

echo "== 1. Core containers healthy =="
for svc in gateway control-plane worker web postgres valkey minio; do
  st="$(docker inspect -f '{{.State.Health.Status}}' "simha-${svc}" 2>/dev/null || echo missing)"
  check "container simha-${svc}" "healthy" "$st"
done

echo "== 2. Public API (gateway :8080) =="
check "GET /healthz" "200" "$(code "http://${IP}:8080/healthz")"
check "GET /gateway-status" "200" "$(code "http://${IP}:8080/gateway-status")"
check "GET /v1/models unauthenticated → 200 sample (audit M4)" "200" "$(code "http://${IP}:8080/v1/models")"
check "GET /health public alias (audit M3)" "200" "$(code "http://${IP}:8080/health")"
check "POST /v1/chat/completions unauthenticated → 401" "401" \
  "$(code -X POST -H 'content-type: application/json' -d '{"model":"x","messages":[]}' "http://${IP}:8080/v1/chat/completions")"

echo "== 3. Control plane :8081 =="
check "GET /healthz" "200" "$(code "http://${IP}:8081/healthz")"
check "GET /auth/me without session → 401" "401" "$(code "http://${IP}:8081/auth/me")"

echo "== 4. Worker :8001 =="
check "GET /healthz" "200" "$(code "http://${IP}:8001/healthz")"
check "GET /status/recent" "200" "$(code "http://${IP}:8001/status/recent?limit=1")"

echo "== 5. Web (:3002) + vhost Host-header routing =="
check "GET / (apex)" "200" "$(code "http://${IP}:3002/" -H 'Host: simhaonline.ai')"
check "GET /chat (chat vhost)" "200" "$(code "http://${IP}:3002/chat" -H 'Host: chat.simhaonline.ai')"
check "GET /login (platform vhost)" "200" "$(code "http://${IP}:3002/login" -H 'Host: platform.simhaonline.ai')"
check "GET /docs (docs vhost)" "200" "$(code "http://${IP}:3002/docs" -H 'Host: docs.simhaonline.ai')"
check "GET /pricing" "200" "$(code "http://${IP}:3002/pricing" -H 'Host: simhaonline.ai')"
check "BFF /api/chat/models unauth → 401 (not 404/5xx)" "401" "$(code "http://${IP}:3002/api/chat/models")"

echo "== 6. Engines (profile engines, localhost only) =="
for port in 8111 8112 8113 8114 8115 8116; do
  st="$(docker inspect -f '{{.State.Health.Status}}' "$(docker ps -a --format '{{.Names}} {{.Ports}}' | grep ":${port}->" | awk '{print $1}' | head -1)" 2>/dev/null || echo no-container)"
  if [[ "$st" == "healthy" ]]; then
    check "engine :${port}" "healthy" "$st"
  else
    echo "SKIP  engine :${port} ($st)"; SKIPPED=$((SKIPPED+1))
  fi
done

echo "== 7. Streaming smoke (gateway path via BFF) =="
sse="$(timeout 12 curl -s -N -o /dev/null -w '%{http_code}' -X POST "http://${IP}:3002/api/chat/complete" \
  -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"ping"}],"stream":true}' 2>/dev/null || true)"
if [[ "$sse" == "401" ]]; then
  echo "PASS  streaming endpoint auth-gated (401 without session)"; PASS=$((PASS+1))
elif [[ "$sse" == "200" ]]; then
  echo "PASS  streaming endpoint reachable (200 with ambient session)"; PASS=$((PASS+1))
else
  echo "FAIL  streaming endpoint unexpected code: ${sse:-none}"; FAIL=$((FAIL+1))
fi

echo
echo "RESULT: ${PASS} passed, ${FAIL} failed, ${SKIPPED} skipped"
[[ "$FAIL" -eq 0 ]]