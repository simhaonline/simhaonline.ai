# Shared UI components

The app uses custom React components and vanilla CSS; there is no third-party component library.

## TopBar

- Source: `frontend/src/components/TopBar.tsx`
- Description: Shared public/workbench navigation bar.

```tsx
import Link from 'next/link';

export default function TopBar() {
  return (
    <nav className="topbar">
      <div className="container inner">
        <Link className="brand" href="/">Simha Edge Router</Link>
        <div className="links">
          <Link href="/">Home</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/status">Status</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/chat">Workbench</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/login">Sign in</Link>
        </div>
      </div>
    </nav>
  );
}
```

## PlanUsage

- Source: `frontend/src/components/PlanUsage.tsx`
- Description: Billing plan, quota, invoice, cancellation, and Stripe controls.

```tsx
import { useCallback, useEffect, useState } from 'react';
// Full source remains in the repository; this shared card is the dashboard's billing primitive.
```

## Existing primitives

Cards, buttons, inputs, tables, pills, progress bars, and responsive layout are currently expressed through classes in `frontend/src/app/globals.css` rather than separate components.
