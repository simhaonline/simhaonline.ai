'use client';

// components/chat/TranslatePane.tsx — DeepL-style dual-side translator:
// source pane (language selector + textarea + clear/swap) | target pane
// (language selector + translated output + copy). Uses the chat pipeline
// with a strict translation instruction.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Check, Copy, Volume2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { streamChat } from '@/lib/streaming';
import { useChat } from '@/store/chat';

const LANGUAGES = [
  { code: 'English', flag: '🇬🇧' },
  { code: 'Arabic', flag: '🇸🇦' },
  { code: 'Chinese (Simplified)', flag: '🇨🇳' },
  { code: 'Dutch', flag: '🇳🇱' },
  { code: 'French', flag: '🇫🇷' },
  { code: 'German', flag: '🇩🇪' },
  { code: 'Hindi', flag: '🇮🇳' },
  { code: 'Japanese', flag: '🇯🇵' },
  { code: 'Portuguese', flag: '🇵🇹' },
  { code: 'Russian', flag: '🇷🇺' },
  { code: 'Spanish', flag: '🇪🇸' },
  { code: 'Urdu', flag: '🇵🇰' },
] as const;

type Lang = (typeof LANGUAGES)[number]['code'];

export function TranslatePane({
  onClose, streaming,
}: {
  onClose: () => void;
  streaming: boolean;
}) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState<Lang>('English');
  const [to, setTo] = useState<Lang>('Arabic');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [detected, setDetected] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setDraft = useChat((s) => s.setDraft);

  const translate = useCallback(async (text: string, fromLang: Lang, toLang: Lang) => {
    if (!text.trim()) { setTarget(''); return; }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    let out = '';
    try {
      await streamChat(
        0,
        [{
          role: 'user',
          content: `Translate the following text from ${fromLang} to ${toLang}. Reply with ONLY the translation — no quotes, no explanations, no romanization.\n\n${text}`,
        }],
        'auto',
        [],
        [],
        {
          signal: controller.signal,
          onChunk: (chunk) => { out += chunk; setTarget(out); },
          onDone: () => setBusy(false),
        },
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setTarget(`⚠ Translation failed: ${(e as Error).message}`);
        setBusy(false);
      }
    }
  }, []);

  // auto-translate on typing (debounced 700ms — DeepL behavior)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!source.trim()) { setTarget(''); setBusy(false); return; }
    debounceRef.current = setTimeout(() => { void translate(source, from, to); }, 700);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [source, from, to, translate]);

  function swap() {
    const prevFrom = from;
    const prevTo = to;
    const prevSource = source;
    setFrom(prevTo);
    setTo(prevFrom);
    if (target && !busy) {
      setSource(target);
      setTarget(prevSource);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(target);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* blocked */ }
  }

  function speak() {
    const w = window as unknown as { speechSynthesis?: { speak: (u: { text: string; lang: string }) => void } };
    if (!w.speechSynthesis) return;
    const langMap: Partial<Record<Lang, string>> = {
      English: 'en-US', Arabic: 'ar-SA', French: 'fr-FR', German: 'de-DE',
      Spanish: 'es-ES', Portuguese: 'pt-PT', Russian: 'ru-RU', Japanese: 'ja-JP',
      'Chinese (Simplified)': 'zh-CN', Hindi: 'hi-IN', Urdu: 'ur-PK', Dutch: 'nl-NL',
    };
    w.speechSynthesis.speak({ text: target, lang: langMap[to] || 'en-US' });
  }

  return (
    <div className="sticky bottom-0 bg-gradient-to-t from-zinc-950 via-zinc-950 to-transparent pb-3 pt-2">
      <div className="mx-auto w-full max-w-4xl px-4">
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
          {/* language bar */}
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            <div className="flex items-center gap-1">
              <LanguagePicker value={from} onChange={(l) => setFrom(l)} detected={detected} />
              <button
                onClick={swap}
                aria-label="Swap languages"
                title="Swap languages"
                className="mx-1 grid h-7 w-7 place-items-center rounded-full text-zinc-500 hover:bg-zinc-800 hover:text-violet-400 cursor-pointer"
              >
                <ArrowLeftRight size={14} />
              </button>
              <LanguagePicker value={to} onChange={(l) => setTo(l)} />
            </div>
            <button
              onClick={onClose}
              aria-label="Close translator"
              title="Close translator"
              className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          {/* dual panes */}
          <div className="grid grid-cols-1 divide-zinc-800 md:grid-cols-2 md:divide-x">
            {/* source */}
            <div className="p-3.5">
              <textarea
                autoFocus
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  // naive script detection for the detected badge
                  if (/[\u0600-\u06FF]/.test(e.target.value)) setDetected('Arabic');
                  else if (/[\u4e00-\u9fff]/.test(e.target.value)) setDetected('Chinese (Simplified)');
                  else if (/[\u0400-\u04FF]/.test(e.target.value)) setDetected('Russian');
                  else if (/[\u3040-\u30ff]/.test(e.target.value)) setDetected('Japanese');
                  else if (/[A-Za-z]/.test(e.target.value)) setDetected('English');
                  else setDetected(null);
                }}
                placeholder="Type or paste text to translate…"
                aria-label="Source text"
                className="min-h-[104px] w-full resize-none bg-transparent text-[15px] leading-6 text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
              />
              <div className="mt-1 flex items-center justify-between">
                <small className="text-[10px] text-zinc-600">{source.length} chars</small>
                {source && (
                  <button onClick={() => { setSource(''); setTarget(''); }} className="text-[11px] text-zinc-500 hover:text-zinc-200 cursor-pointer">
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* target */}
            <div className="relative bg-zinc-950/40 p-3.5">
              {busy ? (
                <div className="flex min-h-[104px] items-start gap-2 text-[13px] text-zinc-500">
                  <span className="streaming-cursor" aria-hidden /> translating…
                </div>
              ) : target ? (
                <p className="min-h-[104px] whitespace-pre-wrap text-[15px] leading-6 text-zinc-100">{target}</p>
              ) : (
                <p className="min-h-[104px] text-[15px] text-zinc-700">Translation appears here…</p>
              )}
              {target && !busy && (
                <div className="mt-2 flex items-center gap-1">
                  <button onClick={() => void copy()} aria-label="Copy translation" className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer">
                    {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button onClick={speak} aria-label="Read aloud" title="Read aloud" className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer">
                    <Volume2 size={12} /> Listen
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-zinc-600">
          <span>Auto-translates as you type · Ctrl+Enter swaps panes</span>
          <button onClick={() => { setDraft(''); onClose(); }} className="text-zinc-500 hover:text-zinc-200 cursor-pointer">
            Back to chat
          </button>
        </div>
      </div>
    </div>
  );
}

function LanguagePicker({ value, onChange, detected }: {
  value: Lang;
  onChange: (l: Lang) => void;
  detected?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const meta = LANGUAGES.find((l) => l.code === value);
  return (
    <span className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-zinc-200 hover:bg-zinc-800 cursor-pointer"
      >
        <span aria-hidden>{meta?.flag}</span>
        {value}
        {detected && value === detected && (
          <span className="ml-0.5 rounded-full border border-zinc-700 px-1.5 py-px text-[9px] text-zinc-500">detected</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <ul className="absolute bottom-full left-0 z-40 mb-1.5 w-56 rounded-xl border border-zinc-700 bg-zinc-900 py-1 shadow-2xl" role="listbox">
            {LANGUAGES.map((l) => (
              <li key={l.code}>
                <button
                  onClick={() => { onChange(l.code); setOpen(false); }}
                  role="option"
                  aria-selected={l.code === value}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] cursor-pointer',
                    l.code === value ? 'bg-zinc-800 text-violet-300' : 'text-zinc-200 hover:bg-zinc-800',
                  )}
                >
                  <span aria-hidden>{l.flag}</span> {l.code}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </span>
  );
}

export default TranslatePane;