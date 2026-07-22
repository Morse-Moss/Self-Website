import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
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
  deletedResumeSessions: number;
  disabledResumeInvites: number;
  deletedResumeEvents: number;
  deletedAdminSessions: number;
  deletedAlertOutbox: number;
  deletedDiagnoses: number;
  deletedAiConfigEvents: number;
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
  deletedAiConfigEvents: 0,
  deletedResumeSessions: 0,
  disabledResumeInvites: 0,
  deletedResumeEvents: 0,
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
        [
          { version: '001' },
          { version: '002' },
          { version: '003' },
          { version: '004' },
          { version: '005' },
          { version: '006' },
        ],
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

test('resume retention removes expired sessions and old events without deleting current ciphertext', async () => {
  const database = await createDisposablePostgresDatabase();
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'revolution-resume-retention-'));
  const now = new Date('2035-02-01T00:00:00.000Z');
  const oldTime = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
  const youngTime = new Date(now.getTime() - 60 * 60_000);
  const currentName = `${randomUUID()}.morsepdf`;
  const retiredName = `${randomUUID()}.morsepdf`;
  const orphanName = `${randomUUID()}.morsepdf`;
  const youngOrphanName = `${randomUUID()}.morsepdf`;
  const oldTempName = 'upload-old.tmp';
  const youngTempName = 'upload-young.tmp';
  const inviteId = randomUUID();
  const retiredId = randomUUID();

  try {
    const migration = await runScript(migrationRunner, { DATABASE_URL: database.connectionString });
    assert.equal(migration.code, 0, migration.stderr);
    for (const name of [currentName, retiredName, orphanName, youngOrphanName, oldTempName, youngTempName]) {
      await writeFile(path.join(storageDir, name), 'ciphertext-fixture');
    }
    await utimes(path.join(storageDir, currentName), oldTime, oldTime);
    await utimes(path.join(storageDir, retiredName), oldTime, oldTime);
    await utimes(path.join(storageDir, orphanName), oldTime, oldTime);
    await utimes(path.join(storageDir, youngOrphanName), youngTime, youngTime);
    await utimes(path.join(storageDir, oldTempName), oldTime, oldTime);
    await utimes(path.join(storageDir, youngTempName), youngTime, youngTime);

    await withPostgresClient(database.connectionString, async (client) => {
      await client.query(
        `INSERT INTO resume_documents
          (id, storage_name, cipher_sha256, plaintext_bytes, ciphertext_bytes,
           envelope_version, key_version, uploaded_by_admin_session, uploaded_at, activated_at, is_current)
         VALUES ($1, $2, $3, 100, 164, 1, 1, $4, $5, $5, true),
                ($6, $7, $8, 100, 164, 1, 1, $4, $5, $5, false)`,
        [randomUUID(), currentName, 'a'.repeat(64), randomUUID(), oldTime, retiredId, retiredName, 'b'.repeat(64)],
      );
      await client.query(
        `INSERT INTO resume_invites
          (id, code_hash, trusted_person_note, created_at, expires_at, created_by_admin_session)
         VALUES ($1, $2, 'expired synthetic invite', $3, $4, $5)`,
        [inviteId, 'c'.repeat(64), new Date(now.getTime() - 3 * 24 * 60 * 60_000), new Date(now.getTime() - 60_000), randomUUID()],
      );
      await client.query(
        `INSERT INTO resume_sessions
          (id, invite_id, token_hash, created_at, last_seen_at, expires_at, source_ip, user_agent)
         VALUES ($1, $2, $3, $4, $4, $5, '0.0.0.0', 'synthetic')`,
        [randomUUID(), inviteId, 'd'.repeat(64), new Date(now.getTime() - 2 * 24 * 60 * 60_000), new Date(now.getTime() - 60_000)],
      );
      await client.query(
        `INSERT INTO resume_access_events
          (event_type, result_code, created_at, delete_after, user_agent)
         VALUES ('file_returned', 'OLD_EVENT', $1, $2, 'synthetic')`,
        [oldTime, new Date(now.getTime() - 60_000)],
      );
    });

    const { cleanupResumeStorage } = await import('../scripts/cleanup-resume-storage.mjs');
    const storagePool = { query: (sql: string, params?: unknown[]) => withPostgresClient(database.connectionString, (client) => client.query(sql, params)) };
    const firstStorage = await cleanupResumeStorage({ pool: storagePool, storageDir, now, minimumAgeMs: 24 * 60 * 60_000 });
    assert.equal(firstStorage.deletedFiles, 1);
    assert.equal(firstStorage.deletedTempFiles, 1);
    assert.ok((await readdir(storageDir)).includes(currentName));
    assert.ok((await readdir(storageDir)).includes(retiredName));
    assert.ok((await readdir(storageDir)).includes(youngOrphanName));
    assert.ok((await readdir(storageDir)).includes(youngTempName));
    assert.equal((await readdir(storageDir)).includes(orphanName), false);

    const cleanup = await runCleanup(database.connectionString, now.toISOString(), []);
    assert.equal(cleanup.deletedResumeSessions, 1);
    assert.equal(cleanup.disabledResumeInvites, 1);
    assert.equal(cleanup.deletedResumeEvents, 1);

    await withPostgresClient(database.connectionString, async (client) => {
      const cleanupEvents = await client.query<{
        result_code: string;
        invite_id: string | null;
        session_id: string | null;
        source_ip: string | null;
        user_agent: string | null;
      }>(
        `SELECT result_code, invite_id, session_id, source_ip::text, user_agent
           FROM resume_access_events
          WHERE event_type = 'expired_cleanup'
          ORDER BY result_code`,
      );
      assert.deepEqual(cleanupEvents.rows, [
        {
          result_code: 'INVITE_EXPIRED',
          invite_id: inviteId,
          session_id: null,
          source_ip: null,
          user_agent: null,
        },
        {
          result_code: 'SESSION_EXPIRED',
          invite_id: inviteId,
          session_id: null,
          source_ip: '0.0.0.0/32',
          user_agent: 'synthetic',
        },
      ]);
      await client.query('DELETE FROM resume_documents WHERE id = $1', [retiredId]);
    });
    const repeatedCleanup = await runCleanup(database.connectionString, now.toISOString(), []);
    assert.equal(repeatedCleanup.deletedResumeSessions, 0);
    assert.equal(repeatedCleanup.disabledResumeInvites, 0);
    assert.equal(repeatedCleanup.deletedResumeEvents, 0);
    await withPostgresClient(database.connectionString, async (client) => {
      assert.equal((await client.query(
        "SELECT 1 FROM resume_access_events WHERE event_type = 'expired_cleanup'",
      )).rowCount, 2);
    });
    const secondStorage = await cleanupResumeStorage({ pool: storagePool, storageDir, now, minimumAgeMs: 24 * 60 * 60_000 });
    assert.equal(secondStorage.deletedFiles, 1);
    assert.equal((await readdir(storageDir)).includes(currentName), true);
    assert.equal((await readdir(storageDir)).includes(retiredName), false);
  } finally {
    await database.dispose();
    await rm(storageDir, { force: true, recursive: true });
  }
});
