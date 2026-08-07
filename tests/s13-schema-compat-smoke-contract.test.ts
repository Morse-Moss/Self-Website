import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const smokePath = path.resolve('scripts/s13-schema-compat-smoke.mjs');

test('schema compatibility smoke is exact-image, isolated, mock-only and cleanup-bounded', () => {
  assert.equal(fs.existsSync(smokePath), true, 'missing schema compatibility smoke script');
  const source = fs.readFileSync(smokePath, 'utf8');

  for (const option of [
    '--schema',
    '--feature',
    '--protocol',
    '--web-image',
    '--worker-image',
  ]) assert.match(source, new RegExp(option, 'u'));
  for (const value of ['012', '013', '014', 'off', 'on', 'responses', 'chat_completions']) {
    assert.match(source, new RegExp(`['\"]${value}['\"]`, 'u'));
  }
  assert.match(source, /crypto\.randomUUID|randomUUID/u);
  assert.match(source, /docker[\s\S]*network[\s\S]*create/iu);
  assert.match(source, /pgvector\/pgvector:pg16/u);
  assert.match(source, /mock-openai|mock Provider|externalCalls/iu);
  assert.match(source, /\/api\/health\/live/u);
  assert.match(source, /\/api\/health\/ready/u);
  assert.match(source, /schema[\s\S]*012[\s\S]*feature[\s\S]*on[\s\S]*503/iu);
  assert.match(source, /Buffer\.alloc\(32,\s*\d+\)\.toString\(['"]base64['"]\)/u);
  assert.match(source, /process\.platform\s*!==\s*['"]win32['"][\s\S]*fs\.chown\(target,\s*999,\s*999\)/u);
  assert.doesNotMatch(source, /MORSE_CONTEXT_PACKET_DIGEST_KEY=s13-context-digest-key/u);
  assert.match(source, /finally/u);
  assert.match(source, /S13_[A-Z0-9_-]+/u);
  assert.doesNotMatch(source, /docker\s+(?:system\s+prune|volume\s+prune|network\s+prune)/iu);
});
