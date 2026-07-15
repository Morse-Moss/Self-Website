import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import pg from 'pg';

import { hasSufficientLocalEvidence, retrieveKnowledge } from '../lib/server/rag.ts';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
const pool = connectionString ? new Pool({ connectionString }) : null;

after(async () => {
  await pool?.end();
});

test('retrieveKnowledge returns citable pgvector evidence ordered by cosine score', {
  skip: !pool,
}, async () => {
  const stored = await pool!.query<{ embedding: string }>(
    `SELECT embedding::text AS embedding
       FROM knowledge_chunks
      WHERE document_id = 'project-deep-research'
      ORDER BY ordinal
      LIMIT 1`,
  );
  const query = JSON.parse(stored.rows[0].embedding) as number[];
  const sources = await retrieveKnowledge(pool!, query, 3);

  assert.equal(sources.length, 3);
  assert.equal(sources[0].documentId, 'project-deep-research');
  assert.equal(sources[0].title, '深度研究 Agent 系统');
  assert.match(sources[0].sourcePath, /^content\/site-content\.json#/);
  assert.ok(sources[0].score >= sources[1].score);
  assert.doesNotMatch(JSON.stringify(sources), /content[\\/]drafts|E:\\/i);
});

test('local evidence sufficiency rejects a non-empty low-similarity retrieval', {
  skip: !pool,
}, async () => {
  const stored = await pool!.query<{ embedding: string }>(
    `SELECT embedding::text AS embedding
       FROM knowledge_chunks
      WHERE document_id = 'project-deep-research'
      ORDER BY ordinal
      LIMIT 1`,
  );
  const matchingQuery = JSON.parse(stored.rows[0].embedding) as number[];
  const matching = await retrieveKnowledge(pool!, matchingQuery, 3);
  const unrelated = await retrieveKnowledge(
    pool!,
    matchingQuery.map((value) => -value),
    3,
  );

  assert.ok(unrelated.length > 0, 'fixture must prove that a non-empty database always returns rows');
  assert.equal(hasSufficientLocalEvidence(matching), true);
  assert.equal(hasSufficientLocalEvidence(unrelated), false);
});
