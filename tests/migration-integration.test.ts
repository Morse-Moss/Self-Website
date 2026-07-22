import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

import {
  createDisposablePostgresDatabase,
  withPostgresClient,
} from './postgres-test-utils.ts';

const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const migrationSourceDirectory = path.join(repoRoot, 'db', 'migrations');

interface RunnerResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

async function runMigrations(
  connectionString: string,
  migrationsDirectory?: string,
): Promise<RunnerResult> {
  return new Promise((resolve, reject) => {
    const environment = { ...process.env, DATABASE_URL: connectionString };
    if (migrationsDirectory) {
      environment.MORSE_MIGRATIONS_DIR = migrationsDirectory;
    } else {
      delete environment.MORSE_MIGRATIONS_DIR;
    }
    const child = spawn(process.execPath, [migrationRunner], {
      cwd: repoRoot,
      env: environment,
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

async function copyMigrations(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'revolution-s10-migrations-'));
  const entries = await fs.readdir(migrationSourceDirectory, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => fs.copyFile(
      path.join(migrationSourceDirectory, entry.name),
      path.join(directory, entry.name),
    )));
  return directory;
}

test('migration runner bootstraps an empty database in order and is repeatable', async () => {
  const database = await createDisposablePostgresDatabase();
  try {
    const first = await runMigrations(database.connectionString);
    assert.equal(first.code, 0, first.stderr);

    const firstRows = await withPostgresClient(database.connectionString, async (client) => {
      const registry = await client.query<{ name: string | null }>(
        "SELECT to_regclass('public.schema_migrations')::text AS name",
      );
      assert.equal(registry.rows[0].name, 'schema_migrations');
      const migrations = await client.query<{
        applied_at: string;
        checksum: string;
        version: string;
      }>(
        `SELECT version, checksum, applied_at::text AS applied_at
           FROM schema_migrations
          ORDER BY version`,
      );
      const tables = await client.query<{ name: string }>(
        `SELECT table_name AS name
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('knowledge_documents', 'interaction_turns')
          ORDER BY table_name`,
      );
      return { migrations: migrations.rows, tables: tables.rows };
    });
    assert.deepEqual(
      firstRows.migrations.map((row) => row.version),
      ['001', '002', '003', '004', '005', '006'],
    );
    assert.ok(firstRows.migrations.every((row) => /^[0-9a-f]{64}$/.test(row.checksum)));
    assert.deepEqual(firstRows.tables.map((row) => row.name), [
      'interaction_turns',
      'knowledge_documents',
    ]);

    const second = await runMigrations(database.connectionString);
    assert.equal(second.code, 0, second.stderr);
    const secondRows = await withPostgresClient(database.connectionString, async (client) => (
      client.query<{ applied_at: string; checksum: string; version: string }>(
        `SELECT version, checksum, applied_at::text AS applied_at
           FROM schema_migrations
          ORDER BY version`,
      )
    ));
    assert.deepEqual(secondRows.rows, firstRows.migrations);
  } finally {
    await database.dispose();
  }
});

test('two migration runners serialize an empty database', async () => {
  const database = await createDisposablePostgresDatabase();
  const directory = await copyMigrations();
  try {
    const initialPath = path.join(directory, '001_morse_rag.sql');
    const initialSql = await fs.readFile(initialPath, 'utf8');
    await fs.writeFile(
      initialPath,
      initialSql.replace(/BEGIN;/i, "BEGIN;\nSELECT pg_sleep(0.25);"),
      'utf8',
    );

    const results = await Promise.all([
      runMigrations(database.connectionString, directory),
      runMigrations(database.connectionString, directory),
    ]);
    assert.deepEqual(results.map((result) => result.code), [0, 0], results
      .map((result) => result.stderr)
      .join('\n'));
    await withPostgresClient(database.connectionString, async (client) => {
      const registrations = await client.query<{ count: number; version: string }>(
        `SELECT version, count(*)::integer AS count
           FROM schema_migrations
          GROUP BY version
          ORDER BY version`,
      );
      assert.deepEqual(registrations.rows, [
        { version: '001', count: 1 },
        { version: '002', count: 1 },
        { version: '003', count: 1 },
        { version: '004', count: 1 },
        { version: '005', count: 1 },
        { version: '006', count: 1 },
      ]);
    });
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
    await database.dispose();
  }
});

test('migration runner baselines a complete 001 database and preserves old data', async () => {
  const database = await createDisposablePostgresDatabase();
  const inviteId = randomUUID();
  const sessionId = randomUUID();
  const conversationId = randomUUID();
  const documentId = `legacy-${randomUUID()}`;
  try {
    const initialSql = await fs.readFile(
      path.join(migrationSourceDirectory, '001_morse_rag.sql'),
      'utf8',
    );
    await withPostgresClient(database.connectionString, async (client) => {
      await client.query(initialSql);
      await client.query(
        `INSERT INTO invite_codes
          (id, code_hash, label, active, expires_at, max_sessions, session_count)
         VALUES ($1, $2, 'legacy invite', true, now() + interval '1 day', 3, 0)`,
        [inviteId, 'a'.repeat(64)],
      );
      await client.query(
        `INSERT INTO knowledge_documents (id, title, source_path, checksum)
         VALUES ($1, 'Legacy document', 'content/legacy.json', $2)`,
        [documentId, 'b'.repeat(64)],
      );
      await client.query(
        `INSERT INTO access_sessions
          (id, invite_code_id, token_hash, expires_at, message_count)
         VALUES ($1, $2, $3, now() + interval '12 hours', 1)`,
        [sessionId, inviteId, 'c'.repeat(64)],
      );
      await client.query(
        `INSERT INTO conversations
          (id, access_session_id, mode, expires_at)
         VALUES ($1, $2, 'general', now() + interval '12 hours')`,
        [conversationId, sessionId],
      );
      await client.query(
        `INSERT INTO conversation_messages (conversation_id, role, content)
         VALUES ($1, 'user', 'legacy history')`,
        [conversationId],
      );
    });

    const result = await runMigrations(database.connectionString);
    assert.equal(result.code, 0, result.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      const registry = await client.query<{ name: string | null }>(
        "SELECT to_regclass('public.schema_migrations')::text AS name",
      );
      assert.equal(registry.rows[0].name, 'schema_migrations');
      const migrations = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      );
      const invite = await client.query('SELECT id FROM invite_codes WHERE id = $1', [inviteId]);
      const document = await client.query(
        'SELECT id FROM knowledge_documents WHERE id = $1',
        [documentId],
      );
      const session = await client.query('SELECT id FROM access_sessions WHERE id = $1', [sessionId]);
      const conversation = await client.query(
        'SELECT id FROM conversations WHERE id = $1',
        [conversationId],
      );
      const message = await client.query(
        "SELECT id FROM conversation_messages WHERE conversation_id = $1 AND content = 'legacy history'",
        [conversationId],
      );
      assert.deepEqual(
        migrations.rows.map((row) => row.version),
        ['001', '002', '003', '004', '005', '006'],
      );
      assert.equal(invite.rowCount, 1);
      assert.equal(document.rowCount, 1);
      assert.equal(session.rowCount, 1);
      assert.equal(conversation.rowCount, 1);
      assert.equal(message.rowCount, 1);
    });
  } finally {
    await database.dispose();
  }
});

