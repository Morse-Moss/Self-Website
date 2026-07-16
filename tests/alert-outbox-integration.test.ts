import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';

import pg from 'pg';

import { enqueueAlert } from '../lib/server/alert-service.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const now = new Date('2035-03-01T09:00:00.000Z');
const tenDaysLater = new Date('2035-03-11T09:00:00.000Z');

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

before(async () => {
  database = await createDisposablePostgresDatabase();
  await runMigrations(database.connectionString);
  pool = new Pool({ connectionString: database.connectionString });
});

after(async () => {
  await pool?.end();
  await database?.dispose();
});

test('enqueueAlert commits one pending row with a default ten-day expiry', async () => {
  const client = await pool.connect();
  const dedupeKey = `test-default-expiry:${randomUUID()}`;
  try {
    await client.query('BEGIN');
    const inserted = await enqueueAlert(client, {
      dedupeKey,
      category: 'integration_test',
      payload: { eventId: 'default-expiry' },
      now,
    });
    await client.query('COMMIT');
    assert.equal(inserted, true);
  } finally {
    client.release();
  }

  const result = await pool.query<{
    category: string;
    payload: Record<string, unknown>;
    status: string;
    attempt_count: number;
    available_at: Date;
    expires_at: Date;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT category, payload, status, attempt_count, available_at,
            expires_at, created_at, updated_at
       FROM alert_outbox
      WHERE dedupe_key = $1`,
    [dedupeKey],
  );

  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.rows[0], {
    category: 'integration_test',
    payload: { eventId: 'default-expiry' },
    status: 'pending',
    attempt_count: 0,
    available_at: now,
    expires_at: tenDaysLater,
    created_at: now,
    updated_at: now,
  });
});

test('enqueueAlert keeps the first row when the stable dedupe key is replayed', async () => {
  const client = await pool.connect();
  const dedupeKey = `test-dedupe:${randomUUID()}`;
  try {
    await client.query('BEGIN');
    const first = await enqueueAlert(client, {
      dedupeKey,
      category: 'first_category',
      payload: { eventId: 'first' },
      now,
      expiresAt: tenDaysLater,
    });
    const replay = await enqueueAlert(client, {
      dedupeKey,
      category: 'must_not_replace',
      payload: { eventId: 'replay' },
      now: new Date(now.getTime() + 60_000),
      expiresAt: new Date(tenDaysLater.getTime() + 60_000),
    });
    await client.query('COMMIT');
    assert.equal(first, true);
    assert.equal(replay, false);
  } finally {
    client.release();
  }

  const result = await pool.query<{
    category: string;
    payload: Record<string, unknown>;
    expires_at: Date;
  }>(
    `SELECT category, payload, expires_at
       FROM alert_outbox
      WHERE dedupe_key = $1`,
    [dedupeKey],
  );
  assert.deepEqual(result.rows, [{
    category: 'first_category',
    payload: { eventId: 'first' },
    expires_at: tenDaysLater,
  }]);
});

test('enqueueAlert participates in the caller transaction and leaves no row after rollback', async () => {
  const client = await pool.connect();
  const dedupeKey = `test-rollback:${randomUUID()}`;
  try {
    await client.query('BEGIN');
    assert.equal(await enqueueAlert(client, {
      dedupeKey,
      category: 'rolled_back',
      payload: { eventId: 'rollback' },
      now,
    }), true);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  const result = await pool.query(
    'SELECT id FROM alert_outbox WHERE dedupe_key = $1',
    [dedupeKey],
  );
  assert.equal(result.rowCount, 0);
});
