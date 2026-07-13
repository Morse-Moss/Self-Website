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

test('cleanup removes expired sessions and deactivates expired invite codes', () => {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const source = fs.readFileSync(cleanupPath, 'utf8');

  assert.equal(pkg.scripts['session:cleanup'], 'node scripts/cleanup-expired.mjs');
  assert.match(source, /DELETE FROM access_sessions WHERE expires_at <= now\(\)/);
  assert.match(source, /UPDATE invite_codes SET active = false WHERE expires_at <= now\(\)/);
});
