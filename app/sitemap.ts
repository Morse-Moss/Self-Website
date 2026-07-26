import type { MetadataRoute } from 'next';

import { projectSlugs, siteUrl } from '../lib/site-content.ts';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl },
    { url: `${siteUrl}/works` },
    ...projectSlugs.map((slug) => ({ url: `${siteUrl}/works/${slug}` })),
  ];
}
