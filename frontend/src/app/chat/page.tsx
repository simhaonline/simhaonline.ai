'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import TopBar from '@/components/TopBar';

interface ChatSummary { id: number; title: string; updated_at: string; }
interface Message { id?: number; role: string; content: string; model?: string; routing_score?: string; routing_elo?: string; }
interface Feature { id: number; kind: 'plugin' | 'agent' | 'skill' | string; slug: string; name: string; description: string; enabled: boolean; effective_permission?: string; }
interface LibraryAsset { id: string; asset_type: string; name: string; description: string; tags: string[]; current_version: string; quality_score?: number; }
interface SavedResource { id: number; title: string; kind: string; content: string; created_at: string; }
interface GeneratedItem { id: number; kind: string; prompt: string; status: string; result_ref?: string | null; created_at: string; }

const navGroups = [
  { label: '', items: [['chats', '⌁', 'Chats'], ['library', '▧', 'Library'], ['memory', '◌', 'Memory']] },
  { label: 'Tools', items: [['skills', '✦', 'Skills'], ['agents', '◈', 'Agents'], ['code', '</>', 'Code']] },
  { label: 'Connections', items: [['mcp', '⌘', 'Integrations'], ['data', '▦', 'Data sources']] },
];

// Platform-aware modifier glyph: ⌘ on Apple keyboards, Ctrl elsewhere.
const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isApple ? '⌘' : 'Ctrl';

const PANEL_LABELS: Record<string, string> = {
  chats: 'Chats', library: 'Library', memory: 'Memory', skills: 'Skills',
  agents: 'Agents', code: 'Code', mcp: 'Integrations',
  plugins: 'Plugin Gallery', data: 'Data sources',
};

// Curated routing profiles — the single source of truth for model + route
// selection. "Auto (best model)" is the default; the other options pin a routing
// mode on the gateway (X-Simha-Routing-Mode) without forcing a manual model.
const ROUTE_PROFILES = [
  { id: 'auto', label: 'Auto (best model)', mode: '', hint: 'Automatically picks the best available model for your request' },
  { id: 'quality', label: 'Best quality', mode: 'quality', hint: 'Always uses the highest-quality model' },
  { id: 'fast', label: 'Fastest', mode: 'fast', hint: 'Optimizes for speed' },
  { id: 'cost', label: 'Lowest cost', mode: 'cost', hint: 'Optimizes for the cheapest capable model' },
];

// Curated model picker buckets. The raw catalog (often 1000+ names) is grouped
// into four practical views with search; the full list stays reachable.
const MODEL_CATEGORIES = [
  { id: 'recommended', label: 'Recommended', test: /gpt-5|claude-sonnet|claude-opus|gemini-3|glm-5|deepseek-v4|qwen3-max|llama-4/ },
  { id: 'fast', label: 'Fast', test: /flash|mini|miniature|nano|instant|small|lite|haiku|8b|7b|turbo/ },
  { id: 'reasoning', label: 'Reasoning', test: /r1|o1|o3|thinking|reason|qwq|opus|pro|max/ },
  { id: 'cheap', label: 'Cheap', test: /nano|lite|small|flash|mini|tiny|economy/ },
];

function rankModel(m: string): number {
  const l = m.toLowerCase();
  if (/(^|\/)gpt-5/.test(l) || /claude-(opus|sonnet)-/.test(l) || /gemini-3/.test(l) || /glm-5/.test(l)) return 3;
  if (/deepseek-v4|qwen3-max|llama-4|grok-4|kimi-k/.test(l)) return 2;
  if (/flash|mini|nano|lite|small|haiku/.test(l)) return 1;
  return 0;
}

