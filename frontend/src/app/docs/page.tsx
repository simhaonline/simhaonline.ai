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
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "Summarise the router architecture."}]
  }'`}</pre>
            <p style={{ marginTop: 10 }}>
              Streaming works with <code>"stream": true</code> (SSE chunks, OpenAI shape).
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
        </section>
      </main>
    </>
  );
}