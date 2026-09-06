import TopBar from '@/components/TopBar';

export const metadata = { title: 'API documentation' };

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

          <div className="card" style={{ marginBottom: 18 }}>
            <h3>5. API reference</h3>
            <p><b>POST /v1/chat/completions</b> — OpenAI-compatible chat. Body: <code>model</code>, <code>messages</code>, optional <code>stream</code>, <code>temperature</code>, <code>max_tokens</code>, <code>tools</code>.</p>
            <p><b>GET /v1/models</b> — list the catalog. Unauthenticated callers receive a sample with <code>total_models</code>; a valid key returns everything.</p>
            <p><b>POST /v1/embeddings</b> — vector embeddings for routed models that support them (same <code>model</code>/<code>input</code> shape as OpenAI).</p>
            <p><b>Headers</b> — <code>Authorization: Bearer sek_…</code> (required), <code>X-Simha-Routing-Mode: quality|fast|cost</code> (optional), <code>X-Request-ID</code> (propagated for tracing).</p>
            <p><b>Streaming</b> — set <code>"stream": true</code> to receive Server-Sent Events in OpenAI chunk format; failover happens before the first chunk, never mid-stream.</p>
            <p><b>Compare mode</b> — header <code>X-Simha-Mode: compare</code> runs the request against up to 3 models, judges the responses, and returns the synthesis with per-model scores.</p>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <h3>6. Error codes</h3>
            <p><code>401</code> — missing/invalid key. <code>403</code> — account not verified. <code>404</code> <code>model_not_found</code> — unknown model slug (check /v1/models). <code>429</code> <code>upstream_capacity</code> — every account for the model is cooling down or at capacity; honor <code>Retry-After</code>. <code>429</code> (login) — too many attempts, account temporarily locked. 5xx — upstream/provider problems, always retryable.</p>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <h3>7. SDK examples</h3>
            <p><b>Node.js / TypeScript</b> — the official <code>openai</code> npm package works unchanged:</p>
            <pre className="code">{`import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://api.simhaonline.ai/v1',
  apiKey: process.env.SIMHA_API_KEY,
});

const stream = await client.chat.completions.create({
  model: 'anthropic/claude-sonnet-4',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}`}</pre>
            <p><b>Python</b> — same shape as the quickstart above; add <code>stream=True</code> for SSE.</p>
            <p><b>Key rotation</b> — create a new key in the dashboard, switch your app, then delete the old one. Keys are shown once at creation.</p>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <h3>8. Failover behavior</h3>
            <p>
              Routing order: capability match → health (cooldowns/strikes) → routing mode
              (best quality / fastest / lowest cost) → round-robin within equals. Provider 429/5xx
              triggers strike-based cooldown and instant failover; provider 402 (credit exhausted)
              circuit-breaks the account for up to an hour. Unknown models return
              <code>404 model_not_found</code> instead of wasting a retry.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}