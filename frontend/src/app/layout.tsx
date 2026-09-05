import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Simha Edge Router — multi-provider AI gateway',
  description:
    'One OpenAI-compatible endpoint for every major LLM provider. Rolling-window rate limits, automatic failover, semantic caching.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}