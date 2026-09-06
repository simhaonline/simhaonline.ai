# SIMHA_UPGRADE_REPORT.md
_2026-09-06 — expansion per prompt.md, executed in phases on top of commit `4b48dc6`._

## A. Existing architecture discovered

Full audit in `CURRENT_ARCHITECTURE_AUDIT.md` (Phase 0). Summary: Next.js 15 web + NestJS control-plane + Go 1.23 gateway + Python worker + Timescale/pg16 + pgvector + Valkey + MinIO, deployed by Docker Compose behind a remote Plesk TLS proxy; four isolated engines (scraper/reverse/router-opt/rank) on the `engines` compose profile, 127.0.0.1-only.

## B. Problems found

| Severity | Problem | Disposition |
|---|---|---|
| HIGH | No baseline regression suite existed — changes could silently break the six-vhost production surface | Fixed: `tools/regression.sh` (30 checks) |
| HIGH | No architecture audit doc existed before expansion work | Fixed: CURRENT_ARCHITECTURE_AUDIT.md |
| MEDIUM | Engines lacked /health/live, /health/ready, /metrics, feature flags, service-token option | Fixed in Phase 1 (all 6 engines) |
| MEDIUM | No discovery pipeline; AI-ecosystem data would go stale | Fixed: discovery engine + cycle system |
| MEDIUM | No judge/evaluation engine for the arena feedback loop (§25) | Fixed: judge engine (heuristic + LLM adapter) |
| MEDIUM | No third-party license inventory | Fixed: THIRD_PARTY_NOTICES.md |
| LOW | `heuristic judge` initial version scored empty responses above 0 | Fixed + covered by unit test |
| LOW | router-opt had no error-path metrics | Fixed (statusRecorder) |
| Noted | No ordered DB migration runner; no Playwright/k6 suites; engine token not yet set in .env | Deferred (see K/M) |

## C. Existing functionality preserved

Verified by `tools/regression.sh` after every phase — final run: **30 PASS / 0 FAIL**. No changes were made to: gateway routing/cooldowns, control-plane auth/billing/chat APIs, worker jobs, chat workbench behavior, database schema (no migration needed in this increment — engines own their state), Plesk directives, or deploy tooling. Core containers were never restarted by engine deploys.

## D. Components added

1. **`tools/regression.sh`** — baseline regression suite (containers, public API auth gates, vhost routing, engine health, streaming smoke).
2. **Platform contract (Phase 1)** — every engine now exposes `/health/live`, `/health/ready`, `/metrics` (Prometheus text), honors `<ENGINE>_ENABLED` feature flag (503 when off, contract paths exempt) and optional `ENGINE_API_TOKEN` header guard. Implemented via shared `engine_contract.py` vendored per engine + native Go guard in router-opt.
3. **Discovery engine** (`modules/discovery`, :8115, Python/FastAPI + SQLite) — Phase 2:
   - sources registry (trust levels OFFICIAL/VERIFIED/COMMUNITY/UNKNOWN/BLOCKED),
   - deterministic extractors (GitHub repo cards, MCP servers JSON, MCP README lists, generic heading indexes),
   - normalize → canonicalize → dedup (UNIQUE(canonical_name, kind)), provenance log per field,
   - job/cycle system with queued→running→completed + progress + per-source error isolation,
   - change records (§97 Pending Updates): pending → approve/reject/ignore; only official/verified sources can advance entities to `active`.
4. **Judge engine** (`modules/judge`, :8116) — Phase 4: single rubric judging, pairwise with reverse-order rejudging + position-bias detection, multi-judge consensus with quorum/spread; deterministic heuristic judge for offline/tests and OpenAI-compatible LLM adapter (`JUDGE_BASE_URL`/`JUDGE_MODEL`/`JUDGE_API_KEY`) that falls back gracefully.
5. **Docs**: this report, THIRD_PARTY_NOTICES.md, modules/README.md updated.

## E. Database migrations

None required on the core Postgres: both new engines persist in their own SQLite stores on the shared `enginesdata` volume (schema auto-created at boot, WAL mode). No destructive operations anywhere; core `database/*.sql` untouched.

## F. API additions

