import type { Pool, PoolClient } from 'pg';

import type {
  ChatAudienceIntent,
  ChatSource,
  ChatWorkflow,
} from '../contracts/chat.ts';
import type { TokenUsage } from './budget.ts';
import type { ProviderAttempt, ProviderWinner } from './ai-provider.ts';
import { sanitizeTurnSources } from './turn-codec.ts';

export type InteractionStatus = 'running' | 'completed' | 'stopped' | 'failed';

export interface InteractionTurn {
  id: string;
  accessSessionId: string;
  conversationId: string | null;
  workflow: ChatWorkflow;
  audienceIntent: ChatAudienceIntent;
  question: string;
  answer: string | null;
  status: string;
  errorCode: string | null;
  sources: ChatSource[];
  usedSearch: boolean;
}

interface InteractionRow {
  id: string;
  access_session_id: string;
  conversation_id: string | null;
  workflow: InteractionTurn['workflow'];
  audience_intent: ChatAudienceIntent;
  question: string;
  answer: string | null;
  status: string;
  error_code: string | null;
  knowledge_sources: unknown;
  used_search: boolean;
}

function toInteraction(row: InteractionRow): InteractionTurn {
  return {
    id: row.id,
    accessSessionId: row.access_session_id,
    conversationId: row.conversation_id,
    workflow: row.workflow,
    audienceIntent: row.audience_intent,
    question: row.question,
    answer: row.answer,
    status: row.status,
    errorCode: row.error_code,
    sources: sanitizeTurnSources(row.knowledge_sources) ?? [],
    usedSearch: row.used_search,
  };
}

const interactionColumns = `id::text, access_session_id::text,
  conversation_id::text, workflow, audience_intent, question, answer,
  status, error_code, knowledge_sources, used_search`;

export async function loadInteractionForUpdate(
  client: PoolClient,
  turnId: string,
): Promise<InteractionTurn | null> {
  const result = await client.query<InteractionRow>(
    `SELECT ${interactionColumns}
       FROM interaction_turns
      WHERE id = $1
      FOR UPDATE`,
    [turnId],
  );
  return result.rows[0] ? toInteraction(result.rows[0]) : null;
}

export async function loadCompletedInteraction(
  pool: Pool,
  turnId: string,
): Promise<InteractionTurn | null> {
  const result = await pool.query<InteractionRow>(
    `SELECT ${interactionColumns}
       FROM interaction_turns
      WHERE id = $1 AND status = 'completed'`,
    [turnId],
  );
  return result.rows[0] ? toInteraction(result.rows[0]) : null;
}

export async function loadInteraction(
  pool: Pool,
  turnId: string,
): Promise<InteractionTurn | null> {
  const result = await pool.query<InteractionRow>(
    `SELECT ${interactionColumns}
       FROM interaction_turns
      WHERE id = $1`,
    [turnId],
  );
  return result.rows[0] ? toInteraction(result.rows[0]) : null;
}

export async function insertRunningInteraction(input: {
  client: PoolClient;
  turnId: string;
  accessSessionId: string;
  conversationId: string;
  workflow: InteractionTurn['workflow'];
  audienceIntent: ChatAudienceIntent;
  question: string;
  now: Date;
  deleteAfter: Date;
}): Promise<void> {
  await input.client.query(
    `INSERT INTO interaction_turns
      (id, access_session_id, conversation_id, workflow, audience_intent,
       question, status, created_at, delete_after)
     VALUES ($1, $2, $3, $4, $5, $6, 'running', $7, $8)`,
    [
      input.turnId,
      input.accessSessionId,
      input.conversationId,
      input.workflow,
      input.audienceIntent,
      input.question,
      input.now,
      input.deleteAfter,
    ],
  );
}

export async function restartInteraction(input: {
  client: PoolClient;
  turnId: string;
}): Promise<void> {
  await input.client.query('DELETE FROM usage_events WHERE interaction_turn_id = $1', [input.turnId]);
  await input.client.query(
    'DELETE FROM interaction_provider_attempts WHERE interaction_turn_id = $1',
    [input.turnId],
  );
  const result = await input.client.query(
    `UPDATE interaction_turns
        SET answer = NULL,
            status = 'running',
            error_code = NULL,
            knowledge_sources = '[]'::jsonb,
            input_tokens = NULL,
            output_tokens = NULL,
            estimated_cost_usd = NULL,
            provider = NULL,
            model = NULL,
            route_revision_id = NULL,
            target_position = NULL,
            provider_protocol = NULL,
            provider_config_digest = NULL,
            known_cost_usd = NULL,
            usage_complete = false,
            cost_complete = false,
            latency_ms = NULL,
            completed_at = NULL
      WHERE id = $1 AND status IN ('stopped', 'failed')`,
    [input.turnId],
  );
  if (result.rowCount !== 1) throw new Error('Interaction turn cannot be restarted.');
}

