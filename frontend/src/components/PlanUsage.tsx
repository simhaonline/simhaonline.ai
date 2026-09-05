'use client';
// Plan & Usage card: current subscription, live quota, invoices, plan actions.
import { useCallback, useEffect, useState } from 'react';

interface Usage {
  plan: string;
  plan_name: string;
  status: string;
  renews_at: string | null;
  cancel_at_period_end: boolean;
  requests_today: number;
  requests_per_day: number;
  requests_30d: number;
  requests_per_month: number;
  rate_limit_per_min: number;
}

interface Invoice {
  id: number;
  plan_id: string;
  amount_usd: string;
  status: string;
  period_start: string;
  period_end: string;
}

export default function PlanUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const u = await fetch('/api/billing/usage');
    if (u.ok) setUsage(await u.json());
    const i = await fetch('/api/billing/invoices');
    if (i.ok) setInvoices((await i.json()).invoices || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(path: string, body: Record<string, unknown>) {
    setMsg('');
    const r = await fetch(`/api/billing/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    setMsg(r.ok ? d.status || 'done' : d.error || 'failed');
    load();
  }

  const pending = invoices.filter((i) => i.status === 'pending');
  const rpd = usage?.requests_per_day ?? 0;
  const pct = usage && rpd > 0 ? Math.min(100, Math.round((usage.requests_today / rpd) * 100)) : 0;

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3>
        Plan &amp; usage {usage && <span className="pill ok">{usage.plan_name}</span>}
        {usage?.cancel_at_period_end && <span className="pill err">ends {usage.renews_at}</span>}
      </h3>
      {usage && (
        <>
          <p style={{ margin: '8px 0 4px', color: 'var(--muted)', fontSize: 14 }}>
            Today: <strong>{usage.requests_today.toLocaleString()}</strong>
            {usage.requests_per_day >= 0 ? ` / ${usage.requests_per_day.toLocaleString()}` : ' (unlimited)'}
            {' · '}Last 30 days: <strong>{usage.requests_30d.toLocaleString()}</strong>
            {usage.requests_per_month >= 0 ? ` / ${usage.requests_per_month.toLocaleString()}` : ''}
            {' · '}{usage.rate_limit_per_min} req/min
            {usage.renews_at && !usage.cancel_at_period_end ? ` · renews ${usage.renews_at}` : ''}
          </p>
          {usage.requests_per_day >= 0 && (
            <div style={{ height: 8, background: 'var(--panel, #222)', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: pct > 80 ? '#e05656' : 'var(--accent)' }} />
            </div>
          )}
        </>
      )}
      {pending.length > 0 && (
        <p style={{ margin: '6px 0', color: 'var(--muted)', fontSize: 14 }}>
          Pending invoice #{pending[0].id} — ${Number(pending[0].amount_usd).toFixed(2)}/mo for{' '}
          {pending[0].plan_id}. Pay by bank transfer; an admin confirms payment to activate.
        </p>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
        <a className="btn" href="/pricing">Change plan</a>
        {usage && usage.plan !== 'free' && (
          <button className="btn" onClick={() => act('cancel', { at_period_end: true })}>
            Cancel at period end
          </button>
        )}
        {usage && usage.plan !== 'free' && (
          <button
            className="btn"
            onClick={async () => {
              const r = await fetch('/api/billing/portal', { method: 'POST' });
              const d = await r.json().catch(() => ({}));
              if (d.portal_url) window.location.href = d.portal_url;
              else setMsg(d.error || 'Portal unavailable');
            }}
          >
            Manage billing (Stripe)
          </button>
        )}
        {msg && <span style={{ color: 'var(--accent)', fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  );
}