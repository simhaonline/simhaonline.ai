import TopBar from '@/components/TopBar';

export const metadata = { title: 'Pricing — Simha Edge Router' };

const tiers = [
  {
    name: 'Operator',
    price: 'Free during early access',
    points: [
      'Up to 3 client API keys',
      'All discovered models',
      'Chat workbench + scheduled prompts',
      '30-day usage history',
    ],
  },
  {
    name: 'Team',
    price: 'Contact us',
    points: [
      'Unlimited client keys',
      'Priority routing + higher ceilings',
      'Team projects and shared library',
      'Full audit exports',
    ],
  },
  {
    name: 'Self-hosted',
    price: 'Open core',
    points: [
      'Run the whole stack yourself',
      'Bring your own provider accounts',
      'PostgreSQL + Timescale + pgvector',
      'Docker Compose deployment',
    ],
  },
];

export default function Pricing() {
  return (
    <>
      <TopBar />
      <main className="container">
        <section className="hero" style={{ paddingBottom: 24 }}>
          <div className="kicker">Pricing</div>
          <h1 style={{ fontSize: 34, margin: '0 0 12px' }}>Simple, capacity-first.</h1>
          <p className="sub">You bring the provider accounts; we route them well.</p>
        </section>
        <section>
          <div className="grid cols-3">
            {tiers.map((t) => (
              <div className="card" key={t.name}>
                <h3>{t.name}</h3>
                <p style={{ marginBottom: 12, fontWeight: 700, color: 'var(--accent)' }}>{t.price}</p>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)', fontSize: 14 }}>
                  {t.points.map((p) => (
                    <li key={p} style={{ marginBottom: 6 }}>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}