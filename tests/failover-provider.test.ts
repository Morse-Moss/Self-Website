import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  AiProvider,
  AnswerEvent,
  AnswerRequest,
  ProviderAnswerTarget,
} from '../lib/server/ai-provider.ts';
import { FailoverAiProvider } from '../lib/server/failover-ai-provider.ts';
import { OpenAIProviderError } from '../lib/server/openai-provider.ts';
import { ProviderHealthRegistry } from '../lib/server/provider-health.ts';

const request: AnswerRequest = {
  instructions: 'Use evidence only.',
  messages: [{ role: 'user', content: 'Hello' }],
};

class FakeProvider implements AiProvider {
  private readonly events: AnswerEvent[];
  private readonly error: Error | null;

  constructor(
    events: AnswerEvent[],
    error: Error | null = null,
  ) {
    this.events = events;
    this.error = error;
  }

  async embed(): Promise<number[][]> {
    return [[0.1, 0.2]];
  }

  async *streamAnswer(): AsyncIterable<AnswerEvent> {
    for (const event of this.events) yield event;
    if (this.error) throw this.error;
  }
}

async function collect(provider: AiProvider): Promise<AnswerEvent[]> {
  const events: AnswerEvent[] = [];
  for await (const event of provider.streamAnswer(request)) events.push(event);
  return events;
}

function target(provider: AiProvider, position: number): ProviderAnswerTarget {
  return {
    provider,
    snapshot: {
      configDigest: String(position).repeat(64),
      connectionDisplayName: `Connection ${position}`,
      connectionVersionId: null,
      inputUsdPerMillion: position === 0 ? '1' : null,
      modelDisplayName: `Model ${position}`,
      modelId: `model-${position}`,
      modelVersionId: null,
      outputUsdPerMillion: position === 0 ? '2' : null,
      position,
      protocol: 'responses',
      routeRevisionId: null,
      sourceType: 'environment',
    },
  };
}

