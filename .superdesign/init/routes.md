# Routes

Next.js App Router routes:

| URL | File | Purpose |
|---|---|---|
| `/` | `frontend/src/app/page.tsx` | Public product landing page |
| `/login` | `frontend/src/app/login/page.tsx` | Session login |
| `/signup` | `frontend/src/app/signup/page.tsx` | Account creation |
| `/pricing` | `frontend/src/app/pricing/page.tsx` | Plans and checkout |
| `/dashboard` | `frontend/src/app/dashboard/page.tsx` | Authenticated operator/admin dashboard |
| `/chat` | `frontend/src/app/chat/page.tsx` | Chat workbench |
| `/docs` | `frontend/src/app/docs/page.tsx` | API documentation |
| `/status` | `frontend/src/app/status/page.tsx` | Public status page |

Dashboard API BFF routes:

- `/api/[...path]` forwards browser API paths to control-plane routes.
- `/api/chat/complete` proxies authenticated chat completion through gateway.
- `/api/chat/models` proxies discovered models.
- `/api/status/recent` proxies worker status snapshots.

The dashboard needs to grow into a multi-view control-center experience without changing these public URLs.
