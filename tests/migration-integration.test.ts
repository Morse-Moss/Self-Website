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
    assert.deepEqual(firstRows.migrations.map((row) => row.version), ['001', '002', '003']);
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
      assert.deepEqual(migrations.rows.map((row) => row.version), ['001', '002', '003']);
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
