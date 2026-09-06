# Shared layouts

## Root layout

- Source: `frontend/src/app/layout.tsx`
- Description: Global HTML shell and metadata.

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Simha Edge Router',
  description: 'Multi-provider AI gateway',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

## TopBar

- Source: `frontend/src/components/TopBar.tsx`
- Description: Public navigation used by dashboard, chat, docs, and marketing pages.

The dashboard completion should introduce an authenticated control-center shell while preserving TopBar for the public/workbench routes.
