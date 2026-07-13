import type { Pool } from 'pg';

import { EMBEDDING_DIMENSIONS, serializeVector } from './embedding.ts';

export interface KnowledgeSource {
  chunkId: string;
  documentId: string;
  title: string;
  sourcePath: string;
  content: string;
  score: number;
}

interface KnowledgeRow {
  chunk_id: string;
  document_id: string;
  title: string;
  source_path: string;
  content: string;
  score: number;
}

export async function retrieveKnowledge(
  pool: Pool,
  queryEmbedding: number[],
  requestedLimit = 5,
): Promise<KnowledgeSource[]> {
  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
    throw new RangeError(`Query embedding must have ${EMBEDDING_DIMENSIONS} dimensions.`);
  }

  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 10);
  const result = await pool.query<KnowledgeRow>(
    `SELECT chunk.id AS chunk_id,
            chunk.document_id,
            chunk.metadata->>'title' AS title,
            chunk.metadata->>'sourcePath' AS source_path,
            chunk.content,
            1 - (chunk.embedding <=> $1::vector) AS score
       FROM knowledge_chunks AS chunk
      ORDER BY chunk.embedding <=> $1::vector
      LIMIT $2`,
    [serializeVector(queryEmbedding), limit],
  );

  return result.rows.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    title: row.title,
    sourcePath: row.source_path,
    content: row.content,
    score: Number(row.score),
  }));
}
