import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';

import {
  infrastructureBackoffMs,
  loadWorkerConfig,
  runWorker,
} from '../scripts/worker.mjs';
import { cleanupExpired } from '../scripts/cleanup-expired.mjs';

test('cleanup is import-safe and skips all deletes when the transaction lock is held elsewhere', async () => {
  const queries: string[] = [];
  let released = false;
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('pg_try_advisory_xact_lock')) {
        return { rows: [{ acquired: false }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() { released = true; },
  };

  const result = await cleanupExpired({
    now: new Date('2035-01-01T00:00:00.000Z'),
    pool: { async connect() { return client; } },
  });

  assert.deepEqual(result, { skipped: true });
  assert.equal(queries[0], 'BEGIN');
  assert.match(queries[1], /pg_try_advisory_xact_lock/);
  assert.equal(queries[2], 'COMMIT');
  assert.equal(queries.some((query) => /DELETE|UPDATE invite_codes/.test(query)), false);
  assert.equal(released, true);
});

test('worker configuration requires an explicit alert mode and uses frozen intervals', () => {
  assert.deepEqual(loadWorkerConfig({ MORSE_ALERTS_ENABLED: 'false' }), {
    alertsEnabled: false,
    cleanupIntervalMs: 3_600_000,
    dispatchLimit: 20,
    infrastructureBackoffMaxMs: 60_000,
    maxDeliveryAttempts: 5,
    pollMs: 5_000,
    webhookUrl: null,
  });
  assert.throws(
    () => loadWorkerConfig({}),
    /WORKER_ALERT_MODE_REQUIRED/,
  );
});

test('worker infrastructure backoff is exponential and bounded to sixty seconds', () => {
  assert.equal(infrastructureBackoffMs(1, 5_000, 60_000), 5_000);
  assert.equal(infrastructureBackoffMs(2, 5_000, 60_000), 10_000);
  assert.equal(infrastructureBackoffMs(8, 5_000, 60_000), 60_000);
});

test('standalone worker remains alive during infrastructure backoff', async () => {
  const child = spawn(process.execPath, [
    '--input-type=module',
    '-e',
    `
      const { runWorker } = await import('./scripts/worker.mjs');
      const controller = new AbortController();
      process.once('SIGTERM', () => controller.abort());
      await runWorker({
        pool: { async end() {} },
        env: {
          MORSE_ALERTS_ENABLED: 'false',
          MORSE_WORKER_POLL_MS: '100',
          MORSE_WORKER_BACKOFF_MAX_MS: '1000',
        },
        signal: controller.signal,
        cleanupExpired: async () => { throw new Error('private database failure'); },
      });
    `,
  ], {
    cwd: path.resolve('.'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { output += chunk; });
  child.stderr.on('data', (chunk: string) => { output += chunk; });

  try {
    const deadline = Date.now() + 5_000;
    while (!output.includes('WORKER_ITERATION_FAILED') && Date.now() < deadline) {
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.match(output, /WORKER_ITERATION_FAILED/);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(child.exitCode, null, output);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('close', () => resolve());
    });
  }
  assert.doesNotMatch(output, /private database failure/);
});

test('worker runs startup cleanup, skips delivery when disabled and shuts down cleanly', async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const sleeps: number[] = [];
  const pool = {
    async end() { calls.push('pool.end'); },
  };

  await runWorker({
    cleanupExpired: async () => {
      calls.push('cleanup');
      return { skipped: false };
    },
    dispatchAlerts: async () => {
      calls.push('dispatch');
      return { claimed: 0, sent: 0, retryScheduled: 0, failed: 0 };
    },
    env: { MORSE_ALERTS_ENABLED: 'false' },
    logger: { log() {}, error() {} },
    pool,
    signal: controller.signal,
    sleep: async (milliseconds: number) => {
      sleeps.push(milliseconds);
      controller.abort();
    },
  });

  assert.deepEqual(calls, ['cleanup', 'pool.end']);
  assert.deepEqual(sleeps, [5_000]);
});

test('worker backs off infrastructure failures and emits only stable event codes', async () => {
  const controller = new AbortController();
  const sleeps: number[] = [];
  const errors: unknown[] = [];
  let attempts = 0;

  await runWorker({
    cleanupExpired: async () => ({ skipped: false }),
    dispatchAlerts: async () => {
      attempts += 1;
      throw new Error(`private failure ${attempts}`);
    },
    env: {
      MORSE_ALERTS_ENABLED: 'true',
      FEISHU_WEBHOOK_URL: 'https://feishu.example/hook/test',
    },
    logger: { log() {}, error(value: unknown) { errors.push(value); } },
    pool: { async end() {} },
    signal: controller.signal,
    sleep: async (milliseconds: number) => {
      sleeps.push(milliseconds);
      if (sleeps.length === 2) controller.abort();
    },
  });

  assert.deepEqual(sleeps, [5_000, 10_000]);
  assert.deepEqual(errors, ['WORKER_ITERATION_FAILED', 'WORKER_ITERATION_FAILED']);
});
