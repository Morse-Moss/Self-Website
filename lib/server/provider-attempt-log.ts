import type { PoolClient } from 'pg';

import type {
  GenerationRequestIntegrity,
  GenerationRequestIntegrityV1,
  GenerationRequestIntegrityV2,
  GenerationVariantV2,
} from '../contracts/chat-context.ts';
import type { TokenUsage } from './budget.ts';
import type { SanitizedProviderFailure } from './provider-failure.ts';

export type ProviderAttemptLaunchKind = 'primary' | 'hedge' | 'failover' | 'overflow_retry';
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
      generationMode?: 'normal' | 'strict';
      generationVariantTrigger?: GenerationVariantV2['trigger'];
      integrity?: GenerationRequestIntegrity;
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
      elapsedMs: number;
      providerAlias: string;
      type: 'first_protocol';
    }
  | {
      attemptNo: number;
      elapsedMs: number;
      providerAlias: string;
      type: 'first_model_text';
    }
  | {
      attemptNo: number;
      elapsedMs: number;
      providerAlias: string;
      type: 'first_user_visible';
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
      failure?: SanitizedProviderFailure | null;
    };

interface RollingHedgeCounts {
  completed_turns: number;
  hedged_attempts: number;
}

interface AttemptIntegrityRow {
  attempt_no: number;
  context_builder_version: string | null;
  delete_after: Date;
  generation_variant_id: string | null;
  generation_variant_revision: number | null;
  generation_variant_trigger: GenerationVariantV2['trigger'] | null;
  generation_mode: 'normal' | 'strict' | null;
  generation_overlay_version: 'strict-overlay-v1' | null;
  generation_request_hmac_sha256: string | null;
  generation_request_v2_hmac_sha256: string | null;
  launch_kind: ProviderAttemptLaunchKind;
  packet_hmac_key_id: string | null;
  packet_hmac_sha256: string | null;
  provider_alias: string;
  start_delay_ms: number;
  started_at: Date;
  target_config_digest: string | null;
  target_config_digest_version: 1 | 2 | null;
  target_context_window_tokens: number | null;
  target_max_output_tokens: number | null;
  target_model_id: string | null;
  target_protocol: 'responses' | 'chat_completions' | null;
  target_reasoning_effort: GenerationRequestIntegrityV2['target']['reasoningEffort'] | null;
}

const HEDGE_BUDGET_LOCK = 'revolution:chat-v2:rolling-hedge-budget:v1';
const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1_000;

function integrityMismatch(): never {
  throw new Error('PROVIDER_ATTEMPT_INTEGRITY_MISMATCH');
}

function isIntegrityV2(
  integrity: GenerationRequestIntegrity,
): integrity is GenerationRequestIntegrityV2 {
  return 'version' in integrity && integrity.version === 2;
}

function validateIntegrity(
  generationMode: 'normal' | 'strict',
  integrity: GenerationRequestIntegrity,
): void {
  if (isIntegrityV2(integrity)) {
    const target = integrity.target;
    const nullablePositive = (value: number | null) => value === null
      || (Number.isSafeInteger(value) && value > 0);
    if (generationMode !== 'normal'
      || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(integrity.contextBuilderVersion)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
        integrity.generationVariantId,
      )
      || !Number.isSafeInteger(integrity.generationVariantRevision)
      || integrity.generationVariantRevision < 1
      || !/^[a-z0-9][a-z0-9._-]{0,31}$/u.test(integrity.packetHmacKeyId)
      || !/^[0-9a-f]{64}$/u.test(integrity.packetHmacSha256)
      || !/^[0-9a-f]{64}$/u.test(integrity.generationRequestHmacSha256)
      || ![1, 2].includes(target.configDigestVersion)
      || !/^[0-9a-f]{64}$/u.test(target.configDigest)
      || target.modelId.trim() !== target.modelId
      || target.modelId.length < 1
      || target.modelId.length > 512
      || !['responses', 'chat_completions'].includes(target.protocol)
      || !nullablePositive(target.contextWindowTokens)
      || !nullablePositive(target.maxOutputTokens)) integrityMismatch();
    return;
  }
  if (generationMode !== 'normal'
    || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(integrity.contextBuilderVersion)
    || !/^[a-z0-9][a-z0-9._-]{0,31}$/u.test(integrity.packetHmacKeyId)
    || !/^[0-9a-f]{64}$/u.test(integrity.packetHmacSha256)
    || !/^[0-9a-f]{64}$/u.test(integrity.generationRequestHmacSha256)
    || integrity.generationOverlayVersion !== null) integrityMismatch();
}

