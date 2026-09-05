'use client';

import { useState } from 'react';
import TopBar from '@/components/TopBar';

export default function SignupPage() {
  const [form, setForm] = useState({
    email: '',
    password: '',
    terms_accepted: false,
    privacy_accepted: false,
    marketing_email: false,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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
      <main className="container" style={{ maxWidth: 460, paddingTop: 60 }}>
        <section>
          <div className="kicker">Create account</div>
          <h1 style={{ fontSize: 28, margin: '0 0 18px' }}>Join as an operator</h1>
          <form onSubmit={submit} className="card" style={{ display: 'grid', gap: 14 }}>
            <div>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="password">Password (10+ characters)</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                required
              />
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={form.terms_accepted}
                onChange={(e) => set('terms_accepted', e.target.checked)}
                required
              />
              I accept the Terms of Use
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={form.privacy_accepted}
                onChange={(e) => set('privacy_accepted', e.target.checked)}
                required
              />
              I accept the Privacy Policy
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={form.marketing_email}
                onChange={(e) => set('marketing_email', e.target.checked)}
              />
              Send me product updates (optional)
            </label>
            {error && (
              <p style={{ color: 'var(--err)', margin: 0, fontSize: 14 }} role="alert">
                {error}
              </p>
            )}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </form>
        </section>
      </main>
    </>
  );
}