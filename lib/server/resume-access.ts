import { randomBytes, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { hashSecret } from './security.ts';

export type ResumeAccessErrorCode = 'RESUME_INVITE_UNAVAILABLE';

export class ResumeAccessError extends Error {
  readonly code: ResumeAccessErrorCode;

  constructor(code: ResumeAccessErrorCode) {
    super(code);
    this.name = 'ResumeAccessError';
    this.code = code;
  }
}

export interface ResumeRequestContext {
  ip: string;
  userAgent: string;
  deviceInfo: Record<string, string>;
  fingerprintHash: string;
}

export interface ResumeRedeemPolicy {
  sessionHours: number;
  attemptWindowSeconds: number;
  maxFailedAttempts: number;
  lockSeconds: number;
  auditRetentionDays: number;
}

export interface RedeemedResumeSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

export interface AuthenticatedResumeSession {
  id: string;
  inviteId: string;
  expiresAt: Date;
}

interface ResumeInviteRow {
  id: string;
  expires_at: Date;
  redeemed_at: Date | null;
  disabled_at: Date | null;
}

interface ResumeSessionRow {
  id: string;
  invite_id: string;
  expires_at: Date;
}

const RESUME_INVITE_ATTEMPT_SCOPE = 'resume_invite_redeem';
const RESUME_INVITE_LOCK_SCOPE = 'resume_invite_redeem_lock';
const DEFAULT_AUDIT_RETENTION_DAYS = 30;

function validInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is invalid.`);
  }
}

function validatePolicy(policy: ResumeRedeemPolicy): void {
  validInteger(policy.sessionHours, 'Resume session duration', 1, 72);
  validInteger(policy.attemptWindowSeconds, 'Resume attempt window', 1, 24 * 60 * 60);
  validInteger(policy.maxFailedAttempts, 'Resume maximum failed attempts', 1, 100);
  validInteger(policy.lockSeconds, 'Resume lock duration', policy.attemptWindowSeconds, 7 * 24 * 60 * 60);
  validInteger(policy.auditRetentionDays, 'Resume audit retention', 1, 3_650);
}

function validateContext(context: ResumeRequestContext): void {
  if (!/^[a-f0-9]{64}$/u.test(context.fingerprintHash)) {
    throw new Error('Resume request fingerprint is invalid.');
  }
  if (!context.userAgent || context.userAgent.length > 1_024) {
    throw new Error('Resume request user agent is invalid.');
  }
}

async function databaseClock(client: PoolClient): Promise<Date> {
  const result = await client.query<{ checked_at: Date }>(
    'SELECT clock_timestamp() AS checked_at',
  );
  const checkedAt = result.rows[0]?.checked_at;
  if (!(checkedAt instanceof Date) || !Number.isFinite(checkedAt.getTime())) {
    throw new Error('Resume database clock is unavailable.');
  }
  return checkedAt;
}

async function lockResumeSource(
  client: PoolClient,
  fingerprintHash: string,
): Promise<void> {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [fingerprintHash],
  );
}

async function isResumeSourceLocked(
  client: PoolClient,
  fingerprintHash: string,
  now: Date,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM access_attempts
      WHERE scope = $1
        AND fingerprint_hash = $2
        AND expires_at > $3
      LIMIT 1`,
    [RESUME_INVITE_LOCK_SCOPE, fingerprintHash, now],
  );
  return result.rowCount === 1;
}

