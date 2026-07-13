import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import pg from 'pg';

import { createDeterministicTestEmbedding } from '../lib/server/embedding.ts';
import { retrieveKnowledge } from '../lib/server/rag.ts';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
const pool = connectionString ? new Pool({ connectionString }) : null;

after(async () => {
  await pool?.end();
});

test('retrieveKnowledge returns citable pgvector evidence ordered by cosine score', {
  skip: !pool,
}, async () => {
  const query = createDeterministicTestEmbedding('深度研究系统如何保证证据可追溯?');
  const sources = await retrieveKnowledge(pool!, query, 3);

  assert.equal(sources.length, 3);
  assert.equal(sources[0].documentId, 'project-deep-research');
  assert.equal(sources[0].title, '深度研究系统');
  assert.match(sources[0].sourcePath, /^content\/s3-content\.json#/);
  assert.ok(sources[0].score >= sources[1].score);
  assert.doesNotMatch(JSON.stringify(sources), /content[\\/]drafts|E:\\/i);
});
