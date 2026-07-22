import type { PoolClient } from 'pg';

import type { TokenUsage } from './budget.ts';

export type ProviderAttemptLaunchKind = 'primary' | 'hedge' | 'failover';
export type ProviderAttemptTerminalStatus = 'completed' | 'failed' | 'aborted';

export interface ProviderAttemptKey {
  executionId: string;
  interactionTurnId: string;
}

export interface ProviderAttemptSummary {
  attemptCount: number;
  costComplete: boolean;
  estimatedCostUsd: number | null;
  usage: TokenUsage | null;
  usageComplete: boolean;
}

export type ProviderAttemptEvent =
  | {
      attemptNo: number;
      launchKind: ProviderAttemptLaunchKind;
      providerAlias: string;
      startDelayMs: number;
      startedAt: Date;
      type: 'started';
    }
  | {
      attemptNo: number;
      firstByteMs: number;
      providerAlias: string;
      type: 'first_byte';
    }
  | {
      attemptNo: number;
      durationMs: number;
      errorCode: string | null;
      estimatedCostUsd?: number | null;
      providerAlias: string;
      type: ProviderAttemptTerminalStatus;
      usage: TokenUsage | null;
      winner: boolean;
    };

interface RollingHedgeCounts {
  completed_turns: number;
  hedged_attempts: number;
}

const HEDGE_BUDGET_LOCK = 'revolution:chat-v2:rolling-hedge-budget:v1';
const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1_000;

function validateProviderAlias(providerAlias: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/u.test(providerAlias)) {
    throw new Error('Provider alias must be a stable non-sensitive identifier.');
  }
}

function validateAttemptIdentity(
  key: ProviderAttemptKey,
  event: ProviderAttemptEvent,
): void {
  if (!key.interactionTurnId || !key.executionId) {
    throw new Error('Provider attempt identity is incomplete.');
  }
  if (!Number.isSafeInteger(event.attemptNo) || event.attemptNo <= 0) {
    throw new Error('Provider attempt number must be a positive integer.');
  }
  validateProviderAlias(event.providerAlias);
}

