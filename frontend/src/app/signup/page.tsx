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
  const [verifyNotice, setVerifyNotice] = useState('');

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
      // Audit M1: accounts require email verification before sign-in —
      // surface that clearly instead of dropping the user on a dead session.
      setVerifyNotice(form.email);
    } catch (err: unknown) {
      setError(String((err as Error).message || err));
      setBusy(false);
    }
  }

  if (verifyNotice) {
    return (
      <>
        <TopBar />
        <main className="container" style={{ maxWidth: 460, paddingTop: 80 }}>
          <section>
            <div className="kicker">Confirm your email</div>
            <h1 style={{ fontSize: 28, margin: '0 0 14px' }}>Check your inbox</h1>
            <div className="card" style={{ display: 'grid', gap: 12 }}>
              <p style={{ margin: 0 }}>
                We sent a verification link to <b>{verifyNotice}</b>. Click it to activate your account —
                sign-in is blocked until the address is confirmed.
              </p>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
                The link expires in 24 hours. Check spam if it does not arrive within a few minutes.
              </p>
              <a className="btn" href="/login">Back to sign in</a>
            </div>
          </section>
        </main>
      </>
    );
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
              I accept the <a href="https://simhaonline.ai/terms" target="_blank" rel="noreferrer">Terms of Use</a>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={form.privacy_accepted}
                onChange={(e) => set('privacy_accepted', e.target.checked)}
                required
              />
              I accept the <a href="https://simhaonline.ai/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
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