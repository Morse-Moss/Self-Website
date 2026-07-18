import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { createDatabaseClientConfig } from '../lib/server/db.ts';

const { Client } = pg;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = process.env.MORSE_MIGRATIONS_DIR
  ? path.resolve(process.cwd(), process.env.MORSE_MIGRATIONS_DIR)
  : path.join(repoRoot, 'db', 'migrations');
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required.');
}

const legacyTables = [
  'knowledge_documents',
  'knowledge_chunks',
  'invite_codes',
  'access_sessions',
  'conversations',
  'conversation_messages',
  'usage_events',
];

const s10Tables = [
  'interaction_turns',
  'interaction_searches',
  'diagnoses',
  'alert_outbox',
  'service_incidents',
  'admin_sessions',
  'admin_security_state',
  'access_attempts',
];

const legacyColumns = [
  ['knowledge_documents', 'id', 'text', false],
  ['knowledge_documents', 'title', 'text', false],
  ['knowledge_documents', 'source_path', 'text', false],
  ['knowledge_documents', 'checksum', 'text', false],
  ['knowledge_documents', 'indexed_at', 'timestamptz', false],
  ['knowledge_chunks', 'id', 'text', false],
  ['knowledge_chunks', 'document_id', 'text', false],
  ['knowledge_chunks', 'ordinal', 'int4', false],
  ['knowledge_chunks', 'content', 'text', false],
  ['knowledge_chunks', 'embedding', 'vector', false],
  ['knowledge_chunks', 'metadata', 'jsonb', false],
  ['knowledge_chunks', 'created_at', 'timestamptz', false],
  ['invite_codes', 'id', 'uuid', false],
  ['invite_codes', 'code_hash', 'bpchar', false],
  ['invite_codes', 'label', 'text', false],
  ['invite_codes', 'active', 'bool', false],
  ['invite_codes', 'expires_at', 'timestamptz', false],
  ['invite_codes', 'max_sessions', 'int4', false],
  ['invite_codes', 'session_count', 'int4', false],
  ['invite_codes', 'created_at', 'timestamptz', false],
  ['access_sessions', 'id', 'uuid', false],
  ['access_sessions', 'invite_code_id', 'uuid', false],
  ['access_sessions', 'token_hash', 'bpchar', false],
  ['access_sessions', 'expires_at', 'timestamptz', false],
  ['access_sessions', 'message_count', 'int4', false],
  ['access_sessions', 'created_at', 'timestamptz', false],
  ['access_sessions', 'last_seen_at', 'timestamptz', false],
  ['conversations', 'id', 'uuid', false],
  ['conversations', 'access_session_id', 'uuid', false],
  ['conversations', 'mode', 'text', false],
  ['conversations', 'expires_at', 'timestamptz', false],
  ['conversations', 'created_at', 'timestamptz', false],
  ['conversations', 'updated_at', 'timestamptz', false],
  ['conversation_messages', 'id', 'int8', false],
  ['conversation_messages', 'conversation_id', 'uuid', false],
  ['conversation_messages', 'role', 'text', false],
  ['conversation_messages', 'content', 'text', false],
  ['conversation_messages', 'created_at', 'timestamptz', false],
  ['usage_events', 'id', 'int8', false],
  ['usage_events', 'access_session_id', 'uuid', true],
  ['usage_events', 'conversation_id', 'uuid', true],
  ['usage_events', 'provider', 'text', false],
  ['usage_events', 'model', 'text', false],
  ['usage_events', 'input_tokens', 'int4', false],
  ['usage_events', 'output_tokens', 'int4', false],
  ['usage_events', 'estimated_cost_usd', 'numeric', false],
  ['usage_events', 'created_at', 'timestamptz', false],
];