test('two migration runners serialize baseline registration on a complete 001 database', async () => {
  const database = await createDisposablePostgresDatabase();
  const directory = await copyMigrations();
  try {
    const initialSql = await fs.readFile(
      path.join(migrationSourceDirectory, '001_morse_rag.sql'),
      'utf8',
    );
    await withPostgresClient(database.connectionString, async (client) => {
      await client.query(initialSql);
    });
    const secondPath = path.join(directory, '002_s10_customer_service.sql');
    const secondSql = await fs.readFile(secondPath, 'utf8');
    await fs.writeFile(secondPath, `SELECT pg_sleep(0.25);\n${secondSql}`, 'utf8');

    const results = await Promise.all([
      runMigrations(database.connectionString, directory),
      runMigrations(database.connectionString, directory),
    ]);
    assert.deepEqual(results.map((result) => result.code), [0, 0], results
      .map((result) => result.stderr)
      .join('\n'));
    await withPostgresClient(database.connectionString, async (client) => {
      const registrations = await client.query<{ count: number; version: string }>(
        `SELECT version, count(*)::integer AS count
           FROM schema_migrations
          GROUP BY version
          ORDER BY version`,
      );
      assert.deepEqual(registrations.rows, [
        { version: '001', count: 1 },
        { version: '002', count: 1 },
        { version: '003', count: 1 },
        { version: '004', count: 1 },
        { version: '005', count: 1 },
        { version: '006', count: 1 },
      ]);
    });
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
    await database.dispose();
  }
});