export async function replaceProviderAttempts(
  client: PoolClient,
  turnId: string,
  attempts: ProviderAttempt[],
): Promise<void> {
  const locked = await client.query(
    'SELECT id FROM interaction_turns WHERE id = $1 FOR UPDATE',
    [turnId],
  );
  if (locked.rowCount !== 1) throw new Error('Interaction turn is missing.');
  await client.query('DELETE FROM usage_events WHERE interaction_turn_id = $1', [turnId]);
  await client.query(
    'DELETE FROM interaction_provider_attempts WHERE interaction_turn_id = $1',
    [turnId],
  );
  for (const attempt of attempts) {
    const deleteAfter = new Date(attempt.startedAt.getTime() + 10 * 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO interaction_provider_attempts
        (interaction_turn_id, attempt_index, route_revision_id, target_position,
         source_type, connection_version_id, model_version_id,
         connection_display_name, model_display_name, model_id, protocol,
         config_digest, status, error_code, first_byte_latency_ms, total_latency_ms,
         input_tokens, output_tokens, usage_complete, known_cost_usd, cost_complete,
         created_at, completed_at, delete_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               $17,$18,$19,$20,$21,$22,$23,$24)`,
      [
        turnId,
        attempt.attemptIndex,
        attempt.routeRevisionId,
        attempt.position,
        attempt.sourceType,
        attempt.connectionVersionId,
        attempt.modelVersionId,
        attempt.connectionDisplayName,
        attempt.modelDisplayName,
        attempt.modelId,
        attempt.protocol,
        attempt.configDigest,
        attempt.status,
        attempt.errorCode,
        attempt.firstByteLatencyMs,
        attempt.totalLatencyMs,
        attempt.usage?.inputTokens ?? null,
        attempt.usage?.outputTokens ?? null,
        attempt.usageComplete,
        attempt.knownCostUsd,
        attempt.costComplete,
        attempt.startedAt,
        attempt.completedAt,
        deleteAfter,
      ],
    );
  }
}

export async function providerAttemptsMatch(
  pool: Pool,
  turnId: string,
  expected: ProviderAttempt[],
): Promise<boolean> {
  const result = await pool.query<{
    attempt_index: number;
    completed_at: Date;
    config_digest: string;
    connection_display_name: string;
    connection_version_id: string | null;
    cost_complete: boolean;
    error_code: string | null;
    first_byte_latency_ms: number | null;
    input_tokens: number | null;
    known_cost_usd: string | null;
    model_display_name: string;
    model_id: string;
    model_version_id: string | null;
    output_tokens: number | null;
    protocol: ProviderAttempt['protocol'];
    route_revision_id: string | null;
    source_type: ProviderAttempt['sourceType'];
    started_at: Date;
    status: ProviderAttempt['status'];
    target_position: number;
    total_latency_ms: number;
    usage_complete: boolean;
  }>(
    `SELECT attempt_index, route_revision_id::text, target_position, source_type,
            connection_version_id::text, model_version_id::text,
            connection_display_name, model_display_name, model_id, protocol,
            config_digest, status, error_code, first_byte_latency_ms, total_latency_ms,
            input_tokens, output_tokens, usage_complete, known_cost_usd::text,
            cost_complete, created_at AS started_at, completed_at
       FROM interaction_provider_attempts
      WHERE interaction_turn_id = $1
      ORDER BY attempt_index`,
    [turnId],
  );
  if (result.rows.length !== expected.length) return false;
  return result.rows.every((row, index) => {
    const attempt = expected[index];
    const expectedCost = attempt.knownCostUsd === null
      ? null
      : Number(attempt.knownCostUsd.toFixed(6));
    const actualCost = row.known_cost_usd === null ? null : Number(row.known_cost_usd);
    return row.attempt_index === attempt.attemptIndex
      && row.route_revision_id === attempt.routeRevisionId
      && row.target_position === attempt.position
      && row.source_type === attempt.sourceType
      && row.connection_version_id === attempt.connectionVersionId
      && row.model_version_id === attempt.modelVersionId
      && row.connection_display_name === attempt.connectionDisplayName
      && row.model_display_name === attempt.modelDisplayName
      && row.model_id === attempt.modelId
      && row.protocol === attempt.protocol
      && row.config_digest === attempt.configDigest
      && row.status === attempt.status
      && row.error_code === attempt.errorCode
      && row.first_byte_latency_ms === attempt.firstByteLatencyMs
      && row.total_latency_ms === attempt.totalLatencyMs
      && row.input_tokens === (attempt.usage?.inputTokens ?? null)
      && row.output_tokens === (attempt.usage?.outputTokens ?? null)
      && row.usage_complete === attempt.usageComplete
      && actualCost === expectedCost
      && row.cost_complete === attempt.costComplete
      && row.started_at.getTime() === attempt.startedAt.getTime()
      && row.completed_at.getTime() === attempt.completedAt.getTime();
  });
}

export async function completeInteraction(input: {
  client: PoolClient;
  turnId: string;
  answer: string;
  sources: ChatSource[];
  usage: TokenUsage | null;
  estimatedCostUsd: number | null;
  knownCostUsd?: number | null;
  usageComplete?: boolean;
  costComplete?: boolean;
  winner?: ProviderWinner | null;
  provider: string;
  model: string;
  latencyMs: number;
  completedAt: Date;
}): Promise<void> {
  const result = await input.client.query(
    `UPDATE interaction_turns
        SET answer = $2,
            status = 'completed',
            error_code = NULL,
            knowledge_sources = $3::jsonb,
            input_tokens = $4,
            output_tokens = $5,
            estimated_cost_usd = $6,
            provider = $7,
            model = $8,
            latency_ms = $9,
            completed_at = $10,
            route_revision_id = $11,
            target_position = $12,
            provider_protocol = $13,
            provider_config_digest = $14,
            known_cost_usd = $15,
            usage_complete = $16,
            cost_complete = $17
      WHERE id = $1 AND status = 'running'`,
    [
      input.turnId,
      input.answer,
      JSON.stringify(input.sources),
      input.usage?.inputTokens ?? null,
      input.usage?.outputTokens ?? null,
      input.estimatedCostUsd,
      input.winner?.connectionDisplayName ?? input.provider,
      input.winner?.modelId ?? input.model,
      input.latencyMs,
      input.completedAt,
      input.winner?.routeRevisionId ?? null,
      input.winner?.position ?? null,
      input.winner?.protocol ?? null,
      input.winner?.configDigest ?? null,
      input.knownCostUsd ?? input.estimatedCostUsd,
      input.usageComplete ?? input.usage !== null,
      input.costComplete ?? input.estimatedCostUsd !== null,
    ],
  );
  if (result.rowCount !== 1) throw new Error('Interaction turn is not running.');
}

export async function terminateInteraction(input: {
  client: PoolClient;
  turnId: string;
  status: Exclude<InteractionStatus, 'running' | 'completed'>;
  answer: string | null;
  errorCode: string;
  sources: ChatSource[];
  usage?: TokenUsage | null;
  estimatedCostUsd?: number | null;
  knownCostUsd?: number | null;
  usageComplete?: boolean;
  costComplete?: boolean;
  winner?: ProviderWinner | null;
  latencyMs: number;
  completedAt: Date;
}): Promise<void> {
  const result = await input.client.query(
    `UPDATE interaction_turns
        SET answer = $2,
            status = $3,
            error_code = $4,
            knowledge_sources = $5::jsonb,
            input_tokens = $6,
            output_tokens = $7,
            estimated_cost_usd = $8,
            provider = $9,
            model = $10,
            latency_ms = $11,
            completed_at = $12,
            route_revision_id = $13,
            target_position = $14,
            provider_protocol = $15,
            provider_config_digest = $16,
            known_cost_usd = $17,
            usage_complete = $18,
            cost_complete = $19
      WHERE id = $1 AND status = 'running'`,
    [
      input.turnId,
      input.answer,
      input.status,
      input.errorCode,
      JSON.stringify(input.sources),
      input.usage?.inputTokens ?? null,
      input.usage?.outputTokens ?? null,
      input.estimatedCostUsd ?? null,
      input.winner?.connectionDisplayName ?? null,
      input.winner?.modelId ?? null,
      input.latencyMs,
      input.completedAt,
      input.winner?.routeRevisionId ?? null,
      input.winner?.position ?? null,
      input.winner?.protocol ?? null,
      input.winner?.configDigest ?? null,
      input.knownCostUsd ?? null,
      input.usageComplete ?? false,
      input.costComplete ?? false,
    ],
  );
  if (result.rowCount !== 1) throw new Error('Interaction turn is not running.');
}
