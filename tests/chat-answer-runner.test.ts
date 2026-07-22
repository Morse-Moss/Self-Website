import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnswerExecutionError,
  type AnswerEvent,
  type ProviderAttempt,
} from '../lib/server/ai-provider.ts';
import {
  runGuardedChatAnswer,
  type ChatAnswerRunnerEvent,
} from '../lib/server/chat-answer-runner.ts';

async function collect(
  stream: AsyncIterable<ChatAnswerRunnerEvent>,
): Promise<ChatAnswerRunnerEvent[]> {
  const events: ChatAnswerRunnerEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function stream(...events: AnswerEvent[]): AsyncIterable<AnswerEvent> {
  return (async function* answerStream() {
    yield* events;
  })();
}

function attempt(
  attemptIndex: number,
  status: ProviderAttempt['status'],
): ProviderAttempt {
  const startedAt = new Date(`2026-07-22T00:00:0${attemptIndex}.000Z`);
  return {
    attemptIndex,
    completedAt: new Date(startedAt.getTime() + 10),
    configDigest: '0'.repeat(64),
    connectionDisplayName: 'Test provider',
    connectionVersionId: null,
    costComplete: true,
    errorCode: status === 'completed' ? null : 'OUTPUT_GUARD_REJECTED',
    firstByteLatencyMs: 1,
    inputUsdPerMillion: '1',
    knownCostUsd: 0.00001,
    modelDisplayName: 'Test model',
    modelId: 'test-model',
    modelVersionId: null,
    outputUsdPerMillion: '1',
    position: 0,
    protocol: 'responses',
    routeRevisionId: null,
    sourceType: 'environment',
    startedAt,
    status,
    totalLatencyMs: 10,
    usage: { inputTokens: 5, outputTokens: 5 },
    usageComplete: true,
  };
}

test('a rejected complete candidate is never emitted before strict regeneration', async () => {
  const strictCalls: boolean[] = [];
  const events = await collect(runGuardedChatAnswer({
    generate(strict) {
      strictCalls.push(strict);
      return strict
        ? stream(
            { type: 'delta', text: 'strict public answer' },
            { type: 'done', usage: { inputTokens: 7, outputTokens: 3 }, providerAlias: 'primary' },
          )
        : stream(
            { type: 'delta', text: 'rejected recruitment claim' },
            { type: 'done', usage: { inputTokens: 5, outputTokens: 2 }, providerAlias: 'primary' },
          );
    },
    inspect(answer) {
      return { ok: !answer.includes('rejected'), reasons: [] };
    },
    safeAnswer: () => null,
    canRegenerate: (error) => error instanceof AnswerExecutionError,
  }));

  assert.deepEqual(strictCalls, [false, true]);
  assert.deepEqual(events, [
    { type: 'delta', text: 'strict public answer' },
    {
      type: 'complete',
      answer: 'strict public answer',
      attempts: [],
      costComplete: false,
      usage: { inputTokens: 7, outputTokens: 3 },
      usageComplete: true,
      knownCostUsd: null,
      winner: null,
      degraded: false,
      providerAlias: 'primary',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /rejected recruitment claim/);
});

test('a second guard rejection returns a non-consuming degraded safe answer', async () => {
  let calls = 0;
  const events = await collect(runGuardedChatAnswer({
    generate() {
      calls += 1;
      return stream({ type: 'delta', text: 'rejected answer' });
    },
    inspect: () => ({ ok: false, reasons: ['system_metadata'] }),
    safeAnswer: () => ({ text: 'approved safe summary', sources: [] }),
    canRegenerate: (error) => error instanceof AnswerExecutionError,
  }));

  assert.equal(calls, 2);
  assert.deepEqual(events, [
    { type: 'delta', text: 'approved safe summary' },
    {
      type: 'complete',
      answer: 'approved safe summary',
      attempts: [],
      costComplete: false,
      usage: null,
      usageComplete: false,
      knownCostUsd: null,
      winner: null,
      degraded: true,
      providerAlias: null,
    },
  ]);
});

test('exhausted provider regeneration returns the safe degraded answer', async () => {
  let calls = 0;
  const events = await collect(runGuardedChatAnswer({
    generate() {
      calls += 1;
      return (async function* failedProvider(): AsyncGenerator<AnswerEvent> {
        throw new Error('provider unavailable');
      })();
    },
    inspect: () => ({ ok: true, reasons: [] }),
    safeAnswer: () => ({ text: 'safe provider fallback', sources: [] }),
    canRegenerate: (error) => error instanceof Error && error.message === 'provider unavailable',
  }));

  assert.equal(calls, 2);
  assert.deepEqual(events, [
    { type: 'delta', text: 'safe provider fallback' },
    {
      type: 'complete',
      answer: 'safe provider fallback',
      attempts: [],
      costComplete: false,
      usage: null,
      usageComplete: false,
      knownCostUsd: null,
      winner: null,
      degraded: true,
      providerAlias: null,
    },
  ]);
});

test('a rejected later segment resets provisional text before strict regeneration', async () => {
  const events = await collect(runGuardedChatAnswer({
    generate(strict) {
      return strict
        ? stream(
            { type: 'delta', text: 'strict answer.' },
            { type: 'done', usage: null, providerAlias: 'primary' },
          )
        : stream(
            { type: 'delta', text: 'accepted segment. ' },
            { type: 'delta', text: 'rejected segment.' },
          );
    },
    inspect(answer) {
      return { ok: !answer.includes('rejected'), reasons: [] };
    },
    safeAnswer: () => null,
    canRegenerate: (error) => error instanceof AnswerExecutionError,
  }));

  assert.deepEqual(events, [
    { type: 'delta', text: 'accepted segment. ' },
    { type: 'reset' },
    { type: 'delta', text: 'strict answer.' },
    {
      type: 'complete',
      answer: 'strict answer.',
      attempts: [],
      costComplete: false,
      usage: null,
      usageComplete: false,
      knownCostUsd: null,
      winner: null,
      degraded: false,
      providerAlias: 'primary',
    },
  ]);

  let visible = '';
  for (const event of events) {
    if (event.type === 'reset') visible = '';
    if (event.type === 'delta') visible += event.text;
  }
  assert.equal(visible, 'strict answer.');
});

test('provider attempts are forwarded and reindexed across strict regeneration', async () => {
  const first = attempt(0, 'failed');
  const second = attempt(0, 'completed');
  const events = await collect(runGuardedChatAnswer({
    generate(strict) {
      return strict
        ? stream(
            { type: 'attempt', attempt: second },
            { type: 'delta', text: 'strict answer' },
            {
              type: 'done',
              attempts: [second],
              costComplete: true,
              knownCostUsd: second.knownCostUsd,
              usage: second.usage,
              usageComplete: true,
              winner: { ...second, attemptIndex: 0 },
            },
          )
        : (async function* rejected(): AsyncGenerator<AnswerEvent> {
            yield { type: 'attempt', attempt: first };
            throw new AnswerExecutionError('OUTPUT_GUARD_REJECTED');
          })();
    },
    inspect: () => ({ ok: true, reasons: [] }),
    safeAnswer: () => null,
    canRegenerate: (error) => error instanceof AnswerExecutionError,
  }));

  assert.deepEqual(
    events
      .filter((event): event is Extract<ChatAnswerRunnerEvent, { type: 'attempt' }> => (
        event.type === 'attempt'
      ))
      .map((event) => event.attempt.attemptIndex),
    [0, 1],
  );
  const complete = events.at(-1);
  assert.equal(complete?.type, 'complete');
  if (complete?.type !== 'complete') throw new Error('complete event is missing');
  assert.deepEqual(complete.attempts.map((item) => item.attemptIndex), [0, 1]);
  assert.equal(complete.winner?.attemptIndex, 1);
});

test('abort after reset prevents strict generation and preserves the original error', async () => {
  const original = new AnswerExecutionError('OUTPUT_GUARD_REJECTED');
  let aborted = false;
  let generateCalls = 0;
  let cleanupCalls = 0;
  const iterator = runGuardedChatAnswer({
    generate() {
      generateCalls += 1;
      return (async function* provisional(): AsyncGenerator<AnswerEvent> {
        try {
          yield { type: 'delta', text: 'provisional answer.' };
          throw original;
        } finally {
          cleanupCalls += 1;
        }
      })();
    },
    inspect: () => ({ ok: true, reasons: [] }),
    safeAnswer: () => ({ text: 'safe answer', sources: [] }),
    canRegenerate: (error) => !aborted && error === original,
  })[Symbol.asyncIterator]();

  assert.deepEqual(await iterator.next(), {
    done: false,
    value: { type: 'delta', text: 'provisional answer.' },
  });
  assert.deepEqual(await iterator.next(), {
    done: false,
    value: { type: 'reset' },
  });
  aborted = true;
  await assert.rejects(iterator.next(), (error: unknown) => error === original);
  assert.equal(generateCalls, 1);
  assert.equal(cleanupCalls, 1);
});

test('an unknown execution error is not regenerated and closes its iterator', async () => {
  const original = new Error('program defect');
  let generateCalls = 0;
  let cleanupCalls = 0;
  const iterator = runGuardedChatAnswer({
    generate() {
      generateCalls += 1;
      return (async function* broken(): AsyncGenerator<AnswerEvent> {
        try {
          throw original;
        } finally {
          cleanupCalls += 1;
        }
      })();
    },
    inspect: () => ({ ok: true, reasons: [] }),
    safeAnswer: () => ({ text: 'must not be used', sources: [] }),
    canRegenerate: () => false,
  })[Symbol.asyncIterator]();

  await assert.rejects(iterator.next(), (error: unknown) => error === original);
  assert.equal(generateCalls, 1);
  assert.equal(cleanupCalls, 1);
});