test('migration runner rejects a partial unregistered 001 schema', async () => {
  const database = await createDisposablePostgresDatabase();
  try {
    await withPostgresClient(database.connectionString, async (client) => {
      await client.query('CREATE TABLE knowledge_documents (id text PRIMARY KEY)');
    });

    const result = await runMigrations(database.connectionString);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /partial|incompatible|sentinel/i);
    await withPostgresClient(database.connectionString, async (client) => {
      const registered = await client.query('SELECT version FROM schema_migrations');
      assert.equal(registered.rowCount, 0);
    });
  } finally {
    await database.dispose();
  }
});

test('migration runner rejects a complete-looking 001 schema with vector(512)', async () => {
  const database = await createDisposablePostgresDatabase();
  try {
    const initialSql = await fs.readFile(
      path.join(migrationSourceDirectory, '001_morse_rag.sql'),
      'utf8',
    );
    assert.match(initialSql, /vector\(1536\)/i);
    await withPostgresClient(database.connectionString, async (client) => {
      await client.query(initialSql.replace(/vector\(1536\)/i, 'vector(512)'));
    });

    const result = await runMigrations(database.connectionString);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /partial|incompatible|sentinel|vector/i);
    await withPostgresClient(database.connectionString, async (client) => {
      const registered = await client.query('SELECT version FROM schema_migrations');
      assert.equal(registered.rowCount, 0);
    });
  } finally {
    await database.dispose();
  }
});

test('migration runner rejects checksum drift in an applied migration', async () => {
  const database = await createDisposablePostgresDatabase();
  const directory = await copyMigrations();
  try {
    assert.equal(
      await fs.stat(path.join(directory, '002_s10_customer_service.sql')).then(
        () => true,
        () => false,
      ),
      true,
      '002 migration must exist before checksum behavior can be exercised',
    );
    const first = await runMigrations(database.connectionString, directory);
    assert.equal(first.code, 0, first.stderr);
    await fs.appendFile(
      path.join(directory, '001_morse_rag.sql'),
      '\n-- checksum drift injected by migration integration test\n',
      'utf8',
    );

    const drifted = await runMigrations(database.connectionString, directory);
    assert.notEqual(drifted.code, 0);
    assert.match(drifted.stderr, /checksum/i);
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
    await database.dispose();
  }
});

test('migration runner accepts an equivalent CRLF and BOM checkout after registration', async () => {
  const database = await createDisposablePostgresDatabase();
  const directory = await copyMigrations();
  try {
    const first = await runMigrations(database.connectionString, directory);
    assert.equal(first.code, 0, first.stderr);
    for (const fileName of [
      '001_morse_rag.sql',
      '002_s10_customer_service.sql',
      '003_private_resume.sql',
      '004_admin_api_management.sql',
      '005_chat_v2.sql',
      '006_interaction_invite_label.sql',
    ]) {
      const filePath = path.join(directory, fileName);
      const text = await fs.readFile(filePath, 'utf8');
      const crlf = `\uFEFF${text.replace(/\r?\n/gu, '\r\n')}`;
      await fs.writeFile(filePath, crlf, 'utf8');
    }

    const second = await runMigrations(database.connectionString, directory);
    assert.equal(second.code, 0, second.stderr);
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
    await database.dispose();
  }
});

