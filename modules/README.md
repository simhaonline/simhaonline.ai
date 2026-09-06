# Isolated engines (`modules/`)

Standalone modules inspired by external projects (Scrapling, gitreverse,
OmniRoute, arena-rank). Every engine is **re-implemented from concepts — none
of those repos are integrated**. All four are fully isolated from the core
stack (gateway / control-plane / worker / web):

- own container + image (`simhaonline-<name>`), own port, own code
- no Postgres, no Valkey, no shared modules, no imports from `services/` or `frontend/`
- compose **profile `engines`**: plain `docker compose up -d` never starts them,
  core deploys never rebuild them, core outages never take them down
- bound to `127.0.0.1` only — reachable from the host (or an SSH tunnel),
  never exposed to Plesk / the internet

| Engine | Port | Inspires on | Stack | State |
|---|---|---|---|---|
| scraper | 8111 | Scrapling (D4Vinci) | Python/FastAPI | stateless + monitor jobs persisted to `/data/monitors.json` |
| reverse | 8112 | gitreverse | Python/FastAPI | stateless |
| router-opt | 8113 | OmniRoute methodology | Go (stdlib only) | stateless, advisory-only |
| rank | 8114 | arena-rank | Python/FastAPI + SQLite | battle history in `/data/arena.db` |
| discovery | 8115 | ecosystem-crawler concepts | Python/FastAPI + SQLite | entity store + cycles on `/data/discovery.db` |
| judge | 8116 | LLM-as-a-judge lit. | Python/FastAPI | stateless; optional LLM adapter envs |

Shared volume: `enginesdata` (monitor state + arena + discovery DB live on it).

## Platform contract (all engines)

Every engine exposes:

- `GET /healthz`, `GET /health/live`, `GET /health/ready` (dependency checks), `GET /metrics` (Prometheus text: uptime, request/error counters per route)
- Feature flag `<ENGINE>_ENABLED` (`SCRAPER_ENABLED`, `REVERSE_ENABLED`, `ROUTER_OPT_ENABLED`, `RANK_ENABLED`, `DISCOVERY_ENABLED`, `JUDGE_ENABLED`) — when set to `false`, non-contract endpoints return 503; contract endpoints stay open (watchdogs keep working).
- Optional `ENGINE_API_TOKEN` env: when set, non-contract requests must carry `X-Engine-Token: <token>`.

## Operations

```bash
docker compose --profile engines up -d      # start all engines
docker compose --profile engines down       # stop engines only
tools/deploy-engines.sh                     # build + sha-tag + health-gate + prune
tools/deploy-engines.sh rank                # one engine
docker compose build scraper && docker compose --profile engines up -d --no-deps scraper
```

Core deploy (`tools/deploy.sh`) never builds or restarts engines; engine deploy
(`tools/deploy-engines.sh`) never touches core services.

## 1. scraper — content discovery & monitoring (port 8111)

Scrapling-inspired ideas re-implemented: normalized text extraction, adaptive
element extraction (infer structure from one example and auto-expand to
siblings), change monitoring with diffing, bounded polite crawling.

| Endpoint | Body | Purpose |
|---|---|---|
| `POST /scrape` | `{url, stealth?, include_links?, css?}` | fetch + title/text/links (or CSS-scoped) |
| `POST /extract` | `{url, css?, example?, fields?, limit?}` | CSS list extraction, or adaptive: give `example: {"t": "some visible text"}` + optional `fields: {name: "css"}` |
| `POST /crawl` | `{seeds[], max_pages?, same_origin_only?, max_depth?}` | bounded BFS crawl |
| `POST /diff` | `{before, after, mode?}` | word-level text diff and/or DOM-structure diff |
| `POST /monitor` | `{url, name?, css?, mode?, interval_s?}` | recurring change watcher (background loop, persisted) |
| `GET /monitor[/{id}]`, `POST /monitor/{id}/check`, `DELETE /monitor/{id}` | | manage jobs |

## 2. reverse — project & website analysis (port 8112)

gitreverse-inspired: extract structure, dependencies, entry points, frameworks,
insights and risks from a codebase or a website.

| Endpoint | Body | Purpose |
|---|---|---|
| `POST /analyze/git` | `{repo_url, ref?, max_files?}` | shallow-clone + full report |
| `POST /analyze/tarball` | multipart `file` | analyze a .tar.gz/.zip upload |
| `POST /analyze/sources` | `{files: [{path, content}]}` | analyze inline files |
| `POST /analyze/website` | `{url, fetch_sitemap?}` | tech fingerprint, meta, links, robots/sitemap |
| `POST /compare` | `{report_a, report_b}` | structural delta between two reports |

