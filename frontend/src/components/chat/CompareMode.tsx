'use client';

// (10) components/chat/CompareMode.tsx — 2–4 equal panels, same prompt
// broadcast to each model in parallel, per-panel stop/token/latency.

import { useCallback, useRef, useState } from 'react';
import { Square, X } from 'lucide-react';
import { MessageBubble, type BubbleMessage } from './MessageBubble';
import { ModelSelector } from './ModelSelector';
import { streamChat } from '@/lib/streaming';
import { useChat } from '@/store/chat';
import { cn } from '@/lib/utils';

export function CompareMode({ draft, onSent }: { draft: string; onSent: (text: string) => void }) {
  const { compareMode, addCompareModel, updateCompareStreaming, appendCompareMessage, toggleCompareMode } = useChat();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const controllers = useRef<Record<string, AbortController>>({});
  const models = compareMode.models.length ? compareMode.models : ['auto', 'auto'];

  const run = useCallback(async (model: string, text: string) => {
    const controller = new AbortController();
    controllers.current[model] = controller;
    setBusy((b) => ({ ...b, [model]: true }));
    appendCompareMessage(model, { id: `u-${Date.now()}-${model}`, role: 'user', content: text });
    const started = Date.now();
    let content = '';
    try {
      await streamChat(0, [{ role: 'user', content: text }], model, [], [], {
        signal: controller.signal,
        onChunk: (chunk) => { content += chunk; updateCompareStreaming(model, content); },
        onDone: (usage) => {
          appendCompareMessage(model, {
            id: `a-${Date.now()}-${model}`, role: 'assistant', content,
            model, tokens: usage?.completion_tokens, latency_ms: Date.now() - started,
          });
          // remove streaming placeholder
          const list = useChat.getState().compareMode.messages[model] || [];
          useChat.getState().setCompareMessages(model, list.filter((m) => String(m.id).startsWith('u-') || !String(m.id).startsWith('cmp-stream-')));
        },
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        appendCompareMessage(model, {
          id: `e-${Date.now()}-${model}`, role: 'assistant',
          content: `⚠ Stream failed: ${(err as Error).message}`, model,
        });
      }
    } finally {
      setBusy((b) => ({ ...b, [model]: false }));
    }
  }, [appendCompareMessage, updateCompareStreaming]);

  function broadcast() {
    const text = draft.trim();
    if (!text) return;
    onSent(text);
    for (const m of models) void run(m, text);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <p className="text-xs text-zinc-400">
          Compare mode — the same message goes to every panel in parallel.
        </p>
        <button
          onClick={toggleCompareMode}
          className="flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 cursor-pointer"
        >
          <X size={11} /> Exit compare
        </button>
      </div>
      <div className="flex flex-1 divide-x divide-zinc-800 overflow-hidden">
        {models.map((model, i) => {
          const messages = compareMode.messages[model] || [];
          return (
            <section key={`${model}-${i}`} className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                <ModelSelector />
                {busy[model] && (
                  <button
                    onClick={() => controllers.current[model]?.abort()}
                    aria-label={`Stop ${model}`}
                    className="grid h-7 w-7 place-items-center rounded-md bg-red-500/90 text-white cursor-pointer"
                  >
                    <Square size={11} />
                  </button>
                )}
              </div>
              <div className="flex-1 space-y-3 overflow-auto p-3">
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m as BubbleMessage}
                    actions={{ streaming: String(m.id).startsWith('cmp-stream-') }}
                  />
                ))}
                {!messages.length && (
                  <p className="pt-10 text-center text-xs text-zinc-600">Send a message to compare.</p>
                )}
              </div>
            </section>
          );
        })}
        {models.length < 4 && (
          <section className="grid w-44 place-items-center border-l border-dashed border-zinc-800">
            <button
              onClick={() => addCompareModel('auto')}
              className="rounded-md border border-dashed border-zinc-700 px-3 py-6 text-[11px] text-zinc-500 hover:border-violet-500 hover:text-violet-400 cursor-pointer"
            >
              + Add model panel
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

export default CompareMode;