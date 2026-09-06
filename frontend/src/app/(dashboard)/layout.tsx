import type { Metadata } from 'next';
import Link from 'next/link';
import WorkspaceDropdown from '@/components/dashboard/WorkspaceDropdown';
import DashboardNav from '@/components/dashboard/DashboardNav';

// (1) app/(dashboard)/layout.tsx — fixed 240px sidebar + flex main area.
// Spec: bg-zinc-900 sidebar, border-r zinc-800, logo, workspace dropdown,
// nav links, footer status row; children wrapped in a flex main area.
export const metadata: Metadata = {
  title: { default: 'Control Center', template: '%s — Simha Edge Router' },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-[240px] flex-col border-r border-zinc-800 bg-zinc-900">
        <div className="border-b border-zinc-800 px-3 py-3">
          <Link href="/dashboard" className="flex items-center gap-2 px-1.5 text-sm font-semibold tracking-tight text-zinc-100">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-violet-500 text-black">⌁</span>
            Simha Edge Router
          </Link>
          <div className="mt-3">
            <WorkspaceDropdown />
          </div>
        </div>
        <DashboardNav />
      </aside>
      <main className="ml-[240px] flex min-h-screen flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}