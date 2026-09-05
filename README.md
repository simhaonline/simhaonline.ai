# Simha Online — AI Gateway Platform

Rebuild of the Simha Edge Router (formerly `/srv/ollama-proxy`, a 3,023-line Flask monolith on SQLite)
as a polyglot production platform:

| Layer | Tech | Service | Port (internal) |
|---|---|---|---|
| Hot-path LLM router | **Golang** | `services/gateway` | 8080 |
| Control plane (auth, admin, chat APIs) | **NestJS** | `services/control-plane` | 8081 |
| Background worker (discovery, rollups, email, status) | **Python** | `services/worker` | 8082 |
| Frontend (site, chat, dashboard, docs, status) | **Next.js** | `services/web` | 3000 |
| Database | **PostgreSQL 16 + pgvector + TimescaleDB** | `database/` | 5433 (host) |
| Cache / shared state / cooldowns / rate windows | **Valkey** | — | 6380 (host) |
| Edge router | **Plesk nginx proxy** (host) | — | TLS termination, routes `/v1|healthz` → 8080, `/auth|admin|chat/api` → 8081, `/api|/` → 3002 |

## What the platform does (feature parity with the legacy router)

- Multi-provider gateway: one client-facing API (`/v1`) routes to many upstream
  accounts (OpenAI, Anthropic, Ollama, Chinese/Asia providers, gateways, fast inference).
- Provider protocols: `openai`, `anthropic`, `ollama`; per-account `api_prefix`,
  auth mode (`api_key` / `oauth2` token file), wildcard model serving.
- Automatic model discovery per account with 3-tier fallback
  (`<prefix>/models` → `/v1/models` → Ollama `/api/tags`).
- Rolling RPM/RPD/RPW budgets (90% threshold), atomic reservation via Valkey
  (multi-replica safe — replaces the legacy in-process deques).
- 429 cooldown with `Retry-After` (seconds or HTTP-date), exponential backoff on
  repeated throttles, quarantine on 401/403, short cooldowns on 404 / model-unavailable 400.
- Load balancing: most-remaining-capacity score, least-recently-used tie-break.
- Streaming pass-through, request optimization (duplicate system message dedupe,
  tool-result trimming per model policy), compare mode (`X-Simha-Mode: compare`
  → run up to 3 models, judge, synthesize), auto model selection (`model: "auto"`).
- Client API keys (`sek_…`, SHA-256 hashed at rest, expiry, request counts, ownership).
- Web sessions (HttpOnly cookie), signup with Terms/Privacy consent, Google/Apple
  social login, admin OAuth2 + PKCE broker for upstream providers (AES-256-GCM at rest).
- Chat workbench (chats, projects, messages, features, scheduled tasks, library,
  generated content, feedback, settings), admin dashboard APIs, audit log.
- Public status page with 30-day uptime (TimescaleDB), status subscriptions, SMTP email.
- Request history + token usage in a TimescaleDB hypertable (per-minute/day/week
  windows computed with `time_bucket`, compression enabled).
- `semantic_memory` vector table (pgvector, 384-dim) for model/doc similarity search.
- Host separation preserved: `api.` / `platform.` / `chat.` / `status.` / `docs.` vhosts.

## Layout

```
database/           SQL migrations (extensions, schema, TimescaleDB, seed)
docs/               Architecture, API contract, migration guide
edge/               nginx edge proxy (hostname → service routing)
services/gateway/   Go hot-path router
services/control-plane/  NestJS REST API
services/worker/    Python background jobs
services/web/       Next.js UI
tools/migrate-sqlite/  One-shot SQLite → PostgreSQL data migration
```

## Run

```bash
cp .env.example .env          # fill secrets
cp .env.example .env  # then fill POSTGRES_PASSWORD, JWT_SECRET, OAUTH_ENCRYPTION_KEY, ADMIN_PASSWORD
docker compose up -d --build

## Plesk reverse proxy (no nginx container in the stack)

Create the simhaonline.ai subscription in Plesk with a Let's Encrypt cert, then add
**Additional nginx directives** (Apache/Nginx Settings → nginx directives):

```nginx
location ~ ^/(v1/|healthz|gateway-status|internal/refresh-models) {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # required for SSE streaming
    proxy_read_timeout 300s;
}
location ~ ^/(auth/|admin/|chat/api/|internal/) {
    proxy_pass http://127.0.0.1:8081;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 120s;
    client_max_body_size 16m;
}
location / {                      # web app + its BFF (/api/*)
    proxy_pass http://127.0.0.1:3002;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

All app ports are bound to 127.0.0.1 only — Plesk is the only public entry point.
make smoke                    # end-to-end checks
```

See `docs/ARCHITECTURE.md` for the service map and `docs/MIGRATION.md` for
importing the legacy `simha_edge.db`.