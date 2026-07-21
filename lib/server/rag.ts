import type { Pool, PoolClient } from 'pg';

import { EMBEDDING_DIMENSIONS, serializeVector } from './embedding.ts';
import { publicKnowledgeHref } from './public-knowledge.ts';

export interface KnowledgeSource {
  chunkId: string;
  documentId: string;
  title: string;
  sourcePath: string;
  href: string;
  content: string;
  score: number;
}

// Calibrated against the 20-case BGE retrieval set (minimum positive top score 0.482)
// and ten unrelated queries (maximum negative top score 0.421).
export const LOCAL_EVIDENCE_MIN_SCORE = 0.45;

export function filterRelevantKnowledge(
  sources: KnowledgeSource[],
  minimumScore = LOCAL_EVIDENCE_MIN_SCORE,
): KnowledgeSource[] {
  return sources.filter((source) => (
    Number.isFinite(source.score) && source.score >= minimumScore
  ));
}

export function hasSufficientLocalEvidence(sources: KnowledgeSource[]): boolean {
  const topScore = Math.max(
    ...sources.map((source) => Number.isFinite(source.score) ? source.score : Number.NEGATIVE_INFINITY),
  );
  return topScore >= LOCAL_EVIDENCE_MIN_SCORE;
}

interface KnowledgeRow {
  chunk_id: string;
  document_id: string;
  title: string;
  source_path: string;
  href: string | null;
  content: string;
  score: number;
}

export async function retrieveKnowledge(
  pool: Pool | PoolClient,
  queryEmbedding: number[],
  requestedLimit = 5,
): Promise<KnowledgeSource[]> {
  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
    throw new RangeError(`Query embedding must have ${EMBEDDING_DIMENSIONS} dimensions.`);
  }

  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 10);
  const result = await pool.query<KnowledgeRow>(
    `SELECT ranked.chunk_id,
            ranked.document_id,
            ranked.title,
            ranked.source_path,
            ranked.href,
            ranked.content,
            1 - ranked.distance AS score
       FROM (
         SELECT DISTINCT ON (chunk.document_id)
                chunk.id AS chunk_id,
                chunk.document_id,
                chunk.metadata->>'title' AS title,
                chunk.metadata->>'sourcePath' AS source_path,
                chunk.metadata->>'href' AS href,
                chunk.content,
                chunk.embedding <=> $1::vector AS distance
           FROM knowledge_chunks AS chunk
          ORDER BY chunk.document_id, chunk.embedding <=> $1::vector, chunk.id
       ) AS ranked
      ORDER BY ranked.distance, ranked.chunk_id
      LIMIT $2`,
    [serializeVector(queryEmbedding), limit],
  );

  return result.rows.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    title: row.title,
    sourcePath: row.source_path,
    href: row.href || publicKnowledgeHref(row.document_id),
    content: row.content,
    score: Number(row.score),
  }));
}
