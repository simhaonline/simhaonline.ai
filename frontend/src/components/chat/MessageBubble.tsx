'use client';

// (5) components/chat/MessageBubble.tsx — user right / assistant left,
// markdown via react-markdown + remark-gfm + rehype-highlight, CodeBlock
// with copy + language label + line numbers, hover action bar.

import { memo, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  Check, Copy, Edit3, GitBranch, PanelRight, RefreshCw, Share2, ThumbsDown, ThumbsUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BubbleMessage {
  id: number | string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  model?: string;
  tokens?: number;
  latency_ms?: number;
  created_at?: string;
  rating?: 'up' | 'down' | null;
}

export interface MessageActions {
  onCopy?: (m: BubbleMessage) => void;
  onEditSave?: (m: BubbleMessage, newContent: string) => void;
  onRegenerate?: (m: BubbleMessage) => void;
  onBranch?: (m: BubbleMessage) => void;
  onRate?: (m: BubbleMessage, rating: 'up' | 'down') => void;
  onShare?: (m: BubbleMessage) => void;
  onOpenArtifact?: (m: BubbleMessage, code: string, language: string) => void;
  streaming?: boolean;
}

function isArtifactCandidate(code: string): boolean {
  if ((code.match(/\n/g) || []).length > 30) return true;
  return /^\s*(\/\/|#)\s*[\w.-]+\.[a-z]{2,4}\s*$/im.test(code);
}

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const lines = code.split('\n');
  const lineNumbers = useMemo(
    () => Array.from({ length: lines.length }, (_, i) => i + 1).join('\n'),
    [lines.length],
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  }
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{language || 'code'}</span>
        <button onClick={() => void copy()} aria-label="Copy code" className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-200 cursor-pointer">
          {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/* highlight.js theme is applied globally via rehype-highlight's CSS import in globals */}
      <div className="flex max-h-[400px] overflow-auto">
        <pre aria-hidden className="select-none border-r border-zinc-800/70 px-2 py-2 text-right font-mono text-[11px] leading-5 text-zinc-700">
          {lineNumbers}
        </pre>
        <pre className="flex-1 overflow-x-auto p-3 text-[12.5px] leading-5">
          <code className={cn('hljs language-' + (language || 'plaintext'), 'bg-transparent! text-zinc-200')} dangerouslySetInnerHTML={{ __html: highlightCode(code, language) }} />
        </pre>
      </div>
    </div>
  );
}

// server-safe highlighter (lowlight = highlight.js without DOM)
import { createLowlight, all } from 'lowlight';
import { toHtml } from 'hast-util-to-html';

const lowlight = createLowlight(all);
let registered = false;
function ensureLanguages() {
  if (registered) return;
  registered = true;
  // lazy-register a practical subset
  const langs: Record<string, () => { default: unknown }> = {
    javascript: () => require('highlight.js/lib/languages/javascript'),
    typescript: () => require('highlight.js/lib/languages/typescript'),
    xml: () => require('highlight.js/lib/languages/xml'),
    css: () => require('highlight.js/lib/languages/css'),
    json: () => require('highlight.js/lib/languages/json'),
    bash: () => require('highlight.js/lib/languages/bash'),
    python: () => require('highlight.js/lib/languages/python'),
    sql: () => require('highlight.js/lib/languages/sql'),
    go: () => require('highlight.js/lib/languages/go'),
    markdown: () => require('highlight.js/lib/languages/markdown'),
    plaintext: () => require('highlight.js/lib/languages/plaintext'),
  };
  for (const [name, loader] of Object.entries(langs)) {
    try { lowlight.register(name, loader().default as never); } catch { /* skip */ }
  }
}

