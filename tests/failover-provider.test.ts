import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AnswerExecutionError,
  type AiProvider,
  type AnswerEvent,
  type AnswerRequest,
  type PreparedTargetAnswer,
  type ProviderAnswerTarget,
  ProviderRunError,
} from '../lib/server/ai-provider.ts';
import { createChatExecutionBudget } from '../lib/server/chat-execution-budget.ts';
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
      configDigestVersion: 2,
      connectionDisplayName: `Connection ${position}`,
      connectionVersionId: null,
      contextWindowTokens: null,
      inputUsdPerMillion: position === 0 ? '1' : null,
      modelDisplayName: `Model ${position}`,
      modelId: `model-${position}`,
      modelVersionId: null,
      maxOutputTokens: null,
      outputUsdPerMillion: position === 0 ? '2' : null,
      position,
      protocol: 'responses',
      reasoningEffort: null,
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
  const now = Date.now();
  return {
    ...request,
    execution: {
      executionId: '11111111-1111-4111-8111-111111111111',
      releasePolicy: 'segment',
      minimumBufferCharacters: 1,
      totalTimeoutMs: 500,
      budget: createChatExecutionBudget({
        turnStartedAtMs: now,
        providerStartedAtMs: now,
        turnTimeoutMs: 90_000,
        providerTimeoutMs: 80_000,
      }),
      generationMode: 'normal',
      protocolEventTimeoutMs: 25,
      modelTextTimeoutMs: 40,
      hedgingEnabled: true,
      delaysMs: [0, 8, 14],
      reserveHedgedAttempt: async (event) => {
        executionEvents.push(event);
        return true;
      },
      onAttempt: async (event) => { executionEvents.push(event); },
      ...overrides,
    },
  };
}

function preparedTargetAnswer(
  targetSnapshot: ProviderAnswerTarget['snapshot'],
  revision: number,
  trigger: PreparedTargetAnswer['context']['variant']['trigger'],
): PreparedTargetAnswer {
  const targetBinding = {
    configDigestVersion: targetSnapshot.configDigestVersion,
    configDigest: targetSnapshot.configDigest,
    modelId: targetSnapshot.modelId,
    protocol: targetSnapshot.protocol,
    contextWindowTokens: targetSnapshot.contextWindowTokens,
    maxOutputTokens: targetSnapshot.maxOutputTokens,
    reasoningEffort: targetSnapshot.reasoningEffort,
  };
  const variant = {
    id: '22222222-2222-4222-8222-222222222222',
    revision,
    trigger,
    target: targetBinding,
  };
  const outboundBody = Object.freeze({ model: targetSnapshot.modelId, revision });
  const preparedRequest = {
    ...request,
    messages: [{ role: 'user' as const, content: `variant-${revision}` }],
  };
  const digest = revision.toString(16).repeat(64);
  return {
    context: {
      variant,
      target: targetBinding,
      historyView: {
        rawHistory: [],
        summary: null,
        consumedTurnIds: [],
        compactionArtifactIds: [],
      },
      packet: {} as never,
      packetHmacKeyId: '2026-07-v2',
      packetHmacSha256: digest,
      summaryAttemptIds: [],
    },
    request: preparedRequest,
    outboundBody,
    generationRequest: {
      schemaVersion: 'generation-request-v2',
      variant,
      packetHmacKeyId: '2026-07-v2',
      packetHmacSha256: digest,
      instructions: preparedRequest.instructions,
      messages: preparedRequest.messages,
      reasoningEffort: null,
      maxOutputTokens: null,
      outboundBody,
      store: false,
    },
    integrity: {
      version: 2,
      contextBuilderVersion: 'context-packet-builder-v2',
      generationVariantId: variant.id,
      generationVariantRevision: revision,
      target: targetBinding,
      packetHmacKeyId: '2026-07-v2',
      packetHmacSha256: digest,
      generationRequestHmacSha256: digest,
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
  const attemptEvents = events.filter(
    (event): event is Extract<AnswerEvent, { type: 'attempt' }> => event.type === 'attempt',
  );
  assert.equal(attemptEvents.length, 1);
  assert.equal(attemptEvents[0].attempt.status, 'completed');
  const publicEvents = events.filter((event) => event.type !== 'attempt');
  assert.equal(publicEvents.length, 2);
  assert.deepEqual(publicEvents[0], { type: 'delta', text: 'Primary.' });
  assert.equal(publicEvents[1]?.type, 'done');
  if (publicEvents[1]?.type !== 'done') throw new Error('done event is missing');
  assert.deepEqual({
    type: publicEvents[1].type,
    usage: publicEvents[1].usage,
    providerAlias: publicEvents[1].providerAlias,
  }, {
    type: 'done',
    usage: { inputTokens: 7, outputTokens: 2 },
    providerAlias: 'primary',
  });
});

test('private partial text stays hidden when the fallback is also incomplete', async () => {
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
  }, (error: unknown) => error instanceof ProviderRunError);

  assert.equal(fallbackStarted, true);
  assert.equal(events.filter((event) => event.type === 'delta').length, 0);
  const attempts = events.filter(
    (event): event is Extract<AnswerEvent, { type: 'attempt' }> => event.type === 'attempt',
  );
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].attempt.status, 'failed');
  assert.equal(attempts[0].attempt.errorCode, 'PROVIDER_STREAM_FAILED');
});

