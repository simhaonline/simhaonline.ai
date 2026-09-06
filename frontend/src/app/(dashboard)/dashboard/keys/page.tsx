'use client';

// (5) app/(dashboard)/dashboard/keys/page.tsx — client API keys with
// create-once Dialog (full sek_… shown a single time with copy button).

import { useCallback, useEffect, useState } from 'react';
import { Plus, Copy, Check } from 'lucide-react';
import { api, ApiError, type ClientKey } from '@/lib/api';
import { Badge, Button, Card, Dialog, Input, Label, Table, Td, Th } from '@/components/ui/primitives';

export default function KeysPage() {
  const [keys, setKeys] = useState<ClientKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: number; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.clientKeys.list();
      setKeys(d.keys || []);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'Session expired — sign in again.' : String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const d = await api.clientKeys.create(name.trim());
      setCreated({ id: d.id, key: d.key });
      setName('');
      await load();
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setCreating(false);
    }
  }

  async function copyKey() {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.key); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { /* clipboard blocked — value stays selectable in the input */ }
  }

  async function revoke(k: ClientKey) {
    if (!k.id) return;
    setBusyId(k.id);
    try { await api.clientKeys.revoke(k.id); await load(); }
    catch (err) { setError(String((err as Error).message || err)); }
    finally { setBusyId(null); }
  }

  async function remove(k: ClientKey) {
    if (!k.id || !window.confirm(`Permanently delete key "${k.name}"?`)) return;
    setBusyId(k.id);
    try { await api.clientKeys.remove(k.id); await load(); }
    catch (err) { setError(String((err as Error).message || err)); }
    finally { setBusyId(null); }
  }

  function closeDialog() {
    setDialogOpen(false);
    setCreated(null);
    setCopied(false);
  }

  return (
    <>
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-400">Control Center</p>
          <h1 className="text-lg font-semibold">API keys</h1>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}><Plus size={14} /> Create key</Button>
      </header>

      <div className="flex-1 space-y-3 p-6">
        {error && <Card className="border-red-500/40 bg-red-500/5"><div className="p-3 text-sm text-red-400">{error}</div></Card>}

        <Table>
          <thead>
            <tr>
              <Th>Name</Th><Th>Prefix</Th><Th>Created</Th><Th>Last used</Th>
              <Th className="text-right">Requests 30d</Th><Th>Status</Th><Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="hover:bg-zinc-800/40">
                <Td className="font-medium text-zinc-100">{k.name}</Td>
                <Td className="font-mono text-xs text-zinc-500">{k.key_prefix}…</Td>
                <Td className="whitespace-nowrap text-zinc-500">{k.created_at ? new Date(k.created_at).toLocaleDateString() : '—'}</Td>
                <Td className="whitespace-nowrap text-zinc-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}</Td>
                <Td className="text-right tabular-nums">{Number(k.requests_30d || 0).toLocaleString()}</Td>
                <Td><Badge tone={k.active ? 'success' : 'outline'}>{k.active ? 'Active' : 'Revoked'}</Badge></Td>
                <Td>
                  <div className="flex justify-end gap-1.5">
                    {k.active && (
                      <Button variant="outline" size="sm" onClick={() => void revoke(k)} disabled={busyId === k.id}>Revoke</Button>
                    )}
                    <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => void remove(k)} disabled={busyId === k.id}>
                      Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
            {!loading && !keys.length && (
              <tr><Td colSpan={7} className="py-10 text-center text-zinc-600">No keys yet. Create one to call the API.</Td></tr>
            )}
          </tbody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onClose={closeDialog} title={created ? 'Copy your new key' : 'Create API key'}>
        {created ? (
          <div className="grid gap-3">
            <p className="text-xs text-zinc-400">
              This is the only time the full key is shown. Copy it now — it cannot be retrieved later.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={created.key} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="secondary" size="icon" onClick={() => void copyKey()} aria-label="Copy key">
                {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              </Button>
            </div>
            {copied && <p className="text-xs text-green-400">Copied to clipboard.</p>}
            <Button onClick={closeDialog} className="mt-1">Done</Button>
          </div>
        ) : (
          <form onSubmit={create} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="key-name">Key name</Label>
              <Input id="key-name" placeholder="e.g. production-agent" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <Button type="submit" disabled={creating || !name.trim()}>{creating ? 'Creating…' : 'Create key'}</Button>
          </form>
        )}
      </Dialog>
    </>
  );
}