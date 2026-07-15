import { Semaphore } from './concurrency.ts';
import {
  type SearchProvider,
  type SearchResponse,
} from './search-provider.ts';
import { sanitizeSearchCandidates, type SearchTrustConfig } from './search-safety.ts';

export interface BochaSearchProviderConfig extends SearchTrustConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  concurrency: number;
}

export type SearchFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

class SearchTimeoutError extends Error {
  constructor() {
    super('SEARCH_TIMEOUT');
    this.name = 'SearchTimeoutError';
  }
}

const globalSemaphores = new Map<number, Semaphore>();

function globalSemaphore(capacity: number): Semaphore {
  const existing = globalSemaphores.get(capacity);
  if (existing) return existing;
  const semaphore = new Semaphore(capacity);
  globalSemaphores.set(capacity, semaphore);
  return semaphore;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function createOperationSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(abortReason(parent!));
  let listening = false;
  if (parent?.aborted) {
    forwardAbort();
  } else if (parent) {
    parent.addEventListener('abort', forwardAbort, { once: true });
    listening = true;
  }
  const timer = setTimeout(() => controller.abort(new SearchTimeoutError()), timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      if (listening) parent!.removeEventListener('abort', forwardAbort);
    },
  };
}

function raceWithAbort<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => { cleanup(); resolve(value); },
      (error: unknown) => { cleanup(); reject(error); },
    );
  });
}

const failed = (errorCode: 'SEARCH_TIMEOUT' | 'SEARCH_FAILED'): SearchResponse => ({
  status: 'failed',
  results: [],
  errorCode,
});

export class BochaSearchProvider implements SearchProvider {
  private readonly config: BochaSearchProviderConfig;
  private readonly fetcher: SearchFetch;
  private readonly semaphore: Semaphore;
  private readonly endpoint: string;

  constructor(
    config: BochaSearchProviderConfig,
    fetcher: SearchFetch = fetch,
  ) {
    this.config = config;
    this.fetcher = fetcher;
    this.semaphore = globalSemaphore(config.concurrency);
    this.endpoint = `${config.baseUrl.replace(/\/+$/u, '')}/web-search`;
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResponse> {
    const operation = createOperationSignal(signal, this.config.timeoutMs);
    let release: (() => void) | undefined;
    try {
      release = await this.semaphore.acquire(operation.signal);
      const response = await raceWithAbort(this.fetcher(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: query.trim(), summary: true, count: 5 }),
        signal: operation.signal,
      }), operation.signal);
      if (!response.ok) return failed('SEARCH_FAILED');
      const payload = await raceWithAbort(response.json(), operation.signal) as {
        webPages?: { value?: unknown };
      };
      if (!Array.isArray(payload?.webPages?.value)) return failed('SEARCH_FAILED');
      const candidates = payload.webPages.value;
      return {
        status: 'completed',
        results: sanitizeSearchCandidates(candidates, this.config),
        errorCode: null,
      };
    } catch {
      if (signal?.aborted) throw abortReason(signal);
      if (operation.signal.reason instanceof SearchTimeoutError) {
        return failed('SEARCH_TIMEOUT');
      }
      return failed('SEARCH_FAILED');
    } finally {
      release?.();
      operation.dispose();
    }
  }
}
