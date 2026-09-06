'use client';

// Dashboard sidebar nav with active-route highlighting via usePathname.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Boxes, KeyRound, ShieldCheck, Settings, FlaskConical, LogOut } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/models', label: 'Models', icon: Boxes },
  { href: '/dashboard/keys', label: 'API keys', icon: KeyRound },
  { href: '/dashboard/oauth', label: 'OAuth', icon: ShieldCheck },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  { href: '/dashboard/benchmarks', label: 'Benchmarks', icon: FlaskConical },
];

export default function DashboardNav() {
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try { await api.logout(); } catch { /* session may already be gone */ }
    window.location.href = 'https://simhaonline.ai/';
  }

  return (
    <>
      <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Dashboard">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
                active
                  ? 'bg-zinc-800 text-violet-400'
                  : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100',
              )}
            >
              <Icon size={15} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-zinc-800 px-3 py-3">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="h-2 w-2 rounded-full bg-green-400" aria-hidden />
          API online
          <span className="ml-auto">operator session</span>
        </div>
        <button
          onClick={() => void signOut()}
          disabled={signingOut}
          className="mt-2.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-400 cursor-pointer disabled:opacity-50"
        >
          <LogOut size={13} />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </>
  );
}