import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BochaSearchProvider } from '../lib/server/bocha-search-provider.ts';

const providerConfig = {
  apiKey: 'bocha-test-key',
  baseUrl: 'https://api.bocha.test/v1',
  timeoutMs: 1000,
  concurrency: 2,
  officialDomains: ['openai.com'],
  githubOwners: ['Morse-Moss'],
};

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

test('Bocha adapter sends the official one-shot request and consumes only safe webPages fields', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const raw = Array.from({ length: 7 }, (_, index) => ({
    name: `Result ${index}`,
    url: `https://example.com/${index}`,
    snippet: `Snippet ${index}`,
    summary: index === 0 ? 'Summary 0' : '',
    secretRawPayload: `secret-${index}`,
  }));
  raw.splice(1, 0, {
    name: 'Private',
    url: 'https://169.254.169.254/latest/meta-data',
    snippet: 'private',
    summary: '',
    secretRawPayload: 'secret-private',
  });
  const provider = new BochaSearchProvider(providerConfig, async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ webPages: { value: raw }, ignored: 'raw-secret' });
  });

  const result = await provider.search('latest OpenAI docs');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.bocha.test/v1/web-search');
  assert.equal(new Headers(calls[0].init?.headers).get('authorization'), 'Bearer bocha-test-key');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    query: 'latest OpenAI docs',
    summary: true,
    count: 5,
  });
  assert.ok(calls[0].init?.signal instanceof AbortSignal);
  assert.equal(result.status, 'completed');
  assert.equal(result.errorCode, null);
  assert.equal(result.results.length, 5);
  assert.equal(result.results[0].snippet, 'Summary 0');
  assert.doesNotMatch(JSON.stringify(result), /secretRawPayload|raw-secret|secret-private/);
});

test('Bocha adapter rejects a successful but malformed response as a stable failure', async () => {
  const provider = new BochaSearchProvider(
    providerConfig,
    async () => jsonResponse({ data: { webPages: { value: [] } } }),
  );

  assert.deepEqual(await provider.search('malformed'), {
    status: 'failed',
    results: [],
    errorCode: 'SEARCH_FAILED',
  });
});

test('Bocha adapter converts timeout and non-abort failures into stable failed results without logging raw data', async () => {
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => { logged.push(values); };
  try {
    const timeoutProvider = new BochaSearchProvider(
      { ...providerConfig, timeoutMs: 10 },
      async (_url, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!(signal instanceof AbortSignal)) return reject(new Error('missing signal'));
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    );
    assert.deepEqual(await timeoutProvider.search('timeout'), {
      status: 'failed',
      results: [],
      errorCode: 'SEARCH_TIMEOUT',
    });

    const failingProvider = new BochaSearchProvider(providerConfig, async () => {
      throw new Error('secret raw Bocha payload');
    });
    assert.deepEqual(await failingProvider.search('failure'), {
      status: 'failed',
      results: [],
      errorCode: 'SEARCH_FAILED',
    });
    assert.deepEqual(logged, []);
  } finally {
    console.error = originalError;
  }
});

test('Bocha adapter propagates caller abort exactly and does not retry', async () => {
  const controller = new AbortController();
  let calls = 0;
  let started!: () => void;
  const didStart = new Promise<void>((resolve) => { started = resolve; });
  const provider = new BochaSearchProvider(providerConfig, async (_url, init) => {
    calls += 1;
    started();
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const running = provider.search('abort', controller.signal);
  await didStart;
  const reason = new DOMException('visitor stopped', 'AbortError');
  controller.abort(reason);
  await assert.rejects(running, (error: unknown) => error === reason);
  assert.equal(calls, 1);
});

test('Bocha adapter enforces configured global concurrency with abortable queue waits', async () => {
  const resolvers: Array<(response: Response) => void> = [];
  let calls = 0;
  const provider = new BochaSearchProvider(
    { ...providerConfig, concurrency: 1 },
    async () => {
      calls += 1;
      return new Promise<Response>((resolve) => { resolvers.push(resolve); });
    },
  );

  const first = provider.search('first');
  while (calls < 1) await Promise.resolve();
  const second = provider.search('second');
  await Promise.resolve();
  assert.equal(calls, 1);
  resolvers.shift()!(jsonResponse({ webPages: { value: [] } }));
  await first;
  while (calls < 2) await Promise.resolve();
  resolvers.shift()!(jsonResponse({ webPages: { value: [] } }));
  await second;
  assert.equal(calls, 2);

  const blocker = provider.search('blocker');
  while (calls < 3) await Promise.resolve();
  const controller = new AbortController();
  const queued = provider.search('queued-abort', controller.signal);
  const reason = new DOMException('queue stopped', 'AbortError');
  controller.abort(reason);
  await assert.rejects(queued, (error: unknown) => error === reason);
  assert.equal(calls, 3);
  resolvers.shift()!(jsonResponse({ webPages: { value: [] } }));
  await blocker;
});