test('coordinated execution discards private partial text and fails over before public release', async () => {
  let fallbackStarted = false;
  const primary = delayedProvider({
    delayMs: 0,
    events: [{ type: 'delta', text: 'PRIVATE_PARTIAL.' }],
    error: new OpenAIProviderError('PROVIDER_STREAM_FAILED'),
  });
  const fallback = delayedProvider({
    delayMs: 0,
    events: [
      { type: 'delta', text: 'Recovered answer.' },
      { type: 'done', usage: { inputTokens: 8, outputTokens: 2 } },
    ],
    onStart: () => { fallbackStarted = true; },
  });
  const provider = new FailoverAiProvider(primary, [
    { alias: 'primary', provider: primary },
    { alias: 'fallback-1', provider: fallback },
  ], 1_000);
  const events: AnswerEvent[] = [];

  for await (const event of provider.streamAnswer(v2Request())) events.push(event);

  assert.equal(fallbackStarted, true);
  const visible = events
    .filter((event) => event.type === 'delta')
    .map((event) => event.text)
    .join('');
  assert.equal(visible, 'Recovered answer.');
  assert.doesNotMatch(visible, /PRIVATE_PARTIAL/u);
  assert.deepEqual(
    events.filter((event) => event.type === 'attempt').map((event) => event.attempt.status),
    ['failed', 'completed'],
  );
});

