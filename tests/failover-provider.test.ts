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