test('a failed 002 migration rolls back its schema and registration together', async () => {
  const database = await createDisposablePostgresDatabase();
  const directory = await copyMigrations();
  try {
    const secondMigration = path.join(directory, '002_s10_customer_service.sql');
    assert.equal(
      await fs.stat(secondMigration).then(() => true, () => false),
      true,
      '002 migration must exist before transaction rollback can be exercised',
    );
    await fs.appendFile(secondMigration, '\nSELECT s10_force_migration_failure();\n', 'utf8');

    const result = await runMigrations(database.connectionString, directory);
    assert.notEqual(result.code, 0);
    await withPostgresClient(database.connectionString, async (client) => {
      const migrations = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      );
      const table = await client.query<{ name: string | null }>(
        "SELECT to_regclass('public.interaction_turns')::text AS name",
      );
      const workflowColumn = await client.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'conversations'
            AND column_name = 'workflow'`,
      );
      assert.deepEqual(migrations.rows.map((row) => row.version), ['001']);
      assert.equal(table.rows[0].name, null);
      assert.equal(workflowColumn.rowCount, 0);
    });
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
    await database.dispose();
  }
});

test('migration runner rejects a partial 002 schema after 001 was registered', async () => {
  const database = await createDisposablePostgresDatabase();
  const initialOnlyDirectory = await copyMigrations();
  try {
    await fs.rm(
      path.join(initialOnlyDirectory, '002_s10_customer_service.sql'),
      { force: true },
    );
    await fs.rm(
      path.join(initialOnlyDirectory, '003_private_resume.sql'),
      { force: true },
    );
    await fs.rm(
      path.join(initialOnlyDirectory, '004_admin_api_management.sql'),
      { force: true },
    );
    await fs.rm(
      path.join(initialOnlyDirectory, '005_chat_v2.sql'),
      { force: true },
    );
    await fs.rm(
      path.join(initialOnlyDirectory, '006_interaction_invite_label.sql'),
      { force: true },
    );
    const initial = await runMigrations(database.connectionString, initialOnlyDirectory);
    assert.equal(initial.code, 0, initial.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      await client.query(`
        CREATE TABLE interaction_turns (
          id uuid PRIMARY KEY,
          workflow text,
          status text,
          created_at timestamptz,
          delete_after timestamptz,
          badcase boolean
        )
      `);
    });

    const result = await runMigrations(database.connectionString);
    assert.notEqual(result.code, 0);
    await withPostgresClient(database.connectionString, async (client) => {
      const registrations = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      );
      const workflowColumn = await client.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'conversations'
            AND column_name = 'workflow'`,
      );
      assert.deepEqual(registrations.rows.map((row) => row.version), ['001']);
      assert.equal(workflowColumn.rowCount, 0);
    });
  } finally {
    await fs.rm(initialOnlyDirectory, { force: true, recursive: true });
    await database.dispose();
  }
});