test('FailoverAiProvider records six ordered attempts and freezes the winner snapshot', async () => {
  const providers = Array.from({ length: 6 }, (_, position) => (
    position < 5
      ? new FakeProvider([], new OpenAIProviderError(
        'PROVIDER_RESPONSE_INCOMPLETE',
        { inputTokens: position + 1, outputTokens: 1 },
      ))
      : new FakeProvider([
        { type: 'delta', text: 'Recovered' },
        { type: 'done', usage: { inputTokens: 20, outputTokens: 4 } },
      ])
  ));
  const provider = new FailoverAiProvider(
    providers[0],
    providers.map(target),
    1_000,
  );

  const events = await collect(provider);
  assert.deepEqual(events.map((event) => event.type), [
    'attempt', 'attempt', 'attempt', 'attempt', 'attempt',
    'delta', 'attempt', 'done',
  ]);
  const attempts = events.filter((event) => event.type === 'attempt').map((event) => event.attempt);
  assert.deepEqual(attempts.map((attempt) => attempt.attemptIndex), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(attempts.map((attempt) => attempt.status), [
    'failed', 'failed', 'failed', 'failed', 'failed', 'completed',
  ]);
  assert.equal(attempts[0].knownCostUsd, 0.000003);
  assert.equal(attempts[1].costComplete, false);
  const done = events.at(-1);
  assert.equal(done?.type, 'done');
  if (done?.type !== 'done') throw new Error('missing done event');
  assert.equal(done.winner?.attemptIndex, 5);
  assert.equal(done.winner?.modelId, 'model-5');
  assert.deepEqual(done.usage, { inputTokens: 35, outputTokens: 9 });
  assert.equal(done.usageComplete, true);
  assert.equal(done.costComplete, false);
});

test('FailoverAiProvider moves to the next node only before output starts', async () => {
  const primary = new FakeProvider([], new OpenAIProviderError(
    'PROVIDER_RESPONSE_INCOMPLETE',
    { inputTokens: 10, outputTokens: 2 },
  ));
  const fallback = new FakeProvider([
    { type: 'delta', text: 'Hello' },
    { type: 'done', usage: { inputTokens: 20, outputTokens: 4 } },
  ]);
  const provider = new FailoverAiProvider(primary, [primary, fallback], 1_000);

  const events = await collect(provider);
  assert.deepEqual(events.map((event) => event.type), ['attempt', 'delta', 'attempt', 'done']);
  const done = events.at(-1);
  assert.equal(done?.type, 'done');
  if (done?.type !== 'done') throw new Error('missing done event');
  assert.deepEqual(done.usage, { inputTokens: 30, outputTokens: 6 });
  assert.equal(done.winner?.attemptIndex, 1);
});

test('FailoverAiProvider tries three configured nodes in order', async () => {
  const calls: string[] = [];
  const providerFor = (
    name: string,
    events: AnswerEvent[],
    error: Error | null = null,
  ): AiProvider => ({
    async embed() {
      return [[0.1, 0.2]];
    },
    async *streamAnswer() {
      calls.push(name);
      for (const event of events) yield event;
      if (error) throw error;
    },
  });
  const primary = providerFor('primary', [], new OpenAIProviderError('PROVIDER_UNAVAILABLE'));
  const fallbackOne = providerFor(
    'fallback-1',
    [],
    new OpenAIProviderError('PROVIDER_RESPONSE_INCOMPLETE'),
  );
  const fallbackTwo = providerFor('fallback-2', [
    { type: 'delta', text: 'Recovered' },
    { type: 'done', usage: null },
  ]);
  const provider = new FailoverAiProvider(
    primary,
    [primary, fallbackOne, fallbackTwo],
    1_000,
  );

  const events = await collect(provider);
  assert.deepEqual(events.map((event) => event.type), [
    'attempt', 'attempt', 'delta', 'attempt', 'done',
  ]);
  const done = events.at(-1);
  assert.equal(done?.type, 'done');
  if (done?.type !== 'done') throw new Error('missing done event');
  assert.equal(done.winner?.attemptIndex, 2);
  assert.equal(done.usage, null);
  assert.deepEqual(calls, ['primary', 'fallback-1', 'fallback-2']);
});

test('FailoverAiProvider never switches nodes after partial output', async () => {
  const primaryError = new OpenAIProviderError('PROVIDER_STREAM_FAILED');
  const primary = new FakeProvider([{ type: 'delta', text: 'Partial' }], primaryError);
  const fallback = new FakeProvider([
    { type: 'delta', text: 'Duplicate' },
    { type: 'done', usage: null },
  ]);
  const provider = new FailoverAiProvider(primary, [primary, fallback], 1_000);
  const events: AnswerEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of provider.streamAnswer(request)) events.push(event);
  }, (error: unknown) => (
    (error as { name?: string; code?: string }).name === 'ProviderRunError'
    && (error as { code?: string }).code === primaryError.code
  ));
  assert.deepEqual(events.map((event) => event.type), ['delta', 'attempt']);
});

test('FailoverAiProvider uses the primary provider for embeddings and stops on abort', async () => {
  const primary = new FakeProvider([], new OpenAIProviderError('PROVIDER_UNAVAILABLE'));
  const fallback = new FakeProvider([{ type: 'done', usage: null }]);
  const provider = new FailoverAiProvider(primary, [primary, fallback], 1_000);
  assert.deepEqual(await provider.embed(['hello']), [[0.1, 0.2]]);

  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await assert.rejects(async () => {
    for await (const _event of provider.streamAnswer(request, controller.signal)) {
      // no-op
    }
  }, /stop/);
});

test('FailoverAiProvider does not invoke a fallback when the caller aborts during a node failure', async () => {
  const controller = new AbortController();
  const stopReason = new Error('caller stopped');
  let fallbackCalls = 0;
  const primary: AiProvider = {
    async embed() {
      return [[0.1, 0.2]];
    },
    async *streamAnswer() {
      controller.abort(stopReason);
      throw new OpenAIProviderError('PROVIDER_UNAVAILABLE');
    },
  };
  const fallback: AiProvider = {
    async embed() {
      return [[0.1, 0.2]];
    },
    async *streamAnswer() {
      fallbackCalls += 1;
      yield { type: 'done', usage: null };
    },
  };
  const provider = new FailoverAiProvider(primary, [primary, fallback], 1_000);

  await assert.rejects(async () => {
    for await (const _event of provider.streamAnswer(request, controller.signal)) {
      // no-op
    }
  }, stopReason);
  assert.equal(fallbackCalls, 0);
});

