import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import {
  decryptAiConfigSecret,
  encryptAiConfigSecret,
} from '../lib/server/ai-config-crypto.ts';
import { AiConfigError } from '../lib/server/ai-config.ts';

const key = Buffer.alloc(32, 11);
const aad = {
  connectionVersionId: randomUUID(),
  seriesId: randomUUID(),
  keyVersion: 2,
};

function expectUnavailable(run: () => unknown): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof AiConfigError);
    assert.equal(error.code, 'AI_CONFIG_SECRET_UNAVAILABLE');
    assert.equal(error.message, 'AI_CONFIG_SECRET_UNAVAILABLE');
    assert.doesNotMatch(String(error), /super-secret|bad decrypt|authenticate/u);
    return true;
  });
}

test('provider secret round-trips with random AES-256-GCM envelopes', () => {
  const first = encryptAiConfigSecret('super-secret', key, aad);
  const second = encryptAiConfigSecret('super-secret', key, aad);

  assert.equal(first.iv.length, 12);
  assert.equal(first.tag.length, 16);
  assert.notDeepEqual(first.iv, second.iv);
  assert.notDeepEqual(first.ciphertext, second.ciphertext);
  assert.equal(decryptAiConfigSecret(first, key, aad), 'super-secret');
  assert.equal(decryptAiConfigSecret(second, key, aad), 'super-secret');
});

test('provider secret envelope is bound to ciphertext, IV, tag, AAD, key, and key version', () => {
  const envelope = encryptAiConfigSecret('super-secret', key, aad);
  const corrupt = (value: Buffer) => {
    const copy = Buffer.from(value);
    copy[0] ^= 0xff;
    return copy;
  };

  for (const candidate of [
    { envelope: { ...envelope, ciphertext: corrupt(envelope.ciphertext) }, key, aad },
    { envelope: { ...envelope, iv: corrupt(envelope.iv) }, key, aad },
    { envelope: { ...envelope, tag: corrupt(envelope.tag) }, key, aad },
    { envelope, key: Buffer.alloc(32, 12), aad },
    { envelope, key, aad: { ...aad, connectionVersionId: randomUUID() } },
    { envelope, key, aad: { ...aad, seriesId: randomUUID() } },
    { envelope, key, aad: { ...aad, keyVersion: 3 } },
  ]) {
    expectUnavailable(() => decryptAiConfigSecret(
      candidate.envelope,
      candidate.key,
      candidate.aad,
    ));
  }
});

test('crypto-shredded or structurally invalid envelopes cannot be decrypted', () => {
  expectUnavailable(() => decryptAiConfigSecret({
    ciphertext: null,
    iv: null,
    tag: null,
  }, key, aad));
  expectUnavailable(() => encryptAiConfigSecret('', key, aad));
  expectUnavailable(() => encryptAiConfigSecret('super-secret', Buffer.alloc(31), aad));
});
