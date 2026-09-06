'use client';

import { useState } from 'react';
import TopBar from '@/components/TopBar';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!r.ok && r.status !== 202) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setSent(true);
    } catch (err: unknown) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar />
      <main className="container" style={{ maxWidth: 420, paddingTop: 80 }}>
        <section>
          <div className="kicker">Account recovery</div>
          <h1 style={{ fontSize: 28, margin: '0 0 18px' }}>Forgot password</h1>
          {sent ? (
            <div className="card" style={{ display: 'grid', gap: 12 }}>
              <p style={{ margin: 0 }}>
                If an account exists for <b>{email}</b>, a reset link is on its way. The link expires in 30 minutes.
              </p>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
                Check your spam folder if it does not arrive within a few minutes.
              </p>
              <a className="btn" href="/login">Back to sign in</a>
            </div>
          ) : (
            <form onSubmit={submit} className="card" style={{ display: 'grid', gap: 14 }}>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
                Enter your account email and we will send a one-time reset link.
              </p>
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
              {error && (
                <p style={{ color: 'var(--err)', margin: 0, fontSize: 14 }} role="alert">
                  {error}
                </p>
              )}
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                Remembered it? <a href="/login">Back to sign in</a>.
              </p>
            </form>
          )}
        </section>
      </main>
    </>
  );
}