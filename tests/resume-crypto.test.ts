import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import {
  ResumeCryptoError,
  decryptResumePdf,
  encryptResumePdf,
} from '../lib/server/resume-crypto.ts';
import { syntheticResumePdf } from './fixtures/synthetic-resume.ts';

const HEADER_BYTES = 13;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function assertCryptoError(run: () => unknown, code: string): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ResumeCryptoError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

test('resume envelope round-trips a synthetic PDF with fixed metadata', () => {
  const pdf = syntheticResumePdf();
  const key = randomBytes(32);
  const envelope = encryptResumePdf(pdf, key, 7);

  assert.equal(envelope.subarray(0, 8).toString('ascii'), 'MORSEPDF');
  assert.equal(envelope.readUInt8(8), 1);
  assert.equal(envelope.readUInt32BE(9), 7);
  assert.equal(envelope.length, HEADER_BYTES + NONCE_BYTES + TAG_BYTES + pdf.length);
  assert.deepEqual(decryptResumePdf(envelope, key, 7), pdf);
});

test('resume envelope rejects wrong keys and every authenticated-region mutation', () => {
  const key = randomBytes(32);
  const envelope = encryptResumePdf(syntheticResumePdf(), key, 2);
  assertCryptoError(() => decryptResumePdf(envelope, randomBytes(32), 2), 'RESUME_INTEGRITY_FAILED');

  for (const offset of [HEADER_BYTES, HEADER_BYTES + NONCE_BYTES, envelope.length - 1]) {
    const modified = Buffer.from(envelope);
    modified[offset] ^= 0xff;
    assertCryptoError(() => decryptResumePdf(modified, key, 2), 'RESUME_INTEGRITY_FAILED');
  }
});

test('resume envelope rejects invalid framing and unsupported versions', () => {
  const key = randomBytes(32);
  const envelope = encryptResumePdf(syntheticResumePdf(), key, 3);

  assertCryptoError(
    () => decryptResumePdf(envelope.subarray(0, HEADER_BYTES + NONCE_BYTES + TAG_BYTES), key, 3),
    'RESUME_ENVELOPE_INVALID',
  );
  const badMagic = Buffer.from(envelope);
  badMagic[0] ^= 0xff;
  assertCryptoError(() => decryptResumePdf(badMagic, key, 3), 'RESUME_ENVELOPE_INVALID');

  const badVersion = Buffer.from(envelope);
  badVersion.writeUInt8(2, 8);
  assertCryptoError(() => decryptResumePdf(badVersion, key, 3), 'RESUME_ENVELOPE_UNSUPPORTED');
  assertCryptoError(() => decryptResumePdf(envelope, key, 4), 'RESUME_ENVELOPE_UNSUPPORTED');
});

test('resume envelope validates key and key-version inputs without echoing them', () => {
  const pdf = syntheticResumePdf();
  assertCryptoError(() => encryptResumePdf(pdf, randomBytes(31), 1), 'RESUME_KEY_INVALID');
  assertCryptoError(() => encryptResumePdf(pdf, randomBytes(32), 0), 'RESUME_KEY_VERSION_INVALID');
  assertCryptoError(() => decryptResumePdf(Buffer.alloc(64), randomBytes(31), 1), 'RESUME_KEY_INVALID');
});
