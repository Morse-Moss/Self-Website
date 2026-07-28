import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readChatSse } from '../lib/client/chat-sse.ts';
import {
  isAutoReplayChatError,
  normalizeChatErrorCode,
  publicErrorMessage,
} from '../lib/client/chat-errors.ts';
import type {
  AiProvider,
  AnswerRequest,
  PreparedTargetAnswer,
  ProviderAnswerTarget,
} from '../lib/server/ai-provider.ts';
import { createChatExecutionBudget } from '../lib/server/chat-execution-budget.ts';
import { FailoverAiProvider } from '../lib/server/failover-ai-provider.ts';
import { OpenAIProviderError } from '../lib/server/openai-provider.ts';
import { createSseStream } from '../lib/server/sse.ts';

const encoder = new TextEncoder();

function responseFrom(frames: string[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  }));
}

test('readChatSse resolves only after one done event', async () => {
  const events: string[] = [];
  await readChatSse(
    responseFrom([
      'event: meta\ndata: {"conversationId":"c1"}\n\n',
      'event: delta\ndata: {"text":"answer"}\n\n',
      'event: done\ndata: {"remainingMessages":29}\n\n',
    ]),
    (event) => events.push(event),
  );
  assert.deepEqual(events, ['meta', 'delta', 'done']);
});

test('readChatSse surfaces a server error event as its stable code', async () => {
  const events: string[] = [];
  await assert.rejects(
    readChatSse(
      responseFrom(['event: error\ndata: {"code":"PROVIDER_UNAVAILABLE"}\n\n']),
      (event) => events.push(event),
    ),
    /PROVIDER_UNAVAILABLE/,
  );
  assert.deepEqual(events, []);
});

test('readChatSse stops at done without waiting for a later reader failure', async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('event: done\ndata: {"remainingMessages":29}\n\n'));
      setTimeout(() => controller.error(new Error('late network reset')), 10);
    },
  }));
  const events: string[] = [];
  await readChatSse(response, (event) => events.push(event));
  assert.deepEqual(events, ['done']);
});

test('readChatSse keeps done terminal when reader cancellation fails', async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('event: done\ndata: {"remainingMessages":29}\n\n'));
    },
    cancel() {
      throw new Error('cancel failed');
    },
  }));
  const events: string[] = [];
  await readChatSse(response, (event) => events.push(event));
  assert.deepEqual(events, ['done']);
});

test('readChatSse rejects a partial clean EOF as provider incomplete', async () => {
  await assert.rejects(
    readChatSse(
      responseFrom([
        'event: meta\ndata: {"conversationId":"c1"}\n\n',
        'event: delta\ndata: {"text":"partial"}\n\n',
      ]),
      () => undefined,
    ),
    /PROVIDER_INCOMPLETE/,
  );
});

test('readChatSse maps malformed frames to provider incomplete', async () => {
  await assert.rejects(
    readChatSse(responseFrom(['event: delta\ndata: {bad json}\n\n']), () => undefined),
    /PROVIDER_INCOMPLETE/,
  );
});

test('readChatSse maps reader failures to provider incomplete', async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('network reset'));
    },
  }));
  await assert.rejects(readChatSse(response, () => undefined), /PROVIDER_INCOMPLETE/);
});

test('readChatSse ignores arbitrarily fragmented heartbeat comments between events', async () => {
  const events: string[] = [];
  await readChatSse(
    responseFrom([
      ': hea',
      'rtbeat\n',
      '\nevent: sta',
      'tus\ndata: {"stage":"routing"}\n\n: heartbeat\n\nevent: del',
      'ta\ndata: {"text":"answer"}\n\nevent: done\ndata: {"remainingMessages":29}\n\n',
    ]),
    (event) => events.push(event),
  );
  assert.deepEqual(events, ['status', 'delta', 'done']);
});

test('readChatSse preserves an active AbortError instead of reporting provider incomplete', async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new DOMException('Stopped by visitor.', 'AbortError'));
    },
  }));

  await assert.rejects(
    readChatSse(response, () => undefined),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
});

test('readChatSse preserves switching and degraded completion payloads', async () => {
  const payloads: Array<{ event: string; stage?: string; degraded?: boolean }> = [];
  await readChatSse(
    responseFrom([
      'event: status\ndata: {"stage":"switching"}\n\n',
      'event: delta\ndata: {"text":"strict answer"}\n\n',
      'event: done\ndata: {"remainingMessages":2,"consumed":false,"degraded":true}\n\n',
    ]),
    (event, payload) => payloads.push({ event, stage: payload.stage, degraded: payload.degraded }),
  );
  assert.deepEqual(payloads, [
    { event: 'status', stage: 'switching', degraded: undefined },
    { event: 'delta', stage: undefined, degraded: undefined },
    { event: 'done', stage: undefined, degraded: true },
  ]);
});

