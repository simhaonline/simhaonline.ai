'use client';

// components/chat/ThinkingIndicator.tsx — persistent "AI is working" state.
// Shown for the entire duration of any AI request (routing latency, hidden
// reasoning tokens, research, translation, media generation) so the UI never
// looks empty or dead. Auto-advances the label so progress is believable.

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const PHASES = ['Thinking', 'Analyzing', 'Consulting models', 'Composing'];

export function ThinkingIndicator({ inline = false, label }: { inline?: boolean; label?: string }) {
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t1 = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 1800);
    const t2 = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

  const text = label ?? PHASES[phase];

  return (
    <div
      className={cn('flex items-center gap-2.5', inline ? 'py-0.5' : 'py-1')}
      role="status"
      aria-live="polite"
      aria-label={text}
    >
      <span className="flex gap-1" aria-hidden>
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:300ms]" />
      </span>
      <span className="text-[12.5px] font-medium text-zinc-400">
        {text}
        <span className="ml-0.5 animate-pulse">…</span>
      </span>
      {elapsed >= 5 && (
        <span className="text-[11px] tabular-nums text-zinc-600">{elapsed}s</span>
      )}
    </div>
  );
}

export default ThinkingIndicator;