test('coordinated execution allows one numeric overflow retry within seven global attempts', async () => {
  const providerCalls = Array.from({ length: 6 }, () => 0);
  const providers = providerCalls.map((_calls, position): AiProvider => ({
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer() {
      providerCalls[position] += 1;
      if (position === 0 && providerCalls[position] === 1) {
        throw new OpenAIProviderError('PROVIDER_RESPONSE_FAILED', null, {
          category: 'context_overflow',
          reason: 'context_length_exceeded',
          httpStatus: 400,
          inputTokens: 4_096,
          outputTokens: 0,
          contextWindowTokens: 4_096,
        });
      }
      throw new OpenAIProviderError('PROVIDER_UNAVAILABLE');
    },
  }));
  const routeTargets = providers.map(target);
  const provider = new FailoverAiProvider(providers[0], routeTargets, 1_000);
  const preparedRevisions: Array<[number, number, string]> = [];
  const startedIntegrityRevisions: number[] = [];
  const events: AnswerEvent[] = [];
  let failure: unknown;

  try {
    for await (const event of provider.streamAnswer(v2Request({
      onAttempt: async (event) => {
        if (event.type !== 'started' || !('integrity' in event) || !event.integrity) return;
        if ('version' in event.integrity) {
          startedIntegrityRevisions.push(event.integrity.generationVariantRevision);
        }
      },
      prepareTarget: async ({ target: targetSnapshot, revision, trigger }) => {
        preparedRevisions.push([targetSnapshot.position, revision, trigger]);
        return preparedTargetAnswer(
          targetSnapshot,
          revision,
          trigger,
        );
      },
    }))) events.push(event);
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof ProviderRunError);
  assert.equal(events.some((event) => event.type === 'delta'), false);
  assert.deepEqual(providerCalls, [2, 1, 1, 1, 1, 1]);
  assert.deepEqual(preparedRevisions, [
    [0, 1, 'initial'],
    [0, 2, 'provider_numeric_overflow'],
    [1, 3, 'initial'],
    [2, 4, 'initial'],
    [3, 5, 'initial'],
    [4, 6, 'initial'],
    [5, 7, 'initial'],
  ]);
  assert.deepEqual(startedIntegrityRevisions, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(failure.attempts.map((attempt) => attempt.attemptIndex), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(
    failure.attempts.map((attempt) => (
      attempt.integrity && 'version' in attempt.integrity
        ? attempt.integrity.generationVariantRevision
        : null
    )),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.deepEqual(
    failure.attempts.map((attempt) => attempt.generationVariantTrigger),
    ['initial', 'provider_numeric_overflow', 'initial', 'initial', 'initial', 'initial', 'initial'],
  );
  assert.equal(failure.attempts[0].failure?.category, 'context_overflow');
  assert.deepEqual(
    failure.attempts.map((attempt) => [attempt.position, attempt.launchKind]),
    [
      [0, 'primary'],
      [0, 'overflow_retry'],
      [1, 'failover'],
      [2, 'failover'],
      [3, 'failover'],
      [4, 'failover'],
      [5, 'failover'],
    ],
  );
});

test('target preparation failures advance revisions without consuming answer attempts', async () => {
  let firstProviderCalls = 0;
  let secondProviderCalls = 0;
  let secondPreparedBody: Readonly<Record<string, unknown>> | null = null;
  let exactPreparedBodySent = false;
  const first: AiProvider = {
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer() { firstProviderCalls += 1; },
  };
  const second: AiProvider = {
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer(answerRequest) {
      secondProviderCalls += 1;
      exactPreparedBodySent = answerRequest.preparedOutboundBody === secondPreparedBody;
      yield { type: 'delta', text: 'Prepared fallback.' };
      yield { type: 'done', usage: null };
    },
  };
  const routeTargets = [target(first, 0), target(second, 1)];
  const provider = new FailoverAiProvider(first, routeTargets, 1_000);
  const revisions: Array<[number, number]> = [];
  const budget = createChatExecutionBudget({
    turnStartedAtMs: Date.now(),
    providerStartedAtMs: Date.now(),
    turnTimeoutMs: 90_000,
    providerTimeoutMs: 80_000,
  });
  const events: AnswerEvent[] = [];

  for await (const event of provider.streamAnswer(v2Request({
    budget,
    prepareTarget: async ({ target: targetSnapshot, revision, trigger }) => {
      revisions.push([targetSnapshot.position, revision]);
      if (targetSnapshot.position === 0) {
        throw Object.assign(new Error('private summary failure'), {
          code: 'CONTEXT_SUMMARY_FAILED',
        });
      }
      const prepared = preparedTargetAnswer(targetSnapshot, revision, trigger);
      secondPreparedBody = prepared.outboundBody;
      return prepared;
    },
  }))) events.push(event);

  assert.deepEqual(revisions, [[0, 1], [1, 2]]);
  assert.equal(firstProviderCalls, 0);
  assert.equal(secondProviderCalls, 1);
  assert.equal(exactPreparedBodySent, true);
  assert.equal(budget.remainingAttempts(), 6);
  const attempts = events.filter((event) => event.type === 'attempt');
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].attempt.attemptIndex, 0);
  assert.equal(attempts[0].attempt.position, 1);
});

test('cancelled target preparation terminates without starting that target or a fallback', async () => {
  const calls = [0, 0];
  const providers = calls.map((_value, position): AiProvider => ({
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer() { calls[position] += 1; },
  }));
  const provider = new FailoverAiProvider(
    providers[0],
    providers.map(target),
    1_000,
  );
  let preparationCalls = 0;

  await assert.rejects(async () => {
    for await (const _event of provider.streamAnswer(v2Request({
      prepareTarget: async () => {
        preparationCalls += 1;
        throw Object.assign(new Error('private cancellation'), {
          code: 'CONTEXT_SUMMARY_CANCELLED',
        });
      },
    }))) {
      // consume the stream
    }
  }, (error: unknown) => (
    (error as { code?: string }).code === 'CONTEXT_SUMMARY_CANCELLED'
  ));
  assert.equal(preparationCalls, 1);
  assert.deepEqual(calls, [0, 0]);
});

test('output truncation skips same-target retry and may complete on an unused fallback', async () => {
  const calls = [0, 0];
  const truncated: AiProvider = {
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer() {
      calls[0] += 1;
      throw new OpenAIProviderError('PROVIDER_RESPONSE_INCOMPLETE', null, {
        category: 'output_truncated',
        reason: 'length',
        httpStatus: 200,
        inputTokens: 3_000,
        outputTokens: 1_000,
        contextWindowTokens: 8_192,
      });
    },
  };
  const fallback: AiProvider = {
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer() {
      calls[1] += 1;
      yield { type: 'delta', text: 'Complete fallback.' };
      yield { type: 'done', usage: null };
    },
  };
  const routeTargets = [target(truncated, 0), target(fallback, 1)];
  const provider = new FailoverAiProvider(truncated, routeTargets, 1_000);
  const preparedTargets: number[] = [];
  const events: AnswerEvent[] = [];

  for await (const event of provider.streamAnswer(v2Request({
    prepareTarget: async ({ target: targetSnapshot, revision, trigger }) => {
      preparedTargets.push(targetSnapshot.position);
      return preparedTargetAnswer(targetSnapshot, revision, trigger);
    },
  }))) events.push(event);

  assert.deepEqual(calls, [1, 1]);
  assert.deepEqual(preparedTargets, [0, 1]);
  assert.equal(
    events.filter((event) => event.type === 'delta').map((event) => event.text).join(''),
    'Complete fallback.',
  );
  const attempts = events.filter((event) => event.type === 'attempt');
  assert.equal(attempts[0].attempt.failure?.category, 'output_truncated');
  assert.deepEqual(attempts.map((event) => event.attempt.launchKind), ['primary', 'failover']);
});

test('coordinated v2 execution stays serial and switches only after failure', async () => {
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
    delayMs: 15,
    error: new OpenAIProviderError('PROVIDER_UNAVAILABLE'),
    ...track('primary'),
  });
  const fallbackOne = delayedProvider({
    delayMs: 4,
    events: [
      { type: 'delta', text: 'Recovered.' },
      { type: 'done', usage: { inputTokens: 12, outputTokens: 3 } },
    ],
    ...track('fallback-1'),
  });
  let fallbackTwoStarted = false;
  const fallbackTwo = delayedProvider({
    delayMs: 4,
    events: [
      { type: 'delta', text: 'Must not run.' },
      { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
    ],
    onStart: () => { fallbackTwoStarted = true; },
  });
  const provider = new FailoverAiProvider(primary, [
    { alias: 'primary', provider: primary },
    { alias: 'fallback-1', provider: fallbackOne },
    { alias: 'fallback-2', provider: fallbackTwo },
  ], 1_000);

  const events: AnswerEvent[] = [];
  for await (const event of provider.streamAnswer(v2Request())) events.push(event);

  assert.deepEqual(started, ['primary', 'fallback-1']);
  assert.equal(fallbackTwoStarted, false);
  assert.equal(maxInFlight, 1);
  assert.equal(events.filter((event) => event.type === 'delta').map((event) => event.text).join(''), 'Recovered.');
  assert.equal(events.filter((event) => event.type === 'switching').length, 1);
  const done = events.at(-1);
  assert.equal(done?.type, 'done');
  if (done?.type !== 'done') throw new Error('missing done event');
  assert.deepEqual(done.usage, { inputTokens: 12, outputTokens: 3 });
  assert.equal(done.providerAlias, 'fallback-1');
  assert.equal(done.winner?.attemptIndex, 1);
  assert.deepEqual(
    done.attempts?.map((attempt) => [attempt.attemptIndex, attempt.status]),
    [[0, 'failed'], [1, 'completed']],
  );
});