const legacyConstraints = [
  ['knowledge_documents', /PRIMARY KEY \(id\)/i],
  ['knowledge_documents', /UNIQUE \(source_path\)/i],
  ['knowledge_chunks', /PRIMARY KEY \(id\)/i],
  ['knowledge_chunks', /UNIQUE \(document_id, ordinal\)/i],
  ['knowledge_chunks', /FOREIGN KEY \(document_id\).*knowledge_documents\(id\) ON DELETE CASCADE/i],
  ['knowledge_chunks', /CHECK \(\(ordinal >= 0\)\)/i],
  ['invite_codes', /PRIMARY KEY \(id\)/i],
  ['invite_codes', /UNIQUE \(code_hash\)/i],
  ['invite_codes', /CHECK \(\(max_sessions > 0\)\)/i],
  ['invite_codes', /CHECK \(\(session_count >= 0\)\)/i],
  ['access_sessions', /PRIMARY KEY \(id\)/i],
  ['access_sessions', /UNIQUE \(token_hash\)/i],
  ['access_sessions', /FOREIGN KEY \(invite_code_id\).*invite_codes\(id\) ON DELETE CASCADE/i],
  ['access_sessions', /CHECK \(\(message_count >= 0\)\)/i],
  ['conversations', /PRIMARY KEY \(id\)/i],
  ['conversations', /FOREIGN KEY \(access_session_id\).*access_sessions\(id\) ON DELETE CASCADE/i],
  ['conversations', /CHECK \(\(mode = ANY \(ARRAY\['general'::text, 'interviewer'::text\]\)\)\)/i],
  ['conversation_messages', /PRIMARY KEY \(id\)/i],
  ['conversation_messages', /FOREIGN KEY \(conversation_id\).*conversations\(id\) ON DELETE CASCADE/i],
  ['conversation_messages', /CHECK \(\(role = ANY \(ARRAY\['user'::text, 'assistant'::text\]\)\)\)/i],
  ['usage_events', /PRIMARY KEY \(id\)/i],
  ['usage_events', /FOREIGN KEY \(access_session_id\).*access_sessions\(id\) ON DELETE SET NULL/i],
  ['usage_events', /FOREIGN KEY \(conversation_id\).*conversations\(id\) ON DELETE SET NULL/i],
  ['usage_events', /CHECK \(\(input_tokens >= 0\)\)/i],
  ['usage_events', /CHECK \(\(output_tokens >= 0\)\)/i],
  ['usage_events', /CHECK \(\(estimated_cost_usd >= .*0/i],
];

const legacyIndexes = [
  'knowledge_chunks_embedding_hnsw_idx',
  'invite_codes_expires_at_idx',
  'access_sessions_expires_at_idx',
  'conversations_expires_at_idx',
  'conversation_messages_conversation_idx',
  'usage_events_created_at_idx',
];

function compareVersions(left, right) {
  const leftNumber = BigInt(left.version);
  const rightNumber = BigInt(right.version);
  if (leftNumber < rightNumber) return -1;
  if (leftNumber > rightNumber) return 1;
  return left.fileName.localeCompare(right.fileName);
}

function migrationSql(sql, fileName) {
  if (!/^\uFEFF?\s*BEGIN\s*;/i.test(sql)) return sql;
  const withoutBegin = sql.replace(/^\uFEFF?\s*BEGIN\s*;\s*/i, '');
  if (!/\s*COMMIT\s*;\s*$/i.test(withoutBegin)) {
    throw new Error(`Migration ${fileName} has an unmatched transaction wrapper.`);
  }
  return withoutBegin.replace(/\s*COMMIT\s*;\s*$/i, '');
}

async function readMigrations() {
  const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true });
  const migrations = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map(async (entry) => {
      const match = /^(\d+)[_-].+\.sql$/i.exec(entry.name);
      if (!match) throw new Error(`Invalid migration filename: ${entry.name}`);
      const bytes = await fs.readFile(path.join(migrationsDirectory, entry.name));
      return {
        version: match[1],
        fileName: entry.name,
        checksum: createHash('sha256').update(bytes).digest('hex'),
        sql: bytes.toString('utf8'),
      };
    }));
  migrations.sort(compareVersions);
  const versions = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    versions.add(migration.version);
  }
  if (!migrations.some((migration) => migration.version === '001')) {
    throw new Error('Migration 001 is required.');
  }
  return migrations;
}

