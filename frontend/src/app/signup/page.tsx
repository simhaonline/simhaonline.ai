'use client';

// Signup — audit-grade consent flow:
//   · versioned T&C / Privacy acceptance (version sent to the control plane
//     and recorded in audit_log with IP + timestamp)
//   · expandable summaries so users see WHAT they agree to before agreeing
//   · mandatory checkboxes (server enforces; client blocks submit too)
//   · password strength meter + confirmation field
// Optional marketing email is a separate, untied opt-in.

import { useMemo, useState } from 'react';
import TopBar from '@/components/TopBar';
import { ChevronDown, Check, X, FileText, ShieldCheck, Loader2 } from 'lucide-react';

// Bump when the legal docs change; the CP rejects stale versions.
const TERMS_VERSION = '2026-09-07';
const PRIVACY_VERSION = '2026-09-07';

const TERMS_SUMMARY = [
  'You use the platform for lawful purposes only.',
  'API usage is subject to fair-use limits and your plan quota.',
  'The service is provided as-is; availability targets are best-effort.',
  'Accounts violating these terms may be suspended.',
];
const PRIVACY_SUMMARY = [
  'We store your email and usage metadata (never prompt content).',
  'Passwords are salted+hashed; sessions are httpOnly cookies.',
  'No data is sold. Telemetry is aggregated and privacy-safe.',
  'You can request account deletion at any time from Settings.',
];

function SummaryBox({ title, icon: Icon, version, items, docHref }: {
  title: string; icon: typeof FileText; version: string; items: string[]; docHref: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="consent-box" data-open={open}>
      <button type="button" className="consent-box-head" onClick={() => setOpen((v) => !v)}
        aria-expanded={open}>
        <Icon size={15} aria-hidden />
        <b>{title}</b>
        <span className="consent-version">v{version}</span>
        <ChevronDown size={14} className="consent-chevron" aria-hidden />
      </button>
      {open && (
        <div className="consent-box-body">
          <ul>
            {items.map((it) => <li key={it}>{it}</li>)}
          </ul>
          <a href={docHref} target="_blank" rel="noreferrer">Read the full document →</a>
        </div>
      )}
    </div>
  );
}

export default function SignupPage() {
  const [form, setForm] = useState({
    email: '', password: '', confirm: '',
    terms_accepted: false, privacy_accepted: false, marketing_email: false,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState('');

  const strength = useMemo(() => {
    const p = form.password;
    if (!p) return 0;
    let s = 0;
    if (p.length >= 10) s++;
    if (p.length >= 14) s++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
    if (/\d/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p)) s++;
    return Math.min(s, 4);
  }, [form.password]);
  const strengthLabel = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][strength] || '';
  const confirmOk = form.confirm.length > 0 && form.confirm === form.password;
  const allConsents = form.terms_accepted && form.privacy_accepted;

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!allConsents) {
      setError('Please accept the Terms of Use and Privacy Policy to continue.');
      return;
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          terms_accepted: form.terms_accepted,
          privacy_accepted: form.privacy_accepted,
          marketing_email: form.marketing_email,
          terms_version: TERMS_VERSION,
          privacy_version: PRIVACY_VERSION,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
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
          <form onSubmit={submit} className="card" style={{ display: 'grid', gap: 14 }} noValidate>
            <div>
              <label htmlFor="email">Email</label>
              <input
                id="email" type="email" inputMode="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="password">Password (10+ characters)</label>
              <input
                id="password" type="password"
                autoComplete="new-password"
                minLength={10}
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                onInput={(e) => set('password', (e.target as HTMLInputElement).value)}
                required
              />
              {form.password && (
                <div className="pw-meter" role="status" aria-label={`Password strength: ${strengthLabel}`}>
                  <div className="pw-meter-bars" data-strength={strength}>
                    <i /><i /><i /><i />
                  </div>
                  <span>{strengthLabel}</span>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="confirm">Confirm password</label>
              <input
                id="confirm" type="password"
                autoComplete="new-password"
                value={form.confirm}
                onChange={(e) => set('confirm', e.target.value)}
                style={form.confirm && !confirmOk ? { borderColor: 'var(--err)' } : undefined}
                required
              />
              {form.confirm && (confirmOk
                ? <p className="field-hint ok"><Check size={11} /> Passwords match</p>
                : <p className="field-hint err"><X size={11} /> Passwords do not match</p>)}
            </div>

            {/* Consent block — summaries visible before agreeing */}
            <div className="consent-block">
              <p className="consent-title">Before you continue</p>
              <SummaryBox
                title="Terms of Use" icon={FileText} version={TERMS_VERSION}
                items={TERMS_SUMMARY} docHref="https://simhaonline.ai/terms"
              />
              <SummaryBox
                title="Privacy Policy" icon={ShieldCheck} version={PRIVACY_VERSION}
                items={PRIVACY_SUMMARY} docHref="https://simhaonline.ai/privacy"
              />
              <label className="consent-check">
                <input type="checkbox" checked={form.terms_accepted}
                  onChange={(e) => set('terms_accepted', e.target.checked)} required />
                <span>I have read and accept the <a href="https://simhaonline.ai/terms" target="_blank" rel="noreferrer">Terms of Use</a> (v{TERMS_VERSION})</span>
              </label>
              <label className="consent-check">
                <input type="checkbox" checked={form.privacy_accepted}
                  onChange={(e) => set('privacy_accepted', e.target.checked)} required />
                <span>I have read and accept the <a href="https://simhaonline.ai/privacy" target="_blank" rel="noreferrer">Privacy Policy</a> (v{PRIVACY_VERSION})</span>
              </label>
              <label className="consent-check optional">
                <input type="checkbox" checked={form.marketing_email}
                  onChange={(e) => set('marketing_email', e.target.checked)} />
                <span>Send me product updates (optional, unrelated to account creation)</span>
              </label>
              <p className="consent-record">
                Your acceptance (document versions, timestamp, IP) is recorded and kept for compliance.
              </p>
            </div>

            {error && (
              <p style={{ color: 'var(--err)', margin: 0, fontSize: 14 }} role="alert">
                {error}
              </p>
            )}
            <button className="btn primary" type="submit" disabled={busy || !allConsents}>
              {busy ? (<><Loader2 size={13} className="spin" /> Creating…</>) : 'Create account'}
            </button>
            {!allConsents && (
              <p className="field-hint" style={{ margin: 0 }}>
                Both consents are required to enable account creation.
              </p>
            )}
          </form>
        </section>
      </main>
    </>
  );
}