import type { Pool, PoolClient } from 'pg';

import type {
  ChatRouteDecision,
  KnowledgeSource,
} from '../contracts/chat-runtime.ts';
import { EMBEDDING_DIMENSIONS, serializeVector } from './embedding.ts';
import { publicKnowledgeHref } from './public-knowledge.ts';
import { matchChatProjectSlugs } from './chat-projects.ts';

export type { KnowledgeSource } from '../contracts/chat-runtime.ts';

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

export function admitKnowledgeForRoute(
  route: ChatRouteDecision,
  sources: KnowledgeSource[],
  question?: string,
): KnowledgeSource[] {
  const relevant = filterRelevantKnowledge(sources);
  if (route.routeKind === 'jd') {
    return relevant.filter((source) => Boolean(source.projectSlug));
  }
  if (route.routeKind !== 'grounded') return [];
  if (route.topicKind === 'project') {
    const namedProjects = question ? matchChatProjectSlugs(question) : [];
    const projectSlugs = namedProjects.length > 0
      ? namedProjects
      : route.topicRef
        ? [route.topicRef]
        : [];
    if (projectSlugs.length > 0) {
      return relevant.filter((source) => (
        source.projectSlug !== undefined
        && projectSlugs.includes(source.projectSlug as (typeof projectSlugs)[number])
      ));
    }
  }
  const topicRef = route.topicRef;
  if (route.topicKind === 'capability' && topicRef) {
    return relevant.filter((source) => source.topicIds?.includes(topicRef));
  }
  return relevant.filter((source) => Boolean(source.projectSlug));
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
  project_slug: string | null;
  topic_ids: unknown;
}

function mapKnowledgeRow(row: KnowledgeRow): KnowledgeSource {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    title: row.title,
    sourcePath: row.source_path,
    href: row.href || publicKnowledgeHref(row.document_id),
    content: row.content,
    score: Number(row.score),
    projectSlug: row.project_slug,
    topicIds: Array.isArray(row.topic_ids)
      ? row.topic_ids.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

export async function retrieveFullRelevantKnowledge(
  client: Pool | PoolClient,
  embeddings: readonly number[][],
): Promise<KnowledgeSource[]> {
  if (embeddings.length === 0) return [];
  if (embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS)) {
    throw new RangeError(`Query embeddings must have ${EMBEDDING_DIMENSIONS} dimensions.`);
  }

  const values = embeddings.map((_, index) => `($${index + 1}::vector)`).join(', ');
  const thresholdParameter = `$${embeddings.length + 1}`;
  const result = await client.query<KnowledgeRow>(
    `WITH query_vectors(embedding) AS (VALUES ${values}),
          scored AS (
            SELECT chunk.id AS chunk_id,
                   chunk.document_id,
                   chunk.metadata->>'title' AS title,
                   chunk.metadata->>'sourcePath' AS source_path,
                   chunk.metadata->>'href' AS href,
                   chunk.content,
                   chunk.metadata->>'projectSlug' AS project_slug,
                   chunk.metadata->'topicIds' AS topic_ids,
                   nearest.distance
              FROM knowledge_chunks AS chunk
              CROSS JOIN LATERAL (
                SELECT MIN(chunk.embedding <=> query.embedding) AS distance
                  FROM query_vectors AS query
              ) AS nearest
             WHERE 1 - nearest.distance >= ${thresholdParameter}
          ),
          deduplicated AS (
            SELECT DISTINCT ON (scored.document_id)
                   scored.chunk_id,
                   scored.document_id,
                   scored.title,
                   scored.source_path,
                   scored.href,
                   scored.content,
                   scored.project_slug,
                   scored.topic_ids,
                   1 - scored.distance AS score
              FROM scored
             ORDER BY scored.document_id, scored.distance, scored.chunk_id
          )
     SELECT chunk_id, document_id, title, source_path, href, content,
            project_slug, topic_ids, score
       FROM deduplicated
      ORDER BY score DESC, chunk_id ASC`,
    [...embeddings.map(serializeVector), LOCAL_EVIDENCE_MIN_SCORE],
  );

  return result.rows.map(mapKnowledgeRow);
}

export async function retrieveKnowledge(
  pool: Pool | PoolClient,
  queryEmbedding: number[],
  requestedLimit = 5,
): Promise<KnowledgeSource[]> {
  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
    throw new RangeError(`Query embedding must have ${EMBEDDING_DIMENSIONS} dimensions.`);
  }

  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 15);
  const complete = await retrieveFullRelevantKnowledge(pool, [queryEmbedding]);
  return complete.slice(0, limit);
}
