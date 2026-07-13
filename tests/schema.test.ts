import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const schemaPath = path.resolve('db/migrations/001_morse_rag.sql');

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
