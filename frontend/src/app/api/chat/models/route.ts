import { NextResponse } from 'next/server';

const CONTROL = process.env.CONTROL_PLANE_URL || 'http://control-plane:8081';

// /api/chat/models → control plane /chat/api/models (discovered catalog).
// Forwards the caller's session cookie.
export async function GET(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  try {
    const r = await fetch(`${CONTROL}/chat/api/models`, {
      headers: cookie ? { Cookie: cookie } : {},
      cache: 'no-store',
    });
    const d = await r.json().catch(() => ({ models: [] }));
    return NextResponse.json(d, { status: r.status });
  } catch {
    return NextResponse.json({ models: [] });
  }
}