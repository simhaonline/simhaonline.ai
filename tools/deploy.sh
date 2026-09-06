#!/usr/bin/env bash
# deploy.sh — clean, traceable deploys for simhaonline.ai.
#
# Every deploy:
#   1. builds all app images from the CURRENT commit (no stale layers reused
#      silently — cache only from layers that genuinely match),
#   2. tags each image with the git SHA (sha-tagged) AND :latest,
#   3. recreates containers on the sha-tagged images,
#   4. deletes the OLD images (untagged leftovers + previous shas) so the
#      image list only ever holds the images that are actually running.
#
# Result: `docker images | grep simhaonline` is always a clean,
# provenance-clear table — one latest + one sha-tagged per service,
# all matching the deployed commit.
#
# Usage:
#   tools/deploy.sh              # build + recreate + prune
#   tools/deploy.sh gateway      # one service only
#   tools/deploy.sh --no-prune   # keep old images (debugging)
set -euo pipefail

cd "$(dirname "$0")/.."

SHA="$(git rev-parse --short=12 HEAD)"
SERVICES=(gateway control-plane worker web)
PRUNE=1
TARGETS="${SERVICES[*]}"

if [[ "${1:-}" == "--no-prune" ]]; then
  PRUNE=0
  shift
fi
if [[ $# -gt 0 ]]; then
  TARGETS="$*"
fi

echo "==> Deploying commit ${SHA} — services: ${TARGETS}"

for svc in ${TARGETS}; do
  echo "==> Building ${svc} (${SHA})"
  docker compose build "${svc}"
  docker tag "simhaonline-${svc}:latest" "simhaonline-${svc}:${SHA}"
done

echo "==> Recreating containers on ${SHA} images"
for svc in ${TARGETS}; do
  docker compose up -d --no-deps "${svc}"
done

echo "==> Health gates"
for svc in ${TARGETS}; do
  name="simha-${svc}"
  for _ in $(seq 1 30); do
    st="$(docker inspect -f '{{.State.Health.Status}}' "${name}" 2>/dev/null || echo missing)"
    [[ "${st}" == "healthy" ]] && break
    sleep 2
  done
  st="$(docker inspect -f '{{.State.Health.Status}}' "${name}" 2>/dev/null || echo missing)"
  echo "    ${name}: ${st}"
  if [[ "${st}" != "healthy" ]]; then
    echo "!! ${name} not healthy — dumping last logs"
    docker logs --tail 30 "${name}" 2>&1
    exit 1
  fi
done

if [[ "${PRUNE}" == "1" ]]; then
  echo "==> Removing old images (untagged leftovers + previous shas)"
  docker image prune -f >/dev/null                        # untagged/dangling
  for svc in ${SERVICES}; do
    # old shas other than current + latest
    old="$(docker images --format '{{.Tag}}' "simhaonline-${svc}" | grep -Ev "^(latest|${SHA})$" || true)"
    if [[ -n "${old}" ]]; then
      echo "${old}" | while read -r t; do docker rmi "simhaonline-${svc}:${t}" || true; done
    fi
  done
fi

echo "==> Current simhaonline images (should show only latest + ${SHA})"
docker images --format '{{.Repository}}:{{.Tag}}  {{.Size}}' simhaonline-* | sort
echo "==> Running containers"
docker compose ps