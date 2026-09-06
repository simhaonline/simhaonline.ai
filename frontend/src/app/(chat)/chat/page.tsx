'use client';

// (3) app/(chat)/chat/page.tsx — empty state: centered brand heading,
// 2×2 suggestion cards that prefill the composer.

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useChat } from '@/store/chat';
import { InputBar } from '@/components/chat/InputBar';
import { wbApi } from '@/lib/wb-api';

const SUGGESTIONS = [
  { icon: '◈', title: 'Plan a solution', hint: 'Break down a complex task', prompt: 'Analyze this problem and propose a practical implementation plan.' },
  { icon: '◈', title: 'Review code', hint: 'Concrete fixes and improvements', prompt: 'Review this code and suggest concrete improvements.' },
  { icon: '▤', title: 'Summarize context', hint: 'Turn detail into direction', prompt: 'Summarize the key decisions and open questions from this context:' },
  { icon: '⌕', title: 'Research a topic', hint: 'Source-aware analysis', prompt: 'Research this topic and cite the most important evidence:' },
] as const;

export default function ChatEmptyPage() {
  const router = useRouter();
  const { setDraft, selectedModel } = useChat();

  const sendWith = useCallback(async (text: string) => {
    // create the conversation immediately, then land on it with the draft
    setDraft(text);
    try {
      const c = await wbApi.conversations.create(text.slice(0, 80));
      router.push(`/chat/${c.id}`);
    } catch {
      // session issue — the layout guard will surface sign-in
    }
  }, [router, setDraft]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-violet-400">Simha Workbench</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">What can I help with?</h1>
        <p className="mt-2 max-w-md text-center text-sm text-zinc-500">
          Ask anything — the best available model answers automatically.
        </p>
        <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.title}
              onClick={() => { setDraft(s.prompt); void sendWith(s.prompt); }}
              className="group flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left hover:border-violet-500/60 hover:bg-zinc-800/60 cursor-pointer"
            >
              <span className="flex items-center gap-3">
                <span className="text-violet-400" aria-hidden>{s.icon}</span>
                <span>
                  <b className="block text-[13px] text-zinc-100">{s.title}</b>
                  <small className="text-[11px] text-zinc-500">{s.hint}</small>
                </span>
              </span>
              <span className="text-zinc-600 transition-transform group-hover:translate-x-0.5" aria-hidden>→</span>
            </button>
          ))}
        </div>
      </div>
      <InputBar onSend={({ text }) => void sendWith(text)} onStop={() => undefined} streaming={false} />
    </div>
  );
}