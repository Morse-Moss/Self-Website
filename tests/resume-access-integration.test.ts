import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';

import pg from 'pg';

import {
  ResumeAccessError,
  authenticateResumeSession,
  disableResumeInvite,
  redeemResumeInviteProtected,
  revokeResumeSession,
  type ResumeRedeemPolicy,
  type ResumeRequestContext,
} from '../lib/server/resume-access.ts';
import { hashSecret } from '../lib/server/security.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const policy: ResumeRedeemPolicy = {
  sessionHours: 72,
  attemptWindowSeconds: 600,
  maxFailedAttempts: 3,
  lockSeconds: 900,
  auditRetentionDays: 30,
};

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

async function databaseClock(): Promise<Date> {
  const result = await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  return result.rows[0].now;
}

function context(label: string = randomUUID()): ResumeRequestContext {
  return {
    ip: '192.0.2.45',
    userAgent: 'Synthetic Resume Browser/1.0',
    deviceInfo: { class: 'synthetic-test', label },
    fingerprintHash: hashSecret(`resume-fingerprint:${label}`),
  };
}

async function createInvite(input: {
  code: string;
  createdAt?: Date;
  expiresAt?: Date;
  redeemedAt?: Date | null;
  disabledAt?: Date | null;
  note?: string;
}): Promise<{ adminSessionId: string; inviteId: string }> {
  const now = await databaseClock();
  const inviteId = randomUUID();
  const adminSessionId = randomUUID();
  const createdAt = input.createdAt ?? now;
  const expiresAt = input.expiresAt ?? new Date(createdAt.getTime() + 7 * DAY_MS);
  await pool.query(
    `INSERT INTO resume_invites
      (id, code_hash, trusted_person_note, created_at, expires_at, redeemed_at,
       disabled_at, created_by_admin_session)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      inviteId,
      hashSecret(input.code),
      input.note ?? 'Synthetic Trusted Person',
      createdAt,
      expiresAt,
      input.redeemedAt ?? null,
      input.disabledAt ?? null,
      adminSessionId,
    ],
  );
  return { adminSessionId, inviteId };
}

function unavailable(error: unknown): boolean {
  return error instanceof ResumeAccessError
    && error.code === 'RESUME_INVITE_UNAVAILABLE'
    && error.message === 'RESUME_INVITE_UNAVAILABLE';
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

test('valid one-time redemption stores only hashes and creates a 72-hour session', async () => {
  const code = `resume-valid-${randomUUID()}`;
  const { inviteId } = await createInvite({ code });
  const checkedBefore = await databaseClock();

  const redeemed = await redeemResumeInviteProtected(pool, code, context(), policy);
  const checkedAfter = await databaseClock();

  assert.ok(redeemed.token.length >= 40);
  assert.ok(redeemed.expiresAt.getTime() >= checkedBefore.getTime() + 72 * HOUR_MS);
  assert.ok(redeemed.expiresAt.getTime() <= checkedAfter.getTime() + 72 * HOUR_MS);
  const stored = await pool.query<{
    code_hash: string;
    redeemed_at: Date;
    token_hash: string;
  }>(
    `SELECT invite.code_hash, invite.redeemed_at, session.token_hash
       FROM resume_invites AS invite
       JOIN resume_sessions AS session ON session.invite_id = invite.id
      WHERE invite.id = $1`,
    [inviteId],
  );
  assert.equal(stored.rows[0].code_hash, hashSecret(code));
  assert.equal(stored.rows[0].token_hash, hashSecret(redeemed.token));
  assert.notEqual(stored.rows[0].token_hash, redeemed.token);
  assert.ok(stored.rows[0].redeemed_at);
  assert.equal((await authenticateResumeSession(pool, redeemed.token))?.inviteId, inviteId);
});

test('an invite is unavailable at its seven-day expiry boundary', async () => {
  const code = `resume-expired-${randomUUID()}`;
  const expiresAt = await databaseClock();
  await createInvite({
    code,
    createdAt: new Date(expiresAt.getTime() - 7 * DAY_MS),
    expiresAt,
  });

  await assert.rejects(
    () => redeemResumeInviteProtected(pool, code, context(), policy),
    unavailable,
  );
});

test('a redemption that waits on the invite row lock rechecks the clock after expiry', async () => {
  const code = `resume-lock-expiry-${randomUUID()}`;
  const startsAt = await databaseClock();
  const expiresAt = new Date(startsAt.getTime() + 1_200);
  const { inviteId } = await createInvite({ code, createdAt: startsAt, expiresAt });
  const blocker = await pool.connect();
  const ready = await pool.connect();
  ready.release();
  await blocker.query('BEGIN');
  try {
    await blocker.query('SELECT id FROM resume_invites WHERE id = $1 FOR UPDATE', [inviteId]);
    const blockerPid = await blocker.query<{ pid: number }>(
      'SELECT pg_backend_pid()::integer AS pid',
    );
    const redemption = redeemResumeInviteProtected(pool, code, context(), policy);
    void redemption.catch(() => undefined);
    let observedWait = false;
    let activitySnapshot: Array<Record<string, unknown>> = [];
    const waitDeadline = Date.now() + 3_000;
    while (Date.now() < waitDeadline) {
      const waiters = await blocker.query<Record<string, unknown>>(
        `SELECT activity.pid,
                activity.state,
                activity.wait_event_type,
                activity.wait_event,
                pg_blocking_pids(activity.pid) AS blocking_pids,
                left(activity.query, 120) AS query
           FROM pg_stat_activity AS activity
          WHERE activity.datname = current_database()
            AND activity.pid <> pg_backend_pid()`,
      );
      activitySnapshot = waiters.rows;
      if (waiters.rows.some((row) => (
        Array.isArray(row.blocking_pids)
        && row.blocking_pids.includes(blockerPid.rows[0].pid)
      ))) {
        observedWait = true;
        break;
      }
      await delay(20);
    }
    assert.equal(
      observedWait,
      true,
      `the test must observe the invite-row lock wait: ${JSON.stringify({
        activitySnapshot,
        idleCount: pool.idleCount,
        totalCount: pool.totalCount,
        waitingCount: pool.waitingCount,
      })}`,
    );
    const remaining = expiresAt.getTime() - Date.now();
    if (remaining >= 0) await delay(remaining + 100);
    await blocker.query('COMMIT');
    await assert.rejects(redemption, unavailable);
  } finally {
    await blocker.query('ROLLBACK').catch(() => undefined);
    blocker.release();
  }
});

test('already-redeemed and disabled invitations share the same public failure', async () => {
  const now = await databaseClock();
  const createdAt = new Date(now.getTime() - 1_000);
  const redeemedCode = `resume-already-${randomUUID()}`;
  const disabledCode = `resume-disabled-${randomUUID()}`;
  await createInvite({ code: redeemedCode, createdAt, redeemedAt: now });
  await createInvite({ code: disabledCode, createdAt, disabledAt: now });

  for (const code of [redeemedCode, disabledCode]) {
    await assert.rejects(
      () => redeemResumeInviteProtected(pool, code, context(), policy),
      unavailable,
    );
  }
});

test('concurrent double redemption creates exactly one session', async () => {
  const code = `resume-concurrent-${randomUUID()}`;
  const { inviteId } = await createInvite({ code });
  const outcomes = await Promise.allSettled([
    redeemResumeInviteProtected(pool, code, context('concurrent-a'), policy),
    redeemResumeInviteProtected(pool, code, context('concurrent-b'), policy),
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((outcome) => (
    outcome.status === 'rejected' && unavailable(outcome.reason)
  )).length, 1);
  const sessions = await pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM resume_sessions WHERE invite_id = $1',
    [inviteId],
  );
  assert.equal(sessions.rows[0].count, 1);
});

test('authentication expires at 72 hours and logout revokes the next request', async () => {
  const code = `resume-logout-${randomUUID()}`;
  await createInvite({ code });
  const requestContext = context();
  const redeemed = await redeemResumeInviteProtected(pool, code, requestContext, policy);

  assert.ok(await authenticateResumeSession(
    pool,
    redeemed.token,
    new Date(redeemed.expiresAt.getTime() - 1),
  ));
  assert.equal(
    await authenticateResumeSession(pool, redeemed.token, redeemed.expiresAt),
    null,
  );
  await revokeResumeSession(pool, redeemed.token, requestContext);
  assert.equal(await authenticateResumeSession(pool, redeemed.token), null);
  const logoutEvents = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count
       FROM resume_access_events
      WHERE event_type = 'session_logged_out'
        AND session_id = $1`,
    [redeemed.sessionId],
  );
  assert.equal(logoutEvents.rows[0].count, 1);
});

