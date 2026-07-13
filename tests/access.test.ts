import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hashSecret, isInviteUsable } from '../lib/server/security.ts';

test('hashSecret produces a stable SHA-256 digest without retaining plaintext', () => {
  const digest = hashSecret('short-lived-code');

  assert.equal(digest, '8c9e0cf34064327b7b6da24183eebbb47af15e810b0015c78ad360d0bb8fec55');
  assert.doesNotMatch(digest, /short-lived-code/);
});

test('invite is usable only while active, unexpired, and below its session cap', () => {
  const now = new Date('2026-07-12T10:00:00.000Z');
  const base = {
    active: true,
    expiresAt: new Date('2026-07-12T11:00:00.000Z'),
    sessionCount: 1,
    maxSessions: 2,
  };

  assert.equal(isInviteUsable(base, now), true);
  assert.equal(isInviteUsable({ ...base, active: false }, now), false);
  assert.equal(isInviteUsable({ ...base, expiresAt: now }, now), false);
  assert.equal(isInviteUsable({ ...base, sessionCount: 2 }, now), false);
});
