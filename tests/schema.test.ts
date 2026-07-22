import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const schemaPath = path.resolve('db/migrations/001_morse_rag.sql');
const customerServiceMigrationPath = path.resolve(
  'db/migrations/002_s10_customer_service.sql',
);
const privateResumeMigrationPath = path.resolve(
  'db/migrations/003_private_resume.sql',
);
const adminApiMigrationPath = path.resolve(
  'db/migrations/004_admin_api_management.sql',
);
const chatResponseReliabilityMigrationPath = path.resolve(
  'db/migrations/007_chat_response_reliability.sql',
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

test('private resume migration 003 is present', () => {
  assert.equal(
    fs.existsSync(privateResumeMigrationPath),
    true,
    'db/migrations/003_private_resume.sql must exist',
  );
});

test('private resume migration declares an isolated four-table domain', () => {
  assert.equal(
    fs.existsSync(privateResumeMigrationPath),
    true,
    'db/migrations/003_private_resume.sql must exist',
  );
  const sql = fs.readFileSync(privateResumeMigrationPath, 'utf8');

  for (const table of [
    'resume_documents',
    'resume_invites',
    'resume_sessions',
    'resume_access_events',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`, 'i'));
  }

  assert.match(sql, /invite_id\s+uuid\s+NOT NULL\s+UNIQUE/i);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX resume_documents_one_current_idx[\s\S]*WHERE\s+is_current(?:\s*=\s*true)?/i,
  );
  assert.doesNotMatch(
    sql,
    /REFERENCES\s+(?:invite_codes|access_sessions|conversations|conversation_messages)/i,
  );
});

test('admin API management migration declares the versioned encrypted routing domain', () => {
  assert.equal(
    fs.existsSync(adminApiMigrationPath),
    true,
    'db/migrations/004_admin_api_management.sql must exist',
  );
  const sql = fs.readFileSync(adminApiMigrationPath, 'utf8');

  for (const table of [
    'ai_connections',
    'ai_model_presets',
    'ai_route_revisions',
    'ai_route_targets',
    'ai_runtime_state',
    'ai_config_events',
    'interaction_provider_attempts',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`, 'i'));
  }

  assert.match(sql, /UNIQUE\s*\(series_id,\s*version\)/i);
  assert.match(sql, /api_key_ciphertext[\s\S]*api_key_iv[\s\S]*api_key_tag/i);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/i);
  assert.match(sql, /position[\s\S]*BETWEEN 0 AND 5/i);
  assert.match(sql, /INSERT INTO ai_runtime_state[\s\S]*VALUES\s*\(true,\s*NULL,\s*0\)/i);
  assert.match(sql, /ON DELETE CASCADE/i);
  assert.match(sql, /ALTER TABLE usage_events[\s\S]*estimated_cost_usd DROP NOT NULL/i);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN/i);
});

test('migration 007 adds auditable chat routes and provider timing without destructive DDL', () => {
  const sql = fs.readFileSync(chatResponseReliabilityMigrationPath, 'utf8');

  for (const column of [
    'route_kind',
    'route_reason_code',
    'topic_kind',
    'topic_ref',
    'evidence_class',
    'inherited_from_turn_id',
    'launch_kind',
    'generation_mode',
    'first_protocol_event_ms',
    'first_model_text_ms',
    'first_user_visible_ms',
  ]) {
    assert.match(sql, new RegExp(column, 'i'));
  }
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)/i);
});
