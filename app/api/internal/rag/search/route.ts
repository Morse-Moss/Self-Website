import { NextResponse } from 'next/server.js';

import { loadEmbeddingConfig } from '../../../../../lib/server/config.ts';
import { getPool } from '../../../../../lib/server/db.ts';
import { createDeterministicTestEmbedding } from '../../../../../lib/server/embedding.ts';
import {
  authorizeInternalRag,
  parseInternalRagRequest,
  searchInternalKnowledge,
} from '../../../../../lib/server/internal-rag-search.ts';
import { createEmbeddingProvider } from '../../../../../lib/server/provider.ts';
import { retrieveKnowledge } from '../../../../../lib/server/rag.ts';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  if (!authorizeInternalRag(
    request.headers.get('authorization'),
    process.env.MORSE_INTERNAL_RAG_TOKEN?.trim() ?? '',
  )) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const parsed = parseInternalRagRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const connectionString = process.env.DATABASE_URL_RUNTIME?.trim()
    || process.env.DATABASE_URL?.trim()
    || '';
  if (!connectionString) return json({ error: 'database_not_configured' }, 503);

  try {
    const embed = process.env.MORSE_ALLOW_TEST_EMBEDDINGS === 'true'
      ? async (query: string) => createDeterministicTestEmbedding(query)
      : async (query: string) => {
          const provider = createEmbeddingProvider(loadEmbeddingConfig());
          const [embedding] = await provider.embed([query], request.signal);
          return embedding;
        };
    const results = await searchInternalKnowledge(parsed.value, {
      embed,
      retrieve: (embedding, topK) => retrieveKnowledge(
        getPool(connectionString),
        embedding,
        topK,
      ),
    });
    return json({ results });
  } catch {
    console.error(JSON.stringify({ event: 'internal_rag_search_failed' }));
    return json({ error: 'retrieval_failed' }, 502);
  }
}