test('FailoverAiProvider enforces one shared timeout across all nodes', async () => {
  let fallbackCalls = 0;
  const primary: AiProvider = {
    async embed() {
      return [[0.1, 0.2]];
    },
    async *streamAnswer(_request, signal) {
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  };
  const fallback: AiProvider = {
    async embed() {
      return [[0.1, 0.2]];
    },
    async *streamAnswer() {
      fallbackCalls += 1;
      yield { type: 'done', usage: null };
    },
  };
  const provider = new FailoverAiProvider(primary, [primary, fallback], 15);

  await assert.rejects(async () => {
    for await (const _event of provider.streamAnswer(request)) {
      // no-op
    }
  }, (error: unknown) => (
    (error as { code?: string }).code === 'PROVIDER_TOTAL_TIMEOUT'
  ));
  assert.equal(fallbackCalls, 0);
});

function delayedProvider(input: {
  delayMs: number;
  error?: Error;
  events?: AnswerEvent[];
  onFinish?: () => void;
  onStart?: () => void;
}): AiProvider {
  return {
    async embed() {
      return [[0.1, 0.2]];
    },
    async *streamAnswer(_request, signal) {
      input.onStart?.();
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, input.delayMs);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason);
          }, { once: true });
        });
        for (const event of input.events ?? []) yield event;
        if (input.error) throw input.error;
      } finally {
        input.onFinish?.();
      }
    },
  };
}

function guard<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('test guard timeout')), timeoutMs);
    }),
  ]);
}

function v2Request(overrides: Partial<NonNullable<AnswerRequest['execution']>> = {}): AnswerRequest {
  let executionEvents: unknown[] = [];
  return {
    ...request,
    execution: {
      executionId: '11111111-1111-4111-8111-111111111111',
      releasePolicy: 'segment',
      minimumBufferCharacters: 1,
      totalTimeoutMs: 500,
      hedgingEnabled: true,
      delaysMs: [0, 8, 14],
      acceptCandidate: () => true,
      reserveHedgedAttempt: async (event) => {
        executionEvents.push(event);
        return true;
      },
      onAttempt: async (event) => { executionEvents.push(event); },
      ...overrides,
    },
  };
}

test('a completed primary returns done without waiting for an unstarted hedge', async () => {
  let fallbackStarted = false;
  const primary = delayedProvider({
    delayMs: 0,
    events: [
      { type: 'delta', text: 'Primary.' },
      { type: 'done', usage: { inputTokens: 7, outputTokens: 2 } },
    ],
  });
  const fallback = delayedProvider({
    delayMs: 0,
    events: [{ type: 'done', usage: null }],
    onStart: () => { fallbackStarted = true; },
  });
  const provider = new FailoverAiProvider(primary, [
    { alias: 'primary', provider: primary },
    { alias: 'fallback-1', provider: fallback },
  ], 1_000);

  const events = await guard((async () => {
    const collected: AnswerEvent[] = [];
    for await (const event of provider.streamAnswer(v2Request({
      totalTimeoutMs: 250,
      delaysMs: [0, 1_000],
    }))) collected.push(event);
    return collected;
  })(), 50);

  assert.equal(fallbackStarted, false);
  assert.deepEqual(events, [
    { type: 'delta', text: 'Primary.' },
    {
      type: 'done',
      usage: { inputTokens: 7, outputTokens: 2 },
      providerAlias: 'primary',
    },
  ]);
});

test('a segment winner propagates a later stream failure instead of emitting done', async () => {
  const streamFailure = new OpenAIProviderError('PROVIDER_STREAM_FAILED');
  let fallbackStarted = false;
  const primary = delayedProvider({
    delayMs: 0,
    events: [{ type: 'delta', text: 'Visible segment.' }],
    error: streamFailure,
  });
  const fallback = delayedProvider({
    delayMs: 0,
    events: [{ type: 'done', usage: null }],
    onStart: () => { fallbackStarted = true; },
  });
  const provider = new FailoverAiProvider(primary, [
    { alias: 'primary', provider: primary },
    { alias: 'fallback-1', provider: fallback },
  ], 1_000);
  const events: AnswerEvent[] = [];

  await assert.rejects(async () => {
    for await (const event of provider.streamAnswer(v2Request({
      totalTimeoutMs: 250,
      delaysMs: [0, 1_000],
    }))) events.push(event);
  }, streamFailure);

  assert.equal(fallbackStarted, false);
  assert.deepEqual(events, [{ type: 'delta', text: 'Visible segment.' }]);
});

