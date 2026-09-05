import { NextResponse } from 'next/server';

const GATEWAY = process.env.GATEWAY_URL || 'http://gateway:8080';
const CONTROL = process.env.CONTROL_PLANE_URL || 'http://control-plane:8081';

// /api/chat/complete — authenticated chat completion through the gateway,
// using the caller's session so history lands on their account.
interface Turn {
  role: string;
  content: string;
}

export async function POST(req: Request) {
  let body: { chat_id?: number; model?: string; messages?: Turn[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  // 1. mint/validate the user's session → resolve a gateway client key server-side
  const cookie = req.headers.get('cookie') || '';
  const me = await fetch(`${CONTROL}/auth/me`, { headers: { cookie } }).catch(() => null);
  if (!me || !me.ok) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // 2. request a per-user gateway dispatch key (internal, short-lived)
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
  const gr = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api_key}`,
    },
    body: JSON.stringify({
      model: body.model || 'auto',
      messages,
      stream: false,
    }),
  }).catch(() => null);
  if (!gr || !gr.ok) {
    const errText = gr ? await gr.text() : 'gateway unreachable';
    return NextResponse.json(
      { error: `gateway ${gr?.status || 502}: ${errText.slice(0, 300)}` },
      { status: gr?.status || 502 },
    );
  }
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