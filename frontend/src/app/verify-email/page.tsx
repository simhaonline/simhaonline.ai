'use client';

import { useEffect, useState } from 'react';
import TopBar from '@/components/TopBar';

// Landing target of the signup verification link:
// /verify-email?token=<one-time token>
export default function VerifyEmailPage() {
  const [state, setState] = useState<'working' | 'ok' | 'bad'>('working');
  const [message, setMessage] = useState('Confirming your email address…');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setState('bad');
      setMessage('This link is missing its verification token. Request a new email from the sign-in page.');
      return;
    }
    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        setState('ok');
        setMessage('Your email is confirmed. Your account is now active — sign in to start building.');
      })
      .catch((e: unknown) => {
        setState('bad');
        setMessage(String((e as Error).message || e));
      });
  }, []);

  return (
    <>
      <TopBar />
      <main className="container" style={{ maxWidth: 460, paddingTop: 90 }}>
        <section>
          <div className="kicker">Email verification</div>
          <h1 style={{ fontSize: 28, margin: '0 0 14px' }}>
            {state === 'ok' ? 'Email confirmed' : state === 'bad' ? 'Link problem' : 'Verifying…'}
          </h1>
          <div className="card" style={{ display: 'grid', gap: 14 }}>
            <p style={{ margin: 0 }} role="status">{message}</p>
            {state === 'ok' && <a className="btn primary" href="/login">Sign in</a>}
            {state === 'bad' && (
              <>
                <a className="btn" href="/login">Back to sign in</a>
                <small style={{ color: 'var(--muted)' }}>
                  Tokens expire after 24 hours and can only be used once. Signed in already? Use
                  resend-verification from your account.
                </small>
              </>
            )}
          </div>
        </section>
      </main>
    </>
  );
}