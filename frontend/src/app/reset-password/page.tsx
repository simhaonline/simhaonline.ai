'use client';

import { useEffect, useState } from 'react';
import TopBar from '@/components/TopBar';

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Email links arrive as /reset-password?token=… — prefill from the URL.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    if (t) setToken(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setDone(true);
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
          <h1 style={{ fontSize: 28, margin: '0 0 18px' }}>Set a new password</h1>
          {done ? (
            <div className="card" style={{ display: 'grid', gap: 12 }}>
              <p style={{ margin: 0 }}>Password changed. All previous sessions were signed out.</p>
              <a className="btn primary" href="/login">Sign in with your new password</a>
            </div>
          ) : (
            <form onSubmit={submit} className="card" style={{ display: 'grid', gap: 14 }}>
              <div>
                <label htmlFor="token">Reset token</label>
                <input
                  id="token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste the token from your email link"
                  required
                />
                <small style={{ color: 'var(--muted)', fontSize: 12 }}>
                  Opened via the email link? The token is filled in the URL — it is used automatically below.
                </small>
              </div>
              <div>
                <label htmlFor="password">New password (10+ characters)</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="confirm">Confirm new password</label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p style={{ color: 'var(--err)', margin: 0, fontSize: 14 }} role="alert">
                  {error}
                </p>
              )}
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
        </section>
      </main>
    </>
  );
}