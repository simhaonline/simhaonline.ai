'use client';

// (3) app/(chat)/chat/page.tsx — empty state: one centered column, quiet
// brand line, big question, 2×2 suggestion cards, composer aligned to
// the same grid. Everything shares max-w-3xl so the eye lands center.

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
  const { setDraft } = useChat();

  const sendWith = useCallback(async (text: string) => {
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
      <div className="flex flex-1 items-center justify-center overflow-auto px-6">
        <div className="w-full max-w-3xl pb-10">
          <div className="text-center">
            <h1 className="text-[28px] font-semibold tracking-tight text-zinc-50">
              What can I help with?
            </h1>
            <p className="mt-2 text-[15px] text-zinc-400">
              Ask anything — the best available model answers automatically.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.title}
                onClick={() => { setDraft(s.prompt); void sendWith(s.prompt); }}
                className="group flex items-center gap-3.5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-800/80 cursor-pointer"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-zinc-700/70 bg-zinc-800/60 text-[15px] text-violet-400" aria-hidden>
                  {s.icon}
                </span>
                <span className="min-w-0">
                  <b className="block text-[13.5px] font-medium text-zinc-100">{s.title}</b>
                  <small className="mt-0.5 block truncate text-[12px] text-zinc-500">{s.hint}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <InputBar onSend={({ text }) => void sendWith(text)} onStop={() => undefined} streaming={false} />
    </div>
  );
}