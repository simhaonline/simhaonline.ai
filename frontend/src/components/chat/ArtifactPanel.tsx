'use client';

// (6) components/chat/ArtifactPanel.tsx — resizable right panel with
// Preview / Code / History tabs, copy + download, slide-in transition.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';
import { CodeBlock } from './MessageBubble';
import { cn } from '@/lib/utils';

export interface ArtifactState {
  open: boolean;
  title: string;
  language: string;
  code: string;
  history: Array<{ at: string; content: string }>;
}

const TABS = ['Preview', 'Code', 'History'] as const;
type Tab = (typeof TABS)[number];

export function ArtifactPanel({
  artifact, onClose, onCodeUpdate,
}: {
  artifact: ArtifactState;
  onClose: () => void;
  onCodeUpdate?: (code: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('Preview');
  const [width, setWidth] = useState(480);
  const [copied, setCopied] = useState(false);
  const dragging = useRef(false);

  const resizable = useRef<HTMLDivElement>(null);

  const onMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return;
    const w = window.innerWidth - e.clientX;
    setWidth(Math.min(Math.max(w, 320), window.innerWidth - 320));
  }, []);

  useEffect(() => {
    function stop() { dragging.current = false; document.body.style.cursor = ''; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop);
    };
  }, [onMove]);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
    void resizable;
  }

  async function copy() {
    try { await navigator.clipboard.writeText(artifact.code); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* blocked */ }
  }

  function download() {
    const ext = artifact.language === 'javascript' ? 'js'
      : artifact.language === 'typescript' ? 'ts'
      : artifact.language === 'python' ? 'py'
      : artifact.language === 'html' ? 'html'
      : artifact.language || 'txt';
    const blob = new Blob([artifact.code], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `artifact.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const previewable = ['html', 'xml', 'markdown', 'md', ''].includes(artifact.language);

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-l border-zinc-800 bg-zinc-900 transition-transform duration-200',
        artifact.open ? 'translate-x-0' : 'translate-x-full',
      )}
      style={{ width }}
      aria-label="Artifact panel"
    >
      {/* draggable divider */}
      <div
        onMouseDown={startDrag}
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-violet-500/40"
        role="separator"
        aria-orientation="vertical"
      />
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-400">Artifact</p>
          <strong className="block truncate text-sm text-zinc-100">{artifact.title || 'Untitled'}</strong>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => void copy()} aria-label="Copy artifact" className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer">
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
          <button onClick={download} aria-label="Download artifact" className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer">
            <Download size={14} />
          </button>
          <button onClick={onClose} aria-label="Close artifact panel" className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="flex gap-1 border-b border-zinc-800 px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-selected={tab === t}
            role="tab"
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium cursor-pointer',
              tab === t ? 'bg-zinc-800 text-violet-400' : 'text-zinc-500 hover:text-zinc-200',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-3">
        {tab === 'Preview' && (
          previewable ? (
            <iframe
              sandbox="allow-scripts"
              title="Artifact preview"
              className="h-full min-h-[320px] w-full rounded-md border border-zinc-800 bg-white"
              srcDoc={artifact.language === 'html' ? artifact.code : `<pre style="font-family:ui-monospace;font-size:12px;white-space:pre-wrap;padding:12px">${artifact.code.replace(/</g, '&lt;')}</pre>`}
            />
          ) : (
            <p className="pt-10 text-center text-xs text-zinc-600">
              Preview is available for HTML and markdown artifacts. Switch to the Code tab.
            </p>
          )
        )}
        {tab === 'Code' && (
          <>
            <CodeBlock code={artifact.code} language={artifact.language} />
            {onCodeUpdate && (
              <button
                onClick={() => onCodeUpdate(artifact.code)}
                className="mt-2 rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 cursor-pointer"
              >
                Save version
              </button>
            )}
          </>
        )}
        {tab === 'History' && (
          artifact.history.length ? (
            <ol className="space-y-2">
              {artifact.history.map((h, i) => (
                <li key={i} className="rounded-md border border-zinc-800 bg-zinc-950 p-2.5">
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>Version {artifact.history.length - i}</span>
                    <span>{new Date(h.at).toLocaleString()}</span>
                  </div>
                  <pre className="mt-1.5 max-h-24 overflow-hidden whitespace-pre-wrap text-[11px] text-zinc-400">
                    {h.content.slice(0, 300)}{h.content.length > 300 ? '…' : ''}
                  </pre>
                </li>
              ))}
              {!artifact.history.length && <p className="pt-6 text-center text-xs text-zinc-600">No saved versions yet.</p>}
            </ol>
          ) : (
            <p className="pt-10 text-center text-xs text-zinc-600">No versions yet — save one from the Code tab.</p>
          )
        )}
      </div>
    </aside>
  );
}

export default ArtifactPanel;