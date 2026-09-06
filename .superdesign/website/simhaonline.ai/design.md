---
version: "superdesign-alpha"
name: "Ledger Amber Console"
description: "Near-black operator-console dark mode with a single rationed amber accent, tight sans display type, and a flat 6-tile capability grid over a code-panel proof block."
colors:
  background: "#0A0D12"
  surface: "#11151D"
  surface-2: "#171C26"
  border: "#232A38"
  text-primary: "#E6E9F0"
  text-secondary: "#8A93A6"
  accent: "#D4A643"
  accent-dim: "#8A6D2C"
  accent-ink: "#14100A"
typography:
  display-lg:
    fontFamily: "ui-sans-serif"
    fontSize: "42px"
    fontWeight: 700
    lineHeight: "1.15"
    letterSpacing: "-0.5px"
  body-md:
    fontFamily: "ui-sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: "1.55"
  label-md:
    fontFamily: "ui-sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: "1.55"
  body-card:
    fontFamily: "ui-sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "1.55"
  accent-mono:
    fontFamily: "ui-monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "1.55"
spacing:
  base: "8px"
  gap: "18px"
  section-padding: "28px"
rounded:
  control: "8px"
  card: "12px"
  input: "10px"
components:
  button-primary:
    background: "#D4A643"
    text-color: "#14100A"
    radius: "8px"
    height: "44px"
    padding: "10px 22px"
    border: "1px solid rgb(212, 166, 67)"
  button-secondary:
    background: "#171C26"
    text-color: "#E6E9F0"
    radius: "8px"
    height: "44px"
    padding: "10px 22px"
    border: "1px solid rgb(35, 42, 56)"
  card-feature:
    background: "#11151D"
    radius: "12px"
    padding: "0px 20px"
    border: "1px solid #232A38"
  card-code-panel:
    background: "#171C26"
    radius: "12px"
    padding: "20px"
    border: "1px solid #232A38"
    text-color: "#8A93A6"
---
# Ledger Amber Console
Source: https://simhaonline.ai/

## Overview
This is a dark-mode-default operator-console aesthetic — the visual grammar of infrastructure tooling, not marketing gloss. A near-black ink field (`#0A0D12`) hosts flat, hairline-bordered panels one step lighter (`#11151D`, `#171C26`); there is no glassmorphism, no gradient hero, no shadow-driven elevation. Depth comes entirely from border contrast (`#232A38`) and stacked surface value. A single amber accent (`#D4A643`) is rationed to an eyebrow label, a primary button, and nothing else — the rest of the page stays monochromatic ink-on-charcoal. This reads as Swiss-adjacent restraint applied to a technical dashboard: dense feature tiles, a literal code sample as proof, and sans-serif type doing all the hierarchy work.

## Composition
The first screen stacks vertically: a square edge-to-edge navbar, then a left-aligned hero (eyebrow → two-line bold headline → a four-line supporting paragraph → a two-button row), immediately followed — still above the fold — by the top row of a 3-column capability grid. This rejects a full-bleed hero visual or centered hero composition in favor of density: the page gets to proof (code) and features fast rather than lingering on a big graphic. Scrolling down, the rhythm continues as grid → eyebrow-labeled code panel → (implied) further sections, each band left-aligned to the same 1080px measure with no alternating-side imagery — a content-first, text-and-tile rhythm rather than an image-led marketing scroll.

## Colors
Background is authentically near-black with a cold slate/blue-black cast (`#0A0D12` declared token, reading as the `#001818`/`#181818`/`#181830` pixel-field family — over 95% of rendered pixels are this ink-to-charcoal range). Panels sit one step up at `#11151D` (60% of declared area) and `#171C26` (39%) — these are the card and code-block surfaces, distinguished from the page only by the `#232A38` hairline border. Text ink is off-white `#E6E9F0` for primary copy and headings, with `#8A93A6` as the muted/secondary tone for body paragraphs and card descriptions. The amber `#D4A643` is the entire color budget outside grayscale (~1.2% of declared area) — it marks the eyebrow label, the primary button fill, and would extend to any active nav state; its dim variant `#8A6D2C` is reserved for de-emphasized accent use. Nothing else — icons, dividers, secondary buttons — carries color; they stay strictly neutral.

