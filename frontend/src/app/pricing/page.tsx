'use client';
import TopBar from '@/components/TopBar';
import { useEffect, useState } from 'react';

interface Plan {
  id: string;
  name: string;
  price_monthly_usd: string;
  requests_per_day: number;
  requests_per_month: number;
  max_keys: number;
  rate_limit_per_min: number;
}

function fmt(n: number) {
  return n < 0 ? 'Unlimited' : n.toLocaleString();
}

export default function Pricing() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    fetch('/api/billing/plans')
      .then((r) => r.json())
      .then((d) => setPlans(d.plans || []))
      .catch(() => setPlans([]));
  }, []);

  async function subscribe(planId: string) {
    setBusy(planId);
    setMsg('');
    const r = await fetch('/api/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_id: planId }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy('');
    if (r.status === 401) {
      window.location.href = '/login?next=/pricing';
      return;
    }
    if (r.ok) {
      setMsg(
        d.status === 'active'
          ? `Activated the ${planId} plan.`
          : `Invoice created — pay via bank transfer and an admin will confirm (see dashboard).`
      );
    } else {
      setMsg(d.error || 'Something went wrong');
    }
  }

  return (
    <>
      <TopBar />
      <main className="container">
        <section className="hero" style={{ paddingBottom: 24 }}>
          <div className="kicker">Pricing</div>
          <h1 style={{ fontSize: 34, margin: '0 0 12px' }}>Simple, capacity-first.</h1>
          <p className="sub">You bring the provider accounts; we route them well. Cancel anytime.</p>
          {msg && <p style={{ color: 'var(--accent)', marginTop: 10 }}>{msg}</p>}
        </section>
        <section>
          <div className="grid cols-3">
            {(plans || []).map((p) => (
              <div className="card" key={p.id}>
                <h3>{p.name}</h3>
                <p style={{ marginBottom: 12, fontWeight: 700, color: 'var(--accent)' }}>
                  {Number(p.price_monthly_usd) === 0 ? 'Free' : `$${Number(p.price_monthly_usd)}/mo`}
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)', fontSize: 14 }}>
                  <li style={{ marginBottom: 6 }}>{fmt(p.requests_per_day)} requests / day</li>
                  <li style={{ marginBottom: 6 }}>{fmt(p.requests_per_month)} requests / month</li>
                  <li style={{ marginBottom: 6 }}>{p.max_keys} API key{p.max_keys === 1 ? '' : 's'}</li>
                  <li style={{ marginBottom: 6 }}>{p.rate_limit_per_min} req/min burst limit</li>
                  <li style={{ marginBottom: 6 }}>All discovered models</li>
                </ul>
                <button
                  className="btn"
                  style={{ marginTop: 14, width: '100%' }}
                  disabled={busy === p.id}
                  onClick={() => subscribe(p.id)}
                >
                  {busy === p.id ? '…' : Number(p.price_monthly_usd) === 0 ? 'Switch to Free' : `Get ${p.name}`}
                </button>
              </div>
            ))}
          </div>
          {plans && plans.length === 0 && (
            <p className="sub">Plans are being set up — check back shortly.</p>
          )}
        </section>
      </main>
    </>
  );
}