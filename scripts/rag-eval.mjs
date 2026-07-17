import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import OpenAI from 'openai';
import pg from 'pg';

import { EMBEDDING_DIMENSIONS } from '../lib/server/embedding.ts';
import { LOCAL_EVIDENCE_MIN_SCORE, retrieveKnowledge } from '../lib/server/rag.ts';

const { Client } = pg;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const connectionString = process.env.DATABASE_URL;
const embeddingApiKey = process.env.OPENAI_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
const embeddingBaseUrl = process.env.OPENAI_EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL;
const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL;

if (!connectionString) throw new Error('DATABASE_URL is required.');
if (!embeddingApiKey || !embeddingModel) {
  throw new Error(
    'OPENAI_EMBEDDING_API_KEY (or OPENAI_API_KEY) and OPENAI_EMBEDDING_MODEL are required.',
  );
}

const cases = JSON.parse(
  await fs.readFile(path.join(repoRoot, 'content', 'rag-eval.json'), 'utf8'),
);
const negativeCases = JSON.parse(
  await fs.readFile(path.join(repoRoot, 'content', 'rag-negative-eval.json'), 'utf8'),
);
const embeddingClient = new OpenAI({
  apiKey: embeddingApiKey,
  baseURL: embeddingBaseUrl || undefined,
  maxRetries: 0,
});
const db = new Client({ connectionString });
const results = [];
const negativeResults = [];

try {
  await db.connect();
  for (const goldCase of cases) {
    const response = await embeddingClient.embeddings.create({
      model: embeddingModel,
      input: goldCase.query,
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: 'float',
    });
    const retrieved = await retrieveKnowledge(db, response.data[0].embedding, 3);
    const ids = retrieved.map((row) => row.documentId);

    results.push({
      query: goldCase.query,
      expectedDocumentId: goldCase.expectedDocumentId,
      top1: ids[0] === goldCase.expectedDocumentId,
      top3: ids.includes(goldCase.expectedDocumentId),
      retrieved: retrieved.map((row) => ({
        documentId: row.documentId,
        title: row.title,
        score: Number(row.score),
      })),
    });
  }
  for (const negativeCase of negativeCases) {
    const response = await embeddingClient.embeddings.create({
      model: embeddingModel,
      input: negativeCase.query,
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: 'float',
    });
    const retrieved = await retrieveKnowledge(db, response.data[0].embedding, 3);
    negativeResults.push({
      query: negativeCase.query,
      topScore: Number(retrieved[0]?.score ?? Number.NEGATIVE_INFINITY),
      retrieved: retrieved.map((row) => ({
        documentId: row.documentId,
        title: row.title,
        score: Number(row.score),
      })),
    });
  }
} finally {
  await db.end();
}

const top1Hits = results.filter((item) => item.top1).length;
const top3Hits = results.filter((item) => item.top3).length;
const minPositiveTopScore = Math.min(...results.map((item) => item.retrieved[0]?.score ?? Infinity));
const maxNegativeTopScore = Math.max(...negativeResults.map((item) => item.topScore));
const positiveThresholdPass = minPositiveTopScore >= LOCAL_EVIDENCE_MIN_SCORE;
const negativeThresholdPass = maxNegativeTopScore < LOCAL_EVIDENCE_MIN_SCORE;
let evidence = 'configured semantic embeddings + pgvector';
if (embeddingBaseUrl) {
  const embeddingUrl = new URL(embeddingBaseUrl);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (loopbackHosts.has(embeddingUrl.hostname)) {
    evidence = 'loopback semantic embeddings + pgvector';
  }
}
console.log(JSON.stringify({
  evidence,
  model: embeddingModel,
  summary: {
    cases: results.length,
    top1Hits,
    top1Rate: top1Hits / results.length,
    top3Hits,
    top3Rate: top3Hits / results.length,
    localEvidenceMinScore: LOCAL_EVIDENCE_MIN_SCORE,
    minPositiveTopScore,
    maxNegativeTopScore,
    positiveThresholdPass,
    negativeThresholdPass,
  },
  results,
  negativeResults,
}, null, 2));

if (top3Hits !== results.length || !positiveThresholdPass || !negativeThresholdPass) {
  process.exitCode = 1;
}
