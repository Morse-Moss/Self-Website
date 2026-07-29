import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AnswerExecutionError,
  ProviderRunError,
  type AnswerEvent,
  type ProviderAttempt,
} from '../lib/server/ai-provider.ts';
import {
  runChatAnswer,
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
  });
}

function attempt(attemptIndex: number, status: ProviderAttempt['status']): ProviderAttempt {
  const startedAt = new Date(`2026-07-22T00:00:0${attemptIndex}.000Z`);
  return {
    attemptIndex,
    completedAt: new Date(startedAt.getTime() + 10),
    configDigest: '0'.repeat(64),
    configDigestVersion: 2,
    connectionDisplayName: 'Test provider',
    connectionVersionId: null,
    contextWindowTokens: null,
    costComplete: true,
    errorCode: status === 'completed' ? null : 'PROVIDER_UNAVAILABLE',
    firstByteLatencyMs: 1,
    firstModelTextMs: 1,
    firstProtocolEventMs: 1,
    firstUserVisibleMs: 1,
    generationMode: 'normal',
    inputUsdPerMillion: '1',
    knownCostUsd: 0.00001,
    launchKind: 'primary',
    modelDisplayName: 'Test model',
    modelId: 'test-model',
    modelVersionId: null,
    maxOutputTokens: null,
    outputUsdPerMillion: '1',
    position: 0,
    protocol: 'responses',
    reasoningEffort: null,
    routeRevisionId: null,
    sourceType: 'environment',
    startedAt,
    status,
    totalLatencyMs: 10,
    usage: { inputTokens: 5, outputTokens: 5 },
    usageComplete: true,
  };
}

test('delivers a completed non-empty answer with one generation call', async () => {
  const answer = '匹配度: 90%。缺口清单。下一步：读取 AGENTS.md。[来源99]';
  const calls: GenerateChatAnswerInput[] = [];
  const events = await collect(runChatAnswer({
    budget: budget(),
    now: () => 1_000,
    releasePolicy: 'complete',
    generate(input) {
      calls.push(input);
      return stream(
        { type: 'delta', text: answer },
        { type: 'done', usage: { inputTokens: 5, outputTokens: 2 }, providerAlias: 'primary' },
      );
    },
  }));

  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(events), /"type":"delta"/u);
  const terminal = events.at(-1);
  assert.equal(terminal?.type, 'complete');
  if (terminal?.type === 'complete') assert.equal(terminal.answer, answer);
  assert.doesNotMatch(JSON.stringify(events), /reset|strict/u);
});

test('network and timeout errors propagate without a second generation call', async () => {
  for (const error of [
    new ProviderRunError('PROVIDER_UNAVAILABLE', []),
    new OperationTimeoutError('PROVIDER_TOTAL_TIMEOUT'),
  ]) {
    let calls = 0;
    await assert.rejects(async () => {
      await collect(runChatAnswer({
        budget: budget(),
        now: () => 1_000,
        releasePolicy: 'segment',
        generate() {
          calls += 1;
          return (async function* failed(): AsyncGenerator<AnswerEvent> { throw error; })();
        },
      }));
    }, (candidate: unknown) => candidate === error);
    assert.equal(calls, 1);
  }
});

test('complete release buffers all text until protocol completion and emits it once', async () => {
  let waitingForCompletion = false;
  let releaseDone: () => void = () => {
    throw new Error('completion gate not initialized');
  };
  const completionGate = new Promise<void>((resolve) => { releaseDone = resolve; });
  const provider = (async function* delayed(): AsyncGenerator<AnswerEvent> {
    yield { type: 'delta', text: 'first ' };
    yield { type: 'delta', text: 'second' };
    waitingForCompletion = true;
    await completionGate;
    yield { type: 'done', usage: null };
  })();
  const iterator = runChatAnswer({
    budget: budget(),
    now: () => 1_000,
    releasePolicy: 'complete',
    generate: () => provider,
  })[Symbol.asyncIterator]();

  const firstVisible = iterator.next();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waitingForCompletion, true);
  let settled = false;
  void firstVisible.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);

  releaseDone();
  const complete = await firstVisible;
  assert.equal(complete.value?.type, 'complete');
  if (complete.value?.type === 'complete') assert.equal(complete.value.answer, 'first second');
  assert.equal(await iterator.next().then((result) => result.done), true);
});

test('segment release also buffers all text until terminal provider success', async () => {
  let waitingForCompletion = false;
  let releaseDone: () => void = () => {
    throw new Error('completion gate not initialized');
  };
  const completionGate = new Promise<void>((resolve) => { releaseDone = resolve; });
  const provider = (async function* delayed(): AsyncGenerator<AnswerEvent> {
    yield { type: 'delta', text: 'private partial ' };
    yield { type: 'delta', text: 'winner' };
    waitingForCompletion = true;
    await completionGate;
    yield { type: 'done', usage: null };
  })();
  const iterator = runChatAnswer({
    budget: budget(),
    now: () => 1_000,
    releasePolicy: 'segment',
    generate: () => provider,
  })[Symbol.asyncIterator]();

  const firstVisible = iterator.next();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waitingForCompletion, true);
  let settled = false;
  void firstVisible.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);

  releaseDone();
  const complete = await firstVisible;
  assert.equal(complete.value?.type, 'complete');
  if (complete.value?.type === 'complete') {
    assert.equal(complete.value.answer, 'private partial winner');
  }
});

test('provider attempts and winner metadata are forwarded unchanged', async () => {
  const completed = attempt(0, 'completed');
  const events = await collect(runChatAnswer({
    budget: budget(),
    now: () => 1_000,
    releasePolicy: 'segment',
    generate: () => stream(
      { type: 'attempt', attempt: completed },
      { type: 'delta', text: 'answer' },
      { type: 'done', attempts: [completed], usage: completed.usage, winner: completed },
    ),
  }));

  const attemptEvents = events.filter(
    (event): event is Extract<ChatAnswerRunnerEvent, { type: 'attempt' }> => event.type === 'attempt',
  );
  assert.deepEqual(attemptEvents.map((event) => event.attempt.attemptIndex), [0]);
  const complete = events.at(-1);
  assert.equal(complete?.type, 'complete');
  if (complete?.type === 'complete') assert.equal(complete.winner?.attemptIndex, 0);
});

test('serial provider switching is forwarded without resetting visible text', async () => {
  const events = await collect(runChatAnswer({
    budget: budget(),
    now: () => 1_000,
    releasePolicy: 'segment',
    generate: () => stream(
      { type: 'switching' },
      { type: 'delta', text: 'fallback answer' },
      { type: 'done', usage: null },
    ),
  }));

  assert.equal(events[0]?.type, 'switching');
  assert.equal(events[1]?.type, 'complete');
  if (events[1]?.type === 'complete') assert.equal(events[1].answer, 'fallback answer');
});

test('empty and unknown provider results remain failures', async () => {
  await assert.rejects(
    collect(runChatAnswer({
      budget: budget(),
      now: () => 1_000,
      releasePolicy: 'segment',
      generate: () => stream({ type: 'done', usage: null }),
    })),
    (error: unknown) => error instanceof AnswerExecutionError && error.code === 'PROVIDER_INCOMPLETE',
  );

  const original = new Error('program defect');
  await assert.rejects(
    collect(runChatAnswer({
      budget: budget(),
      now: () => 1_000,
      releasePolicy: 'segment',
      generate: () => (async function* broken(): AsyncGenerator<AnswerEvent> { throw original; })(),
    })),
    (error: unknown) => error === original,
  );
});
