import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const schemaPath = path.resolve('db/migrations/001_morse_rag.sql');
const customerServiceMigrationPath = path.resolve(
  'db/migrations/002_s10_customer_service.sql',
);

test('M3 schema provides pgvector retrieval and short-lived access storage', () => {
  const sql = fs.readFileSync(schemaPath, 'utf8');

  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/i);
  assert.match(sql, /embedding vector\(1536\)/i);
  assert.match(sql, /USING hnsw \(embedding vector_cosine_ops\)/i);

  for (const table of [
    'knowledge_documents',
    'knowledge_chunks',
    'invite_codes',
    'access_sessions',
    'conversations',
    'conversation_messages',
    'usage_events',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'));
  }

  assert.match(sql, /ON DELETE CASCADE/i);
  assert.match(sql, /access_sessions_expires_at_idx/i);
  assert.match(sql, /conversations_expires_at_idx/i);
  assert.doesNotMatch(sql, /content[\\/]drafts/i);
});

test('S10 customer service migration is present', () => {
  assert.equal(fs.existsSync(customerServiceMigrationPath), true);
});

test('S10 customer service migration is additive and keeps analytics independent', () => {
  assert.equal(fs.existsSync(customerServiceMigrationPath), true);
  const sql = fs.readFileSync(customerServiceMigrationPath, 'utf8');

  for (const table of [
    'interaction_turns',
    'interaction_searches',
    'diagnoses',
    'alert_outbox',
    'service_incidents',
    'admin_sessions',
    'admin_security_state',
    'access_attempts',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`, 'i'));
  }

  assert.match(sql, /ALTER TABLE conversations[\s\S]*ADD COLUMN workflow/i);
  assert.match(sql, /ALTER TABLE conversations[\s\S]*ADD COLUMN audience_intent/i);
  assert.match(sql, /ALTER TABLE access_sessions[\s\S]*ADD COLUMN search_count/i);
  assert.doesNotMatch(
    sql,
    /access_session_id[^,;]*REFERENCES\s+access_sessions|conversation_id[^,;]*REFERENCES\s+conversations/i,
  );
  assert.match(sql, /input_tokens\s+integer(?!\s+NOT NULL)/i);
  assert.match(sql, /output_tokens\s+integer(?!\s+NOT NULL)/i);
  assert.match(sql, /estimated_cost_usd\s+numeric\([^)]*\)(?!\s+NOT NULL)/i);
  assert.equal(sql.match(/last_totp_counter/gi)?.length, 1);
  assert.doesNotMatch(sql, /last_export_totp_counter/i);
  assert.doesNotMatch(sql, /IF NOT EXISTS/i);
  assert.doesNotMatch(sql, /schema_migrations/i);
});
