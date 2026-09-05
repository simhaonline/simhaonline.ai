'use client';

import { useState } from 'react';
import TopBar from '@/components/TopBar';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      window.location.href = '/dashboard';
    } catch (err: unknown) {
      setError(String((err as Error).message || err));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar />
      <main className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
        <section>
          <div className="kicker">Sign in</div>
          <h1 style={{ fontSize: 28, margin: '0 0 18px' }}>Operator access</h1>
          <form onSubmit={submit} className="card" style={{ display: 'grid', gap: 14 }}>
            <div>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p style={{ color: 'var(--err)', margin: 0, fontSize: 14 }} role="alert">
                {error}
              </p>
            )}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
              No account? <a href="/signup">Create one</a>.
            </p>
          </form>
        </section>
      </main>
    </>
  );
}