test('hedging never has more than two nodes in flight and starts node three after one exits', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const started: string[] = [];
  const track = (alias: string) => ({
    onStart: () => {
      started.push(alias);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
    },
    onFinish: () => { inFlight -= 1; },
  });
  const primary = delayedProvider({
    delayMs: 150,
    events: [{ type: 'delta', text: 'Primary.' }, { type: 'done', usage: null }],
    ...track('primary'),
  });
  const fallbackOne = delayedProvider({
    delayMs: 4,
    error: new OpenAIProviderError('PROVIDER_UNAVAILABLE'),
    ...track('fallback-1'),
  });
  const fallbackTwo = delayedProvider({
    delayMs: 4,
    events: [
      { type: 'delta', text: 'Recovered.' },
      { type: 'done', usage: { inputTokens: 12, outputTokens: 3 } },
    ],
    ...track('fallback-2'),
  });
  const provider = new FailoverAiProvider(primary, [
    { alias: 'primary', provider: primary },
    { alias: 'fallback-1', provider: fallbackOne },
    { alias: 'fallback-2', provider: fallbackTwo },
  ], 1_000);

  const events: AnswerEvent[] = [];
  for await (const event of provider.streamAnswer(v2Request())) events.push(event);

  assert.deepEqual(started, ['primary', 'fallback-1', 'fallback-2']);
  assert.equal(maxInFlight, 2);
  assert.equal(events.filter((event) => event.type === 'delta').map((event) => event.text).join(''), 'Recovered.');
  const done = events.at(-1);
  assert.equal(done?.type, 'done');
  if (done?.type !== 'done') throw new Error('missing done event');
  assert.deepEqual(done.usage, { inputTokens: 12, outputTokens: 3 });
  assert.equal(done.providerAlias, 'fallback-2');
  assert.equal(done.winner?.attemptIndex, 2);
  assert.deepEqual(
    done.attempts?.map((attempt) => [attempt.attemptIndex, attempt.status]),
    [[1, 'failed'], [0, 'stopped'], [2, 'completed']],
  );
});

test('complete release never exposes a rejected recruitment candidate', async () => {
  const primary = delayedProvider({
    delayMs: 1,
    events: [
      { type: 'delta', text: '缺口清单。' },
      { type: 'done', usage: { inputTokens: 5, outputTokens: 2 } },
    ],
  });
  const fallback = delayedProvider({
    delayMs: 3,
    events: [
      { type: 'delta', text: '证据型回答。' },
      { type: 'done', usage: { inputTokens: 8, outputTokens: 3 } },
    ],
  });
  const provider = new FailoverAiProvider(primary, [
    { alias: 'primary', provider: primary },
    { alias: 'fallback-1', provider: fallback },
  ], 1_000);
  const events: AnswerEvent[] = [];

  for await (const event of provider.streamAnswer(v2Request({
    delaysMs: [0, 0],
    releasePolicy: 'complete',
    acceptCandidate: (text) => !text.includes('缺口清单'),
  }))) events.push(event);

  const text = events.filter((event) => event.type === 'delta').map((event) => event.text).join('');
  assert.equal(text, '证据型回答。');
  assert.doesNotMatch(text, /缺口清单/u);
});

test('a rejected hedge budget waits for failure and records a serial failover start', async () => {
  const launchKinds: string[] = [];
  let reserveCalls = 0;
  const primary = delayedProvider({
    delayMs: 15,
    error: new OpenAIProviderError('PROVIDER_UNAVAILABLE'),
  });
  const fallback = delayedProvider({
    delayMs: 1,
    events: [{ type: 'delta', text: 'Serial.' }, { type: 'done', usage: null }],
  });
  const provider = new FailoverAiProvider(primary, [
    { alias: 'primary', provider: primary },
    { alias: 'fallback-1', provider: fallback },
  ], 1_000);

  const events: AnswerEvent[] = [];
  for await (const event of provider.streamAnswer(v2Request({
    delaysMs: [0, 1],
    reserveHedgedAttempt: async () => {
      reserveCalls += 1;
      return false;
    },
    onAttempt: async (event) => {
      if (event.type === 'started') launchKinds.push(event.launchKind);
    },
  }))) events.push(event);

  assert.deepEqual(launchKinds, ['primary', 'failover']);
  assert.equal(reserveCalls, 1);
  assert.equal(events.filter((event) => event.type === 'delta').map((event) => event.text).join(''), 'Serial.');
});

