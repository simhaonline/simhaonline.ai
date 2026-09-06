'use client';

// (7) app/(dashboard)/dashboard/settings/page.tsx — Workspace, Rate limits,
// Semantic cache, Billing, Danger zone.

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type CacheSettings, type GlobalLimits, type Invoice, type WorkspaceInfo } from '@/lib/api';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, Input, Label, Slider, Switch, Table, Td, Th } from '@/components/ui/primitives';

export default function SettingsPage() {
  // Workspace
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [wsName, setWsName] = useState('');
  const [wsSaving, setWsSaving] = useState(false);
  const [wsNotice, setWsNotice] = useState('');

  // Rate limits
  const [limits, setLimits] = useState<GlobalLimits>({ rpm: 60, rpd: 10000, rpw: 50000 });
  const [limitsSaving, setLimitsSaving] = useState(false);
  const [limitsNotice, setLimitsNotice] = useState('');

  // Semantic cache
  const [cache, setCache] = useState<CacheSettings>({ enabled: true, similarity_threshold: 0.92, ttl_hours: 24 });
  const [cacheSaving, setCacheSaving] = useState(false);
  const [cacheNotice, setCacheNotice] = useState('');

  // Billing
  const [planName, setPlanName] = useState('Free');
  const [renewsAt, setRenewsAt] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [portalBusy, setPortalBusy] = useState(false);

  // Danger zone
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [pageError, setPageError] = useState('');

  const load = useCallback(async () => {
    try {
      const w = await api.workspace.get();
      setWs(w); setWsName(w.name);
    } catch { /* workspace endpoint optional in beta */ }
    try {
      const d = await api.billing.invoices();
      setInvoices(d.invoices || []);
    } catch { /* billing may be unconfigured */ }
  }, []);
  useEffect(() => { void load(); }, []);

  function guard(fn: () => Promise<unknown>, setSaving: (v: boolean) => void, setNotice: (v: string) => void) {
    return async () => {
      setSaving(true); setPageError('');
      try { await fn(); }
      catch (e) { setPageError(e instanceof ApiError ? e.message : String((e as Error).message || e)); }
      finally { setSaving(false); }
    };
  }

  const saveWorkspace = guard(async () => {
    await api.workspace.rename(wsName.trim());
    setWs((w) => (w ? { ...w, name: wsName.trim() } : w));
    setWsNotice('Workspace name updated.');
  }, setWsSaving, setWsNotice);

  const saveLimits = guard(async () => {
    await api.settings.limits(limits);
    setLimitsNotice('Global rate limits updated.');
  }, setLimitsSaving, setLimitsNotice);

  const saveCache = guard(async () => {
    await api.settings.cache(cache);
    setCacheNotice('Semantic cache settings updated.');
  }, setCacheSaving, setCacheNotice);

  async function openPortal() {
    setPortalBusy(true); setPageError('');
    try {
      const { portal_url } = await api.billing.portalUrl();
      window.open(portal_url, '_blank', 'noopener');
    } catch (e) {
      setPageError(e instanceof ApiError ? e.message : String((e as Error).message || e));
    } finally { setPortalBusy(false); }
  }

  async function deleteWorkspace() {
    setDeleting(true); setPageError('');
    try {
      await api.workspace.remove();
      window.location.href = 'https://simhaonline.ai/';
    } catch (e) {
      setPageError(e instanceof ApiError ? e.message : String((e as Error).message || e));
      setDeleting(false); setConfirmOpen(false);
    }
  }

  return (
    <>
      <header className="border-b border-zinc-800 px-6 py-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-400">Control Center</p>
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>

      <div className="max-w-2xl flex-1 space-y-4 p-6">
        {pageError && <Card className="border-red-500/40 bg-red-500/5"><CardContent className="text-sm text-red-400">{pageError}</CardContent></Card>}

        {/* Workspace */}
        <Card>
          <CardHeader><CardTitle>Workspace</CardTitle><CardDescription>Identity of this control-center workspace.</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ws-name">Name</Label>
              <Input id="ws-name" value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder={ws?.name || 'Default workspace'} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ws-slug">Slug</Label>
              <Input id="ws-slug" readOnly value={ws?.slug || 'default-workspace'} className="font-mono text-xs text-zinc-500" />
            </div>
            {wsNotice && <p className="text-xs text-green-400" role="status">{wsNotice}</p>}
            <Button onClick={() => void saveWorkspace()} disabled={wsSaving || !wsName.trim()} className="justify-self-start">
              {wsSaving ? 'Saving…' : 'Save workspace'}
            </Button>
          </CardContent>
        </Card>

        {/* Rate limits */}
        <Card>
          <CardHeader><CardTitle>Rate limits</CardTitle><CardDescription>Global rolling windows enforced by the gateway.</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="l-rpm">Per minute</Label>
                <Input id="l-rpm" type="number" min={0} value={limits.rpm} onChange={(e) => setLimits({ ...limits, rpm: Number(e.target.value) })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="l-rpd">Per day</Label>
                <Input id="l-rpd" type="number" min={0} value={limits.rpd} onChange={(e) => setLimits({ ...limits, rpd: Number(e.target.value) })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="l-rpw">Per week</Label>
                <Input id="l-rpw" type="number" min={0} value={limits.rpw} onChange={(e) => setLimits({ ...limits, rpw: Number(e.target.value) })} />
              </div>
            </div>
            {limitsNotice && <p className="text-xs text-green-400" role="status">{limitsNotice}</p>}
            <Button onClick={() => void saveLimits()} disabled={limitsSaving} className="justify-self-start">
              {limitsSaving ? 'Saving…' : 'Save limits'}
            </Button>
          </CardContent>
        </Card>

        {/* Semantic cache */}
        <Card>
          <CardHeader><CardTitle>Semantic cache</CardTitle><CardDescription>pgvector-backed reuse of safe, similar responses.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="c-enabled">Enabled</Label>
              <Switch checked={cache.enabled} onCheckedChange={(v) => setCache({ ...cache, enabled: v })} aria-label="Enable semantic cache" />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="c-threshold">Similarity threshold</Label>
                <span className="tabular-nums text-xs text-violet-400">{cache.similarity_threshold.toFixed(2)}</span>
              </div>
              <Slider value={cache.similarity_threshold} min={0.8} max={1} step={0.01} onValueChange={(v) => setCache({ ...cache, similarity_threshold: v })} aria-label="Similarity threshold" />
              <p className="text-[11px] text-zinc-600">Higher = stricter matching (fewer cache hits, safer reuse).</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-ttl">TTL (hours)</Label>
              <Input id="c-ttl" type="number" min={1} max={720} value={cache.ttl_hours} onChange={(e) => setCache({ ...cache, ttl_hours: Number(e.target.value) })} className="w-28" />
            </div>
            {cacheNotice && <p className="text-xs text-green-400" role="status">{cacheNotice}</p>}
            <Button onClick={() => void saveCache()} disabled={cacheSaving} className="justify-self-start">
              {cacheSaving ? 'Saving…' : 'Save cache settings'}
            </Button>
          </CardContent>
        </Card>

        {/* Billing */}
        <Card>
          <CardHeader><CardTitle>Billing</CardTitle><CardDescription>Plan, portal, and invoice history (Stripe).</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Current plan</span>
              <Badge tone="violet">{planName}</Badge>
              {renewsAt && <span className="text-xs text-zinc-600">· renews {renewsAt}</span>}
            </div>
            <Button variant="secondary" onClick={() => void openPortal()} disabled={portalBusy} className="justify-self-start">
              {portalBusy ? 'Opening…' : 'Manage billing'}
            </Button>
            {invoices.length > 0 && (
              <Table>
                <thead><tr><Th>Invoice</Th><Th>Date</Th><Th className="text-right">Amount</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <Td className="font-mono text-xs">#{inv.id}</Td>
                      <Td className="text-zinc-500">{new Date(inv.created_at).toLocaleDateString()}</Td>
                      <Td className="text-right tabular-nums">${inv.amount_usd}</Td>
                      <Td><Badge tone={inv.status === 'paid' ? 'success' : inv.status === 'open' ? 'warning' : 'default'}>{inv.status}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Danger zone */}
        <Card className="border-red-500/40">
          <CardHeader><CardTitle className="text-red-400">Danger zone</CardTitle><CardDescription>Deletes the workspace and revokes every key. Irreversible.</CardDescription></CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>Delete workspace</Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Delete workspace" width="max-w-md">
        <div className="grid gap-3">
          <p className="text-sm text-zinc-300">
            This permanently deletes the workspace, its API keys, and its OAuth configuration.
            Type <b className="font-mono">DELETE</b> to confirm.
          </p>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="Type DELETE" aria-label="Type DELETE to confirm" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void deleteWorkspace()} disabled={confirmText !== 'DELETE' || deleting}>
              {deleting ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}