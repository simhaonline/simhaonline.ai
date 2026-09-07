'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Workspace badge — shows the real workspace name from the control plane
// (single workspace; rename it in Settings). Falls back silently when the
// endpoint is unavailable.
export default function WorkspaceDropdown() {
  const [name, setName] = useState('Default workspace');

  useEffect(() => {
    api.workspace.get()
      .then((w) => { if (w?.name) setName(w.name); })
      .catch(() => { /* workspace endpoint optional */ });
  }, []);

  return (
    <div className="flex w-full items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300" title="Rename in Settings">
      <span className="truncate">{name}</span>
      <span className="text-[10px] uppercase tracking-wider text-zinc-600">workspace</span>
    </div>
  );
}