'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import TopBar from '@/components/TopBar';

interface ChatSummary {
  id: number;
  title: string;
  updated_at: string;
}

interface Message {
  id?: number;
  role: string;
  content: string;
  model?: string;
}

interface Feature {
  id: number;
  kind: string;
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
}

export default function ChatPage() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('auto');
  const [models, setModels] = useState<string[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [authError, setAuthError] = useState(false);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadBootstrap = useCallback(async () => {
    const r = await fetch('/api/chat/bootstrap');
    if (r.status === 401) {
      setAuthError(true);
      return;
    }
    const d = await r.json();
    setChats(d.chats || []);
    setFeatures(d.features || []);
    const mdl = await fetch('/api/chat/models').then((x) => (x.ok ? x.json() : { models: [] }));
    setModels(mdl.models || []);
  }, []);

  const loadMessages = useCallback(async (chatId: number) => {
    const r = await fetch(`/api/chat/chats/${chatId}/messages`);
    if (!r.ok) return;
    const d = await r.json();
    setMessages(d.messages || []);
  }, []);

  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (activeId) loadMessages(activeId);
  }, [activeId, loadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function newChat() {
    const r = await fetch('/api/chat/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New conversation', model }),
    });
    if (!r.ok) return;
    const d = await r.json();
    setChats((c) => [{ id: d.id, title: d.title, updated_at: d.created_at }, ...c]);
    setActiveId(d.id);
    setMessages([]);
  }

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    setInput('');
    let chatId = activeId;
    if (!chatId) {
      const r = await fetch('/api/chat/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: content.slice(0, 80), model }),
      });
      const d = await r.json();
      chatId = d.id;
      setChats((c) => [{ id: d.id, title: d.title, updated_at: d.created_at }, ...c]);
      setActiveId(d.id);
    }
    setMessages((m) => [...m, { role: 'user', content }]);
    await fetch(`/api/chat/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content }),
    });
    // Dispatch through the gateway (OpenAI shape) and persist the assistant turn.
    try {
      const r = await fetch('/api/chat/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          model: model === 'auto' ? undefined : model,
          messages: [...messages.filter((m) => m.role !== 'tool'), { role: 'user', content }],
        }),
      });
      const d = await r.json().catch(() => ({}));
      const reply = d.content || d.error || '(no response)';
      setMessages((m) => [...m, { role: 'assistant', content: reply, model: d.model }]);
      if (chatId) {
        await fetch(`/api/chat/chats/${chatId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', content: reply, model: d.model, tokens: d.tokens }),
        });
      }
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${String(e)}` }]);
    }
    setBusy(false);
  }

  if (authError) {
    return (
      <>
        <TopBar />
        <main className="container" style={{ paddingTop: 80, textAlign: 'center' }}>
          <h1 style={{ fontSize: 26 }}>Sign in to use the workbench</h1>
          <p className="sub" style={{ margin: '12px auto 24px' }}>
            The chat workbench is available to operator accounts.
          </p>
          <a className="btn primary" href="/login">
            Sign in
          </a>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <div className="chat-shell">
        <aside className="chat-side">
          <button className="btn primary" style={{ width: '100%', marginBottom: 12 }} onClick={newChat}>
            + New chat
          </button>
          {chats.map((c) => (
            <button
              key={c.id}
              className={`sideitem ${c.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(c.id)}
            >
              {c.title}
            </button>
          ))}
          {features.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="kicker" style={{ fontSize: 11 }}>
                Capabilities
              </div>
              {features.slice(0, 6).map((f) => (
                <div key={f.id} style={{ fontSize: 13, color: 'var(--muted)', padding: '2px 10px' }}>
                  {f.enabled ? '✓' : '·'} {f.name}
                </div>
              ))}
            </div>
          )}
        </aside>
        <main className="chat-main">
          <div className="chat-scroll" ref={scrollRef}>
            {!messages.length && (
              <p className="sub">Start a conversation. Requests route through the edge gateway.</p>
            )}
            {messages.map((m, i) => (
              <div key={m.id ?? i} className={`msg ${m.role}`}>
                <div className="who">
                  {m.role === 'assistant' ? `assistant${m.model ? ` · ${m.model}` : ''}` : m.role}
                </div>
                <div className="bubble">{m.content}</div>
              </div>
            ))}
            {busy && <p className="sub">Thinking…</p>}
          </div>
          <div className="chat-inputbar">
            <select
              style={{ maxWidth: 200 }}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              aria-label="Model"
            >
              <option value="auto">auto (best available)</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              placeholder="Message the router…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button className="btn primary" onClick={send} disabled={busy}>
              Send
            </button>
          </div>
        </main>
      </div>
    </>
  );
}