Report: `languages, files, dependencies {internal_edges, external},
entry_points, frameworks, insights, risks` (secret-file & hardcoded-credential
heuristics included — the same class of check the repo's own code review runs).

## 3. router-opt — routing optimization advisor (port 8113)

OmniRoute-methodology-inspired, advisory only (never mutates gateway state):

- `/pool/dedup` — collapse provider entries that reach the same upstream
  account (base URL + model) into deduplicated capacity rows with healthy counts
- `/picks` — credit-tier-aware account ranking: eligibility gates (cooldown,
  usage threshold, exhausted credits), score = tier headroom − tier penalty
- `/terms/parse` — free-text provider terms → structured facts
  (RPM/TPM/concurrency limits, no-resale / no-subusers flags, restriction phrases)
- `/optimize` — all three in one report with a summary

## 4. rank — Elo arena for models (port 8114)

arena-rank-inspired: Elo leaderboard over pairwise comparison battles.

- `POST /models {id, display_name?}` — register (bootstrap 1200, RD 350)
- `POST /battle {model_a, model_b, winner: a|b|tie, battle_id?}` — idempotent
  via `battle_id` (replays return `duplicate: true`, no double counting)
- `GET /leaderboard` — rank, rating, ±CI95, votes, W/L/D, win rate
- `GET /history/{model}` — full rating trail (snapshot per battle)
- `POST /reset {confirm: true}` — wipe arena

Methodology: K decays with games played (`K0/(1+games/25)`, floor K0/10) and is
boosted while RD is high, so new models converge in ~10–20 battles; RD shrinks
toward a floor as evidence accumulates (CI on the leaderboard comes from RD).

## 5. discovery — AI ecosystem discovery (port 8115)

Continuously discovers, normalizes, deduplicates and tracks the AI ecosystem
(models, agents, frameworks, MCP servers, vector DBs, …) with provenance and a
trust pipeline: `discovered → parsed → normalized → deduplicated → verified →
approved → active`. Scraped text is injection-scrubbed; only OFFICIAL/VERIFIED
sources can advance entities to `active`.

| Endpoint | Body | Purpose |
|---|---|---|
| `POST /sources` | `{name, url, kind?, trust_level?}` | register a source (community/official/verified) |
| `POST /cycle` | `{limit_sources?}` | fetch all due sources, extract+normalize+upsert entities |
| `GET /sources`, `/jobs` | | source health / cycle history (queued→completed) |
| `GET /entities?kind=&q=&state=` | | browse discovered entities |
| `GET /entities/{id}` | | full record + provenance + pending changes |
| `GET /changes?status=pending` | | Pending Updates queue (§97) |
| `POST /changes/{id}/approve\|reject\|ignore` | | review a detected change |
| `POST /entities/{id}/approve\|reject` | | human state transition (trust-gated) |

Seeded in production: official MCP server registry (README list) + GitHub topic
pages. Unit tests: `modules/discovery/test_engine.py` (18 checks).

## 6. judge — LLM-as-a-judge (port 8116) — REGISTRY-INTEGRATED

Independent evaluation service wired into SIMHA's provider/model registry.

**Config**: stored in Postgres `app_settings['judge_policy']`
(`{mode: auto|manual|heuristic_only, chain: [{account, model}], consensus_judges}`).
Changeable from Admin → Evaluation → Judge Settings at runtime — no restarts,
no `.env` (a legacy `JUDGE_BASE_URL` env only seeds a one-time bootstrap policy
if the DB has none).

**Judge chain**: hops reference registry accounts by name; credentials,
protocol (openai/anthropic/ollama) and base URLs come from the `accounts`
table — no duplicate provider config. Failover: primary → secondary →
tie-breaker → fallback → heuristic (degraded, always flagged).

**AUTO mode**: scores registry candidates by recent success rate, capability
heuristic and latency, skipping recently-failing accounts; re-resolved on
every call so policy/health changes apply instantly.

**HEURISTIC MODE**: when no LLM judge is configured/reachable, the
deterministic baseline judge runs and `heuristic_mode: true` is surfaced in
every response, `/stats`, and the dashboard banner.

| Endpoint | Body | Purpose |
|---|---|---|
| `POST /judge/single` | `{prompt, response, criteria?, subject_ref?}` | rubric scoring via the resolved judge chain |
| `POST /judge/pairwise` | `{prompt, response_a, response_b, criteria?, subject_ref?}` | A/B verdict through the chain |
| `POST /policy` | `{mode, primary?, secondary?, tie_breaker?, fallback?, consensus_judges}` | save policy (validated against registry accounts) |
| `GET /policy` | — | current effective policy |
| `POST /policy/validate` | — | probe each hop + list AUTO candidates |
| `GET /stats` | — | per-backend runs/failures/degradations/latency/tokens/failover rates |

Every execution is recorded in Postgres `judge_runs` (chain, backend, tokens,
latency, failovers, status ok/degraded/failed) — the data behind the admin
Evaluation dashboard. Admin API: `GET/POST /admin/api/judge/settings|policy`,
`GET /admin/api/judge/stats`, `POST /admin/api/judge/probe` (via BFF
`/api/admin/judge/*` from the dashboard). Unit tests: 20 checks including
failover order, degraded fallback, protocol adapters, policy shape.

- compose profile gate + `127.0.0.1`-only ports (verified: `docker compose config --services`
  unchanged for core with/without the profile)
- zero shared code: no imports from `services/*`, no DATABASE_URL/VALKEY_URL env
- engine failures cannot propagate: no depends_on in either direction
- engines bind no public ports; Plesk knows nothing about them