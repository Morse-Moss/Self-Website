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

test('cleanup deletes expired AI config events in the locked transaction and reports the count', async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] };
      if (sql.includes('to_regprocedure')) {
        return {
          rows: [{
            cleanup_at: '2035-01-01T00:00:00.000Z',
            compaction_cleanup_available: true,
          }],
        };
      }
      if (sql.includes('cleanup_expired_chat_history_compactions')) {
        return {
          rows: [{
            cleanup_at: '2035-01-01T00:00:00.000Z',
            deleted_compactions: '0',
            deleted_attempts: '0',
          }],
        };
      }
      return { rowCount: sql.includes('DELETE FROM ai_config_events') ? 2 : 0, rows: [] };
    },
    release() {},
  };

  const result = await cleanupExpired({
    now: new Date('2035-01-01T00:00:00.000Z'),
    pool: { async connect() { return client; } },
  });

  assert.equal(result.deletedAiConfigEvents, 2);
  const deleteIndex = queries.findIndex((query) => query.includes('DELETE FROM ai_config_events'));
  assert.ok(deleteIndex > queries.findIndex((query) => query.includes('pg_try_advisory_xact_lock')));
  assert.ok(deleteIndex < queries.indexOf('COMMIT'));
});

test('cleanup uses the database compaction cutoff before retaining or deleting parent rows', async () => {
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  const cleanupAt = '2035-01-02T03:04:05.000Z';
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      queries.push({ sql, values });
      if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] };
      if (sql.includes('to_regprocedure')) {
        return { rows: [{ cleanup_at: cleanupAt, compaction_cleanup_available: true }] };
      }
      if (sql.includes('cleanup_expired_chat_history_compactions')) {
        return {
          rows: [{
            cleanup_at: cleanupAt,
            deleted_compactions: '2',
            deleted_attempts: '1',
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };

  const result = await cleanupExpired({
    now: new Date('2030-01-01T00:00:00.000Z'),
    pool: { async connect() { return client; } },
  });

  const lockIndex = queries.findIndex(({ sql }) => sql.includes('pg_try_advisory_xact_lock'));
  const compactionCleanupIndex = queries.findIndex(
    ({ sql }) => (
      sql.includes('cleanup_expired_chat_history_compactions') && !sql.includes('to_regprocedure')
    ),
  );
  const schemaProbeIndex = queries.findIndex(({ sql }) => sql.includes('to_regprocedure'));
  const turnDeleteIndex = queries.findIndex(({ sql }) => /DELETE FROM interaction_turns AS turn/u.test(sql));
  const sessionDeleteIndex = queries.findIndex(({ sql }) => /DELETE FROM access_sessions AS session/u.test(sql));

  assert.equal(schemaProbeIndex, lockIndex + 1);
  assert.equal(compactionCleanupIndex, schemaProbeIndex + 1);
  assert.ok(turnDeleteIndex > compactionCleanupIndex);
  assert.ok(sessionDeleteIndex > turnDeleteIndex);
  assert.match(queries[turnDeleteIndex].sql, /chat_history_summary_attempts/u);
  assert.match(queries[turnDeleteIndex].sql, /conversation_history_compactions/u);
  assert.match(queries[sessionDeleteIndex].sql, /chat_history_summary_attempts/u);
  assert.match(queries[sessionDeleteIndex].sql, /conversation_history_compactions/u);
  assert.deepEqual(queries[turnDeleteIndex].values, [cleanupAt]);
  assert.deepEqual(queries[sessionDeleteIndex].values, [cleanupAt]);
  assert.equal(
    queries.some(({ sql }) => /DELETE FROM (?:chat_history_summary_attempts|conversation_history_compactions)/u.test(sql)),
    false,
  );
  assert.equal(result.deletedCompactions, 2);
  assert.equal(result.deletedSummaryAttempts, 1);
});

test('schema 012 cleanup uses the database clock without referencing migration 013 tables', async () => {
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  const cleanupAt = '2035-01-03T03:04:05.000Z';
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      queries.push({ sql, values });
      if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] };
      if (sql.includes('to_regprocedure')) {
        return { rows: [{ cleanup_at: cleanupAt, compaction_cleanup_available: false }] };
      }
      if (/chat_history_|cleanup_expired_chat_history_compactions/u.test(sql)) {
        throw new Error('schema 012 private object referenced');
      }
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };

  const result = await cleanupExpired({
    now: new Date('2030-01-01T00:00:00.000Z'),
    pool: { async connect() { return client; } },
  });

  assert.equal(result.deletedCompactions, 0);
  assert.equal(result.deletedSummaryAttempts, 0);
  const turnDelete = queries.find(({ sql }) => /DELETE FROM interaction_turns AS turn/u.test(sql));
  const sessionDelete = queries.find(({ sql }) => /DELETE FROM access_sessions AS session/u.test(sql));
  assert.deepEqual(turnDelete?.values, [cleanupAt]);
  assert.deepEqual(sessionDelete?.values, [cleanupAt]);
  assert.doesNotMatch(
    queries.filter(({ sql }) => !sql.includes('to_regprocedure')).map(({ sql }) => sql).join('\n'),
    /chat_history_/u,
  );
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

test('worker cleans private resume storage with an explicit path and no resume config load', async () => {
  const controller = new AbortController();
  const calls: Array<{ storageDir: string; now: Date }> = [];

  await runWorker({
    cleanupExpired: async () => ({ skipped: false }),
    cleanupResumeStorage: async ({ storageDir, now }: { storageDir: string; now: Date }) => {
      calls.push({ storageDir, now });
      return { deletedFiles: 0, retainedFiles: 0, deletedTempFiles: 0 };
    },
    env: {
      MORSE_ALERTS_ENABLED: 'false',
      MORSE_RESUME_STORAGE_DIR: '/opt/revolution/shared/private/resume',
    },
    logger: { log() {}, error() {} },
    pool: { async end() {} },
    signal: controller.signal,
    clock: () => 1_735_689_600_000,
    sleep: async () => { controller.abort(); },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].storageDir, '/opt/revolution/shared/private/resume');
  assert.equal(calls[0].now.toISOString(), '2025-01-01T00:00:00.000Z');
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
