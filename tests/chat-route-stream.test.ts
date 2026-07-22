import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server') {
      return nextResolve('next/server.js', context);
    }
    if (specifier.startsWith('@/')) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { createChatRouteStream } = await import('../lib/server/chat-route-stream.ts');

class FakeScheduler {
  callback: (() => void) | null = null;
  clearCount = 0;

  setInterval(callback: () => void): object {
    this.callback = callback;
    return this;
  }

  clearInterval(): void {
    this.callback = null;
    this.clearCount += 1;
  }
}

function waitingEvents(onSignal: (signal: AbortSignal) => void) {
  return (signal: AbortSignal) => (async function* () {
    onSignal(signal);
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', () => resolve(), { once: true });
    });
  })();
}

test('chat route forwards request disconnect into the exact runChat signal', async () => {
  const requestController = new AbortController();
  const routeController = new AbortController();
  const scheduler = new FakeScheduler();
  let receivedSignal: AbortSignal | null = null;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const stream = createChatRouteStream({
    requestSignal: requestController.signal,
    abortController: routeController,
    heartbeatMs: 15_000,
    scheduler,
    runChat: waitingEvents((signal) => {
      receivedSignal = signal;
      markStarted();
    }),
  });
  const reader = stream.getReader();

  await started;
  assert.equal(receivedSignal, routeController.signal);
  requestController.abort(new DOMException('Request disconnected.', 'AbortError'));
  assert.equal(routeController.signal.aborted, true);
  assert.equal((await reader.read()).done, true);
  assert.equal(scheduler.clearCount, 1);
});

test('chat route stream cancel aborts the same signal and waits for runChat cleanup', async () => {
  const requestController = new AbortController();
  const routeController = new AbortController();
  const scheduler = new FakeScheduler();
  let receivedSignal: AbortSignal | null = null;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const stream = createChatRouteStream({
    requestSignal: requestController.signal,
    abortController: routeController,
    heartbeatMs: 15_000,
    scheduler,
    runChat: waitingEvents((signal) => {
      receivedSignal = signal;
      markStarted();
    }),
  });
  const reader = stream.getReader();

  await started;
  assert.equal(receivedSignal, routeController.signal);
  await reader.cancel('visitor stopped');
  assert.equal(routeController.signal.aborted, true);
  assert.equal(scheduler.clearCount, 1);
});

test('chat route emits status and maps unknown failures without exposing raw payloads', async () => {
  const scheduler = new FakeScheduler();
  const output = await new Response(createChatRouteStream({
    requestSignal: new AbortController().signal,
    abortController: new AbortController(),
    heartbeatMs: 15_000,
    scheduler,
    runChat: () => (async function* () {
      yield { type: 'status' as const, stage: 'routing' as const };
      throw new Error('secret raw provider payload');
    })(),
  })).text();

  assert.match(output, /event: status/);
  assert.match(output, /event: error\ndata: {"code":"CHAT_UNAVAILABLE"}/);
  assert.doesNotMatch(output, /secret raw provider payload/);
  assert.equal(scheduler.clearCount, 1);
});

test('chat route serializes switching and degraded done from the public contract', async () => {
  const output = await new Response(createChatRouteStream({
    requestSignal: new AbortController().signal,
    heartbeatMs: 15_000,
    scheduler: new FakeScheduler(),
    runChat: () => (async function* () {
      yield { type: 'status' as const, stage: 'switching' as const };
      yield {
        type: 'done' as const,
        usage: null,
        budgetLevel: 'normal' as const,
        consumed: false,
        degraded: true,
        remainingMessages: 3,
      };
    })(),
  })).text();

  assert.match(output, /event: status\ndata: {"type":"status","stage":"switching"}/);
  assert.match(output, /event: done\ndata: .*"consumed":false,"degraded":true/);
});
