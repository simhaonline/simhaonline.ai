import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  // Per-page metadata overrides this default (audit H4: every page previously
  // shared one identical title/description, breaking SEO and tab identity).
  title: {
    default: 'Simha Edge Router — multi-provider AI gateway',
    template: '%s — Simha Online',
  },
  description:
    'One OpenAI-compatible endpoint for every major LLM provider. Rolling-window rate limits, automatic failover, semantic caching.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}