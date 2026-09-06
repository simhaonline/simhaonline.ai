'use client';

// (7) components/chat/InputBar.tsx — composer: attachments, auto-resize
// textarea, upload/tools/voice/context buttons, model selector, workspace
// scoping, send/stop.

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, Paperclip, Puzzle, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { wbApi } from '@/lib/wb-api';
import { useChat } from '@/store/chat';
import { ModelSelector } from './ModelSelector';

export interface SendPayload {
  text: string;
  fileIds: string[];
}

export function InputBar({
  onSend, onStop, streaming, disabled,
}: {
  onSend: (payload: SendPayload) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
}) {
  const { draft, setDraft, attachedFiles, addAttachedFile, removeAttachedFile, enabledPlugins, activePersona } = useChat();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState('');
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  // auto-resize
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 48), 192)}px`;
  }, [draft]);

  function focus() {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }
  useEffect(() => { focus(); }, [/* focus on mount */]);

  function submit() {
    const text = draft.trim();
    if (!text || streaming || disabled) return;
    onSend({ text, fileIds: useChat.getState().attachedFiles.map((f) => f.fileId) });
    setDraft('');
    focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      setDraft('');
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setNotice('');
    for (const file of Array.from(files).slice(0, 10)) {
      try {
        const d = await wbApi.files.upload(file);
        addAttachedFile({ fileId: d.fileId, name: d.name, previewUrl: d.previewUrl });
      } catch (err) {
        setNotice(String((err as Error).message || err));
      }
    }
    setUploading(false);
  }

  function toggleVoice() {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setNotice('Voice input requires a browser with Web Speech API support.');
      return;
    }
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event: SpeechEventLike) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          setDraft(useChat.getState().draft + ' ' + event.results[i][0].transcript.trim());
        }
      }
    };
    rec.onend = () => setRecording(false);
    rec.start();
    recognitionRef.current = rec;
    setRecording(true);
  }

  return (
    <div className="sticky bottom-0 bg-zinc-900 p-3">
      <div className="mx-auto max-w-3xl">
        {/* attachment previews */}
        {useChat.getState().attachedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {useChat.getState().attachedFiles.map((f) => (
              <span key={f.fileId} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300">
                <Paperclip size={10} className="text-violet-400" />
                {f.name}
                <button
                  onClick={() => useChat.getState().removeAttachedFile(f.fileId)}
                  aria-label={`Remove ${f.name}`}
                  className="text-zinc-600 hover:text-red-400 cursor-pointer"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-zinc-700 bg-zinc-950 focus-within:border-violet-500">
          <div className="flex items-end gap-1.5 p-2">
            {/* left tools */}
            <div className="flex items-center gap-0.5">
              <input
                ref={fileRef}
                hidden
                type="file"
                multiple
                accept="image/*,application/pdf,.txt,.md,.csv,.xlsx,.docx"
                onChange={(e) => void upload(e.target.files)}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                title="Upload files"
                aria-label="Upload files"
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer disabled:opacity-50"
              >
                ＋
              </button>
              <button
                onClick={() => setNotice(enabledPlugins.length ? 'Toggle tools per-message from the Tools menu.' : 'Enable plugins under Integrations first.')}
                title="Tools"
                aria-label="Tools"
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer"
              >
                ⌘
              </button>
              <button
                onClick={toggleVoice}
                title="Voice input"
                aria-label="Voice input"
                className={cn(
                  'rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer',
                  recording && 'animate-pulse bg-red-500/20 text-red-400',
                )}
              >
                <Mic size={16} />
              </button>
              <button
                onClick={() => setNotice('Attach workspace context from the Library tab.')}
                title="Context"
                aria-label="Context"
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer"
              >
                ◉
              </button>
            </div>

            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Ask anything…"
              aria-label="Message"
              className="max-h-48 min-h-12 flex-1 resize-none bg-transparent px-1 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            />

            {/* right controls */}
            <div className="flex items-center gap-1.5">
              <ModelSelector />
              <button
                onClick={() => setNotice('Workspace scoping: pick a workspace in the sidebar footer.')}
                title="Workspace scope"
                aria-label="Workspace scope"
                className="hidden rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-600 cursor-pointer sm:block"
              >
                ◫ Workspace
              </button>
              {streaming ? (
                <button
                  onClick={onStop}
                  aria-label="Stop generating"
                  title="Stop generating"
                  className="grid h-9 w-9 place-items-center rounded-lg bg-red-500 text-white hover:bg-red-400 cursor-pointer"
                >
                  <span className="block h-3 w-3 rounded-[2px] bg-white" aria-hidden />
                </button>
              ) : (
                <button
                  onClick={submit}
                  disabled={!draft.trim() || disabled}
                  aria-label="Send message"
                  title="Send (Enter)"
                  className="grid h-9 w-9 place-items-center rounded-lg bg-violet-500 text-white hover:bg-violet-400 cursor-pointer disabled:opacity-40"
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-zinc-600">
          <span>
            {activePersona ? (
              <span className="text-zinc-400">
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: activePersona.color }} />
                {activePersona.name} ·
              </span>
            ) : null}
            {' '}Enter to send · Shift+Enter for newline · Ctrl+K for commands
          </span>
          <span>Simha can make mistakes. Verify important information.</span>
        </div>
        {notice && <p className="mt-1 px-1 text-[11px] text-amber-400" role="status">{notice}</p>}
      </div>
      {/* keep Puzzle import used for tree-shaking stability */}
      <span className="hidden"><Puzzle size={1} /></span>
    </div>
  );
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
interface SpeechEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: { isFinal: boolean; [j: number]: { transcript: string } } };
}

export default InputBar;