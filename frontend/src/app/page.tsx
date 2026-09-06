import HomeMarketing from '@/components/HomeMarketing';
import TopBar from '@/components/TopBar';
import Link from 'next/link';
export default HomeMarketing;

function LegacyHome() {
  return (
    <>
      <TopBar />
      <main>
        <section className="hero container">
          <div className="kicker">Simha Online — Edge Router</div>
          <h1>One OpenAI-compatible endpoint for every LLM you run.</h1>
          <p className="sub">
            Simha Edge Router fronts your Claude, GPT, Gemini and self-hosted Ollama accounts with
            rolling-window rate limits, automatic failover, semantic caching, and honest usage
            accounting — behind a single hardened gateway.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link href="/signup" className="btn primary">
              Create operator account
            </Link>
            <Link href="/docs" className="btn">
              Read the docs
            </Link>
          </div>
        </section>

        <section className="container">
          <div className="grid cols-3">
            <div className="card">
              <h3>Multi-account routing</h3>
              <p>
                Pool many provider accounts per model. Requests pick the account with real capacity
                — minute, day and week windows enforced in Valkey with a 90% soft threshold.
              </p>
            </div>
            <div className="card">
              <h3>Failover that respects your tokens</h3>
              <p>
                Cooldowns on throttles, strikes on repeats, LRU tie-breaks, and model-unavailable
                detection — retries land on a healthy account without duplicating spend.
              </p>
            </div>
            <div className="card">
              <h3>Postgres + Timescale + pgvector</h3>
              <p>
                Request history lands in TimescaleDB-hypertables, dashboards read continuous
                rollups, and semantic caching embeds prompts with pgvector.
              </p>
            </div>
            <div className="card">
              <h3>OpenAI-compatible surface</h3>
              <p>
                Your existing SDKs keep working: <code>/v1/chat/completions</code>,{' '}
                <code>/v1/models</code>, streaming SSE, and per-client keys with spend ceilings.
              </p>
            </div>
            <div className="card">
              <h3>Operator workbench</h3>
              <p>
                Chat, projects, scheduled prompts, saved prompts and image generation — same
                account, same keys, same billing view.
              </p>
            </div>
            <div className="card">
              <h3>Hardened edge</h3>
              <p>
                nginx TLS terminates the public edge; the gateway and control plane never face the
                internet directly. Audit log records every admin action.
              </p>
            </div>
          </div>
        </section>

        <section className="container">
          <div className="kicker">Drop-in compatible</div>
          <pre className="code">{`from openai import OpenAI

client = OpenAI(
    base_url="https://api.simhaonline.ai/v1",
    api_key="sek_...",        # your Simha Edge Router key
)

resp = client.chat.completions.create(
    model="gpt-4o",           # or claude-sonnet-4, gemini-2.0-flash, llama3:70b
    messages=[{"role": "user", "content": "Hello, router."}],
    stream=False,
)`}</pre>
        </section>
      </main>
      <footer>
        <div className="container">
          Simha Online · Dubai · <Link href="/status">system status</Link>
        </div>
      </footer>
    </>
  );
}