test('terminal events price each node with its own immutable target rates', async () => {
  const primary = new FakeProvider([], new OpenAIProviderError(
    'PROVIDER_UNAVAILABLE',
    { inputTokens: 10, outputTokens: 2 },
  ));
  const fallback = new FakeProvider([
    { type: 'delta', text: 'Recovered.' },
    { type: 'done', usage: { inputTokens: 20, outputTokens: 4 } },
  ]);
  const primaryTarget = target(primary, 0);
  const fallbackTarget = target(fallback, 1);
  fallbackTarget.snapshot.inputUsdPerMillion = '3';
  fallbackTarget.snapshot.outputUsdPerMillion = '6';
  const provider = new FailoverAiProvider(primary, [primaryTarget, fallbackTarget], 1_000);
  const terminalEvents: Array<Record<string, unknown>> = [];

  for await (const _event of provider.streamAnswer(v2Request({
    onAttempt: async (event) => {
      if (event.type === 'completed' || event.type === 'failed' || event.type === 'aborted') {
        terminalEvents.push(event as unknown as Record<string, unknown>);
      }
    },
  }))) {
    // consume the stream
  }

  assert.deepEqual(
    terminalEvents.map((event) => event.estimatedCostUsd),
    [0.000014, 0.000084],
  );
});