test('S10 analytics tables do not reference 12-hour runtime tables and usage stays nullable', async () => {
  const database = await createDisposablePostgresDatabase();
  try {
    const result = await runMigrations(database.connectionString);
    assert.equal(result.code, 0, result.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      const runtimeReferences = await client.query(
        `SELECT child.constraint_name
           FROM information_schema.referential_constraints AS reference
           JOIN information_schema.table_constraints AS child
             ON child.constraint_catalog = reference.constraint_catalog
            AND child.constraint_schema = reference.constraint_schema
            AND child.constraint_name = reference.constraint_name
           JOIN information_schema.table_constraints AS parent
             ON parent.constraint_catalog = reference.unique_constraint_catalog
            AND parent.constraint_schema = reference.unique_constraint_schema
            AND parent.constraint_name = reference.unique_constraint_name
          WHERE child.table_schema = 'public'
            AND child.table_name IN ('interaction_turns', 'interaction_searches', 'diagnoses')
            AND parent.table_name IN ('access_sessions', 'conversations')`,
      );
      const nullableUsage = await client.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'interaction_turns'
            AND column_name IN ('input_tokens', 'output_tokens', 'estimated_cost_usd')
          ORDER BY column_name`,
      );
      assert.equal(runtimeReferences.rowCount, 0);
      assert.deepEqual(nullableUsage.rows, [
        { column_name: 'estimated_cost_usd', is_nullable: 'YES' },
        { column_name: 'input_tokens', is_nullable: 'YES' },
        { column_name: 'output_tokens', is_nullable: 'YES' },
      ]);
    });
  } finally {
    await database.dispose();
  }
});

test('migration 004 upgrades a populated 001-003 database without rewriting existing data', async () => {
  const database = await createDisposablePostgresDatabase();
  const through003 = await copyMigrations();
  const turnId = randomUUID();
  const inviteId = randomUUID();
  try {
    await fs.rm(path.join(through003, '004_admin_api_management.sql'), { force: true });
    await fs.rm(path.join(through003, '005_chat_v2.sql'), { force: true });
    await fs.rm(path.join(through003, '006_interaction_invite_label.sql'), { force: true });
    const initial = await runMigrations(database.connectionString, through003);
    assert.equal(initial.code, 0, initial.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      await client.query(
        `INSERT INTO interaction_turns
          (id, access_session_id, workflow, audience_intent, question, status, delete_after)
         VALUES ($1, $2, 'chat', 'general', 'preserve interaction', 'completed', now() + interval '10 days')`,
        [turnId, randomUUID()],
      );
      await client.query(
        `INSERT INTO resume_invites
          (id, code_hash, trusted_person_note, expires_at, created_by_admin_session)
         VALUES ($1, $2, 'preserve invite', now() + interval '1 day', $3)`,
        [inviteId, 'f'.repeat(64), randomUUID()],
      );
    });

    const upgraded = await runMigrations(database.connectionString);
    assert.equal(upgraded.code, 0, upgraded.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      const versions = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      );
      const interaction = await client.query<{ question: string }>(
        'SELECT question FROM interaction_turns WHERE id = $1',
        [turnId],
      );
      const invite = await client.query<{ trusted_person_note: string }>(
        'SELECT trusted_person_note FROM resume_invites WHERE id = $1',
        [inviteId],
      );
      assert.deepEqual(
        versions.rows.map((row) => row.version),
        ['001', '002', '003', '004', '005', '006'],
      );
      assert.deepEqual(interaction.rows, [{ question: 'preserve interaction' }]);
      assert.deepEqual(invite.rows, [{ trusted_person_note: 'preserve invite' }]);
    });
  } finally {
    await fs.rm(through003, { force: true, recursive: true });
    await database.dispose();
  }
});

test('migration 004 enforces singleton runtime state and complete one-to-six routes', async () => {
  const database = await createDisposablePostgresDatabase();
  try {
    const result = await runMigrations(database.connectionString);
    assert.equal(result.code, 0, result.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      const runtime = await client.query<{ active_route_revision_id: string | null; lock_version: number }>(
        `SELECT active_route_revision_id, lock_version::integer AS lock_version
           FROM ai_runtime_state WHERE id = true`,
      );
      assert.deepEqual(runtime.rows, [{ active_route_revision_id: null, lock_version: 0 }]);
      await assert.rejects(
        client.query('INSERT INTO ai_runtime_state (id, lock_version) VALUES (false, 0)'),
        (error: unknown) => typeof error === 'object' && error !== null
          && 'code' in error && error.code === '23514',
      );

      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO ai_route_revisions
            (id, revision_number, activation_kind, activated_at, actor_admin_session_id)
           VALUES ($1, 1, 'activate', now(), $2)`,
          [randomUUID(), randomUUID()],
        );
        await assert.rejects(
          client.query('COMMIT'),
          (error: unknown) => typeof error === 'object' && error !== null
            && 'code' in error && error.code === '23514',
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });
  } finally {
    await database.dispose();
  }
});

