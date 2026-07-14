import { createHash } from 'node:crypto';

export interface ChunkOptions {
  maxChars: number;
  overlapChars: number;
}

export function chunkKnowledge(text: string, options: ChunkOptions): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const { maxChars, overlapChars } = options;

  if (maxChars <= 0 || overlapChars < 0 || overlapChars >= maxChars) {
    throw new RangeError('Chunk sizes must satisfy maxChars > overlapChars >= 0.');
  }

  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);

    if (end < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf('\n\n', end);
      if (paragraphBreak > start + Math.floor(maxChars / 2)) {
        end = paragraphBreak;
      }
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - overlapChars, start + 1);
  }

  return chunks;
}

export function stableChunkId(documentId: string, ordinal: number, content: string): string {
  const digest = createHash('sha256')
    .update(`${documentId}\0${ordinal}\0${content}`, 'utf8')
    .digest('hex')
    .slice(0, 16);

  return `${documentId}:${digest}`;
}

export function knowledgeChecksum(
  document: { title: string; sourcePath: string; href: string; content: string },
  embeddingSignature: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify([
      embeddingSignature,
      document.title,
      document.sourcePath,
      document.href,
      document.content,
    ]), 'utf8')
    .digest('hex');
}
