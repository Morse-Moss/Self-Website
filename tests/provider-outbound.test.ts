import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import {
  createPinnedProviderFetch,
  createProviderOutboundPolicy,
  resolvePublicProviderAddresses,
  validateProviderBaseUrl,
  validateProviderRuntimeBaseUrl,
  type ProviderAddress,
  type ProviderRequestTransport,
} from '../lib/server/provider-outbound.ts';

test('provider base URLs require credential-free HTTPS and normalize one trailing slash', () => {
  assert.equal(validateProviderBaseUrl('https://api.example.com/v1/').href, 'https://api.example.com/v1');
  for (const input of [
    'http://api.example.com/v1',
    'https://user:secret@api.example.com/v1',
    'https://api.example.com/v1?key=secret',
    'https://api.example.com/v1#secret',
  ]) {
    assert.throws(() => validateProviderBaseUrl(input), (error: unknown) => (
      (error as { code?: string }).code === 'PROVIDER_URL_INVALID'
      && !(error as Error).message.includes(input)
    ));
  }
});

test('runtime base URLs allow only HTTPS or the exact explicit loopback mock origin', () => {
  const policy = createProviderOutboundPolicy({
    NODE_ENV: 'test',
    MORSE_LOCAL_RELEASE_SMOKE: 'true',
    MORSE_PROVIDER_MOCK_ORIGIN: 'http://127.0.0.1:18090',
  });
  assert.equal(
    validateProviderRuntimeBaseUrl('http://127.0.0.1:18090/v1/', policy).href,
    'http://127.0.0.1:18090/v1',
  );
  for (const input of [
    'http://127.0.0.1:18091/v1',
    'http://localhost:18090/v1',
    'http://api.example.com/v1',
  ]) {
    assert.throws(
      () => validateProviderRuntimeBaseUrl(input, policy),
      (error: unknown) => (error as { code?: string }).code === 'PROVIDER_URL_INVALID',
    );
  }
});

test('provider DNS validation accepts public IPv4 and IPv6 only when every result is public', async () => {
  const publicAddresses = await resolvePublicProviderAddresses('api.example.com', async () => [
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
  assert.deepEqual(publicAddresses.map((entry) => entry.address), [
    '8.8.8.8',
    '2606:4700:4700::1111',
  ]);

  for (const addresses of [
    [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.7', family: 4 }],
    [{ address: '::ffff:127.0.0.1', family: 6 }],
    [{ address: '169.254.169.254', family: 4 }],
    [{ address: '2001:db8::1', family: 6 }],
  ] satisfies ProviderAddress[][]) {
    await assert.rejects(
      resolvePublicProviderAddresses('api.example.com', async () => addresses),
      (error: unknown) => (
        (error as { code?: string }).code === 'PROVIDER_ADDRESS_DENIED'
        && !(error as Error).message.includes(addresses[0].address)
      ),
    );
  }
});

test('pinned provider fetch re-resolves, pins the validated address, and preserves TLS hostname', async () => {
  let resolverCalls = 0;
  const seen: Array<{ address: string; hostname: string; servername: string }> = [];
  const request: ProviderRequestTransport = async (input) => {
    seen.push({
      address: input.address.address,
      hostname: input.url.hostname,
      servername: input.servername,
    });
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const pinnedFetch = createPinnedProviderFetch({
    resolver: async () => {
      resolverCalls += 1;
      return [{ address: resolverCalls === 1 ? '8.8.8.8' : '1.1.1.1', family: 4 }];
    },
    request,
  });

  await pinnedFetch('https://api.example.com/v1/responses', { method: 'POST', body: '{}' });
  await pinnedFetch('https://api.example.com/v1/responses', { method: 'POST', body: '{}' });

  assert.equal(resolverCalls, 2);
  assert.deepEqual(seen, [
    { address: '8.8.8.8', hostname: 'api.example.com', servername: 'api.example.com' },
    { address: '1.1.1.1', hostname: 'api.example.com', servername: 'api.example.com' },
  ]);
});

test('pinned provider transport supports Node lookup calls that request all addresses', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://localhost:${address.port}`;
    const pinnedFetch = createPinnedProviderFetch({
      policy: { allowedLoopbackHttpOrigin: origin },
    });

    const response = await pinnedFetch(`${origin}/responses`, {
      method: 'POST',
      body: '{}',
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"ok":true}');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('pinned provider fetch rejects redirects and aborts transport without leaking request data', async () => {
  const secret = 'sk-provider-secret';
  const redirectFetch = createPinnedProviderFetch({
    resolver: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async () => new Response(null, {
      status: 302,
      headers: { location: `https://other.example/${secret}` },
    }),
  });
  await assert.rejects(
    redirectFetch(`https://api.example.com/${'x'.repeat(4_096)}`, {
      headers: { authorization: `Bearer ${secret}` },
    }),
    (error: unknown) => (
      (error as { code?: string }).code === 'PROVIDER_REDIRECT_DENIED'
      && !(error as Error).message.includes(secret)
      && !(error as Error).message.includes('other.example')
    ),
  );

  const controller = new AbortController();
  let transportAborted = false;
  let markTransportStarted!: () => void;
  const transportStarted = new Promise<void>((resolve) => { markTransportStarted = resolve; });
  const abortFetch = createPinnedProviderFetch({
    resolver: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async (input) => new Promise<Response>((_resolve, reject) => {
      markTransportStarted();
      input.signal?.addEventListener('abort', () => {
        transportAborted = true;
        reject(input.signal?.reason);
      }, { once: true });
    }),
  });
  const pending = abortFetch('https://api.example.com/v1/responses', {
    signal: controller.signal,
  });
  await transportStarted;
  controller.abort(new Error('stop'));
  await assert.rejects(pending, /stop/);
  assert.equal(transportAborted, true);
});
