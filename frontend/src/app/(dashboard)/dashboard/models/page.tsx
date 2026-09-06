'use client';

// (4) app/(dashboard)/dashboard/models/page.tsx — provider accounts table
// + "Add provider" Sheet (POST /api/v1/providers).

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { api, ApiError, type Provider, type ProviderInput } from '@/lib/api';
import {
  Badge, Button, Card, Input, Label, Select, Sheet, Switch, Table, Td, Th,
} from '@/components/ui/primitives';

const PROVIDERS = ['OpenAI', 'Anthropic', 'Gemini', 'Ollama'];

function providerTone(provider: string): 'violet' | 'success' | 'warning' | 'default' {
  switch (provider) {
    case 'OpenAI': return 'success';
    case 'Anthropic': return 'violet';
    case 'Gemini': return 'warning';
    default: return 'default';
  }
}

const BLANK: ProviderInput = { provider: 'OpenAI', alias: '', api_key: '', rpm: 60, rpd: 10000, rpw: 50000, enabled: true };

export default function ModelsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState<ProviderInput>(BLANK);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.providers.list();
      setProviders(d.providers || []);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'Session expired — sign in again.' : String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.providers.create(form);
      setSheetOpen(false);
      setForm(BLANK);
      await load();
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Provider) {
    if (!p.id || !window.confirm(`Delete provider "${p.alias || p.name}"?`)) return;
    setBusyId(p.id);
    try { await api.providers.remove(p.id); await load(); }
    catch (err) { setError(String((err as Error).message || err)); }
    finally { setBusyId(null); }
  }

  return (
    <>
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-400">Control Center</p>
          <h1 className="text-lg font-semibold">Models</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
          <Button size="sm" onClick={() => setSheetOpen(true)}><Plus size={14} /> Add provider</Button>
        </div>
      </header>

      <div className="flex-1 space-y-3 p-6">
        {error && <Card className="border-red-500/40 bg-red-500/5"><div className="p-3 text-sm text-red-400">{error}</div></Card>}

        <Table>
          <thead>
            <tr>
              <Th>Provider</Th><Th>Alias</Th><Th>Key</Th><Th className="text-right">Models</Th>
              <Th>Health</Th><Th className="text-right">Requests today</Th><Th className="text-right">Strikes</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id ?? p.name} className="hover:bg-zinc-800/40">
                <Td><Badge tone={providerTone(p.provider)}>{p.provider}</Badge></Td>
                <Td className="font-medium text-zinc-100">{p.alias || p.name}</Td>
                <Td className="font-mono text-xs text-zinc-500">{p.key_last4 ? `••••${p.key_last4}` : '—'}</Td>
                <Td className="text-right tabular-nums">{p.model_count}</Td>
                <Td>
                  <span className={`inline-block h-2 w-2 rounded-full ${p.healthy ? 'bg-green-400' : 'bg-red-400'}`} aria-label={p.healthy ? 'healthy' : 'unhealthy'} />
                </Td>
                <Td className="text-right tabular-nums">{p.requests_today.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{p.strikes}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${p.alias || p.name}`}><Pencil size={13} /></Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${p.alias || p.name}`} onClick={() => void remove(p)} disabled={busyId === p.id}>
                      <Trash2 size={13} className="text-red-400" />
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
            {!loading && !providers.length && (
              <tr><Td colSpan={8} className="py-10 text-center text-zinc-600">No providers connected. Add one to start routing.</Td></tr>
            )}
          </tbody>
        </Table>
      </div>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Add provider">
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="p-provider">Provider</Label>
            <Select id="p-provider" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-alias">Display alias</Label>
            <Input id="p-alias" placeholder="e.g. production-openai" value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-key">API key</Label>
            <Input id="p-key" type="password" placeholder="sk-… / sek-…" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} required autoComplete="off" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="p-rpm">Per minute</Label>
              <Input id="p-rpm" type="number" min={0} value={form.rpm} onChange={(e) => setForm({ ...form, rpm: Number(e.target.value) })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-rpd">Per day</Label>
              <Input id="p-rpd" type="number" min={0} value={form.rpd} onChange={(e) => setForm({ ...form, rpd: Number(e.target.value) })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-rpw">Per week</Label>
              <Input id="p-rpw" type="number" min={0} value={form.rpw} onChange={(e) => setForm({ ...form, rpw: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="p-enabled">Enabled</Label>
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} aria-label="Enable provider" />
          </div>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save provider'}</Button>
        </form>
      </Sheet>
    </>
  );
}