async function inTransaction(client, run) {
  await client.query('BEGIN');
  try {
    const result = await run();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function bootstrapRegistry(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      CHECK (version ~ '^[0-9]+$'),
      CHECK (checksum ~ '^[0-9a-f]{64}$')
    )
  `);
}

async function inspectUnregisteredSchema(client) {
  const extension = await client.query(
    "SELECT 1 FROM pg_extension WHERE extname = 'vector'",
  );
  const publicTables = await client.query(`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
       AND table_name <> 'schema_migrations'
  `);
  const tableNames = new Set(publicTables.rows.map((row) => row.table_name));
  const s10Columns = await client.query(`
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (
         (table_name = 'conversations' AND column_name IN ('workflow', 'audience_intent'))
         OR (table_name = 'access_sessions' AND column_name = 'search_count')
       )
     LIMIT 1
  `);

  if (extension.rowCount === 0 && tableNames.size === 0 && s10Columns.rowCount === 0) {
    return 'empty';
  }
  if (
    extension.rowCount !== 1
    || tableNames.size !== legacyTables.length
    || legacyTables.some((table) => !tableNames.has(table))
    || s10Tables.some((table) => tableNames.has(table))
    || s10Columns.rowCount !== 0
  ) {
    return 'partial';
  }

  const columns = await client.query(`
    SELECT table_name, column_name, udt_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
  `, [legacyTables]);
  const actualColumns = new Map(columns.rows.map((column) => [
    `${column.table_name}.${column.column_name}`,
    column,
  ]));
  for (const [table, name, type, nullable] of legacyColumns) {
    const actual = actualColumns.get(`${table}.${name}`);
    if (!actual || actual.udt_name !== type || (actual.is_nullable === 'YES') !== nullable) {
      return 'partial';
    }
  }

  const embeddingType = await client.query(`
    SELECT pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS formatted_type
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = 'knowledge_chunks'
       AND attribute.attname = 'embedding'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  `);
  if (embeddingType.rows[0]?.formatted_type !== 'vector(1536)') return 'partial';

  const constraints = await client.query(`
    SELECT relation.relname AS table_name,
           pg_get_constraintdef(constraint_record.oid) AS definition
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS relation ON relation.oid = constraint_record.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = ANY($1::text[])
  `, [legacyTables]);
  for (const [table, pattern] of legacyConstraints) {
    if (!constraints.rows.some((constraint) => (
      constraint.table_name === table && pattern.test(constraint.definition)
    ))) {
      return 'partial';
    }
  }

  const indexes = await client.query(`
    SELECT indexname
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = ANY($1::text[])
  `, [legacyIndexes]);
  const indexNames = new Set(indexes.rows.map((index) => index.indexname));
  if (legacyIndexes.some((index) => !indexNames.has(index))) return 'partial';
  return 'legacy-001';
}

async function loadAppliedMigrations(client) {
  const result = await client.query(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  );
  return new Map(result.rows.map((row) => [row.version, row.checksum]));
}

function validateAppliedMigrations(applied, migrations) {
  const available = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const [version, checksum] of applied) {
    const migration = available.get(version);
    if (!migration) throw new Error(`Applied migration ${version} is missing from disk.`);
    if (migration.checksum !== checksum) {
      throw new Error(`Checksum mismatch for migration ${version}.`);
    }
  }
}

const client = new Client(createDatabaseClientConfig(connectionString, {
  env: process.env,
  role: 'migration',
}));
let migrationLockKey = null;
let migrationLockAcquired = false;

try {
  const migrations = await readMigrations();
  await client.connect();
  const database = await client.query('SELECT current_database() AS name');
  migrationLockKey = `revolution:migrate-db:v1:${database.rows[0].name}`;
  await client.query(
    'SELECT pg_advisory_lock(hashtextextended($1::text, 0))',
    [migrationLockKey],
  );
  migrationLockAcquired = true;
  await bootstrapRegistry(client);

  let applied = await loadAppliedMigrations(client);
  validateAppliedMigrations(applied, migrations);
  if (!applied.has('001')) {
    if (applied.size > 0) {
      throw new Error('Migration registry is incompatible: 001 is not registered first.');
    }
    const state = await inspectUnregisteredSchema(client);
    if (state === 'partial') {
      throw new Error('Partial or incompatible unregistered schema; 001 sentinel validation failed.');
    }
    if (state === 'legacy-001') {
      const initial = migrations.find((migration) => migration.version === '001');
      await inTransaction(client, async () => {
        if (await inspectUnregisteredSchema(client) !== 'legacy-001') {
          throw new Error('001 sentinel validation changed during baseline registration.');
        }
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [initial.version, initial.checksum],
        );
      });
      applied.set(initial.version, initial.checksum);
      console.log('Baseline migration 001 registered.');
    }
  }

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    await inTransaction(client, async () => {
      await client.query(migrationSql(migration.sql, migration.fileName));
      await client.query(
        'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
        [migration.version, migration.checksum],
      );
    });
    applied.set(migration.version, migration.checksum);
    console.log(`Migration ${migration.version} applied.`);
  }

  console.log(`Database migrations current through ${migrations.at(-1).version}.`);
} finally {
  if (migrationLockAcquired) {
    try {
      await client.query(
        'SELECT pg_advisory_unlock(hashtextextended($1::text, 0))',
        [migrationLockKey],
      );
    } catch {
      // Ending the PostgreSQL session releases any remaining session advisory lock.
    }
  }
  await client.end();
}
