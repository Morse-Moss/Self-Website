import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import type {
  GenerationTargetBindingV2,
  HistoryCompactionPipeline,
} from '../contracts/chat-context.ts';

type Pool = pg.Pool;
type Client = pg.PoolClient;

type CompactionTarget = GenerationTargetBindingV2 & { contextWindowTokens: number };

export interface CompactionReuseKey {
  conversationId: string;
  contextScopeId: string | null;
  ownerPipeline: HistoryCompactionPipeline;
  sourceTurnIds: readonly string[];
  sourceTurnSha256: string;
  target: CompactionTarget;
  summaryInstructionVersion: string;
}

export interface StoredHistoryCompaction {
  id: string;
  conversationId: string;
  contextScopeId: string | null;
  ownerPipeline: HistoryCompactionPipeline;
  previousCompactionId: string | null;
  sourceTurnIds: readonly string[];
  sourceTurnSha256: string;
  summaryText: string;
  summaryAttemptId: string;
  triggerReason: 'numeric_preflight' | 'provider_numeric_overflow';
  target: CompactionTarget;
  generationVariantId: string;
  generationVariantRevision: number;
  summaryInstructionVersion: string;
  createdAt: Date;
  deleteAfter: Date;
}

export interface StartHistorySummaryAttemptInput {
  conversationId: string;
  interactionTurnId: string;
  contextScopeId: string | null;
  ownerPipeline: HistoryCompactionPipeline;
  callIndex: number;
  generationVariantId: string;
  generationVariantRevision: number;
  previousCompactionId: string | null;
  triggerReason: 'numeric_preflight' | 'provider_numeric_overflow';
  summaryInstructionVersion: string;
  sourceTurnIds: readonly string[];
  sourceTurnSha256: string;
  target: CompactionTarget;
  summaryRequestHmacKeyId: string;
  summaryRequestHmacSha256: string;
  startedAt: Date;
}

export interface CompleteHistorySummaryAttemptInput {
  summaryAttemptId: string;
  summaryText: string;
  inputTokens: number | null;
  outputTokens: number | null;
  completedAt: Date;
}

export interface TerminateHistorySummaryAttemptInput {
  summaryAttemptId: string;
  status: 'failed' | 'cancelled';
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  completedAt: Date;
}

interface CompactionRow {
  id: string;
  conversation_id: string;
  context_scope_id: string | null;
  owner_pipeline: HistoryCompactionPipeline;
  previous_compaction_id: string | null;
  source_turn_ids: string[];
  source_turn_sha256: string;
  summary_text: string;
  summary_attempt_id: string;
  trigger_reason: StoredHistoryCompaction['triggerReason'];
  summary_instruction_version: string;
  target_config_digest_version: 1 | 2;
  target_config_digest: string;
  target_model_id: string;
  target_protocol: CompactionTarget['protocol'];
  target_context_window_tokens: number;
  target_max_output_tokens: number | null;
  target_reasoning_effort: CompactionTarget['reasoningEffort'];
  generation_variant_id: string;
  generation_variant_revision: number;
  created_at: Date;
  delete_after: Date;
}

interface AttemptCompletionRow {
  conversation_id: string;
  context_scope_id: string | null;
  owner_pipeline: HistoryCompactionPipeline;
  previous_compaction_id: string | null;
  source_turn_ids: string[];
  source_turn_sha256: string;
  trigger_reason: StoredHistoryCompaction['triggerReason'];
  summary_instruction_version: string;
  target_config_digest_version: 1 | 2;
  target_config_digest: string;
  target_model_id: string;
  target_protocol: CompactionTarget['protocol'];
  target_context_window_tokens: number;
  target_max_output_tokens: number | null;
  target_reasoning_effort: CompactionTarget['reasoningEffort'];
  generation_variant_id: string;
  generation_variant_revision: number;
}

