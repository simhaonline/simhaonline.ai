import { NextResponse } from 'next/server';

const CONTROL = process.env.CONTROL_PLANE_URL || 'http://control-plane:8081';

// /api/status/recent — public status feed from the worker's snapshots.
// The worker exposes /status/recent; fall back to control-plane mirror.
export async function GET() {
  const worker = process.env.WORKER_URL || 'http://worker:8001';
  try {
    const r = await fetch(`${worker}/status/recent?limit=15`, { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      return NextResponse.json(d);
    }
  } catch {
    // fall through
  }
  return NextResponse.json({ checks: [] });
}