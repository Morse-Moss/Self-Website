import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';

import pg from 'pg';

import {
  AccessError,
  hashInviteSourceFingerprint,
  redeemInviteProtected,
  trustedInviteSource,
} from '../lib/server/access.ts';
import { hashSecret } from '../lib/server/security.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const now = new Date('2035-03-08T12:00:00.000Z');
const fingerprintSecret = 'test-only-fingerprint-secret-at-least-32-characters';
const policy = {
  sessionHours: 12,
  fingerprintSecret,
  attemptWindowSeconds: 600,
  maxFailedAttempts: 5,
  lockSeconds: 900,
} as const;

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

async function createInvite(code: string, maxSessions = 20): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES ($1, $2, 'abuse-test', true, $3, $4, 0)`,
    [id, hashSecret(code), new Date(now.getTime() + 72 * 60 * 60 * 1000), maxSessions],
  );
  return id;
}

function expectUnavailable(error: unknown): boolean {
  return error instanceof AccessError && error.code === 'INVITE_UNAVAILABLE';
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

test('source fingerprints are secret-keyed, deterministic, and fixed-width', () => {
  const source = '203.0.113.42\u0000Browser/1.0';
  const first = hashInviteSourceFingerprint(fingerprintSecret, source);
  const repeated = hashInviteSourceFingerprint(fingerprintSecret, source);
  const otherSecret = hashInviteSourceFingerprint(`${fingerprintSecret}-other`, source);

  assert.match(first, /^[a-f0-9]{64}$/u);
  assert.equal(first, repeated);
  assert.notEqual(first, otherSecret);
  assert.equal(first.includes('203.0.113.42'), false);
});

test('trusted proxy hops ignore user-agent rotation and untrusted left-side forwarding values', () => {
  assert.equal(trustedInviteSource('spoofed-a, 203.0.113.42', 1), '203.0.113.42');
  assert.equal(trustedInviteSource('spoofed-b, 203.0.113.42', 1), '203.0.113.42');
  assert.equal(trustedInviteSource('198.51.100.1, 203.0.113.42, 10.0.0.8', 2), '203.0.113.42');
  assert.equal(trustedInviteSource('203.0.113.42', 0), 'unattributed');
  assert.equal(trustedInviteSource('attacker-controlled', 1), 'unattributed');
  assert.equal(trustedInviteSource('', 1), 'unattributed');
});

test('five failed redemptions lock one source, enqueue one minimal alert, and later recover', async () => {
  const code = `invite-${randomUUID()}`;
  await createInvite(code);
  const source = '203.0.113.42\u0000Browser/1.0';
  const fingerprintHash = hashInviteSourceFingerprint(fingerprintSecret, source);

  for (let index = 0; index < policy.maxFailedAttempts; index += 1) {
    await assert.rejects(
      () => redeemInviteProtected(pool, 'wrong-code', { ...policy, source, now }),
      expectUnavailable,
    );
  }
  await assert.rejects(
    () => redeemInviteProtected(pool, code, { ...policy, source, now }),
    expectUnavailable,
  );

  const attempts = await pool.query<{
    scope: string;
    fingerprint_hash: string;
    succeeded: boolean;
    expires_at: Date;
  }>(
    `SELECT scope, fingerprint_hash, succeeded, expires_at
       FROM access_attempts
      WHERE fingerprint_hash = $1
      ORDER BY id`,
    [fingerprintHash],
  );
  assert.equal(attempts.rows.filter((row) => row.scope === 'invite_redeem').length, 5);
  assert.equal(attempts.rows.filter((row) => row.scope === 'invite_redeem_lock').length, 1);
  assert.ok(attempts.rows.every((row) => row.fingerprint_hash === fingerprintHash));
  assert.ok(attempts.rows.every((row) => row.succeeded === false));

  const lockedUntil = new Date(now.getTime() + policy.lockSeconds * 1_000);
  const window = Math.floor(now.getTime() / (policy.attemptWindowSeconds * 1_000));
  const alert = await pool.query<{
    dedupe_key: string;
    category: string;
    payload: Record<string, unknown>;
  }>(
    `SELECT dedupe_key, category, payload
       FROM alert_outbox
      WHERE category = 'invite_abuse'`,
  );
  assert.deepEqual(alert.rows, [{
    dedupe_key: `security:invite_abuse:${fingerprintHash}:${window}`,
    category: 'invite_abuse',
    payload: {
      lockedUntil: lockedUntil.toISOString(),
      occurredAt: now.toISOString(),
    },
  }]);
  const serialized = JSON.stringify({ attempts: attempts.rows, alert: alert.rows });
  assert.equal(serialized.includes(code), false);
  assert.equal(serialized.includes('203.0.113.42'), false);
  assert.equal(serialized.includes('Browser/1.0'), false);

  const recovered = await redeemInviteProtected(pool, code, {
    ...policy,
    source,
    now: new Date(lockedUntil.getTime() + 1),
  });
  assert.ok(recovered.token.length >= 40);
});

test('concurrent failures produce one lock marker and one alert while another source remains usable', async () => {
  const code = `invite-${randomUUID()}`;
  await createInvite(code);
  const blockedSource = '198.51.100.9\u0000Browser/2.0';
  const otherSource = '198.51.100.10\u0000Browser/2.0';
  const blockedHash = hashInviteSourceFingerprint(fingerprintSecret, blockedSource);

  const results = await Promise.allSettled(Array.from({ length: 8 }, () => (
    redeemInviteProtected(pool, 'invalid', { ...policy, source: blockedSource, now })
  )));
  assert.ok(results.every((result) => result.status === 'rejected' && expectUnavailable(result.reason)));

  const counts = await pool.query<{ attempts: number; locks: number; alerts: number }>(
    `SELECT
       count(*) FILTER (WHERE scope = 'invite_redeem')::integer AS attempts,
       count(*) FILTER (WHERE scope = 'invite_redeem_lock')::integer AS locks,
       (SELECT count(*)::integer
          FROM alert_outbox
         WHERE category = 'invite_abuse' AND dedupe_key LIKE $2) AS alerts
       FROM access_attempts
      WHERE fingerprint_hash = $1`,
    [blockedHash, `security:invite_abuse:${blockedHash}:%`],
  );
  assert.deepEqual(counts.rows[0], { attempts: 5, locks: 1, alerts: 1 });

  const allowed = await redeemInviteProtected(pool, code, {
    ...policy,
    source: otherSource,
    now,
  });
  assert.ok(allowed.token.length >= 40);
});

test('an Outbox failure rolls back the threshold attempt and lock marker together', async () => {
  const code = `invite-${randomUUID()}`;
  await createInvite(code);
  const source = '192.0.2.18\u0000Browser/3.0';
  const fingerprintHash = hashInviteSourceFingerprint(fingerprintSecret, source);

  for (let index = 0; index < policy.maxFailedAttempts - 1; index += 1) {
    await assert.rejects(
      () => redeemInviteProtected(pool, 'wrong-code', { ...policy, source, now }),
      expectUnavailable,
    );
  }

  await pool.query(`
    CREATE FUNCTION reject_invite_abuse_alert() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.category = 'invite_abuse' THEN
        RAISE EXCEPTION 'forced invite alert rollback';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER reject_invite_abuse_alert
      BEFORE INSERT ON alert_outbox
      FOR EACH ROW EXECUTE FUNCTION reject_invite_abuse_alert();
  `);
  try {
    await assert.rejects(
      () => redeemInviteProtected(pool, 'wrong-code', { ...policy, source, now }),
      /forced invite alert rollback/,
    );
  } finally {
    await pool.query('DROP TRIGGER reject_invite_abuse_alert ON alert_outbox');
    await pool.query('DROP FUNCTION reject_invite_abuse_alert()');
  }

  const rolledBack = await pool.query<{ attempts: number; locks: number; alerts: number }>(
    `SELECT
       count(*) FILTER (WHERE scope = 'invite_redeem')::integer AS attempts,
       count(*) FILTER (WHERE scope = 'invite_redeem_lock')::integer AS locks,
       (SELECT count(*)::integer
          FROM alert_outbox
         WHERE category = 'invite_abuse' AND dedupe_key LIKE $2) AS alerts
       FROM access_attempts
      WHERE fingerprint_hash = $1`,
    [fingerprintHash, `security:invite_abuse:${fingerprintHash}:%`],
  );
  assert.deepEqual(rolledBack.rows[0], { attempts: 4, locks: 0, alerts: 0 });

  await assert.rejects(
    () => redeemInviteProtected(pool, 'wrong-code', { ...policy, source, now }),
    expectUnavailable,
  );
  const retried = await pool.query<{ attempts: number; locks: number; alerts: number }>(
    `SELECT
       count(*) FILTER (WHERE scope = 'invite_redeem')::integer AS attempts,
       count(*) FILTER (WHERE scope = 'invite_redeem_lock')::integer AS locks,
       (SELECT count(*)::integer
          FROM alert_outbox
         WHERE category = 'invite_abuse' AND dedupe_key LIKE $2) AS alerts
       FROM access_attempts
      WHERE fingerprint_hash = $1`,
    [fingerprintHash, `security:invite_abuse:${fingerprintHash}:%`],
  );
  assert.deepEqual(retried.rows[0], { attempts: 5, locks: 1, alerts: 1 });
});
