'use client';

// (1) app/(chat)/layout.tsx — 260px sidebar with 4 tab pills, grouped
// conversation list, Library grid, Studio personas, Integrations, footer.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { ArrowLeft, Check, ChevronDown, Copy, Download, MoreVertical, Pencil, Pin, Plus, Search, Share2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { wbApi, ApiError } from '@/lib/wb-api';
import { useChat } from '@/store/chat';
import { useHotkeys } from '@/lib/useHotkeys';
import { CommandPalette } from '@/components/chat/CommandPalette';

const TABS = ['Chats', 'Library', 'Studio', 'Integrations'] as const;
type Tab = (typeof TABS)[number];

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function groupOf(iso: string): string {
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startToday) return 'Today';
  if (d.getTime() >= startToday - 86400000) return 'Yesterday';
  if (d.getTime() >= startToday - 7 * 86400000) return 'Last 7 days';
  return 'Older';
}

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<Tab>('Chats');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);
  const [health, setHealth] = useState<{ status: string; latency_ms: number } | null>(null);
  const { conversations, setConversations, toggleCompareMode, compareMode } = useChat();

  const loadConversations = useCallback(async () => {
    try {
      const d = await wbApi.conversations.list();
      setConversations(d.conversations || []);
    } catch { /* 401 → guard page handles */ }
  }, [setConversations]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => {
    const t = setInterval(() => {
      wbApi.health().then(setHealth).catch(() => setHealth({ status: 'error', latency_ms: 0 }));
    }, 30000);
    wbApi.health().then(setHealth).catch(() => setHealth({ status: 'error', latency_ms: 0 }));
    return () => clearInterval(t);
  }, []);

  async function newConversation() {
    if (creating) return;
    setCreating(true);
    try {
      const c = await wbApi.conversations.create();
      await loadConversations();
      router.push(`/chat/${c.id}`);
    } finally {
      setCreating(false);
    }
  }

  useHotkeys({
    onNewConversation: () => void newConversation(),
    onCommandPalette: () => setPaletteOpen(true),
    onToggleCompare: () => toggleCompareMode(),
  });

  const visible = conversations.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()));
  const pinned = visible.filter((c) => c.pinned);
  const groups = ['Today', 'Yesterday', 'Last 7 days', 'Older']
    .map((g) => ({ g, items: visible.filter((c) => !c.pinned && groupOf(c.updated_at) === g) }))
    .filter((x) => x.items.length);

  return (
    <div className="wb-root flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
        {/* logo row */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-3">
          <Link href="https://platform.simhaonline.ai" aria-label="Back to Control Center" className="flex items-center gap-2 text-sm font-semibold">
            <ArrowLeft size={15} className="text-zinc-500 hover:text-zinc-200" />
            <span className="grid h-5 w-5 place-items-center rounded-md bg-violet-500 text-black">⌁</span>
            Simha Workbench
          </Link>
        </div>

        {/* new conversation */}
        <div className="px-3 pt-3">
          <button
            onClick={() => void newConversation()}
            disabled={creating}
            className="flex w-full items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-100 hover:border-violet-500 cursor-pointer disabled:opacity-50"
          >
            <Plus size={13} /> New conversation <kbd className="ml-auto text-[9px] text-zinc-600">Ctrl+N</kbd>
          </button>
          <div className="mt-2 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
            <Search size={12} className="text-zinc-600" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workspace"
              aria-label="Search workspace"
              onFocus={() => setPaletteOpen(true)}
              className="w-full bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
            />
            <kbd className="text-[9px] text-zinc-600">Ctrl+K</kbd>
          </div>
        </div>

        {/* tab pills — segmented control */}
        <div className="mx-3 mt-3 flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-selected={tab === t}
              role="tab"
              className={cn(
                'flex-1 rounded-[6px] px-2 py-1.5 text-[11.5px] font-medium transition-colors cursor-pointer',
                tab === t ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-200',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* tab bodies */}
        <div className="flex-1 overflow-auto px-2 py-2">
          {tab === 'Chats' && (
            <div className="space-y-3">
              {pinned.length > 0 && (
                <div>
                  <p className="px-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-600">Pinned</p>
                  {pinned.map((c) => (
                    <ConversationRow
                      key={`pin-${c.id}`} c={c} active={pathname === `/chat/${c.id}`}
                      renaming={renaming === c.id} renameText={renameText}
                      setRenameText={setRenameText}
                      onRenameSave={async () => {
                        if (renameText.trim()) await wbApi.conversations.rename(c.id, renameText.trim());
                        setRenaming(null); await loadConversations();
                      }}
                      onStartRename={() => { setRenaming(c.id); setRenameText(c.title); }}
                      onPin={async () => { await wbApi.conversations.pin(c.id, !c.pinned); await loadConversations(); }}
                      onDelete={async () => {
                        await wbApi.conversations.remove(c.id);
                        if (pathname === `/chat/${c.id}`) router.push('/chat');
                        await loadConversations();
                      }}
                    />
                  ))}
                </div>
              )}
              {groups.map(({ g, items }) => (
                <div key={g}>
                  <p className="px-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-600">{g}</p>
                  {items.map((c) => (
                    <ConversationRow
                      key={c.id} c={c} active={pathname === `/chat/${c.id}`}
                      renaming={renaming === c.id} renameText={renameText}
                      setRenameText={setRenameText}
                      onRenameSave={async () => {
                        if (renameText.trim()) await wbApi.conversations.rename(c.id, renameText.trim());
                        setRenaming(null); await loadConversations();
                      }}
                      onStartRename={() => { setRenaming(c.id); setRenameText(c.title); }}
                      onPin={async () => { await wbApi.conversations.pin(c.id, !c.pinned); await loadConversations(); }}
                      onDelete={async () => {
                        await wbApi.conversations.remove(c.id);
                        if (pathname === `/chat/${c.id}`) router.push('/chat');
                        await loadConversations();
                      }}
                    />
                  ))}
                </div>
              ))}
              {!visible.length && (
                <div className="grid place-items-center gap-3 px-2 py-16 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-xl border border-zinc-800 bg-zinc-800/60 text-lg text-violet-400">⌁</span>
                  <p className="text-[12.5px] leading-5 text-zinc-500">
                    No conversations yet.
                    <br />
                    Press <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-300">Ctrl+N</kbd> to start
                  </p>
                </div>
              )}
            </div>
          )}
          {tab === 'Library' && <LibraryTab />}
          {tab === 'Studio' && <StudioTab />}
          {tab === 'Integrations' && <IntegrationsTab />}
        </div>

        {/* footer */}
        <div className="border-t border-zinc-800 px-3 py-3">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                !health || (health.status === 'ok' && health.latency_ms <= 1000) ? 'bg-green-400' : health.status === 'ok' ? 'bg-amber-400' : 'bg-red-400',
              )}
              aria-hidden
            />
            Router online
            <Link href="https://platform.simhaonline.ai" className="ml-auto text-[11px] text-zinc-400 hover:text-zinc-100">
              Control Center
            </Link>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              onClick={() => toggleCompareMode()}
              aria-pressed={compareMode.enabled}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] cursor-pointer',
                compareMode.enabled ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200',
              )}
            >
              ⇄ Compare
            </button>
            <WorkspaceSelector />
          </div>
        </div>
      </aside>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNewConversation={() => void newConversation()} />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

