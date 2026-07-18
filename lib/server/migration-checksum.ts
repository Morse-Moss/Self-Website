import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export function canonicalizeMigrationText(source: string | Uint8Array): string {
  const decoded = typeof source === 'string' ? source : utf8Decoder.decode(source);
  const withoutBom = decoded.charCodeAt(0) === 0xFEFF ? decoded.slice(1) : decoded;
  return withoutBom.replace(/\r\n?/gu, '\n');
}

export function migrationChecksum(source: string | Uint8Array): string {
  return createHash('sha256')
    .update(canonicalizeMigrationText(source), 'utf8')
    .digest('hex');
}