function highlightCode(code: string, language: string): string {
  try {
    ensureLanguages();
    const lang = language || 'plaintext';
    const hast = lowlight.highlight(lang, code);
    return toHtml(hast);
  } catch {
    return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

function ActionButton({ label, children, onClick, active }: {
  label: string; children: React.ReactNode; onClick?: () => void; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn('rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer', active && 'text-violet-400')}
    >
      {children}
    </button>
  );
}

function ActionsRow({ message, actions }: { message: BubbleMessage; actions: MessageActions }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [shared, setShared] = useState(false);

  async function share() {
    try {
      const url = `${window.location.origin}/chat/${message.id}`;
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1600);
    } catch { /* blocked */ }
    actions.onShare?.(message);
  }

  return (
    <>
      <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <ActionButton label="Copy" onClick={() => actions.onCopy?.(message)}><Copy size={12} /></ActionButton>
        {message.role === 'user' && (
          <ActionButton label="Edit" onClick={() => { setDraft(message.content); setEditing((v) => !v); }}><Edit3 size={12} /></ActionButton>
        )}
        {message.role === 'assistant' && (
          <>
            <ActionButton label="Regenerate" onClick={() => actions.onRegenerate?.(message)}><RefreshCw size={12} /></ActionButton>
            <ActionButton label="Branch" onClick={() => actions.onBranch?.(message)}><GitBranch size={12} /></ActionButton>
            <ActionButton label="Thumbs up" active={message.rating === 'up'} onClick={() => actions.onRate?.(message, 'up')}><ThumbsUp size={12} /></ActionButton>
            <ActionButton label="Thumbs down" active={message.rating === 'down'} onClick={() => actions.onRate?.(message, 'down')}><ThumbsDown size={12} /></ActionButton>
            <ActionButton label="Share message" onClick={() => void share()}>
              {shared ? <Check size={12} className="text-green-400" /> : <Share2 size={12} />}
            </ActionButton>
          </>
        )}
      </div>
      {editing && (
        <div className="mt-2 w-full">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(10, draft.split('\n').length + 1)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          <div className="mt-1.5 flex gap-2">
            <button
              onClick={() => { actions.onEditSave?.(message, draft); setEditing(false); }}
              className="rounded-md bg-violet-500 px-3 py-1 text-xs font-medium text-white hover:bg-violet-400 cursor-pointer"
            >
              Save &amp; re-run
            </button>
            <button onClick={() => setEditing(false)} className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message, actions, streaming,
}: { message: BubbleMessage; actions: MessageActions; streaming?: boolean }) {
  const isUser = message.role === 'user';
  const hasArtifact = useMemo(() => {
    const match = message.content.match(/```[\w-]*\n([\s\S]*?)```/);
    return Boolean(match && isArtifactCandidate(match[1]));
  }, [message.content]);

  return (
    <div className={cn('group flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('min-w-0 max-w-[85%]', isUser && 'flex flex-col items-end')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed',
            isUser ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-200',
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <div className="workbench-md [&_code:not(pre code)]:rounded [&_code:not(pre code)]:bg-zinc-800 [&_code:not(pre code)]:px-1 [&_code:not(pre code)]:py-0.5 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:m-0 [&_strong]:text-zinc-50 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  pre: ({ children }) => <>{children}</>,
                  code: ({ className, children }) => {
                    const raw = String(children ?? '');
                    const match = /language-(\w+)/.exec(String(className || ''));
                    if (!match) {
                      return <code className="rounded bg-zinc-800 px-1 py-0.5 text-[13px]">{children}</code>;
                    }
                    return <CodeBlock code={raw.replace(/\n$/, '')} language={match[1]} />;
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
              {streaming && <span className="streaming-cursor" aria-hidden />}
            </div>
          )}
        </div>
        {!isUser && !streaming && (
          <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
            {message.model && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono">{message.model}</span>}
            {message.tokens ? <span>{message.tokens.toLocaleString()} tok</span> : null}
            {message.latency_ms != null && <span>{message.latency_ms}ms</span>}
          </div>
        )}
        {!streaming && <ActionsRow message={message} actions={actions} />}
        {hasArtifact && !streaming && (
          <button
            onClick={() => {
              const match = message.content.match(/```[\w-]*\n([\s\S]*?)```/);
              const langMatch = message.content.match(/```([\w-]*)/);
              if (match) actions.onOpenArtifact?.(message, match[1], langMatch?.[1] || '');
            }}
            className="mt-1 flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-violet-400 hover:bg-zinc-800 cursor-pointer"
          >
            <PanelRight size={12} /> Open in Artifact panel
          </button>
        )}
      </div>
    </div>
  );
});

export default MessageBubble;