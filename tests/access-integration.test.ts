import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';

import pg from 'pg';

import {
  AccessError,
  authenticateSession,
  redeemInvite,
} from '../lib/server/access.ts';
import { hashSecret } from '../lib/server/security.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const now = new Date('2035-03-01T09:00:00.000Z');
const inviteExpiry = new Date('2035-03-04T09:00:00.000Z');
const outboxExpiry = new Date('2035-03-11T09:00:00.000Z');

let database: Awaited<ReturnType<typeof createDisposablePostgresDatabase>>;
let pool: InstanceType<typeof Pool>;

async function runMigrations(connectionString: string): Promise<void> {
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [migrationRunner], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
}

async function createInvite(options: {
  code: string;
  label: string;
  maxSessions?: number;
}): Promise<string> {
  const inviteId = randomUUID();
  await pool.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES ($1, $2, $3, true, $4, $5, 0)`,
    [
      inviteId,
      hashSecret(options.code),
      options.label,
      inviteExpiry,
      options.maxSessions ?? 3,
    ],
  );
  return inviteId;
}

before(async () => {
  database = await createDisposablePostgresDatabase();
  await runMigrations(database.connectionString);
  pool = new Pool({ connectionString: database.connectionString });
});

after(async () => {
  await pool?.end();
  await database?.dispose();
});

test('redeemInvite stores only a token hash and authenticates the raw cookie token', async () => {
  const inviteCode = `access-hash-${randomUUID()}`;
  const inviteId = await createInvite({ code: inviteCode, label: 'hash-storage' });
  const redeemed = await redeemInvite(pool, inviteCode, { now, sessionHours: 2 });

  assert.equal(redeemed.expiresAt.toISOString(), '2035-03-01T11:00:00.000Z');
  assert.ok(redeemed.token.length >= 40);

  const stored = await pool.query<{ token_hash: string }>(
    'SELECT token_hash FROM access_sessions WHERE id = $1',
    [redeemed.sessionId],
  );
  assert.equal(stored.rows[0].token_hash, hashSecret(redeemed.token));
  assert.notEqual(stored.rows[0].token_hash, redeemed.token);

  const session = await authenticateSession(pool, redeemed.token, now);
  assert.equal(session?.id, redeemed.sessionId);
  assert.equal(session?.inviteCodeId, inviteId);
  assert.equal(session?.messageCount, 0);
});

test('redeemInvite rejects a code after its allowed session count is consumed', async () => {
  const inviteCode = `access-limit-${randomUUID()}`;
  await createInvite({ code: inviteCode, label: 'session-limit', maxSessions: 1 });
  await redeemInvite(pool, inviteCode, { now, sessionHours: 2 });

  await assert.rejects(
    () => redeemInvite(pool, inviteCode, { now, sessionHours: 2 }),
    (error: unknown) => error instanceof AccessError && error.code === 'INVITE_UNAVAILABLE',
  );
});

test('authenticateSession rejects an expired or unknown token', async () => {
  const inviteCode = `access-expiry-${randomUUID()}`;
  const inviteId = await createInvite({ code: inviteCode, label: 'session-expiry' });
  const redeemed = await redeemInvite(pool, inviteCode, { now, sessionHours: 2 });

  assert.equal(await authenticateSession(pool, 'unknown-token', now), null);
  await pool.query(
    `UPDATE access_sessions
        SET expires_at = $1
      WHERE invite_code_id = $2`,
    [new Date(now.getTime() - 1), inviteId],
  );
  assert.equal(await authenticateSession(pool, redeemed.token, now), null);
});

test('first invite use enqueues exactly one minimal alert across concurrent and repeated redemptions', async () => {
  const inviteCode = `access-first-use-${randomUUID()}`;
  const inviteId = await createInvite({
    code: inviteCode,
    label: 'first-use-alert',
    maxSessions: 5,
  });

  const concurrentSessions = await Promise.all(Array.from({ length: 4 }, () => (
    redeemInvite(pool, inviteCode, { now, sessionHours: 2 })
  )));
  const repeatedSession = await redeemInvite(pool, inviteCode, { now, sessionHours: 2 });

  const result = await pool.query<{
    dedupe_key: string;
    category: string;
    payload: Record<string, unknown>;
    expires_at: Date;
  }>(
    `SELECT dedupe_key, category, payload, expires_at
       FROM alert_outbox
      WHERE dedupe_key = $1`,
    [`invite-first-use:${inviteId}`],
  );
  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.rows[0], {
    dedupe_key: `invite-first-use:${inviteId}`,
    category: 'invite_first_use',
    payload: {
      inviteId,
      occurredAt: now.toISOString(),
    },
    expires_at: outboxExpiry,
  });
  assert.deepEqual(Object.keys(result.rows[0].payload).sort(), ['inviteId', 'occurredAt']);
  assert.ok(concurrentSessions.every((session) => !JSON.stringify(result.rows[0].payload).includes(session.token)));
  assert.ok(!JSON.stringify(result.rows[0].payload).includes(repeatedSession.token));
  assert.ok(!JSON.stringify(result.rows[0].payload).includes(inviteCode));
});

test('a failed redemption rolls back the session, invite count, and first-use alert together', async () => {
  const inviteCode = `access-rollback-${randomUUID()}`;
  const inviteId = await createInvite({ code: inviteCode, label: 'redemption-rollback' });

  await pool.query(`
    CREATE FUNCTION reject_access_session_commit() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'forced redemption rollback';
    END;
    $$;
    CREATE CONSTRAINT TRIGGER reject_access_session_commit
      AFTER INSERT ON access_sessions
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION reject_access_session_commit();
  `);

  try {
    await assert.rejects(
      () => redeemInvite(pool, inviteCode, { now, sessionHours: 2 }),
      /forced redemption rollback/,
    );
  } finally {
    await pool.query('DROP TRIGGER reject_access_session_commit ON access_sessions');
    await pool.query('DROP FUNCTION reject_access_session_commit()');
  }

  const state = await pool.query<{
    session_count: number;
    sessions: number;
    alerts: number;
  }>(
    `SELECT invite.session_count,
            (SELECT count(*)::integer FROM access_sessions WHERE invite_code_id = invite.id) AS sessions,
            (SELECT count(*)::integer FROM alert_outbox WHERE dedupe_key = $2) AS alerts
       FROM invite_codes AS invite
      WHERE invite.id = $1`,
    [inviteId, `invite-first-use:${inviteId}`],
  );
  assert.deepEqual(state.rows[0], { session_count: 0, sessions: 0, alerts: 0 });
});
