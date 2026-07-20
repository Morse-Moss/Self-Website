import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import {
  createDisposablePostgresDatabase,
  withPostgresClient,
} from './postgres-test-utils.ts';

const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const resumeTables = [
  'resume_access_events',
  'resume_documents',
  'resume_invites',
  'resume_sessions',
];

function randomHash(): string {
  return createHash('sha256').update(randomUUID(), 'utf8').digest('hex');
}

async function runMigrations(connectionString: string): Promise<void> {
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const environment = { ...process.env, DATABASE_URL: connectionString };
    delete environment.MORSE_MIGRATIONS_DIR;
    const child = spawn(process.execPath, [migrationRunner], {
      cwd: repoRoot,
      env: environment,
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

function isPostgresError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

test('migration 003 creates an isolated private resume schema with required indexes', async () => {
  const database = await createDisposablePostgresDatabase();
  try {
    await runMigrations(database.connectionString);
    await withPostgresClient(database.connectionString, async (client) => {
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = ANY($1::text[])
          ORDER BY table_name`,
        [resumeTables],
      );
      assert.deepEqual(tables.rows.map((row) => row.table_name), resumeTables);

      const sessionAuditColumns = await client.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'resume_sessions'
            AND column_name IN ('source_ip', 'user_agent')
          ORDER BY column_name`,
      );
      assert.deepEqual(sessionAuditColumns.rows, [
        { column_name: 'source_ip', data_type: 'inet', is_nullable: 'NO' },
        { column_name: 'user_agent', data_type: 'text', is_nullable: 'NO' },
      ]);

      const constraints = await client.query<{ definition: string; table_name: string }>(
        `SELECT relation.relname AS table_name,
                pg_get_constraintdef(constraint_record.oid) AS definition
           FROM pg_constraint AS constraint_record
           JOIN pg_class AS relation ON relation.oid = constraint_record.conrelid
           JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public'
            AND relation.relname = ANY($1::text[])`,
        [resumeTables],
      );
      assert.ok(constraints.rows.some((constraint) => (
        constraint.table_name === 'resume_sessions'
        && /^UNIQUE \(invite_id\)$/i.test(constraint.definition)
      )));
      assert.ok(constraints.rows.some((constraint) => (
        constraint.table_name === 'resume_sessions'
        && /FOREIGN KEY \(invite_id\) REFERENCES resume_invites\(id\) ON DELETE RESTRICT/i
          .test(constraint.definition)
      )));
      assert.ok(constraints.rows.some((constraint) => (
        constraint.table_name === 'resume_sessions'
        && /CHECK[\s\S]*char_length\(user_agent\) <= 1024/i.test(constraint.definition)
      )));

      const foreignKeys = await client.query<{ child_table: string; parent_table: string }>(
        `SELECT child.relname AS child_table, parent.relname AS parent_table
           FROM pg_constraint AS constraint_record
           JOIN pg_class AS child ON child.oid = constraint_record.conrelid
           JOIN pg_class AS parent ON parent.oid = constraint_record.confrelid
           JOIN pg_namespace AS namespace ON namespace.oid = child.relnamespace
          WHERE constraint_record.contype = 'f'
            AND namespace.nspname = 'public'
            AND child.relname = ANY($1::text[])
          ORDER BY child_table, parent_table`,
        [resumeTables],
      );
      assert.deepEqual(foreignKeys.rows, [
        { child_table: 'resume_access_events', parent_table: 'resume_invites' },
        { child_table: 'resume_access_events', parent_table: 'resume_sessions' },
        { child_table: 'resume_sessions', parent_table: 'resume_invites' },
      ]);

      const indexes = await client.query<{ indexdef: string; indexname: string }>(
        `SELECT indexname, indexdef
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = ANY($1::text[])
          ORDER BY indexname`,
        [[
          'resume_access_events_invite_idx',
          'resume_access_events_recent_idx',
          'resume_access_events_retention_idx',
          'resume_access_events_session_idx',
          'resume_documents_one_current_idx',
          'resume_invites_state_idx',
          'resume_sessions_expiry_idx',
        ]],
      );
      assert.deepEqual(indexes.rows.map((row) => row.indexname), [
        'resume_access_events_invite_idx',
        'resume_access_events_recent_idx',
        'resume_access_events_retention_idx',
        'resume_access_events_session_idx',
        'resume_documents_one_current_idx',
        'resume_invites_state_idx',
        'resume_sessions_expiry_idx',
      ]);
      const currentIndex = indexes.rows.find(
        (index) => index.indexname === 'resume_documents_one_current_idx',
      );
      const inviteStateIndex = indexes.rows.find(
        (index) => index.indexname === 'resume_invites_state_idx',
      );
      const accessEventInviteIndex = indexes.rows.find(
        (index) => index.indexname === 'resume_access_events_invite_idx',
      );
      const accessEventSessionIndex = indexes.rows.find(
        (index) => index.indexname === 'resume_access_events_session_idx',
      );
      assert.match(
        currentIndex?.indexdef ?? '',
        /CREATE UNIQUE INDEX[\s\S]*WHERE\s+\(?is_current(?:\s*=\s*true)?\)?/i,
      );
      assert.match(
        inviteStateIndex?.indexdef ?? '',
        /\(disabled_at, redeemed_at, expires_at DESC\)/i,
      );
      assert.match(
        accessEventInviteIndex?.indexdef ?? '',
        /\(invite_id\)\s+WHERE\s+\(?invite_id IS NOT NULL\)?/i,
      );
      assert.match(
        accessEventSessionIndex?.indexdef ?? '',
        /\(session_id\)\s+WHERE\s+\(?session_id IS NOT NULL\)?/i,
      );

      const eventTypes = [
        'invite_created',
        'redeem_succeeded',
        'redeem_failed',
        'file_returned',
        'session_logged_out',
        'invite_disabled',
        'expired_cleanup',
        'document_uploaded',
        'document_replaced',
        'key_rotation_prepared',
        'key_rotation_activated',
        'key_rotation_finalized',
        'key_rotation_rolled_back',
        'storage_recovery',
      ];
      for (const [index, eventType] of eventTypes.entries()) {
        await client.query(
          `INSERT INTO resume_access_events (event_type, result_code, delete_after)
           VALUES ($1, $2, now() + interval '1 day')`,
          [eventType, `synthetic-${index}`],
        );
      }
      await assert.rejects(
        client.query(
          `INSERT INTO resume_access_events (event_type, result_code, delete_after)
           VALUES ('unknown_event', 'synthetic-invalid', now() + interval '1 day')`,
        ),
        (error: unknown) => isPostgresError(error, '23514'),
      );
      const storedEvents = await client.query<{ count: number }>(
        'SELECT count(*)::integer AS count FROM resume_access_events',
      );
      assert.equal(storedEvents.rows[0].count, eventTypes.length);
    });
  } finally {
    await database.dispose();
  }
});

test('resume_documents permits only one current encrypted document', async () => {
  const database = await createDisposablePostgresDatabase();
  try {
    await runMigrations(database.connectionString);
    await withPostgresClient(database.connectionString, async (client) => {
      const firstId = randomUUID();
      await client.query(
        `INSERT INTO resume_documents
          (id, storage_name, cipher_sha256, plaintext_bytes, ciphertext_bytes,
           key_version, uploaded_by_admin_session)
         VALUES ($1, $2, $3, 128, 192, 1, $4)`,
        [firstId, `${firstId}.morsepdf`, randomHash(), randomUUID()],
      );

      const secondId = randomUUID();
      await assert.rejects(
        client.query(
          `INSERT INTO resume_documents
            (id, storage_name, cipher_sha256, plaintext_bytes, ciphertext_bytes,
             key_version, uploaded_by_admin_session)
           VALUES ($1, $2, $3, 128, 192, 1, $4)`,
          [secondId, `${secondId}.morsepdf`, randomHash(), randomUUID()],
        ),
        (error: unknown) => isPostgresError(error, '23505'),
      );

      const inactiveId = randomUUID();
      await client.query(
        `INSERT INTO resume_documents
          (id, storage_name, cipher_sha256, plaintext_bytes, ciphertext_bytes,
           key_version, uploaded_by_admin_session, is_current)
         VALUES ($1, $2, $3, 128, 192, 1, $4, false)`,
        [inactiveId, `${inactiveId}.morsepdf`, randomHash(), randomUUID()],
      );
      const documents = await client.query<{ current_count: number; total_count: number }>(
        `SELECT count(*) FILTER (WHERE is_current)::integer AS current_count,
                count(*)::integer AS total_count
           FROM resume_documents`,
      );
      assert.deepEqual(documents.rows[0], { current_count: 1, total_count: 2 });
    });
  } finally {
    await database.dispose();
  }
});

test('concurrent transactions can create at most one session for the same resume invite', async () => {
  const database = await createDisposablePostgresDatabase();
  try {
    await runMigrations(database.connectionString);
    const inviteId = randomUUID();
    const firstSourceIp = '192.0.2.10';
    const firstUserAgent = `Synthetic Person Browser/${randomUUID()}`;
    const secondSourceIp = '198.51.100.20';
    const secondUserAgent = `Synthetic Person Browser/${randomUUID()}`;
    await withPostgresClient(database.connectionString, async (setup) => {
      await setup.query(
        `INSERT INTO resume_invites
          (id, code_hash, trusted_person_note, expires_at, created_by_admin_session)
         VALUES ($1, $2, 'Synthetic Person', now() + interval '1 day', $3)`,
        [inviteId, randomHash(), randomUUID()],
      );
    });

    await withPostgresClient(database.connectionString, async (first) => {
      await withPostgresClient(database.connectionString, async (second) => {
        await first.query('BEGIN');
        await second.query('BEGIN');
        try {
          await second.query("SET LOCAL statement_timeout = '6000ms'");
          const firstPid = await first.query<{ pid: number }>(
            'SELECT pg_backend_pid()::integer AS pid',
          );
          const secondPid = await second.query<{ pid: number }>(
            'SELECT pg_backend_pid()::integer AS pid',
          );
          await first.query(
            `INSERT INTO resume_sessions
              (id, invite_id, token_hash, expires_at, source_ip, user_agent)
             VALUES ($1, $2, $3, now() + interval '1 hour', $4, $5)`,
            [randomUUID(), inviteId, randomHash(), firstSourceIp, firstUserAgent],
          );
          const secondInsert = second.query(
            `INSERT INTO resume_sessions
              (id, invite_id, token_hash, expires_at, source_ip, user_agent)
             VALUES ($1, $2, $3, now() + interval '1 hour', $4, $5)`,
            [randomUUID(), inviteId, randomHash(), secondSourceIp, secondUserAgent],
          ).then(
            () => ({ status: 'fulfilled' as const }),
            (error: unknown) => ({ error, status: 'rejected' as const }),
          );

          let blockedByFirst = false;
          const blockingDeadline = Date.now() + 5_000;
          while (Date.now() < blockingDeadline) {
            const blockers = await first.query<{ blocked_by_first: boolean }>(
              `SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked_by_first`,
              [firstPid.rows[0].pid, secondPid.rows[0].pid],
            );
            if (blockers.rows[0]?.blocked_by_first) {
              blockedByFirst = true;
              break;
            }
            await delay(Math.min(25, Math.max(1, blockingDeadline - Date.now())));
          }
          assert.equal(
            blockedByFirst,
            true,
            'pg_blocking_pids must prove the first transaction blocks the second insert',
          );

          await first.query('COMMIT');
          const outcome = await secondInsert;
          assert.equal(outcome.status, 'rejected');
          assert.equal(
            outcome.status === 'rejected' && isPostgresError(outcome.error, '23505'),
            true,
            'the second insert must be rejected by the invite_id unique constraint after commit',
          );
          await second.query('ROLLBACK');
        } finally {
          await first.query('ROLLBACK').catch(() => undefined);
          await second.query('ROLLBACK').catch(() => undefined);
        }

        const sessions = await first.query<{ count: number }>(
          'SELECT count(*)::integer AS count FROM resume_sessions WHERE invite_id = $1',
          [inviteId],
        );
        assert.equal(sessions.rows[0].count, 1);
        const auditMetadata = await first.query<{ source_ip: string; user_agent: string }>(
          `SELECT host(source_ip) AS source_ip, user_agent
             FROM resume_sessions
            WHERE invite_id = $1`,
          [inviteId],
        );
        assert.deepEqual(auditMetadata.rows, [{
          source_ip: firstSourceIp,
          user_agent: firstUserAgent,
        }]);
      });
    });
  } finally {
    await database.dispose();
  }
});
