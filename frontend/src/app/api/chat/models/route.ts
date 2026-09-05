import { NextResponse } from 'next/server';

const CONTROL = process.env.CONTROL_PLANE_URL || 'http://control-plane:8081';

// /api/chat/models → control plane /chat/api/models (discovered catalog)
export async function GET() {
  try {
    const r = await fetch(`${CONTROL}/chat/api/models`, {
      headers: { Cookie: '' },
      cache: 'no-store',
    });
    const d = await r.json().catch(() => ({ models: [] }));
    return NextResponse.json(d, { status: r.status });
  } catch {
    return NextResponse.json({ models: [] });
  }
}