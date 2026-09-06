# Simha Edge Router Control Center

## Product context

Authenticated operator/admin console for a multi-provider AI gateway. The dashboard must feel like a serious infrastructure control center: dense but readable telemetry, clear health states, safe destructive actions, and obvious role boundaries. Preserve the existing Simha dark navy/violet visual language and the legacy Control Center information architecture.

## Visual system

- Background: `#080d18`
- Panel: `#101827`
- Secondary panel: `#151f31`
- Border: `#263247`
- Text: `#f4f7fb`
- Muted text: `#9baac0`
- Faint text: `#64748b`
- Accent: `#a087ff` / primary violet `#7046f5`
- Good: `#32d583`
- Warning: `#fdb022`
- Error/destructive: `#f97066`
- Font: system UI stack, monospace for IDs, models, URLs, and telemetry values.
- Cards: 10–14px radius, 1px borders, subtle dark shadow.
- Layout: authenticated sidebar + top header, responsive one-column collapse below 900px.
- Controls: compact bordered buttons, violet primary actions, status pills, progress bars, data tables with horizontal overflow.

## Information architecture

Overview; Upstream accounts; Usage & analytics; Models; Routing policies; Provider catalog; Budgets & limits; Observability; Request activity; Client API keys; OAuth & SSO; User management; User reports; Documentation; Settings.

## Implementation constraints

Reuse the current Next.js App Router, `TopBar` only for public pages, existing CSS tokens, existing PostgreSQL/NestJS route contracts, and role checks. Do not expose provider secrets or raw API keys. Do not introduce a new UI library or database migration unless strictly required.

Use ONLY the fonts, colors, spacing, and component styles defined in this design system. Do not introduce any fonts, colors, or visual styles not in the design system.
