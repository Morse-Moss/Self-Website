import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OpenAIProvider } from '../lib/server/openai-provider.ts';

const providerConfig = {
  protocol: 'responses' as const,
  chatModel: 'test-chat-model',
  embeddingModel: 'test-embedding-model',
  embeddingDimensions: 2,
  maxOutputTokens: 400,
  embeddingTimeoutMs: 50,
  firstByteTimeoutMs: 50,
  totalTimeoutMs: 100,
  providerConcurrency: 4,
};

async function* fakeResponseStream() {
  yield { type: 'response.output_text.delta' as const, delta: 'Hello' };
  yield { type: 'response.output_text.delta' as const, delta: ' Morse' };
  yield {
    type: 'response.completed' as const,
    response: { usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } },
  };
}

function guard<T>(promise: Promise<T>, timeoutMs = 200): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('test guard timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

test('OpenAIProvider routes embeddings and Responses through separate clients', async () => {
  const calls: Array<{ kind: string; body: unknown }> = [];
  const embeddingClient = {
    embeddings: {
      create: async (body: unknown) => {
        calls.push({ kind: 'embedding', body });
        return { data: [{ embedding: [0.1, 0.2] }] };
      },
    },
  };
  const responseClient = {
    responses: {
      create: async (body: unknown) => {
        calls.push({ kind: 'response', body });
        return fakeResponseStream();
      },
    },
  };
  const provider = new OpenAIProvider(responseClient, embeddingClient, providerConfig);

  assert.deepEqual(await provider.embed(['question']), [[0.1, 0.2]]);

  const events = [];
  for await (const event of provider.streamAnswer({
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Hello' }],
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: 'delta', text: 'Hello' },
    { type: 'delta', text: ' Morse' },
    { type: 'done', usage: { inputTokens: 120, outputTokens: 30 } },
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    kind: 'embedding',
    body: {
      model: 'test-embedding-model',
      input: ['question'],
      dimensions: 2,
      encoding_format: 'float',
    },
  });
  assert.equal((calls[1].body as { stream: boolean }).stream, true);
});

test('OpenAIProvider sends safe Responses options and preserves missing usage', async () => {
  let responseBody: Record<string, unknown> | undefined;
  let responseOptions: { signal?: AbortSignal } | undefined;
  const controller = new AbortController();
  const responseClient = {
    responses: {
      create: async (
        body: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ) => {
        responseBody = body;
        responseOptions = options;
        return (async function* () {
          yield { type: 'response.completed' as const, response: {} };
        })();
      },
    },
  };
  const provider = new OpenAIProvider(responseClient, {
    embeddings: { create: async () => ({ data: [] }) },
  }, providerConfig);

  const events = [];
  for await (const event of provider.streamAnswer({
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Hello' }],
  }, controller.signal)) {
    events.push(event);
  }

  assert.deepEqual(responseBody, {
    model: 'test-chat-model',
    instructions: 'Use evidence only.',
    input: [{ role: 'user', content: 'Hello' }],
    max_output_tokens: 400,
    stream: true,
    store: false,
  });
  assert.ok(responseOptions?.signal);
  assert.deepEqual(events, [{ type: 'done', usage: null }]);
});

test('OpenAIProvider streams Chat Completions without falling back to Responses', async () => {
  let responseCalls = 0;
  let chatBody: Record<string, unknown> | undefined;
  let chatOptions: { signal?: AbortSignal } | undefined;
  const controller = new AbortController();
  const chatClient = {
    responses: {
      create: async () => {
        responseCalls += 1;
        throw new Error('Responses must not be called.');
      },
    },
    chat: {
      completions: {
        create: async (
          body: Record<string, unknown>,
          options?: { signal?: AbortSignal },
        ) => {
          chatBody = body;
          chatOptions = options;
          return (async function* () {
            yield { choices: [{ delta: { content: 'Hello' } }], usage: null };
            yield {
              choices: [],
              usage: { prompt_tokens: 21, completion_tokens: 4, total_tokens: 25 },
            };
          })();
        },
      },
    },
  };
  const provider = new OpenAIProvider(chatClient, {
    embeddings: { create: async () => ({ data: [] }) },
  }, {
    ...providerConfig,
    protocol: 'chat_completions',
  });

  const events = [];
  for await (const event of provider.streamAnswer({
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Hello' }],
  }, controller.signal)) {
    events.push(event);
  }

  assert.equal(responseCalls, 0);
  assert.deepEqual(chatBody, {
    model: 'test-chat-model',
    messages: [
      { role: 'system', content: 'Use evidence only.' },
      { role: 'user', content: 'Hello' },
    ],
    max_completion_tokens: 400,
    stream: true,
    stream_options: { include_usage: true },
  });
  assert.ok(chatOptions?.signal);
  assert.deepEqual(events, [
    { type: 'delta', text: 'Hello' },
    { type: 'done', usage: { inputTokens: 21, outputTokens: 4 } },
  ]);
});

test('OpenAIProvider reports null when Chat Completions omits usage', async () => {
  const provider = new OpenAIProvider({
    chat: {
      completions: {
        create: async () => (async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] };
        })(),
      },
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, {
    ...providerConfig,
    protocol: 'chat_completions',
  });

  const events = [];
  for await (const event of provider.streamAnswer({
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Hello' }],
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: 'delta', text: 'Hello' },
    { type: 'done', usage: null },
  ]);
});

