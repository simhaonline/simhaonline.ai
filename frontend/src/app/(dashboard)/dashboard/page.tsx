'use client';

// (3) app/(dashboard)/dashboard/page.tsx — Overview: KPI cards, 7-day
// requests LineChart, Plan & usage progress bars, Pro CTA, recent activity.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, CalendarDays, Boxes, Shuffle, RefreshCw } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { api, ApiError, type UsageOverview } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge, Button, Table, Th, Td, Progress } from '@/components/ui/primitives';

const KPI = [
  { key: 'requests_today', label: 'Requests today', icon: Activity, hint: 'Rolling 24h' },
  { key: 'requests_month', label: 'Requests this month', icon: CalendarDays, hint: 'Billing period' },
  { key: 'active_models', label: 'Active models', icon: Boxes, hint: 'Routable now' },
  { key: 'failover_events', label: 'Failover events', icon: Shuffle, hint: 'Last 24h' },
] as const;

function fmt(n: number): string {
  return typeof n === 'number' ? n.toLocaleString() : '—';
}

export default function DashboardOverviewPage() {
  const [data, setData] = useState<UsageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await api.usageOverview());
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'Session expired — sign in again.' : String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  return (
    <>
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-400">Control Center</p>
          <h1 className="text-lg font-semibold">Overview</h1>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </header>

      <div className="flex-1 space-y-4 p-6">
        {error && (
          <Card className="border-red-500/40 bg-red-500/5"><CardContent className="text-sm text-red-400">{error}</CardContent></Card>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {KPI.map(({ key, label, icon: Icon, hint }) => (
            <Card key={key}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">{label}</span>
                  <Icon size={14} className="text-violet-400" aria-hidden />
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                  {loading ? '…' : fmt(Number(data?.[key] ?? 0))}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-600">{hint}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {/* 7-day chart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Requests per day</CardTitle>
              <CardDescription>Last 7 days</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              {loading ? (
                <p className="pt-16 text-center text-xs text-zinc-600">Loading chart…</p>
              ) : (
                <LineChart
                  width={720}
                  height={230}
                  data={data?.per_day || []}
                  margin={{ top: 8, right: 12, bottom: 0, left: -18 }}
                >
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#3f3f46' }} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#a1a1aa' }}
                    itemStyle={{ color: '#c4b5fd' }}
                  />
                  <Line type="monotone" dataKey="requests" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 2.5, fill: '#8b5cf6' }} activeDot={{ r: 4 }} />
                </LineChart>
              )}
            </CardContent>
          </Card>

          {/* Plan & usage */}
          <Card>
            <CardHeader>
              <CardTitle>Plan &amp; usage</CardTitle>
              <CardDescription>
                {loading ? '—' : `${data?.plan?.name ?? 'Free'} plan${data?.plan?.renews_at ? ` · renews ${data.plan.renews_at}` : ''}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Daily limit</span>
                  <span className="tabular-nums text-zinc-400">{Math.round(data?.plan_usage?.daily_percent ?? 0)}%</span>
                </div>
                <Progress percent={Number(data?.plan_usage?.daily_percent ?? 0)} />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Monthly limit</span>
                  <span className="tabular-nums text-zinc-400">{Math.round(data?.plan_usage?.monthly_percent ?? 0)}%</span>
                </div>
                <Progress percent={Number(data?.plan_usage?.monthly_percent ?? 0)} />
              </div>
              <Button className="w-full" onClick={() => { window.location.href = '/pricing'; }}>
                Upgrade to Pro
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Recent activity */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Newest routed requests (no prompt content stored)</CardDescription>
            </div>
            <Link href="/dashboard/keys" className="text-xs text-violet-400 hover:text-violet-300">Manage keys →</Link>
          </CardHeader>
          <Table>
            <thead>
              <tr>
                <Th>Timestamp</Th><Th>Model</Th><Th>Provider</Th><Th className="text-right">Tokens</Th>
                <Th className="text-right">Latency</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent || []).map((r, i) => (
                <tr key={i} className="hover:bg-zinc-800/40">
                  <Td className="whitespace-nowrap text-zinc-500">{r.timestamp ? new Date(r.timestamp).toLocaleString() : '—'}</Td>
                  <Td className="font-mono text-xs">{r.model || '—'}</Td>
                  <Td>{r.provider || '—'}</Td>
                  <Td className="text-right tabular-nums">{fmt(Number(r.tokens || 0))}</Td>
                  <Td className="text-right tabular-nums">{r.latency_ms != null ? `${r.latency_ms}ms` : '—'}</Td>
                  <Td>
                    <Badge tone={r.status < 400 ? 'success' : r.status < 500 ? 'warning' : 'danger'}>{r.status}</Badge>
                  </Td>
                </tr>
              ))}
              {!loading && !(data?.recent || []).length && (
                <tr><Td colSpan={6} className="py-8 text-center text-zinc-600">No requests recorded yet.</Td></tr>
              )}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}