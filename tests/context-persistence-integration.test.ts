import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';

import pg from 'pg';

import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');

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

async function insertConversationFixture(pool: InstanceType<typeof Pool>) {
  const inviteId = randomUUID();
  const sessionId = randomUUID();
  const conversationId = randomUUID();
  const inviteHash = randomUUID().replaceAll('-', '').repeat(2);
  const tokenHash = randomUUID().replaceAll('-', '').repeat(2);
  await pool.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES ($1, $2, 'context fixture', true, now() + interval '1 day', 3, 1)`,
    [inviteId, inviteHash],
  );
  await pool.query(
    `INSERT INTO access_sessions
      (id, invite_code_id, token_hash, expires_at, message_count)
     VALUES ($1, $2, $3, now() + interval '1 day', 0)`,
    [sessionId, inviteId, tokenHash],
  );
  await pool.query(
    `INSERT INTO conversations
      (id, access_session_id, mode, workflow, audience_intent, expires_at)
     VALUES ($1, $2, 'general', 'chat', 'general', now() + interval '1 day')`,
    [conversationId, sessionId],
  );
  return { conversationId, inviteId, sessionId };
}

test('migration 012 creates isolated controlled-context persistence and attempt integrity fields', async () => {
  const database = await createDisposablePostgresDatabase();
  const pool = new Pool({ connectionString: database.connectionString });
  try {
    await runMigrations(database.connectionString);
    const registration = await pool.query<{ version: string }>(
      `SELECT version FROM schema_migrations WHERE version = '012'`,
    );
    assert.deepEqual(registration.rows, [{ version: '012' }]);

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name`,
      [[
        'conversation_context_completed_turns',
        'conversation_context_legacy_bridge_turns',
        'conversation_context_slot_refs',
        'conversation_context_task_state',
      ]],
    );
    assert.deepEqual(tables.rows.map((row) => row.table_name), [
      'conversation_context_completed_turns',
      'conversation_context_legacy_bridge_turns',
      'conversation_context_slot_refs',
      'conversation_context_task_state',
    ]);

    const columns = await pool.query<{ column_name: string; table_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'conversations' AND column_name = 'context_pipeline_assignment')
            OR (table_name = 'interaction_turns' AND column_name IN
              ('execution_pipeline', 'semantic_intent', 'discourse_action',
               'task_action', 'context_scope_id', 'context_manifest'))
            OR (table_name IN ('chat_provider_attempts', 'interaction_provider_attempts')
              AND column_name IN
                ('context_builder_version', 'packet_hmac_key_id',
                 'packet_hmac_sha256', 'generation_overlay_version',
                 'generation_request_hmac_sha256'))
          )
        ORDER BY table_name, column_name`,
    );
    assert.equal(columns.rowCount, 17);
  } finally {
    await pool.end();
    await database.dispose();
  }
});

test('controlled completed turns bind one user and assistant pair to the same conversation', async () => {
  const database = await createDisposablePostgresDatabase();
  const pool = new Pool({ connectionString: database.connectionString });
  try {
    await runMigrations(database.connectionString);
    const first = await insertConversationFixture(pool);
    const second = await insertConversationFixture(pool);
    const user = await pool.query<{ id: string }>(
      `INSERT INTO conversation_messages (conversation_id, role, content)
       VALUES ($1, 'user', 'user fixture') RETURNING id::text`,
      [first.conversationId],
    );
    const assistant = await pool.query<{ id: string }>(
      `INSERT INTO conversation_messages (conversation_id, role, content)
       VALUES ($1, 'assistant', 'assistant fixture') RETURNING id::text`,
      [second.conversationId],
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO conversation_context_completed_turns
          (conversation_id, turn_id, context_scope_id, user_message_id,
           assistant_message_id, owner_pipeline, pipeline_version, completed_at)
         VALUES ($1, $2, $3, $4, $5, 'context_packet_v22',
                 'context-packet-v22', now())`,
        [
          first.conversationId,
          randomUUID(),
          randomUUID(),
          user.rows[0].id,
          assistant.rows[0].id,
        ],
      ),
      /foreign key/iu,
    );
  } finally {
    await pool.end();
    await database.dispose();
  }
});