test('serial execution does not consult the obsolete hedge reservation callback', async () => {
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
  assert.equal(reserveCalls, 0);
  assert.equal(events.filter((event) => event.type === 'delta').map((event) => event.text).join(''), 'Serial.');
});

test('no protocol activity switches serially at the protocol deadline', async () => {
  const started: string[] = [];
  const silent = delayedProvider({ delayMs: 100, events: [], onStart: () => started.push('primary') });
  const fallback = delayedProvider({
    delayMs: 1,
    events: [{ type: 'delta', text: 'Recovered.' }, { type: 'done', usage: null }],
    onStart: () => started.push('fallback-1'),
  });
  const provider = new FailoverAiProvider(silent, [
    { alias: 'primary', provider: silent },
    { alias: 'fallback-1', provider: fallback },
  ], 1_000);
  const events: AnswerEvent[] = [];

  for await (const event of provider.streamAnswer(v2Request({
    totalTimeoutMs: 200,
    protocolEventTimeoutMs: 15,
    modelTextTimeoutMs: 35,
  }))) events.push(event);

  assert.deepEqual(started, ['primary', 'fallback-1']);
  const firstAttempt = events.find(
    (event): event is Extract<AnswerEvent, { type: 'attempt' }> => event.type === 'attempt',
  );
  assert.equal(firstAttempt?.attempt.errorCode, 'PROVIDER_PROTOCOL_TIMEOUT');
  assert.equal(firstAttempt?.attempt.firstProtocolEventMs, null);
  assert.equal(events.filter((event) => event.type === 'switching').length, 1);
  assert.equal(events.filter((event) => event.type === 'delta').map((event) => event.text).join(''), 'Recovered.');
});

