'use client';

import { useEffect, useMemo, useState } from 'react';
import TopBar from '@/components/TopBar';

interface Check {
  checked_at: string;
  provider_ok: boolean;
  models_ok: boolean;
}

// The worker emits ISO timestamps already carrying a UTC offset
// ("...+00:00"). Appending 'Z' (legacy) produced "Invalid Date" for every
// row (audit C2) — parse defensively instead.
function parseWhen(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
  // 30-day style uptime from the visible window (checks run every minute)
  const uptime = useMemo(() => {
    if (!checks.length) return null;
    const ok = checks.filter((c) => c.provider_ok && c.models_ok).length;
    return (100 * ok) / checks.length;
  }, [checks]);

  return (
    <>
      <TopBar />
      <main className="container">
        <section className="hero" style={{ paddingBottom: 12 }}>
          <div className="kicker">System status</div>
          <h1 style={{ fontSize: 32, margin: '0 0 10px' }}>
            {loaded && !error ? (checks.length ? (allOk ? 'All systems operational' : 'Degraded') : 'Status unavailable') : loaded ? 'Status unavailable' : 'Checking…'}
          </h1>
          {uptime !== null && (
            <p className="sub">Provider gateway uptime: {uptime.toFixed(2)}% over the last {checks.length} checks.</p>
          )}
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
            {!checks.length && loaded && !error && (
              <p className="sub">No health checks have been recorded yet. Checks run every minute once the platform worker is active — this table fills automatically.</p>
            )}
            {checks.length > 0 && (
              <table className="data">
                <thead>
                  <tr>
                    <th>Checked at</th>
                    <th>Provider</th>
                    <th>Models</th>
                  </tr>
                </thead>
                <tbody>
                  {checks.slice(0, 15).map((c) => {
                    const when = parseWhen(c.checked_at);
                    return (
                      <tr key={c.checked_at}>
                        <td>{when ? when.toLocaleString() : c.checked_at}</td>
                        <td>{c.provider_ok ? 'up' : 'down'}</td>
                        <td>{c.models_ok ? 'ready' : 'empty'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </>
  );
}