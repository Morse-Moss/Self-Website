import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

import { AiConfigError } from './ai-config.ts';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD_VERSION = 1;

export interface AiConfigSecretAad {
  connectionVersionId: string;
  seriesId: string;
  keyVersion: number;
}

export interface AiConfigSecretEnvelope {
  ciphertext: Buffer | null;
  iv: Buffer | null;
  tag: Buffer | null;
}

function unavailable(): never {
  throw new AiConfigError('AI_CONFIG_SECRET_UNAVAILABLE');
}

function aadBytes(input: AiConfigSecretAad): Buffer {
  if (
    !input.connectionVersionId
    || !input.seriesId
    || !Number.isSafeInteger(input.keyVersion)
    || input.keyVersion < 1
  ) {
    unavailable();
  }
  return Buffer.from(JSON.stringify({
    connectionVersionId: input.connectionVersionId,
    keyVersion: input.keyVersion,
    seriesId: input.seriesId,
    version: AAD_VERSION,
  }), 'utf8');
}

function validateKey(key: Buffer): void {
  if (key.length !== 32) unavailable();
}

export function encryptAiConfigSecret(
  plaintext: string,
  key: Buffer,
  aad: AiConfigSecretAad,
): AiConfigSecretEnvelope {
  try {
    validateKey(key);
    if (!plaintext) unavailable();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aadBytes(aad));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return { ciphertext, iv, tag: cipher.getAuthTag() };
  } catch {
    unavailable();
  }
}

export function decryptAiConfigSecret(
  envelope: AiConfigSecretEnvelope,
  key: Buffer,
  aad: AiConfigSecretAad,
): string {
  try {
    validateKey(key);
    if (
      !envelope.ciphertext?.length
      || envelope.iv?.length !== IV_BYTES
      || envelope.tag?.length !== TAG_BYTES
    ) {
      unavailable();
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      envelope.iv,
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(aadBytes(aad));
    decipher.setAuthTag(envelope.tag);
    return Buffer.concat([
      decipher.update(envelope.ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    unavailable();
  }
}