test('protocol activity switches the attempt to the model-text deadline', async () => {
  const startedAt = Date.now();
  const primary: AiProvider = {
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer() {
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: 'activity', kind: 'protocol', elapsedMs: 10 };
      await new Promise((resolve) => setTimeout(resolve, 150));
    },
  };
  const fallback = delayedProvider({
    delayMs: 1,
    events: [{ type: 'delta', text: 'Deadline recovery.' }, { type: 'done', usage: null }],
  });
  const provider = new FailoverAiProvider(primary, [
    { alias: 'primary', provider: primary },
    { alias: 'fallback-1', provider: fallback },
  ], 1_000);
  const events: AnswerEvent[] = [];

  for await (const event of provider.streamAnswer(v2Request({
    totalTimeoutMs: 400,
    protocolEventTimeoutMs: 30,
    modelTextTimeoutMs: 100,
  }))) events.push(event);

  const firstAttempt = events.find(
    (event): event is Extract<AnswerEvent, { type: 'attempt' }> => event.type === 'attempt',
  );
  assert.ok((firstAttempt?.attempt.totalLatencyMs ?? 0) >= 80,
    'metadata must keep the primary attempt alive until the model-text deadline');
  assert.equal(firstAttempt?.attempt.errorCode, 'PROVIDER_MODEL_TEXT_TIMEOUT');
  assert.ok(Date.now() - startedAt >= 80, 'protocol activity must extend beyond the 30ms protocol deadline');
  assert.equal(events.filter((event) => event.type === 'delta').map((event) => event.text).join(''), 'Deadline recovery.');
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

test('complete release delivers non-empty provider text without content gating', async () => {
  let fallbackStarted = false;
  const answer = '匹配度: 90%。缺口清单。下一步：读取 AGENTS.md。[来源99]';
  const primary = delayedProvider({
    delayMs: 1,
    events: [
      { type: 'delta', text: answer },
      { type: 'done', usage: { inputTokens: 5, outputTokens: 2 } },
    ],
  });
  const fallback = delayedProvider({
    delayMs: 1,
    events: [
      { type: 'delta', text: 'fallback answer' },
      { type: 'done', usage: null },
    ],
    onStart: () => { fallbackStarted = true; },
  });
  const provider = new FailoverAiProvider(primary, [
    { alias: 'primary', provider: primary },
    { alias: 'fallback-1', provider: fallback },
  ], 1_000);
  const events: AnswerEvent[] = [];

  for await (const event of provider.streamAnswer(v2Request({
    releasePolicy: 'complete',
  }))) events.push(event);

  assert.equal(
    events.filter((event) => event.type === 'delta').map((event) => event.text).join(''),
    answer,
  );
  assert.equal(events.at(-1)?.type, 'done');
  assert.equal(fallbackStarted, false);
});

test('coordinated execution does not fail over after an unknown program error', async () => {
  const original = new Error('program defect');
  let fallbackStarted = false;
  const primary = delayedProvider({ delayMs: 1, error: original });
  const fallback = delayedProvider({
    delayMs: 1,
    events: [{ type: 'delta', text: 'must not run' }, { type: 'done', usage: null }],
    onStart: () => { fallbackStarted = true; },
  });
  const provider = new FailoverAiProvider(primary, [primary, fallback], 1_000);

  await assert.rejects(async () => {
    for await (const _event of provider.streamAnswer(v2Request())) {
      // consume the stream
    }
  }, (error: unknown) => error === original);
  assert.equal(fallbackStarted, false);
});

test('segment release emits one complete answer only after terminal success', async () => {
  const primary: AiProvider = {
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer() {
      yield { type: 'delta', text: '第一句' };
      yield { type: 'delta', text: '。' };
      yield { type: 'delta', text: '最后一段没有标点' };
      yield { type: 'done', usage: null };
    },
  };
  const provider = new FailoverAiProvider(primary, [{ alias: 'primary', provider: primary }], 1_000);
  const visible: string[] = [];

  for await (const event of provider.streamAnswer(v2Request())) {
    if (event.type === 'delta') visible.push(event.text);
  }

  assert.deepEqual(visible, ['第一句。最后一段没有标点']);
});

test('segment release keeps a fenced code block hidden until the closing fence arrives', async () => {
  const primary: AiProvider = {
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer() {
      yield { type: 'delta', text: '示例：\n```ts\n' };
      yield { type: 'delta', text: 'const answer = 42;\n' };
      yield { type: 'delta', text: '```\n' };
      yield { type: 'done', usage: null };
    },
  };
  const provider = new FailoverAiProvider(primary, [{ alias: 'primary', provider: primary }], 1_000);
  const visible: string[] = [];

  for await (const event of provider.streamAnswer(v2Request())) {
    if (event.type === 'delta') visible.push(event.text);
  }

  assert.deepEqual(visible, ['示例：\n```ts\nconst answer = 42;\n```\n']);
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