function integritiesMatch(
  left: GenerationRequestIntegrity,
  right: GenerationRequestIntegrity,
): boolean {
  const leftV2 = isIntegrityV2(left);
  const rightV2 = isIntegrityV2(right);
  if (leftV2 !== rightV2) return false;
  if (leftV2 && rightV2) {
    return left.contextBuilderVersion === right.contextBuilderVersion
      && left.generationVariantId === right.generationVariantId
      && left.generationVariantRevision === right.generationVariantRevision
      && left.target.configDigestVersion === right.target.configDigestVersion
      && left.target.configDigest === right.target.configDigest
      && left.target.modelId === right.target.modelId
      && left.target.protocol === right.target.protocol
      && left.target.contextWindowTokens === right.target.contextWindowTokens
      && left.target.maxOutputTokens === right.target.maxOutputTokens
      && left.target.reasoningEffort === right.target.reasoningEffort
      && left.packetHmacKeyId === right.packetHmacKeyId
      && left.packetHmacSha256 === right.packetHmacSha256
      && left.generationRequestHmacSha256 === right.generationRequestHmacSha256;
  }
  if (leftV2 || rightV2) return false;
  return left.contextBuilderVersion === right.contextBuilderVersion
    && left.packetHmacKeyId === right.packetHmacKeyId
    && left.packetHmacSha256 === right.packetHmacSha256
    && left.generationOverlayVersion === right.generationOverlayVersion
    && left.generationRequestHmacSha256 === right.generationRequestHmacSha256;
}

