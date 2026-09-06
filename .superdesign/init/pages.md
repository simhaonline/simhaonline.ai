# Page dependency trees

## `/dashboard` — current dashboard

- `frontend/src/app/dashboard/page.tsx`
  - `frontend/src/components/TopBar.tsx`
  - `frontend/src/components/PlanUsage.tsx`
  - `frontend/src/app/globals.css`

Current rendered sections: provider accounts, model catalog, plan/usage, client API keys, recent requests.

## `/chat` — workbench

- `frontend/src/app/chat/page.tsx`
  - `frontend/src/components/TopBar.tsx`
  - `frontend/src/app/globals.css`

## Public pages

- `/`, `/login`, `/signup`, `/pricing`, `/docs`, `/status`
  - their respective `page.tsx`
  - `frontend/src/components/TopBar.tsx` where used
  - `frontend/src/app/globals.css`

## Legacy reference

- `/srv/ollama-proxy/dashboard.html`
- `/srv/ollama-proxy/dashboard-extensions.js`

These define the missing views: usage analytics, routing, provider catalog, limits, observability, request activity, settings, OAuth/SSO, users, reports, client keys, and operator documentation.
