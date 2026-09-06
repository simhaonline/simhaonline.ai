'use client';

// (7) components/chat/InputBar.tsx — ChatGPT-class composer: one outlined
// rounded-3xl shell; textarea on top, tool row below. Includes: real
// per-message Tools menu (skills/agents/plugins toggles), media aspect
// pickers (image 1:1/9:16/3:4/4:3/16:9, video 16:9/9:16 + duration),
// DeepL-style translate handoff, voice, model picker, send/stop.

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, Paperclip, Plus, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { wbApi } from '@/lib/wb-api';
import { useChat } from '@/store/chat';
import { ModelSelector } from './ModelSelector';
import { TranslatePane } from './TranslatePane';

export interface SendPayload {
  text: string;
  fileIds: string[];
  /** media generation mode: null = normal chat */
  mediaMode?: 'image' | 'video' | 'audio' | null;
  /** aspect ratio for image/video generation */
  aspectRatio?: string | null;
  /** video duration in seconds */
  durationSeconds?: number | null;
  /** work mode routed to the gateway task header */
  taskMode?: 'translate' | 'research' | 'code' | 'vision' | null;
  /** per-message tools (enabled skills/agents/plugins chosen in the menu) */
  tools?: string[];
}

const MEDIA_META = {
  image: { icon: '🖼', label: 'Image', hint: 'Flux, GPT-Image, Imagen' },
  video: { icon: '🎬', label: 'Video', hint: 'Veo, Sora, Kling' },
  audio: { icon: '🎵', label: 'Audio', hint: 'TTS, ElevenLabs' },
} as const;

const TASK_META = {
  translate: { icon: '🌐', label: 'Translate', hint: 'Nuanced multi-language' },
  research: { icon: '🔬', label: 'Deep Research', hint: 'Multi-source synthesis' },
  code: { icon: '⌨', label: 'Code', hint: 'Routed to code models' },
  vision: { icon: '👁', label: 'Vision', hint: 'Image understanding' },
} as const;

