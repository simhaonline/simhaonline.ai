import { cookies } from 'next/headers';
import IntakeDock from '@/components/IntakeDock';

// Audit C1: the Workbench must not render for unauthenticated visitors.
// This server-side guard checks the session with the control plane and
// redirects to login before any UI (or API traffic) is reachable.
const CONTROL = process.env.CONTROL_PLANE_URL || 'http://control-plane:8081';

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get('simha_session')?.value;
  let authed = false;
  if (token) {
    try {
      const r = await fetch(`${CONTROL}/auth/me`, {
        headers: { cookie: `simha_session=${token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      });
      authed = r.ok;
    } catch {
      authed = false;
    }
  }
  if (!authed) {
    return (
      <main className="container" style={{ paddingTop: 90, textAlign: 'center' }}>
        <h1 style={{ fontSize: 28 }}>Sign in to continue</h1>
        <p style={{ color: 'var(--muted)', margin: '10px 0 22px' }}>
          The Workbench is available to signed-in accounts.
        </p>
        <a className="btn primary" href="https://platform.simhaonline.ai/login?next=https://chat.simhaonline.ai/chat">
          Sign in
        </a>
      </main>
    );
  }
  return <>{children}<IntakeDock /></>;
}