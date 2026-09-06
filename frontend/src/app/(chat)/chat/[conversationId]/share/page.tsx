'use client';

// (12) app/(chat)/chat/[conversationId]/share/page.tsx — public read-only
// share view keyed by share token (no auth).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { wbApi, type V1Message } from '@/lib/wb-api';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { Button } from '@/components/ui/primitives';

export default function SharedConversationPage() {
  const params = useParams<{ conversationId: string }>();
  const [messages, setMessages] = useState<V1Message[]>([]);
  const [title, setTitle] = useState('');
  const [model, setModel] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await wbApi.share(params.conversationId);
        setTitle(d.title);
        setModel(d.model || '');
        setMessages(d.messages || []);
      } catch (e) {
        setError(String((e as Error).message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, [params.conversationId]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <header className="mb-8 flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-500 text-black">⌁</span>
        <span className="text-sm font-semibold">Simha Workbench</span>
        <span className="ml-2 rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-500">Shared conversation</span>
      </header>

      {loading && <p className="py-16 text-center text-sm text-zinc-600">Loading shared conversation…</p>}
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-6 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => window.location.reload()}>Retry</Button>
        </div>
      )}

      {!loading && !error && (
        <>
          <h1 className="mb-6 text-2xl font-semibold tracking-tight">{title}</h1>
          <div className="space-y-5">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} actions={{}} />
            ))}
            {!messages.length && <p className="py-10 text-center text-sm text-zinc-600">This conversation has no messages.</p>}
          </div>
          <div className="mt-12 rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
            <p className="text-sm text-zinc-300">Want to continue this conversation with your own models?</p>
            <Button className="mt-3" onClick={() => { window.location.href = 'https://platform.simhaonline.ai/signup'; }}>
              Continue this conversation
            </Button>
          </div>
        </>
      )}
    </main>
  );
}