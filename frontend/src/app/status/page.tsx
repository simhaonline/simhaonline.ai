'use client';

import { useEffect, useState } from 'react';
import TopBar from '@/components/TopBar';

interface Check {
  checked_at: string;
  provider_ok: boolean;
  models_ok: boolean;
}

export default function StatusPage() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/status/recent')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setChecks(d.checks || []);
        setLoaded(true);
      })
      .catch((e) => {
        setError(String(e.message || e));
        setLoaded(true);
      });
  }, []);

  const latest = checks[0];
  const allOk = latest ? latest.provider_ok && latest.models_ok : false;

  return (
    <>
      <TopBar />
      <main className="container">
        <section className="hero" style={{ paddingBottom: 12 }}>
          <div className="kicker">System status</div>
          <h1 style={{ fontSize: 32, margin: '0 0 10px' }}>
            {loaded && !error ? (allOk ? 'All systems operational' : 'Degraded') : loaded ? 'Status unavailable' : 'Checking…'}
          </h1>
          {error && <p className="sub">Could not reach the status feed: {error}</p>}
        </section>
        <section>
          <div className="card">
            <h3>Latest component checks</h3>
            {latest && (
              <div style={{ display: 'flex', gap: 10, margin: '12px 0 18px' }}>
                <span className={`pill ${latest.provider_ok ? 'ok' : 'err'}`}>
                  Provider gateway {latest.provider_ok ? 'up' : 'down'}
                </span>
                <span className={`pill ${latest.models_ok ? 'ok' : 'warn'}`}>
                  Model catalog {latest.models_ok ? 'ready' : 'empty'}
                </span>
              </div>
            )}
            <table className="data">
              <thead>
                <tr>
                  <th>Checked at</th>
                  <th>Provider</th>
                  <th>Models</th>
                </tr>
              </thead>
              <tbody>
                {checks.slice(0, 15).map((c) => (
                  <tr key={c.checked_at}>
                    <td>{new Date(c.checked_at + 'Z').toLocaleString()}</td>
                    <td>{c.provider_ok ? 'up' : 'down'}</td>
                    <td>{c.models_ok ? 'ready' : 'empty'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!checks.length && loaded && !error && <p className="sub">No checks recorded yet.</p>}
          </div>
        </section>
      </main>
    </>
  );
}