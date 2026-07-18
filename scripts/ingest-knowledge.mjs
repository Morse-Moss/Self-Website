import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import OpenAI from 'openai';
import pg from 'pg';

import { createDatabaseClientConfig } from '../lib/server/db.ts';

import {
  createDeterministicTestEmbedding,
  EMBEDDING_DIMENSIONS,
  serializeVector,
} from '../lib/server/embedding.ts';
import {
  chunkKnowledge,
  knowledgeChecksum,
  knowledgeChunkOptions,
  stableChunkId,
} from '../lib/server/knowledge.ts';
import { extractPublicKnowledge } from '../lib/server/public-knowledge.ts';

const { Client } = pg;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const connectionString = process.env.DATABASE_URL;
const allowTestEmbeddings = process.env.MORSE_ALLOW_TEST_EMBEDDINGS === 'true';
const embeddingApiKey = process.env.OPENAI_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
const embeddingBaseUrl = process.env.OPENAI_EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL;
const embeddingSignature = allowTestEmbeddings
  ? `deterministic-test:v1:${EMBEDDING_DIMENSIONS}`
  : `openai:${process.env.OPENAI_EMBEDDING_MODEL || 'missing'}:${EMBEDDING_DIMENSIONS}`;

if (!connectionString) throw new Error('DATABASE_URL is required.');
if (allowTestEmbeddings && process.env.NODE_ENV === 'production') {
  throw new Error('Test embeddings are forbidden in production.');
}

async function embed(inputs) {
  if (allowTestEmbeddings) {
    return inputs.map(createDeterministicTestEmbedding);
  }

  const model = process.env.OPENAI_EMBEDDING_MODEL;
  if (!embeddingApiKey || !model) {
    throw new Error(
      'OPENAI_EMBEDDING_API_KEY (or OPENAI_API_KEY) and OPENAI_EMBEDDING_MODEL are required.',
    );
  }

  const client = new OpenAI({
    apiKey: embeddingApiKey,
    baseURL: embeddingBaseUrl || undefined,
    maxRetries: 0,
  });
  const response = await client.embeddings.create({
    model,
    input: inputs,
    dimensions: EMBEDDING_DIMENSIONS,
    encoding_format: 'float',
  });
  return response.data.map((item) => item.embedding);
}

const liveContent = JSON.parse(
  await fs.readFile(path.join(repoRoot, 'content', 'site-content.json'), 'utf8'),
);
const documents = extractPublicKnowledge(liveContent);
const client = new Client(createDatabaseClientConfig(connectionString, {
  env: process.env,
  role: 'ingest',
}));

await client.connect();
let indexedDocuments = 0;
let indexedChunks = 0;
let skippedDocuments = 0;

try {
  await client.query('BEGIN');

  for (const document of documents) {
    const chunkOptions = knowledgeChunkOptions(document.id);
    const checksum = knowledgeChecksum(document, embeddingSignature, chunkOptions);
    const existing = await client.query(
      'SELECT checksum FROM knowledge_documents WHERE id = $1',
      [document.id],
    );

    if (existing.rows[0]?.checksum === checksum) {
      skippedDocuments += 1;
      continue;
    }

    const chunks = chunkKnowledge(document.content, chunkOptions);
    const embeddings = await embed(chunks);

    await client.query(
      `INSERT INTO knowledge_documents (id, title, source_path, checksum, indexed_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         source_path = EXCLUDED.source_path,
         checksum = EXCLUDED.checksum,
         indexed_at = now()`,
      [document.id, document.title, document.sourcePath, checksum],
    );
    await client.query('DELETE FROM knowledge_chunks WHERE document_id = $1', [document.id]);

    for (const [ordinal, chunk] of chunks.entries()) {
      await client.query(
        `INSERT INTO knowledge_chunks
          (id, document_id, ordinal, content, embedding, metadata)
         VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)`,
        [
          stableChunkId(document.id, ordinal, chunk),
          document.id,
          ordinal,
          chunk,
          serializeVector(embeddings[ordinal]),
          JSON.stringify({
            title: document.title,
            sourcePath: document.sourcePath,
            href: document.href,
          }),
        ],
      );
    }

    indexedDocuments += 1;
    indexedChunks += chunks.length;
  }

  const liveIds = documents.map((document) => document.id);
  await client.query('DELETE FROM knowledge_documents WHERE NOT (id = ANY($1::text[]))', [liveIds]);
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}

console.log(JSON.stringify({
  embeddingMode: allowTestEmbeddings ? 'deterministic-test' : 'openai',
  indexedDocuments,
  indexedChunks,
  skippedDocuments,
}));
