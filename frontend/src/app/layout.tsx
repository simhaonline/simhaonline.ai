import type { Metadata, Viewport } from 'next';
import './globals.css';
import PWARegister from '@/components/PWARegister';

export const metadata: Metadata = {
  // Per-page metadata overrides this default (audit H4: every page previously
  // shared one identical title/description, breaking SEO and tab identity).
  title: {
    default: 'Simha Edge Router — multi-provider AI gateway',
    template: '%s — Simha Online',
  },
  description:
    'One OpenAI-compatible endpoint for every major LLM provider. Rolling-window rate limits, automatic failover, semantic caching.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Simha Workbench',
  },
  icons: {
    icon: [
      { url: '/favicon.png', sizes: '64x64', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
};

// PWA viewport: lock to device width, prevent unwanted zoom-out, respect the
// notch (viewport-fit=cover with safe-area padding in CSS).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        {children}
        <PWARegister />
      </body>
    </html>
  );
}