function ConversationRow({
  c, active, renaming, renameText, setRenameText, onRenameSave, onStartRename, onPin, onDelete,
}: {
  c: { id: number; title: string; updated_at: string };
  active: boolean;
  renaming: boolean;
  renameText: string;
  setRenameText: (v: string) => void;
  onRenameSave: () => void;
  onStartRename: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="group relative">
      {renaming ? (
        <input
          autoFocus
          value={renameText}
          onChange={(e) => setRenameText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onRenameSave(); if (e.key === 'Escape') onRenameSave(); }}
          className="w-full rounded-md border border-violet-500 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none"
        />
      ) : (
        <Link
          href={`/chat/${c.id}`}
          className={cn(
            'flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px] transition-colors hover:bg-zinc-800/80',
            active && 'bg-zinc-800 text-zinc-100',
          )}
        >
          <span className="min-w-0 flex-1 truncate text-zinc-300 group-hover:text-zinc-100">{c.title}</span>
          <span className="ml-2 shrink-0 text-[10px] text-zinc-600">{relative(c.updated_at)}</span>
        </Link>
      )}
      {!renaming && (
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={`Options for ${c.title}`}
          className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-200 group-hover:block cursor-pointer"
        >
          <MoreVertical size={12} />
        </button>
      )}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-1 top-full z-30 w-44 rounded-md border border-zinc-700 bg-zinc-900 py-1 text-xs shadow-xl">
            <MenuItem icon={<Pencil size={12} />} label="Rename" onClick={() => { onRenameSave; onStartRename(); setMenuOpen(false); }} />
            <MenuItem icon={<Pin size={12} />} label="Pin to top" onClick={() => { onPin(); setMenuOpen(false); }} />
            <MenuItem icon={<Share2 size={12} />} label="Share" onClick={async () => {
              try {
                const { url } = await wbApi.conversations.share(c.id);
                await navigator.clipboard.writeText(url);
              } catch { /* blocked */ }
              setMenuOpen(false);
            }} />
            <MenuItem icon={<Copy size={12} />} label="Export" onClick={async () => {
              const d = await wbApi.conversations.messages(c.id);
              const md = d.messages.map((m) => `**${m.role}**\n\n${m.content}`).join('\n\n---\n\n');
              const blob = new Blob([md], { type: 'text/markdown' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `${c.title.replace(/[^\w-]+/g, '_')}.md`;
              a.click();
              URL.revokeObjectURL(a.href);
              setMenuOpen(false);
            }} />
            <MenuItem icon={<Trash2 size={12} />} label="Delete" danger onClick={() => { onDelete(); setMenuOpen(false); }} />
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-800 cursor-pointer',
        danger ? 'text-red-400' : 'text-zinc-300',
      )}
    >
      {icon}{label}
    </button>
  );
}

