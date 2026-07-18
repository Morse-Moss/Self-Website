import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const sourcePath = path.join(process.cwd(), 'scripts', 'local-embedding-server.py');

test('local embedding server is loopback-only and emits normalized padded BGE vectors', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /BAAI\/bge-small-zh-v1\.5/);
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /MORSE_EMBEDDING_HOST/);
  assert.match(source, /normalize_embeddings\s*=\s*True/);
  assert.match(source, /SOURCE_DIMENSIONS\s*=\s*512/);
  assert.match(source, /TARGET_DIMENSIONS\s*=\s*1536/);
  assert.match(source, /vectors\.shape\[1\]\s*!=\s*SOURCE_DIMENSIONS/);
  assert.match(source, /np\.pad|numpy\.pad/);
  assert.match(source, /\/v1\/embeddings/);
});
