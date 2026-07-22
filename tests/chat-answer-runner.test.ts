import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AnswerExecutionError,
  ProviderRunError,
  type AnswerEvent,
  type ProviderAttempt,
} from '../lib/server/ai-provider.ts';
import {
  runGuardedChatAnswer,
  type ChatAnswerRunnerEvent,
  type GenerateChatAnswerInput,
} from '../lib/server/chat-answer-runner.ts';
import { createChatExecutionBudget } from '../lib/server/chat-execution-budget.ts';
import { OperationTimeoutError } from '../lib/server/timeout.ts';

async function collect(stream: AsyncIterable<ChatAnswerRunnerEvent>): Promise<ChatAnswerRunnerEvent[]> {
  const events: ChatAnswerRunnerEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function stream(...events: AnswerEvent[]): AsyncIterable<AnswerEvent> {
  return (async function* answerStream() { yield* events; })();
}

function budget() {
  return createChatExecutionBudget({
    turnStartedAtMs: 0,
    providerStartedAtMs: 0,
    turnTimeoutMs: 90_000,
    providerTimeoutMs: 80_000,
    maxAttempts: 3,
  });
}

function attempt(attemptIndex: number, status: ProviderAttempt['status']): ProviderAttempt {
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
    firstModelTextMs: 1,
    firstProtocolEventMs: 1,
    firstUserVisibleMs: 1,
    generationMode: status === 'completed' ? 'strict' : 'normal',
    inputUsdPerMillion: '1',
    knownCostUsd: 0.00001,
    launchKind: 'primary',
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

test('only output guard rejection starts strict generation', async () => {
  const calls: GenerateChatAnswerInput[] = [];
  const events = await collect(runGuardedChatAnswer({
    budget: budget(),
    now: () => 1_000,
    generate(input) {
      calls.push(input);
      return input.strict
        ? stream(
            { type: 'delta', text: 'strict public answer' },
            { type: 'done', usage: { inputTokens: 7, outputTokens: 3 }, providerAlias: 'primary' },
          )
        : stream(
            { type: 'delta', text: 'rejected recruitment claim' },
            { type: 'done', usage: { inputTokens: 5, outputTokens: 2 }, providerAlias: 'primary' },
          );
    },
    inspect: (answer) => ({ ok: !answer.includes('rejected'), reasons: [] }),
  }));

  assert.deepEqual(calls.map((call) => call.generationMode), ['normal', 'strict']);
  assert.deepEqual(events.filter((event) => event.type === 'delta'), [
    { type: 'delta', text: 'strict public answer' },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /rejected recruitment claim/);
});

test('network and timeout errors do not start strict generation', async () => {
  for (const error of [
    new ProviderRunError('PROVIDER_UNAVAILABLE', []),
    new OperationTimeoutError('PROVIDER_TOTAL_TIMEOUT'),
  ]) {
    const calls: boolean[] = [];
    await assert.rejects(async () => {
      await collect(runGuardedChatAnswer({
        budget: budget(),
        now: () => 1_000,
        generate(input) {
          calls.push(input.strict);
          return (async function* failed(): AsyncGenerator<AnswerEvent> { throw error; })();
        },
        inspect: () => ({ ok: true, reasons: [] }),
      }));
    }, (candidate: unknown) => candidate === error);
    assert.deepEqual(calls, [false]);
  }
});

test('a second guard rejection fails without a local safe answer', async () => {
  let calls = 0;
  await assert.rejects(async () => {
    await collect(runGuardedChatAnswer({
      budget: budget(),
      now: () => 1_000,
      generate() {
        calls += 1;
        return stream({ type: 'delta', text: 'rejected answer' });
      },
      inspect: () => ({ ok: false, reasons: ['system_metadata'] }),
    }));
  }, (error: unknown) => (
    error instanceof AnswerExecutionError && error.code === 'OUTPUT_GUARD_REJECTED'
  ));
  assert.equal(calls, 2);
});

test('a rejected later segment resets provisional text before strict regeneration', async () => {
  const events = await collect(runGuardedChatAnswer({
    budget: budget(),
    now: () => 1_000,
    generate(input) {
      return input.strict
        ? stream({ type: 'delta', text: 'strict answer.' }, { type: 'done', usage: null })
        : stream(
            { type: 'delta', text: 'accepted segment. ' },
            { type: 'delta', text: 'rejected segment.' },
          );
    },
    inspect: (answer) => ({ ok: !answer.includes('rejected'), reasons: [] }),
  }));

  assert.deepEqual(events.filter((event) => (
    event.type === 'delta' || event.type === 'reset'
  )), [
    { type: 'delta', text: 'accepted segment. ' },
    { type: 'reset' },
    { type: 'delta', text: 'strict answer.' },
  ]);
});

test('provider attempts are forwarded and reindexed across strict generation', async () => {
  const first = attempt(0, 'failed');
  const second = attempt(0, 'completed');
  const events = await collect(runGuardedChatAnswer({
    budget: budget(),
    now: () => 1_000,
    generate(input) {
      return input.strict
        ? stream(
            { type: 'attempt', attempt: second },
            { type: 'delta', text: 'strict answer' },
            { type: 'done', attempts: [second], usage: second.usage, winner: { ...second, attemptIndex: 0 } },
          )
        : (async function* rejected(): AsyncGenerator<AnswerEvent> {
            yield { type: 'attempt', attempt: first };
            throw new AnswerExecutionError('OUTPUT_GUARD_REJECTED');
          })();
    },
    inspect: () => ({ ok: true, reasons: [] }),
  }));

  const attempts = events.filter(
    (event): event is Extract<ChatAnswerRunnerEvent, { type: 'attempt' }> => event.type === 'attempt',
  );
  assert.deepEqual(attempts.map((event) => event.attempt.attemptIndex), [0, 1]);
  const complete = events.at(-1);
  assert.equal(complete?.type, 'complete');
  if (complete?.type === 'complete') assert.equal(complete.winner?.attemptIndex, 1);
});

test('serial provider switching is forwarded without resetting visible text', async () => {
  const events = await collect(runGuardedChatAnswer({
    budget: budget(),
    now: () => 1_000,
    generate: () => stream(
      { type: 'switching' },
      { type: 'delta', text: 'fallback answer' },
      { type: 'done', usage: null },
    ),
    inspect: () => ({ ok: true, reasons: [] }),
  }));

  assert.deepEqual(events.slice(0, 2), [
    { type: 'switching' },
    { type: 'delta', text: 'fallback answer' },
  ]);
});

test('unknown execution errors propagate without regeneration', async () => {
  const original = new Error('program defect');
  let calls = 0;
  await assert.rejects(async () => {
    await collect(runGuardedChatAnswer({
      budget: budget(),
      now: () => 1_000,
      generate() {
        calls += 1;
        return (async function* broken(): AsyncGenerator<AnswerEvent> { throw original; })();
      },
      inspect: () => ({ ok: true, reasons: [] }),
    }));
  }, (error: unknown) => error === original);
  assert.equal(calls, 1);
});
