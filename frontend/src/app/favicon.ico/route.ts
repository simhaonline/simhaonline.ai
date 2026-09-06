const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#b3a2ff"/><path d="M18 39c7-1 13-5 18-14 1 8 5 12 10 14-7 2-12 5-15 10-2-5-6-8-13-10Z" fill="#0b0d10"/></svg>`;

export function GET() {
  return new Response(icon, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
}
