import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { FeishuAlertProvider } from '../lib/server/feishu-alert-provider.ts';

const { Pool } = pg;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

function boundedInteger(value, name, fallback, minimum, maximum) {
  const candidate = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return candidate;
}

function retryAt(now, attemptCount, retryBaseMs) {
  const delay = Math.min(retryBaseMs * (2 ** Math.max(0, attemptCount - 1)), MAX_RETRY_DELAY_MS);
  return new Date(now.getTime() + delay);
}

export async function claimPendingAlert(pool, {
  now = new Date(),
  claimLeaseMs = 30_000,
  maxDeliveryAttempts = 5,
} = {}) {
  const leaseDuration = boundedInteger(
    claimLeaseMs,
    'claimLeaseMs',
    30_000,
    1,
    MAX_RETRY_DELAY_MS,
  );
  const attemptCap = boundedInteger(
    maxDeliveryAttempts,
    'maxDeliveryAttempts',
    5,
    1,
    20,
  );
  const leaseUntil = new Date(now.getTime() + leaseDuration);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const candidate = await client.query(
      `SELECT id, attempt_count
         FROM alert_outbox
        WHERE (
               (status = 'pending' AND available_at <= $1)
            OR (status = 'sending' AND available_at <= $1)
          )
          AND expires_at > $1
        ORDER BY available_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
      [now],
    );
    if (candidate.rowCount === 0) {
      await client.query('COMMIT');
      return null;
    }
    const candidateRow = candidate.rows[0];
    if (candidateRow.attempt_count >= attemptCap) {
      await client.query(
        `UPDATE alert_outbox
            SET status = 'failed',
                available_at = $2,
                updated_at = $2
          WHERE id = $1`,
        [candidateRow.id, now],
      );
      await client.query('COMMIT');
      return {
        id: candidateRow.id,
        attemptCount: candidateRow.attempt_count,
        terminal: true,
      };
    }

    const claimed = await client.query(
      `UPDATE alert_outbox
          SET status = 'sending',
              attempt_count = attempt_count + 1,
              last_attempt_at = $2,
              available_at = $3,
              updated_at = $2
        WHERE id = $1
      RETURNING id, dedupe_key, category, payload, attempt_count, expires_at`,
      [candidateRow.id, now, leaseUntil],
    );
    await client.query('COMMIT');
    const row = claimed.rows[0];
    return {
      id: row.id,
      dedupeKey: row.dedupe_key,
      category: row.category,
      payload: row.payload,
      attemptCount: row.attempt_count,
      expiresAt: row.expires_at,
      lastAttemptAt: now,
      terminal: false,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function dispatchNextAlert({
  pool,
  provider,
  now = new Date(),
  maxDeliveryAttempts = 5,
  retryBaseMs = 60_000,
  claimLeaseMs = 30_000,
}) {
  const attemptCap = boundedInteger(
    maxDeliveryAttempts,
    'maxDeliveryAttempts',
    5,
    1,
    20,
  );
  const baseDelay = boundedInteger(retryBaseMs, 'retryBaseMs', 60_000, 1, MAX_RETRY_DELAY_MS);
  const alert = await claimPendingAlert(pool, {
    now,
    claimLeaseMs,
    maxDeliveryAttempts: attemptCap,
  });
  if (!alert) return { kind: 'idle' };
  if (alert.terminal) {
    return {
      kind: 'failed',
      alertId: alert.id,
      attemptCount: alert.attemptCount,
    };
  }

  try {
    await provider.send({
      dedupeKey: alert.dedupeKey,
      category: alert.category,
      payload: alert.payload,
    });
  } catch {
    if (alert.attemptCount >= attemptCap) {
      const failed = await pool.query(
        `UPDATE alert_outbox
            SET status = 'failed',
                available_at = $2,
                updated_at = $2
          WHERE id = $1
            AND status = 'sending'
            AND attempt_count = $3
            AND last_attempt_at = $4`,
        [alert.id, now, alert.attemptCount, alert.lastAttemptAt],
      );
      if (failed.rowCount !== 1) throw new Error('ALERT_OUTBOX_STATE_CONFLICT');
      return {
        kind: 'failed',
        alertId: alert.id,
        attemptCount: alert.attemptCount,
      };
    }

    const availableAt = retryAt(now, alert.attemptCount, baseDelay);
    const scheduled = await pool.query(
      `UPDATE alert_outbox
          SET status = 'pending',
              available_at = $2,
              updated_at = $3
        WHERE id = $1
          AND status = 'sending'
          AND attempt_count = $4
          AND last_attempt_at = $5`,
      [alert.id, availableAt, now, alert.attemptCount, alert.lastAttemptAt],
    );
    if (scheduled.rowCount !== 1) throw new Error('ALERT_OUTBOX_STATE_CONFLICT');
    return {
      kind: 'retry_scheduled',
      alertId: alert.id,
      attemptCount: alert.attemptCount,
      availableAt,
    };
  }

  const sent = await pool.query(
    `UPDATE alert_outbox
        SET status = 'sent',
            sent_at = $2,
            updated_at = $2
      WHERE id = $1
        AND status = 'sending'
        AND attempt_count = $3
        AND last_attempt_at = $4`,
    [alert.id, now, alert.attemptCount, alert.lastAttemptAt],
  );
  if (sent.rowCount !== 1) throw new Error('ALERT_OUTBOX_STATE_CONFLICT');
  return {
    kind: 'sent',
    alertId: alert.id,
    attemptCount: alert.attemptCount,
  };
}

export async function dispatchAvailableAlerts({
  pool,
  provider,
  now,
  clock = () => new Date(),
  limit = 20,
  maxDeliveryAttempts = 5,
  retryBaseMs = 60_000,
  claimLeaseMs = 30_000,
}) {
  const dispatchLimit = boundedInteger(limit, 'limit', 20, 1, 100);
  const summary = { claimed: 0, sent: 0, retryScheduled: 0, failed: 0 };
  for (let index = 0; index < dispatchLimit; index += 1) {
    const result = await dispatchNextAlert({
      pool,
      provider,
      now: now ?? clock(),
      maxDeliveryAttempts,
      retryBaseMs,
      claimLeaseMs,
    });
    if (result.kind === 'idle') break;
    summary.claimed += 1;
    if (result.kind === 'sent') summary.sent += 1;
    else if (result.kind === 'retry_scheduled') summary.retryScheduled += 1;
    else summary.failed += 1;
  }
  return summary;
}

export async function main({ env = process.env, logger = console, fetcher = fetch } = {}) {
  const connectionString = env.DATABASE_URL?.trim();
  const webhookUrl = env.FEISHU_WEBHOOK_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  if (!webhookUrl) throw new Error('FEISHU_WEBHOOK_URL is required.');

  const pool = new Pool({ connectionString });
  try {
    const provider = new FeishuAlertProvider({ webhookUrl, timeoutMs: 5_000 }, fetcher);
    const summary = await dispatchAvailableAlerts({
      pool,
      provider,
      limit: boundedInteger(env.MORSE_ALERT_DISPATCH_LIMIT, 'MORSE_ALERT_DISPATCH_LIMIT', 20, 1, 100),
      maxDeliveryAttempts: boundedInteger(
        env.MORSE_ALERT_MAX_ATTEMPTS,
        'MORSE_ALERT_MAX_ATTEMPTS',
        5,
        1,
        20,
      ),
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
    console.error('ALERT_DISPATCH_FAILED');
    process.exitCode = 1;
  });
}
