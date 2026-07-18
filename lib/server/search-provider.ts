import type { ChatSource } from '../contracts/chat.ts';

export const MAX_SEARCH_RESULTS = 5;

export type SearchSourceKind = 'official' | 'github' | 'web';
export type SearchErrorCode = 'SEARCH_TIMEOUT' | 'SEARCH_FAILED';

export interface SearchResult {
  id: string;
  title: string;
  href: string;
  kind: SearchSourceKind;
  domain: string;
  score: null;
  snippet: string;
}

export type SearchResponse =
  | { status: 'completed'; results: SearchResult[]; errorCode: null }
  | { status: 'failed'; results: []; errorCode: SearchErrorCode };

export interface SearchProvider {
  search(query: string, signal?: AbortSignal): Promise<SearchResponse>;
}

export function toPublicSearchSource(result: SearchResult): ChatSource {
  return {
    id: result.id,
    title: result.title,
    href: result.href,
    kind: result.kind,
    domain: result.domain,
    score: null,
  };
}
