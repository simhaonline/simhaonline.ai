'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

// Workspace switcher — defaults to "Default workspace". Persists the choice
// per browser (localStorage) so reloads keep the operator's context.
const WORKSPACES = ['Default workspace', 'Production', 'Sandbox'];

export default function WorkspaceDropdown() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('Default workspace');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('simha.workspace') : null;
    if (saved && WORKSPACES.includes(saved)) setCurrent(saved);
  }, []);
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 cursor-pointer"
      >
        <span className="truncate">{current}</span>
        <ChevronDown size={13} className="text-zinc-500" />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          {WORKSPACES.map((w) => (
            <button
              key={w}
              role="option"
              aria-selected={w === current}
              onClick={() => { setCurrent(w); window.localStorage.setItem('simha.workspace', w); setOpen(false); }}
              className="flex w-full items-center justify-between px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 cursor-pointer"
            >
              {w}
              {w === current && <Check size={12} className="text-violet-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}