import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createDatabasePool } from '../lib/server/db.ts';

const CLEANUP_LOCK_NAME = 'revolution:retention-cleanup:v1';
// Mirrors MORSE_INTERACTION_RETENTION_DAYS (frozen at 10 in lib/server/config.ts).
const USAGE_EVENT_RETENTION_DAYS = 10;
const RECOVERED_INCIDENT_RETENTION_DAYS = 90;

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
  const requestedCleanupNow = cleanupTimestamp(now instanceof Date ? now.toISOString() : String(now));
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

    const schemaState = await client.query(
      `SELECT clock_timestamp() AS cleanup_at,
              to_regprocedure('public.cleanup_expired_chat_history_compactions()') IS NOT NULL
                AS compaction_cleanup_available`,
    );
    const schemaStateRow = schemaState.rows[0];
    if (!schemaStateRow?.cleanup_at) throw new Error('CLEANUP_PRIVATE_HISTORY_RESULT_INVALID');
    const compactionCleanupAvailable = schemaStateRow.compaction_cleanup_available === true;
    let cleanupNow = cleanupTimestamp(String(schemaStateRow.cleanup_at), () => new Date(requestedCleanupNow));
    let deletedCompactions = 0;
    let deletedSummaryAttempts = 0;
    if (compactionCleanupAvailable) {
      const privateHistory = await client.query(
        `SELECT cutoff AS cleanup_at, deleted_compactions, deleted_attempts
           FROM cleanup_expired_chat_history_compactions()`,
      );
      const privateHistoryRow = privateHistory.rows[0];
      if (!privateHistoryRow?.cleanup_at) throw new Error('CLEANUP_PRIVATE_HISTORY_RESULT_INVALID');
      cleanupNow = cleanupTimestamp(String(privateHistoryRow.cleanup_at));
      deletedCompactions = Number(privateHistoryRow.deleted_compactions);
      deletedSummaryAttempts = Number(privateHistoryRow.deleted_attempts);
    }
    if (
      !Number.isSafeInteger(deletedCompactions)
      || deletedCompactions < 0
      || !Number.isSafeInteger(deletedSummaryAttempts)
      || deletedSummaryAttempts < 0
    ) throw new Error('CLEANUP_PRIVATE_HISTORY_RESULT_INVALID');

    const interactionSearches = await client.query(
      'DELETE FROM interaction_searches WHERE delete_after <= $1::timestamptz',
      [cleanupNow],
    );
    const diagnoses = await client.query(
      'DELETE FROM diagnoses WHERE delete_after <= $1::timestamptz',
      [cleanupNow],
    );
    const interactionTurns = await client.query(
      compactionCleanupAvailable
        ? `DELETE FROM interaction_turns AS turn
        WHERE turn.delete_after <= $1::timestamptz
          AND NOT EXISTS (
            SELECT 1
              FROM chat_history_summary_attempts AS attempt
             WHERE attempt.interaction_turn_id = turn.id
               AND attempt.delete_after > $1::timestamptz
          )
          AND NOT EXISTS (
            SELECT 1
              FROM conversation_history_compactions AS compaction
             WHERE compaction.conversation_id = turn.conversation_id
               AND compaction.delete_after > $1::timestamptz
          )`
        : `DELETE FROM interaction_turns AS turn
            WHERE turn.delete_after <= $1::timestamptz`,
      [cleanupNow],
    );
    const sessions = await client.query(
      compactionCleanupAvailable
        ? `DELETE FROM access_sessions AS session
        WHERE session.expires_at <= $1::timestamptz
          AND NOT EXISTS (
            SELECT 1
              FROM chat_history_summary_attempts AS attempt
              JOIN interaction_turns AS turn ON turn.id = attempt.interaction_turn_id
             WHERE turn.access_session_id = session.id
               AND attempt.delete_after > $1::timestamptz
          )
          AND NOT EXISTS (
            SELECT 1
              FROM conversation_history_compactions AS compaction
              JOIN conversations AS conversation ON conversation.id = compaction.conversation_id
             WHERE conversation.access_session_id = session.id
               AND compaction.delete_after > $1::timestamptz
          )`
        : `DELETE FROM access_sessions AS session
            WHERE session.expires_at <= $1::timestamptz`,
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
    const aiConfigEvents = await client.query(
      'DELETE FROM ai_config_events WHERE delete_after <= $1::timestamptz',
      [cleanupNow],
    );
    const usageEvents = await client.query(
      `DELETE FROM usage_events
        WHERE created_at <= $1::timestamptz - make_interval(days => $2)`,
      [cleanupNow, USAGE_EVENT_RETENTION_DAYS],
    );
    const serviceIncidents = await client.query(
      `DELETE FROM service_incidents
        WHERE status = 'recovered'
          AND recovered_at <= $1::timestamptz - make_interval(days => $2)`,
      [cleanupNow, RECOVERED_INCIDENT_RETENTION_DAYS],
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
      deletedCompactions,
      deletedSummaryAttempts,
      deletedSessions: sessions.rowCount ?? 0,
      deactivatedInvites: invites.rowCount ?? 0,
      deletedInteractionSearches: interactionSearches.rowCount ?? 0,
      deletedDiagnoses: diagnoses.rowCount ?? 0,
      deletedInteractionTurns: interactionTurns.rowCount ?? 0,
      deletedAdminSessions: adminSessions.rowCount ?? 0,
      deletedAlertOutbox: alertOutbox.rowCount ?? 0,
      deletedAccessAttempts: accessAttempts.rowCount ?? 0,
      deletedAiConfigEvents: aiConfigEvents.rowCount ?? 0,
      deletedUsageEvents: usageEvents.rowCount ?? 0,
      deletedServiceIncidents: serviceIncidents.rowCount ?? 0,
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
  const connectionString = env.DATABASE_URL_WORKER?.trim();
  if (!connectionString) throw new Error('DATABASE_URL_WORKER is required.');
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
