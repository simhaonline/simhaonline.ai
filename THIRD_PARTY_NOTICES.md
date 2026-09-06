# THIRD_PARTY_NOTICES.md

Dependency/license inventory for the simhaonline.ai platform. Review before
adding any new third-party package (prompt.md §80).

## Core services

| Component | Version | License | Source |
|---|---|---|---|
| Go 1.23 (gateway, router-opt) | 1.23 | BSD-3 | go.dev |
| pgx v5 (gateway) | v5 | MIT | github.com/jackc/pgx |
| valkey-go (gateway) | v1.0.63 | Apache-2.0 | github.com/valkey-io/valkey-go |
| NestJS 10 (control-plane) | 10 | MIT | nestjs.com |
| pg / ioredis (control-plane) | — | MIT | npm |
| Stripe SDK (control-plane) | — | MIT | npm |
| FastAPI (worker) | 0.115.6 | MIT | pypi |
| psycopg3 + psycopg_pool (worker) | 3.x | LGPL-3.0 | pypi |
| httpx (worker/engines) | 0.28.1 | BSD-3 | pypi |
| redis-py (worker) | 5.x | MIT | pypi |
| boto3 (worker) | — | Apache-2.0 | pypi |
| Next.js 15 (web) | 15 | MIT | nextjs.org |
| React (web) | 19 | MIT | react.dev |
| timescale/timescaledb:latest-pg16 (db image) | pg16 | Apache-2 | timescale.com |
| pgvector (db extension) | — | PostgreSQL License | pgvector.org |
| valkey 8 (cache image) | 8 | BSD-3 | valkey.io |
| MinIO (object storage) | RELEASE.2025-04-22 | AGPL-3.0 (server) | min.io |

## Isolated engines (modules/)

All engines are **clean-room re-implementations** — inspired by the capability
set of external projects; no external repo source is vendored or imported.

| Engine | Inspired by | License of inspiration | Our code |
|---|---|---|---|
| scraper (8111) | Scrapling (D4Vinci) | BSD-3 | original — httpx + BeautifulSoup |
| reverse (8112) | gitreverse concepts | — | original |
| router-opt (8113) | OmniRoute methodology | — | original — Go stdlib only |
| rank (8114) | arena-rank (lmarena) | Apache-2 | original — Elo/RD, no external code |
| discovery (8115) | ecosystem-crawler concepts | — | original — httpx + bs4 + sqlite |
| judge (8116) | LLM-as-a-judge literature | — | original — heuristic baseline + optional OpenAI-compatible adapter |

Engine pip deps (all engines): fastapi 0.115.6 (MIT), uvicorn 0.34.0 (BSD-3),
pydantic 2.10.4 (MIT), httpx 0.28.1 (BSD-3), beautifulsoup4 4.12.3 (MIT),
python-multipart 0.0.20 (Apache-2). Go router-opt: stdlib only.

## Reference projects (NOT integrated — research points only)

- github.com/D4Vinci/Scrapling — adaptive crawling concepts (BSD-3)
- lmarena/arena-rank — Elo/leaderboard concepts (Apache-2)
- gitreverse-style analyzers — structure/dependency analysis concepts
- OmniRoute methodology — pool dedup/credit tier/term parsing concepts
- modelcontextprotocol/servers — data source (MIT, fetched as public docs)

## Compliance notes

- Scraped/fetched content is used as metadata/provenance only; never republished verbatim.
- No GPL/AGPL code is copied into permissive-licensed first-party code.
- Judge backend adapter talks to any OpenAI-compatible endpoint the operator configures; no model weights are shipped.