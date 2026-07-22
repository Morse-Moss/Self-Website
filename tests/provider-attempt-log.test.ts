import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';

import pg from 'pg';

import {
  recordProviderAttemptEvent,
  reserveHedgedProviderAttempt,
  summarizeProviderAttempts,
} from '../lib/server/provider-attempt-log.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const DAY_MS = 24 * 60 * 60 * 1_000;

async function runMigrations(connectionString: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [migrationRunner], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `Migration runner exited with ${code}.`));
    });
  });
}

async function insertTurn(
  pool: InstanceType<typeof Pool>,
  input: {
    completedAt?: Date;
    id?: string;
    status?: 'running' | 'completed';
    workflow?: 'chat' | 'jd_match' | 'diagnosis';
  } = {},
): Promise<string> {
  const id = input.id ?? randomUUID();
  const startedAt = input.completedAt
    ? new Date(input.completedAt.getTime() - 1_000)
    : new Date('2026-07-22T00:00:00.000Z');
  await pool.query(
    `INSERT INTO interaction_turns
      (id, access_session_id, workflow, audience_intent, question, status,
       created_at, completed_at, delete_after)
     VALUES ($1, $2, $3, 'general', 'synthetic fixture', $4, $5, $6, $7)`,
    [
      id,
      randomUUID(),
      input.workflow ?? 'chat',
      input.status ?? 'running',
      startedAt,
      input.completedAt ?? null,
      new Date(startedAt.getTime() + 10 * DAY_MS),
    ],
  );
  return id;
}

test('provider attempt events upsert one metadata-only lifecycle and cascade with the turn', async () => {
  const database = await createDisposablePostgresDatabase();
  const pool = new Pool({ connectionString: database.connectionString });
  try {
    await runMigrations(database.connectionString);
    const interactionTurnId = await insertTurn(pool);
    const executionId = randomUUID();
    const startedAt = new Date('2026-07-22T01:02:03.000Z');
    const deleteAfter = new Date(startedAt.getTime() + 10 * DAY_MS);
    const client = await pool.connect();
    try {
      const key = { interactionTurnId, executionId };
      await recordProviderAttemptEvent(client, key, {
        type: 'started',
        attemptNo: 1,
        providerAlias: 'primary',
        launchKind: 'primary',
        startedAt,
        startDelayMs: 0,
      }, deleteAfter);
      await recordProviderAttemptEvent(client, key, {
        type: 'first_byte',
        attemptNo: 1,
        providerAlias: 'primary',
        firstByteMs: 125,
      }, deleteAfter);
      await recordProviderAttemptEvent(client, key, {
        type: 'completed',
        attemptNo: 1,
        providerAlias: 'primary',
        durationMs: 600,
        winner: true,
        errorCode: null,
        usage: { inputTokens: 100, outputTokens: 20 },
        estimatedCostUsd: 0.00014,
      }, deleteAfter);
      await assert.rejects(
        recordProviderAttemptEvent(client, key, {
          type: 'failed',
          attemptNo: 1,
          providerAlias: 'primary',
          durationMs: 700,
          winner: false,
          errorCode: 'LATE_FAILURE',
          usage: null,
        }, deleteAfter),
        /terminal|transition/i,
      );
    } finally {
      client.release();
    }

    const stored = await pool.query<{
      completed_at: Date;
      delete_after: Date;
      duration_ms: number;
      error_code: string | null;
      estimated_cost_usd: string;
      first_byte_ms: number;
      input_tokens: number;
      launch_kind: string;
      output_tokens: number;
      provider_alias: string;
      status: string;
      winner: boolean;
    }>(
      `SELECT provider_alias, launch_kind, status, winner, first_byte_ms, duration_ms,
              error_code, input_tokens, output_tokens, estimated_cost_usd::text,
              completed_at, delete_after
         FROM chat_provider_attempts
        WHERE interaction_turn_id = $1 AND execution_id = $2 AND attempt_no = 1`,
      [interactionTurnId, executionId],
    );
    assert.deepEqual(stored.rows[0], {
      provider_alias: 'primary',
      launch_kind: 'primary',
      status: 'completed',
      winner: true,
      first_byte_ms: 125,
      duration_ms: 600,
      error_code: null,
      input_tokens: 100,
      output_tokens: 20,
      estimated_cost_usd: '0.000140',
      completed_at: new Date(startedAt.getTime() + 600),
      delete_after: deleteAfter,
    });

    const summaryClient = await pool.connect();
    try {
      assert.deepEqual(
        await summarizeProviderAttempts(summaryClient, interactionTurnId),
        {
          attemptCount: 1,
          costComplete: true,
          estimatedCostUsd: 0.00014,
          usage: { inputTokens: 100, outputTokens: 20 },
          usageComplete: true,
        },
      );
    } finally {
      summaryClient.release();
    }

    await pool.query('DELETE FROM interaction_turns WHERE id = $1', [interactionTurnId]);
    const afterDelete = await pool.query(
      'SELECT 1 FROM chat_provider_attempts WHERE interaction_turn_id = $1',
      [interactionTurnId],
    );
    assert.equal(afterDelete.rowCount, 0);
  } finally {
    await pool.end();
    await database.dispose();
  }
});