// ── Library tab ──────────────────────────────────────────────────────────────

import { V1Prompt } from '@/lib/wb-api';
function LibraryTab() {
  const [prompts, setPrompts] = useState<V1Prompt[]>([]);
  const [query, setQuery] = useState('');
  const setDraft = useChat((s) => s.setDraft);

  const load = useCallback(async () => {
    try { setPrompts((await wbApi.prompts.list()).prompts || []); } catch { /* optional */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function remove(id: number) {
    await wbApi.prompts.remove(id);
    await load();
  }

  const visible = prompts.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search prompts…"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
      />
      {visible.map((p) => (
        <div key={p.id} className="group relative rounded-md border border-zinc-800 bg-zinc-950 p-2.5 hover:border-zinc-700">
          <button onClick={() => setDraft(p.content)} className="w-full text-left cursor-pointer">
            <div className="flex items-center justify-between gap-2">
              <b className="truncate text-xs text-zinc-100">{p.title}</b>
              <Badge>{p.category || 'General'}</Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] text-zinc-500">{p.content}</p>
          </button>
          <button
            onClick={() => void remove(p.id)}
            aria-label={`Delete ${p.title}`}
            className="absolute right-1.5 top-1.5 hidden rounded p-1 text-zinc-600 hover:text-red-400 group-hover:block cursor-pointer"
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
      {!visible.length && <p className="px-1 py-6 text-center text-xs text-zinc-600">No saved prompts yet.</p>}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[9px] text-violet-300">{children}</span>;
}

// ── Studio tab ───────────────────────────────────────────────────────────────

import { V1Persona } from '@/lib/wb-api';
function StudioTab() {
  const [personas, setPersonas] = useState<V1Persona[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const setActivePersona = useChat((s) => s.setActivePersona);

  const load = useCallback(async () => {
    try { setPersonas((await wbApi.personas.list()).personas || []); } catch { /* optional */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function activate(p: V1Persona) {
    await wbApi.personas.activate(p.id, !p.active);
    setActivePersona(p.active ? null : p);
    await load();
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setSheetOpen(true)}
        className="flex w-full items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 hover:border-violet-500 cursor-pointer"
      >
        <Plus size={12} /> New persona
      </button>
      {personas.map((p) => (
        <div key={p.id} className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
          <div className="min-w-0 flex-1">
            <b className="block truncate text-xs text-zinc-100">{p.name}</b>
            <small className="text-[10px] text-zinc-600">{p.model} · temp {p.temperature}</small>
          </div>
          <button
            onClick={() => void activate(p)}
            role="switch"
            aria-checked={Boolean(p.active)}
            aria-label={`Activate ${p.name}`}
            className={cn('relative h-4.5 w-8 inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer', p.active ? 'bg-violet-500' : 'bg-zinc-700')}
          >
            <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform', p.active ? 'translate-x-[18px]' : 'translate-x-0.5')} />
          </button>
        </div>
      ))}
      {!personas.length && <p className="px-1 py-6 text-center text-xs text-zinc-600">No personas yet.</p>}
      <PersonaSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onSaved={async () => { setSheetOpen(false); await load(); }} />
    </div>
  );
}

function PersonaSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: '', color: '#8b5cf6', system_prompt: '', model: 'auto',
    temperature: 0.7, max_tokens: 2048, top_p: 1, frequency_penalty: 0, presence_penalty: 0,
  });
  const [saving, setSaving] = useState(false);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex justify-end" onClick={onClose} role="dialog" aria-modal="true">
      <section className="h-full w-full max-w-md border-l border-zinc-700 bg-zinc-900 p-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-sm font-semibold text-zinc-100">New persona</h2>
        <form onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try { await wbApi.personas.create(form); onSaved(); } finally { setSaving(false); }
        }} className="grid gap-3 text-xs">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 text-zinc-100 focus:outline-none" />
          <div className="flex flex-wrap gap-1.5">
            {['#8b5cf6', '#22d3ee', '#34d399', '#fbbf24', '#f87171', '#f472b6'].map((c) => (
              <button
                key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                aria-label={`Color ${c}`}
                className={cn('h-6 w-6 rounded-full cursor-pointer', form.color === c && 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900')}
                style={{ background: c }}
              />
            ))}
          </div>
          <textarea placeholder="System prompt" value={form.system_prompt} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} rows={4} className="rounded-md border border-zinc-700 bg-zinc-950 p-2.5 text-zinc-100 focus:outline-none" />
          <input placeholder="Default model (auto)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 text-zinc-100 focus:outline-none" />
          {([['temperature', 'Temperature', 0, 2, 0.1], ['top_p', 'Top-p', 0, 1, 0.05], ['frequency_penalty', 'Frequency penalty', 0, 2, 0.1], ['presence_penalty', 'Presence penalty', 0, 2, 0.1]] as const).map(([key, label, min, max, step]) => (
            <label key={key} className="grid gap-1">
              <span className="flex justify-between text-zinc-400">{label}<span className="tabular-nums text-violet-400">{form[key]}</span></span>
              <input type="range" min={min} max={max} step={step} value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} className="accent-violet-500" />
            </label>
          ))}
          <label className="grid gap-1">
            <span className="text-zinc-400">Max tokens</span>
            <input type="number" min={128} max={128000} value={form.max_tokens} onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })} className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 text-zinc-100 focus:outline-none" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-zinc-700 px-3 py-1.5 text-zinc-300 cursor-pointer">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-md bg-violet-500 px-3 py-1.5 font-medium text-white hover:bg-violet-400 cursor-pointer disabled:opacity-50">
              {saving ? 'Saving…' : 'Save persona'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

// ── Integrations tab ─────────────────────────────────────────────────────────

function IntegrationsTab() {
  const [plugins, setPlugins] = useState<Array<{ id: number; name: string; description: string; category: string; enabled: boolean; icon?: string }>>([]);
  const load = useCallback(async () => {
    try { setPlugins((await wbApi.plugins.list()).plugins || []); } catch { /* optional */ }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const setEnabledPlugins = useChat((s) => s.setEnabledPlugins);

  async function toggle(id: number, enabled: boolean) {
    await wbApi.plugins.toggle(id, enabled);
    const after = plugins.map((p) => (p.id === id ? { ...p, enabled } : p));
    setPlugins(after);
    setEnabledPlugins(after.filter((p) => p.enabled).map((p) => p.name));
  }

  return (
    <div className="space-y-2">
      {plugins.map((p) => (
        <div key={p.id} className="rounded-md border border-zinc-800 bg-zinc-950 p-2.5">
          <div className="flex items-center gap-2">
            <span className="text-base" aria-hidden>{p.icon || '⬡'}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <b className="truncate text-xs text-zinc-100">{p.name}</b>
                {p.enabled && <span className="h-1.5 w-1.5 rounded-full bg-green-400" aria-label="enabled" />}
              </div>
              <p className="truncate text-[10px] text-zinc-600">{p.description}</p>
            </div>
            <Badge>{p.category}</Badge>
            <button
              onClick={() => void toggle(p.id, !p.enabled)}
              role="switch"
              aria-checked={p.enabled}
              aria-label={`Toggle ${p.name}`}
              className={cn('relative inline-flex h-4.5 w-8 h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer', p.enabled ? 'bg-violet-500' : 'bg-zinc-700')}
            >
              <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform', p.enabled ? 'translate-x-[18px]' : 'translate-x-0.5')} />
            </button>
          </div>
        </div>
      ))}
      {!plugins.length && <p className="px-1 py-6 text-center text-xs text-zinc-600">No plugins in the catalog yet.</p>}
    </div>
  );
}

// ── Workspace selector ───────────────────────────────────────────────────────

function WorkspaceSelector() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('Default workspace');
  const ws = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const saved = window.localStorage.getItem('simha.workspace');
    if (saved) setCurrent(saved);
  }, []);
  return (
    <div className="relative flex-1" ref={ws}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
      >
        <span className="truncate">{current}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-full rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          {['Default workspace', 'Production', 'Sandbox'].map((w) => (
            <button
              key={w}
              onClick={() => {
                setCurrent(w);
                window.localStorage.setItem('simha.workspace', w);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800 cursor-pointer"
            >
              {w}
              {w === current && <Check size={11} className="text-violet-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}