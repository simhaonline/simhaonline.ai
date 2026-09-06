# Extractable components

## DashboardShell

- Source: `frontend/src/app/dashboard/page.tsx` (to extract)
- Category: layout
- Description: Authenticated control-center shell with sidebar navigation, header actions, and view content.
- Extractable props: `activeView`, `role`, `onNavigate`, `onRefresh`.
- Hardcoded: Simha brand, navigation labels, icon treatment, layout CSS.

## MetricCard

- Source: `frontend/src/app/dashboard/page.tsx` (to extract)
- Category: basic
- Description: Compact KPI card with label, value, and supporting status text.
- Extractable props: `label`, `value`, `detail`, `tone`.
- Hardcoded: card structure and existing theme styles.

## DataTable

- Source: `frontend/src/app/dashboard/page.tsx` (to extract)
- Category: basic
- Description: Responsive bordered table for accounts, models, activity, keys, users, and reports.
- Extractable props: `columns`, `rows`, `emptyMessage`.
- Hardcoded: table density, typography, status-pill treatment.

## StatusBadge

- Source: `frontend/src/app/globals.css` (pattern)
- Category: basic
- Description: Healthy, warning, cooldown, revoked, and error status pill.
- Extractable props: `tone`, `children`.
- Hardcoded: dot, pill radius, theme colors.

## TopBar

- Source: `frontend/src/components/TopBar.tsx`
- Category: layout
- Description: Public navigation bar.
- Extractable props: none currently.
- Hardcoded: links, brand text, spacing, class names.
