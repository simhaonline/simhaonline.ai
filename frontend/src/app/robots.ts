import type { MetadataRoute } from 'next';

// Audit L3/L4: robots must be fetchable and a sitemap must exist.
// Authenticated surfaces stay out of indexing.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard', '/control-center', '/chat', '/workspace', '/api/'],
      },
    ],
    sitemap: 'https://simhaonline.ai/sitemap.xml',
  };
}