## Typography
One family throughout: ui-sans-serif, carrying both display and body duty with no serif or decorative face anywhere. Hierarchy is built by weight and size alone: the hero headline runs 42px/700 at -0.5px tracking and 1.15 line-height, tight and bold against loose 18px/400 body copy at 1.55 line-height directly beneath it. Card headings step down further to a bold label register (16px/700), with card body text at 15px/400 — the same tone (`#8A93A6`) as the hero paragraph, keeping copy secondary throughout. An eyebrow label in the amber accent uses uppercase tracking to mark itself as metadata, not prose. The code panel introduces the system's one texture shift: a monospace accent family for the proof block, set in the same muted ink so it reads as documentation, not a callout.

## Layout
Content is bound to a 1080px max-width, left-aligned, no centered-container marketing feel. The signature grid is 3 columns with an 18px gap arranged as two full rows of three: [3][3] — six equal-width feature tiles, each a transparent-background, zero-radius, 0/20px-padded cell containing a heading plus body text (the "contains-6-tiles" card family is really the grid's item, not a separate boxed card — no visible fill or border differentiates tile from page, only spacing and the heading/body pair). Beneath the grid, a full-width code-proof panel breaks the grid rhythm as a spanning element, framed with the 12px card radius and a hairline border, functioning as a single-column proof band. Spacing throughout runs on an 18–28px rhythm (18px grid gap, 20px card padding, 28px section gaps), tight and console-like rather than airy.

## Components
- **Navbar** — edge-to-edge square bar, 57px tall, full 1920px viewport width (0 inset either side), zero corner radius on all four corners (TL/TR/BR/BL 0px), sticky on scroll, fill `#11151D`. Carries 8 items: a text wordmark at left, then a run of nav links, ending in a sign-in link at far right — no visible button-styled CTA sits in the bar itself, only text links (several rendered in the amber accent to mark primary wayfinding items).
- **Button — primary (hero)** — the single amber-filled pill under the headline, `#D4A643` fill, `#14100A` text, 8px radius (slightly-rounded, not pill), 44px height, 10px/22px padding, 1px solid `rgb(212,166,67)` border. This is the one high-contrast, filled control on the first screen and the clear primary action.
- **Button — secondary (hero)** — sits beside the primary, `#171C26` fill, `#E6E9F0` text, same 8px slightly-rounded radius, 44px height, 10px/22px padding, 1px solid `#232A38` border — a neutral outline-adjacent companion button, not an accent variant.
- **Feature tile (×6, grid)** — appears directly below the hero in a 3-column, 2-row grid (18px gap). Transparent fill, 0px radius, 0/20px padding; each tile's anatomy is a bold ~16px heading followed by 15px muted body copy — no icon, no chip, no CTA inside the tile itself.
- **Code-proof panel** — a full-width band beneath the grid, preceded by its own small amber uppercase eyebrow label. Surface `#171C26`, 12px radius, hairline `#232A38` border, generous internal padding; contents are a monospace code sample in muted ink, functioning as the page's literal proof-of-integration artifact rather than an illustration.
- **Footer** — transparent background, minimal, holding a single link — the system deliberately under-builds the footer relative to the hero/grid density.

## Graphics & Effects
There is no gradient, mesh, glow, or photographic layer anywhere in this system — the entire visual field is flat color panels on flat ink. The only "graphic" element is the code-proof panel, which functions as a static, syntax-plain text block rather than a screenshot or illustration — it stands in for a product visual by being the literal integration snippet. Elevation is communicated exclusively through the `#232A38` hairline border and the one-step lightness jump between `#0A0D12` and `#11151D`/`#171C26` — no drop shadows, no blur, no backdrop-filter. Treat this as a shadow-free, border-driven depth system.

## Motion
No animated gradients, parallax, or scroll-linked effects are evidenced; the system's motion budget is confined to conventional micro-interactions consistent with its console character: fast, subtle state transitions (implied ~150–200ms ease-out) on button hover (fill/border shift) and nav link color shift to the amber accent on hover/active. The sticky navbar implies a persistent-position behavior on scroll with no reveal/hide animation evidenced. Motion here should stay understated and instantaneous-feeling — snap, not spring — matching the tool-like tone.

## Guardrails
- Never introduce a gradient or glass panel — every surface is flat, bordered, and opaque.
- Do not extend the amber accent beyond eyebrow/primary-button/active-link use; it must stay under ~2% of the frame.
- Keep the feature grid's tiles borderless and fill-less — only the code panel and buttons get the hairline border treatment.
- Do not round the navbar or give it inset margins — it is edge-to-edge and perfectly square-cornered.
- Never substitute the secondary button's neutral `#171C26` fill for the primary's amber — only one button per view may carry the accent fill.
- Keep body copy in the muted `#8A93A6` tone; reserve `#E6E9F0` for headings and primary emphasis only.