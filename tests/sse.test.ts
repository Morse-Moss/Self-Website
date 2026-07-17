import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createSseStream,
  encodeSse,
  SSE_HEARTBEAT,
  type SseScheduler,
} from '../lib/server/sse.ts';

class FakeScheduler implements SseScheduler {
  callback: (() => void) | null = null;
  delay: number | null = null;
  clearCount = 0;

  setInterval(callback: () => void, delay: number): object {
    this.callback = callback;
    this.delay = delay;
    return this;
  }

  clearInterval(handle: unknown): void {
    assert.equal(handle, this);
    this.callback = null;
    this.clearCount += 1;
  }

  tick(): void {
    this.callback?.();
  }
}

test('encodeSse creates one standards-compatible event frame', () => {
  assert.equal(
    encodeSse('delta', { text: '你好\n摩斯' }),
    'event: delta\ndata: {"text":"你好\\n摩斯"}\n\n',
  );
});

test('createSseStream emits exact deterministic heartbeat comments and clears on done', async () => {
  const scheduler = new FakeScheduler();
  let markStarted!: () => void;
  let finishRun!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const finish = new Promise<void>((resolve) => { finishRun = resolve; });
  const stream = createSseStream({
    abortController: new AbortController(),
    heartbeatMs: 15_000,
    scheduler,
    async run(_signal, emit) {
      markStarted();
      await finish;
      emit('done', { ok: true });
    },
  });
  const reader = stream.getReader();

  await started;
  assert.equal(scheduler.delay, 15_000);
  scheduler.tick();
  const heartbeat = await reader.read();
  assert.equal(new TextDecoder().decode(heartbeat.value), SSE_HEARTBEAT);
  assert.equal(SSE_HEARTBEAT, ': heartbeat\n\n');

  finishRun();
  const doneFrame = await reader.read();
  assert.match(new TextDecoder().decode(doneFrame.value), /^event: done\n/);
  assert.equal((await reader.read()).done, true);
  assert.equal(scheduler.clearCount, 1);
  scheduler.tick();
});

test('createSseStream makes done and error terminal and rejects later enqueue attempts', async () => {
  for (const terminalEvent of ['done', 'error'] as const) {
    const scheduler = new FakeScheduler();
    let lateResult: boolean | null = null;
    const stream = createSseStream({
      abortController: new AbortController(),
      heartbeatMs: 100,
      scheduler,
      async run(_signal, emit) {
        emit('status', { stage: 'routing' });
        emit(terminalEvent, terminalEvent === 'done' ? { ok: true } : { code: 'TEST_ERROR' });
        lateResult = emit('delta', { text: 'late' });
      },
    });
    const output = await new Response(stream).text();
    assert.match(output, /event: status/);
    assert.match(output, new RegExp(`event: ${terminalEvent}`));
    assert.doesNotMatch(output, /late/);
    assert.equal(lateResult, false);
    assert.equal(scheduler.clearCount, 1);
  }
});
