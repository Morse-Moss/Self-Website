export interface CompleteRetrievalCallbacks {
  embedAll(queries: readonly string[]): Promise<readonly number[][]>;
  retrieveAll(embeddings: readonly number[][]): Promise<KnowledgeSource[]>;
}

import type { KnowledgeSource } from '../contracts/chat-runtime.ts';

const DEFAULT_RETRIEVAL_CHUNK_CHARACTERS = 1_024;

function safeBoundary(text: string, offset: number, target: number): number {
  const segment = text.slice(offset, target);
  const matches = [...segment.matchAll(/(?:\r?\n){2,}|[。！？!?；;]|\r?\n/gu)];
  const last = matches.at(-1);
  if (!last || last.index === undefined) return target;
  const candidate = offset + last.index + last[0].length;
  if (candidate <= offset) return target;
  let boundary = candidate;
  while (boundary > offset && boundary < text.length) {
    const code = text.charCodeAt(boundary);
    if (code < 0xdc00 || code > 0xdfff) break;
    boundary -= 1;
  }
  return boundary > offset ? boundary : target;
}

/** Split only for transport/tokenization; every code unit is retained in order. */
export function partitionCompleteRetrievalQuery(
  text: string,
  maxChunkCharacters = DEFAULT_RETRIEVAL_CHUNK_CHARACTERS,
): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  if (!Number.isSafeInteger(maxChunkCharacters) || maxChunkCharacters <= 0) {
    throw new RangeError('maxChunkCharacters must be a positive safe integer.');
  }
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    const target = Math.min(text.length, offset + maxChunkCharacters);
    const boundary = target < text.length ? safeBoundary(text, offset, target) : target;
    chunks.push(text.slice(offset, boundary));
    offset = boundary;
  }
  return chunks;
}
