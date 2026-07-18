import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalizeMigrationText,
  migrationChecksum,
} from '../lib/server/migration-checksum.ts';

const migrationLf = 'BEGIN;\nCREATE TABLE example (id bigint);\nCOMMIT;\n';

test('migration checksums are stable across LF, CRLF and UTF-8 BOM checkouts', () => {
  const migrationCrLf = migrationLf.replaceAll('\n', '\r\n');
  const migrationWithBom = `\uFEFF${migrationCrLf}`;

  assert.equal(migrationChecksum(migrationLf), migrationChecksum(migrationCrLf));
  assert.equal(migrationChecksum(migrationLf), migrationChecksum(migrationWithBom));
  assert.equal(canonicalizeMigrationText(Buffer.from(migrationWithBom, 'utf8')), migrationLf);
});

test('migration checksums still detect real SQL changes', () => {
  const changedMigration = migrationLf.replace('bigint', 'uuid');

  assert.notEqual(migrationChecksum(migrationLf), migrationChecksum(changedMigration));
});
