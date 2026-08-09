import type { Pool, PoolClient } from 'pg';

import {
  recordDependencyFailure,
  recordDependencySuccess,
} from './chat-dependency-monitor.ts';
import {
  claimSearch,
  finalizeSearchCompleted,
  finalizeSearchFailed,
} from './interaction-search.ts';
import type { SearchProvider, SearchResponse } from './search-provider.ts';
import { routeSearch } from './search-router.ts';
import { parseStoredSearchResults } from './search-safety.ts';

export interface ChatSearchConfig {
  searchEnabled?: boolean;
  maxSearchesPerSession?: number;
}

export interface ChatSearchTurn {
  turnId: string;
  searchCount: number;
  searchAlreadyClaimed: boolean;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
  }
}

function storedSearchResponse(input: {
  status: string;
  results: unknown;
  errorCode: string | null;
}): SearchResponse {
  if (input.status === 'completed') {
    return {
      status: 'completed',
      results: parseStoredSearchResults(input.results),
      errorCode: null,
    };
  }
  return {
    status: 'failed',
    results: [],
    errorCode: input.errorCode === 'SEARCH_TIMEOUT' ? 'SEARCH_TIMEOUT' : 'SEARCH_FAILED',
  };
}

export async function resolveSearch(input: {
  pool: Pool;
  client: PoolClient;
  provider?: SearchProvider | null;
  accessSessionId: string;
  turn: ChatSearchTurn;
  routingQuestion: string;
  searchQuery: string;
  localEvidenceSufficient: boolean;
  config: ChatSearchConfig;
  now: Date;
  signal?: AbortSignal;
}): Promise<SearchResponse | undefined> {
  const maxSearches = input.config.maxSearchesPerSession ?? 5;
  let query = input.searchQuery;
  let routeReason = 'existing_claim';

  if (!input.turn.searchAlreadyClaimed) {
    const route = routeSearch({
      question: input.routingQuestion,
      searchEnabled: input.config.searchEnabled === true && input.provider !== null
        && input.provider !== undefined,
      searchCount: input.turn.searchCount,
      localEvidenceSufficient: input.localEvidenceSufficient,
    });
    if (!route.shouldSearch || !route.query || !input.provider) {
      if (route.reason !== 'disabled' && route.reason !== 'quota_exhausted') return undefined;
      const availableRoute = routeSearch({
        question: input.routingQuestion,
        searchEnabled: true,
        searchCount: 0,
        localEvidenceSufficient: input.localEvidenceSufficient,
      });
      return availableRoute.shouldSearch
        ? { status: 'failed', results: [], errorCode: 'SEARCH_FAILED' }
        : undefined;
    }
    query = input.searchQuery;
    routeReason = route.reason;
  }

  let claim;
  try {
    claim = await claimSearch({
      pool: input.pool,
      client: input.client,
      accessSessionId: input.accessSessionId,
      turnId: input.turn.turnId,
      query,
      routeReason,
      maxSearches,
      now: input.now,
    });
  } catch {
    console.error(JSON.stringify({
      event: 'morse_search_claim_failed',
      code: 'SEARCH_CLAIM_FAILED',
    }));
    return { status: 'failed', results: [], errorCode: 'SEARCH_FAILED' };
  }

  if (claim.kind === 'quota_exhausted') {
    return { status: 'failed', results: [], errorCode: 'SEARCH_FAILED' };
  }
  if (claim.kind === 'existing') return storedSearchResponse(claim.search);
  if (!input.provider) {
    return { status: 'failed', results: [], errorCode: 'SEARCH_FAILED' };
  }

  let response: SearchResponse;
  try {
    response = await input.provider.search(claim.search.query, input.signal);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    response = { status: 'failed', results: [], errorCode: 'SEARCH_FAILED' };
  }
  throwIfAborted(input.signal);

  if (response.status === 'completed') {
    await recordDependencySuccess({
      client: input.client,
      dependency: 'search',
      now: input.now,
    });
  } else {
    await recordDependencyFailure({
      client: input.client,
      dependency: 'search',
      errorCode: response.errorCode,
      now: input.now,
    });
  }

  try {
    if (response.status === 'completed') {
      await finalizeSearchCompleted({
        pool: input.pool,
        client: input.client,
        turnId: input.turn.turnId,
        results: response.results,
      });
    } else {
      await finalizeSearchFailed({
        pool: input.pool,
        client: input.client,
        turnId: input.turn.turnId,
        results: [],
        errorCode: response.errorCode,
      });
    }
    return response;
  } catch {
    console.error(JSON.stringify({
      event: 'morse_search_persistence_failed',
      code: 'SEARCH_PERSISTENCE_FAILED',
    }));
    return { status: 'failed', results: [], errorCode: 'SEARCH_FAILED' };
  }
}
