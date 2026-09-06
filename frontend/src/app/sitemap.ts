import type { MetadataRoute } from 'next';

// Audit L4: sitemap for the public marketing surfaces (auth areas excluded).
export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://simhaonline.ai';
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/docs`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/signup`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/login`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: 'https://status.simhaonline.ai/', lastModified: now, changeFrequency: 'hourly', priority: 0.6 },
  ];
}