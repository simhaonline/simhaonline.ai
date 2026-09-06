import TopBar from '@/components/TopBar';

export const metadata = { title: 'Docs — Simha Edge Router' };

export default function DocsPage() {
  return (
    <>
      <TopBar />
      <main className="container">
        <section className="hero" style={{ paddingBottom: 12 }}>
          <div className="kicker">Documentation</div>
          <h1 style={{ fontSize: 32, margin: '0 0 10px' }}>Getting started</h1>
          <p className="sub">
            The gateway speaks the OpenAI chat-completions dialect. Point your SDK at the edge,
            authenticate with a <code>sek_</code> client key, and pick any discovered model.
          </p>
        </section>

        <section>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3>1. Create a client key</h3>
            <p>
              Sign in to the <a href="/dashboard">dashboard</a>, open <em>Client keys</em>, and
              create a key. The full <code>sek_…</code> value is shown once — store it immediately.
            </p>
          </div>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3>2. Call the gateway</h3>
            <pre className="code">{`curl https://api.simhaonline.ai/v1/chat/completions \\
  -H "Authorization: Bearer sek_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "anthropic/claude-sonnet-4",
    "messages": [{"role": "user", "content": "Summarise the router architecture."}]
  }'`}</pre>
            <p style={{ marginTop: 10 }}>
              Model IDs use the <code>provider/model</code> form from <code>/v1/models</code>; unprefixed
              aliases resolve when the model name is unique across providers.
            </p>
          </div>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3>3. List models</h3>
            <pre className="code">{`curl https://api.simhaonline.ai/v1/models \\
  -H "Authorization: Bearer sek_YOUR_KEY"`}</pre>
            <p style={{ marginTop: 10 }}>
              The catalog is refreshed every few minutes from every configured account; per-model
              policies (input/output ceilings, dedupe) are applied automatically.
            </p>
          </div>
          <div className="card">
            <h3>Rate limits &amp; failover</h3>
            <p>
              Each provider account has rolling minute/day/week ceilings enforced before dispatch.
              When an account hits a provider throttle it enters a cooldown with exponential
              strikes; your request transparently fails over to the next healthy account. Nothing
              is double-billed: failed dispatches are not recorded as usage.
            </p>
          </div>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3>4. Plans &amp; billing (Stripe)</h3>
            <p>
              Every account starts on <strong>Free</strong> (200 requests/day, 3,000/month, 1 API
              key). <strong>Pro</strong> ($19/mo) raises this to 5,000/day and 80,000/month with 5
              keys; <strong>Business</strong> ($99/mo) is unlimited with 20 keys. Paid plans are
              billed through Stripe Checkout — pick a plan on the <a href="/pricing">pricing</a>{' '}
              page, pay by card, and the higher limits apply immediately (the gateway enforces
              them per request). Manage your card, invoices or cancellation anytime via
              <em> Manage billing</em> in the dashboard, which opens the Stripe customer portal.
              Over-limit API calls return <code>429</code> with an upgrade hint.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}