async function transaction<T>(pool: Pool, run: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function mapCompaction(row: CompactionRow): StoredHistoryCompaction {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    contextScopeId: row.context_scope_id,
    ownerPipeline: row.owner_pipeline,
    previousCompactionId: row.previous_compaction_id,
    sourceTurnIds: [...row.source_turn_ids],
    sourceTurnSha256: row.source_turn_sha256,
    summaryText: row.summary_text,
    summaryAttemptId: row.summary_attempt_id,
    triggerReason: row.trigger_reason,
    target: {
      configDigestVersion: row.target_config_digest_version,
      configDigest: row.target_config_digest,
      modelId: row.target_model_id,
      protocol: row.target_protocol,
      contextWindowTokens: row.target_context_window_tokens,
      maxOutputTokens: row.target_max_output_tokens,
      reasoningEffort: row.target_reasoning_effort,
    },
    generationVariantId: row.generation_variant_id,
    generationVariantRevision: row.generation_variant_revision,
    summaryInstructionVersion: row.summary_instruction_version,
    createdAt: row.created_at,
    deleteAfter: row.delete_after,
  };
}

const COMPACTION_COLUMNS = `
  artifact.id::text,
  artifact.conversation_id::text,
  artifact.context_scope_id::text,
  artifact.owner_pipeline,
  artifact.previous_compaction_id::text,
  artifact.source_turn_ids::text[],
  artifact.source_turn_sha256::text,
  artifact.summary_text,
  artifact.summary_attempt_id::text,
  artifact.trigger_reason,
  artifact.summary_instruction_version,
  artifact.target_config_digest_version::integer,
  artifact.target_config_digest::text,
  artifact.target_model_id,
  artifact.target_protocol,
  artifact.target_context_window_tokens,
  artifact.target_max_output_tokens,
  artifact.target_reasoning_effort,
  artifact.generation_variant_id::text,
  artifact.generation_variant_revision,
  artifact.created_at,
  artifact.delete_after`;

export async function findReusableHistoryCompaction(
  pool: Pool,
  key: CompactionReuseKey,
): Promise<StoredHistoryCompaction | null> {
  return transaction(pool, async (client) => {
    const result = await client.query<CompactionRow>(
      `SELECT ${COMPACTION_COLUMNS}
         FROM conversation_history_compactions AS artifact
        WHERE artifact.conversation_id = $1
          AND artifact.context_scope_id IS NOT DISTINCT FROM $2::uuid
          AND artifact.owner_pipeline = $3
          AND artifact.source_turn_ids = $4::uuid[]
          AND artifact.source_turn_sha256 = $5
          AND artifact.summary_instruction_version = $6
          AND artifact.target_config_digest_version = $7
          AND artifact.target_config_digest = $8
          AND artifact.target_model_id = $9
          AND artifact.target_protocol = $10
          AND artifact.target_context_window_tokens = $11
          AND artifact.target_max_output_tokens IS NOT DISTINCT FROM $12::integer
          AND artifact.target_reasoning_effort IS NOT DISTINCT FROM $13::text
          AND artifact.delete_after > clock_timestamp()
        ORDER BY artifact.created_at DESC, artifact.id DESC
        LIMIT 1`,
      [
        key.conversationId,
        key.contextScopeId,
        key.ownerPipeline,
        [...key.sourceTurnIds],
        key.sourceTurnSha256,
        key.summaryInstructionVersion,
        key.target.configDigestVersion,
        key.target.configDigest,
        key.target.modelId,
        key.target.protocol,
        key.target.contextWindowTokens,
        key.target.maxOutputTokens,
        key.target.reasoningEffort,
      ],
    );
    return result.rows[0] ? mapCompaction(result.rows[0]) : null;
  });
}

