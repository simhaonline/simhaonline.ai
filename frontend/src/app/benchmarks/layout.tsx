import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Model benchmarks' };

export default function BenchmarksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
