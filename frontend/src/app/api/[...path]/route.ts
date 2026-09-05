import { NextResponse } from 'next/server';

const CONTROL = process.env.CONTROL_PLANE_URL || 'http://control-plane:8081';

// BFF: forward /api/* from the Next edge to the NestJS control plane,
// preserving method, cookies and body.
async function forward(req: Request, path: string[]) {
  const url = `${CONTROL}/${path.map(encodeURIComponent).join('/')}${new URL(req.url).search}`;
  const headers = new Headers();
  headers.set('Content-Type', req.headers.get('content-type') || 'application/json');
  const cookie = req.headers.get('cookie');
  if (cookie) headers.set('Cookie', cookie);
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
  try {
    const r = await fetch(url, {
      method: req.method,
      headers,
      body,
      // do NOT follow redirects blindly; pass through
      redirect: 'manual',
    });
    const out = new NextResponse(r.body, { status: r.status });
    const setCookie = r.headers.get('set-cookie');
    if (setCookie) out.headers.set('set-cookie', setCookie);
    const ct = r.headers.get('content-type');
    if (ct) out.headers.set('content-type', ct);
    return out;
  } catch {
    return NextResponse.json({ error: 'control plane unreachable' }, { status: 502 });
  }
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path || []);
}

export async function POST(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path || []);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path || []);
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path || []);
}

export async function PUT(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path || []);
}