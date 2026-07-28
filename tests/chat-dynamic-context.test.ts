import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TASK_HISTORY_SUMMARY_INSTRUCTION_VERSION,
  type CanonicalAnswerSourceV2,
  type CompletedContextTurn,
} from '../lib/contracts/chat-context.ts';
import type { ProviderTargetSnapshot } from '../lib/server/ai-provider.ts';
import {
  prepareTargetContext,
  type HistoryCompactionStoreAdapter,
} from '../lib/server/chat-context-coordinator.ts';
import {
  completedTurnsSha256,
  historySummaryRequestHmac,
} from '../lib/server/chat-context-packet.ts';

const DIGEST = {
  key: Buffer.alloc(32, 31),
  keyId: 'context-v2-test',
};
const VARIANT_ID = '11111111-1111-4111-8111-111111111111';

function turn(index: number, text = `turn-${index}`): CompletedContextTurn {
  return {
    conversationId: '22222222-2222-4222-8222-222222222222',
    turnId: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
    contextScopeId: '44444444-4444-4444-8444-444444444444',
    user: {
      id: `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`,
      role: 'user',
      text: `user ${text}`,
    },
    assistant: {
      id: `66666666-6666-4666-8666-${String(index).padStart(12, '0')}`,
      role: 'assistant',
      text: `assistant ${text}`,
    },
    completedAt: new Date(`2026-07-2${index}T00:00:00.000Z`),
  };
}

function source(history = [turn(1), turn(2), turn(3)]): CanonicalAnswerSourceV2 {
  return {
    schemaVersion: 'canonical-answer-source-v2',
    ownerPipeline: 'context_packet_v22',
    conversationId: '22222222-2222-4222-8222-222222222222',
    interactionTurnId: '77777777-7777-4777-8777-777777777777',
    contextScopeId: '44444444-4444-4444-8444-444444444444',
    currentUserMessageId: '88888888-8888-4888-8888-888888888888',
    currentInput: 'current exact input',
    trustedInstructions: 'trusted system policy',
    taskFrame: { task: 'resume review' },
    taskInputs: [{ slot: 'job description', text: 'exact requirement' }],
    approvedEvidence: [{ evidenceId: 'evidence-1', content: 'approved fact' }],
    completeHistory: history,
    reasoningEffort: 'high',
    releasePolicy: 'complete',
  };
}

function target(contextWindowTokens: number | null): ProviderTargetSnapshot {
  return {
    configDigest: 'a'.repeat(64),
    configDigestVersion: 2,
    connectionDisplayName: 'Primary',
    connectionVersionId: null,
    contextWindowTokens,
    inputUsdPerMillion: null,
    maxOutputTokens: null,
    modelDisplayName: 'Model',
    modelId: 'model-v2',
    modelVersionId: null,
    outputUsdPerMillion: null,
    position: 0,
    protocol: 'responses',
    reasoningEffort: 'high',
    routeRevisionId: null,
    sourceType: 'environment',
  };
}

function dependencies(
  estimateTokens: (value: string) => number,
  store: HistoryCompactionStoreAdapter = {
    async findReusable(_input: unknown) { return null; },
    async start(_input: unknown) { throw new Error('summary attempt must not start'); },
    async complete(_input: unknown) { throw new Error('summary artifact must not complete'); },
    async terminate(_input: unknown) { throw new Error('summary attempt must not terminate'); },
  },
) {
  return {
    digest: DIGEST,
    estimateTokens,
    now: () => new Date('2026-07-28T00:00:00.000Z'),
    createId: () => '99999999-9999-4999-8999-999999999999',
    nextSummaryCallIndex: (() => {
      let value = 0;
      return () => value++;
    })(),
    store,
  };
}