const IMAGE_RATIOS = ['1:1', '9:16', '3:4', '4:3', '16:9'] as const;
const VIDEO_RATIOS = ['16:9', '9:16', '1:1'] as const;
const VIDEO_DURATIONS = [5, 8, 10] as const;

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
  const [mediaMode, setMediaMode] = useState<'image' | 'video' | 'audio' | null>(null);
  const [taskMode, setTaskMode] = useState<'translate' | 'research' | 'code' | 'vision' | null>(null);
  const [modesOpen, setModesOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [durationSeconds, setDurationSeconds] = useState<number>(5);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [visionArmed, setVisionArmed] = useState(false);
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
    const files = useChat.getState().attachedFiles;
    const hasImage = files.some((f) => f.isImage);
    onSend({
      text,
      fileIds: files.map((f) => f.fileId),
      mediaMode,
      taskMode: hasImage && !taskMode ? 'vision' : taskMode,
      aspectRatio: mediaMode === 'image' || mediaMode === 'video' ? aspectRatio : null,
      durationSeconds: mediaMode === 'video' ? durationSeconds : null,
      tools: activeTools.length ? activeTools : undefined,
    });
    setDraft('');
    setMediaMode(null);
    setTaskMode(null);
    setVisionArmed(false);
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
        // images: local preview + multimodal flag (vision mode)
        if (file.type.startsWith('image/')) {
          const previewUrl = URL.createObjectURL(file);
          const d = await wbApi.files.upload(file);
          addAttachedFile({ fileId: d.fileId, name: d.name, previewUrl, isImage: true, mimeType: file.type });
          setVisionArmed(true);
          continue;
        }
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

  // DeepL-style dual pane replaces the normal composer in translate mode
  if (taskMode === 'translate') {
    return (
      <TranslatePane
        onClose={() => setTaskMode(null)}
        streaming={streaming}
      />
    );
  }

  return (
    <div className="sticky bottom-0 bg-gradient-to-t from-zinc-950 via-zinc-950 to-transparent pb-3 pt-2">
      <div className="mx-auto w-full max-w-3xl px-4">
        {/* attachment previews — images render as thumbnails */}
        {attachedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachedFiles.map((f) => (
              <span key={f.fileId} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-300">
                {f.isImage && f.previewUrl ? (
                  <img src={f.previewUrl} alt={f.name} className="h-8 w-8 rounded border border-zinc-700 object-cover" />
                ) : (
                  <Paperclip size={10} className="text-violet-400" />
                )}
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
            placeholder={mediaMode === 'image' ? 'Describe the image to generate…'
              : mediaMode === 'video' ? 'Describe the video to generate…'
              : mediaMode === 'audio' ? 'Describe the audio to generate…'
              : taskMode === 'research' ? 'What should I research in depth?'
              : taskMode === 'code' ? 'Describe what to build, paste code, or share an error…'
              : taskMode === 'vision' ? 'Attach an image, then ask about it…'
              : 'Ask anything…'}
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

              {/* real per-message Tools menu */}
              <span className="relative">
                <button
                  onClick={() => setToolsOpen((v) => !v)}
                  aria-expanded={toolsOpen}
                  aria-haspopup="menu"
                  title="Tools — skills, agents, plugins for this message"
                  className={cn(
                    'flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] cursor-pointer',
                    activeTools.length ? 'bg-violet-500/15 text-violet-300' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
                  )}
                >
                  ⌘{activeTools.length ? ` ${activeTools.length}` : ''}
                </button>
                {toolsOpen && (
                  <ToolsMenu
                    activeTools={activeTools}
                    onToggle={(name) => setActiveTools((cur) =>
                      cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name])}
                    onClose={() => setToolsOpen(false)}
                  />
                )}
              </span>

              <button
                onClick={toggleVoice}
                title="Voice input" aria-label="Voice input"
                className={cn(toolBtn, recording && 'animate-pulse bg-red-500/15 text-red-400')}
              >
                <Mic size={16} />
              </button>

              {/* full mode menu — all workbench features */}
              <span className="relative">
                <button
                  onClick={() => setModesOpen((v) => !v)}
                  aria-expanded={modesOpen}
                  aria-haspopup="menu"
                  title="Modes — image, video, audio, translate, research, code"
                  className={cn(
                    'flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] cursor-pointer',
                    mediaMode || taskMode ? 'bg-violet-500/15 text-violet-300' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
                  )}
                >
                  {mediaMode ? MEDIA_META[mediaMode].icon + ' ' + MEDIA_META[mediaMode].label
                    : taskMode ? TASK_META[taskMode].icon + ' ' + TASK_META[taskMode].label
                    : '＋ Mode'}
                </button>
                {modesOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setModesOpen(false)} />
                    <div className="absolute bottom-full left-0 z-40 mb-2 w-64 rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 shadow-2xl" role="menu">
                      <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-600">Generate</p>
                      {(Object.keys(MEDIA_META) as Array<keyof typeof MEDIA_META>).map((m) => (
                        <MenuRow
                          key={m} icon={MEDIA_META[m].icon} label={MEDIA_META[m].label}
                          hint={MEDIA_META[m].hint} active={mediaMode === m}
                          onClick={() => { setMediaMode((cur) => (cur === m ? null : m)); setTaskMode(null); setModesOpen(false); }}
                        />
                      ))}
                      <p className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">Work modes</p>
                      {(Object.keys(TASK_META) as Array<keyof typeof TASK_META>).map((m) => (
                        <MenuRow
                          key={m} icon={TASK_META[m].icon} label={TASK_META[m].label}
                          hint={TASK_META[m].hint} active={taskMode === m}
                          onClick={() => { setTaskMode((cur) => (cur === m ? null : m)); setMediaMode(null); setModesOpen(false); }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </span>

              {/* aspect ratio + duration pickers for media modes */}
              {mediaMode === 'image' && (
                <span className="ml-1 flex items-center gap-1">
                  {IMAGE_RATIOS.map((r) => (
                    <button
                      key={r} onClick={() => setAspectRatio(r)} aria-pressed={aspectRatio === r}
                      title={`Aspect ${r}`}
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 font-mono text-[10px] cursor-pointer',
                        aspectRatio === r ? 'border-violet-500 bg-violet-500/15 text-violet-300' : 'border-zinc-700 text-zinc-500 hover:text-zinc-200',
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </span>
              )}
              {mediaMode === 'video' && (
                <span className="ml-1 flex items-center gap-1">
                  {VIDEO_RATIOS.map((r) => (
                    <button
                      key={r} onClick={() => setAspectRatio(r)} aria-pressed={aspectRatio === r}
                      title={`Aspect ${r}`}
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 font-mono text-[10px] cursor-pointer',
                        aspectRatio === r ? 'border-violet-500 bg-violet-500/15 text-violet-300' : 'border-zinc-700 text-zinc-500 hover:text-zinc-200',
                      )}
                    >
                      {r}
                    </button>
                  ))}
                  <span className="mx-0.5 h-4 w-px bg-zinc-700" aria-hidden />
                  {VIDEO_DURATIONS.map((d) => (
                    <button
                      key={d} onClick={() => setDurationSeconds(d)} aria-pressed={durationSeconds === d}
                      title={`${d} second video`}
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 font-mono text-[10px] cursor-pointer',
                        durationSeconds === d ? 'border-violet-500 bg-violet-500/15 text-violet-300' : 'border-zinc-700 text-zinc-500 hover:text-zinc-200',
                      )}
                    >
                      {d}s
                    </button>
                  ))}
                </span>
              )}

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
                className="hidden rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-600 cursor-pointer sm:block"
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
                  <span className="block h-3 w-3 rounded-[2px] bg-white" aria-hidden />
                </button>
              ) : (
                <button
                  onClick={submit}
                  disabled={!draft.trim() || disabled}
                  aria-label="Send message"
                  title="Send (Enter)"
                  className="grid h-9 w-9 place-items-center rounded-full bg-violet-500 text-white hover:bg-violet-400 cursor-pointer disabled:opacity-30"
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

/** Real tools: skills + agents + plugins from the feature catalog. */
function ToolsMenu({
  activeTools, onClose, onToggle,
}: {
  activeTools: string[];
  onClose: () => void;
  onToggle: (name: string) => void;
}) {
  const [caps, setCaps] = useState<{
    skills: Array<{ id: number; name: string; enabled: boolean }>;
    agents: Array<{ id: number; name: string; enabled: boolean }>;
    plugins: Array<{ id: number; name: string; enabled: boolean }>;
  }>({ skills: [], agents: [], plugins: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await wbApi.capabilities.list();
        setCaps({ skills: d.skills || [], agents: d.agents || [], plugins: d.plugins || [] });
      } catch { /* optional */ } finally { setLoading(false); }
    })();
  }, []);

  const groups: Array<[string, Array<{ id: number; name: string; enabled: boolean }>]> = [
    ['Skills', caps.skills],
    ['Agents', caps.agents],
    ['Plugins', caps.plugins],
  ];

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute bottom-full left-0 z-40 mb-2 w-64 rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 shadow-2xl" role="menu">
        {loading && <p className="px-2.5 py-3 text-center text-[11px] text-zinc-500">Loading tools…</p>}
        {!loading && groups.map(([label, items]) => (
          <div key={label}>
            {items.length > 0 && (
              <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-600">{label}</p>
            )}
            {items.map((t) => {
              const active = activeTools.includes(t.name);
              return (
                <button
                  key={t.id}
                  onClick={() => onToggle(t.name)}
                  role="menuitemcheckbox"
                  aria-checked={active}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] cursor-pointer',
                    active ? 'bg-violet-500/15 text-violet-300' : 'text-zinc-200 hover:bg-zinc-800',
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', t.enabled ? 'bg-green-400' : 'bg-zinc-600')} aria-hidden />
                  <b className="min-w-0 flex-1 truncate font-normal">{t.name}</b>
                  {active && <span className="text-violet-400" aria-hidden>✓</span>}
                </button>
              );
            })}
          </div>
        ))}
        {!loading && !caps.skills.length && !caps.agents.length && !caps.plugins.length && (
          <p className="px-2.5 py-3 text-center text-[11px] text-zinc-500">No tools registered yet.</p>
        )}
      </div>
    </>
  );
}

function MenuRow({ icon, label, hint, active, onClick }: {
  icon: string; label: string; hint: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      aria-checked={active}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] cursor-pointer',
        active ? 'bg-violet-500/15 text-violet-300' : 'text-zinc-200 hover:bg-zinc-800',
      )}
    >
      <span className="w-5 text-center text-[14px]" aria-hidden>{icon}</span>
      <span className="min-w-0">
        <b className="block font-medium">{label}</b>
        <small className="block text-[10.5px] text-zinc-500">{hint}</small>
      </span>
      {active && <span className="ml-auto text-violet-400" aria-hidden>✓</span>}
    </button>
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