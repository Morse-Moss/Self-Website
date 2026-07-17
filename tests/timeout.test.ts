import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createTimeoutSignal,
  OperationTimeoutError,
  raceWithSignal,
} from '../lib/server/timeout.ts';

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

test('createTimeoutSignal aborts with a stable timeout category', async () => {
  const timeout = createTimeoutSignal({
    timeoutMs: 10,
    code: 'EMBEDDING_TIMEOUT',
  });

  try {
    await assert.rejects(
      raceWithSignal(new Promise<never>(() => undefined), timeout.signal),
      (error: unknown) => (
        error instanceof OperationTimeoutError
        && error.code === 'EMBEDDING_TIMEOUT'
      ),
    );
  } finally {
    timeout.dispose();
  }
});

test('createTimeoutSignal composes an external abort and keeps its reason', async () => {
  const external = new AbortController();
  const timeout = createTimeoutSignal({
    timeoutMs: 1_000,
    code: 'PROVIDER_TOTAL_TIMEOUT',
    signal: external.signal,
  });
  const reason = new Error('request stopped');
  const pending = raceWithSignal(new Promise<never>(() => undefined), timeout.signal);

  external.abort(reason);

  try {
    await assert.rejects(pending, (error: unknown) => error === reason);
  } finally {
    timeout.dispose();
  }
});

test('cancelTimeout clears only the deadline while retaining external cancellation', async () => {
  const external = new AbortController();
  const timeout = createTimeoutSignal({
    timeoutMs: 10,
    code: 'PROVIDER_FIRST_BYTE_TIMEOUT',
    signal: external.signal,
  });
  const reason = new Error('total timeout');

  timeout.cancelTimeout();
  await delay(20);
  assert.equal(timeout.signal.aborted, false);

  external.abort(reason);
  assert.equal(timeout.signal.aborted, true);
  assert.equal(timeout.signal.reason, reason);
  timeout.dispose();
});

test('dispose releases both the timer and external abort listener', async () => {
  const external = new AbortController();
  const timeout = createTimeoutSignal({
    timeoutMs: 10,
    code: 'PROVIDER_TOTAL_TIMEOUT',
    signal: external.signal,
  });

  timeout.dispose();
  external.abort(new Error('late abort'));
  await delay(20);

  assert.equal(timeout.signal.aborted, false);
});