function packetEstimator(value: string): number {
  try {
    const packet = JSON.parse(value) as {
      historySummary: unknown;
      protectedLayers: { currentInput: string };
      rawHistory: unknown[];
    };
    if (!packet.protectedLayers || !packet.rawHistory) throw new Error('not a packet');
    return 20
      + packet.protectedLayers.currentInput.length
      + packet.rawHistory.length * 140
      + (packet.historySummary ? 10 : 0);
  } catch {
    return Math.max(1, Math.ceil(value.length / 4));
  }
}

function successfulArtifact(
  summaryAttemptId: string,
  summaryText: string,
  sourceTurnIds: readonly string[],
  sourceTurnSha256 = 'b'.repeat(64),
) {
  return {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(sourceTurnIds.length).padStart(12, '0')}`,
    summaryAttemptId,
    summaryText,
    sourceTurnIds: [...sourceTurnIds],
    sourceTurnSha256,
  };
}

test('unknown context window keeps the complete canonical source without summarizing', async () => {
  let summaryCalls = 0;
  const prepared = await prepareTargetContext({
    source: source(),
    target: target(null),
    variantId: VARIANT_ID,
    revision: 1,
    trigger: 'initial',
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    async summarize() {
      summaryCalls += 1;
      throw new Error('summary must not run');
    },
  }, dependencies(() => 1));

  assert.equal(summaryCalls, 0);
  assert.deepEqual(prepared.historyView.rawHistory.map((item) => item.turnId),
    source().completeHistory.map((item) => item.turnId));
  assert.equal(prepared.historyView.summary, null);
  assert.deepEqual(prepared.historyView.consumedTurnIds, []);
  assert.equal(prepared.packet.protectedLayers.currentInput, 'current exact input');
});

test('known fitting window keeps full history and makes no proactive summary call', async () => {
  let summaryCalls = 0;
  const prepared = await prepareTargetContext({
    source: source(),
    target: target(128_000),
    variantId: VARIANT_ID,
    revision: 2,
    trigger: 'initial',
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    async summarize() {
      summaryCalls += 1;
      throw new Error('summary must not run');
    },
  }, dependencies(() => 10));

  assert.equal(summaryCalls, 0);
  assert.equal(prepared.historyView.rawHistory.length, 3);
  assert.equal(prepared.historyView.summary, null);
});

test('known overflow summarizes the smallest oldest complete-turn prefix', async () => {
  const stored = { starts: [] as unknown[], completions: [] as unknown[] };
  const store = {
    async findReusable() { return null; },
    async start(input: unknown) {
      stored.starts.push(input);
      return 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    },
    async complete(input: unknown) {
      stored.completions.push(input);
      return {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        summaryAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        summaryText: 'short summary',
        sourceTurnIds: [turn(1).turnId],
        sourceTurnSha256: 'b'.repeat(64),
      };
    },
    async terminate() { throw new Error('successful summary must not terminate'); },
  };
  const summaryRequests: Array<{
    instructions: string;
    messages: Array<{ content: string }>;
    preparedOutboundBody?: Readonly<Record<string, unknown>>;
  }> = [];
  const prepared = await prepareTargetContext({
    source: source(),
    target: target(330),
    variantId: VARIANT_ID,
    revision: 3,
    trigger: 'initial',
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    async summarize(request) {
      summaryRequests.push(request as never);
      return {
        status: 'completed',
        text: 'short summary',
        inputTokens: 40,
        outputTokens: 3,
        errorCode: null,
      };
    },
  }, dependencies(packetEstimator, store));

  assert.equal(summaryRequests.length, 1);
  assert.match(summaryRequests[0].messages[0].content, /user turn-1/u);
  assert.match(summaryRequests[0].messages[0].content, /assistant turn-1/u);
  assert.doesNotMatch(summaryRequests[0].messages[0].content, /turn-2/u);
  assert.deepEqual(prepared.historyView.consumedTurnIds, [turn(1).turnId]);
  assert.deepEqual(prepared.historyView.rawHistory.map((item) => item.turnId), [
    turn(2).turnId,
    turn(3).turnId,
  ]);
  assert.deepEqual(prepared.historyView.summary?.sourceTurnIds, [turn(1).turnId]);
  assert.equal(stored.starts.length, 1);
  assert.equal(stored.completions.length, 1);
  const outboundBody = summaryRequests[0].preparedOutboundBody;
  assert.ok(outboundBody);
  assert.equal(Object.isFrozen(outboundBody), true);
  assert.equal(outboundBody.model, 'model-v2');
  assert.equal(outboundBody.max_output_tokens, 1);
  const start = stored.starts[0] as {
    sourceTurnIds: string[];
    sourceTurnSha256: string;
    summaryRequestHmacSha256: string;
    target: Record<string, unknown>;
  };
  const expectedVariant = {
    id: VARIANT_ID,
    revision: 3,
    trigger: 'initial' as const,
    target: start.target,
  };
  assert.equal(start.summaryRequestHmacSha256, historySummaryRequestHmac({
    digestKey: DIGEST.key,
    value: {
      target: start.target,
      variant: expectedVariant,
      sourceTurnIds: [turn(1).turnId],
      sourceTurnSha256: completedTurnsSha256([turn(1)]),
      summaryInstructionVersion: TASK_HISTORY_SUMMARY_INSTRUCTION_VERSION,
      previousCompactionId: null,
      outboundBody,
    },
  }));
});

test('protected payload overflow fails without deleting content or calling the summarizer', async () => {
  let summaryCalls = 0;
  const protectedSource = source([]);
  protectedSource.currentInput = 'x'.repeat(200);
  await assert.rejects(
    prepareTargetContext({
      source: protectedSource,
      target: target(100),
      variantId: VARIANT_ID,
      revision: 4,
      trigger: 'initial',
      signal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      async summarize() {
        summaryCalls += 1;
        throw new Error('summary must not run');
      },
    }, dependencies(packetEstimator)),
    /CONTEXT_PROTECTED_PAYLOAD_TOO_LARGE/u,
  );
  assert.equal(summaryCalls, 0);
});

test('known overflow prefers one summary call for the smallest fitting oldest prefix', async () => {
  const started: Array<Record<string, unknown>> = [];
  const summaryInputs: string[] = [];
  const store = {
    async findReusable() { return null; },
    async start(input: unknown) {
      started.push(input as Record<string, unknown>);
      return 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    },
    async complete(input: unknown) {
      const completion = input as { summaryAttemptId: string; summaryText: string };
      const lastStart = started.at(-1)!;
      return successfulArtifact(
        completion.summaryAttemptId,
        completion.summaryText,
        lastStart.sourceTurnIds as string[],
        lastStart.sourceTurnSha256 as string,
      );
    },
    async terminate() { throw new Error('successful summary must not terminate'); },
  };

  const oneCallEstimator = (value: string) => {
    if (value.includes('<completed_turns>')) return 150;
    try {
      const packet = JSON.parse(value) as {
        historySummary: unknown;
        protectedLayers: { currentInput: string };
        rawHistory: unknown[];
      };
      if (!packet.protectedLayers || !packet.rawHistory) throw new Error('not a packet');
      return 20
        + packet.protectedLayers.currentInput.length
        + packet.rawHistory.length * 200
        + (packet.historySummary ? 10 : 0);
    } catch {
      return Math.max(1, Math.ceil(value.length / 4));
    }
  };
  const prepared = await prepareTargetContext({
    source: source(),
    target: target(300),
    variantId: VARIANT_ID,
    revision: 5,
    trigger: 'numeric_preflight',
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    async summarize(request) {
      summaryInputs.push(request.messages[0].content);
      return {
        status: 'completed',
        text: 'two turn summary',
        inputTokens: 80,
        outputTokens: 4,
        errorCode: null,
      };
    },
  }, dependencies(oneCallEstimator, store));

  assert.equal(summaryInputs.length, 1);
  assert.match(summaryInputs[0], /turn-1/u);
  assert.match(summaryInputs[0], /turn-2/u);
  assert.doesNotMatch(summaryInputs[0], /turn-3/u);
  assert.deepEqual(prepared.historyView.consumedTurnIds, [turn(1).turnId, turn(2).turnId]);
  assert.deepEqual(prepared.historyView.rawHistory.map((item) => item.turnId), [turn(3).turnId]);
});

test('iterative summaries add raw complete turns monotonically and stay bounded by consumed turns', async () => {
  const starts: Array<Record<string, unknown>> = [];
  const summaryInputs: string[] = [];
  const store = {
    async findReusable() { return null; },
    async start(input: unknown) {
      starts.push(input as Record<string, unknown>);
      return `aaaaaaaa-aaaa-4aaa-8aaa-${String(starts.length).padStart(12, '0')}`;
    },
    async complete(input: unknown) {
      const completion = input as { summaryAttemptId: string; summaryText: string };
      const lastStart = starts.at(-1)!;
      return successfulArtifact(
        completion.summaryAttemptId,
        completion.summaryText,
        lastStart.sourceTurnIds as string[],
        lastStart.sourceTurnSha256 as string,
      );
    },
    async terminate() { throw new Error('successful summary must not terminate'); },
  };
  const estimator = (value: string) => {
    if (value.includes('<completed_turns>')) {
      const rawTurnCount = [...value.matchAll(/assistant turn-/gu)].length;
      if (rawTurnCount > 1 && !value.includes('<previous_task_history_summary>')) return 300;
      return 100;
    }
    return packetEstimator(value);
  };

  const prepared = await prepareTargetContext({
    source: source(),
    target: target(190),
    variantId: VARIANT_ID,
    revision: 6,
    trigger: 'numeric_preflight',
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    async summarize(request) {
      summaryInputs.push(request.messages[0].content);
      return {
        status: 'completed',
        text: `summary-${summaryInputs.length}`,
        inputTokens: 80,
        outputTokens: 4,
        errorCode: null,
      };
    },
  }, dependencies(estimator, store));

  assert.equal(summaryInputs.length, 2);
  assert.match(summaryInputs[0], /turn-1/u);
  assert.doesNotMatch(summaryInputs[0], /turn-2/u);
  assert.match(summaryInputs[1], /previous_task_history_summary/u);
  assert.match(summaryInputs[1], /summary-1/u);
  assert.match(summaryInputs[1], /turn-2/u);
  assert.doesNotMatch(summaryInputs[1], /turn-1/u);
  assert.ok(summaryInputs.length <= prepared.historyView.consumedTurnIds.length);
  assert.deepEqual(starts.map((item) => item.sourceTurnIds), [
    [turn(1).turnId],
    [turn(1).turnId, turn(2).turnId],
  ]);
});

test('a complete turn that cannot fit the target-local summarizer makes the target ineligible', async () => {
  let summaryCalls = 0;
  const estimator = (value: string) => (
    value.includes('<completed_turns>') ? 190 : packetEstimator(value)
  );
  await assert.rejects(
    prepareTargetContext({
      source: source(),
      target: target(190),
      variantId: VARIANT_ID,
      revision: 7,
      trigger: 'numeric_preflight',
      signal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      async summarize() {
        summaryCalls += 1;
        throw new Error('summary must not run');
      },
    }, dependencies(estimator)),
    /CONTEXT_TARGET_INELIGIBLE/u,
  );
  assert.equal(summaryCalls, 0);
});

for (const scenario of [
  {
    name: 'blank',
    result: { status: 'completed', text: '   ', inputTokens: 50, outputTokens: 0, errorCode: null },
    error: 'CONTEXT_SUMMARY_NOT_SMALLER',
    terminalStatus: 'failed',
  },
  {
    name: 'not smaller',
    result: { status: 'completed', text: 'summary is larger', inputTokens: 50, outputTokens: 60, errorCode: null },
    error: 'CONTEXT_SUMMARY_NOT_SMALLER',
    terminalStatus: 'failed',
  },
  {
    name: 'failed',
    result: { status: 'failed', text: null, inputTokens: null, outputTokens: null, errorCode: 'UPSTREAM_FAILED' },
    error: 'CONTEXT_SUMMARY_FAILED',
    terminalStatus: 'failed',
  },
  {
    name: 'cancelled',
    result: { status: 'cancelled', text: null, inputTokens: null, outputTokens: null, errorCode: 'CANCELLED' },
    error: 'CONTEXT_SUMMARY_CANCELLED',
    terminalStatus: 'cancelled',
  },
] as const) {
  test(`${scenario.name} summary terminates the attempt without creating an artifact`, async () => {
    const before = structuredClone(source());
    const completions: unknown[] = [];
    const terminations: Array<Record<string, unknown>> = [];
    const store = {
      async findReusable() { return null; },
      async start() { return 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; },
      async complete(input: unknown) {
        completions.push(input);
        throw new Error('invalid summary must not complete');
      },
      async terminate(input: unknown) { terminations.push(input as Record<string, unknown>); },
    };
    const activeSource = source();
    const estimator = (value: string) => {
      if (value === 'summary is larger') return 60;
      if (value.includes('<completed_turns>')) return 50;
      return packetEstimator(value);
    };

    await assert.rejects(
      prepareTargetContext({
        source: activeSource,
        target: target(330),
        variantId: VARIANT_ID,
        revision: 8,
        trigger: 'numeric_preflight',
        signal: new AbortController().signal,
        deadlineMs: Date.now() + 60_000,
        async summarize() { return scenario.result; },
      }, dependencies(estimator, store)),
      new RegExp(scenario.error, 'u'),
    );

    assert.equal(completions.length, 0);
    assert.equal(terminations.length, 1);
    assert.equal(terminations[0].status, scenario.terminalStatus);
    assert.deepEqual(activeSource, before);
  });
}

test('an exact reusable artifact skips summary I/O while a target identity change does not reuse it', async () => {
  const finds: Array<Record<string, unknown>> = [];
  let summaryCalls = 0;
  const exactDigest = 'a'.repeat(64);
  const store = {
    async findReusable(input: unknown) {
      const key = input as Record<string, unknown>;
      finds.push(key);
      const keyTarget = key.target as { configDigest: string };
      if (keyTarget.configDigest !== exactDigest) return null;
      return successfulArtifact(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'reused summary',
        key.sourceTurnIds as string[],
        key.sourceTurnSha256 as string,
      );
    },
    async start() { return 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; },
    async complete(input: unknown) {
      const completion = input as { summaryAttemptId: string; summaryText: string };
      const lastFind = finds.at(-1)!;
      return successfulArtifact(
        completion.summaryAttemptId,
        completion.summaryText,
        lastFind.sourceTurnIds as string[],
        lastFind.sourceTurnSha256 as string,
      );
    },
    async terminate() { throw new Error('successful summary must not terminate'); },
  };
  const summarize = async () => {
    summaryCalls += 1;
    return {
      status: 'completed' as const,
      text: 'new summary',
      inputTokens: 50,
      outputTokens: 3,
      errorCode: null,
    };
  };

  const reused = await prepareTargetContext({
    source: source(),
    target: target(330),
    variantId: VARIANT_ID,
    revision: 9,
    trigger: 'numeric_preflight',
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    summarize,
  }, dependencies(packetEstimator, store));
  const changedTarget = { ...target(330), configDigest: 'c'.repeat(64) };
  await prepareTargetContext({
    source: source(),
    target: changedTarget,
    variantId: VARIANT_ID,
    revision: 10,
    trigger: 'numeric_preflight',
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    summarize,
  }, dependencies(packetEstimator, store));

  assert.equal(summaryCalls, 1);
  assert.equal(reused.historyView.summary?.text, 'reused summary');
  assert.equal((finds[0].target as { configDigest: string }).configDigest, exactDigest);
  assert.equal((finds.at(-1)!.target as { configDigest: string }).configDigest, 'c'.repeat(64));
});

test('an exact reusable prefix remains usable when the same source no longer fits the summarizer', async () => {
  let summaryCalls = 0;
  const store = {
    async findReusable(input: unknown) {
      const key = input as { sourceTurnIds: string[]; sourceTurnSha256: string };
      if (key.sourceTurnIds.length !== 2) return null;
      return successfulArtifact(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'reused two turn summary',
        key.sourceTurnIds,
        key.sourceTurnSha256,
      );
    },
    async start() { throw new Error('reused summary must not start'); },
    async complete() { throw new Error('reused summary must not complete'); },
    async terminate() { throw new Error('reused summary must not terminate'); },
  };
  const estimator = (value: string) => {
    if (value.includes('<completed_turns>')) return 300;
    try {
      const packet = JSON.parse(value) as {
        historySummary: unknown;
        protectedLayers: { currentInput: string };
        rawHistory: unknown[];
      };
      if (!packet.protectedLayers || !packet.rawHistory) throw new Error('not a packet');
      return 20
        + packet.protectedLayers.currentInput.length
        + packet.rawHistory.length * 200
        + (packet.historySummary ? 10 : 0);
    } catch {
      return Math.max(1, Math.ceil(value.length / 4));
    }
  };

  const prepared = await prepareTargetContext({
    source: source(),
    target: target(300),
    variantId: VARIANT_ID,
    revision: 11,
    trigger: 'numeric_preflight',
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 60_000,
    async summarize() {
      summaryCalls += 1;
      throw new Error('summary must not run');
    },
  }, dependencies(estimator, store));

  assert.equal(summaryCalls, 0);
  assert.equal(prepared.historyView.summary?.text, 'reused two turn summary');
  assert.deepEqual(prepared.historyView.consumedTurnIds, [turn(1).turnId, turn(2).turnId]);
  assert.deepEqual(prepared.historyView.rawHistory.map((item) => item.turnId), [turn(3).turnId]);
});

test('successful compaction remains committed when the later answer flow fails', async () => {
  const artifacts: unknown[] = [];
  const store = {
    async findReusable() { return null; },
    async start() { return 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; },
    async complete(input: unknown) {
      artifacts.push(input);
      const completion = input as { summaryAttemptId: string; summaryText: string };
      return successfulArtifact(completion.summaryAttemptId, completion.summaryText, [turn(1).turnId]);
    },
    async terminate() { throw new Error('successful summary must not terminate'); },
  };

  await assert.rejects((async () => {
    await prepareTargetContext({
      source: source(),
      target: target(330),
      variantId: VARIANT_ID,
      revision: 11,
      trigger: 'numeric_preflight',
      signal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      async summarize() {
        return {
          status: 'completed',
          text: 'durable summary',
          inputTokens: 50,
          outputTokens: 3,
          errorCode: null,
        };
      },
    }, dependencies(packetEstimator, store));
    throw new Error('later answer failed');
  })(), /later answer failed/u);

  assert.equal(artifacts.length, 1);
});

test('deadline checks use the injected clock before starting summary I/O', async () => {
  let summaryCalls = 0;
  const deps = dependencies(packetEstimator);
  deps.now = () => new Date('2500-01-01T00:00:00.000Z');

  await assert.rejects(
    prepareTargetContext({
      source: source(),
      target: target(330),
      variantId: VARIANT_ID,
      revision: 12,
      trigger: 'numeric_preflight',
      signal: new AbortController().signal,
      deadlineMs: 9_999_999_999_999,
      async summarize() {
        summaryCalls += 1;
        throw new Error('summary must not run');
      },
    }, deps),
    /CONTEXT_SUMMARY_CANCELLED/u,
  );
  assert.equal(summaryCalls, 0);
});
