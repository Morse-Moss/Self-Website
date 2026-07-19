import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

import type { Pool, PoolClient } from 'pg';

import { enqueueAlert } from './alert-service.ts';
import { hashSecret, isInviteUsable } from './security.ts';

export type AccessErrorCode = 'INVITE_UNAVAILABLE';

export class AccessError extends Error {
  readonly code: AccessErrorCode;

  constructor(code: AccessErrorCode) {
    super(code);
    this.name = 'AccessError';
    this.code = code;
  }
}

export interface RedeemOptions {
  now?: Date;
  sessionHours: number;
}

export interface ProtectedRedeemOptions extends RedeemOptions {
  source: string;
  fingerprintSecret: string;
  attemptWindowSeconds: number;
  maxFailedAttempts: number;
  lockSeconds: number;
}

export interface RedeemedSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

export interface AuthenticatedSession {
  id: string;
  inviteCodeId: string;
  expiresAt: Date;
  messageCount: number;
}

interface InviteRow {
  id: string;
  active: boolean;
  expires_at: Date;
  session_count: number;
  max_sessions: number;
}

interface InviteAbuseState {
  fingerprintHash: string;
  attemptWindowSeconds: number;
  maxFailedAttempts: number;
  lockSeconds: number;
}

const ATTEMPT_RETENTION_MS = 10 * 24 * 60 * 60 * 1_000;
const INVITE_ATTEMPT_SCOPE = 'invite_redeem';
const INVITE_LOCK_SCOPE = 'invite_redeem_lock';

export function hashInviteSourceFingerprint(secret: string, source: string): string {
  return createHmac('sha256', secret).update(source, 'utf8').digest('hex');
}

export function trustedInviteSource(
  forwardedFor: string | null | undefined,
  trustedProxyHops: number,
): string {
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 1) return 'unattributed';
  const addresses = (forwardedFor ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(-32);
  if (addresses.length < trustedProxyHops) return 'unattributed';
  const address = addresses[addresses.length - trustedProxyHops];
  return isIP(address) ? address.toLowerCase() : 'unattributed';
}

async function lockInviteFingerprint(
  client: PoolClient,
  fingerprintHash: string,
): Promise<void> {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [fingerprintHash],
  );
}

async function isInviteSourceLocked(
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
    [INVITE_LOCK_SCOPE, fingerprintHash, now],
  );
  return result.rowCount === 1;
}

async function recordInviteAttempt(input: {
  client: PoolClient;
  abuse: InviteAbuseState;
  succeeded: boolean;
  now: Date;
}): Promise<number> {
  const expiresAt = new Date(input.now.getTime() + ATTEMPT_RETENTION_MS);
  await input.client.query(
    `INSERT INTO access_attempts
      (scope, fingerprint_hash, succeeded, attempted_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      INVITE_ATTEMPT_SCOPE,
      input.abuse.fingerprintHash,
      input.succeeded,
      input.now,
      expiresAt,
    ],
  );
  if (input.succeeded) return 0;

  const windowStartedAt = new Date(
    input.now.getTime() - input.abuse.attemptWindowSeconds * 1_000,
  );
  const failures = await input.client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM access_attempts
      WHERE scope = $1
        AND fingerprint_hash = $2
        AND succeeded = false
        AND attempted_at >= $3
        AND attempted_at <= $4`,
    [INVITE_ATTEMPT_SCOPE, input.abuse.fingerprintHash, windowStartedAt, input.now],
  );
  return Number(failures.rows[0]?.count ?? 0);
}

async function lockAbusiveInviteSource(input: {
  client: PoolClient;
  abuse: InviteAbuseState;
  now: Date;
}): Promise<void> {
  const lockedUntil = new Date(input.now.getTime() + input.abuse.lockSeconds * 1_000);
  await input.client.query(
    `INSERT INTO access_attempts
      (scope, fingerprint_hash, succeeded, attempted_at, expires_at)
     VALUES ($1, $2, false, $3, $4)`,
    [INVITE_LOCK_SCOPE, input.abuse.fingerprintHash, input.now, lockedUntil],
  );
  const window = Math.floor(
    input.now.getTime() / (input.abuse.attemptWindowSeconds * 1_000),
  );
  await enqueueAlert(input.client, {
    dedupeKey: `security:invite_abuse:${input.abuse.fingerprintHash}:${window}`,
    category: 'invite_abuse',
    payload: {
      lockedUntil: lockedUntil.toISOString(),
      occurredAt: input.now.toISOString(),
    },
    now: input.now,
  });
}

