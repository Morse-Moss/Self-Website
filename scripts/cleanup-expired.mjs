import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createDatabasePool } from '../lib/server/db.ts';

const CLEANUP_LOCK_NAME = 'revolution:retention-cleanup:v1';

function cleanupTimestamp(value, clock = () => new Date()) {
  const cleanupDate = value?.trim() ? new Date(value.trim()) : clock();
  if (Number.isNaN(cleanupDate.getTime())) {
    throw new Error('MORSE_CLEANUP_NOW must be a valid ISO timestamp.');
  }
  return cleanupDate.toISOString();
}

/**
 * @param {{pool?: any, now?: Date|string, lockName?: string}} [input]
 */
export async function cleanupExpired({
  pool,
  now = new Date(),
  lockName = CLEANUP_LOCK_NAME,
} = {}) {
  if (!pool) throw new Error('CLEANUP_POOL_REQUIRED');
  const cleanupNow = cleanupTimestamp(now instanceof Date ? now.toISOString() : String(now));
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const lock = await client.query(
      `SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS acquired`,
      [lockName],
    );
    if (lock.rows[0]?.acquired !== true) {
      await client.query('COMMIT');
      transactionOpen = false;
      return { skipped: true };
    }

    const interactionSearches = await client.query(
      'DELETE FROM interaction_searches WHERE delete_after <= $1::timestamptz',
      [cleanupNow],
    );
    const diagnoses = await client.query(
      'DELETE FROM diagnoses WHERE delete_after <= $1::timestamptz',
      [cleanupNow],
    );
    const interactionTurns = await client.query(
      'DELETE FROM interaction_turns WHERE delete_after <= $1::timestamptz',
      [cleanupNow],
    );
    const sessions = await client.query(
      'DELETE FROM access_sessions WHERE expires_at <= $1::timestamptz',
      [cleanupNow],
    );
    const invites = await client.query(
      `UPDATE invite_codes SET active = false
        WHERE expires_at <= $1::timestamptz AND active = true`,
      [cleanupNow],
    );
    const adminSessions = await client.query(
      'DELETE FROM admin_sessions WHERE expires_at <= $1::timestamptz',
      [cleanupNow],
    );
    const alertOutbox = await client.query(
      'DELETE FROM alert_outbox WHERE expires_at <= $1::timestamptz',
      [cleanupNow],
    );
    const accessAttempts = await client.query(
      'DELETE FROM access_attempts WHERE expires_at <= $1::timestamptz',
      [cleanupNow],
    );
    await client.query(
      `INSERT INTO resume_access_events
        (event_type, result_code, invite_id, session_id, source_ip, user_agent, device_info, created_at, delete_after)
       SELECT 'expired_cleanup',
              CASE WHEN revoked_at <= $1::timestamptz THEN 'SESSION_REVOKED' ELSE 'SESSION_EXPIRED' END,
              invite_id, id, source_ip, user_agent, device_info,
              $1::timestamptz, $1::timestamptz + interval '30 days'
         FROM resume_sessions
        WHERE expires_at <= $1::timestamptz OR revoked_at <= $1::timestamptz`,
      [cleanupNow],
    );
    const resumeSessions = await client.query(
      `DELETE FROM resume_sessions
        WHERE expires_at <= $1::timestamptz OR revoked_at <= $1::timestamptz`,
      [cleanupNow],
    );
    await client.query(
      `INSERT INTO resume_access_events
        (event_type, result_code, invite_id, created_at, delete_after)
       SELECT 'expired_cleanup', 'INVITE_EXPIRED', id,
              $1::timestamptz, $1::timestamptz + interval '30 days'
         FROM resume_invites
        WHERE expires_at <= $1::timestamptz
          AND redeemed_at IS NULL
          AND disabled_at IS NULL`,
      [cleanupNow],
    );
    const resumeInvites = await client.query(
      `UPDATE resume_invites
          SET disabled_at = COALESCE(disabled_at, $1::timestamptz)
        WHERE expires_at <= $1::timestamptz
          AND redeemed_at IS NULL
          AND disabled_at IS NULL`,
      [cleanupNow],
    );
    const resumeEvents = await client.query(
      'DELETE FROM resume_access_events WHERE delete_after <= $1::timestamptz',
      [cleanupNow],
    );
    await client.query('COMMIT');
    transactionOpen = false;
    return {
      deletedSessions: sessions.rowCount ?? 0,
      deactivatedInvites: invites.rowCount ?? 0,
      deletedInteractionSearches: interactionSearches.rowCount ?? 0,
      deletedDiagnoses: diagnoses.rowCount ?? 0,
      deletedInteractionTurns: interactionTurns.rowCount ?? 0,
      deletedAdminSessions: adminSessions.rowCount ?? 0,
      deletedAlertOutbox: alertOutbox.rowCount ?? 0,
      deletedAccessAttempts: accessAttempts.rowCount ?? 0,
      deletedResumeSessions: resumeSessions.rowCount ?? 0,
      disabledResumeInvites: resumeInvites.rowCount ?? 0,
      deletedResumeEvents: resumeEvents.rowCount ?? 0,
    };
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * @param {{env?: Record<string, string|undefined>, logger?: Pick<Console, 'log'|'error'>}} [input]
 */
export async function main({ env = process.env, logger = console } = {}) {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const pool = createDatabasePool(connectionString, { env, role: 'worker' });
  try {
    const summary = await cleanupExpired({
      pool,
      now: cleanupTimestamp(env.MORSE_CLEANUP_NOW),
    });
    logger.log(JSON.stringify(summary));
    return summary;
  } finally {
    await pool.end();
  }
}

const filename = fileURLToPath(import.meta.url);
const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === filename;
if (isMain) {
  main().catch(() => {
    console.error('CLEANUP_FAILED');
    process.exitCode = 1;
  });
}