test('hedge reservation is atomic at 15 percent while serial failover remains recordable', async () => {
  const database = await createDisposablePostgresDatabase();
  const pool = new Pool({ connectionString: database.connectionString, max: 4 });
  try {
    await runMigrations(database.connectionString);
    const now = new Date('2026-07-22T12:00:00.000Z');
    for (let index = 0; index < 5; index += 1) {
      await insertTurn(pool, {
        completedAt: new Date(now.getTime() - (index + 1) * 60_000),
        status: 'completed',
      });
    }
    const interactionTurnId = await insertTurn(pool);
    const deleteAfter = new Date(now.getTime() + 10 * DAY_MS);
    await insertTurn(pool, {
      completedAt: new Date(now.getTime() - 6 * 60_000),
      status: 'completed',
      workflow: 'diagnosis',
    });
    const beforeMinimumClient = await pool.connect();
    try {
      const beforeMinimum = await reserveHedgedProviderAttempt(
        beforeMinimumClient,
        { interactionTurnId, executionId: randomUUID() },
        {
          type: 'started',
          attemptNo: 2,
          providerAlias: 'fallback-1',
          launchKind: 'hedge',
          startedAt: now,
          startDelayMs: 8_000,
        },
        deleteAfter,
        now,
      );
      assert.equal(beforeMinimum, false, 'diagnosis turns must not inflate the chat hedge budget');
    } finally {
      beforeMinimumClient.release();
    }
    await insertTurn(pool, {
      completedAt: new Date(now.getTime() - 7 * 60_000),
      status: 'completed',
    });
    const firstClient = await pool.connect();
    const secondClient = await pool.connect();
    try {
      const reservations = await Promise.all([
        reserveHedgedProviderAttempt(
          firstClient,
          { interactionTurnId, executionId: randomUUID() },
          {
            type: 'started',
            attemptNo: 2,
            providerAlias: 'fallback-1',
            launchKind: 'hedge',
            startedAt: now,
            startDelayMs: 8_000,
          },
          deleteAfter,
          now,
        ),
        reserveHedgedProviderAttempt(
          secondClient,
          { interactionTurnId, executionId: randomUUID() },
          {
            type: 'started',
            attemptNo: 2,
            providerAlias: 'fallback-2',
            launchKind: 'hedge',
            startedAt: now,
            startDelayMs: 14_000,
          },
          deleteAfter,
          now,
        ),
      ]);
      assert.deepEqual(reservations.sort(), [false, true]);
    } finally {
      firstClient.release();
      secondClient.release();
    }

    const failoverClient = await pool.connect();
    try {
      const key = { interactionTurnId, executionId: randomUUID() };
      await recordProviderAttemptEvent(failoverClient, key, {
        type: 'started',
        attemptNo: 3,
        providerAlias: 'fallback-2',
        launchKind: 'failover',
        startedAt: new Date(now.getTime() + 1_000),
        startDelayMs: 15_000,
      }, deleteAfter);
      await recordProviderAttemptEvent(failoverClient, key, {
        type: 'failed',
        attemptNo: 3,
        providerAlias: 'fallback-2',
        durationMs: 450,
        winner: false,
        errorCode: 'PROVIDER_TIMEOUT',
        usage: null,
      }, deleteAfter);
    } finally {
      failoverClient.release();
    }

    const attempts = await pool.query<{
      error_code: string | null;
      launch_kind: string;
      status: string;
    }>(
      `SELECT launch_kind, status, error_code
         FROM chat_provider_attempts
        WHERE interaction_turn_id = $1
        ORDER BY launch_kind`,
      [interactionTurnId],
    );
    assert.deepEqual(attempts.rows, [
      { launch_kind: 'failover', status: 'failed', error_code: 'PROVIDER_TIMEOUT' },
      { launch_kind: 'hedge', status: 'started', error_code: null },
    ]);
  } finally {
    await pool.end();
    await database.dispose();
  }
});
