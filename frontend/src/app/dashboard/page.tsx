'use client';

import { useCallback, useEffect, useState } from 'react';
import TopBar from '@/components/TopBar';
import PlanUsage from '@/components/PlanUsage';

interface AccountRow {
  name: string;
  provider: string;
  protocol: string;
  api_prefix: string;
  api_key: string;
  limits: Record<string, { used: number; limit: number | null; percent: number }>;
  cooldown_until: number;
  tokens: { prompt: number; completion: number; total: number };
}

interface KeyRow {
  id: number;
  name: string;
  key_prefix: string;
  active: boolean;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
}

interface Overview {
  accounts?: AccountRow[];
  models?: string[];
  history?: Array<{
    timestamp: string;
    account: string;
    model: string;
    status: number;
    tokens: number;
  }>;
  auth?: { admin: boolean; role: string };
  operator_scope?: string;
}

export default function DashboardPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [authError, setAuthError] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState('');
  const [newAccount, setNewAccount] = useState({ name: '', base_url: '', api_key: '', provider: 'custom', protocol: 'openai', api_prefix: '/v1' });

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/overview');
    if (r.status === 401) {
      setAuthError(true);
      return;
    }
    setOv(await r.json());
    const k = await fetch('/api/client-keys');
    if (k.ok) setKeys((await k.json()).keys || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createKey() {
    if (!newKeyName.trim()) return;
    const r = await fetch('/api/client-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newKeyName.trim() }),
    });
    if (!r.ok) return;
    const d = await r.json();
    setCreatedKey(d.key);
    setNewKeyName('');
    const k = await fetch('/api/client-keys');
    if (k.ok) setKeys((await k.json()).keys || []);
  }

  async function revokeKey(id: number) {
    await fetch(`/api/client-keys/${id}`, { method: 'DELETE' });
    setKeys((ks) => ks.map((k) => (k.id === id ? { ...k, active: false } : k)));
  }

  async function addAccount() {
    const r = await fetch('/api/admin/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newAccount),
    });
    if (r.ok) {
      setNewAccount({ name: '', base_url: '', api_key: '', provider: 'custom', protocol: 'openai', api_prefix: '/v1' });
      load();
    }
  }

  async function refreshModels() {
    await fetch('/api/admin/models/refresh', { method: 'POST' });
  }

  if (authError) {
    return (
      <>
        <TopBar />
        <main className="container" style={{ paddingTop: 80, textAlign: 'center' }}>
          <h1 style={{ fontSize: 26 }}>Sign in required</h1>
          <p className="sub" style={{ margin: '12px auto 24px' }}>
            The dashboard shows your keys, usage and (for admins) provider accounts.
          </p>
          <a className="btn primary" href="/login">
            Sign in
          </a>
        </main>
      </>
    );
  }

  const isAdmin = ov?.auth?.admin === true;

  return (
    <>
      <TopBar />
      <main className="container">
        <section style={{ padding: '32px 0 8px' }}>
          <div className="kicker">Dashboard</div>
          <h1 style={{ fontSize: 28, margin: '0 0 6px' }}>
            {isAdmin ? 'Administrator console' : 'Operator console'}
          </h1>
          {ov?.operator_scope === 'models_only' && (
            <p className="sub">Operator view: model catalog only.</p>
          )}
        </section>

        {isAdmin && (
          <section>
            <div className="card" style={{ marginBottom: 18 }}>
              <h3>Provider accounts</h3>
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Provider</th>
                    <th>Key</th>
                    <th>Min %</th>
                    <th>Day %</th>
                    <th>Week %</th>
                    <th>Cooling</th>
                    <th>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {(ov?.accounts || []).map((a) => (
                    <tr key={a.name}>
                      <td>{a.name}</td>
                      <td>
                        {a.provider}/{a.protocol}
                      </td>
                      <td>{a.api_key}</td>
                      <td>{a.limits?.minute?.percent ?? 0}%</td>
                      <td>{a.limits?.day?.percent ?? 0}%</td>
                      <td>{a.limits?.week?.percent ?? 0}%</td>
                      <td>
                        {a.cooldown_until > Date.now() / 1000 ? (
                          <span className="pill err">cooling</span>
                        ) : (
                          <span className="pill ok">ready</span>
                        )}
                      </td>
                      <td>{(a.tokens?.total || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!ov?.accounts?.length && <p className="sub">No accounts configured yet.</p>}
            </div>

            <div className="grid cols-2" style={{ marginBottom: 18 }}>
              <div className="card">
                <h3>Add provider account</h3>
                <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                  <input placeholder="name" value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} />
                  <input placeholder="base_url (https://…)" value={newAccount.base_url} onChange={(e) => setNewAccount({ ...newAccount, base_url: e.target.value })} />
                  <input placeholder="api_key" value={newAccount.api_key} onChange={(e) => setNewAccount({ ...newAccount, api_key: e.target.value })} />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input placeholder="provider" value={newAccount.provider} onChange={(e) => setNewAccount({ ...newAccount, provider: e.target.value })} />
                    <input placeholder="protocol" value={newAccount.protocol} onChange={(e) => setNewAccount({ ...newAccount, protocol: e.target.value })} />
                    <input placeholder="api_prefix" value={newAccount.api_prefix} onChange={(e) => setNewAccount({ ...newAccount, api_prefix: e.target.value })} />
                  </div>
                  <button className="btn primary" onClick={addAccount}>
                    Save account
                  </button>
                </div>
              </div>
              <div className="card">
                <h3>Model catalog</h3>
                <button className="btn" style={{ marginBottom: 12 }} onClick={refreshModels}>
                  Refresh discovery
                </button>
                <div style={{ maxHeight: 220, overflowY: 'auto', fontSize: 13, color: 'var(--muted)' }}>
                  {(ov?.models || []).map((m) => (
                    <div key={m} style={{ padding: '2px 0' }}>
                      {m}
                    </div>
                  ))}
                  {!ov?.models?.length && <p className="sub">No models discovered yet.</p>}
                </div>
              </div>
            </div>
          </section>
        )}

        <section style={{ paddingBottom: 8 }}>
          <PlanUsage />
        </section>

        <section style={{ paddingBottom: 60 }}>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3>Client API keys</h3>
            <div style={{ display: 'flex', gap: 10, margin: '12px 0' }}>
              <input
                placeholder="key name (e.g. my-laptop)"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                style={{ maxWidth: 320 }}
              />
              <button className="btn primary" onClick={createKey}>
                Create key
              </button>
            </div>
            {createdKey && (
              <pre className="code" style={{ color: 'var(--ok)' }}>
                {createdKey}
{'\n'}Copy this key now — it will not be shown again.
              </pre>
            )}
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Status</th>
                  <th>Requests</th>
                  <th>Last used</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td>{k.key_prefix}…</td>
                    <td>
                      {k.active ? <span className="pill ok">active</span> : <span className="pill err">revoked</span>}
                    </td>
                    <td>{k.request_count}</td>
                    <td>{k.last_used_at ? new Date(k.last_used_at + 'Z').toLocaleString() : 'never'}</td>
                    <td>
                      {k.active && (
                        <button className="btn" onClick={() => revokeKey(k.id)}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!keys.length && <p className="sub">No client keys yet — create one above.</p>}
          </div>

          <div className="card">
            <h3>Recent requests</h3>
            <table className="data">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Account</th>
                  <th>Model</th>
                  <th>Status</th>
                  <th>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {(ov?.history || []).slice(0, 20).map((h, i) => (
                  <tr key={i}>
                    <td>{new Date(h.timestamp + 'Z').toLocaleString()}</td>
                    <td>{h.account}</td>
                    <td>{h.model}</td>
                    <td>{h.status}</td>
                    <td>{h.tokens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!ov?.history?.length && <p className="sub">No requests recorded yet.</p>}
          </div>
        </section>
      </main>
    </>
  );
}