async function redeemInviteInternal(
  pool: Pool,
  code: string,
  options: RedeemOptions,
  abuse: InviteAbuseState | null,
): Promise<RedeemedSession> {
  const now = options.now ?? new Date();
  const client = await pool.connect();
  let committed = false;

  try {
    await client.query('BEGIN');
    if (abuse) {
      await lockInviteFingerprint(client, abuse.fingerprintHash);
      if (await isInviteSourceLocked(client, abuse.fingerprintHash, now)) {
        await client.query('COMMIT');
        committed = true;
        throw new AccessError('INVITE_UNAVAILABLE');
      }
    }

    const result = await client.query<InviteRow>(
      `SELECT id, active, expires_at, session_count, max_sessions
         FROM invite_codes
        WHERE code_hash = $1
        FOR UPDATE`,
      [hashSecret(code.trim())],
    );
    const invite = result.rows[0];

    if (!invite || !isInviteUsable({
      active: invite.active,
      expiresAt: invite.expires_at,
      sessionCount: invite.session_count,
      maxSessions: invite.max_sessions,
    }, now)) {
      if (!abuse) throw new AccessError('INVITE_UNAVAILABLE');
      const failures = await recordInviteAttempt({ client, abuse, succeeded: false, now });
      if (failures >= abuse.maxFailedAttempts) {
        await lockAbusiveInviteSource({ client, abuse, now });
      }
      await client.query('COMMIT');
      committed = true;
      throw new AccessError('INVITE_UNAVAILABLE');
    }

    const requestedExpiry = new Date(now.getTime() + options.sessionHours * 60 * 60 * 1000);
    const expiresAt = new Date(Math.min(requestedExpiry.getTime(), invite.expires_at.getTime()));
    const sessionId = randomUUID();
    const token = randomBytes(32).toString('base64url');

    await client.query(
      'UPDATE invite_codes SET session_count = session_count + 1 WHERE id = $1',
      [invite.id],
    );
    await client.query(
      `INSERT INTO access_sessions
        (id, invite_code_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [sessionId, invite.id, hashSecret(token), expiresAt, now],
    );
    if (abuse) await recordInviteAttempt({ client, abuse, succeeded: true, now });
    if (invite.session_count === 0) {
      await enqueueAlert(client, {
        dedupeKey: `invite-first-use:${invite.id}`,
        category: 'invite_first_use',
        payload: {
          inviteId: invite.id,
          occurredAt: now.toISOString(),
        },
        now,
      });
    }
    await client.query('COMMIT');
    committed = true;

    return { sessionId, token, expiresAt };
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function redeemInvite(
  pool: Pool,
  code: string,
  options: RedeemOptions,
): Promise<RedeemedSession> {
  return redeemInviteInternal(pool, code, options, null);
}

export async function redeemInviteProtected(
  pool: Pool,
  code: string,
  options: ProtectedRedeemOptions,
): Promise<RedeemedSession> {
  if (
    !Number.isSafeInteger(options.attemptWindowSeconds)
    || options.attemptWindowSeconds <= 0
    || !Number.isSafeInteger(options.maxFailedAttempts)
    || options.maxFailedAttempts <= 0
    || !Number.isSafeInteger(options.lockSeconds)
    || options.lockSeconds < options.attemptWindowSeconds
  ) {
    throw new Error('Invite abuse policy is invalid.');
  }
  const abuse: InviteAbuseState = {
    fingerprintHash: hashInviteSourceFingerprint(options.fingerprintSecret, options.source),
    attemptWindowSeconds: options.attemptWindowSeconds,
    maxFailedAttempts: options.maxFailedAttempts,
    lockSeconds: options.lockSeconds,
  };
  return redeemInviteInternal(pool, code, options, abuse);
}

interface SessionRow {
  id: string;
  invite_code_id: string;
  expires_at: Date;
  message_count: number;
}

export async function authenticateSession(
  pool: Pool,
  token: string,
  now = new Date(),
): Promise<AuthenticatedSession | null> {
  if (!token) return null;

  const result = await pool.query<SessionRow>(
    `SELECT session.id, session.invite_code_id, session.expires_at, session.message_count
       FROM access_sessions AS session
      WHERE session.token_hash = $1
        AND session.expires_at > $2`,
    [hashSecret(token), now],
  );
  const session = result.rows[0];
  if (!session) return null;

  return {
    id: session.id,
    inviteCodeId: session.invite_code_id,
    expiresAt: session.expires_at,
    messageCount: session.message_count,
  };
}