test('coordinated execution records caller abort and never starts a fallback', async () => {
  const controller = new AbortController();
  const reason = new Error('caller stopped');
  const terminalTypes: string[] = [];
  const primary = delayedProvider({ delayMs: 100, events: [] });
  const fallback = delayedProvider({ delayMs: 1, events: [{ type: 'done', usage: null }] });
  const provider = new FailoverAiProvider(primary, [
    { alias: 'primary', provider: primary },
    { alias: 'fallback-1', provider: fallback },
  ], 1_000);
  setTimeout(() => controller.abort(reason), 5);

  await assert.rejects(async () => {
    for await (const _event of provider.streamAnswer(v2Request({
      delaysMs: [0, 50],
      onAttempt: async (event) => {
        if (event.type === 'aborted' || event.type === 'failed') terminalTypes.push(event.type);
      },
    }), controller.signal)) {
      // no-op
    }
  }, reason);
  assert.deepEqual(terminalTypes, ['aborted']);
});

test('coordinated total timeout stops a node that ignores its signal', async () => {
  const stuck: AiProvider = {
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer() { await new Promise<never>(() => undefined); },
  };
  const provider = new FailoverAiProvider(stuck, [{ alias: 'primary', provider: stuck }], 1_000);

  await assert.rejects(guard((async () => {
    for await (const _event of provider.streamAnswer(v2Request({ totalTimeoutMs: 10 }))) {
      // no-op
    }
  })(), 200), (error: unknown) => (
    (error as { code?: string }).code === 'PROVIDER_TOTAL_TIMEOUT'
  ));
});

test('segment winner stops when a later semantic segment fails the guard', async () => {
  const primary: AiProvider = {
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer() {
      yield { type: 'delta', text: 'Good.' };
      yield { type: 'delta', text: ' Bad.' };
      yield { type: 'done', usage: null };
    },
  };
  const provider = new FailoverAiProvider(primary, [{ alias: 'primary', provider: primary }], 1_000);
  const visible: string[] = [];

  await assert.rejects(async () => {
    for await (const event of provider.streamAnswer(v2Request({
      hedgingEnabled: false,
      delaysMs: [0],
      acceptCandidate: (text) => !text.includes('Bad'),
    }))) {
      if (event.type === 'delta') visible.push(event.text);
    }
  }, (error: unknown) => (
    (error as { code?: string }).code === 'OUTPUT_GUARD_REJECTED'
  ));
  assert.deepEqual(visible, ['Good.']);
});

test('coordinator skips an open node', async () => {
  const health = new ProviderHealthRegistry({ failureThreshold: 1, openMs: 10 });
  let primaryCalls = 0;
  const primary: AiProvider = {
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer() {
      primaryCalls += 1;
      yield { type: 'delta', text: 'Primary.' };
      yield { type: 'done', usage: null };
    },
  };
  const fallback = delayedProvider({
    delayMs: 1,
    events: [{ type: 'delta', text: 'Fallback.' }, { type: 'done', usage: null }],
  });
  const provider = new FailoverAiProvider(primary, [
    { alias: 'primary', provider: primary },
    { alias: 'fallback-1', provider: fallback },
  ], 1_000, health);

  health.failure('primary', new Date());
  const first: AnswerEvent[] = [];
  for await (const event of provider.streamAnswer(v2Request({ delaysMs: [0, 0] }))) first.push(event);
  assert.equal(primaryCalls, 0);
  assert.equal(first.filter((event) => event.type === 'delta').map((event) => event.text).join(''), 'Fallback.');

});

test('coordinator closes a successful half-open probe', async () => {
  const health = new ProviderHealthRegistry({ failureThreshold: 1, openMs: 10 });
  let primaryCalls = 0;
  const primary: AiProvider = {
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer() {
      primaryCalls += 1;
      yield { type: 'delta', text: 'Primary.' };
      yield { type: 'done', usage: null };
    },
  };
  const provider = new FailoverAiProvider(
    primary,
    [{ alias: 'primary', provider: primary }],
    1_000,
    health,
  );
  health.failure('primary', new Date(Date.now() - 20));

  const events: AnswerEvent[] = [];
  for await (const event of provider.streamAnswer(v2Request({ delaysMs: [0] }))) events.push(event);

  assert.equal(primaryCalls, 1);
  assert.equal(events.filter((event) => event.type === 'delta').map((event) => event.text).join(''), 'Primary.');
  assert.equal(health.snapshot('primary', new Date()).state, 'closed');
});
