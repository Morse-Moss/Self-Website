import { randomBytes, randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

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

export async function redeemInvite(
  pool: Pool,
  code: string,
  options: RedeemOptions,
): Promise<RedeemedSession> {
  const now = options.now ?? new Date();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
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

    return { sessionId, token, expiresAt };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
       JOIN invite_codes AS invite ON invite.id = session.invite_code_id
      WHERE session.token_hash = $1
        AND session.expires_at > $2
        AND invite.active = true
        AND invite.expires_at > $2`,
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