test('decoded SSE exposes no answer delta before an overflow retry reaches terminal success', async () => {
  let calls = 0;
  const raw: AiProvider = {
    async embed() { return [[0.1, 0.2]]; },
    async *streamAnswer() {
      calls += 1;
      if (calls === 1) {
        yield { type: 'delta', text: 'PRIVATE_PARTIAL' };
        throw new OpenAIProviderError('PROVIDER_RESPONSE_FAILED', null, {
          category: 'context_overflow',
          reason: 'context_length_exceeded',
          httpStatus: 400,
          inputTokens: 4_096,
          outputTokens: 0,
          contextWindowTokens: 4_096,
        });
      }
      yield { type: 'delta', text: 'Recovered answer.' };
      yield { type: 'done', usage: null };
    },
  };
  const snapshot: ProviderAnswerTarget['snapshot'] = {
    configDigest: 'a'.repeat(64),
    configDigestVersion: 2,
    connectionDisplayName: 'Primary',
    connectionVersionId: null,
    contextWindowTokens: 4_096,
    inputUsdPerMillion: null,
    modelDisplayName: 'Model',
    modelId: 'model',
    modelVersionId: null,
    maxOutputTokens: 512,
    outputUsdPerMillion: null,
    position: 0,
    protocol: 'responses',
    reasoningEffort: null,
    routeRevisionId: null,
    sourceType: 'environment',
  };
  const failover = new FailoverAiProvider(raw, [{ provider: raw, snapshot }], 1_000);
  const ordering: string[] = [];
  const now = Date.now();
  const request: AnswerRequest = {
    instructions: 'Use evidence only.',
    messages: [{ role: 'user', content: 'Question' }],
    execution: {
      executionId: '11111111-1111-4111-8111-111111111111',
      generationVariantId: '22222222-2222-4222-8222-222222222222',
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
      protocolEventTimeoutMs: 50,
      modelTextTimeoutMs: 100,
      hedgingEnabled: false,
      delaysMs: [0],
      async reserveHedgedAttempt() { return false; },
      async onAttempt(event) {
        if (event.type === 'failed' || event.type === 'completed') {
          ordering.push(`${event.type}-${event.attemptNo}`);
        }
      },
      async prepareTarget({ target, revision, trigger }) {
        const binding = {
          configDigestVersion: target.configDigestVersion,
          configDigest: target.configDigest,
          modelId: target.modelId,
          protocol: target.protocol,
          contextWindowTokens: target.contextWindowTokens,
          maxOutputTokens: target.maxOutputTokens,
          reasoningEffort: target.reasoningEffort,
        };
        const variant = {
          id: '22222222-2222-4222-8222-222222222222',
          revision,
          trigger,
          target: binding,
        };
        const digest = revision.toString(16).repeat(64);
        const outboundBody = Object.freeze({ model: target.modelId, revision });
        return {
          context: {
            variant,
            target: binding,
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
          request: {
            instructions: 'Use evidence only.',
            messages: [{ role: 'user', content: `variant-${revision}` }],
          },
          outboundBody,
          generationRequest: {
            schemaVersion: 'generation-request-v2',
            variant,
            packetHmacKeyId: '2026-07-v2',
            packetHmacSha256: digest,
            instructions: 'Use evidence only.',
            messages: [{ role: 'user', content: `variant-${revision}` }],
            reasoningEffort: null,
            maxOutputTokens: 512,
            outboundBody,
            store: false,
          },
          integrity: {
            version: 2,
            contextBuilderVersion: 'context-packet-builder-v2',
            generationVariantId: variant.id,
            generationVariantRevision: revision,
            target: binding,
            packetHmacKeyId: '2026-07-v2',
            packetHmacSha256: digest,
            generationRequestHmacSha256: digest,
          },
        } satisfies PreparedTargetAnswer;
      },
    },
  };
  const controller = new AbortController();
  const stream = createSseStream({
    abortController: new AbortController(),
    parentSignal: controller.signal,
    heartbeatMs: 60_000,
    async run(signal, emit) {
      for await (const event of failover.streamAnswer(request, signal)) {
        if (event.type === 'delta') emit('delta', { type: 'delta', text: event.text });
        if (event.type === 'switching') {
          emit('status', { type: 'status', stage: 'switching' });
        }
        if (event.type === 'done') {
          emit('done', {
            type: 'done',
            usage: null,
            budgetLevel: 'normal',
            consumed: false,
            degraded: false,
            remainingMessages: 1,
          });
        }
      }
    },
  });

  const visible: string[] = [];
  await readChatSse(new Response(stream), (event, payload) => {
    if (event === 'delta') {
      ordering.push('delta');
      visible.push(payload.text ?? '');
    }
    if (event === 'done') ordering.push('done');
  });

  assert.equal(calls, 2);
  assert.deepEqual(visible, ['Recovered answer.']);
  assert.deepEqual(ordering, ['failed-1', 'completed-2', 'delta', 'done']);
});

test('automatic replay uses only the narrow transient error set', () => {
  for (const code of [
    'RETRIEVAL_UNAVAILABLE',
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_INCOMPLETE',
    'CONVERSATION_BUSY',
    'CHAT_UNAVAILABLE',
  ]) assert.equal(isAutoReplayChatError(code), true, code);

  for (const code of [
    'ACCESS_REQUIRED',
    'SESSION_INVALID',
    'MESSAGE_LIMIT',
    'CHAT_RATE_LIMITED',
    'BUDGET_EXHAUSTED',
    'CONVERSATION_INVALID',
    'CONVERSATION_MODE_MISMATCH',
    'CHAT_STOPPED',
    'CONTEXT_LIMIT_EXCEEDED',
    'CONTEXT_WINDOW_UNKNOWN',
    'OUTPUT_TRUNCATED',
    'CONTEXT_COMPACTION_FAILED',
  ]) assert.equal(isAutoReplayChatError(code), false, code);
});

test('dynamic context failures keep stable client codes and dedicated public copy', () => {
  for (const code of [
    'CONTEXT_LIMIT_EXCEEDED',
    'CONTEXT_WINDOW_UNKNOWN',
    'OUTPUT_TRUNCATED',
    'CONTEXT_COMPACTION_FAILED',
  ] as const) {
    assert.equal(normalizeChatErrorCode(new Error(code)), code);
    assert.notEqual(
      publicErrorMessage(code),
      publicErrorMessage('CHAT_UNAVAILABLE'),
      code,
    );
  }
});
