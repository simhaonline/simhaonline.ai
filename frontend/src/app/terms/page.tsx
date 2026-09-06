import type { Metadata } from 'next';
import TopBar from '@/components/TopBar';

export const metadata: Metadata = {
  title: 'Terms of Service — Simha Online',
  description: 'Terms of Service for the Simha Edge Router platform and API.',
};

export default function TermsPage() {
  return (
    <>
      <TopBar />
      <main className="container" style={{ maxWidth: 820, paddingBottom: 80 }}>
        <section className="hero" style={{ paddingBottom: 20 }}>
          <div className="kicker">Legal</div>
          <h1 style={{ fontSize: 34, margin: '0 0 8px' }}>Terms of Service</h1>
          <p className="sub">Effective date: September 6, 2026 · Operated by Simha Online, Dubai, UAE</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>1. Acceptance</h3>
          <p>By creating an account or using the Simha Edge Router platform, API, or Workbench (collectively, the "Service"), you agree to these Terms. If you accept on behalf of an organization, you represent that you are authorized to do so.</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>2. The Service</h3>
          <p>Simha Edge Router routes AI requests from your applications to third-party model providers that you connect (your "Upstream Accounts"). We act as a gateway and routing layer. We do not train models, and we do not use your prompts to train anything.</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>3. Your accounts and keys</h3>
          <p>You are responsible for the Upstream Accounts you connect, the credentials you store (encrypted at rest), and the activity performed through your API keys. Keep keys secret; treat any exposed <code>sek_</code> key as compromised and rotate it immediately from the dashboard.</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>4. Acceptable use</h3>
          <p>You agree not to use the Service for unlawful content, to attack or probe the platform, to circumvent rate limits or upstream provider terms, or to resell capacity in violation of your upstream agreements. We may suspend accounts that endanger the platform or other users.</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>5. Billing</h3>
          <p>Paid plans bill monthly in advance via Stripe. You bring your own provider accounts and pay providers directly for their usage; our fees cover the routing platform. Subscriptions can be cancelled at any time; cancellation takes effect at the end of the billing period.</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>6. Availability and support</h3>
          <p>We target high availability but the Service is provided "as is" during the current beta period, without warranties of uninterrupted service. Status is published at status.simhaonline.ai. Support is available at <a href="mailto:hello@simhaonline.ai">hello@simhaonline.ai</a>.</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>7. Liability</h3>
          <p>To the maximum extent permitted by law, Simha Online is not liable for indirect or consequential damages, lost profits, or upstream provider outages. Our aggregate liability is limited to the fees you paid us in the 3 months preceding the claim.</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>8. Termination</h3>
          <p>You may delete your account at any time from the dashboard. We may terminate accounts for material breach of these Terms with notice where practicable.</p>
        </section>

        <section className="card" style={{ marginBottom: 18 }}>
          <h3>9. Governing law</h3>
          <p>These Terms are governed by the laws of the United Arab Emirates, with the courts of Dubai having exclusive jurisdiction.</p>
        </section>

        <section className="card">
          <h3>10. Changes</h3>
          <p>We will notify material changes to these Terms by email or in-product notice at least 14 days before they take effect. Continued use after that date constitutes acceptance.</p>
        </section>
      </main>
    </>
  );
}