import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runReleaseSmoke } from '../scripts/release-smoke.mjs';

function securityHeaders() {
  return {
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  };
}

test('release smoke verifies generic health payloads and baseline headers', async () => {
  const visited: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    visited.push(url.pathname);
    if (url.pathname.startsWith('/api/health/')) {
      return Response.json({ ok: true });
    }
    return new Response('ok', { headers: securityHeaders() });
  };

  assert.deepEqual(await runReleaseSmoke({
    baseUrl: 'http://127.0.0.1:3000',
    fetcher,
  }), { ok: true });
  assert.deepEqual(visited, ['/api/health/live', '/api/health/ready', '/']);
});

test('release smoke rejects detailed health responses and powered-by disclosure', async () => {
  await assert.rejects(
    runReleaseSmoke({
      baseUrl: 'https://morse.example',
      fetcher: async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/health/live') {
          return Response.json({ ok: true, database: 'ready' });
        }
        return new Response('ok', { headers: securityHeaders() });
      },
    }),
    /RELEASE_HEALTH_CONTRACT_FAILED/,
  );

  await assert.rejects(
    runReleaseSmoke({
      baseUrl: 'https://morse.example',
      fetcher: async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.startsWith('/api/health/')) return Response.json({ ok: true });
        return new Response('ok', {
          headers: { ...securityHeaders(), 'x-powered-by': 'Next.js' },
        });
      },
    }),
    /RELEASE_HEADER_FAILED/,
  );
});
