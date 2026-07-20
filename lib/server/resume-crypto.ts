import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const MAGIC = Buffer.from('MORSEPDF', 'ascii');
const ENVELOPE_VERSION = 1;
const HEADER_BYTES = 13;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type ResumeCryptoErrorCode =
  | 'RESUME_KEY_INVALID'
  | 'RESUME_KEY_VERSION_INVALID'
  | 'RESUME_ENVELOPE_INVALID'
  | 'RESUME_ENVELOPE_UNSUPPORTED'
  | 'RESUME_INTEGRITY_FAILED';

export class ResumeCryptoError extends Error {
  readonly code: ResumeCryptoErrorCode;

  constructor(code: ResumeCryptoErrorCode) {
    super(code);
    this.name = 'ResumeCryptoError';
    this.code = code;
  }
}

function validateKey(key: Buffer): void {
  if (key.length !== 32) throw new ResumeCryptoError('RESUME_KEY_INVALID');
}

function validateKeyVersion(keyVersion: number): void {
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1 || keyVersion > 0xffff_ffff) {
    throw new ResumeCryptoError('RESUME_KEY_VERSION_INVALID');
  }
}

export function encryptResumePdf(
  plaintext: Buffer,
  key: Buffer,
  keyVersion: number,
): Buffer {
  validateKey(key);
  validateKeyVersion(keyVersion);

  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header.writeUInt8(ENVELOPE_VERSION, 8);
  header.writeUInt32BE(keyVersion, 9);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([header, nonce, cipher.getAuthTag(), ciphertext]);
}

export function decryptResumePdf(
  envelope: Buffer,
  key: Buffer,
  expectedKeyVersion: number,
): Buffer {
  validateKey(key);
  validateKeyVersion(expectedKeyVersion);
  const minimum = HEADER_BYTES + NONCE_BYTES + TAG_BYTES + 1;
  if (envelope.length < minimum || !envelope.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new ResumeCryptoError('RESUME_ENVELOPE_INVALID');
  }

  const version = envelope.readUInt8(8);
  const keyVersion = envelope.readUInt32BE(9);
  if (version !== ENVELOPE_VERSION || keyVersion !== expectedKeyVersion) {
    throw new ResumeCryptoError('RESUME_ENVELOPE_UNSUPPORTED');
  }

  try {
    const nonceStart = HEADER_BYTES;
    const tagStart = nonceStart + NONCE_BYTES;
    const bodyStart = tagStart + TAG_BYTES;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      envelope.subarray(nonceStart, tagStart),
    );
    decipher.setAAD(envelope.subarray(0, HEADER_BYTES));
    decipher.setAuthTag(envelope.subarray(tagStart, bodyStart));
    return Buffer.concat([
      decipher.update(envelope.subarray(bodyStart)),
      decipher.final(),
    ]);
  } catch {
    throw new ResumeCryptoError('RESUME_INTEGRITY_FAILED');
  }
}
