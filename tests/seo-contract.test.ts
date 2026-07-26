import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { projectSlugs, siteUrl } from '../lib/site-content.ts';
import robots from '../app/robots.ts';
import sitemap from '../app/sitemap.ts';

const layoutPath = path.resolve('app/layout.tsx');

test('site URL constant is the production origin without a trailing slash', () => {
  assert.equal(siteUrl, 'https://aimorse.tech');
});

test('sitemap lists home, works, and every project detail route from the content source', () => {
  const entries = sitemap();
  const urls = entries.map((entry) => entry.url);

  assert.equal(urls[0], 'https://aimorse.tech');
  assert.ok(urls.includes('https://aimorse.tech/works'));
  for (const slug of projectSlugs) {
    assert.ok(
      urls.includes(`https://aimorse.tech/works/${slug}`),
      `sitemap missing project route for slug: ${slug}`,
    );
  }
  assert.equal(entries.length, 2 + projectSlugs.length);
  assert.ok(urls.every((url) => url.startsWith('https://aimorse.tech')));
  assert.ok(!urls.some((url) => /\/admin|\/api/.test(url)));
});

test('robots allows the public site, blocks admin and api, and points to the sitemap', () => {
  const result = robots();
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules];

  assert.equal(rules.length, 1);
  const rule = rules[0];
  assert.ok(rule);
  assert.equal(rule.userAgent, '*');
  assert.equal(rule.allow, '/');
  assert.deepEqual(rule.disallow, ['/admin', '/api']);
  assert.equal(result.sitemap, 'https://aimorse.tech/sitemap.xml');
});

test('root layout metadata declares base URL, Open Graph, and twitter summary card', () => {
  const layout = fs.readFileSync(layoutPath, 'utf8');

  assert.match(layout, /import\s+\{\s*siteContent,\s*siteUrl\s*\}\s+from\s+["']@\/lib\/site-content["']/);
  assert.match(layout, /metadataBase:\s*new URL\(siteUrl\)/);
  assert.match(layout, /openGraph:\s*\{/);
  assert.match(layout, /title:\s*siteContent\.site\.name/);
  assert.match(layout, /description:\s*siteContent\.site\.description/);
  assert.match(layout, /url:\s*siteUrl/);
  assert.match(layout, /siteName:\s*siteContent\.site\.name/);
  assert.match(layout, /locale:\s*['"]zh_CN['"]/);
  assert.match(layout, /type:\s*['"]website['"]/);
  assert.match(layout, /twitter:\s*\{\s*card:\s*['"]summary['"]/);
  assert.doesNotMatch(layout, /process\.env/);
});