test('admin disabling an invite immediately revokes its authenticated session', async () => {
  const code = `resume-admin-revoke-${randomUUID()}`;
  const { adminSessionId, inviteId } = await createInvite({ code });
  const redeemed = await redeemResumeInviteProtected(pool, code, context(), policy);
  assert.ok(await authenticateResumeSession(pool, redeemed.token));

  assert.equal(await disableResumeInvite(pool, inviteId, adminSessionId), true);
  assert.equal(await authenticateResumeSession(pool, redeemed.token), null);
  const state = await pool.query<{ disabled_at: Date; revoked_at: Date }>(
    `SELECT invite.disabled_at, session.revoked_at
       FROM resume_invites AS invite
       JOIN resume_sessions AS session ON session.invite_id = invite.id
      WHERE invite.id = $1`,
    [inviteId],
  );
  assert.ok(state.rows[0].disabled_at);
  assert.ok(state.rows[0].revoked_at);
});

test('resume abuse tracking uses only the resume invitation scope and never stores notes', async () => {
  const requestContext = context('abuse-scope');
  for (let attempt = 0; attempt < policy.maxFailedAttempts; attempt += 1) {
    await assert.rejects(
      () => redeemResumeInviteProtected(
        pool,
        `unknown-resume-code-${randomUUID()}`,
        requestContext,
        policy,
      ),
      unavailable,
    );
  }

  const attempts = await pool.query<{ scope: string }>(
    `SELECT scope
       FROM access_attempts
      WHERE fingerprint_hash = $1
      ORDER BY attempted_at, id`,
    [requestContext.fingerprintHash],
  );
  assert.deepEqual(attempts.rows.map((row) => row.scope), [
    'resume_invite_redeem',
    'resume_invite_redeem',
    'resume_invite_redeem',
    'resume_invite_redeem_lock',
  ]);
  const events = await pool.query<{ serialized: string }>(
    `SELECT row_to_json(event_record)::text AS serialized
       FROM resume_access_events AS event_record
      WHERE source_ip = $1`,
    [requestContext.ip],
  );
  assert.ok((events.rowCount ?? 0) >= policy.maxFailedAttempts);
  assert.doesNotMatch(
    events.rows.map((row) => row.serialized).join('\n'),
    /Synthetic Trusted Person|trusted_person_note/iu,
  );
});
