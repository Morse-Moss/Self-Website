import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { getPool } from '@/lib/server/db';
import {
  createDeterministicTestEmbedding,
  EMBEDDING_DIMENSIONS,
} from '@/lib/server/embedding';
import { retrieveKnowledge } from '@/lib/server/rag';

export const runtime = 'nodejs';

// Internal retrieval endpoint for trusted local tools (e.g. auto-job-agent).
// Contract: POST { query, top_k? } -> { results: [{ text, source, score }] }.
// Scope: audited public knowledge only (knowledge_chunks). The private resume
// and content/drafts/ are never ingested, so they can never appear here.
// Disabled unless MORSE_INTERNAL_RAG_TOKEN is set; callers must present it as
// a Bearer token. No conversation workflow, no visitor session, no quota use.

const MAX_QUERY_CHARACTERS = 4_000;
const DEFAULT_TOP_K = 6;
const MAX_TOP_K = 15;

function isAuthorized(request: Request): boolean {
  const expected = process.env.MORSE_INTERNAL_RAG_TOKEN ?? '';
  if (expected.length === 0) return false;
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : '';
  if (provided.length === 0) return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

async function embedQuery(query: string): Promise<number[]> {
  if (process.env.MORSE_ALLOW_TEST_EMBEDDINGS === 'true') {
    return createDeterministicTestEmbedding(query);
  }

  const baseUrl = (process.env.OPENAI_EMBEDDING_BASE_URL ?? '').replace(/\/+$/, '');
  const model = process.env.OPENAI_EMBEDDING_MODEL ?? '';
  if (baseUrl.length === 0 || model.length === 0) {
    throw new Error('EMBEDDING_NOT_CONFIGURED');
  }

  const timeoutMs = Number.parseInt(process.env.MORSE_EMBEDDING_TIMEOUT_MS ?? '8000', 10);
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_EMBEDDING_API_KEY ?? ''}`,
    },
    body: JSON.stringify({ model, input: query }),
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 8000),
  });
  if (!response.ok) {
    throw new Error(`EMBEDDING_HTTP_${response.status}`);
  }

  const payload = await response.json() as { data?: Array<{ embedding?: unknown }> };
  const embedding = payload.data?.[0]?.embedding;
  if (
    !Array.isArray(embedding)
    || embedding.length !== EMBEDDING_DIMENSIONS
    || !embedding.every((value): value is number => (
      typeof value === 'number' && Number.isFinite(value)
    ))
  ) {
    throw new Error('EMBEDDING_INVALID_RESPONSE');
  }
  return embedding;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const query = typeof (body as { query?: unknown })?.query === 'string'
    ? ((body as { query: string }).query).trim().slice(0, MAX_QUERY_CHARACTERS)
    : '';
  if (query.length === 0) {
    return NextResponse.json({ error: 'query_required' }, { status: 400 });
  }

  const rawTopK = (body as { top_k?: unknown })?.top_k;
  const topK = typeof rawTopK === 'number' && Number.isFinite(rawTopK)
    ? Math.min(Math.max(Math.trunc(rawTopK), 1), MAX_TOP_K)
    : DEFAULT_TOP_K;

  const connectionString = process.env.DATABASE_URL_RUNTIME
    || process.env.DATABASE_URL
    || '';
  if (connectionString.length === 0) {
    return NextResponse.json({ error: 'database_not_configured' }, { status: 503 });
  }

  try {
    const embedding = await embedQuery(query);
    const sources = await retrieveKnowledge(getPool(connectionString), embedding, topK);
    return NextResponse.json({
      results: sources.map((source) => ({
        text: source.content,
        source: source.title || source.sourcePath,
        score: source.score,
      })),
    });
  } catch (error) {
    console.error('INTERNAL_RAG_SEARCH_FAILED', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'retrieval_failed' }, { status: 502 });
  }
}
