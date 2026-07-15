import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifySearchSource,
  normalizePublicHttpsUrl,
  parseStoredSearchResults,
  sanitizeSearchCandidates,
} from '../lib/server/search-safety.ts';

test('search URL safety accepts public HTTPS and rejects credentialed or private targets', () => {
  assert.equal(normalizePublicHttpsUrl('https://Example.com/docs?q=1#top'), 'https://example.com/docs?q=1#top');
  assert.equal(normalizePublicHttpsUrl('https://user:secret@example.com/docs'), null);
  assert.equal(normalizePublicHttpsUrl('https://127.0.0.1/private'), null);
  assert.equal(normalizePublicHttpsUrl('https://169.254.169.254/latest/meta-data'), null);
  assert.equal(normalizePublicHttpsUrl(`https://example.com/${'x'.repeat(2100)}`), null);
});

test('search URL safety rejects schemes, localhost, reserved IPs, metadata, and IPv4-mapped IPv6', () => {
  for (const value of [
    'http://example.com',
    'file:///etc/passwd',
    'https://localhost/admin',
    'https://api.localhost/admin',
    'https://127.1/admin',
    'https://10.0.0.1/admin',
    'https://172.16.0.1/admin',
    'https://192.168.0.1/admin',
    'https://192.0.2.1/documentation',
    'https://198.51.100.1/documentation',
    'https://203.0.113.1/documentation',
    'https://metadata.google.internal/computeMetadata/v1',
    'https://[::1]/admin',
    'https://[fc00::1]/admin',
    'https://[fe80::1]/admin',
    'https://[::ffff:127.0.0.1]/admin',
  ]) {
    assert.equal(normalizePublicHttpsUrl(value), null, value);
  }
});

test('search URL safety rejects single-label and non-public reserved DNS suffixes', () => {
  for (const value of [
    'https://printer/status',
    'https://service.local/status',
    'https://service.localdomain/status',
    'https://service.lan/status',
    'https://service.home.arpa/status',
    'https://service.test/status',
    'https://service.invalid/status',
    'https://service.example/status',
    'https://service.onion/status',
  ]) {
    assert.equal(normalizePublicHttpsUrl(value), null, value);
  }
});

test('source classification trusts only domain boundaries and configured GitHub owners', () => {
  const config = {
    officialDomains: ['openai.com'],
    githubOwners: ['Morse-Moss'],
  };
  assert.deepEqual(classifySearchSource('https://platform.openai.com/docs', config), {
    kind: 'official',
    domain: 'platform.openai.com',
  });
  assert.deepEqual(classifySearchSource('https://openai.com.evil.com/docs', config), {
    kind: 'web',
    domain: 'openai.com.evil.com',
  });
  assert.deepEqual(classifySearchSource('https://github.com/Morse-Moss/Revolution', config), {
    kind: 'github',
    domain: 'github.com',
  });
  assert.deepEqual(classifySearchSource('https://github.com/Morse-Moss-Evil/Revolution', config), {
    kind: 'web',
    domain: 'github.com',
  });
  assert.deepEqual(
    classifySearchSource('https://evil.com/post', config, 'OpenAI 官方文档'),
    { kind: 'web', domain: 'evil.com' },
  );
});

test('candidate sanitization removes control characters, unsafe URLs, duplicates, and caps five', () => {
  const candidates = Array.from({ length: 8 }, (_, index) => ({
    name: `Title\u0000 ${index}`,
    url: index === 1 ? 'https://127.0.0.1/private' : `https://example.com/${Math.max(0, index - 1)}`,
    snippet: `Snippet\n${index}${'x'.repeat(1400)}`,
    summary: index === 2 ? 'Summary\u0007 wins' : '',
  }));
  candidates.push({
    name: 'Duplicate',
    url: 'https://example.com/0',
    snippet: 'duplicate',
    summary: '',
  });

  const results = sanitizeSearchCandidates(candidates, {
    officialDomains: [],
    githubOwners: [],
  });

  assert.equal(results.length, 5);
  assert.equal(new Set(results.map((result) => result.href)).size, 5);
  assert.ok(results.every((result) => result.id.startsWith('web-')));
  assert.ok(results.every((result) => !/[\u0000-\u001f\u007f-\u009f]/u.test(result.title)));
  assert.ok(results.every((result) => result.snippet.length <= 1200));
  assert.equal(results.find((result) => result.href.endsWith('/1'))?.snippet, 'Summary wins');
});

test('candidate sanitization drops single-label and reserved-suffix URLs', () => {
  const results = sanitizeSearchCandidates([
    ...[
      'https://printer/status',
      'https://service.local/status',
      'https://service.localdomain/status',
      'https://service.lan/status',
      'https://service.home.arpa/status',
      'https://service.test/status',
      'https://service.invalid/status',
      'https://service.example/status',
      'https://service.onion/status',
    ].map((url) => ({ name: 'Unsafe', url, snippet: 'unsafe' })),
    { name: 'Safe', url: 'https://example.com/docs', snippet: 'safe' },
  ], {
    officialDomains: [],
    githubOwners: [],
  });

  assert.deepEqual(results.map((result) => result.href), ['https://example.com/docs']);
});

test('stored search results are revalidated and private fields are discarded before reuse', () => {
  assert.deepEqual(parseStoredSearchResults([{
    id: 'web-safe',
    title: 'Safe title',
    href: 'https://example.com/docs',
    kind: 'web',
    domain: 'example.com',
    score: null,
    snippet: 'Safe snippet',
    rawPayload: 'must not survive',
  }]), [{
    id: 'web-safe',
    title: 'Safe title',
    href: 'https://example.com/docs',
    kind: 'web',
    domain: 'example.com',
    score: null,
    snippet: 'Safe snippet',
  }]);
  assert.deepEqual(parseStoredSearchResults([{
    id: 'web-private',
    title: 'Private',
    href: 'https://127.0.0.1/admin',
    kind: 'web',
    domain: '127.0.0.1',
    score: null,
    snippet: 'private',
  }]), []);
});

test('stored search results drop single-label and reserved-suffix URLs', () => {
  const stored = [
    'https://printer/status',
    'https://service.local/status',
    'https://service.localdomain/status',
    'https://service.lan/status',
    'https://service.home.arpa/status',
    'https://service.test/status',
    'https://service.invalid/status',
    'https://service.example/status',
    'https://service.onion/status',
  ].map((href, index) => ({
    id: `web-unsafe-${index}`,
    title: 'Unsafe',
    href,
    kind: 'web',
    domain: new URL(href).hostname,
    score: null,
    snippet: 'unsafe',
  }));

  assert.deepEqual(parseStoredSearchResults(stored), []);
});