test('migration 004 protects audit retention and provider attempt attribution', async () => {
  const database = await createDisposablePostgresDatabase();
  try {
    const result = await runMigrations(database.connectionString);
    assert.equal(result.code, 0, result.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      const event = await client.query<{ id: string }>(
        `INSERT INTO ai_config_events (event_type, result_code, status)
         VALUES ('connection_created', 'AI_CONFIG_CREATED', 'succeeded') RETURNING id::text`,
      );
      await assert.rejects(
        client.query('UPDATE ai_config_events SET result_code = $2 WHERE id = $1', [
          event.rows[0].id,
          'AI_CONFIG_REWRITTEN',
        ]),
        (error: unknown) => typeof error === 'object' && error !== null
          && 'code' in error && error.code === '23514',
      );
      await assert.rejects(
        client.query('DELETE FROM ai_config_events WHERE id = $1', [event.rows[0].id]),
        (error: unknown) => typeof error === 'object' && error !== null
          && 'code' in error && error.code === '23514',
      );

      const turnId = randomUUID();
      await client.query(
        `INSERT INTO interaction_turns
          (id, access_session_id, workflow, audience_intent, question, status, delete_after)
         VALUES ($1, $2, 'chat', 'general', 'attempt constraints', 'completed', now() + interval '10 days')`,
        [turnId, randomUUID()],
      );
      const baseAttempt = [
        turnId,
        0,
        'environment',
        'Environment',
        'Environment model',
        'gpt-environment',
        'responses',
        'd'.repeat(64),
        'completed',
      ];
      await assert.rejects(
        client.query(
          `INSERT INTO interaction_provider_attempts
            (interaction_turn_id, attempt_index, source_type, connection_version_id,
             connection_display_name, model_display_name, model_id, protocol,
             config_digest, status, completed_at)
           VALUES ($1,$2,$3,$10,$4,$5,$6,$7,$8,$9,now())`,
          [...baseAttempt, randomUUID()],
        ),
        (error: unknown) => typeof error === 'object' && error !== null
          && 'code' in error && error.code === '23514',
      );
      await assert.rejects(
        client.query(
          `INSERT INTO interaction_provider_attempts
            (interaction_turn_id, attempt_index, source_type,
             connection_display_name, model_display_name, model_id, protocol,
             config_digest, status, cost_complete, completed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,now())`,
          baseAttempt,
        ),
        (error: unknown) => typeof error === 'object' && error !== null
          && 'code' in error && error.code === '23514',
      );
      await assert.rejects(
        client.query(
          `INSERT INTO interaction_provider_attempts
            (interaction_turn_id, attempt_index, source_type,
             connection_display_name, model_display_name, model_id, protocol,
             config_digest, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [baseAttempt[0], 1, ...baseAttempt.slice(2)],
        ),
        (error: unknown) => typeof error === 'object' && error !== null
          && 'code' in error && error.code === '23514',
      );
      await assert.rejects(
        client.query(
          `INSERT INTO interaction_provider_attempts
            (interaction_turn_id, attempt_index, source_type,
             connection_display_name, model_display_name, model_id, protocol,
             config_digest, status, usage_complete, completed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,now())`,
          [baseAttempt[0], 2, ...baseAttempt.slice(2)],
        ),
        (error: unknown) => typeof error === 'object' && error !== null
          && 'code' in error && error.code === '23514',
      );
      await client.query(
        `INSERT INTO interaction_provider_attempts
          (interaction_turn_id, attempt_index, source_type,
           connection_display_name, model_display_name, model_id, protocol,
           config_digest, status, usage_complete, input_tokens, output_tokens,
           cost_complete, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,10,5,false,now())`,
        baseAttempt,
      );
      await assert.rejects(
        client.query(
          `INSERT INTO usage_events
            (provider, model, input_tokens, output_tokens, estimated_cost_usd,
             interaction_turn_id, cost_complete)
           VALUES ('openai-compatible', 'gpt-environment', 10, 5, NULL, $1, false)`,
          [turnId],
        ),
        (error: unknown) => typeof error === 'object' && error !== null
          && 'code' in error && error.code === '23514',
      );
      await assert.rejects(
        client.query(
          `INSERT INTO usage_events
            (provider, model, input_tokens, output_tokens, estimated_cost_usd,
             interaction_turn_id, provider_attempt_index, cost_complete)
           VALUES ('openai-compatible', 'gpt-environment', 10, 5, NULL, $1, 5, false)`,
          [turnId],
        ),
        (error: unknown) => typeof error === 'object' && error !== null
          && 'code' in error && error.code === '23503',
      );
      await assert.rejects(
        client.query(
          `INSERT INTO usage_events
            (provider, model, input_tokens, output_tokens, estimated_cost_usd,
             interaction_turn_id, provider_attempt_index, cost_complete)
           VALUES ('openai-compatible', 'gpt-environment', 10, 5, NULL, $1, 0, true)`,
          [turnId],
        ),
        (error: unknown) => typeof error === 'object' && error !== null
          && 'code' in error && error.code === '23514',
      );
      const usageDefault = await client.query<{ column_default: string | null }>(
        `SELECT column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'usage_events'
            AND column_name = 'estimated_cost_usd'`,
      );
      assert.deepEqual(usageDefault.rows, [{ column_default: null }]);
    });
  } finally {
    await database.dispose();
  }
});

test('chat v2 migration adds stable assignment and metadata-only provider attempts', async () => {
  const database = await createDisposablePostgresDatabase();
  try {
    const result = await runMigrations(database.connectionString);
    assert.equal(result.code, 0, result.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      const behaviorColumn = await client.query<{
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'access_sessions'
            AND column_name = 'chat_behavior_version'`,
      );
      const attemptPrimaryKey = await client.query<{ column_name: string }>(
        `SELECT key_column.column_name
           FROM information_schema.table_constraints AS constraint_record
           JOIN information_schema.key_column_usage AS key_column
             ON key_column.constraint_catalog = constraint_record.constraint_catalog
            AND key_column.constraint_schema = constraint_record.constraint_schema
            AND key_column.constraint_name = constraint_record.constraint_name
          WHERE constraint_record.table_schema = 'public'
            AND constraint_record.table_name = 'chat_provider_attempts'
            AND constraint_record.constraint_type = 'PRIMARY KEY'
          ORDER BY key_column.ordinal_position`,
      );
      const rawTextColumns = await client.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'chat_provider_attempts'
            AND column_name ~ '(question|answer|prompt|jd|url|key|payload|content|request|response)'`,
      );

      assert.deepEqual(behaviorColumn.rows, [{ data_type: 'text', is_nullable: 'YES' }]);
      assert.deepEqual(
        attemptPrimaryKey.rows.map((row) => row.column_name),
        ['interaction_turn_id', 'execution_id', 'attempt_no'],
      );
      assert.equal(rawTextColumns.rowCount, 0);
    });
  } finally {
    await database.dispose();
  }
});

test('interaction attribution migration adds and backfills only an invite label snapshot', async () => {
  const database = await createDisposablePostgresDatabase();
  const initialDirectory = await copyMigrations();
  const inviteId = randomUUID();
  const sessionId = randomUUID();
  const turnId = randomUUID();
  try {
    await fs.rm(
      path.join(initialDirectory, '006_interaction_invite_label.sql'),
      { force: true },
    );
    const initial = await runMigrations(database.connectionString, initialDirectory);
    assert.equal(initial.code, 0, initial.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      await client.query(
        `INSERT INTO invite_codes
          (id, code_hash, label, active, expires_at, max_sessions, session_count)
         VALUES ($1, $2, $3, true, NOW() + INTERVAL '1 day', 1, 1)`,
        [inviteId, 'c'.repeat(64), '历史公司备注'],
      );
      await client.query(
        `INSERT INTO access_sessions
          (id, invite_code_id, token_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '12 hours')`,
        [sessionId, inviteId, 'd'.repeat(64)],
      );
      await client.query(
        `INSERT INTO interaction_turns
          (id, access_session_id, workflow, audience_intent, question, status, delete_after)
         VALUES ($1, $2, 'chat', 'general', '历史问题', 'completed', NOW() + INTERVAL '10 days')`,
        [turnId, sessionId],
      );
    });

    const result = await runMigrations(database.connectionString);
    assert.equal(result.code, 0, result.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      const attributionColumns = await client.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'interaction_turns'
            AND column_name IN ('invite_label', 'invite_code_id')
          ORDER BY column_name`,
      );
      assert.deepEqual(attributionColumns.rows, [{
        column_name: 'invite_label',
        data_type: 'text',
        is_nullable: 'YES',
      }]);
      const attribution = await client.query<{ invite_label: string | null }>(
        'SELECT invite_label FROM interaction_turns WHERE id = $1',
        [turnId],
      );
      assert.deepEqual(attribution.rows, [{ invite_label: '历史公司备注' }]);
    });
  } finally {
    await fs.rm(initialDirectory, { force: true, recursive: true });
    await database.dispose();
  }
});

