'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

// Audit (UX): inside an app surface the top bar carries only brand + account;
// marketing links (Home/Pricing/Status/Docs/Benchmarks) live on the website,
// not in the product chrome. App-to-app jumps stay in the Account menu.
const links = [
  { href: 'https://simhaonline.ai/', label: 'Home' },
  { href: 'https://simhaonline.ai/pricing', label: 'Pricing' },
  { href: 'https://status.simhaonline.ai/', label: 'Status' },
  { href: 'https://docs.simhaonline.ai/', label: 'Docs' },
  { href: 'https://chat.simhaonline.ai/', label: 'Workbench' },
  { href: 'https://platform.simhaonline.ai/benchmarks', label: 'Benchmarks' },
  { href: 'https://platform.simhaonline.ai/', label: 'Dashboard' },
];

// Which surface is compact (product UI) vs full (marketing pages)?
const COMPACT_HOSTS = new Set(['chat.simhaonline.ai', 'platform.simhaonline.ai']);

export default function TopBar() {
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined') setCompact(COMPACT_HOSTS.has(window.location.hostname));
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => setAuthenticated(response.ok))
      .catch(() => setAuthenticated(false));
  }, []);
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = 'https://simhaonline.ai/';
  }
  const visible = compact ? [] : links;
  return (
    <nav className="topbar" aria-label="Primary navigation">
      <div className="container inner">
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark">⌁</span><span>Simha <em>Online</em></span>
        </Link>
        {!compact && (
          <button className="menu-toggle" aria-label={open ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={open} onClick={() => setOpen(!open)}><span /><span /><span /></button>
        )}
        <div className={`links ${open ? 'open' : ''}`}>
          {visible.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          {authenticated === true && <div className="account-menu"><button className="nav-account" aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)}>Account ▾</button>{accountOpen && <div className="account-popover" role="menu"><Link href="https://platform.simhaonline.ai/" onClick={() => { setOpen(false); setAccountOpen(false); }}>Dashboard</Link><Link href="https://chat.simhaonline.ai/chat" onClick={() => { setOpen(false); setAccountOpen(false); }}>Workbench</Link><Link href="https://platform.simhaonline.ai/settings" onClick={() => { setOpen(false); setAccountOpen(false); }}>Settings</Link><Link href="https://simhaonline.ai/pricing" onClick={() => { setOpen(false); setAccountOpen(false); }}>Billing</Link><Link href="https://docs.simhaonline.ai/" onClick={() => { setOpen(false); setAccountOpen(false); }}>Docs</Link><button onClick={() => { setOpen(false); setAccountOpen(false); void logout(); }}>Sign out</button></div>}</div>}
          {authenticated === false && <Link href="https://platform.simhaonline.ai/login" onClick={() => setOpen(false)}>Sign in</Link>}
        </div>
      </div>
    </nav>
  );
}