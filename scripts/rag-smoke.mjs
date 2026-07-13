import process from 'node:process';

import pg from 'pg';

import { createDeterministicTestEmbedding, serializeVector } from '../lib/server/embedding.ts';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');

const question = '深度研究系统如何保证证据可追溯?';
const queryVector = serializeVector(createDeterministicTestEmbedding(question));
const client = new Client({ connectionString });

try {
  await client.connect();
  const result = await client.query(
    `SELECT document_id, metadata->>'title' AS title,
            1 - (embedding <=> $1::vector) AS score
       FROM knowledge_chunks
      ORDER BY embedding <=> $1::vector
      LIMIT 3`,
    [queryVector],
  );
  console.log(JSON.stringify({ evidence: 'local pgvector + deterministic test embedding', rows: result.rows }));
} finally {
  await client.end();
}
