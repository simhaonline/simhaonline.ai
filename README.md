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

## Plans & billing (Stripe only)

| Plan | Price | Requests/day | Requests/month | API keys | Burst |
|---|---|---|---|---|---|
| Free | $0 | 200 | 3,000 | 1 | 10/min |
| Pro | $19/mo | 5,000 | 80,000 | 5 | 60/min |
| Business | $99/mo | unlimited | unlimited | 20 | 300/min |

- Every new user is auto-enrolled on **Free** on first dashboard visit. Plan changes:
  Free is instant; paid plans go through **Stripe Checkout** (`/pricing` → hosted payment page).
- Webhooks drive the lifecycle: `checkout.session.completed` activates,
  `customer.subscription.updated` syncs period/cancellation,
  `customer.subscription.deleted` drops the user to Free, `invoice.payment_failed`
  flags cancel-at-period-end. Endpoint: `POST /billing/webhook` (signature-verified, raw body).
- Users manage card/cancel/invoices via the Stripe customer portal
  (dashboard → *Manage billing*).
- The gateway enforces per-user daily AND monthly quota counters in Valkey
  (`quota:<uid>:<day>`, `quota:m:<uid>:<month>`, limits cached under
  `quota:limits:<uid>` with 24h TTL) — over-limit returns `429` with an upgrade hint.
- Key creation enforces the plan's `max_keys` (admins bypass).
- Manual fallback: with `STRIPE_SECRET_KEY` empty, paid-plan selection creates a
  pending invoice; an admin confirms it (`POST /billing/admin/invoices/<id>/confirm`)
  after a bank transfer.

### Stripe setup

1. `STRIPE_SECRET_KEY=sk_live_…` (or `sk_test_…` first) and
   `STRIPE_WEBHOOK_SECRET=whsec_…` in `.env`; set `NEXT_PUBLIC_SITE_URL=https://simhaonline.ai`.
2. `docker compose --env-file .env up -d control-plane`.
3. Stripe dashboard → Developers → Webhooks → add endpoint
   `https://simhaonline.ai/billing/webhook` with events `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`; paste the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Products/prices are auto-provisioned in Stripe on first checkout
   (`plans.stripe_price_id` caches the price IDs).

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
cp .env.example .env          # then fill POSTGRES_PASSWORD, JWT_SECRET, OAUTH_ENCRYPTION_KEY, ADMIN_PASSWORD
docker compose up -d --build
make smoke                    # end-to-end checks
```

## Plesk reverse proxy (no nginx container in the stack)

Create the `simhaonline.ai` subscription in Plesk with a Let's Encrypt cert, add the
extra vhosts (`chat.` / `platform.` / `status.` / `docs.` / `api.`) as **additional
domains** on the same subscription, then paste the matching block below into
**Apache & nginx Settings → Additional nginx directives** for each host.

Important: keep each block *complete* — a `location / { … }` catch-all must exist in
every web-facing vhost, otherwise nginx answers 404 for any path you did not list
(Plesk merges these directives into the vhost verbatim).

All hosts (paste into every vhost — health probe + websockets + SSE baselines):

```nginx
location = /healthz {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    access_log off;
}
```

### simhaonline.ai (marketing site + docs/status/pricing pages + BFF)

```nginx
location / {                      # web app; its BFF serves /api/* — EVERYTHING
    proxy_pass http://127.0.0.1:3002;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_read_timeout 300s;
    client_max_body_size 16m;
}
```

### platform.simhaonline.ai (main app/dashboard) — same block as apex

```nginx
location / {
    proxy_pass http://127.0.0.1:3002;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_read_timeout 300s;
    client_max_body_size 16m;
}
```

### chat.simhaonline.ai (chat workbench: web UI + control-plane APIs)

```nginx
location ~ ^/(auth|admin|billing)(/|$) {   # control-plane APIs
    proxy_pass http://127.0.0.1:8081;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 120s;
    client_max_body_size 16m;
}
location / {                               # chat UI + its BFF (/api/*)
    proxy_pass http://127.0.0.1:3002;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_read_timeout 300s;
    client_max_body_size 16m;
}
```

### docs.simhaonline.ai — same `location /` block as apex (docs is a web page)

### status.simhaonline.ai (status page + its data APIs)

```nginx
location ~ ^/(status-data|status-subscribe)$ {   # worker
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 60s;
}
location / {                                     # status page (web)
    proxy_pass http://127.0.0.1:3002;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 60s;
}
```

### api.simhaonline.ai (public LLM API — no web UI)

```nginx
location / {                      # gateway serves /v1/*, /healthz,
    proxy_pass http://127.0.0.1:8080;   # /gateway-status, /internal/*
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # required for SSE streaming
    proxy_read_timeout 300s;
    client_max_body_size 16m;
}
```

After saving, apply with `sudo plesk nginx reload` (or the Plesk UI restart).

All app ports are bound to 127.0.0.1 only — Plesk is the only public entry point.

Legacy data import: run `sudo python3 tools/migrate_sqlite.py` (see the script header
for the connection/env it expects) after the stack is up — it maps the legacy
`simha_edge.db` tables onto the new schema (users, client keys with valid hashes,
chats, messages, settings, request history).
