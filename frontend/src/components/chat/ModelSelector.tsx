'use client';

// (9) components/chat/ModelSelector.tsx — model picker with provider
// grouping, search, context window / cost / latency badges.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { wbApi } from '@/lib/wb-api';
import { useChat } from '@/store/chat';

interface ModelInfo {
  id: string;
  provider: string;
  context_window?: number | null;
  cost_in?: number | null;
  cost_out?: number | null;
  p50_latency_ms?: number | null;
}

const PROVIDER_ORDER = ['Auto', 'OpenAI', 'Anthropic', 'Gemini', 'Ollama'];

function latencyBadge(ms: number | null | undefined): { label: string; tone: string } | null {
  if (ms == null) return null;
  if (ms < 1200) return { label: 'Fast', tone: 'text-green-400' };
  if (ms < 4000) return { label: 'Medium', tone: 'text-amber-400' };
  return { label: 'Slow', tone: 'text-red-400' };
}

function prettyName(id: string): string {
  if (id === 'auto') return 'Auto (best model)';
  const short = id.split('/').pop() || id;
  return short.replace(/[-_]/g, ' ').slice(0, 34);
}

export function ModelSelector() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const { selectedModel, setModel } = useChat();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem('simha.model');
    if (saved) setModel(saved);
    (async () => {
      try {
        const d = await wbApi.models.list();
        setModels(d.models.map((m) => {
          const provider = m.includes('/') ? (m.split('/')[0] || 'Other') : 'Ollama';
          return {
            id: m,
            provider: provider.charAt(0).toUpperCase() + provider.slice(1),
            context_window: null,
            cost_in: null,
            cost_out: null,
            p50_latency_ms: null,
          };
        }));
      } catch { /* catalog endpoint optional */ }
    })();
  }, [setModel]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(
    () => models.filter((m) => m.id.toLowerCase().includes(query.toLowerCase())).slice(0, 80),
    [models, query],
  );
  const grouped = useMemo(() => {
    const out: Record<string, ModelInfo[]> = { Auto: [{ id: 'auto', provider: 'Auto' }] };
    for (const m of models) {
      (out[m.provider] ||= []).push(m);
    }
    return out;
  }, [models]);

  function pick(id: string) {
    setModel(id);
    window.localStorage.setItem('simha.model', id);
    setOpen(false);
    setQuery('');
  }

  const groups = query ? { Results: filtered } : grouped;
  const order = query ? ['Results'] : PROVIDER_ORDER.filter((p) => grouped[p]?.length).concat(
    Object.keys(grouped).filter((g) => !PROVIDER_ORDER.includes(g)),
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 hover:border-zinc-600 cursor-pointer"
      >
        <Sparkles size={12} className="text-violet-400" />
        <span className="max-w-[160px] truncate">{prettyName(selectedModel)}</span>
        <ChevronDown size={12} className="text-zinc-500" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-80 rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl" role="listbox" aria-label="Choose model">
          <div className="border-b border-zinc-800 p-2">
            <div className="flex items-center gap-2 rounded-md bg-zinc-950 px-2.5 py-1.5">
              <Search size={13} className="text-zinc-600" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                className="w-full bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-auto py-1">
            {order.map((group) => (
              <div key={group}>
                <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">{group}</p>
                {(group === 'Results' ? filtered : grouped[group] || []).map((m) => {
                  const badge = latencyBadge(m.p50_latency_ms);
                  return (
                    <button
                      key={m.id}
                      role="option"
                      aria-selected={m.id === selectedModel}
                      onClick={() => pick(m.id)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800 cursor-pointer',
                        m.id === selectedModel && 'bg-zinc-800/70 text-violet-300',
                      )}
                    >
                      <span className="truncate text-zinc-200">{prettyName(m.id)}</span>
                      <span className="flex shrink-0 items-center gap-2 text-[10px] text-zinc-600">
                        {m.context_window ? <span>{(m.context_window / 1000).toFixed(0)}k ctx</span> : null}
                        {m.cost_in != null && m.cost_out != null && (
                          <span className="tabular-nums">${m.cost_in}/${m.cost_out} per 1M</span>
                        )}
                        {badge && <span className={badge.tone}>{badge.label}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {!models.length && !query && (
              <p className="px-3 py-4 text-center text-xs text-zinc-600">Model catalog unavailable — Auto routing still works.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ModelSelector;