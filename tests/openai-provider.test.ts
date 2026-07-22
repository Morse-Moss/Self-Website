import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OpenAIProvider } from '../lib/server/openai-provider.ts';
import { createChatExecutionBudget } from '../lib/server/chat-execution-budget.ts';

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
  reasoningEffort: 'high' as const,
};

test('Responses metadata is protocol activity but not model text', async () => {
  const now = Date.now();
  const provider = new OpenAIProvider({
    responses: {
      create: async () => (async function* () {
        yield { type: 'response.created' as const, response: {} };
        yield { type: 'response.output_text.delta' as const, delta: 'Hello' };
        yield { type: 'response.completed' as const, response: {} };
      })(),
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, providerConfig);
  const budget = createChatExecutionBudget({
    turnStartedAtMs: now,
    providerStartedAtMs: now,
    turnTimeoutMs: 90_000,
    providerTimeoutMs: 80_000,
    maxAttempts: 3,
  });

  const events = [];
  for await (const event of provider.streamAnswer({
    instructions: 'Answer directly.',
    messages: [{ role: 'user', content: 'Hello' }],
    execution: {
      executionId: '11111111-1111-4111-8111-111111111111',
      releasePolicy: 'segment',
      minimumBufferCharacters: 1,
      totalTimeoutMs: 80_000,
      budget,
      generationMode: 'normal',
      protocolEventTimeoutMs: 25_000,
      modelTextTimeoutMs: 40_000,
      hedgingEnabled: false,
      delaysMs: [0],
      acceptCandidate: () => true,
      reserveHedgedAttempt: async () => false,
      onAttempt: async () => undefined,
    },
  })) events.push(event);

  assert.deepEqual(
    events.filter((event) => event.type === 'activity').map((event) => event.kind),
    ['protocol', 'model_text'],
  );
});

async function* fakeResponseStream() {
  yield {
    type: 'response.output_text.delta' as const,
    delta: 'Hello',
    item_id: 'msg_1',
    output_index: 0,
    content_index: 0,
  };
  yield {
    type: 'response.output_text.delta' as const,
    delta: ' Morse',
    item_id: 'msg_1',
    output_index: 0,
    content_index: 0,
  };
  yield {
    type: 'response.output_text.done' as const,
    text: 'Hello Morse',
    item_id: 'msg_1',
    output_index: 0,
    content_index: 0,
  };
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
          yield {
            type: 'response.output_text.delta' as const,
            delta: 'Hello',
            item_id: 'msg_1',
            output_index: 0,
            content_index: 0,
          };
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
    reasoning: { effort: 'high' },
    stream: true,
    store: false,
  });
  assert.ok(responseOptions?.signal);
  assert.deepEqual(events, [
    { type: 'delta', text: 'Hello' },
    { type: 'done', usage: null },
  ]);
});

