import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readChatSse } from '../lib/client/chat-sse.ts';
import { isAutoReplayChatError } from '../lib/client/chat-errors.ts';

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
    'BUDGET_EXHAUSTED',
    'CONVERSATION_INVALID',
    'CONVERSATION_MODE_MISMATCH',
    'CHAT_STOPPED',
  ]) assert.equal(isAutoReplayChatError(code), false, code);
});
