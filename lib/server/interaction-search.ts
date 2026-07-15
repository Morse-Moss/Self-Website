import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

export type InteractionSearchStatus = 'pending' | 'completed' | 'failed';

export interface InteractionSearch {
  id: string;
  turnId: string;
  query: string;
  routeReason: string;
  status: InteractionSearchStatus;
  results: unknown;
  errorCode: string | null;
  createdAt: Date;
  deleteAfter: Date;
}

export type SearchClaimResult =
  | { kind: 'claimed' | 'existing'; search: InteractionSearch }
  | { kind: 'quota_exhausted'; search: null };

interface SearchRow {
  id: string;
  interaction_turn_id: string;
  query: string;
  route_reason: string;
  status: InteractionSearchStatus;
  results: unknown;
  error_code: string | null;
  created_at: Date;
  delete_after: Date;
}

const searchColumns = `id::text, interaction_turn_id::text, query, route_reason,
  status, results, error_code, created_at, delete_after`;

function toInteractionSearch(row: SearchRow): InteractionSearch {
  return {
    id: row.id,
    turnId: row.interaction_turn_id,
    query: row.query,
    routeReason: row.route_reason,
    status: row.status,
    results: row.results,
    errorCode: row.error_code,
    createdAt: row.created_at,
    deleteAfter: row.delete_after,
  };
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query('ROLLBACK').catch(() => undefined);
}

async function loadSearchByTurn(
  database: Pool | PoolClient,
  turnId: string,
): Promise<InteractionSearch | null> {
  const result = await database.query<SearchRow>(
    `SELECT ${searchColumns}
       FROM interaction_searches
      WHERE interaction_turn_id = $1`,
    [turnId],
  );
  return result.rows[0] ? toInteractionSearch(result.rows[0]) : null;
}

export async function claimSearch(input: {
  pool: Pool;
  client?: PoolClient;
  accessSessionId: string;
  turnId: string;
  query: string;
  routeReason: string;
  maxSearches?: number;
  now?: Date;
}): Promise<SearchClaimResult> {
  const ownsClient = input.client === undefined;
  const client = input.client ?? await input.pool.connect();
  const now = input.now ?? new Date();
  const maxSearches = input.maxSearches ?? 5;
  let candidate: SearchClaimResult | null = null;
  let insertedSearchId: string | null = null;
  let commitAttempted = false;
  let released = false;
  const release = (destroy = false) => {
    if (!ownsClient || released) return;
    released = true;
    client.release(destroy);
  };
  try {
    await client.query('BEGIN');
    const session = await client.query<{ search_count: number }>(
      `SELECT search_count
         FROM access_sessions
        WHERE id = $1
        FOR UPDATE`,
      [input.accessSessionId],
    );
    if (!session.rows[0]) throw new Error('Search session is invalid.');

    const turn = await client.query<{
      access_session_id: string;
      delete_after: Date;
      status: string;
    }>(
      `SELECT access_session_id::text, status, delete_after
         FROM interaction_turns
        WHERE id = $1
        FOR UPDATE`,
      [input.turnId],
    );
    if (
      turn.rows[0]?.access_session_id !== input.accessSessionId
      || turn.rows[0]?.status !== 'running'
    ) {
      throw new Error('Search turn is invalid.');
    }

    const existing = await client.query<SearchRow>(
      `SELECT ${searchColumns}
         FROM interaction_searches
        WHERE interaction_turn_id = $1
        FOR UPDATE`,
      [input.turnId],
    );
    if (existing.rows[0]) {
      candidate = { kind: 'existing', search: toInteractionSearch(existing.rows[0]) };
      commitAttempted = true;
      await client.query('COMMIT');
      return candidate;
    }

    if (session.rows[0].search_count >= maxSearches) {
      candidate = { kind: 'quota_exhausted', search: null };
      commitAttempted = true;
      await client.query('COMMIT');
      return candidate;
    }

    insertedSearchId = randomUUID();
    const inserted = await client.query<SearchRow>(
      `INSERT INTO interaction_searches
        (id, interaction_turn_id, query, route_reason, status, results,
         created_at, delete_after)
       VALUES ($1, $2, $3, $4, 'pending', '[]'::jsonb, $5, $6)
       RETURNING ${searchColumns}`,
      [insertedSearchId, input.turnId, input.query, input.routeReason, now, turn.rows[0].delete_after],
    );
    await client.query(
      'UPDATE access_sessions SET search_count = search_count + 1 WHERE id = $1',
      [input.accessSessionId],
    );
    await client.query(
      'UPDATE interaction_turns SET used_search = true WHERE id = $1',
      [input.turnId],
    );
    candidate = { kind: 'claimed', search: toInteractionSearch(inserted.rows[0]) };
    commitAttempted = true;
    await client.query('COMMIT');
    return candidate;
  } catch (error) {
    if (commitAttempted && candidate) {
      if (!ownsClient) {
        await client.query('ROLLBACK');
        if (candidate.kind === 'quota_exhausted') return candidate;
        const durable = await loadSearchByTurn(client, input.turnId).catch(() => null);
        if (durable) {
          return {
            kind: durable.id === insertedSearchId ? 'claimed' : 'existing',
            search: durable,
          };
        }
        throw error;
      }
      release(true);
      if (candidate.kind === 'quota_exhausted') return candidate;
      const durable = await loadSearchByTurn(input.pool, input.turnId).catch(() => null);
      if (durable) {
        return {
          kind: durable.id === insertedSearchId ? 'claimed' : 'existing',
          search: durable,
        };
      }
      throw error;
    }
    await rollback(client);
    throw error;
  } finally {
    release();
  }
}

async function finalizeSearch(input: {
  pool: Pool;
  client?: PoolClient;
  turnId: string;
  status: Exclude<InteractionSearchStatus, 'pending'>;
  results: unknown;
  errorCode: string | null;
}): Promise<InteractionSearch> {
  const database = input.client ?? input.pool;
  const updated = await database.query<SearchRow>(
    `UPDATE interaction_searches
        SET status = $2,
            results = $3::jsonb,
            error_code = $4
      WHERE interaction_turn_id = $1
        AND status = 'pending'
      RETURNING ${searchColumns}`,
    [input.turnId, input.status, JSON.stringify(input.results), input.errorCode],
  );
  if (updated.rows[0]) return toInteractionSearch(updated.rows[0]);

  const durable = await loadSearchByTurn(database, input.turnId);
  if (!durable) throw new Error('Search claim does not exist.');
  return durable;
}

export async function finalizeSearchCompleted(input: {
  pool: Pool;
  client?: PoolClient;
  turnId: string;
  results: unknown;
}): Promise<InteractionSearch> {
  return finalizeSearch({
    ...input,
    status: 'completed',
    errorCode: null,
  });
}

export async function finalizeSearchFailed(input: {
  pool: Pool;
  client?: PoolClient;
  turnId: string;
  results: unknown;
  errorCode: string;
}): Promise<InteractionSearch> {
  return finalizeSearch({
    ...input,
    status: 'failed',
  });
}
