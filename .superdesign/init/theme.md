# Theme summary

- Framework: Next.js 15, React 19, TypeScript.
- CSS: custom vanilla CSS in `frontend/src/app/globals.css`.
- Font: system UI stack.
- Palette: dark navy background, dark blue panels, muted blue-gray text, purple accent, green success, red error.
- Layout: centered `container`, responsive grids, bordered cards, pill badges, compact data tables.
- Radius: 10–14px cards and controls; fully rounded status pills.
- Dashboard direction: dense operator console derived from the legacy Control Center, with strong hierarchy and responsive two-column layouts.

## Raw source

```css
/* See frontend/src/app/globals.css for the complete current stylesheet. */
```

The dashboard additions must reuse existing tokens and classes, extending them only when a missing control-center primitive is required.
