#!/usr/bin/env bash
# deploy-engines.sh — clean, traceable deploys for the isolated engines
# (scraper / reverse / router-opt / rank). Mirrors tools/deploy.sh but targets
# only the engines compose profile and never touches core services.
#
# Usage:
#   tools/deploy-engines.sh             # all four engines
#   tools/deploy-engines.sh rank        # one engine only
#   tools/deploy-engines.sh --no-prune  # keep old images (debugging)
set -euo pipefail

cd "$(dirname "$0")/.."

SHA="$(git rev-parse --short=12 HEAD)"
ENGINES=(scraper reverse router-opt rank discovery judge)
PRUNE=1
TARGETS="${ENGINES[*]}"

if [[ "${1:-}" == "--no-prune" ]]; then
  PRUNE=0
  shift
fi
if [[ $# -gt 0 ]]; then
  TARGETS="$*"
fi

echo "==> Deploying engines from commit ${SHA} — targets: ${TARGETS}"

for svc in ${TARGETS}; do
  echo "==> Building ${svc}"
  docker compose build "${svc}"
  docker tag "simhaonline-${svc}:latest" "simhaonline-${svc}:${SHA}"
done

echo "==> Recreating containers on ${SHA} images"
# profile flag is required or compose ignores engine services entirely
docker compose --profile engines up -d --no-deps ${TARGETS}

echo "==> Health gates"
fail=0
for svc in ${TARGETS}; do
  name="simha-${svc}"
  ok=0
  for _ in $(seq 1 30); do
    st="$(docker inspect -f '{{.State.Health.Status}}' "${name}" 2>/dev/null || echo missing)"
    if [[ "${st}" == "healthy" ]]; then ok=1; break; fi
    sleep 2
  done
  st="$(docker inspect -f '{{.State.Health.Status}}' "${name}" 2>/dev/null || echo missing)"
  echo "    ${name}: ${st}"
  if [[ "${ok}" != "1" ]]; then
    echo "!! ${name} not healthy — last logs:"
    docker logs --tail 30 "${name}" 2>&1
    fail=1
  fi
done
if [[ "${fail}" == "1" ]]; then
  exit 1
fi

if [[ "${PRUNE}" == "1" ]]; then
  echo "==> Removing old engine images (untagged leftovers + previous shas)"
  docker image prune -f >/dev/null
  for svc in ${ENGINES}; do
    old="$(docker images --format '{{.Tag}}' "simhaonline-${svc}" | grep -Ev "^(latest|${SHA})$" || true)"
    if [[ -n "${old}" ]]; then
      echo "${old}" | while read -r t; do docker rmi "simhaonline-${svc}:${t}" || true; done
    fi
  done
fi

echo "==> Engine images (should show only latest + ${SHA})"
for svc in ${ENGINES}; do
  docker images --format '{{.Repository}}:{{.Tag}}  {{.Size}}' "simhaonline-${svc}"
done | sort
echo "==> Engine containers"
docker compose --profile engines ps