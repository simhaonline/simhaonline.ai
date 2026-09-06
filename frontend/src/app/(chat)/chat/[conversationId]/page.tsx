'use client';

// (4) app/(chat)/chat/[conversationId]/page.tsx — full conversation view:
// inline-editable title, model/cost header, message list with optimistic
// send + SSE streaming, artifact panel, error boundary with Retry.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Download, RefreshCw, Share2 } from 'lucide-react';
import { wbApi, ApiError, type V1Message } from '@/lib/wb-api';
import { useChat, type ChatMessage } from '@/store/chat';
import { streamChat } from '@/lib/streaming';
import { MessageBubble, type BubbleMessage, type MessageActions } from '@/components/chat/MessageBubble';
import { ArtifactPanel, type ArtifactState } from '@/components/chat/ArtifactPanel';
import { MessageListErrorBoundary } from '@/components/chat/MessageListErrorBoundary';
import { InputBar } from '@/components/chat/InputBar';
import { CompareMode } from '@/components/chat/CompareMode';
import { Button } from '@/components/ui/primitives';

const EMPTY_ARTIFACT: ArtifactState = {
  open: false, title: '', language: '', code: '', history: [],
};

export default function ConversationPage() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = Number(params.conversationId);
  const router = useRouter();
  const {
    messages, setMessages, appendMessage, updateStreamingMessage,
    finalizeStreamingMessage, removeMessage, conversations, isStreaming,
    selectedModel, enabledPlugins, compareMode,
  } = useChat();

  const [title, setTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [loading, setLoading] = useState(true);
  const [streamError, setStreamError] = useState('');
  const [artifact, setArtifact] = useState<ArtifactState>(EMPTY_ARTIFACT);
  const [tokens, setTokens] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const list = messages[conversationId] || [];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, convs] = await Promise.all([
        wbApi.conversations.messages(conversationId),
        wbApi.conversations.list(),
      ]);
      setMessages(conversationId, d.messages as ChatMessage[]);
      // ids are strings over the wire ("8") — compare loosely
      const conv = convs.conversations.find((c) => String(c.id) === String(conversationId));
      if (conv) setTitle(conv.title);
    } catch (e) {
      setStreamError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, [conversationId, setMessages]);

  useEffect(() => { void load(); }, [load]);

  // auto-scroll on new content
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages[conversationId]?.length, messages[conversationId]?.[messages[conversationId]?.length - 1]?.content]);

  const runStream = useCallback(async (history: ChatMessage[], mediaMode?: 'image' | 'video' | 'audio' | null, taskMode?: 'translate' | 'research' | 'code' | 'vision' | null, suffix?: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStreamError('');
    const started = Date.now();
    let content = '';
    try {
      await streamChat(
        conversationId,
        history.filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content })),
        selectedModel,
        enabledPlugins,
        [],
        {
          signal: controller.signal,
          mediaMode: mediaMode || null,
          taskMode: taskMode || null,
          onChunk: (chunk) => { content += chunk; updateStreamingMessage(conversationId, suffix ? content + suffix : content); },
          onDone: async (usage) => {
            const latency = Date.now() - started;
            finalizeStreamingMessage(conversationId, {
              tokens: usage?.completion_tokens, latency_ms: latency, model: selectedModel,
            });
            setTokens((t) => t + (usage?.total_tokens || 0));
            // persist the assistant message (+ research source footer)
            const finalContent = content + (suffix || '');
            try {
              await wbApi.messages.save(conversationId, {
                role: 'assistant', content: finalContent, model: selectedModel, tokens: usage?.completion_tokens,
              });
            } catch { /* offline persistence retry later */ }
          },
        },
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setStreamError((e as Error).message || 'Stream failed');
      }
      finalizeStreamingMessage(conversationId, {});
    }
  }, [conversationId, selectedModel, enabledPlugins, updateStreamingMessage, finalizeStreamingMessage]);

  async function send({ text, fileIds, mediaMode, taskMode }: { text: string; fileIds: string[]; mediaMode?: 'image' | 'video' | 'audio' | null; taskMode?: 'translate' | 'research' | 'code' | 'vision' | null }) {
    void fileIds;
    // optimistic user message (annotated with the active mode)
    const badge = mediaMode ? ` [${mediaMode}]` : taskMode ? ` [${taskMode}]` : '';
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text + badge };
    appendMessage(conversationId, userMsg);
    const history = [...(messages[conversationId] || []), userMsg];
    try { await wbApi.messages.save(conversationId, { role: 'user', content: text }); } catch { /* retry later */ }

    // Deep Research: run the source pipeline first, then synthesize with a
    // context block containing the retrieved sources (cited synthesis).
    if (taskMode === 'research') {
      updateStreamingMessage(conversationId, '🔎 Searching the web and reading sources…');
      try {
        const d = await wbApi.research.run(text, 2);
        if (d.sources.length) {
          const context = d.sources
            .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n${s.snippet}`)
            .join('\n\n');
          const synth = `Using ONLY the sources below, answer the question. Cite sources as [n]. If the sources do not cover something, say so.\n\nQuestion: ${text}\n\nSources:\n${context}`;
          await wbApi.messages.save(conversationId, { role: 'system', content: `research-context: ${d.sources.length} sources` });
          const sourcesFooter = `\n\n---\n**Sources**\n${d.sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join('\n')}`;
          const history2 = [...history, { id: `s-${Date.now()}`, role: 'user' as const, content: synth }];
          await runStream(history2, null, null, sourcesFooter);
          return;
        }
        updateStreamingMessage(conversationId, `⚠ ${d.note || 'No sources found — falling back to model knowledge.'}`);
      } catch {
        updateStreamingMessage(conversationId, '⚠ Source search failed — falling back to model knowledge.');
      }
      await new Promise((r) => setTimeout(r, 900));
    }
    await runStream(history, mediaMode, taskMode);
  }

  async function regenerate(message: BubbleMessage) {
    // delete last assistant message server-side, then re-stream from history
    if (typeof message.id === 'number') {
      try { await wbApi.messages.delete(conversationId, message.id); } catch { /* best effort */ }
    }
    removeMessage(conversationId, message.id);
    const history = (messages[conversationId] || []).filter((m) => m.id !== message.id);
    await runStream(history);
  }

  async function editSave(message: BubbleMessage, newContent: string) {
    const history = (messages[conversationId] || []).map((m) =>
      m.id === message.id ? { ...m, content: newContent } : m);
    setMessages(conversationId, history);
    if (typeof message.id === 'number') {
      try { await wbApi.messages.delete(conversationId, message.id); } catch { /* best effort */ }
      try { await wbApi.messages.save(conversationId, { role: message.role, content: newContent }); } catch { /* best effort */ }
    }
    await runStream(history);
  }

  async function rate(message: BubbleMessage, rating: 'up' | 'down') {
    if (typeof message.id === 'number') {
      try { await wbApi.messages.rate(message.id, rating); } catch { /* best effort */ }
    }
    // durable feedback record (cross-check gap: feedback table had no endpoint)
    try { await wbApi.feedback.send(rating, `${rating}: ${message.content.slice(0, 200)}`); } catch { /* best effort */ }
    setMessages(conversationId, (messages[conversationId] || []).map((m) =>
      m.id === message.id ? { ...m, rating: m.rating === rating ? null : rating } : m));
  }

  const actions: MessageActions = {
    onCopy: async (m) => { try { await navigator.clipboard.writeText(m.content); } catch { /* blocked */ } },
    onEditSave: (m, text) => void editSave(m, text),
    onRegenerate: (m) => void regenerate(m),
    onBranch: async (m) => {
      try {
        if (typeof m.id === 'number') {
          const created = await wbApi.conversations.branch(conversationId, m.id);
          router.push(`/chat/${created.id}`);
        }
      } catch { /* branch endpoint optional */ }
    },
    onRate: (m, r) => void rate(m, r),
    onShare: async () => {
      try {
        const { url } = await wbApi.conversations.share(conversationId);
        await navigator.clipboard.writeText(url);
      } catch { /* blocked */ }
    },
    onOpenArtifact: (m, code, language) => {
      setArtifact({
        open: true,
        title: m.model ? `Artifact · ${m.model}` : 'Artifact',
        language, code,
        history: [{ at: new Date().toISOString(), content: code }],
      });
    },
  };

  async function exportMarkdown() {
    const md = (messages[conversationId] || [])
      .map((m) => `**${m.role}**\n\n${m.content}`).join('\n\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(title || 'conversation').replace(/[^\w-]+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const inCompare = compareMode.enabled;

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {editingTitle ? (
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={async () => {
                  setEditingTitle(false);
                  if (title.trim()) await wbApi.conversations.rename(conversationId, title.trim());
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className="w-64 rounded-md border border-violet-500 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 focus:outline-none"
              />
            ) : (
              <h1
                onClick={() => setEditingTitle(true)}
                title="Click to rename"
                className="cursor-text truncate text-sm font-semibold text-zinc-100"
              >
                {title || 'Conversation'}
              </h1>
            )}
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{selectedModel}</span>
            <span className="text-[10px] text-zinc-600">{tokens.toLocaleString()} tokens</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => void wbApi.conversations.share(conversationId).then(async ({ url }) => {
              try { await navigator.clipboard.writeText(url); } catch { /* blocked */ }
            })}>
              <Share2 size={12} /> Share
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void exportMarkdown()}>
              <Download size={12} /> Export
            </Button>
          </div>
        </header>

        {/* body */}
        {inCompare ? (
          <CompareMode draft="" onSent={() => undefined} />
        ) : (
          <div className="relative flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-6">
                <MessageListErrorBoundary onRetry={() => void load()}>
                <div className="mx-auto w-full max-w-3xl space-y-5">
                {loading && <p className="pt-10 text-center text-xs text-zinc-600">Loading conversation…</p>}
                {(messages[conversationId] || []).map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m as BubbleMessage}
                    actions={actions}
                    streaming={isStreaming && useChat.getState().streamingMessageId === m.id}
                  />
                ))}
                {streamError && (
                  <Card className="mx-auto max-w-md border-red-500/40 bg-red-500/5 p-4 text-center">
                    <p className="text-sm text-red-400">Something went wrong — {streamError}</p>
                    <Button
                      variant="secondary" size="sm" className="mt-2"
                      onClick={() => {
                        const history = (messages[conversationId] || []).filter((m) => m.role !== 'assistant' || m.id !== messages[conversationId]?.slice(-1)[0]?.id);
                        void runStream(history);
                      }}
                    >
                      <RefreshCw size={12} /> Retry
                    </Button>
                  </Card>
                )}
                </div>
                </MessageListErrorBoundary>
              </div>
              <InputBar onSend={send} onStop={() => abortRef.current?.abort()} streaming={isStreaming} />
            </div>
            <ArtifactPanel
              artifact={artifact}
              onClose={() => setArtifact((a) => ({ ...a, open: false }))}
              onCodeUpdate={(code) => setArtifact((a) => ({
                ...a, history: [...a.history, { at: new Date().toISOString(), content: code }],
              }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// small local Card to avoid a circular import
function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-lg border ${className || ''}`}>{children}</div>;
}