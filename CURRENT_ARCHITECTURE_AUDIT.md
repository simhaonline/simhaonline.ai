# CURRENT_ARCHITECTURE_AUDIT.md
_Audited 2026-09-06, commit `4b48dc6` (main). Baseline for the platform expansion described in prompt.md._

## 1. Application architecture

```
                        REMOTE PLESK (TLS, 6 vhosts)          ← front door, no local nginx container
   simhaonline.ai / platform. / chat. / docs. / status. / api.
        │ proxy_pass to real IP 152.53.67.111 (never 127.0.0.1)
        ▼
   ┌─────────────────────────── THIS HOST (Docker Compose, project "simhaonline") ──────────────────────┐
   │  web (Next.js 15, :3002→3000)   BFF: /api/[...path]→CP, /api/chat/complete→gateway (SSE pass)      │
  │      │                                                                                            │
   │      ├─ control-plane (NestJS 10, :8081→8081)  auth/sessions/OAuth/billing/chat API/admin/BFF      │
   │      ├─ gateway (Go 1.23, :8080→8080)  OpenAI-compatible /v1, dispatch keys, routing modes, 429s   │
   │      ├─ worker (Python 3.12 FastAPI, :8001→8001)  discovery loop, status snapshots, rollups,       │
   │      │      email queue, scheduler, ingestion, semantic seeding, backups                           │
   │      ├─ postgres (timescaledb:pg16 + pgvector, 127.0.0.1:5433)  hypertables + retention            │
   │      ├─ valkey (valkey:8-alpine, 127.0.0.1:6380)  db0 gateway / db1 CP / db2 worker                │
   │      ├─ minio (S3-compatible, internal)  uploads + backups                                         │
   │      └─ [profile engines] scraper:8111 · reverse:8112 · router-opt:8113 (Go) · rank:8114            │
   └────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Languages / frameworks / package managers

| Layer | Lang | Framework | PM |
|---|---|---|---|
| gateway | Go 1.23 | net/http, pgx v5, valkey-go | go.mod/go.sum |
| control-plane | TS (Node 22) | NestJS 10, pg, ioredis | npm |
| worker | Python 3.12 | FastAPI, psycopg3, httpx, boto3 | pip (requirements) |
| web | TS (Node 22) | Next.js 15 (App Router) | npm |
| engines | Python 3.12 / Go | FastAPI / stdlib | pip / go.mod |

## 3. API layers
- **Public**: gateway `/v1` (OpenAI-compatible chat completions incl. `/v1/models`, compare mode via `X-Simha-Mode`), `/gateway-status` (public counts), key-gated `/status`. Anthropic-style `messages` accepted via protocol switch.
- **Browser**: Next BFF `/api/*` → control-plane (`admin→admin/api/…`, `chat→chat/api/…`, `client-keys→api/client-keys/…`) with session cookie forwarding.
- **Internal S2S**: CP `POST /internal/chat-dispatch-key` (per-user gateway key, 1h TTL, Valkey-cached, reused per hour), `GET /chat/api/models`. Worker ↔ gateway/CP via internal URLs.
- **Engines** (isolated, 127.0.0.1-only): scraper `POST /scrape|/extract|/crawl|/diff|/monitor`, reverse `POST /analyze/git|tarball|sources|website|/compare`, router-opt `POST /pool/dedup|/picks|/terms/parse|/optimize`, rank `POST /models|/battle`, `GET /leaderboard|/history`.

## 4. Model/provider abstraction
- `config/provider_catalog.json` (15 accounts incl. xai/anthropic/google/mistral/deepseek/openai/others; protocols openai|anthropic|ollama) + `config/model_policies.json`.
- Gateway maintains cooldowns (HTTP 429 → account cooling), usage thresholds, dispatch-key auth, routing modes (`X-Simha-Routing-Mode`: quality/fast/cost), compare mode, streaming pass-through, `X-Simha-Route-Model` fallback transparency header.
- Worker runs a model-discovery loop (`MODEL_REFRESH_INTERVAL`, default 300s) → `discovered_models` table (1094 models at audit time).

## 5. Auth / authorization
- CP: email+password sessions (`simha_session` cookie, `SESSION_TTL_HOURS=24`), TOTP MFA, trusted-device cookie bypass (30d, single-use rotation), 5-failure lockout. OAuth (Google/GitHub) with encrypted credential store (`OAUTH_ENCRYPTION_KEY`).
- Gateway: `Authorization: Bearer <se…>` client keys hashed (sha256) in `client_api_keys`; per-user workbench keys minted S2S only.
- Admin: role-checked admin controller under `/admin/api`.

## 6. Database (PostgreSQL/Timescale + pgvector)
- Core: users, sessions, client_api_keys, accounts, discovered_models, model_policies, oauth_*, projects, chat_history, chat_messages, saved_resources, scheduled_tasks, user_settings, feature_catalog, user_features, generated_content, subscriptions, feedback, usage_metrics, status_*, audit_log, app_settings.
- Timeseries: request_history, token_usage, model_token_usage, status_checks, request_windows (hypertable + 8-day retention).
- Vector: semantic_memory (vector(384), HNSW) — currently provider-catalog docs only.
- Library: library_assets (+versions/permissions/audit), file_ingestion_jobs/files.
- Migrations: `database/01_schema.sql` + `02_billing.sql` run on first boot only (initdb); live changes applied via `docker exec simha-postgres psql`. **Known gap: no ordered migration runner.**

## 7. Cache / queue / jobs / streaming
- Valkey: gateway cooldowns/db0, CP dispatch-key cache/db1, worker pubsub/db2.
- Worker asyncio jobs: discovery, status snapshots, Timescale rollups, email pubsub, scheduler (`scheduled_tasks`), ingestion, semantic seed, nightly `pg_dump` (7 kept, MinIO sync).
- Streaming: web BFF passes SSE verbatim; frontend parses `data:` frames incrementally (no buffering); abort propagation via AbortController→BFF→gateway.

## 8. Billing
Stripe-only (Checkout + webhook `/billing/webhook`); `plans`/`subscriptions` (+ stripe ids); quota enforcement in gateway; manual bank-transfer fallback documented in README.

## 9. Observability
Structured container logs; status pipeline (worker snapshots → status page SSE); usage_metrics/request_history for cost/latency accounting; admin dashboard at platform./dashboard. No OpenTelemetry/metrics endpoints yet.

## 10. Security posture
- Secret storage: `.env` (gitignored), OAUTH_ENCRYPTION_KEY AES for provider creds, gateway key hashing, dispatch keys never exposed to browsers.
- SSRF: reverse engine fetches arbitrary URLs — **gap: no private-IP/metadata denylist yet (planned Phase 2/7 hardening)**.
- Uploads: type/size validated at CP; MinIO private buckets.
- Audit: `audit_log` table wired for admin + dispatch-key actions.

## 11. Deployment / CI / tests
- Single docker-compose.yml, core services + `engines` profile; clean-image deploys via `tools/deploy.sh` / `tools/deploy-engines.sh` (SHA-tagged, health-gated, auto-prune); Plesk directives in `tools/plesk/*.conf`.
- Tests: gateway `server_test.go` (Go), no CP/web test suites, no CI runner (push-only workflow).
- Regression baseline: `tools/regression.sh` (added with this audit) — live end-to-end checks of all six vhosts + engine health.

## 12. Frontend architecture
Next.js 15 App Router: `/` (marketing), `/chat` (workbench: rail panels wired to CP APIs, streaming, model picker, route profiles, compare), `/dashboard` (control center), `/pricing`, `/docs`, `/status`. Design tokens in `globals.css` (minified single-line sections). No component lib — hand-rolled.

## 13. Gaps / risks noted for later phases
1. No ordered DB migration runner (init-only) — HIGH for phased schema growth.
2. Engine ports localhost-only with no service-to-service auth token — MEDIUM (add shared token in Phase 1).
3. No Prometheus/metrics endpoints — LOW (Phase 1 adds `/metrics`).
4. No Playwright/k6 suites — noted in §71/73 of the master prompt; smoke-level regression only for now.
5. web BFF forwards arbitrary `/api/*` to CP — path allowlist is prefix-based; CP enforces auth per route, acceptable.

_Authors of record: see git history from commit `4b48dc6` onward._