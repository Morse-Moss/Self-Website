import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  authorizeInternalRag,
  parseInternalRagRequest,
  searchInternalKnowledge,
} from '../lib/server/internal-rag-search.ts';
import { loadEmbeddingConfig } from '../lib/server/config.ts';

test('internal RAG authorization is disabled without a token and compares exact bearer values', () => {
  assert.equal(authorizeInternalRag('Bearer secret-token', ''), false);
  assert.equal(authorizeInternalRag(null, 'secret-token'), false);
  assert.equal(authorizeInternalRag('Basic secret-token', 'secret-token'), false);
  assert.equal(authorizeInternalRag('Bearer wrong-token', 'secret-token'), false);
  assert.equal(authorizeInternalRag('Bearer secret-token', 'secret-token'), true);
});

test('internal RAG request parsing keeps one strict bounded contract', () => {
  assert.deepEqual(parseInternalRagRequest({ query: '  Python RAG  ' }), {
    ok: true,
    value: { query: 'Python RAG', topK: 6 },
  });
  assert.deepEqual(parseInternalRagRequest({ query: 'Python RAG', top_k: 15 }), {
    ok: true,
    value: { query: 'Python RAG', topK: 15 },
  });
  for (const body of [
    null,
    [],
    {},
    { query: '' },
    { query: 'x', top_k: 0 },
    { query: 'x', top_k: 1.5 },
    { query: 'x', top_k: 16 },
    { query: 'x', top_k: '6' },
  ]) {
    assert.equal(parseInternalRagRequest(body).ok, false);
  }
});

test('internal RAG search maps only the public retrieval contract', async () => {
  let embedded = '';
  let requestedTopK = 0;
  const results = await searchInternalKnowledge(
    { query: 'Python RAG', topK: 3 },
    {
      async embed(query) {
        embedded = query;
        return [1, 0];
      },
      async retrieve(embedding, topK) {
        assert.deepEqual(embedding, [1, 0]);
        requestedTopK = topK;
        return [{
          chunkId: 'chunk-1',
          documentId: 'project-1',
          title: 'Project One',
          sourcePath: 'content/site-content.json#project-1',
          href: '/works/project-1',
          content: 'Public knowledge fragment',
          score: 0.91,
        }];
      },
    },
  );

  assert.equal(embedded, 'Python RAG');
  assert.equal(requestedTopK, 3);
  assert.deepEqual(results, [{
    text: 'Public knowledge fragment',
    source: 'Project One',
    score: 0.91,
  }]);
});

test('internal RAG route remains a thin no-store adapter over shared embedding and retrieval', () => {
  const source = readFileSync('app/api/internal/rag/search/route.ts', 'utf8');
  assert.match(source, /createEmbeddingProvider/u);
  assert.match(source, /searchInternalKnowledge/u);
  assert.match(source, /Cache-Control.*no-store/su);
  assert.doesNotMatch(source, /fetch\(|\/embeddings|timingSafeEqual/u);
});

test('internal RAG embedding config does not require chat or database configuration', () => {
  assert.deepEqual(loadEmbeddingConfig({
    OPENAI_EMBEDDING_API_KEY: 'embedding-key',
    OPENAI_EMBEDDING_BASE_URL: 'http://127.0.0.1:18091/v1',
    OPENAI_EMBEDDING_MODEL: 'BAAI/bge-small-zh-v1.5',
  }), {
    embeddingApiKey: 'embedding-key',
    embeddingBaseUrl: 'http://127.0.0.1:18091/v1',
    embeddingModel: 'BAAI/bge-small-zh-v1.5',
    embeddingDimensions: 1536,
    embeddingTimeoutMs: 8_000,
  });
});

test('internal RAG route rejects unauthorized and invalid requests without caching', async () => {
  const previousToken = process.env.MORSE_INTERNAL_RAG_TOKEN;
  process.env.MORSE_INTERNAL_RAG_TOKEN = 'route-contract-token';
  try {
    const { POST } = await import('../app/api/internal/rag/search/route.ts');
    const unauthorized = await POST(new Request('http://localhost/api/internal/rag/search', {
      method: 'POST',
    }));
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get('cache-control'), 'no-store');

    const invalid = await POST(new Request('http://localhost/api/internal/rag/search', {
      method: 'POST',
      headers: {
        authorization: 'Bearer route-contract-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: 'RAG', top_k: 1.5 }),
    }));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await invalid.json(), { error: 'top_k_invalid' });
  } finally {
    if (previousToken === undefined) delete process.env.MORSE_INTERNAL_RAG_TOKEN;
    else process.env.MORSE_INTERNAL_RAG_TOKEN = previousToken;
  }
});
