import { createHash } from 'node:crypto';

export const EMBEDDING_DIMENSIONS = 1536;

export function createDeterministicTestEmbedding(text: string): number[] {
  const normalized = text.normalize('NFKC').trim().toLowerCase();
  const vector = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const terms = normalized.length > 1
    ? Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2))
    : [normalized || 'empty'];

  for (const term of terms) {
    const digest = createHash('sha256').update(term, 'utf8').digest();
    const index = digest.readUInt16BE(0) % EMBEDDING_DIMENSIONS;
    const direction = digest[2] % 2 === 0 ? 1 : -1;
    vector[index] += direction;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / magnitude);
}

export function serializeVector(vector: number[]): string {
  if (!vector.every(Number.isFinite)) {
    throw new TypeError('Vector values must be finite numbers.');
  }

  return `[${vector.join(',')}]`;
}