test('OpenAIProvider lets one Responses turn lower reasoning without changing the default', async () => {
  const bodies: Record<string, unknown>[] = [];
  const provider = new OpenAIProvider({
    responses: {
      create: async (body: Record<string, unknown>) => {
        bodies.push(body);
        return fakeResponseStream();
      },
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, providerConfig);

  for await (const _event of provider.streamAnswer({
    instructions: 'Social turn.',
    messages: [{ role: 'user', content: 'Hello' }],
    reasoningEffort: 'low',
  })) {
    // Consume the stream so the request is fully exercised.
  }
  for await (const _event of provider.streamAnswer({
    instructions: 'Grounded turn.',
    messages: [{ role: 'user', content: 'Explain the architecture' }],
  })) {
    // Consume the stream so the request is fully exercised.
  }

  assert.deepEqual(bodies.map((body) => body.reasoning), [
    { effort: 'low' },
    { effort: 'high' },
  ]);
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
            yield {
              choices: [{ delta: { content: 'Hello' }, finish_reason: null }],
              usage: null,
            };
            yield {
              choices: [{ delta: {}, finish_reason: 'stop' }],
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
    reasoning_effort: 'high',
    stream: true,
    stream_options: { include_usage: true },
  });
  assert.ok(chatOptions?.signal);
  assert.deepEqual(events, [
    { type: 'delta', text: 'Hello' },
    { type: 'done', usage: { inputTokens: 21, outputTokens: 4 } },
  ]);
});

test('OpenAIProvider lets one Chat Completions turn lower reasoning', async () => {
  let chatBody: Record<string, unknown> | undefined;
  const provider = new OpenAIProvider({
    chat: {
      completions: {
        create: async (body: Record<string, unknown>) => {
          chatBody = body;
          return (async function* () {
            yield {
              choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }],
              usage: null,
            };
          })();
        },
      },
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, {
    ...providerConfig,
    protocol: 'chat_completions',
  });

  for await (const _event of provider.streamAnswer({
    instructions: 'Social turn.',
    messages: [{ role: 'user', content: 'Hello' }],
    reasoningEffort: 'low',
  })) {
    // Consume the stream so the request is fully exercised.
  }

  assert.equal(chatBody?.reasoning_effort, 'low');
});

test('OpenAIProvider reports null when Chat Completions omits usage', async () => {
  const provider = new OpenAIProvider({
    chat: {
      completions: {
        create: async () => (async function* () {
          yield { choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] };
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

test('OpenAIProvider rejects Chat Completions EOF without a finish reason', async () => {
  const provider = new OpenAIProvider({
    chat: {
      completions: {
        create: async () => (async function* () {
          yield {
            choices: [{ delta: { content: 'Partial' }, finish_reason: null }],
          };
        })(),
      },
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, {
    ...providerConfig,
    protocol: 'chat_completions',
  });
  const iterator = provider.streamAnswer({
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Hello' }],
  })[Symbol.asyncIterator]();

  assert.deepEqual(await iterator.next(), {
    done: false,
    value: { type: 'delta', text: 'Partial' },
  });
  await assert.rejects(iterator.next(), (error: unknown) => (
    (error as { code?: string }).code === 'PROVIDER_RESPONSE_INCOMPLETE'
  ));
});

test('OpenAIProvider rejects a Responses incomplete terminal event', async () => {
  const provider = new OpenAIProvider({
    responses: {
      create: async () => (async function* () {
        yield { type: 'response.output_text.delta' as const, delta: 'Partial' };
        yield {
          type: 'response.incomplete' as const,
          response: { incomplete_details: { reason: 'raw private reason' } },
        };
      })(),
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, providerConfig);
  const iterator = provider.streamAnswer({
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Hello' }],
  })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, 'delta');
  await assert.rejects(iterator.next(), (error: unknown) => (
    (error as { code?: string }).code === 'PROVIDER_RESPONSE_INCOMPLETE'
    && !(error as Error).message.includes('raw private reason')
  ));
});

test('OpenAIProvider performs one network attempt for an incomplete Responses target', async () => {
  let createCalls = 0;
  const provider = new OpenAIProvider({
    responses: {
      create: async () => {
        createCalls += 1;
        return (async function* () {
          yield {
            type: 'response.incomplete' as const,
            response: {
              usage: { input_tokens: 15, output_tokens: 5, total_tokens: 20 },
            },
          };
        })();
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
    (error as { code?: string }).code === 'PROVIDER_RESPONSE_INCOMPLETE'
    && (error as { usage?: unknown }).usage !== null
  ));
  assert.equal(createCalls, 1);
});

test('OpenAIProvider performs one network attempt for a transient HTTP target failure', async () => {
  let createCalls = 0;
  const provider = new OpenAIProvider({
    responses: {
      create: async () => {
        createCalls += 1;
        throw Object.assign(new Error('private gateway payload'), { status: 502 });
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
    (error as { code?: string }).code === 'PROVIDER_UNAVAILABLE'
    && !(error as Error).message.includes('private gateway payload')
  ));
  assert.equal(createCalls, 1);
});

test('OpenAIProvider never retries a transient HTTP failure after partial output', async () => {
  let createCalls = 0;
  const provider = new OpenAIProvider({
    responses: {
      create: async () => {
        createCalls += 1;
        return (async function* () {
          yield {
            type: 'response.output_text.delta' as const,
            delta: 'Partial',
            item_id: 'msg_1',
            output_index: 0,
            content_index: 0,
          };
          throw Object.assign(new Error('private gateway payload'), { status: 502 });
        })();
      },
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, providerConfig);
  const iterator = provider.streamAnswer({
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Hello' }],
  })[Symbol.asyncIterator]();

  assert.deepEqual(await iterator.next(), {
    done: false,
    value: { type: 'delta', text: 'Partial' },
  });
  await assert.rejects(iterator.next(), (error: unknown) => (
    (error as { code?: string }).code === 'PROVIDER_UNAVAILABLE'
  ));
  assert.equal(createCalls, 1);
});

test('OpenAIProvider rejects one empty completed Responses attempt', async () => {
  let createCalls = 0;
  const provider = new OpenAIProvider({
    responses: {
      create: async () => {
        createCalls += 1;
        return (async function* () {
          yield { type: 'response.completed' as const, response: {} };
        })();
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
    (error as { code?: string }).code === 'PROVIDER_RESPONSE_INCOMPLETE'
  ));
  assert.equal(createCalls, 1);
});

test('OpenAIProvider does not retry a permanent HTTP failure', async () => {
  let createCalls = 0;
  const provider = new OpenAIProvider({
    responses: {
      create: async () => {
        createCalls += 1;
        throw Object.assign(new Error('private request payload'), { status: 400 });
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
    (error as { code?: string }).code === 'PROVIDER_UNAVAILABLE'
    && !(error as Error).message.includes('private request payload')
  ));
  assert.equal(createCalls, 1);
});

test('OpenAIProvider restores every finalized Responses text part and suppresses duplicates', async () => {
  const provider = new OpenAIProvider({
    responses: {
      create: async () => (async function* () {
        yield {
          type: 'response.output_text.done' as const,
          text: 'Hello',
          item_id: 'msg_1',
          output_index: 0,
          content_index: 0,
        };
        yield {
          type: 'response.output_text.done' as const,
          text: ' Morse',
          item_id: 'msg_2',
          output_index: 1,
          content_index: 0,
        };
        yield {
          type: 'response.output_text.done' as const,
          text: 'Hello',
          item_id: 'msg_1',
          output_index: 0,
          content_index: 0,
        };
        yield {
          type: 'response.completed' as const,
          response: { usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } },
        };
      })(),
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, providerConfig);

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
});

test('OpenAIProvider restores a done-only part after a different part streamed deltas', async () => {
  const provider = new OpenAIProvider({
    responses: {
      create: async () => (async function* () {
        yield {
          type: 'response.output_text.delta' as const,
          delta: 'Hello',
          item_id: 'msg_1',
          output_index: 0,
          content_index: 0,
        };
        yield {
          type: 'response.output_text.done' as const,
          text: 'Hello',
          item_id: 'msg_1',
          output_index: 0,
          content_index: 0,
        };
        yield {
          type: 'response.output_text.done' as const,
          text: ' Morse',
          item_id: 'msg_2',
          output_index: 1,
          content_index: 0,
        };
        yield {
          type: 'response.completed' as const,
          response: { usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } },
        };
      })(),
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, providerConfig);

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
});

test('OpenAIProvider rejects Responses EOF without response.completed', async () => {
  const provider = new OpenAIProvider({
    responses: {
      create: async () => (async function* () {
        yield { type: 'response.output_text.delta' as const, delta: 'Partial' };
      })(),
    },
  }, {
    embeddings: { create: async () => ({ data: [] }) },
  }, providerConfig);
  const iterator = provider.streamAnswer({
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Hello' }],
  })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, 'delta');
  await assert.rejects(iterator.next(), (error: unknown) => (
    (error as { code?: string }).code === 'PROVIDER_RESPONSE_INCOMPLETE'
  ));
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

  let failedResponseCalls = 0;
  const failedResponseProvider = new OpenAIProvider({
    responses: {
      create: async () => {
        failedResponseCalls += 1;
        return (async function* () {
          yield {
            type: 'response.failed' as const,
            response: { error: { message: 'raw response failure payload' } },
          };
        })();
      },
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
  assert.equal(failedResponseCalls, 1, 'explicit failed responses must not be retried');
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
          yield {
            type: 'response.output_text.delta' as const,
            delta: 'Hello',
            item_id: `msg_${call}`,
            output_index: 0,
            content_index: 0,
          };
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
      value: { type: 'delta', text: 'Hello' },
    });
    assert.deepEqual(await guard(first.next()), {
      done: false,
      value: { type: 'done', usage: null },
    });

    const after = secondProvider.streamAnswer(request)[Symbol.asyncIterator]();
    assert.deepEqual(await guard(after.next()), {
      done: false,
      value: { type: 'delta', text: 'Hello' },
    });
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

test('OpenAIProvider aborts and awaits early stream cleanup before releasing capacity', async () => {
  let createCalls = 0;
  let sdkSignal: AbortSignal | undefined;
  let markReturnStarted!: () => void;
  let releaseCleanup!: () => void;
  const returnStarted = new Promise<void>((resolve) => { markReturnStarted = resolve; });
  const cleanupReleased = new Promise<void>((resolve) => { releaseCleanup = resolve; });
  const responseClient = {
    responses: {
      create: async (_body: unknown, options?: { signal?: AbortSignal }) => {
        createCalls += 1;
        if (createCalls > 1) return fakeResponseStream();
        sdkSignal = options?.signal;
        let nextCalls = 0;
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                nextCalls += 1;
                if (nextCalls === 1) {
                  return {
                    done: false as const,
                    value: { type: 'response.output_text.delta' as const, delta: 'Partial' },
                  };
                }
                return new Promise<never>(() => undefined);
              },
              return: async () => {
                markReturnStarted();
                await cleanupReleased;
                return { done: true as const, value: undefined };
              },
            };
          },
        };
      },
    },
  };
  const firstProvider = new OpenAIProvider(responseClient, {
    embeddings: { create: async () => ({ data: [] }) },
  }, { ...providerConfig, providerConcurrency: 1 });
  const secondProvider = new OpenAIProvider(responseClient, {
    embeddings: { create: async () => ({ data: [] }) },
  }, { ...providerConfig, providerConcurrency: 1 });
  const request = {
    instructions: 'Use evidence only.',
    messages: [{ role: 'user' as const, content: 'Hello' }],
  };
  const first = firstProvider.streamAnswer(request)[Symbol.asyncIterator]();
  assert.equal((await first.next()).value.type, 'delta');
  const closing = first.return?.() ?? Promise.resolve({ done: true as const, value: undefined });
  await returnStarted;
  const second = secondProvider.streamAnswer(request)[Symbol.asyncIterator]();
  const secondEvent = second.next();

  try {
    const prematureOutcome = await Promise.race([
      closing.then(
        () => 'first-settled',
        () => 'first-settled',
      ),
      secondEvent.then(
        () => 'second-started',
        () => 'second-started',
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('cleanup-pending'), 30);
      }),
    ]);
    assert.equal(sdkSignal?.aborted, true);
    assert.equal(prematureOutcome, 'cleanup-pending');
    assert.equal(createCalls, 1);

    releaseCleanup();
    await closing;
    assert.equal((await guard(secondEvent)).value.type, 'delta');
  } finally {
    releaseCleanup();
    await closing.catch(() => undefined);
    await second.return?.();
  }
});

test('OpenAIProvider waits for timed-out stream cleanup before releasing capacity', async () => {
  let createCalls = 0;
  let sdkSignal: AbortSignal | undefined;
  let markReturnStarted!: () => void;
  let releaseCleanup!: () => void;
  const returnStarted = new Promise<void>((resolve) => { markReturnStarted = resolve; });
  const cleanupReleased = new Promise<void>((resolve) => { releaseCleanup = resolve; });
  const responseClient = {
    responses: {
      create: async (_body: unknown, options?: { signal?: AbortSignal }) => {
        createCalls += 1;
        if (createCalls > 1) return fakeResponseStream();
        sdkSignal = options?.signal;
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => new Promise<never>(() => undefined),
              return: async () => {
                markReturnStarted();
                await cleanupReleased;
                return { done: true as const, value: undefined };
              },
            };
          },
        };
      },
    },
  };
  const firstProvider = new OpenAIProvider(responseClient, {
    embeddings: { create: async () => ({ data: [] }) },
  }, {
    ...providerConfig,
    providerConcurrency: 1,
    firstByteTimeoutMs: 10,
    totalTimeoutMs: 500,
  });
  const secondProvider = new OpenAIProvider(responseClient, {
    embeddings: { create: async () => ({ data: [] }) },
  }, {
    ...providerConfig,
    providerConcurrency: 1,
    firstByteTimeoutMs: 10,
    totalTimeoutMs: 500,
  });
  const request = {
    instructions: 'Use evidence only.',
    messages: [{ role: 'user' as const, content: 'Hello' }],
  };
  const first = firstProvider.streamAnswer(request)[Symbol.asyncIterator]();
  const firstEvent = first.next();
  void firstEvent.catch(() => undefined);
  await returnStarted;
  const second = secondProvider.streamAnswer(request)[Symbol.asyncIterator]();
  const secondEvent = second.next();

  try {
    const prematureOutcome = await Promise.race([
      firstEvent.then(
        () => 'first-settled',
        () => 'first-settled',
      ),
      secondEvent.then(
        () => 'second-started',
        () => 'second-started',
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('cleanup-pending'), 30);
      }),
    ]);
    assert.equal(sdkSignal?.aborted, true);
    assert.equal(prematureOutcome, 'cleanup-pending');
    assert.equal(createCalls, 1);

    releaseCleanup();
    await assert.rejects(firstEvent, (error: unknown) => (
      (error as { code?: string }).code === 'PROVIDER_FIRST_BYTE_TIMEOUT'
    ));
    assert.equal((await guard(secondEvent)).value.type, 'delta');
  } finally {
    releaseCleanup();
    await firstEvent.catch(() => undefined);
    await second.return?.();
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

async function assertNeverSettlingCleanupIsBounded(
  timeoutKind: 'first-byte' | 'total',
): Promise<void> {
  let createCalls = 0;
  let sdkSignal: AbortSignal | undefined;
  let nextCalls = 0;
  const responseClient = {
    responses: {
      create: async (_body: unknown, options?: { signal?: AbortSignal }) => {
        createCalls += 1;
        if (createCalls > 1) return fakeResponseStream();
        sdkSignal = options?.signal;
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                nextCalls += 1;
                if (timeoutKind === 'total' && nextCalls === 1) {
                  return {
                    done: false as const,
                    value: { type: 'response.output_text.delta' as const, delta: 'Partial' },
                  };
                }
                return new Promise<never>(() => undefined);
              },
              return: async () => new Promise<never>(() => undefined),
            };
          },
        };
      },
    },
  };
  const config = {
    ...providerConfig,
    providerConcurrency: 1,
    firstByteTimeoutMs: timeoutKind === 'first-byte' ? 10 : 100,
    totalTimeoutMs: timeoutKind === 'total' ? 20 : 500,
  };
  const firstProvider = new OpenAIProvider(responseClient, {
    embeddings: { create: async () => ({ data: [] }) },
  }, config);
  const secondProvider = new OpenAIProvider(responseClient, {
    embeddings: { create: async () => ({ data: [] }) },
  }, config);
  const request = {
    instructions: 'Use evidence only.',
    messages: [{ role: 'user' as const, content: 'Hello' }],
  };
  const first = firstProvider.streamAnswer(request)[Symbol.asyncIterator]();
  if (timeoutKind === 'total') {
    assert.equal((await first.next()).value.type, 'delta');
  }
  const terminal = first.next();
  void terminal.catch(() => undefined);

  await assert.rejects(guard(terminal, 400), (error: unknown) => (
    (error as { code?: string }).code === (
      timeoutKind === 'first-byte'
        ? 'PROVIDER_FIRST_BYTE_TIMEOUT'
        : 'PROVIDER_TOTAL_TIMEOUT'
    )
  ));
  assert.equal(sdkSignal?.aborted, true);

  const second = secondProvider.streamAnswer(request)[Symbol.asyncIterator]();
  assert.equal((await guard(second.next(), 200)).value.type, 'delta');
  assert.equal(createCalls, 2);
  await second.return?.();
}

test('OpenAIProvider bounds never-settling cleanup after first-byte timeout', async () => {
  await assertNeverSettlingCleanupIsBounded('first-byte');
});

test('OpenAIProvider bounds never-settling cleanup after total timeout', async () => {
  await assertNeverSettlingCleanupIsBounded('total');
});
