'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const links = [
  { href: 'https://simhaonline.ai/', label: 'Home' },
  { href: 'https://simhaonline.ai/pricing', label: 'Pricing' },
  { href: 'https://status.simhaonline.ai/', label: 'Status' },
  { href: 'https://docs.simhaonline.ai/', label: 'Docs' },
  { href: 'https://chat.simhaonline.ai/', label: 'Workbench' },
  { href: 'https://platform.simhaonline.ai/benchmarks', label: 'Benchmarks' },
  { href: 'https://platform.simhaonline.ai/', label: 'Dashboard' },
];

export default function TopBar() {
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => setAuthenticated(response.ok))
      .catch(() => setAuthenticated(false));
  }, []);
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = 'https://simhaonline.ai/';
  }
  return (
    <nav className="topbar" aria-label="Primary navigation">
      <div className="container inner">
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark">⌁</span><span>Simha <em>Online</em></span>
        </Link>
        <button className="menu-toggle" aria-label={open ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={open} onClick={() => setOpen(!open)}><span /><span /><span /></button>
        <div className={`links ${open ? 'open' : ''}`}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          {authenticated === true && <div className="account-menu"><button className="nav-account" aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)}>Account ▾</button>{accountOpen && <div className="account-popover" role="menu"><Link href="https://platform.simhaonline.ai/" onClick={() => { setOpen(false); setAccountOpen(false); }}>Dashboard</Link><Link href="https://platform.simhaonline.ai/settings" onClick={() => { setOpen(false); setAccountOpen(false); }}>Settings</Link><Link href="https://simhaonline.ai/pricing" onClick={() => { setOpen(false); setAccountOpen(false); }}>Billing</Link><button onClick={() => { setOpen(false); setAccountOpen(false); void logout(); }}>Sign out</button></div>}</div>}
          {authenticated === false && <Link href="https://platform.simhaonline.ai/login" onClick={() => setOpen(false)}>Sign in</Link>}
        </div>
      </div>
    </nav>
  );
}
