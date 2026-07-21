import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import pg from 'pg';

import {
  filterRelevantKnowledge,
  hasSufficientLocalEvidence,
  retrieveKnowledge,
  type KnowledgeSource,
} from '../lib/server/rag.ts';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
const pool = connectionString ? new Pool({ connectionString }) : null;

after(async () => {
  await pool?.end();
});

function source(documentId: string, score: number): KnowledgeSource {
  return {
    chunkId: `${documentId}:1`,
    documentId,
    title: documentId,
    sourcePath: `content/site-content.json#${documentId}`,
    href: `/works#${documentId}`,
    content: documentId,
    score,
  };
}

test('filterRelevantKnowledge removes every source below the calibrated gate', () => {
  assert.deepEqual(
    filterRelevantKnowledge([
      source('keep', 0.51),
      source('boundary', 0.45),
      source('drop', 0.449),
      source('nan', Number.NaN),
    ]).map((item) => item.documentId),
    ['keep', 'boundary'],
  );
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

test('retrieveKnowledge returns at most one citation per public document', {
  skip: !pool,
}, async () => {
  const stored = await pool!.query<{ embedding: string }>(
    `SELECT embedding::text AS embedding
       FROM knowledge_chunks
      WHERE document_id = 'about'
      ORDER BY ordinal DESC
      LIMIT 1`,
  );
  const query = JSON.parse(stored.rows[0].embedding) as number[];
  const sources = await retrieveKnowledge(pool!, query, 5);
  const documentIds = sources.map((source) => source.documentId);

  assert.equal(sources[0].documentId, 'about');
  assert.equal(new Set(documentIds).size, documentIds.length);
});
