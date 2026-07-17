import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const packagePath = path.resolve('package.json');
const invitePath = path.resolve('scripts/create-invite.mjs');
const cleanupPath = path.resolve('scripts/cleanup-expired.mjs');

test('invite creation reads plaintext only from a temporary environment variable and stores a hash', () => {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const source = fs.readFileSync(invitePath, 'utf8');

  assert.equal(pkg.scripts['invite:create'], 'node scripts/create-invite.mjs');
  assert.match(source, /MORSE_NEW_INVITE_CODE/);
  assert.match(source, /hashSecret/);
  assert.doesNotMatch(source, /console\.log\([^\n]*MORSE_NEW_INVITE_CODE/);
  assert.doesNotMatch(source, /console\.log\([^\n]*inviteCode/);
});

test('cleanup applies the complete retention policy with one injected clock', () => {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const source = fs.readFileSync(cleanupPath, 'utf8');

  assert.equal(pkg.scripts['session:cleanup'], 'node scripts/cleanup-expired.mjs');
  assert.match(source, /MORSE_CLEANUP_NOW/);
  assert.match(source, /await client\.query\('BEGIN'\)/);
  assert.match(source, /await client\.query\('COMMIT'\)/);
  assert.match(source, /await client\.query\('ROLLBACK'\)/);

  const orderedStatements = [
    'DELETE FROM interaction_searches',
    'DELETE FROM diagnoses',
    'DELETE FROM interaction_turns',
    'DELETE FROM access_sessions',
    'UPDATE invite_codes SET active = false',
    'DELETE FROM admin_sessions',
    'DELETE FROM alert_outbox',
    'DELETE FROM access_attempts',
  ];
  let previousIndex = -1;
  for (const statement of orderedStatements) {
    const index = source.indexOf(statement);
    assert.ok(index > previousIndex, `${statement} must appear in retention order`);
    previousIndex = index;
  }

  const injectedTimePredicates = source.match(
    /(?:expires_at|delete_after)\s*<=\s*\$1::timestamptz/gi,
  ) ?? [];
  assert.equal(injectedTimePredicates.length, orderedStatements.length);
  assert.doesNotMatch(source, /(?:expires_at|delete_after)\s*<=\s*now\(\)/i);
  assert.doesNotMatch(
    source,
    /DELETE\s+FROM\s+(?:invite_codes|knowledge_documents|knowledge_chunks|schema_migrations)/i,
  );

  for (const count of [
    'deletedSessions',
    'deactivatedInvites',
    'deletedInteractionSearches',
    'deletedDiagnoses',
    'deletedInteractionTurns',
    'deletedAdminSessions',
    'deletedAlertOutbox',
    'deletedAccessAttempts',
  ]) {
    assert.match(source, new RegExp(`\\b${count}\\b`));
  }
});
