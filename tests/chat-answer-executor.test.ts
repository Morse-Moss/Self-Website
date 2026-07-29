import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AnswerExecutionError,
  ProviderRunError,
  type AnswerEvent,
} from '../lib/server/ai-provider.ts';
import { DirectAnswerExecutor } from '../lib/server/chat-answer-executor.ts';
import { createChatExecutionBudget } from '../lib/server/chat-execution-budget.ts';

function stream(...events: AnswerEvent[]): AsyncIterable<AnswerEvent> {
  return (async function* answerStream() { yield* events; })();
}

function input(events: AnswerEvent[]) {
  let answerCalls = 0;
  const operationalEvents: string[] = [];
  return {
    value: {
      budget: createChatExecutionBudget({
        turnStartedAtMs: 0,
        providerStartedAtMs: 0,
        turnTimeoutMs: 90_000,
        providerTimeoutMs: 80_000,
      }),
      now: () => 1_000,
      releasePolicy: 'complete' as const,
      sources: [],
      generate() {
        answerCalls += 1;
        return stream(...events);
      },
      onOperationalEvent(event: { type: 'attempt' | 'switching' }) {
        operationalEvents.push(event.type);
      },
    },
    answerCalls: () => answerCalls,
    operationalEvents,
  };
}

test('direct executor returns one complete candidate without answer deltas or planning calls', async () => {
  const fixture = input([
    { type: 'delta', text: 'complete candidate answer' },
    { type: 'done', usage: { inputTokens: 10, outputTokens: 4 } },
  ]);
  const provider = { planCalls: 0 };
  const candidate = await new DirectAnswerExecutor().execute(
    fixture.value,
    new AbortController().signal,
  );

  assert.equal(candidate.executorKind, 'direct');
  assert.equal(candidate.text, 'complete candidate answer');
  assert.deepEqual(candidate.usage, { inputTokens: 10, outputTokens: 4 });
  assert.doesNotMatch(JSON.stringify(fixture.operationalEvents), /delta/u);
  assert.equal(provider.planCalls, 0);
  assert.equal(fixture.answerCalls(), 1);
});

test('direct executor preserves serial switching and returns only the winning complete text', async () => {
  const fixture = input([
    { type: 'switching' },
    { type: 'delta', text: 'fallback answer' },
    { type: 'done', usage: null },
  ]);
  const candidate = await new DirectAnswerExecutor().execute(
    fixture.value,
    new AbortController().signal,
  );

  assert.equal(candidate.text, 'fallback answer');
  assert.deepEqual(fixture.operationalEvents, ['switching']);
  assert.equal(fixture.answerCalls(), 1);
});

test('direct executor preserves cancellation, empty output and all-target exhaustion', async () => {
  const executor = new DirectAnswerExecutor();
  const aborted = new AbortController();
  aborted.abort(new DOMException('cancelled', 'AbortError'));
  const valid = input([
    { type: 'delta', text: 'must not run' },
    { type: 'done', usage: null },
  ]);
  await assert.rejects(
    executor.execute(valid.value, aborted.signal),
    (error: unknown) => error === aborted.signal.reason,
  );
  assert.equal(valid.answerCalls(), 0);

  await assert.rejects(
    executor.execute(input([{ type: 'done', usage: null }]).value, new AbortController().signal),
    (error: unknown) => error instanceof AnswerExecutionError
      && error.code === 'PROVIDER_INCOMPLETE',
  );
  const exhausted = new ProviderRunError('PROVIDER_UNAVAILABLE', []);
  await assert.rejects(
    executor.execute({
      ...input([]).value,
      generate: () => (async function* failed(): AsyncGenerator<AnswerEvent> {
        throw exhausted;
      })(),
    }, new AbortController().signal),
    (error: unknown) => error === exhausted,
  );
});
