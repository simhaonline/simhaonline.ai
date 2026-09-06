'use client';

// (8) lib/streaming.ts — SSE parser for POST /chat/api/v1/chat/completions.
// Parses `data: {choices:[{delta:{content}}]}` chunks, treats `data: [DONE]`
// as the sentinel, and throws on abort so callers can react.

export interface StreamUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface StreamOptions {
  onChunk: (text: string) => void;
  onDone: (usage: StreamUsage | null) => void;
  signal: AbortSignal;
  /** Optional per-request overrides (compare mode uses these). */
  model?: string;
  body?: Record<string, unknown>;
  /** Media generation mode — tags the request so the gateway routes to a
   *  media provider (fal/veo/sora) instead of a text model. */
  mediaMode?: 'image' | 'video' | 'audio' | null;
  /** Work mode — sets the gateway task header (translate/code/vision…). */
  taskMode?: 'translate' | 'research' | 'code' | 'vision' | null;
  /** aspect ratio for image/video generation (1:1, 9:16, 3:4, 4:3, 16:9) */
  aspectRatio?: string | null;
  /** video duration in seconds */
  durationSeconds?: number | null;
}

export async function streamChat(
  conversationId: number,
  messages: Array<{ role: string; content: string }>,
  model: string,
  plugins: string[],
  fileIds: string[],
  opts: StreamOptions,
): Promise<void> {
  const res = await fetch('/api/chat/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    signal: opts.signal,
    body: JSON.stringify({
      conversation_id: conversationId,
      model: opts.model || model,
      messages,
      stream: true,
      tools: plugins,
      file_ids: fileIds,
      ...(opts.mediaMode ? { output_modality: opts.mediaMode, stream: false } : {}),
      ...(opts.taskMode ? { mode: opts.taskMode } : {}),
      ...(opts.aspectRatio ? { aspect_ratio: opts.aspectRatio } : {}),
      ...(opts.durationSeconds ? { duration_seconds: opts.durationSeconds } : {}),
      ...(opts.body || {}),
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: StreamUsage | null = null;
  let done = false;

  try {
    for (;;) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { done = true; continue; }
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: StreamUsage;
          };
          if (json.usage) usage = json.usage;
          const text = json.choices?.[0]?.delta?.content;
          if (text) opts.onChunk(text);
        } catch {
          // partial JSON across chunk boundary — next read completes it
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  if (opts.signal.aborted) {
    // aborted mid-stream: surface as an error per the contract
    throw new DOMException('Aborted', 'AbortError');
  }
  opts.onDone(usage);
}