test('OpenAIProvider does not expose raw SDK errors', async () => {
  const provider = new OpenAIProvider({
    responses: {
      create: async () => {
        throw new Error('raw upstream payload must stay private');
      },
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, providerConfig);
  const iterator = provider.streamAnswer({
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Hello' }],
  })[Symbol.asyncIterator]();

  await assert.rejects(iterator.next(), (error: unknown) => (
    (error as { name?: string }).name === 'OpenAIProviderError'
    && (error as { code?: string }).code === 'PROVIDER_UNAVAILABLE'
    && !(error as Error).message.includes('raw upstream payload')
  ));

  const embeddingProvider = new OpenAIProvider({
    responses: { create: async () => fakeResponseStream() },
  }, {
    embeddings: {
      create: async () => {
        throw new Error('raw embedding payload must stay private');
      },
    },
  }, providerConfig);
  await assert.rejects(embeddingProvider.embed(['question']), (error: unknown) => (
    (error as { name?: string }).name === 'OpenAIProviderError'
    && (error as { code?: string }).code === 'EMBEDDING_UNAVAILABLE'
    && !(error as Error).message.includes('raw embedding payload')
  ));

  const failedResponseProvider = new OpenAIProvider({
    responses: {
      create: async () => (async function* () {
        yield {
          type: 'response.failed' as const,
          response: { error: { message: 'raw response failure payload' } },
        };
      })(),
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, providerConfig);
  const failedResponse = failedResponseProvider.streamAnswer({
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Hello' }],
  })[Symbol.asyncIterator]();
  await assert.rejects(failedResponse.next(), (error: unknown) => (
    (error as { name?: string }).name === 'OpenAIProviderError'
    && (error as { code?: string }).code === 'PROVIDER_RESPONSE_FAILED'
    && !(error as Error).message.includes('raw response failure payload')
  ));
});

test('OpenAIProvider limits generation across instances and aborts a queued waiter', async () => {
  let createCalls = 0;
  let markFirstStarted!: () => void;
  let releaseFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const responseClient = {
    responses: {
      create: async () => {
        createCalls += 1;
        const call = createCalls;
        return (async function* () {
          if (call === 1) {
            markFirstStarted();
            await firstReleased;
          }
          yield { type: 'response.completed' as const, response: {} };
        })();
      },
    },
  };
  const firstProvider = new OpenAIProvider(responseClient, {
    embeddings: { create: async () => ({ data: [] }) },
  }, {
    ...providerConfig,
    providerConcurrency: 1,
  });
  const secondProvider = new OpenAIProvider(responseClient, {
    embeddings: { create: async () => ({ data: [] }) },
  }, {
    ...providerConfig,
    providerConcurrency: 1,
  });
  const request = {
    instructions: 'Use evidence only.',
    messages: [{ role: 'user' as const, content: 'Hello' }],
  };
  const first = firstProvider.streamAnswer(request)[Symbol.asyncIterator]();
  const firstEvent = first.next();
  await firstStarted;

  const queuedController = new AbortController();
  const queuedReason = new Error('queued answer stopped');
  const queued = secondProvider.streamAnswer(
    request,
    queuedController.signal,
  )[Symbol.asyncIterator]().next();
  try {
    await Promise.resolve();
    assert.equal(createCalls, 1);

    queuedController.abort(queuedReason);
    await assert.rejects(guard(queued), (error: unknown) => error === queuedReason);
    assert.equal(createCalls, 1);

    releaseFirst();
    assert.deepEqual(await guard(firstEvent), {
      done: false,
      value: { type: 'done', usage: null },
    });
    await first.return?.();

    const after = secondProvider.streamAnswer(request)[Symbol.asyncIterator]();
    assert.deepEqual(await guard(after.next()), {
      done: false,
      value: { type: 'done', usage: null },
    });
    assert.equal(createCalls, 2);
    await after.return?.();
  } finally {
    queuedController.abort(queuedReason);
    releaseFirst();
    await firstEvent.catch(() => undefined);
    try {
      await first.return?.();
    } catch {
      // Cleanup must not replace the assertion failure.
    }
  }
});

test('OpenAIProvider forwards the embedding signal through SDK request options', async () => {
  let requestOptions: { signal?: AbortSignal } | undefined;
  const controller = new AbortController();
  const provider = new OpenAIProvider({ responses: { create: async () => fakeResponseStream() } }, {
    embeddings: {
      create: async (_body: unknown, options?: { signal?: AbortSignal }) => {
        requestOptions = options;
        return { data: [{ embedding: [0.1, 0.2] }] };
      },
    },
  }, providerConfig);

  assert.deepEqual(await provider.embed(['question'], controller.signal), [[0.1, 0.2]]);
  assert.ok(requestOptions?.signal);
});

test('OpenAIProvider propagates external aborts through the embedding signal', async () => {
  let sdkSignal: AbortSignal | undefined;
  const controller = new AbortController();
  const reason = new Error('embedding stopped');
  const provider = new OpenAIProvider({ responses: { create: async () => fakeResponseStream() } }, {
    embeddings: {
      create: async (_body: unknown, options?: { signal?: AbortSignal }) => {
        sdkSignal = options?.signal;
        return new Promise<never>(() => undefined);
      },
    },
  }, providerConfig);
  const embedding = provider.embed(['question'], controller.signal);

  await Promise.resolve();
  controller.abort(reason);

  await assert.rejects(guard(embedding), (error: unknown) => error === reason);
  assert.equal(sdkSignal?.aborted, true);
  assert.equal(sdkSignal?.reason, reason);
});

test('OpenAIProvider propagates external aborts through the answer signal', async () => {
  let sdkSignal: AbortSignal | undefined;
  let returnCalls = 0;
  let markNextStarted!: () => void;
  const nextStarted = new Promise<void>((resolve) => { markNextStarted = resolve; });
  const controller = new AbortController();
  const reason = new Error('answer stopped');
  const provider = new OpenAIProvider({
    responses: {
      create: async (_body: unknown, options?: { signal?: AbortSignal }) => {
        sdkSignal = options?.signal;
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                markNextStarted();
                return new Promise<never>(() => undefined);
              },
              return: async () => {
                returnCalls += 1;
                return { done: true as const, value: undefined };
              },
            };
          },
        };
      },
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, providerConfig);
  const iterator = provider.streamAnswer({
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Hello' }],
  }, controller.signal)[Symbol.asyncIterator]();
  const answer = iterator.next();

  await nextStarted;
  controller.abort(reason);

  await assert.rejects(guard(answer), (error: unknown) => error === reason);
  assert.equal(sdkSignal?.aborted, true);
  assert.equal(sdkSignal?.reason, reason);
  assert.equal(returnCalls, 1);
});

test('OpenAIProvider enforces the embedding timeout', async () => {
  let sdkSignal: AbortSignal | undefined;
  const provider = new OpenAIProvider({ responses: { create: async () => fakeResponseStream() } }, {
    embeddings: {
      create: async (_body: unknown, options?: { signal?: AbortSignal }) => {
        sdkSignal = options?.signal;
        return new Promise<never>(() => undefined);
      },
    },
  }, {
    ...providerConfig,
    embeddingTimeoutMs: 10,
  });

  await assert.rejects(
    guard(provider.embed(['question'])),
    (error: unknown) => (error as { code?: string }).code === 'EMBEDDING_TIMEOUT',
  );
  assert.equal(sdkSignal?.aborted, true);
  assert.equal((sdkSignal?.reason as { code?: string }).code, 'EMBEDDING_TIMEOUT');
});

test('OpenAIProvider enforces the first-byte timeout', async () => {
  let sdkSignal: AbortSignal | undefined;
  let returnCalls = 0;
  const provider = new OpenAIProvider({
    responses: {
      create: async (_body: unknown, options?: { signal?: AbortSignal }) => {
        sdkSignal = options?.signal;
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => new Promise<never>(() => undefined),
              return: async () => {
                returnCalls += 1;
                return { done: true as const, value: undefined };
              },
            };
          },
        };
      },
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, {
    ...providerConfig,
    firstByteTimeoutMs: 10,
  });
  const iterator = provider.streamAnswer({
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Hello' }],
  })[Symbol.asyncIterator]();

  await assert.rejects(
    guard(iterator.next()),
    (error: unknown) => (error as { code?: string }).code === 'PROVIDER_FIRST_BYTE_TIMEOUT',
  );
  assert.equal(sdkSignal?.aborted, true);
  assert.equal((sdkSignal?.reason as { code?: string }).code, 'PROVIDER_FIRST_BYTE_TIMEOUT');
  assert.equal(returnCalls, 1);
});

test('OpenAIProvider enforces the total answer timeout after the first byte', async () => {
  let nextCalls = 0;
  let sdkSignal: AbortSignal | undefined;
  let returnCalls = 0;
  const provider = new OpenAIProvider({
    responses: {
      create: async (_body: unknown, options?: { signal?: AbortSignal }) => {
        sdkSignal = options?.signal;
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                nextCalls += 1;
                if (nextCalls === 1) {
                  return {
                    done: false as const,
                    value: { type: 'response.output_text.delta' as const, delta: 'Hi' },
                  };
                }
                return new Promise<never>(() => undefined);
              },
              return: async () => {
                returnCalls += 1;
                return { done: true as const, value: undefined };
              },
            };
          },
        };
      },
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, {
    ...providerConfig,
    firstByteTimeoutMs: 50,
    totalTimeoutMs: 10,
  });
  const iterator = provider.streamAnswer({
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Hello' }],
  })[Symbol.asyncIterator]();

  assert.deepEqual(await guard(iterator.next()), {
    done: false,
    value: { type: 'delta', text: 'Hi' },
  });
  await assert.rejects(
    guard(iterator.next()),
    (error: unknown) => (error as { code?: string }).code === 'PROVIDER_TOTAL_TIMEOUT',
  );
  assert.equal(sdkSignal?.aborted, true);
  assert.equal((sdkSignal?.reason as { code?: string }).code, 'PROVIDER_TOTAL_TIMEOUT');
  assert.equal(returnCalls, 1);
});
