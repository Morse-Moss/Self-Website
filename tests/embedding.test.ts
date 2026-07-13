import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createDeterministicTestEmbedding,
  serializeVector,
} from '../lib/server/embedding.ts';

test('deterministic test embeddings are stable, normalized, and 1536-dimensional', () => {
  const first = createDeterministicTestEmbedding('数字摩斯');
  const repeated = createDeterministicTestEmbedding('数字摩斯');
  const changed = createDeterministicTestEmbedding('深度研究');

  assert.equal(first.length, 1536);
  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, changed);

  const magnitude = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));
  assert.ok(Math.abs(magnitude - 1) < 1e-9);
});

test('serializeVector emits a pgvector literal and rejects non-finite values', () => {
  assert.equal(serializeVector([0.5, -0.25, 0]), '[0.5,-0.25,0]');
  assert.throws(() => serializeVector([Number.NaN]), /finite/);
});
