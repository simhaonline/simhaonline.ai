'use client';

import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/status', label: 'Status' },
  { href: '/docs', label: 'Docs' },
  { href: '/chat', label: 'Workbench' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/login', label: 'Sign in' },
];

export default function TopBar() {
  return (
    <nav className="topbar">
      <div className="container inner">
        <Link href="/" className="brand">
          Simha Edge Router
        </Link>
        <div className="links">
          {links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}