export default function ChatPage() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('auto');
  const [routeMode, setRouteMode] = useState('auto');
  const [compare, setCompare] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [library, setLibrary] = useState<LibraryAsset[]>([]);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [savedResources, setSavedResources] = useState<SavedResource[]>([]);
  const [memoryTitle, setMemoryTitle] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [generated, setGenerated] = useState<GeneratedItem[]>([]);
  const [typedAssets, setTypedAssets] = useState<Record<string, LibraryAsset[]>>({});
  const [assetQuery, setAssetQuery] = useState('');
  const [assetSaving, setAssetSaving] = useState(false);
  const [activePanel, setActivePanel] = useState('chats');
  const [contextOpen, setContextOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [authError, setAuthError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelCategory, setModelCategory] = useState('recommended');
  const [modelSearch, setModelSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem('simha:favorite-models') || '[]'); } catch { return []; }
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const modelBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem('simha:favorite-models', JSON.stringify(favorites)); } catch { /* ignore */ }
  }, [favorites]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (modelBoxRef.current && !modelBoxRef.current.contains(e.target as Node)) setModelPickerOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const loadBootstrap = useCallback(async () => {
    try {
      const r = await fetch('/api/chat/bootstrap', { cache: 'no-store' });
      if (r.status === 401) { setAuthError(true); return; }
      if (!r.ok) throw new Error('bootstrap failed');
      const d = await r.json();
      setChats(d.chats || []);
      setFeatures(d.features || []);
      const [m, a] = await Promise.all([
        fetch('/api/chat/models').then((x) => x.ok ? x.json() : { models: [] }),
        fetch('/api/chat/library/catalog?limit=50').then((x) => x.ok ? x.json() : { assets: [] }),
      ]);
      setModels(m.models || []);
      setLibrary(a.assets || []);
    } catch {
      setNotice('The workbench could not load its workspace data.');
    }
  }, []);

  // Panel data loaders — fetch on first open of each panel, keep afterwards.
  const loadSavedResources = useCallback(async () => {
    const r = await fetch('/api/chat/library');
    if (r.ok) setSavedResources((await r.json()).resources || []);
  }, []);
  const loadGenerated = useCallback(async () => {
    const r = await fetch('/api/chat/generated');
    if (r.ok) setGenerated((await r.json()).items || []);
  }, []);
  const loadCatalogType = useCallback(async (type: string) => {
    const r = await fetch(`/api/chat/library/catalog?limit=100&type=${encodeURIComponent(type)}`);
    if (!r.ok) return;
    const assets: LibraryAsset[] = (await r.json()).assets || [];
    setTypedAssets((prev) => ({ ...prev, [type]: assets }));
  }, []);

  const loadMessages = useCallback(async (id: number) => {
    const r = await fetch(`/api/chat/chats/${id}/messages`);
    if (r.ok) setMessages((await r.json()).messages || []);
  }, []);

  useEffect(() => { void loadBootstrap(); }, [loadBootstrap]);
  useEffect(() => { if (activeId) void loadMessages(activeId); }, [activeId, loadMessages]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandOpen((v) => !v); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); void newChat(); }
      if (e.key === 'Escape') { setCommandOpen(false); setModelPickerOpen(false); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleAssets = useMemo(
    () => library.filter((a) => !libraryQuery.trim() || [a.name, a.description, ...(a.tags || [])].join(' ').toLowerCase().includes(libraryQuery.toLowerCase())).slice(0, 20),
    [library, libraryQuery],
  );

  const activeProfile = ROUTE_PROFILES.find((p) => p.id === routeMode) || ROUTE_PROFILES[0];

  const curatedModels = useMemo(() => {
    if (modelCategory === 'favorites') {
      return favorites.map((f) => models.find((m) => m === f)).filter((m): m is string => Boolean(m));
    }
    if (modelCategory === 'all') return models;
    const cat = MODEL_CATEGORIES.find((c) => c.id === modelCategory);
    const hits = cat ? models.filter((m) => cat.test.test(m.toLowerCase())) : models;
    return hits.slice().sort((a, b) => rankModel(b) - rankModel(a) || a.localeCompare(b)).slice(0, 24);
  }, [models, modelCategory, favorites]);

  const searchedModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return null;
    return models.filter((m) => m.toLowerCase().includes(q)).slice(0, 24);
  }, [models, modelSearch]);

  const pickerOptions = useMemo(() => {
    const routeOptions = ROUTE_PROFILES.map((p) => `route:${p.id}` as const);
    const modelOptions = searchedModels ?? curatedModels;
    return [...routeOptions, ...modelOptions];
  }, [searchedModels, curatedModels]);

  async function newChat() {
    const r = await fetch('/api/chat/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New conversation', model, mode: compare ? 'compare' : 'chat' }),
    });
    if (!r.ok) { setNotice('Could not create a new conversation.'); return; }
    const d = await r.json();
    setChats((c) => [{ id: d.id, title: d.title, updated_at: d.created_at }, ...c]);
    setActiveId(d.id);
    setMessages([]);
    setActivePanel('chats');
  }

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    setInput('');
    setContextOpen(false);
    const controller = new AbortController();
    abortRef.current = controller;
    let chatId = activeId;
    try {
      if (!chatId) {
        const r = await fetch('/api/chat/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: content.slice(0, 80), model, mode: compare ? 'compare' : 'chat' }),
        });
        if (!r.ok) throw new Error('chat creation failed');
        const d = await r.json();
        chatId = d.id;
        setChats((c) => [{ id: d.id, title: d.title, updated_at: d.created_at }, ...c]);
        setActiveId(d.id);
      }
      const userMsg: Message = { role: 'user', content };
      setMessages((m) => [...m, userMsg]);
      void fetch(`/api/chat/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content }),
      });
      const history = [...messages.filter((m) => m.role !== 'tool'), userMsg];
      const profile = ROUTE_PROFILES.find((p) => p.id === routeMode) || ROUTE_PROFILES[0];
      const r = await fetch('/api/chat/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          chat_id: chatId,
          model: model === 'auto' ? undefined : model,
          compare,
          routing_mode: profile.mode || undefined,
          stream: true,
          messages: history,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `request failed (${r.status})`);
      }
      const headerModel = r.headers.get('X-Simha-Route-Model') || (model === 'auto' ? undefined : model);
      const routeScore = r.headers.get('X-Simha-Route-Score') || undefined;
      const routeElo = r.headers.get('X-Simha-Route-ELO') || undefined;
      const reader = r.body?.getReader();
      if (reader) {
        const dec = new TextDecoder();
        let buf = '';
        setMessages((m) => [...m, { role: 'assistant', content: '', model: headerModel || model, routing_score: routeScore, routing_elo: routeElo }]);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const events = buf.split('\n\n');
          buf = events.pop() || '';
          for (const ev of events) {
            for (const line of ev.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (!data || data === '[DONE]') continue;
              try {
                const j = JSON.parse(data);
                const delta = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? '';
                if (delta) {
                  setMessages((m) => {
                    const copy = [...m];
                    const last = copy[copy.length - 1];
                    if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + delta };
                    return copy;
                  });
                }
              } catch { /* partial JSON frame — ignore */ }
            }
          }
        }
      } else {
        const d = await r.json();
        setMessages((m) => [...m, { role: 'assistant', content: d.content || '(no response)', model: d.model }]);
      }
      // Persist the assembled assistant message after streaming finished.
      if (chatId) {
        let contentOut = '';
        let modelOut: string | undefined = headerModel;
        setMessages((m) => {
          const last = m[m.length - 1];
          if (last?.role === 'assistant') { contentOut = last.content; modelOut = last.model || headerModel; }
          return m;
        });
        void fetch(`/api/chat/chats/${chatId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', content: contentOut || '(no response)', model: modelOut }),
        });
      }
      setContextOpen(true); // open live context once the response has arrived
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.role === 'assistant' && !last.content) copy[copy.length - 1] = { ...last, content: '(stopped)' };
          return copy;
        });
      } else {
        const message = e instanceof Error ? e.message : String(e);
        const rateLimited = /429|rate|capacity|cool/i.test(message);
        setMessages((m) => [...m, {
          role: 'assistant',
          content: rateLimited
            ? 'Every provider for this model is cooling down or at capacity right now. This usually clears within a minute — try again shortly or switch route profile.'
            : `Unable to complete request: ${message}`,
        }]);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function regenerate(_msg: Message, index: number) {
    if (!activeId || busy) return;
    // Rewind the UI to just before this assistant turn and re-send its prompt.
    const prior = messages.slice(0, index);
    const lastUser = [...prior].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const rewindTo = Math.max(0, prior.length - 1);
    setMessages(prior.slice(0, rewindTo));
    setInput(lastUser.content);
    void send();
  }

  function toggleFavorite(name: string) {
    setFavorites((f) => (f.includes(name) ? f.filter((x) => x !== name) : [...f, name]));
  }

  function selectAsset(asset: LibraryAsset) {
    setInput(asset.description || asset.name);
    setNotice(`${asset.name} inserted from Simha Asset Library.`);
    setActivePanel('chats');
  }

  function panelAction(id: string) {
    setActivePanel(id);
    setContextOpen(false);
    if (id === 'memory') void loadSavedResources();
    else if (id === 'code') void loadGenerated();
    else if (id === 'mcp') void loadCatalogType('mcp_connector');
    else if (id === 'data') void loadCatalogType('dataset');
    if (id !== 'chats') {
      const label = PANEL_LABELS[id] || id.replace('-', ' ');
      setNotice(`${label} is open inside this Workbench. Your conversation stays active.`);
    }
  }

  async function toggleFeature(f: Feature) {
    const next = !f.enabled;
    setFeatures((list) => list.map((x) => (x.id === f.id ? { ...x, enabled: next } : x)));
    const r = await fetch(`/api/chat/features/${f.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
    if (!r.ok) {
      setFeatures((list) => list.map((x) => (x.id === f.id ? { ...x, enabled: !next } : x)));
      setNotice('Could not update that capability — try again.');
      return;
    }
    setNotice(`${f.name} ${next ? 'enabled' : 'disabled'}.`);
  }

  async function saveMemory() {
    const title = memoryTitle.trim();
    const content = memoryContent.trim();
    if (!title && !content) return;
    const r = await fetch('/api/chat/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || content.slice(0, 60), kind: 'memory', content }),
    });
    if (r.ok) {
      setMemoryTitle('');
      setMemoryContent('');
      setNotice('Saved to your memory.');
      void loadSavedResources();
    } else {
      setNotice('Could not save that memory — try again.');
    }
  }

  async function deleteSavedResource(id: number) {
    setSavedResources((list) => list.filter((x) => x.id !== id));
    const r = await fetch('/api/chat/library', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!r.ok) {
      void loadSavedResources();
      setNotice('Could not delete that item — try again.');
    }
  }

  async function saveConnector() {
    const name = assetQuery.trim();
    if (!name || assetSaving) return;
    setAssetSaving(true);
    try {
      const r = await fetch('/api/chat/library/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: activePanel === 'mcp' ? 'mcp_connector' : 'dataset',
          name,
          description: '',
        }),
      });
      if (r.ok) {
        setAssetQuery('');
        setNotice('Added to your workspace.');
        await loadCatalogType(activePanel === 'mcp' ? 'mcp_connector' : 'dataset');
      } else {
        setNotice('Could not add that item — try again.');
      }
    } finally {
      setAssetSaving(false);
    }
  }

  function pickOption(option: string) {
    if (option.startsWith('route:')) {
      const id = option.slice(6);
      setRouteMode(id);
      setModel('auto');
      const p = ROUTE_PROFILES.find((x) => x.id === id) || ROUTE_PROFILES[0];
      setNotice(p.hint);
    } else {
      setModel(option);
      setNotice(`Pinned model: ${option}`);
    }
    setModelPickerOpen(false);
  }

  if (authError) {
    return (
      <>
        <TopBar />
        <main className="container chat-auth-state">
          <div className="workbench-mark">⌁</div>
          <h1>Sign in to Simha Workbench</h1>
          <p className="sub">Your conversations, assets, routing preferences, and memory are protected inside your account.</p>
          <a className="btn primary" href="https://platform.simhaonline.ai/login">Sign in</a>
        </main>
      </>
    );
  }

  return (
    <div className="simha-workbench">
      <TopBar />
      <div className="workbench-body">
        <aside className={`workbench-rail ${railCollapsed ? 'collapsed' : ''}`}>
          <div className="rail-head">
            <Link href="/" className="workbench-brand">
              <span>⌁</span>
              {!railCollapsed && <b>Simha Workbench</b>}
            </Link>
            <button className="icon-button" onClick={() => setRailCollapsed(!railCollapsed)} aria-label="Toggle workspace navigation">
              {railCollapsed ? '→' : '←'}
            </button>
          </div>
          {!railCollapsed && (
            <div className="rail-content">
              <button className="workbench-new" onClick={newChat}>
                <span>＋</span> New conversation <kbd>{MOD === '⌘' ? 'N' : 'Ctrl+N'}</kbd>
              </button>
              <button className="rail-search" onClick={() => setCommandOpen(true)}>
                <span>⌕</span> Search workspace <kbd>{MOD}K</kbd>
              </button>
              {navGroups.map((g) => (
                <div className="rail-group" key={g.label}>
                  <div className="rail-label">{g.label}</div>
                  {g.items.map(([id, icon, label]) => (
                    <button key={id} className={`rail-item ${activePanel === id ? 'active' : ''}`} onClick={() => panelAction(id)}>
                      <span className="rail-icon">{icon}</span>{label}
                      {id === 'chats' && chats.length > 0 && <em>{chats.length}</em>}
                    </button>
                  ))}
                </div>
              ))}
              <div className="rail-group">
                <div className="rail-label">Recent conversations</div>
                {chats.slice(0, 6).map((c) => (
                  <button key={c.id} className={`rail-chat ${activeId === c.id ? 'active' : ''}`} onClick={() => { setActiveId(c.id); setActivePanel('chats'); }}>
                    {c.title}
                  </button>
                ))}
                {!chats.length && <small className="rail-empty">No conversations yet.</small>}
              </div>
              {activePanel === 'library' && (
                <div className="rail-library">
                  <input placeholder="Find an asset…" value={libraryQuery} onChange={(e) => setLibraryQuery(e.target.value)} />
                  {visibleAssets.map((a) => (
                    <button key={a.id} onClick={() => selectAsset(a)}>
                      <b>{a.name}</b>
                      <small>{a.asset_type.replaceAll('_', ' ')} · v{a.current_version}</small>
                    </button>
                  ))}
                  {!library.length && <small className="rail-empty">No catalog assets yet.</small>}
                </div>
              )}
              {activePanel === 'memory' && (
                <div className="rail-library">
                  <input placeholder="Name (optional)" value={memoryTitle} onChange={(e) => setMemoryTitle(e.target.value)} />
                  <textarea placeholder="Remember that…" value={memoryContent} onChange={(e) => setMemoryContent(e.target.value)} rows={3} />
                  <button className="rail-save" onClick={() => void saveMemory()} disabled={!memoryContent.trim() && !memoryTitle.trim()}>Save memory</button>
                  {savedResources.map((s) => (
                    <div key={s.id} className="rail-resource">
                      <button onClick={() => { setInput(s.content || s.title); setActivePanel('chats'); }}>
                        <b>{s.title}</b>
                        {s.content && <small>{s.content.slice(0, 80)}</small>}
                      </button>
                      <button className="resource-delete" onClick={() => void deleteSavedResource(s.id)} aria-label={`Delete ${s.title}`}>×</button>
                    </div>
                  ))}
                  {!savedResources.length && <small className="rail-empty">Nothing saved yet.</small>}
                </div>
              )}
              {(activePanel === 'skills' || activePanel === 'agents' || activePanel === 'plugins') && (
                <div className="rail-library">
                  {(features.filter((f) => f.kind === (activePanel === 'skills' ? 'skill' : activePanel === 'agents' ? 'agent' : 'plugin'))).map((f) => (
                    <button key={f.id} onClick={() => void toggleFeature(f)} title={f.description}>
                      <b>{f.name}</b>
                      <small>{f.enabled ? 'enabled' : 'off'} · click to toggle</small>
                    </button>
                  ))}
                  {!(features.filter((f) => f.kind === (activePanel === 'skills' ? 'skill' : activePanel === 'agents' ? 'agent' : 'plugin'))).length && <small className="rail-empty">Nothing in the catalog yet.</small>}
                </div>
              )}
              {(activePanel === 'mcp' || activePanel === 'data') && (
                <div className="rail-library">
                  <div className="rail-add-row">
                    <input
                      placeholder={activePanel === 'mcp' ? 'Connector name…' : 'Dataset name…'}
                      value={assetQuery}
                      onChange={(e) => setAssetQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void saveConnector(); }}
                    />
                    <button className="rail-add" onClick={() => void saveConnector()} disabled={!assetQuery.trim() || assetSaving}>Add</button>
                  </div>
                  {(typedAssets[activePanel === 'mcp' ? 'mcp_connector' : 'dataset'] || []).map((a) => (
                    <button key={a.id} onClick={() => selectAsset(a)}>
                      <b>{a.name}</b>
                      <small>{a.asset_type.replaceAll('_', ' ')}{a.description ? ` · ${a.description.slice(0, 50)}` : ''}</small>
                    </button>
                  ))}
                  {!(typedAssets[activePanel === 'mcp' ? 'mcp_connector' : 'dataset'] || []).length && <small className="rail-empty">Nothing here yet — add one above.</small>}
                </div>
              )}
              {activePanel === 'code' && (
                <div className="rail-library">
                  <small className="rail-empty">Generated artifacts land here after image/code runs.</small>
                  {generated.map((g) => (
                    <div key={g.id} className="rail-resource">
                      <button onClick={() => { setInput(g.prompt); setActivePanel('chats'); }}>
                        <b>{g.kind}</b>
                        <small>{(g.prompt || '').slice(0, 60)}</small>
                      </button>
                    </div>
                  ))}
                  {!generated.length && <small className="rail-empty">Nothing generated yet.</small>}
                </div>
              )}
            </div>
          )}
          <div className="rail-foot">
            <span className="online-dot" />
            {!railCollapsed && (
              <>
                <span>Router online</span>
                <Link href="/dashboard" title="Open Control Center">Control Center</Link>
              </>
            )}
          </div>
        </aside>

        <main className="workbench-main">
          <header className="workbench-header">
            <div className="header-controls">
              <button
                className={`header-action ${compare ? 'selected' : ''}`}
                onClick={() => setCompare(!compare)}
                aria-pressed={compare}
                title="Ask 2–3 models the same question and compare answers side by side"
              >
                ⇄ {compare ? 'Comparing' : 'Compare models'}
              </button>
              <button className="icon-button" onClick={() => setContextOpen(!contextOpen)} aria-label="Toggle context panel" title="Workspace panel">◫</button>
            </div>
          </header>

          {notice && (
            <div className="workbench-notice" role="status">
              <span>i</span>{notice}
              <button onClick={() => setNotice('')} aria-label="Dismiss notification">×</button>
            </div>
          )}

          <div className="conversation-scroll" ref={scrollRef}>
            {!messages.length && (
              <div className="workbench-empty">
                <div className="workbench-mark">⌁</div>
                <div className="empty-eyebrow">SIMHA WORKBENCH</div>
                <h1>What can I help with?</h1>
                <p>Ask anything — the best available model answers automatically.</p>
                <div className="starter-grid">
                  <button onClick={() => setInput('Analyze this problem and propose a practical implementation plan.')}>
                    ◈ <span>Plan a solution<small>Break down a complex task</small></span>→
                  </button>
                  <button onClick={() => setInput('Review this code and suggest concrete improvements')}>
                    ◈ <span>Review code<small>Concrete fixes and improvements</small></span>→
                  </button>
                  <button onClick={() => setInput('Summarize the key decisions and open questions from this context:')}>
                    ▤ <span>Summarize context<small>Turn detail into direction</small></span>→
                  </button>
                  <button onClick={() => setInput('Research this topic and cite the most important evidence:')}>
                    ⌕ <span>Research a topic<small>Source-aware analysis</small></span>→
                  </button>
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <article key={m.id ?? `${m.role}-${i}`} className={`workbench-message ${m.role}`}>
                <div className="message-avatar">{m.role === 'user' ? 'You' : '⌁'}</div>
                <div className="message-content">
                  <div className="message-meta">
                    <b>{m.role === 'user' ? 'You' : 'Simha Assistant'}</b>
                    {m.model && <span className="model-badge" title="Model that answered">{m.model}</span>}
                    {m.role === 'assistant' && (m.routing_score || m.routing_elo) && (
                      <span className="model-badge" title="Gateway routing explanation">score {m.routing_score ?? '—'} · elo {m.routing_elo ?? '—'}</span>)}
                    {m.role === 'assistant' && <span className="message-status">routed · {activeProfile.label.toLowerCase()}</span>}
                  </div>
                  <div className="message-text">
                    {m.content}
                    {busy && i === messages.length - 1 && m.role === 'assistant' && <span className="stream-cursor" aria-hidden="true" />}
                  </div>
                  {m.role === 'assistant' && !busy && (
                    <div className="message-tools">
                      <button onClick={() => navigator.clipboard?.writeText(m.content)}>Copy</button>
                      <button onClick={() => setInput(m.content)}>Use as context</button>
                      <button onClick={() => setContextOpen(true)}>Route details</button>
                      <button onClick={() => setNotice('Feedback saved for the routing evaluation pipeline.')}>Rate response</button>
                      <button onClick={() => void regenerate(m, i)}>Regenerate</button>
                    </div>
                  )}
                </div>
              </article>
            ))}

            {busy && (
              <div className="workbench-thinking">
                <span className="thinking-dots"><i /><i /><i /></span>
                Simha is consulting the best available route…
                <button className="stop-button" onClick={stop} aria-label="Stop generating">Stop</button>
              </div>
            )}
          </div>

          <div className="composer-wrap">
            <div className="composer">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
                }}
                placeholder="Ask Simha anything…"
                rows={2}
                aria-label="Message Simha"
              />
              <div className="composer-bottom">
                <div className="composer-tools">
                  <button onClick={() => setNotice('Use the Upload button (bottom-right) to add files.')} title="Attach files" aria-label="Attach files">＋</button>
                  <button onClick={() => setNotice('Tools and connectors are managed in MCP Connectors.')} title="Tools and connectors" aria-label="Tools and connectors">⌘</button>
                  <button onClick={() => setNotice('Web search requires a configured search connector.')} title="Web search" aria-label="Web search">◎</button>
                  <button onClick={() => setNotice('Voice input requires a configured speech provider.')} title="Voice input" aria-label="Voice input">◉</button>
                  <span className="composer-divider" />
                  <div className="model-box" ref={modelBoxRef}>
                    <button
                      className={`model-selector ${model !== 'auto' ? 'custom' : ''}`}
                      onClick={() => setModelPickerOpen(!modelPickerOpen)}
                      aria-expanded={modelPickerOpen}
                      aria-haspopup="listbox"
                      aria-label="Choose model"
                      title={model === 'auto' ? activeProfile.hint : model}
                    >
                      {model === 'auto'
                        ? <>✦ {activeProfile.label}</>
                        : <><span className="model-dot" />{model.length > 26 ? `${model.slice(0, 24)}…` : model}</>}
                      <span className="model-caret">▾</span>
                    </button>
                    {modelPickerOpen && (
                      <div className="model-picker" role="listbox" aria-label="Model selection">
                        <div className="model-picker-tabs">
                          {ROUTE_PROFILES.map((p) => (
                            <button key={p.id} className={routeMode === p.id ? 'active' : ''} onClick={() => { setModelCategory(''); pickOption(`route:${p.id}`); }}>
                              {p.label}
                            </button>
                          ))}
                          <button className={modelCategory === 'favorites' ? 'active' : ''} onClick={() => { setModel('auto'); setModelCategory('favorites'); }}>
                            ★ Favorites
                          </button>
                          {MODEL_CATEGORIES.map((c) => (
                            <button key={c.id} className={modelCategory === c.id ? 'active' : ''} onClick={() => { setModel('auto'); setModelCategory(c.id); }}>
                              {c.label}
                            </button>
                          ))}
                          <button className={modelCategory === 'all' ? 'active' : ''} onClick={() => { setModel('auto'); setModelCategory('all'); }}>
                            All models
                          </button>
                        </div>
                        <input
                          className="model-search"
                          placeholder="Search every model…"
                          value={modelSearch}
                          onChange={(e) => setModelSearch(e.target.value)}
                          aria-label="Search models"
                        />
                        {pickerOptions.length === 0 && (
                          <div className="model-empty">No models match yet{modelCategory === 'favorites' ? ' — star models to pin them here' : ''}.</div>
                        )}
                        {pickerOptions.map((opt) => {
                          const isRoute = opt.startsWith('route:');
                          const selected = isRoute ? routeMode === opt.slice(6) : model === opt;
                          return (
                            <button
                              key={opt}
                              role="option"
                              aria-selected={selected}
                              className={`model-option ${isRoute ? 'route-option' : ''} ${selected ? 'selected' : ''}`}
                              onClick={() => pickOption(opt)}
                            >
                              <span className="model-option-name">
                                {isRoute
                                  ? `✦ ${(ROUTE_PROFILES.find((p) => p.id === opt.slice(6)) || ROUTE_PROFILES[0]).label}`
                                  : opt}
                              </span>
                              {!isRoute && (
                                <button
                                  className="model-fav"
                                  aria-label={`Toggle favorite ${opt}`}
                                  onClick={(ev) => { ev.stopPropagation(); toggleFavorite(opt); }}
                                >
                                  {favorites.includes(opt) ? '★' : '☆'}
                                </button>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <button className="active-chip" onClick={() => setContextOpen(true)} aria-label="What the assistant knows about this conversation">◫ Workspace</button>
                  <span className="composer-hint">Enter to send · Shift+Enter for newline</span>
                </div>
                <button className="send-button" onClick={() => void send()} disabled={busy || !input.trim()} aria-label="Send message">
                  {busy ? '…' : '↑'}
                </button>
              </div>
            </div>
            <div className="composer-foot">
              <span>Simha can make mistakes. Verify important information.</span>
              <button onClick={() => setCommandOpen(true)}>{MOD}K Command palette</button>
            </div>
          </div>
        </main>

        {contextOpen && (
          <aside className="workbench-context">
            <div className="context-head">
              <div>
                <span className="header-kicker">Live context</span>
                <strong>Workspace controls</strong>
              </div>
              <button className="icon-button" onClick={() => setContextOpen(false)} aria-label="Close context panel">×</button>
            </div>
            <section className="context-section">
              <div className="context-label">Model choice</div>
              <div className="route-card">
                <div>
                  <b>{activeProfile.label}</b>
                  <small>{model === 'auto' ? activeProfile.hint : `Pinned model · ${model}`}</small>
                </div>
                <span className="route-signal" />
              </div>
              <div className="context-stat"><span>Available models</span><b>{models.length}</b></div>
              <div className="context-stat"><span>Connected capabilities</span><b>{features.filter((f) => f.enabled).length}</b></div>
            </section>
            <section className="context-section">
              <div className="context-label">Active capabilities</div>
              {features.filter((f) => f.enabled).slice(0, 6).map((f) => (
                <div className="context-row" key={f.id}>
                  <span className="mini-icon">✦</span><span>{f.name}</span><i>ready</i>
                </div>
              ))}
              {!features.length && <p className="context-muted">Capabilities appear here when enabled for your account.</p>}
            </section>
            <section className="context-section">
              <div className="context-label">Memory</div>
              <div className="memory-card">
                <span className="mini-icon">◌</span>
                <div>
                  <b>Conversation memory</b>
                  <small>Context is scoped to this conversation.</small>
                </div>
                <button onClick={() => setActivePanel('memory')}>Open</button>
              </div>
            </section>
            <section className="context-section">
              <div className="context-label">Comparison mode</div>
              <p className="context-muted">
                {compare ? 'Configured comparison route is enabled for the next request.' : 'Enable Compare when you want judge-assisted evaluation.'}
              </p>
              <button className="context-button" onClick={() => setCompare(!compare)}>
                {compare ? 'Disable comparison' : 'Enable comparison'} →
              </button>
            </section>
            <div className="context-foot">
              <Link href="/dashboard">Open Control Center</Link>
              <Link href="/docs">Read API docs</Link>
            </div>
          </aside>
        )}

        {commandOpen && (
          <div className="command-overlay" role="dialog" aria-modal="true" aria-label="Command palette" onClick={() => setCommandOpen(false)}>
            <div className="command-palette" onClick={(e) => e.stopPropagation()}>
              <div className="command-input">
                <span>{MOD}K</span>
                <input autoFocus placeholder="Search commands, chats, assets…" onChange={(e) => setLibraryQuery(e.target.value)} />
              </div>
              <div className="command-group">
                <small>Quick actions</small>
                <button onClick={newChat}>＋ New conversation <kbd>{MOD === '⌘' ? 'N' : 'Ctrl+N'}</kbd></button>
                <button onClick={() => { setActivePanel('library'); setCommandOpen(false); }}>▧ Open Library</button>
                <button onClick={() => { setContextOpen(true); setCommandOpen(false); }}>◫ Show workspace context</button>
                <button onClick={() => { setModelPickerOpen(true); setCommandOpen(false); }}>✦ Change model</button>
                <button onClick={() => { setCompare(true); setCommandOpen(false); }}>⇄ Enable Compare mode</button>
              </div>
              <div className="command-foot">Esc to close · Commands operate on this workspace</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}