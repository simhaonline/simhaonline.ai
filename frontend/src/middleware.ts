import { NextRequest, NextResponse } from 'next/server';

const ROOT_ROUTES: Record<string, string> = {
  'chat.simhaonline.ai': '/chat',
  'platform.simhaonline.ai': '/dashboard',
  'docs.simhaonline.ai': '/docs',
  'status.simhaonline.ai': '/status',
};

export function middleware(request: NextRequest) {
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase() || '';
  const target = ROOT_ROUTES[host];
  if (target && request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = target;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/'] };
