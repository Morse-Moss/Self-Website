import type { Pool, PoolClient } from 'pg';

import type { TokenUsage } from './budget.ts';
import { sanitizeTurnSources, type TurnSource } from './turn-codec.ts';

export type InteractionStatus = 'running' | 'completed' | 'stopped' | 'failed';

export interface InteractionTurn {
  id: string;
  accessSessionId: string;
  conversationId: string | null;
  workflow: 'chat' | 'jd_match' | 'diagnosis';
  audienceIntent: string;
  question: string;
  answer: string | null;
  status: string;
  errorCode: string | null;
  sources: TurnSource[];
  usedSearch: boolean;
}

interface InteractionRow {
  id: string;
  access_session_id: string;
  conversation_id: string | null;
  workflow: InteractionTurn['workflow'];
  audience_intent: string;
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
  audienceIntent: string;
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
            latency_ms = NULL,
            completed_at = NULL
      WHERE id = $1 AND status IN ('stopped', 'failed')`,
    [input.turnId],
  );
  if (result.rowCount !== 1) throw new Error('Interaction turn cannot be restarted.');
}

export async function completeInteraction(input: {
  client: PoolClient;
  turnId: string;
  answer: string;
  sources: TurnSource[];
  usage: TokenUsage | null;
  estimatedCostUsd: number | null;
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
            completed_at = $10
      WHERE id = $1 AND status = 'running'`,
    [
      input.turnId,
      input.answer,
      JSON.stringify(input.sources),
      input.usage?.inputTokens ?? null,
      input.usage?.outputTokens ?? null,
      input.estimatedCostUsd,
      input.provider,
      input.model,
      input.latencyMs,
      input.completedAt,
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
  sources: TurnSource[];
  provider: string;
  model: string;
  latencyMs: number;
  completedAt: Date;
}): Promise<void> {
  const result = await input.client.query(
    `UPDATE interaction_turns
        SET answer = $2,
            status = $3,
            error_code = $4,
            knowledge_sources = $5::jsonb,
            input_tokens = NULL,
            output_tokens = NULL,
            estimated_cost_usd = NULL,
            provider = $6,
            model = $7,
            latency_ms = $8,
            completed_at = $9
      WHERE id = $1 AND status = 'running'`,
    [
      input.turnId,
      input.answer,
      input.status,
      input.errorCode,
      JSON.stringify(input.sources),
      input.provider,
      input.model,
      input.latencyMs,
      input.completedAt,
    ],
  );
  if (result.rowCount !== 1) throw new Error('Interaction turn is not running.');
}