async function recordStartedEvent(
  client: PoolClient,
  key: ProviderAttemptKey,
  event: Extract<ProviderAttemptEvent, { type: 'started' }>,
  deleteAfter: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO chat_provider_attempts
      (interaction_turn_id, execution_id, attempt_no, provider_alias, launch_kind,
       status, winner, start_delay_ms, started_at, delete_after)
     VALUES ($1, $2, $3, $4, $5, 'started', false, $6, $7, $8)
     ON CONFLICT (interaction_turn_id, execution_id, attempt_no) DO UPDATE
       SET provider_alias = EXCLUDED.provider_alias,
           launch_kind = EXCLUDED.launch_kind,
           start_delay_ms = EXCLUDED.start_delay_ms,
           started_at = EXCLUDED.started_at,
           delete_after = EXCLUDED.delete_after
     WHERE chat_provider_attempts.status = 'started'`,
    [
      key.interactionTurnId,
      key.executionId,
      event.attemptNo,
      event.providerAlias,
      event.launchKind,
      event.startDelayMs,
      event.startedAt,
      deleteAfter,
    ],
  );
}

async function recordFirstByteEvent(
  client: PoolClient,
  key: ProviderAttemptKey,
  event: Extract<ProviderAttemptEvent, { type: 'first_byte' }>,
): Promise<void> {
  const result = await client.query(
    `UPDATE chat_provider_attempts
        SET status = 'streaming',
            first_byte_ms = COALESCE(first_byte_ms, $4)
      WHERE interaction_turn_id = $1
        AND execution_id = $2
        AND attempt_no = $3
        AND provider_alias = $5
        AND status IN ('started', 'streaming')`,
    [
      key.interactionTurnId,
      key.executionId,
      event.attemptNo,
      event.firstByteMs,
      event.providerAlias,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error('Provider first-byte event has no matching active attempt.');
  }
}

async function recordTerminalEvent(
  client: PoolClient,
  key: ProviderAttemptKey,
  event: Extract<ProviderAttemptEvent, { type: ProviderAttemptTerminalStatus }>,
): Promise<void> {
  if (event.type === 'failed' && !event.errorCode) {
    throw new Error('Failed provider attempts require a stable error code.');
  }
  const result = await client.query(
    `UPDATE chat_provider_attempts
        SET status = $4,
            winner = $5,
            duration_ms = $6,
            error_code = $7,
            input_tokens = $8,
            output_tokens = $9,
            estimated_cost_usd = $10,
            completed_at = started_at + ($6::integer * interval '1 millisecond')
      WHERE interaction_turn_id = $1
        AND execution_id = $2
        AND attempt_no = $3
        AND provider_alias = $11
        AND (status IN ('started', 'streaming') OR status = $4)`,
    [
      key.interactionTurnId,
      key.executionId,
      event.attemptNo,
      event.type,
      event.winner,
      event.durationMs,
      event.errorCode,
      event.usage?.inputTokens ?? null,
      event.usage?.outputTokens ?? null,
      event.estimatedCostUsd ?? null,
      event.providerAlias,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error('Provider terminal event has no matching attempt.');
  }
}

export async function recordProviderAttemptEvent(
  client: PoolClient,
  key: ProviderAttemptKey,
  event: ProviderAttemptEvent,
  deleteAfter: Date,
): Promise<void> {
  validateAttemptIdentity(key, event);
  if (event.type === 'started') {
    await recordStartedEvent(client, key, event, deleteAfter);
    return;
  }
  if (event.type === 'first_byte') {
    await recordFirstByteEvent(client, key, event);
    return;
  }
  await recordTerminalEvent(client, key, event);
}

export async function summarizeProviderAttempts(
  client: PoolClient,
  interactionTurnId: string,
): Promise<ProviderAttemptSummary> {
  const result = await client.query<{
    attempt_count: string;
    cost_count: string;
    estimated_cost_usd: string;
    input_tokens: string;
    output_tokens: string;
    usage_count: string;
  }>(
    `SELECT count(*)::text AS attempt_count,
            count(input_tokens)::text AS usage_count,
            COALESCE(sum(input_tokens), 0)::text AS input_tokens,
            COALESCE(sum(output_tokens), 0)::text AS output_tokens,
            count(estimated_cost_usd)::text AS cost_count,
            COALESCE(sum(estimated_cost_usd), 0)::text AS estimated_cost_usd
       FROM chat_provider_attempts
      WHERE interaction_turn_id = $1`,
    [interactionTurnId],
  );
  const row = result.rows[0];
  const usageCount = Number(row?.usage_count ?? 0);
  const costCount = Number(row?.cost_count ?? 0);
  return {
    attemptCount: Number(row?.attempt_count ?? 0),
    usageComplete: usageCount > 0
      && usageCount === Number(row?.attempt_count ?? 0),
    usage: usageCount > 0
      ? {
          inputTokens: Number(row.input_tokens),
          outputTokens: Number(row.output_tokens),
        }
      : null,
    costComplete: costCount > 0
      && costCount === Number(row?.attempt_count ?? 0),
    estimatedCostUsd: costCount > 0 ? Number(row.estimated_cost_usd) : null,
  };
}

async function inTransaction<T>(client: PoolClient, run: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await run();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function lockRollingHedgeBudget(client: PoolClient): Promise<void> {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    [HEDGE_BUDGET_LOCK],
  );
}

async function loadRollingHedgeCounts(
  client: PoolClient,
  now: Date,
): Promise<{ completedTurns: number; hedgedAttempts: number }> {
  const windowStartedAt = new Date(now.getTime() - ROLLING_WINDOW_MS);
  const result = await client.query<RollingHedgeCounts>(
    `SELECT
       (SELECT count(*)::integer
          FROM chat_provider_attempts
         WHERE launch_kind = 'hedge'
           AND started_at >= $1
           AND started_at <= $2) AS hedged_attempts,
       (SELECT count(*)::integer
         FROM interaction_turns
         WHERE status = 'completed'
           AND workflow IN ('chat', 'jd_match')
           AND completed_at >= $1
           AND completed_at <= $2) AS completed_turns`,
    [windowStartedAt, now],
  );
  return {
    completedTurns: result.rows[0]?.completed_turns ?? 0,
    hedgedAttempts: result.rows[0]?.hedged_attempts ?? 0,
  };
}

export async function reserveHedgedProviderAttempt(
  client: PoolClient,
  key: ProviderAttemptKey,
  started: Extract<ProviderAttemptEvent, { type: 'started' }>,
  deleteAfter: Date,
  now: Date,
  maximumRatio = 0.15,
): Promise<boolean> {
  if (started.launchKind !== 'hedge') {
    throw new Error('Only hedge attempts consume the rolling hedge budget.');
  }
  if (!Number.isFinite(maximumRatio) || maximumRatio < 0 || maximumRatio > 1) {
    throw new Error('Hedge budget ratio must be between zero and one.');
  }
  validateAttemptIdentity(key, started);

  return inTransaction(client, async () => {
    await lockRollingHedgeBudget(client);
    const counts = await loadRollingHedgeCounts(client, now);
    const allowed = (counts.hedgedAttempts + 1)
      / Math.max(counts.completedTurns + 1, 1) <= maximumRatio;
    if (!allowed) return false;
    await recordProviderAttemptEvent(client, key, started, deleteAfter);
    return true;
  });
}
