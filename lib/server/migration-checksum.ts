import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function sha256(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function canonicalizeMigrationText(source: string | Uint8Array): string {
  const decoded = typeof source === 'string' ? source : utf8Decoder.decode(source);
  const withoutBom = decoded.charCodeAt(0) === 0xFEFF ? decoded.slice(1) : decoded;
  return withoutBom.replace(/\r\n?/gu, '\n');
}

export function migrationChecksum(source: string | Uint8Array): string {
  return sha256(canonicalizeMigrationText(source));
}

export function legacyMigrationChecksums(source: string | Uint8Array): ReadonlySet<string> {
  const canonical = canonicalizeMigrationText(source);
  const crlf = canonical.replace(/\n/gu, '\r\n');
  return new Set([
    sha256(canonical),
    sha256(crlf),
    sha256(`\uFEFF${canonical}`),
    sha256(`\uFEFF${crlf}`),
  ]);
}
