import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Semaphore } from '../lib/server/concurrency.ts';

function guard<T>(promise: Promise<T>, timeoutMs = 200): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('test guard timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

test('Semaphore grants queued permits in FIFO order', async () => {
  const semaphore = new Semaphore(1);
  const releaseFirst = await semaphore.acquire();
  const order: string[] = [];
  const second = semaphore.acquire().then((release) => {
    order.push('second');
    return release;
  });
  const third = semaphore.acquire().then((release) => {
    order.push('third');
    return release;
  });

  releaseFirst();
  const releaseSecond = await guard(second);
  assert.deepEqual(order, ['second']);

  releaseSecond();
  const releaseThird = await guard(third);
  assert.deepEqual(order, ['second', 'third']);
  releaseThird();
});

test('Semaphore removes an aborted waiter without leaking a permit', async () => {
  const semaphore = new Semaphore(1);
  const releaseFirst = await semaphore.acquire();
  const controller = new AbortController();
  const reason = new Error('queue wait stopped');
  const cancelled = semaphore.acquire(controller.signal);
  const next = semaphore.acquire();

  controller.abort(reason);
  await assert.rejects(cancelled, (error: unknown) => error === reason);

  releaseFirst();
  const releaseNext = await guard(next);
  releaseNext();

  const releaseAfter = await guard(semaphore.acquire());
  releaseAfter();
});

test('Semaphore release is idempotent and cannot over-grant capacity', async () => {
  const semaphore = new Semaphore(1);
  const releaseFirst = await semaphore.acquire();
  const second = semaphore.acquire();
  let thirdGranted = false;
  const third = semaphore.acquire().then((release) => {
    thirdGranted = true;
    return release;
  });

  releaseFirst();
  releaseFirst();
  const releaseSecond = await guard(second);
  await Promise.resolve();
  assert.equal(thirdGranted, false);

  releaseSecond();
  const releaseThird = await guard(third);
  releaseThird();
});
