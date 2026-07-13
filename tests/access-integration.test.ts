import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import pg from 'pg';

import {
  AccessError,
  authenticateSession,
  redeemInvite,
} from '../lib/server/access.ts';
import { hashSecret } from '../lib/server/security.ts';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
const pool = connectionString ? new Pool({ connectionString }) : null;
const inviteId = randomUUID();
const inviteCode = 'm3-integration-invite';
const now = new Date('2026-07-13T02:00:00.000Z');
let redeemedToken = '';

before(async () => {
  if (!pool) return;
  await pool.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES ($1, $2, $3, true, $4, 1, 0)`,
    [inviteId, hashSecret(inviteCode), 'integration-test', new Date('2026-07-13T06:00:00.000Z')],
  );
});

after(async () => {
  if (!pool) return;
  await pool.query('DELETE FROM invite_codes WHERE id = $1', [inviteId]);
  await pool.end();
});

test('redeemInvite stores only a token hash and authenticates the raw cookie token', {
  skip: !pool,
}, async () => {
  const redeemed = await redeemInvite(pool!, inviteCode, { now, sessionHours: 2 });
  redeemedToken = redeemed.token;

  assert.equal(redeemed.expiresAt.toISOString(), '2026-07-13T04:00:00.000Z');
  assert.ok(redeemed.token.length >= 40);

  const stored = await pool!.query(
    'SELECT token_hash FROM access_sessions WHERE id = $1',
    [redeemed.sessionId],
  );
  assert.equal(stored.rows[0].token_hash, hashSecret(redeemed.token));
  assert.notEqual(stored.rows[0].token_hash, redeemed.token);

  const session = await authenticateSession(pool!, redeemed.token, now);
  assert.equal(session?.id, redeemed.sessionId);
  assert.equal(session?.messageCount, 0);
});

test('redeemInvite rejects a code after its allowed session count is consumed', {
  skip: !pool,
}, async () => {
  await assert.rejects(
    () => redeemInvite(pool!, inviteCode, { now, sessionHours: 2 }),
    (error: unknown) => error instanceof AccessError && error.code === 'INVITE_UNAVAILABLE',
  );
});

test('authenticateSession rejects an expired or unknown token', { skip: !pool }, async () => {
  assert.equal(await authenticateSession(pool!, 'unknown-token', now), null);

  await pool!.query(
    `UPDATE access_sessions
        SET expires_at = $1
      WHERE invite_code_id = $2`,
    [new Date('2026-07-13T01:59:59.000Z'), inviteId],
  );
  assert.equal(await authenticateSession(pool!, redeemedToken, now), null);
});