async function insertResumeEvent(
  client: PoolClient,
  input: {
    eventType: 'redeem_succeeded' | 'redeem_failed' | 'session_logged_out' | 'invite_disabled';
    resultCode: string;
    inviteId?: string | null;
    sessionId?: string | null;
    context?: ResumeRequestContext;
    now: Date;
    auditRetentionDays: number;
  },
): Promise<void> {
  const deleteAfter = new Date(input.now.getTime() + input.auditRetentionDays * 24 * 60 * 60 * 1_000);
  await client.query(
    `INSERT INTO resume_access_events
      (event_type, result_code, invite_id, session_id, source_ip, user_agent,
       device_info, created_at, delete_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [
      input.eventType,
      input.resultCode,
      input.inviteId ?? null,
      input.sessionId ?? null,
      input.context?.ip ?? null,
      input.context?.userAgent ?? null,
      JSON.stringify(input.context?.deviceInfo ?? {}),
      input.now,
      deleteAfter,
    ],
  );
}

async function recordResumeAttempt(
  client: PoolClient,
  context: ResumeRequestContext,
  succeeded: boolean,
  now: Date,
  policy: ResumeRedeemPolicy,
): Promise<number> {
  const deleteAfter = new Date(now.getTime() + policy.auditRetentionDays * 24 * 60 * 60 * 1_000);
  await client.query(
    `INSERT INTO access_attempts
      (scope, fingerprint_hash, succeeded, attempted_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [RESUME_INVITE_ATTEMPT_SCOPE, context.fingerprintHash, succeeded, now, deleteAfter],
  );
  if (succeeded) return 0;

  const windowStartedAt = new Date(now.getTime() - policy.attemptWindowSeconds * 1_000);
  const failures = await client.query<{ count: number }>(
    `SELECT count(*)::integer AS count
       FROM access_attempts
      WHERE scope = $1
        AND fingerprint_hash = $2
        AND succeeded = false
        AND attempted_at >= $3
        AND attempted_at <= $4`,
    [RESUME_INVITE_ATTEMPT_SCOPE, context.fingerprintHash, windowStartedAt, now],
  );
  return failures.rows[0]?.count ?? 0;
}

async function registerResumeFailure(
  client: PoolClient,
  context: ResumeRequestContext,
  now: Date,
  policy: ResumeRedeemPolicy,
  inviteId: string | null,
): Promise<void> {
  const failures = await recordResumeAttempt(client, context, false, now, policy);
  if (failures >= policy.maxFailedAttempts) {
    const lockedUntil = new Date(now.getTime() + policy.lockSeconds * 1_000);
    await client.query(
      `INSERT INTO access_attempts
        (scope, fingerprint_hash, succeeded, attempted_at, expires_at)
       VALUES ($1, $2, false, $3, $4)`,
      [RESUME_INVITE_LOCK_SCOPE, context.fingerprintHash, now, lockedUntil],
    );
  }
  await insertResumeEvent(client, {
    eventType: 'redeem_failed',
    resultCode: 'UNAVAILABLE',
    inviteId,
    context,
    now,
    auditRetentionDays: policy.auditRetentionDays,
  });
}

export async function redeemResumeInviteProtected(
  pool: Pool,
  code: string,
  context: ResumeRequestContext,
  policy: ResumeRedeemPolicy,
): Promise<RedeemedResumeSession> {
  validatePolicy(policy);
  validateContext(context);
  const client = await pool.connect();
  let committed = false;

  try {
    await client.query('BEGIN');
    await lockResumeSource(client, context.fingerprintHash);
    const attemptAt = await databaseClock(client);
    if (await isResumeSourceLocked(client, context.fingerprintHash, attemptAt)) {
      await insertResumeEvent(client, {
        eventType: 'redeem_failed',
        resultCode: 'UNAVAILABLE',
        context,
        now: attemptAt,
        auditRetentionDays: policy.auditRetentionDays,
      });
      await client.query('COMMIT');
      committed = true;
      throw new ResumeAccessError('RESUME_INVITE_UNAVAILABLE');
    }

    const result = await client.query<ResumeInviteRow>(
      `SELECT id, expires_at, redeemed_at, disabled_at
         FROM resume_invites
        WHERE code_hash = $1
        FOR UPDATE`,
      [hashSecret(code.trim())],
    );
    const invite = result.rows[0];
    const checkedAt = await databaseClock(client);
    if (
      !invite
      || invite.disabled_at !== null
      || invite.redeemed_at !== null
      || invite.expires_at.getTime() <= checkedAt.getTime()
    ) {
      await registerResumeFailure(client, context, checkedAt, policy, invite?.id ?? null);
      await client.query('COMMIT');
      committed = true;
      throw new ResumeAccessError('RESUME_INVITE_UNAVAILABLE');
    }

    const token = randomBytes(32).toString('base64url');
    const sessionId = randomUUID();
    const expiresAt = new Date(checkedAt.getTime() + policy.sessionHours * 60 * 60 * 1_000);
    await client.query(
      'UPDATE resume_invites SET redeemed_at = $2 WHERE id = $1',
      [invite.id, checkedAt],
    );
    await client.query(
      `INSERT INTO resume_sessions
        (id, invite_id, token_hash, created_at, last_seen_at, expires_at,
         source_ip, user_agent, device_info)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8::jsonb)`,
      [
        sessionId,
        invite.id,
        hashSecret(token),
        checkedAt,
        expiresAt,
        context.ip,
        context.userAgent,
        JSON.stringify(context.deviceInfo),
      ],
    );
    await recordResumeAttempt(client, context, true, checkedAt, policy);
    await insertResumeEvent(client, {
      eventType: 'redeem_succeeded',
      resultCode: 'OK',
      inviteId: invite.id,
      sessionId,
      context,
      now: checkedAt,
      auditRetentionDays: policy.auditRetentionDays,
    });
    await client.query('COMMIT');
    committed = true;
    return { sessionId, token, expiresAt };
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function authenticateResumeSession(
  pool: Pool,
  token: string,
  now = new Date(),
): Promise<AuthenticatedResumeSession | null> {
  if (!token || !(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  const result = await pool.query<ResumeSessionRow>(
    `UPDATE resume_sessions AS session
        SET last_seen_at = GREATEST(session.last_seen_at, $2)
       FROM resume_invites AS invite
      WHERE session.token_hash = $1
        AND session.invite_id = invite.id
        AND session.expires_at > $2
        AND session.revoked_at IS NULL
        AND invite.redeemed_at IS NOT NULL
        AND invite.disabled_at IS NULL
      RETURNING session.id, session.invite_id, session.expires_at`,
    [hashSecret(token), now],
  );
  const session = result.rows[0];
  return session
    ? { id: session.id, inviteId: session.invite_id, expiresAt: session.expires_at }
    : null;
}

export async function revokeResumeSession(
  pool: Pool,
  token: string,
  context: ResumeRequestContext,
): Promise<void> {
  if (!token) return;
  validateContext(context);
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const result = await client.query<ResumeSessionRow>(
      `SELECT id, invite_id, expires_at
         FROM resume_sessions
        WHERE token_hash = $1
          AND revoked_at IS NULL
        FOR UPDATE`,
      [hashSecret(token)],
    );
    const session = result.rows[0];
    if (!session) {
      await client.query('COMMIT');
      committed = true;
      return;
    }
    const now = await databaseClock(client);
    await client.query(
      'UPDATE resume_sessions SET revoked_at = $2 WHERE id = $1',
      [session.id, now],
    );
    await insertResumeEvent(client, {
      eventType: 'session_logged_out',
      resultCode: 'OK',
      inviteId: session.invite_id,
      sessionId: session.id,
      context,
      now,
      auditRetentionDays: DEFAULT_AUDIT_RETENTION_DAYS,
    });
    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function disableResumeInvite(
  pool: Pool,
  inviteId: string,
  adminSessionId: string,
  now?: Date,
): Promise<boolean> {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const invite = await client.query<{ id: string }>(
      `SELECT id
         FROM resume_invites
        WHERE id = $1
          AND disabled_at IS NULL
        FOR UPDATE`,
      [inviteId],
    );
    if (!invite.rows[0]) {
      await client.query('COMMIT');
      committed = true;
      return false;
    }
    const disabledAt = now ?? await databaseClock(client);
    if (!(disabledAt instanceof Date) || !Number.isFinite(disabledAt.getTime())) {
      throw new Error('Resume invite revocation time is invalid.');
    }
    await client.query(
      `UPDATE resume_invites
          SET disabled_at = $2,
              disabled_by_admin_session = $3
        WHERE id = $1`,
      [inviteId, disabledAt, adminSessionId],
    );
    await client.query(
      `UPDATE resume_sessions
          SET revoked_at = $2
        WHERE invite_id = $1
          AND revoked_at IS NULL`,
      [inviteId, disabledAt],
    );
    await insertResumeEvent(client, {
      eventType: 'invite_disabled',
      resultCode: 'OK',
      inviteId,
      now: disabledAt,
      auditRetentionDays: DEFAULT_AUDIT_RETENTION_DAYS,
    });
    await client.query('COMMIT');
    committed = true;
    return true;
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function recordResumeFileReturned(
  pool: Pool,
  session: AuthenticatedResumeSession,
  context: ResumeRequestContext,
): Promise<void> {
  validateContext(context);
  const result = await pool.query(
    `WITH checked AS (
       SELECT clock_timestamp() AS now
     )
     INSERT INTO resume_access_events
       (event_type, result_code, invite_id, session_id, source_ip, user_agent,
        device_info, created_at, delete_after)
     SELECT 'file_returned', 'OK', invite.id, session.id, $3, $4, $5::jsonb,
            checked.now, checked.now + ($6::integer * interval '1 day')
       FROM resume_sessions AS session
       JOIN resume_invites AS invite ON invite.id = session.invite_id
       CROSS JOIN checked
      WHERE session.id = $1
        AND invite.id = $2
        AND session.expires_at > checked.now
        AND session.revoked_at IS NULL
        AND invite.redeemed_at IS NOT NULL
        AND invite.disabled_at IS NULL
     RETURNING resume_access_events.id`,
    [
      session.id,
      session.inviteId,
      context.ip,
      context.userAgent,
      JSON.stringify(context.deviceInfo),
      DEFAULT_AUDIT_RETENTION_DAYS,
    ],
  );
  if (result.rowCount !== 1) {
    throw new ResumeAccessError('RESUME_INVITE_UNAVAILABLE');
  }
}
