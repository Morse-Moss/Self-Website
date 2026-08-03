import { timingSafeEqual } from 'node:crypto';

import type { KnowledgeSource } from './rag.ts';

const MAX_QUERY_CHARACTERS = 4_000;
const DEFAULT_TOP_K = 6;
const MAX_TOP_K = 15;

export interface InternalRagSearchRequest {
  query: string;
  topK: number;
}

export type ParsedInternalRagRequest =
  | { ok: true; value: InternalRagSearchRequest }
  | { ok: false; error: 'invalid_body' | 'query_required' | 'query_too_long' | 'top_k_invalid' };

export function authorizeInternalRag(
  authorization: string | null,
  expectedToken: string,
): boolean {
  if (!expectedToken || !authorization?.startsWith('Bearer ')) return false;
  const providedToken = authorization.slice('Bearer '.length).trim();
  if (!providedToken) return false;
  const expected = Buffer.from(expectedToken, 'utf8');
  const provided = Buffer.from(providedToken, 'utf8');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function parseInternalRagRequest(body: unknown): ParsedInternalRagRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body' };
  }
  const input = body as { query?: unknown; top_k?: unknown };
  if (typeof input.query !== 'string' || !input.query.trim()) {
    return { ok: false, error: 'query_required' };
  }
  const query = input.query.trim();
  if (query.length > MAX_QUERY_CHARACTERS) {
    return { ok: false, error: 'query_too_long' };
  }
  if (input.top_k !== undefined && (
    !Number.isSafeInteger(input.top_k)
    || (input.top_k as number) < 1
    || (input.top_k as number) > MAX_TOP_K
  )) {
    return { ok: false, error: 'top_k_invalid' };
  }
  return {
    ok: true,
    value: {
      query,
      topK: input.top_k === undefined ? DEFAULT_TOP_K : input.top_k as number,
    },
  };
}

export async function searchInternalKnowledge(
  request: InternalRagSearchRequest,
  dependencies: {
    embed(query: string): Promise<number[]>;
    retrieve(embedding: number[], topK: number): Promise<KnowledgeSource[]>;
  },
) {
  const embedding = await dependencies.embed(request.query);
  const sources = await dependencies.retrieve(embedding, request.topK);
  return sources.map((source) => ({
    text: source.content,
    source: source.title || source.sourcePath,
    score: source.score,
  }));
}
