import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';

import pg from 'pg';

import {
  FeishuAlertError,
  FeishuAlertProvider,
  type FeishuFetch,
} from '../lib/server/feishu-alert-provider.ts';
import {
  dispatchAvailableAlerts,
  dispatchNextAlert,
  main as dispatchMain,
} from '../scripts/dispatch-alerts.mjs';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const now = new Date('2035-04-01T09:00:00.000Z');
const expiresAt = new Date('2035-04-11T09:00:00.000Z');

let database: Awaited<ReturnType<typeof createDisposablePostgresDatabase>>;
let pool: InstanceType<typeof Pool>;

async function runMigrations(connectionString: string): Promise<void> {
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [migrationRunner], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
}

async function insertAlert(label: string): Promise<string> {
  const dedupeKey = `feishu-test:${label}:${randomUUID()}`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO alert_outbox
      (dedupe_key, category, payload, available_at, expires_at, created_at, updated_at)
     VALUES ($1, 'diagnosis_complete', $2::jsonb, $3, $4, $3, $3)
     RETURNING id`,
    [dedupeKey, JSON.stringify({ diagnosisId: label }), now, expiresAt],
  );
  return result.rows[0].id;
}

before(async () => {
  database = await createDisposablePostgresDatabase();
  await runMigrations(database.connectionString);
  pool = new Pool({ connectionString: database.connectionString });
});

after(async () => {
  await pool?.end();
  await database?.dispose();
});

test('FeishuAlertProvider posts only to its configured webhook and returns on success', async () => {
  const webhookUrl = 'https://open.feishu.test/open-apis/bot/v2/hook/configured-value';
  const privateMarker = 'private-diagnosis-marker';
  let requestedUrl = '';
  let requestInit: RequestInit | undefined;
  const fetcher: FeishuFetch = async (input, init) => {
    requestedUrl = String(input);
    requestInit = init;
    return new Response('{"code":0}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const provider = new FeishuAlertProvider({ webhookUrl, timeoutMs: 100 }, fetcher);

  await provider.send({
    dedupeKey: 'diagnosis-complete:test-id',
    category: 'diagnosis_complete',
    payload: { diagnosisId: privateMarker },
  });

  assert.equal(requestedUrl, webhookUrl);
  assert.equal(requestInit?.method, 'POST');
  assert.equal(requestInit?.redirect, 'error');
  assert.equal((requestInit?.headers as Record<string, string>)['Content-Type'], 'application/json');
  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.msg_type, 'interactive');
  assert.equal(body.card.schema, '2.0');
  assert.match(body.card.header.title.content, /数字摩斯/);
  assert.match(body.card.header.title.content, /需求初诊/);
  assert.match(body.card.body.elements[0].content, /diagnosis_complete/);
  assert.match(body.card.body.elements[0].content, /diagnosis-complete:test-id/);
  assert.match(body.card.body.elements[0].content, new RegExp(privateMarker));
});

test('FeishuAlertProvider maps non-2xx and timeout failures without logging private values', async () => {
  const webhookUrl = 'https://open.feishu.test/open-apis/bot/v2/hook/never-log-this';
  const privateMarker = 'never-log-private-payload';
  const logs: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...values: unknown[]) => { logs.push(values.join(' ')); };
  console.log = (...values: unknown[]) => { logs.push(values.join(' ')); };

  try {
    const non2xx = new FeishuAlertProvider({ webhookUrl, timeoutMs: 100 }, async () => (
      new Response('temporary unavailable', { status: 503 })
    ));
    await assert.rejects(
      () => non2xx.send({
        dedupeKey: 'service-down:test',
        category: 'service_down',
        payload: { incidentId: privateMarker },
      }),
      (error: unknown) => (
        error instanceof FeishuAlertError
        && error.code === 'FEISHU_HTTP_ERROR'
        && !error.message.includes(webhookUrl)
        && !error.message.includes(privateMarker)
      ),
    );

    const neverSettles: FeishuFetch = async () => new Promise<Response>(() => undefined);
    const timeout = new FeishuAlertProvider({ webhookUrl, timeoutMs: 5 }, neverSettles);
    await assert.rejects(
      () => timeout.send({
        dedupeKey: 'service-down:timeout',
        category: 'service_down',
        payload: { incidentId: privateMarker },
      }),
      (error: unknown) => error instanceof FeishuAlertError && error.code === 'FEISHU_TIMEOUT',
    );
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }

  assert.deepEqual(logs, []);
});

test('FeishuAlertProvider rejects HTTP 200 business failures and malformed bodies', async () => {
  const webhookUrl = 'https://open.feishu.test/open-apis/bot/v2/hook/business-contract';
  const businessFailure = new FeishuAlertProvider({ webhookUrl, timeoutMs: 100 }, async () => (
    new Response('{"code":19001,"msg":"rejected"}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ));
  await assert.rejects(
    () => businessFailure.send({
      dedupeKey: 'service-down:business-failure',
      category: 'service_down',
      payload: { incidentId: 'incident-business-failure' },
    }),
    (error: unknown) => (
      error instanceof FeishuAlertError && error.code === 'FEISHU_API_ERROR'
    ),
  );

  const malformed = new FeishuAlertProvider({ webhookUrl, timeoutMs: 100 }, async () => (
    new Response('not-json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ));
  await assert.rejects(
    () => malformed.send({
      dedupeKey: 'service-down:malformed',
      category: 'service_down',
      payload: { incidentId: 'incident-malformed' },
    }),
    (error: unknown) => (
      error instanceof FeishuAlertError && error.code === 'FEISHU_RESPONSE_INVALID'
    ),
  );
});

test('dispatcher retries an HTTP 200 Feishu business failure instead of marking it sent', async () => {
  const alertId = await insertAlert('http-200-business-failure');
  const provider = new FeishuAlertProvider({
    webhookUrl: 'https://open.feishu.test/open-apis/bot/v2/hook/business-retry',
    timeoutMs: 100,
  }, async () => (
    new Response('{"code":19001,"msg":"rejected"}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ));

  try {
    const availableAt = new Date(now.getTime() + 60_000);
    assert.deepEqual(await dispatchNextAlert({
      pool,
      provider,
      now,
      maxDeliveryAttempts: 2,
      retryBaseMs: 60_000,
    }), {
      kind: 'retry_scheduled',
      alertId,
      attemptCount: 1,
      availableAt,
    });
    const stored = await pool.query<{
      status: string;
      attempt_count: number;
      available_at: Date;
    }>('SELECT status, attempt_count, available_at FROM alert_outbox WHERE id = $1', [alertId]);
    assert.deepEqual(stored.rows[0], {
      status: 'pending',
      attempt_count: 1,
      available_at: availableAt,
    });
  } finally {
    await pool.query('DELETE FROM alert_outbox WHERE id = $1', [alertId]);
  }
});

test('dispatcher commits a SKIP LOCKED claim before send and replay never sends a sent row twice', {
  timeout: 10_000,
}, async () => {
  const alertId = await insertAlert('single-claim');
  let sendCalls = 0;
  let releaseSend!: () => void;
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const sendGate = new Promise<void>((resolve) => { releaseSend = resolve; });
  const provider = {
    async send() {
      sendCalls += 1;
      markEntered();
      await sendGate;
    },
  };

  const firstDispatch = dispatchNextAlert({
    pool,
    provider,
    now,
    maxDeliveryAttempts: 3,
    retryBaseMs: 60_000,
  });
  await entered;

  const claimed = await pool.query<{
    status: string;
    attempt_count: number;
    last_attempt_at: Date;
  }>(
    'SELECT status, attempt_count, last_attempt_at FROM alert_outbox WHERE id = $1',
    [alertId],
  );
  assert.deepEqual(claimed.rows[0], {
    status: 'sending',
    attempt_count: 1,
    last_attempt_at: now,
  });

  const contender = await dispatchNextAlert({ pool, provider, now });
  assert.deepEqual(contender, { kind: 'idle' });
  releaseSend();
  assert.deepEqual(await firstDispatch, {
    kind: 'sent',
    alertId,
    attemptCount: 1,
  });
  assert.deepEqual(await dispatchNextAlert({ pool, provider, now }), { kind: 'idle' });
  assert.equal(sendCalls, 1);

  const sent = await pool.query<{
    status: string;
    attempt_count: number;
    sent_at: Date;
  }>('SELECT status, attempt_count, sent_at FROM alert_outbox WHERE id = $1', [alertId]);
  assert.deepEqual(sent.rows[0], { status: 'sent', attempt_count: 1, sent_at: now });
});

test('dispatcher schedules bounded durable retries and stops after the configured attempt cap', async () => {
  const alertId = await insertAlert('bounded-retries');
  let sendCalls = 0;
  const provider = {
    async send() {
      sendCalls += 1;
      throw new FeishuAlertError('FEISHU_HTTP_ERROR');
    },
  };

  const first = await dispatchNextAlert({
    pool,
    provider,
    now,
    maxDeliveryAttempts: 2,
    retryBaseMs: 60_000,
  });
  const retryAt = new Date(now.getTime() + 60_000);
  assert.deepEqual(first, {
    kind: 'retry_scheduled',
    alertId,
    attemptCount: 1,
    availableAt: retryAt,
  });
  assert.deepEqual(await dispatchNextAlert({
    pool,
    provider,
    now: new Date(retryAt.getTime() - 1),
    maxDeliveryAttempts: 2,
    retryBaseMs: 60_000,
  }), { kind: 'idle' });

  const second = await dispatchNextAlert({
    pool,
    provider,
    now: retryAt,
    maxDeliveryAttempts: 2,
    retryBaseMs: 60_000,
  });
  assert.deepEqual(second, {
    kind: 'failed',
    alertId,
    attemptCount: 2,
  });
  assert.deepEqual(await dispatchNextAlert({
    pool,
    provider,
    now: new Date(retryAt.getTime() + 60_000),
    maxDeliveryAttempts: 2,
    retryBaseMs: 60_000,
  }), { kind: 'idle' });
  assert.equal(sendCalls, 2);

  const failed = await pool.query<{
    status: string;
    attempt_count: number;
    available_at: Date;
  }>('SELECT status, attempt_count, available_at FROM alert_outbox WHERE id = $1', [alertId]);
  assert.deepEqual(failed.rows[0], {
    status: 'failed',
    attempt_count: 2,
    available_at: retryAt,
  });
});

test('dispatcher reclaims an expired sending lease and a stale worker cannot overwrite the new claim', {
  timeout: 10_000,
}, async () => {
  const alertId = await insertAlert('stale-lease');
  const leaseMs = 1_000;
  const leaseAt = new Date(now.getTime() + leaseMs);
  let releaseStale!: () => void;
  let markStaleEntered!: () => void;
  const staleEntered = new Promise<void>((resolve) => { markStaleEntered = resolve; });
  const staleGate = new Promise<void>((resolve) => { releaseStale = resolve; });
  const staleProvider = {
    async send() {
      markStaleEntered();
      await staleGate;
      throw new FeishuAlertError('FEISHU_TIMEOUT');
    },
  };
  const staleDispatch = dispatchNextAlert({
    pool,
    provider: staleProvider,
    now,
    claimLeaseMs: leaseMs,
    maxDeliveryAttempts: 3,
  });
  await staleEntered;

  try {
    const leased = await pool.query<{ available_at: Date }>(
      'SELECT available_at FROM alert_outbox WHERE id = $1',
      [alertId],
    );
    assert.equal(leased.rows[0].available_at.getTime(), leaseAt.getTime());
    assert.deepEqual(await dispatchNextAlert({
      pool,
      provider: { async send() { assert.fail('lease is not stale yet'); } },
      now: new Date(leaseAt.getTime() - 1),
      claimLeaseMs: leaseMs,
      maxDeliveryAttempts: 3,
    }), { kind: 'idle' });

    let recoveredSends = 0;
    const recovered = await dispatchNextAlert({
      pool,
      provider: { async send() { recoveredSends += 1; } },
      now: leaseAt,
      claimLeaseMs: leaseMs,
      maxDeliveryAttempts: 3,
    });
    assert.deepEqual(recovered, {
      kind: 'sent',
      alertId,
      attemptCount: 2,
    });
    assert.equal(recoveredSends, 1);
  } finally {
    releaseStale();
  }

  await assert.rejects(staleDispatch, /ALERT_OUTBOX_STATE_CONFLICT/);
  const finalState = await pool.query<{
    status: string;
    attempt_count: number;
    sent_at: Date;
  }>('SELECT status, attempt_count, sent_at FROM alert_outbox WHERE id = $1', [alertId]);
  assert.deepEqual(finalState.rows[0], {
    status: 'sent',
    attempt_count: 2,
    sent_at: leaseAt,
  });
});

test('batch dispatcher gets a fresh clock value for every claim lease', async () => {
  await insertAlert('fresh-batch-clock-1');
  await insertAlert('fresh-batch-clock-2');
  const secondClaimAt = new Date(now.getTime() + 25_000);
  const claimTimes = [now, secondClaimAt];
  let clockCalls = 0;

  const summary = await dispatchAvailableAlerts({
    pool,
    provider: { async send() {} },
    clock() {
      const value = claimTimes[clockCalls];
      clockCalls += 1;
      return value;
    },
    limit: 2,
    claimLeaseMs: 30_000,
  });
  assert.deepEqual(summary, { claimed: 2, sent: 2, retryScheduled: 0, failed: 0 });
  assert.equal(clockCalls, 2);

  const leases = await pool.query<{ available_at: Date }>(
    `SELECT available_at
       FROM alert_outbox
      WHERE payload ->> 'diagnosisId' LIKE 'fresh-batch-clock-%'
      ORDER BY id`,
  );
  assert.deepEqual(leases.rows.map((row) => row.available_at), [
    new Date(now.getTime() + 30_000),
    new Date(secondClaimAt.getTime() + 30_000),
  ]);
});

test('an expired sending lease already at the attempt cap becomes failed without another send', async () => {
  const alertId = await insertAlert('stale-at-cap');
  const staleAt = new Date(now.getTime() - 60_000);
  await pool.query(
    `UPDATE alert_outbox
        SET status = 'sending',
            attempt_count = 2,
            last_attempt_at = $2,
            available_at = $2
      WHERE id = $1`,
    [alertId, staleAt],
  );
  let sendCalls = 0;

  const result = await dispatchNextAlert({
    pool,
    provider: { async send() { sendCalls += 1; } },
    now,
    maxDeliveryAttempts: 2,
  });
  assert.deepEqual(result, { kind: 'failed', alertId, attemptCount: 2 });
  assert.equal(sendCalls, 0);
  const failed = await pool.query<{
    status: string;
    attempt_count: number;
    available_at: Date;
  }>('SELECT status, attempt_count, available_at FROM alert_outbox WHERE id = $1', [alertId]);
  assert.deepEqual(failed.rows[0], {
    status: 'failed',
    attempt_count: 2,
    available_at: now,
  });
});

test('dispatcher module is import-safe and exposes an explicit main entry', () => {
  assert.equal(typeof dispatchMain, 'function');
});
