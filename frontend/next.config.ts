import type { NextConfig } from 'next';

// Audit v2 🟠: drop 'unsafe-eval' from script-src (Next 15 production runtime
// does not need eval), add COOP + HSTS preload. X-Powered-By is removed via
// the poweredByHeader flag below.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.simhaonline.ai https://platform.simhaonline.ai wss://chat.simhaonline.ai",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false, // removes X-Powered-By: Next.js
  async headers() {
    return [
      {
        // HTML must not outlive a deployment: old Next.js server-action and
        // client-chunk references can otherwise be served for a year.
        source: '/((?!_next/static|_next/image|favicon.ico).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: csp },
          // COOP isolates browsing context (side-channel hardening)
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // HSTS with preload (Plesk TLS terminates; max-age covers subdomains)
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default nextConfig;