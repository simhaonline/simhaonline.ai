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

  // Audit scaffold (2): gate /dashboard/* on the simha_session cookie.
  // Unauthenticated requests redirect to /login; authenticated pass through.
  // (Deep session validation still happens server-side per request —
  // this is the fast edge gate.)
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    const token = request.cookies.get('simha_session')?.value;
    if (!token) {
      const login = new URL('/login', request.url);
      login.searchParams.set('next', request.nextUrl.pathname);
      return NextResponse.redirect(login);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/dashboard/:path*'],
};