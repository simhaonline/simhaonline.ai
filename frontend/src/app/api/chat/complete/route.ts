import { NextResponse } from 'next/server';

const GATEWAY = process.env.GATEWAY_URL || 'http://gateway:8080';
const CONTROL = process.env.CONTROL_PLANE_URL || 'http://control-plane:8081';

// /api/chat/complete — authenticated chat completion through the gateway,
// using the caller's session so history lands on their account.
// stream:true is passed through as SSE verbatim (no buffering) so the
// workbench can render tokens as they arrive.
interface Turn {
  role: string;
  content: string;
}

async function gatewayRequest(url: string, init: RequestInit): Promise<Response | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, init).catch(() => null);
    if (!response || response.status !== 429 || attempt === 2) return response;
    const retryAfter = Number(response.headers.get('retry-after') || '5');
    await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfter, 1), 5) * 1000));
  }
  return null;
}

export async function POST(req: Request) {
  let body: { chat_id?: number; model?: string; messages?: Turn[]; compare?: boolean; routing_mode?: string; stream?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }
  const stream = body.stream === true;

  // 1. mint/validate the user's session → resolve a gateway client key server-side
  const cookie = req.headers.get('cookie') || '';
  const me = await fetch(`${CONTROL}/auth/me`, { headers: { cookie } }).catch(() => null);
  if (!me || !me.ok) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // 2. request the user's short-lived gateway dispatch key (internal, reused per hour)
  const kr = await fetch(`${CONTROL}/internal/chat-dispatch-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ purpose: 'workbench' }),
  }).catch(() => null);
  if (!kr || !kr.ok) {
    const err = await kr?.json().catch(() => ({}));
    return NextResponse.json(
      { error: err?.error || 'could not mint dispatch key' },
      { status: kr?.status ?? 502 },
    );
  }
  const { api_key } = (await kr.json()) as { api_key: string };

  // 3. call the gateway OpenAI-compatible endpoint
  const gr = await gatewayRequest(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api_key}`,
      ...(body.compare ? { 'X-Simha-Mode': 'compare' } : {}),
      ...(body.routing_mode ? { 'X-Simha-Routing-Mode': body.routing_mode } : {}),
    },
    body: JSON.stringify({
      // Web/mobile chat is intentionally model-agnostic by default ("auto"
      // routes through the capability-aware router). A caller may still pin an
      // explicit model name; the gateway honors it when an account serves it.
      model: body.model || 'auto',
      messages,
      stream,
    }),
    // SSE must not be buffered or retried internally
    ...(stream ? { duplex: 'half' } : {}),
  }).catch(() => null);
  if (!gr || !gr.ok) {
    const errText = gr ? await gr.text() : 'gateway unreachable';
    return NextResponse.json(
      { error: `gateway ${gr?.status || 502}: ${errText.slice(0, 300)}` },
      { status: gr?.status || 502 },
    );
  }

  if (!stream) {
    const doc = (await gr.json()) as {
      choices?: Array<{ message?: { content?: string; model?: string } }>;
      model?: string;
      usage?: { total_tokens?: number };
    };
    const content = doc.choices?.[0]?.message?.content || '';
    return NextResponse.json({
      content,
      model: doc.model || doc.choices?.[0]?.message?.model || body.model || 'auto',
      tokens: doc.usage?.total_tokens || 0,
    });
  }

  // Streaming: relay the SSE bytes untouched. The gateway resolves "auto" and
  // names the selected model in X-Simha-Model; forward it so the UI can badge
  // the answer from the stream headers.
  const model = gr.headers.get('x-simha-route-model') || body.model || 'auto';
  const out = new NextResponse(gr.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Simha-Model': model,
    },
  });
  return out;
}