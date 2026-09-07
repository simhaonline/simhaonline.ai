'use client';

// app/(dashboard)/dashboard/users/page.tsx — admin user management:
// list users with usage, change role, activate/deactivate, reset password,
// delete, create. Backed by admin.controller.ts (admin/api/users*).

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

interface UserRow {
  id: number;
  email: string;
  role: string;
  active: boolean;
  created_at: string;
}

interface UserReport {
  id: string;
  email: string;
  role: string;
  active: boolean;
  requests: string;
  total_tokens: string;
  last_request_at: string | null;
}

export default function UsersAdminPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [reports, setReports] = useState<Record<string, UserReport>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('operator');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [u, r] = await Promise.all([
        api.adminUsers(),
        api.adminUserReports().catch(() => ({ users: [] as UserReport[] })),
      ]);
      setUsers(u.users);
      const map: Record<string, UserReport> = {};
      for (const row of (r.users || []) as UserReport[]) map[String(row.id)] = row;
      setReports(map);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 401)) {
        setError('Administrator access is required for user management.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load users');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function act(id: number, fn: () => Promise<unknown>, okMsg: string) {
    setBusyId(id);
    setNotice('');
    try {
      await fn();
      setNotice(okMsg);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  async function createUser() {
    if (!newEmail.trim() || !newPassword.trim()) { setNotice('Email and password required'); return; }
    setCreating(true);
    setNotice('');
    try {
      await api.adminCreateUser({ email: newEmail.trim(), password: newPassword, role: newRole });
      setNotice(`Created ${newEmail.trim()}`);
      setNewEmail(''); setNewPassword('');
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-400">Administration</p>
          <h1 className="text-xl font-semibold">Users</h1>
        </div>
        <button onClick={() => void load()} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 cursor-pointer">Refresh</button>
      </header>

      {notice && <p className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-200" role="status">{notice}</p>}
      {error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">{error}</p>}

      {/* create user */}
      <section className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-[13px] font-semibold text-zinc-200">Invite a user</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email" placeholder="email@example.com"
            className="min-w-[220px] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
          />
          <input
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" placeholder="Initial password"
            className="min-w-[180px] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
          />
          <select
            value={newRole} onChange={(e) => setNewRole(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
          >
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
          <button
            onClick={() => void createUser()} disabled={creating}
            className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50 cursor-pointer"
          >
            {creating ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </section>

      {/* users table */}
      <section className="mt-5 overflow-x-auto rounded-xl border border-zinc-800">
        {loading ? (
          <p className="px-4 py-8 text-center text-xs text-zinc-500">Loading users…</p>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900 text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Requests</th>
                <th className="px-4 py-2.5">Tokens</th>
                <th className="px-4 py-2.5">Last seen</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const rep = reports[String(u.id)];
                const busy = busyId === u.id;
                return (
                  <tr key={u.id} className="border-b border-zinc-800/60 last:border-0">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-zinc-100">{u.email}</p>
                      <p className="text-[11px] text-zinc-600">joined {fmtDate(u.created_at)}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={u.role} disabled={busy || u.id === 1}
                        onChange={(e) => void act(u.id, () => api.adminPatchUser(u.id, { role: e.target.value }), `Role updated for ${u.email}`)}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-violet-500 focus:outline-none disabled:opacity-50"
                      >
                        <option value="operator">operator</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400">{rep?.requests ?? '—'}</td>
                    <td className="px-4 py-2.5 text-zinc-400">{rep?.total_tokens ?? '—'}</td>
                    <td className="px-4 py-2.5 text-zinc-400">{fmtDate(rep?.last_request_at ?? null)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${u.active ? 'bg-green-500/10 text-green-400' : 'bg-zinc-700/40 text-zinc-400'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${u.active ? 'bg-green-400' : 'bg-zinc-500'}`} aria-hidden />
                        {u.active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => void act(u.id, () => api.adminPatchUser(u.id, { active: !u.active }), u.active ? `Disabled ${u.email}` : `Enabled ${u.email}`)}
                          disabled={busy || u.id === 1}
                          className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
                        >
                          {u.active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => {
                            const pw = window.prompt(`New password for ${u.email}`);
                            if (pw) void act(u.id, () => api.adminPatchUser(u.id, { password: pw }), `Password reset for ${u.email}`);
                          }}
                          disabled={busy}
                          className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
                        >
                          Reset password
                        </button>
                        <button
                          onClick={() => {
                            if (!window.confirm(`Delete ${u.email}? This cannot be undone.`)) return;
                            void act(u.id, () => api.adminDeleteUser(u.id), `Deleted ${u.email}`);
                          }}
                          disabled={busy || u.id === 1}
                          className="rounded-md border border-red-500/30 px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/10 disabled:opacity-40 cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && !users.length && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-zinc-500">No users found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>
      <p className="mt-3 text-[11px] text-zinc-600">Admin account (id 1) cannot be disabled or deleted. Password resets take effect on the user's next sign-in.</p>
    </div>
  );
}