export async function startHistorySummaryAttempt(
  pool: Pool,
  input: StartHistorySummaryAttemptInput,
): Promise<string> {
  return transaction(pool, async (client) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO chat_history_summary_attempts
        (id, conversation_id, interaction_turn_id, context_scope_id, owner_pipeline,
         call_index, generation_variant_id, generation_variant_revision,
         previous_compaction_id, trigger_reason, summary_instruction_version,
         source_turn_ids, source_turn_sha256, target_config_digest_version,
         target_config_digest, target_model_id, target_protocol,
         target_context_window_tokens, target_max_output_tokens,
         target_reasoning_effort, summary_request_hmac_key_id,
         summary_request_hmac_sha256, status, started_at, delete_after)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::uuid[],$13,$14,$15,$16,$17,
         $18,$19,$20,$21,$22,'started',$23::timestamptz,
         $23::timestamptz + interval '10 days')`,
      [
        id,
        input.conversationId,
        input.interactionTurnId,
        input.contextScopeId,
        input.ownerPipeline,
        input.callIndex,
        input.generationVariantId,
        input.generationVariantRevision,
        input.previousCompactionId,
        input.triggerReason,
        input.summaryInstructionVersion,
        [...input.sourceTurnIds],
        input.sourceTurnSha256,
        input.target.configDigestVersion,
        input.target.configDigest,
        input.target.modelId,
        input.target.protocol,
        input.target.contextWindowTokens,
        input.target.maxOutputTokens,
        input.target.reasoningEffort,
        input.summaryRequestHmacKeyId,
        input.summaryRequestHmacSha256,
        input.startedAt,
      ],
    );
    return id;
  });
}

export async function completeHistorySummaryAttempt(
  pool: Pool,
  input: CompleteHistorySummaryAttemptInput,
): Promise<StoredHistoryCompaction> {
  return transaction(pool, async (client) => {
    const attempt = await client.query<AttemptCompletionRow>(
      `UPDATE chat_history_summary_attempts
          SET status = 'completed',
              error_code = NULL,
              input_tokens = $2,
              output_tokens = $3,
              completed_at = $4
        WHERE id = $1 AND status = 'started'
      RETURNING conversation_id::text, context_scope_id::text, owner_pipeline,
                previous_compaction_id::text, source_turn_ids::text[],
                source_turn_sha256::text, trigger_reason, summary_instruction_version,
                target_config_digest_version::integer, target_config_digest::text,
                target_model_id, target_protocol, target_context_window_tokens,
                target_max_output_tokens, target_reasoning_effort,
                generation_variant_id::text, generation_variant_revision`,
      [
        input.summaryAttemptId,
        input.inputTokens,
        input.outputTokens,
        input.completedAt,
      ],
    );
    const row = attempt.rows[0];
    if (!row) throw new Error('HISTORY_SUMMARY_ATTEMPT_NOT_STARTED');

    const artifactId = randomUUID();
    const inserted = await client.query<CompactionRow>(
      `INSERT INTO conversation_history_compactions AS artifact
        (id, conversation_id, context_scope_id, owner_pipeline,
         previous_compaction_id, source_turn_ids, source_turn_sha256,
         summary_text, summary_attempt_id, trigger_reason,
         summary_instruction_version, target_config_digest_version,
         target_config_digest, target_model_id, target_protocol,
         target_context_window_tokens, target_max_output_tokens,
         target_reasoning_effort, generation_variant_id,
         generation_variant_revision, created_at, delete_after)
       VALUES
        ($1,$2,$3,$4,$5,$6::uuid[],$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
         $18,$19,$20,$21::timestamptz,$21::timestamptz + interval '10 days')
       RETURNING ${COMPACTION_COLUMNS}`,
      [
        artifactId,
        row.conversation_id,
        row.context_scope_id,
        row.owner_pipeline,
        row.previous_compaction_id,
        row.source_turn_ids,
        row.source_turn_sha256,
        input.summaryText,
        input.summaryAttemptId,
        row.trigger_reason,
        row.summary_instruction_version,
        row.target_config_digest_version,
        row.target_config_digest,
        row.target_model_id,
        row.target_protocol,
        row.target_context_window_tokens,
        row.target_max_output_tokens,
        row.target_reasoning_effort,
        row.generation_variant_id,
        row.generation_variant_revision,
        input.completedAt,
      ],
    );
    return mapCompaction(inserted.rows[0]);
  });
}

export async function terminateHistorySummaryAttempt(
  pool: Pool,
  input: TerminateHistorySummaryAttemptInput,
): Promise<void> {
  await transaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE chat_history_summary_attempts
          SET status = $2,
              error_code = $3,
              input_tokens = $4,
              output_tokens = $5,
              completed_at = $6
        WHERE id = $1 AND status = 'started'`,
      [
        input.summaryAttemptId,
        input.status,
        input.errorCode,
        input.inputTokens,
        input.outputTokens,
        input.completedAt,
      ],
    );
    if (result.rowCount !== 1) throw new Error('HISTORY_SUMMARY_ATTEMPT_NOT_STARTED');
  });
}