function assertAttemptReplayMatches(
  row: AttemptIntegrityRow,
  event: Extract<ProviderAttemptEvent, { type: 'started' }>,
  generationMode: 'normal' | 'strict',
  integrity: GenerationRequestIntegrity | null,
  deleteAfter: Date,
): void {
  if (integrity) validateIntegrity(generationMode, integrity);
  const v2 = integrity && isIntegrityV2(integrity) ? integrity : null;
  const v1 = integrity && !isIntegrityV2(integrity)
    ? integrity as GenerationRequestIntegrityV1
    : null;
  if (row.attempt_no !== event.attemptNo
    || row.provider_alias !== event.providerAlias
    || row.launch_kind !== event.launchKind
    || row.generation_mode !== generationMode
    || row.context_builder_version !== (integrity?.contextBuilderVersion ?? null)
    || row.packet_hmac_key_id !== (integrity?.packetHmacKeyId ?? null)
    || row.packet_hmac_sha256 !== (integrity?.packetHmacSha256 ?? null)
    || row.generation_overlay_version !== (v1?.generationOverlayVersion ?? null)
    || row.generation_request_hmac_sha256 !== (v1?.generationRequestHmacSha256 ?? null)
    || row.generation_variant_id !== (v2?.generationVariantId ?? null)
    || row.generation_variant_revision !== (v2?.generationVariantRevision ?? null)
    || row.generation_variant_trigger !== (v2 ? event.generationVariantTrigger ?? null : null)
    || row.target_config_digest_version !== (v2?.target.configDigestVersion ?? null)
    || row.target_config_digest !== (v2?.target.configDigest ?? null)
    || row.target_model_id !== (v2?.target.modelId ?? null)
    || row.target_protocol !== (v2?.target.protocol ?? null)
    || row.target_context_window_tokens !== (v2?.target.contextWindowTokens ?? null)
    || row.target_max_output_tokens !== (v2?.target.maxOutputTokens ?? null)
    || row.target_reasoning_effort !== (v2?.target.reasoningEffort ?? null)
    || row.generation_request_v2_hmac_sha256 !== (v2?.generationRequestHmacSha256 ?? null)
    || row.start_delay_ms !== event.startDelayMs
    || row.started_at.getTime() !== event.startedAt.getTime()
    || row.delete_after.getTime() !== deleteAfter.getTime()) integrityMismatch();
}

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
  integrity: GenerationRequestIntegrity | null,
  dynamicProviderContextEnabled = false,
): Promise<void> {
  const generationMode = event.generationMode ?? 'normal';
  if (generationMode !== 'normal') integrityMismatch();
  if (integrity) validateIntegrity(generationMode, integrity);
  const v2 = integrity && isIntegrityV2(integrity) ? integrity : null;
  const v1 = integrity && !isIntegrityV2(integrity)
    ? integrity as GenerationRequestIntegrityV1
    : null;
  if (!dynamicProviderContextEnabled && v2) integrityMismatch();
  if (Boolean(v2) !== Boolean(event.generationVariantTrigger)) integrityMismatch();
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    [`revolution:provider-attempt-integrity:v1:${key.interactionTurnId}`],
  );
  const result = await client.query(
    dynamicProviderContextEnabled
      ? `INSERT INTO chat_provider_attempts
      (interaction_turn_id, execution_id, attempt_no, provider_alias, launch_kind,
       generation_mode, context_builder_version, packet_hmac_key_id,
       packet_hmac_sha256, generation_overlay_version,
       generation_request_hmac_sha256, status, winner, start_delay_ms,
       started_at, delete_after, generation_variant_id, generation_variant_revision,
       generation_variant_trigger, target_config_digest_version, target_config_digest,
       target_model_id, target_protocol, target_context_window_tokens,
       target_max_output_tokens, target_reasoning_effort,
       generation_request_v2_hmac_sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             'started', false, $12, $13, $14, $15, $16, $17, $18, $19,
             $20, $21, $22, $23, $24, $25)
     ON CONFLICT (interaction_turn_id, execution_id, attempt_no) DO NOTHING`
      : `INSERT INTO chat_provider_attempts
        (interaction_turn_id, execution_id, attempt_no, provider_alias, launch_kind,
         generation_mode, context_builder_version, packet_hmac_key_id,
         packet_hmac_sha256, generation_overlay_version,
         generation_request_hmac_sha256, status, winner, start_delay_ms,
         started_at, delete_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               'started', false, $12, $13, $14)
       ON CONFLICT (interaction_turn_id, execution_id, attempt_no) DO NOTHING`,
    dynamicProviderContextEnabled ? [
      key.interactionTurnId,
      key.executionId,
      event.attemptNo,
      event.providerAlias,
      event.launchKind,
      generationMode,
      integrity?.contextBuilderVersion ?? null,
      integrity?.packetHmacKeyId ?? null,
      integrity?.packetHmacSha256 ?? null,
      v1?.generationOverlayVersion ?? null,
      v1?.generationRequestHmacSha256 ?? null,
      event.startDelayMs,
      event.startedAt,
      deleteAfter,
      v2?.generationVariantId ?? null,
      v2?.generationVariantRevision ?? null,
      v2 ? event.generationVariantTrigger ?? null : null,
      v2?.target.configDigestVersion ?? null,
      v2?.target.configDigest ?? null,
      v2?.target.modelId ?? null,
      v2?.target.protocol ?? null,
      v2?.target.contextWindowTokens ?? null,
      v2?.target.maxOutputTokens ?? null,
      v2?.target.reasoningEffort ?? null,
      v2?.generationRequestHmacSha256 ?? null,
    ] : [
      key.interactionTurnId,
      key.executionId,
      event.attemptNo,
      event.providerAlias,
      event.launchKind,
      generationMode,
      integrity?.contextBuilderVersion ?? null,
      integrity?.packetHmacKeyId ?? null,
      integrity?.packetHmacSha256 ?? null,
      v1?.generationOverlayVersion ?? null,
      v1?.generationRequestHmacSha256 ?? null,
      event.startDelayMs,
      event.startedAt,
      deleteAfter,
    ],
  );
  if (result.rowCount !== 1) {
    const existing = await client.query<AttemptIntegrityRow>(
      dynamicProviderContextEnabled
        ? `SELECT attempt_no, provider_alias, launch_kind, generation_mode,
              context_builder_version, packet_hmac_key_id, packet_hmac_sha256,
              generation_overlay_version, generation_request_hmac_sha256,
              generation_variant_id::text, generation_variant_revision,
              generation_variant_trigger, target_config_digest_version,
              target_config_digest, target_model_id, target_protocol,
              target_context_window_tokens, target_max_output_tokens,
              target_reasoning_effort, generation_request_v2_hmac_sha256,
              start_delay_ms, started_at, delete_after
         FROM chat_provider_attempts
        WHERE interaction_turn_id = $1 AND execution_id = $2 AND attempt_no = $3
        FOR UPDATE`
        : `SELECT attempt_no, provider_alias, launch_kind, generation_mode,
              context_builder_version, packet_hmac_key_id, packet_hmac_sha256,
              generation_overlay_version, generation_request_hmac_sha256,
              NULL::text AS generation_variant_id,
              NULL::integer AS generation_variant_revision,
              NULL::text AS generation_variant_trigger,
              NULL::smallint AS target_config_digest_version,
              NULL::text AS target_config_digest, NULL::text AS target_model_id,
              NULL::text AS target_protocol, NULL::integer AS target_context_window_tokens,
              NULL::integer AS target_max_output_tokens, NULL::text AS target_reasoning_effort,
              NULL::text AS generation_request_v2_hmac_sha256,
              start_delay_ms, started_at, delete_after
         FROM chat_provider_attempts
        WHERE interaction_turn_id = $1 AND execution_id = $2 AND attempt_no = $3
        FOR UPDATE`,
      [key.interactionTurnId, key.executionId, event.attemptNo],
    );
    const row = existing.rows[0];
    if (!row) integrityMismatch();
    assertAttemptReplayMatches(row, event, generationMode, integrity, deleteAfter);
  }
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

