'use client';

// (7) components/chat/InputBar.tsx — ChatGPT-class composer: one outlined
// rounded-3xl shell; textarea on top, tool row below (left: attach/tools/
// voice/context · right: model picker, workspace, send/stop). No per-field
// borders (globals resets fields inside .wb-root).

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, Paperclip, Plus, Square } from 'lucide-react';
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
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 52), 200)}px`;
  }, [draft]);

  useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  function submit() {
    const text = draft.trim();
    if (!text || streaming || disabled) return;
    onSend({ text, fileIds: useChat.getState().attachedFiles.map((f) => f.fileId) });
    setDraft('');
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

  const toolBtn = 'grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer disabled:opacity-50';

  return (
    <div className="sticky bottom-0 bg-gradient-to-t from-zinc-950 via-zinc-950 to-transparent pb-3 pt-2">
      <div className="mx-auto w-full max-w-3xl px-4">
        {/* attachment previews */}
        {attachedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachedFiles.map((f) => (
              <span key={f.fileId} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-300">
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

        {/* the composer shell — the only bordered element */}
        <div className="rounded-[22px] border border-zinc-700 bg-zinc-900 shadow-[0_10px_40px_rgba(0,0,0,0.45)] transition-colors focus-within:border-zinc-500 hover:border-zinc-600">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask anything…"
            aria-label="Message"
            className="max-h-[200px] min-h-[52px] w-full resize-none bg-transparent px-5 pt-4 text-[15px] leading-6 text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
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
              <button onClick={() => fileRef.current?.click()} disabled={uploading} title="Attach files" aria-label="Attach files" className={toolBtn}>
                <Plus size={17} />
              </button>
              <button
                onClick={() => setNotice(enabledPlugins.length ? 'Toggle tools per-message from the Tools menu.' : 'Enable plugins under Integrations first.')}
                title="Tools" aria-label="Tools" className={toolBtn}
              >
                <PuzzleGlyph />
              </button>
              <button
                onClick={toggleVoice}
                title="Voice input" aria-label="Voice input"
                className={cn(toolBtn, recording && 'animate-pulse bg-red-500/15 text-red-400')}
              >
                <Mic size={16} />
              </button>
              <button
                onClick={() => setNotice('Attach workspace context from the Library tab.')}
                title="Context" aria-label="Context" className={toolBtn}
              >
                <span className="text-[15px] leading-none" aria-hidden>◎</span>
              </button>
              {activePersona && (
                <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 py-1 pl-1.5 pr-2.5 text-[11px] text-violet-300">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: activePersona.color }} aria-hidden />
                  {activePersona.name}
                </span>
              )}
            </div>

            {/* right controls */}
            <div className="flex items-center gap-1.5">
              <ModelSelector />
              <button
                onClick={() => setNotice('Workspace scoping: pick a workspace in the sidebar footer.')}
                title="Workspace scope" aria-label="Workspace scope"
                className="hidden rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 cursor-pointer sm:block"
              >
                ◫ Workspace
              </button>
              {streaming ? (
                <button
                  onClick={onStop}
                  aria-label="Stop generating"
                  title="Stop generating"
                  className="grid h-9 w-9 place-items-center rounded-full bg-zinc-100 text-zinc-950 hover:bg-white cursor-pointer"
                >
                  <Square size={13} className="fill-current" />
                </button>
              ) : (
                <button
                  onClick={submit}
                  disabled={!draft.trim() || disabled}
                  aria-label="Send message"
                  title="Send (Enter)"
                  className="grid h-9 w-9 place-items-center rounded-full bg-violet-500 text-white transition-opacity hover:bg-violet-400 cursor-pointer disabled:opacity-30"
                >
                  <ArrowUp size={17} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-zinc-600">
          <span>Enter to send · Shift+Enter for newline · Ctrl+K for commands</span>
          <span>Simha can make mistakes. Verify important information.</span>
        </div>
        {notice && <p className="mt-1 px-1 text-[11px] text-amber-400" role="status">{notice}</p>}
      </div>
    </div>
  );
}

function PuzzleGlyph() {
  return <span className="text-[15px] leading-none" aria-hidden>⌘</span>;
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