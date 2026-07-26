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

export async function retrieveKnowledge(
  pool: Pool | PoolClient,
  queryEmbedding: number[],
  requestedLimit = 5,
): Promise<KnowledgeSource[]> {
  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
    throw new RangeError(`Query embedding must have ${EMBEDDING_DIMENSIONS} dimensions.`);
  }

  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 10);
  // Two-stage retrieval: the inner ANN scan orders by distance alone with a
  // bounded LIMIT so PostgreSQL can serve it from the HNSW index; per-document
  // dedup (DISTINCT ON) and final top-N ranking run over that candidate set.
  // The inner LIMIT is pinned to 40 to match pgvector's default
  // hnsw.ef_search: an index scan returns at most ef_search candidates, so a
  // larger LIMIT would silently truncate. Raise both together if recall needs
  // a deeper pool once the corpus grows.
  const result = await pool.query<KnowledgeRow>(
    `SELECT ranked.chunk_id,
            ranked.document_id,
            ranked.title,
            ranked.source_path,
            ranked.href,
            ranked.content,
            ranked.project_slug,
            ranked.topic_ids,
            1 - ranked.distance AS score
       FROM (
         SELECT DISTINCT ON (candidate.document_id)
                candidate.chunk_id,
                candidate.document_id,
                candidate.title,
                candidate.source_path,
                candidate.href,
                candidate.content,
                candidate.project_slug,
                candidate.topic_ids,
                candidate.distance
           FROM (
             SELECT chunk.id AS chunk_id,
                    chunk.document_id,
                    chunk.metadata->>'title' AS title,
                    chunk.metadata->>'sourcePath' AS source_path,
                    chunk.metadata->>'href' AS href,
                    chunk.content,
                    chunk.metadata->>'projectSlug' AS project_slug,
                    chunk.metadata->'topicIds' AS topic_ids,
                    chunk.embedding <=> $1::vector AS distance
               FROM knowledge_chunks AS chunk
              ORDER BY chunk.embedding <=> $1::vector
              LIMIT 40
           ) AS candidate
          ORDER BY candidate.document_id, candidate.distance, candidate.chunk_id
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
    projectSlug: row.project_slug,
    topicIds: Array.isArray(row.topic_ids)
      ? row.topic_ids.filter((value): value is string => typeof value === 'string')
      : [],
  }));
}