async function recordMilestoneEvent(
  client: PoolClient,
  key: ProviderAttemptKey,
  event: Extract<ProviderAttemptEvent, {
    type: 'first_protocol' | 'first_model_text' | 'first_user_visible';
  }>,
): Promise<void> {
  const column = {
    first_protocol: 'first_protocol_event_ms',
    first_model_text: 'first_model_text_ms',
    first_user_visible: 'first_user_visible_ms',
  }[event.type];
  const result = await client.query(
    `UPDATE chat_provider_attempts
        SET status = CASE
              WHEN status IN ('started', 'streaming') THEN 'streaming'
              ELSE status
            END,
            ${column} = COALESCE(${column}, $4)
      WHERE interaction_turn_id = $1
        AND execution_id = $2
        AND attempt_no = $3
        AND provider_alias = $5
        AND (
          status IN ('started', 'streaming')
          OR ($6 = 'first_user_visible' AND status = 'completed' AND winner)
        )`,
    [
      key.interactionTurnId,
      key.executionId,
      event.attemptNo,
      event.elapsedMs,
      event.providerAlias,
      event.type,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error('Provider milestone event has no matching active attempt.');
  }
}

async function recordTerminalEvent(
  client: PoolClient,
  key: ProviderAttemptKey,
  event: Extract<ProviderAttemptEvent, { type: ProviderAttemptTerminalStatus }>,
  dynamicProviderContextEnabled = false,
): Promise<void> {
  if (event.type === 'failed' && !event.errorCode) {
    throw new Error('Failed provider attempts require a stable error code.');
  }
  const failure = event.failure ?? null;
  const result = await client.query(
    dynamicProviderContextEnabled
      ? `UPDATE chat_provider_attempts
        SET status = $4,
            winner = $5,
            duration_ms = $6,
            error_code = $7,
            input_tokens = $8,
            output_tokens = $9,
            estimated_cost_usd = $10,
            completed_at = started_at + ($6::integer * interval '1 millisecond'),
            provider_failure_category = $11,
            provider_failure_reason = $12,
            provider_http_status = $13,
            provider_input_tokens = $14,
            provider_output_tokens = $15,
            provider_context_window_tokens = $16
      WHERE interaction_turn_id = $1
        AND execution_id = $2
        AND attempt_no = $3
        AND provider_alias = $17
        AND (status IN ('started', 'streaming') OR status = $4)`
      : `UPDATE chat_provider_attempts
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
    dynamicProviderContextEnabled ? [
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
      failure?.category ?? null,
      failure?.reason ?? null,
      failure?.httpStatus ?? null,
      failure?.inputTokens ?? null,
      failure?.outputTokens ?? null,
      failure?.contextWindowTokens ?? null,
      event.providerAlias,
    ] : [
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
  integrity: GenerationRequestIntegrity | null = null,
  input: { dynamicProviderContextEnabled?: boolean } = {},
): Promise<void> {
  const dynamicProviderContextEnabled = input.dynamicProviderContextEnabled === true;
  validateAttemptIdentity(key, event);
  if (event.type === 'started') {
    if (event.integrity && integrity && !integritiesMatch(event.integrity, integrity)) {
      integrityMismatch();
    }
    await inTransaction(client, () => recordStartedEvent(
      client,
      key,
      event,
      deleteAfter,
      event.integrity ?? integrity,
      dynamicProviderContextEnabled,
    ));
    return;
  }
  if (event.type === 'first_byte') {
    await recordFirstByteEvent(client, key, event);
    return;
  }
  if (event.type === 'first_protocol'
    || event.type === 'first_model_text'
    || event.type === 'first_user_visible') {
    await recordMilestoneEvent(client, key, event);
    return;
  }
  await recordTerminalEvent(client, key, event, dynamicProviderContextEnabled);
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
  integrity: GenerationRequestIntegrity | null = null,
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
    await recordStartedEvent(client, key, started, deleteAfter, integrity);
    return true;
  });
}