test('S10 workflow machine values are enforced in conversations and interaction logs', async () => {
  const database = await createDisposablePostgresDatabase();
  const inviteId = randomUUID();
  const sessionId = randomUUID();
  try {
    const result = await runMigrations(database.connectionString);
    assert.equal(result.code, 0, result.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      await client.query(
        `INSERT INTO invite_codes
          (id, code_hash, label, active, expires_at, max_sessions, session_count)
         VALUES ($1, $2, 'workflow fixture', true, now() + interval '1 day', 3, 0)`,
        [inviteId, 'd'.repeat(64)],
      );
      await client.query(
        `INSERT INTO access_sessions
          (id, invite_code_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '12 hours')`,
        [sessionId, inviteId, 'e'.repeat(64)],
      );

      for (const workflow of ['chat', 'jd_match', 'diagnosis']) {
        await client.query(
          `INSERT INTO conversations
            (id, access_session_id, mode, workflow, expires_at)
           VALUES ($1, $2, 'general', $3, now() + interval '12 hours')`,
          [randomUUID(), sessionId, workflow],
        );
        await client.query(
          `INSERT INTO interaction_turns
            (id, access_session_id, workflow, audience_intent, question, status, delete_after)
           VALUES ($1, $2, $3, 'general', 'workflow fixture', 'completed', now() + interval '10 days')`,
          [randomUUID(), sessionId, workflow],
        );
      }

      const defaultConversationId = randomUUID();
      await client.query(
        `INSERT INTO conversations (id, access_session_id, mode, expires_at)
         VALUES ($1, $2, 'general', now() + interval '12 hours')`,
        [defaultConversationId, sessionId],
      );
      const defaultWorkflow = await client.query<{ workflow: string }>(
        'SELECT workflow FROM conversations WHERE id = $1',
        [defaultConversationId],
      );
      assert.equal(defaultWorkflow.rows[0].workflow, 'chat');

      await assert.rejects(
        client.query(
          `INSERT INTO conversations
            (id, access_session_id, mode, workflow, expires_at)
           VALUES ($1, $2, 'general', 'unknown', now() + interval '12 hours')`,
          [randomUUID(), sessionId],
        ),
        (error: unknown) => (
          typeof error === 'object' && error !== null && 'code' in error && error.code === '23514'
        ),
      );
      await assert.rejects(
        client.query(
          `INSERT INTO interaction_turns
            (id, access_session_id, workflow, audience_intent, question, status, delete_after)
           VALUES ($1, $2, 'unknown', 'general', 'workflow fixture', 'completed', now() + interval '10 days')`,
          [randomUUID(), sessionId],
        ),
        (error: unknown) => (
          typeof error === 'object' && error !== null && 'code' in error && error.code === '23514'
        ),
      );
    });
  } finally {
    await database.dispose();
  }
});

test('PostgreSQL test utilities reject non-loopback hosts before connecting', async () => {
  const utilities = await import('./postgres-test-utils.ts');
  assert.equal(typeof utilities.validateLoopbackPostgresUrl, 'function');
  assert.doesNotThrow(() => utilities.validateLoopbackPostgresUrl(
    'postgresql://revolution@localhost:55432/revolution',
  ));
  assert.doesNotThrow(() => utilities.validateLoopbackPostgresUrl(
    'postgresql://revolution@127.0.0.1:55432/revolution',
  ));
  assert.doesNotThrow(() => utilities.validateLoopbackPostgresUrl(
    'postgresql://revolution@[::1]:55432/revolution',
  ));
  assert.throws(
    () => utilities.validateLoopbackPostgresUrl(
      'postgresql://revolution@db.example.com:5432/revolution',
    ),
    /loopback/i,
  );
});
