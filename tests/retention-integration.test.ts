import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import type { PoolClient } from 'pg';

import { restartInteraction } from '../lib/server/interaction-log.ts';
import {
  createDisposablePostgresDatabase,
  withPostgresClient,
} from './postgres-test-utils.ts';

const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const cleanupRunner = path.join(repoRoot, 'scripts', 'cleanup-expired.mjs');

interface ScriptResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

interface CleanupCounts {
  deactivatedInvites: number;
  deletedAccessAttempts: number;
  deletedAdminSessions: number;
  deletedAlertOutbox: number;
  deletedDiagnoses: number;
  deletedInteractionSearches: number;
  deletedInteractionTurns: number;
  deletedSessions: number;
}

async function runScript(
  script: string,
  environment: Record<string, string>,
): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: repoRoot,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function runCleanup(
  connectionString: string,
  cleanupNow: string,
  privateFixtures: string[],
): Promise<CleanupCounts> {
  const result = await runScript(cleanupRunner, {
    DATABASE_URL: connectionString,
    MORSE_CLEANUP_NOW: cleanupNow,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
  for (const fixture of privateFixtures) {
    assert.doesNotMatch(result.stdout, new RegExp(fixture));
  }
  const counts = JSON.parse(result.stdout) as CleanupCounts;
  assert.equal(result.stdout.trim(), JSON.stringify(counts));
  return counts;
}

const zeroCounts: CleanupCounts = {
  deletedSessions: 0,
  deactivatedInvites: 0,
  deletedInteractionSearches: 0,
  deletedDiagnoses: 0,
  deletedInteractionTurns: 0,
  deletedAdminSessions: 0,
  deletedAlertOutbox: 0,
  deletedAccessAttempts: 0,
};

interface InteractionRetentionRow {
  created_at: Date;
  delete_after: Date;
  status: string;
}

test('same-turn stopped and failed retries preserve the first problem retention deadline', async () => {
  const database = await createDisposablePostgresDatabase();
  const firstProblemAt = new Date('2035-02-01T09:00:00.000Z');
  const firstProblemDeadline = new Date('2035-02-11T09:00:00.000Z');
  const tenDaysMs = 10 * 24 * 60 * 60 * 1000;

  try {
    const migration = await runScript(migrationRunner, {
      DATABASE_URL: database.connectionString,
    });
    assert.equal(migration.code, 0, migration.stderr);

    await withPostgresClient(database.connectionString, async (client) => {
      for (const status of ['stopped', 'failed'] as const) {
        const turnId = randomUUID();
        await client.query(
          `INSERT INTO interaction_turns
            (id, access_session_id, conversation_id, workflow, audience_intent,
             question, answer, status, error_code, created_at, completed_at, delete_after)
           VALUES ($1, $2, $3, 'chat', 'general', $4, $5, $6, $7, $8, $9, $10)`,
          [
            turnId,
            randomUUID(),
            randomUUID(),
            `first problem ${status}`,
            `partial answer ${status}`,
            status,
            status === 'stopped' ? 'CLIENT_ABORTED' : 'PROVIDER_ERROR',
            firstProblemAt,
            new Date(firstProblemAt.getTime() + 60_000),
            firstProblemDeadline,
          ],
        );

        const before = await client.query<InteractionRetentionRow>(
          `SELECT created_at, delete_after, status
             FROM interaction_turns
            WHERE id = $1`,
          [turnId],
        );

        await restartInteraction({
          client: client as unknown as PoolClient,
          turnId,
        });

        const after = await client.query<InteractionRetentionRow>(
          `SELECT created_at, delete_after, status
             FROM interaction_turns
            WHERE id = $1`,
          [turnId],
        );

        assert.equal(after.rows[0].status, 'running');
        assert.equal(
          before.rows[0].delete_after.getTime(),
          before.rows[0].created_at.getTime() + tenDaysMs,
        );
        assert.equal(after.rows[0].created_at.getTime(), before.rows[0].created_at.getTime());
        assert.equal(after.rows[0].delete_after.getTime(), before.rows[0].delete_after.getTime());
      }
    });
  } finally {
    await database.dispose();
  }
});

test('cleanup enforces the 12-hour and 10-day retention boundaries idempotently', async () => {
  const database = await createDisposablePostgresDatabase();
  const firstCleanupAt = '2035-01-10T12:00:00.000Z';
  const tenDayCleanupAt = '2035-01-11T12:00:00.000Z';
  const interactionCreatedAt = '2035-01-01T12:00:00.000Z';
  const inviteId = randomUUID();
  const sessionId = randomUUID();
  const conversationId = randomUUID();
  const turnId = randomUUID();
  const searchId = randomUUID();
  const diagnosisId = randomUUID();
  const adminSessionId = randomUUID();
  const documentId = `retention-${randomUUID()}`;
  const privateFixtures = [
    'runtime-message-fixture',
    'interaction-question-fixture',
    'interaction-answer-fixture',
    'search-query-fixture',
    'search-result-fixture',
    'diagnosis-summary-fixture',
    'diagnosis-field-fixture',
    'alert-payload-fixture',
    'knowledge-title-fixture',
  ];

  try {
    const migration = await runScript(migrationRunner, {
      DATABASE_URL: database.connectionString,
    });
    assert.equal(migration.code, 0, migration.stderr);

    await withPostgresClient(database.connectionString, async (client) => {
      await client.query(
        `INSERT INTO knowledge_documents (id, title, source_path, checksum)
         VALUES ($1, $2, $3, $4)`,
        [documentId, privateFixtures[8], `content/${documentId}.json`, 'k'.repeat(64)],
      );
      await client.query(
        `INSERT INTO invite_codes
          (id, code_hash, label, active, expires_at, max_sessions, session_count)
         VALUES ($1, $2, 'retention invite', true, $3, 3, 1)`,
        [inviteId, 'a'.repeat(64), '2035-01-10T11:59:00.000Z'],
      );
      await client.query(
        `INSERT INTO access_sessions
          (id, invite_code_id, token_hash, expires_at, message_count, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, 1, $5, $5)`,
        [
          sessionId,
          inviteId,
          'b'.repeat(64),
          '2035-01-10T11:59:00.000Z',
          '2035-01-10T00:00:00.000Z',
        ],
      );
      await client.query(
        `INSERT INTO conversations
          (id, access_session_id, mode, workflow, audience_intent, expires_at, created_at, updated_at)
         VALUES ($1, $2, 'general', 'chat', 'general', $3, $4, $4)`,
        [
          conversationId,
          sessionId,
          '2035-01-10T11:59:00.000Z',
          '2035-01-10T00:00:00.000Z',
        ],
      );
      await client.query(
        `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
         VALUES ($1, 'user', $2, $3)`,
        [conversationId, privateFixtures[0], '2035-01-10T00:00:00.000Z'],
      );
      await client.query(
        `INSERT INTO interaction_turns
          (id, access_session_id, conversation_id, workflow, audience_intent, question, answer,
           status, created_at, completed_at, delete_after)
         VALUES ($1, $2, $3, 'chat', 'general', $4, $5, 'completed', $6, $6, $7)`,
        [
          turnId,
          sessionId,
          conversationId,
          privateFixtures[1],
          privateFixtures[2],
          interactionCreatedAt,
          tenDayCleanupAt,
        ],
      );
      await client.query(
        `INSERT INTO interaction_searches
          (id, interaction_turn_id, query, route_reason, status, results, created_at, delete_after)
         VALUES ($1, $2, $3, 'recency', 'completed', $4::jsonb, $5, $6)`,
        [
          searchId,
          turnId,
          privateFixtures[3],
          JSON.stringify([{ title: privateFixtures[4] }]),
          interactionCreatedAt,
          tenDayCleanupAt,
        ],
      );
      await client.query(
        `INSERT INTO diagnoses
          (id, interaction_turn_id, access_session_id, conversation_id, fields, summary,
           status, notification_status, created_at, completed_at, delete_after)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'completed', 'pending', $7, $7, $8)`,
        [
          diagnosisId,
          turnId,
          sessionId,
          conversationId,
          JSON.stringify({ detail: privateFixtures[6] }),
          privateFixtures[5],
          interactionCreatedAt,
          tenDayCleanupAt,
        ],
      );
      await client.query(
        `INSERT INTO admin_sessions (id, token_hash, created_at, last_seen_at, expires_at)
         VALUES ($1, $2, $3, $3, $4)`,
        [
          adminSessionId,
          'c'.repeat(64),
          '2035-01-09T12:00:00.000Z',
          '2035-01-10T11:59:00.000Z',
        ],
      );
      await client.query(
        `INSERT INTO alert_outbox
          (dedupe_key, category, payload, status, available_at, expires_at, created_at, updated_at)
         VALUES ('retention-alert', 'retention', $1::jsonb, 'pending', $2, $3, $2, $2)`,
        [
          JSON.stringify({ body: privateFixtures[7] }),
          '2035-01-09T12:00:00.000Z',
          '2035-01-10T11:59:00.000Z',
        ],
      );
      await client.query(
        `INSERT INTO access_attempts
          (scope, fingerprint_hash, succeeded, attempted_at, expires_at)
         VALUES ('invite', $1, false, $2, $3)`,
        [
          'd'.repeat(64),
          '2035-01-10T11:00:00.000Z',
          '2035-01-10T11:59:00.000Z',
        ],
      );
    });

    const first = await runCleanup(
      database.connectionString,
      firstCleanupAt,
      privateFixtures,
    );
    assert.deepEqual(first, {
      ...zeroCounts,
      deletedSessions: 1,
      deactivatedInvites: 1,
      deletedAdminSessions: 1,
      deletedAlertOutbox: 1,
      deletedAccessAttempts: 1,
    });

    await withPostgresClient(database.connectionString, async (client) => {
      const runtimeRows = await client.query(
        `SELECT
          (SELECT count(*)::integer FROM access_sessions WHERE id = $1) AS sessions,
          (SELECT count(*)::integer FROM conversations WHERE id = $2) AS conversations,
          (SELECT count(*)::integer FROM conversation_messages WHERE conversation_id = $2) AS messages`,
        [sessionId, conversationId],
      );
      assert.deepEqual(runtimeRows.rows[0], { sessions: 0, conversations: 0, messages: 0 });

      const retained = await client.query(
        `SELECT question, answer
           FROM interaction_turns
          WHERE id = $1`,
        [turnId],
      );
      assert.deepEqual(retained.rows, [{
        question: privateFixtures[1],
        answer: privateFixtures[2],
      }]);
      assert.equal((await client.query('SELECT id FROM interaction_searches WHERE id = $1', [searchId])).rowCount, 1);
      assert.equal((await client.query('SELECT id FROM diagnoses WHERE id = $1', [diagnosisId])).rowCount, 1);

      const invite = await client.query<{ active: boolean }>(
        'SELECT active FROM invite_codes WHERE id = $1',
        [inviteId],
      );
      assert.deepEqual(invite.rows, [{ active: false }]);
      assert.equal((await client.query('SELECT id FROM knowledge_documents WHERE id = $1', [documentId])).rowCount, 1);
      assert.deepEqual(
        (await client.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version')).rows,
        [{ version: '001' }, { version: '002' }],
      );
      assert.equal((await client.query('SELECT id FROM admin_sessions')).rowCount, 0);
      assert.equal((await client.query('SELECT id FROM alert_outbox')).rowCount, 0);
      assert.equal((await client.query('SELECT id FROM access_attempts')).rowCount, 0);
    });

    assert.deepEqual(
      await runCleanup(database.connectionString, firstCleanupAt, privateFixtures),
      zeroCounts,
    );

    assert.deepEqual(
      await runCleanup(database.connectionString, tenDayCleanupAt, privateFixtures),
      {
        ...zeroCounts,
        deletedInteractionSearches: 1,
        deletedDiagnoses: 1,
        deletedInteractionTurns: 1,
      },
    );
    await withPostgresClient(database.connectionString, async (client) => {
      for (const [table, id] of [
        ['interaction_searches', searchId],
        ['diagnoses', diagnosisId],
        ['interaction_turns', turnId],
      ]) {
        const rows = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
        assert.equal(rows.rowCount, 0);
      }
      assert.equal((await client.query('SELECT id FROM invite_codes WHERE id = $1', [inviteId])).rowCount, 1);
      assert.equal((await client.query('SELECT id FROM knowledge_documents WHERE id = $1', [documentId])).rowCount, 1);
    });
    assert.deepEqual(
      await runCleanup(database.connectionString, tenDayCleanupAt, privateFixtures),
      zeroCounts,
    );
  } finally {
    await database.dispose();
  }
});
