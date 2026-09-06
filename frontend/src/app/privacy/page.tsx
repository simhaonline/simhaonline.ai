import type { Metadata } from 'next';
import TopBar from '@/components/TopBar';

export const metadata: Metadata = {
  title: 'Privacy Policy — Simha Online',
  description: 'How Simha Online collects, uses, and protects your data.',
};

export default function PrivacyPage() {
  return (
    <>
      <TopBar />
      <main className="container" style={{ maxWidth: 820, paddingBottom: 80 }}>
        <section className="hero" style={{ paddingBottom: 20 }}>
          <div className="kicker">Legal</div>
          <h1 style={{ fontSize: 34, margin: '0 0 8px' }}>Privacy Policy</h1>
          <p className="sub">Effective date: September 6, 2026 · Operated by Simha Online, Dubai, UAE · Contact: <a href="mailto:hello@simhaonline.ai">hello@simhaonline.ai</a></p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>1. What we collect</h3>
          <p><b>Account data:</b> email address, hashed password (PBKDF2), role, and consent records.<br />
          <b>Operational telemetry:</b> request timestamps, model names, token counts, and HTTP status codes — <b>never prompt or response content</b>.<br />
          <b>Provider credentials:</b> API keys and OAuth tokens for the Upstream Accounts you connect, stored encrypted at rest.<br />
          <b>Security data:</b> hashed IP addresses for signup/login abuse prevention and audit logs.</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>2. What we do NOT do</h3>
          <p>We do not read, store, or train on your prompts or completions. We do not sell personal data. We do not share your provider credentials with anyone — they are decrypted only in-memory to authenticate your requests to the provider you chose.</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>3. Why we process data (legal bases)</h3>
          <p>Contract: to operate your account and route your requests. Legitimate interests: fraud/abuse prevention and platform security. Consent: optional marketing email, withdrawable at any time.</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>4. Sharing</h3>
          <p>Data is processed by our infrastructure providers (hosting, managed database) under data-processing agreements, and by Stripe for billing. Requests are forwarded to the model providers you explicitly connect — your prompts go to those providers under their terms, not ours.</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>5. Retention</h3>
          <p>Telemetry is rolled up and retained for usage analytics and billing integrity; request-level rows age out on a rolling window. Account data is kept until you delete your account, after which it is removed within 30 days except where law requires retention (e.g., billing records).</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>6. Your rights</h3>
          <p>You can access, correct, export, or delete your personal data from the dashboard, or by emailing <a href="mailto:hello@simhaonline.ai">hello@simhaonline.ai</a>. EU/UK users may lodge a complaint with their supervisory authority; UAE users with the UAE Data Office.</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>7. Security</h3>
          <p>Encryption in transit (TLS) and at rest for credentials, session cookies are HttpOnly/Secure/SameSite, login throttling and lockouts, audit logging of administrative actions. No system is perfectly secure; we monitor continuously and will notify affected users of any breach as required by law.</p>
        </section>

        <section className="card">
          <h3>8. Cookies</h3>
          <p>We set one essential cookie (<code>simha_session</code>) to keep you signed in. No advertising or third-party tracking cookies are used.</p>
        </section>
      </main>
    </>
  );
}