Engines (127.0.0.1 only): `GET /health/live|/health/ready|/metrics` on all six; discovery `POST /sources, /cycle`, `GET /sources, /jobs, /entities[/{id}], /changes`, `POST /changes/{id}/{action}, /entities/{id}/approve|reject`; judge `POST /judge/single|pairwise|multi`. Core public APIs: **zero changes** (verified by regression suite).

## G. Security improvements

- Prompt-injection scrubbing on all discovered text (`[filtered:possible-injection]` marker, §67).
- Trust-model gating: community-source entities can never auto-activate into platform-trustable state (§93/§97).
- Feature flags default ON but individually killable per engine without core impact (§69/§70); `ENGINE_API_TOKEN` ready for inter-service auth when core starts consuming engines.
- Provenance recorded per field (source_url, retrieved_at, confidence, extractor) (§94).
- No new public surface: engines remain loopback-only.

## H. Performance measurements

- Regression suite wall time: ~35s (30 checks).
- Discovery cycle: 2 sources → 55 entities ingested, cycle wall time ≈ 15-25 s (network-bound); second cycle 36 unchanged → 0 reprocessing (hash-gated by last_checked + unchanged counts).
- Judge pairwise (heuristic, no LLM): < 5 ms per pass. Contract endpoints < 5 ms.
- Router-opt untouched hot path: engine is advisory-only; no added latency to chat routing.

## I. Tests executed

| Test | Result |
|---|---|
| `tools/regression.sh` (Phase 0 baseline, 26+2skip) | PASS |
| Discovery unit suite (`test_engine.py`) — 18 checks incl. canonicalization, dedup, injection scrub, provenance, trust gates, cycle bookkeeping | PASS (18/18) |
| Judge unit suite (`test_engine.py`) — 14 checks incl. determinism, empty-response penalty, position-bias consistency, consensus math, verdict parser bounds | PASS |
| Gateway Go tests (`go test ./...` in api pkg, unchanged) | PASS (pre-existing) |
| Live discovery cycle vs real MCP registry + GitHub topic | PASS (55 entities, provenance, 0 errors after source fix) |
| Judge live smokes (single/pairwise/multi + flag-off 503 + metrics-open-while-disabled) | PASS |
| Compose config validation (core service list unchanged) | PASS |
| Regression re-run after all phases (30 checks incl. 6 engines) | PASS |

## J. Known limitations

- Judge currently runs the deterministic heuristic unless `JUDGE_BASE_URL`/`JUDGE_MODEL` are configured (documented; wire to any OpenAI-compatible endpoint).
- Discovery extractors cover GitHub lists, MCP registries (JSON + README), and generic heading indexes; HuggingFace/PyPI/npm adapters are next.
- Arena blind battles UI (§20/58) not yet built; rank engine API supports the data side.
- No OTLP exporter yet — `/metrics` is Prometheus-text only.

## K. Deployment instructions

1. `git pull && tools/deploy.sh` (core, unchanged behavior) — optional.
2. `tools/deploy-engines.sh` — builds/tags/health-gates all six engines and prunes old images.
3. Configure (optional) engine env in `.env`: `ENGINE_API_TOKEN`, `JUDGE_BASE_URL`, `JUDGE_API_KEY`, `JUDGE_MODEL`.
4. Verify: `tools/regression.sh` → expect all PASS.

## L. Rollback instructions

- Engines only: `docker compose --profile engines down` — core is unaffected by construction.
- Single engine: `docker compose --profile engines up -d --no-deps <svc>` after `git checkout <prev-sha> -- modules/<engine>`.
- Web/CP changes this report: none since `4b48dc6` beyond additive engine plumbing; core rollback = redeploy previous SHA via `tools/deploy.sh <svc>`.

## M. Recommended next steps

1. Phase 3 completion: feed `discovered_models` + `request_history` into router-opt `/optimize` from the worker (advisory dashboards).
2. Wire rank+judge into a `/arena` page (blind battles, §58).
3. Agent runtime + teams (Phase 5) as a new isolated engine consuming the same contract.
4. Migration runner for core Postgres (audit gap #1).
5. Prometheus scrape of `:8111-8116/metrics` + alert rules.