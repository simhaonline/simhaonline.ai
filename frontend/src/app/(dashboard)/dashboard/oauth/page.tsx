'use client';

// (6) app/(dashboard)/dashboard/oauth/page.tsx — per-provider OAuth client
// configuration. Redirect URI is fixed and read-only.

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, CardContent, Input, Label, Select, Switch } from '@/components/ui/primitives';

const PROVIDERS = ['Google', 'GitHub', 'Microsoft'];
const REDIRECT_URI = 'https://simhaonline.ai/auth/callback';

export default function OAuthPage() {
  const [provider, setProvider] = useState('Google');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setNotice('');
    setError('');
  }, [provider]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNotice('');
    setError('');
    try {
      await api.oauth.save({ provider, client_id: clientId.trim(), client_secret: clientSecret, enabled });
      setNotice(`${provider} OAuth configuration saved. Client secret stored encrypted.`);
      setClientSecret('');
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="border-b border-zinc-800 px-6 py-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-400">Control Center</p>
        <h1 className="text-lg font-semibold">OAuth &amp; SSO</h1>
      </header>

      <div className="max-w-xl p-6">
        <Card>
          <CardContent className="p-5">
            <form onSubmit={save} className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="o-provider">Provider</Label>
                <Select id="o-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
                  {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="o-client-id">Client ID</Label>
                <Input id="o-client-id" placeholder={`${provider} OAuth client ID`} value={clientId} onChange={(e) => setClientId(e.target.value)} required autoComplete="off" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="o-secret">Client secret</Label>
                <Input id="o-secret" type="password" placeholder="••••••••••••" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} required autoComplete="new-password" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="o-redirect">Redirect URI</Label>
                <div className="flex gap-2">
                  <Input id="o-redirect" readOnly value={REDIRECT_URI} className="font-mono text-xs text-zinc-400" />
                  <Button
                    type="button" variant="secondary" size="icon"
                    onClick={() => void navigator.clipboard.writeText(REDIRECT_URI)}
                    aria-label="Copy redirect URI" title="Copy redirect URI"
                  >
                    <ExternalLink size={13} />
                  </Button>
                </div>
                <p className="text-[11px] text-zinc-600">Register exactly this URI in the {provider} developer console.</p>
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="o-enabled">Enabled</Label>
                <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable OAuth provider" />
              </div>
              {notice && <p className="text-xs text-green-400" role="status">{notice}</p>}
              {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save configuration'}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}