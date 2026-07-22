import type { Pool, PoolClient } from 'pg';

import type {
  ChatAudienceIntent,
  ChatRouteKind,
  ChatSource,
  ChatTopicKind,
  ChatWorkflow,
} from '../contracts/chat.ts';
import type { TokenUsage } from './budget.ts';
import type { ProviderAttempt, ProviderWinner } from './ai-provider.ts';
import { sanitizeTurnSources } from './turn-codec.ts';
import {
  CLARIFY_REPLY,
  JD_INTAKE_REPLY,
  type ChatRouteDecision,
  type RouteAnchor,
} from './chat-route-policy.ts';
import { chatCapabilityPolicy, projectSlugs } from '../site-content.ts';

export type InteractionStatus = 'running' | 'completed' | 'stopped' | 'failed';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

const routeKinds = new Set<ChatRouteKind>([
  'conversation', 'external_current', 'identity', 'personal_fact',
  'grounded', 'jd_intake', 'jd', 'clarify',
]);
const topicKinds = new Set<ChatTopicKind>([
  'none', 'external', 'project', 'capability', 'jd',
]);
const capabilityIds = new Set(chatCapabilityPolicy.canonical.map((entry) => entry.id));
const publicProjectSlugs = new Set<string>(projectSlugs);

function validateTopicRef(decision: ChatRouteDecision): void {
  const valid = decision.topicKind === 'none' || decision.topicKind === 'external'
    ? decision.topicRef === null
    : decision.topicKind === 'jd'
      ? decision.topicRef === 'jd'
      : decision.topicKind === 'project'
        ? decision.topicRef === null || publicProjectSlugs.has(decision.topicRef)
        : decision.topicRef !== null && capabilityIds.has(decision.topicRef);
  if (!valid) throw new TypeError('Interaction route topicRef is not a controlled identifier.');
}

export async function loadPreviousRouteAnchor(
  client: Queryable,
  conversationId: string,
  currentTurnId: string,
): Promise<RouteAnchor | null> {
  const result = await client.query<{
    id: string;
    inherited_from_turn_id: string | null;
    route_kind: string | null;
    topic_kind: string | null;
    topic_ref: string | null;
  }>(
    `SELECT previous.id::text, previous.route_kind, previous.topic_kind,
            previous.topic_ref, previous.inherited_from_turn_id::text
       FROM interaction_turns AS current
       JOIN LATERAL (
         SELECT id, route_kind, topic_kind, topic_ref, inherited_from_turn_id
           FROM interaction_turns
          WHERE conversation_id = current.conversation_id
            AND id <> current.id
            AND created_at < current.created_at
          ORDER BY created_at DESC, id DESC
          LIMIT 1
       ) AS previous ON true
      WHERE current.id = $1 AND current.conversation_id = $2`,
    [currentTurnId, conversationId],
  );
  const row = result.rows[0];
  if (
    !row
    || row.inherited_from_turn_id !== null
    || !row.route_kind
    || !routeKinds.has(row.route_kind as ChatRouteKind)
    || !row.topic_kind
    || !topicKinds.has(row.topic_kind as ChatTopicKind)
  ) {
    return null;
  }
  return {
    turnId: row.id,
    routeKind: row.route_kind as ChatRouteKind,
    topicKind: row.topic_kind as ChatTopicKind,
    topicRef: row.topic_ref,
  };
}

export async function loadRecordedInteractionRoute(
  client: Queryable,
  turnId: string,
): Promise<ChatRouteDecision | null> {
  const result = await client.query<{
    evidence_class: ChatRouteDecision['evidenceClass'] | null;
    inherited_from_turn_id: string | null;
    route_kind: ChatRouteDecision['routeKind'] | null;
    route_reason_code: string | null;
    topic_kind: ChatRouteDecision['topicKind'] | null;
    topic_ref: string | null;
  }>(
    `SELECT route_kind, route_reason_code, topic_kind, topic_ref,
            evidence_class, inherited_from_turn_id::text
       FROM interaction_turns
      WHERE id = $1`,
    [turnId],
  );
  const row = result.rows[0];
  if (
    !row?.route_kind
    || !row.route_reason_code
    || !row.topic_kind
    || !row.evidence_class
    || !routeKinds.has(row.route_kind)
    || !topicKinds.has(row.topic_kind)
  ) return null;
  return {
    routeKind: row.route_kind,
    reasonCode: row.route_reason_code,
    topicKind: row.topic_kind,
    topicRef: row.topic_ref,
    evidenceClass: row.evidence_class,
    inheritedFromTurnId: row.inherited_from_turn_id,
    release: row.route_kind === 'jd' || row.route_kind === 'personal_fact'
      ? 'complete'
      : 'segment',
    requiresEmbedding: row.route_kind === 'grounded' || row.route_kind === 'jd',
    requiresSearch: row.route_kind === 'external_current',
    deterministicReply: row.route_kind === 'jd_intake'
      ? JD_INTAKE_REPLY
      : row.route_kind === 'clarify'
        ? CLARIFY_REPLY
        : null,
  };
}

export async function recordInteractionRoute(
  client: Queryable,
  turnId: string,
  route: ChatRouteDecision,
): Promise<void> {
  validateTopicRef(route);
  if (!/^[a-z0-9_]{1,80}$/u.test(route.reasonCode)) {
    throw new TypeError('Interaction route reasonCode must be a stable identifier.');
  }
  const result = await client.query(
    `UPDATE interaction_turns
        SET route_kind = $2,
            route_reason_code = $3,
            topic_kind = $4,
            topic_ref = $5,
            evidence_class = $6,
            inherited_from_turn_id = $7
      WHERE id = $1
        AND (
          route_kind IS NULL
          OR (
            route_kind = $2
            AND route_reason_code = $3
            AND topic_kind = $4
            AND topic_ref IS NOT DISTINCT FROM $5::text
            AND evidence_class = $6
            AND inherited_from_turn_id IS NOT DISTINCT FROM $7::uuid
          )
        )`,
    [
      turnId,
      route.routeKind,
      route.reasonCode,
      route.topicKind,
      route.topicRef,
      route.evidenceClass,
      route.inheritedFromTurnId,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error('Interaction route is missing or already frozen to another decision.');
  }
}

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
  inviteLabel: string;
  conversationId: string;
  workflow: InteractionTurn['workflow'];
  audienceIntent: ChatAudienceIntent;
  question: string;
  now: Date;
  deleteAfter: Date;
}): Promise<void> {
  await input.client.query(
    `INSERT INTO interaction_turns
      (id, access_session_id, invite_label, conversation_id, workflow, audience_intent,
       question, status, created_at, delete_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'running', $8, $9)`,
    [
      input.turnId,
      input.accessSessionId,
      input.inviteLabel,
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
         config_digest, launch_kind, generation_mode, status, error_code,
         first_byte_latency_ms, first_protocol_event_ms, first_model_text_ms,
         first_user_visible_ms, total_latency_ms,
         input_tokens, output_tokens, usage_complete, known_cost_usd, cost_complete,
         created_at, completed_at, delete_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
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
        attempt.launchKind,
        attempt.generationMode,
        attempt.status,
        attempt.errorCode,
        attempt.firstByteLatencyMs,
        attempt.firstProtocolEventMs,
        attempt.firstModelTextMs,
        attempt.firstUserVisibleMs,
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
    first_protocol_event_ms: number | null;
    first_model_text_ms: number | null;
    first_user_visible_ms: number | null;
    generation_mode: ProviderAttempt['generationMode'];
    input_tokens: number | null;
    known_cost_usd: string | null;
    launch_kind: ProviderAttempt['launchKind'];
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
            config_digest, launch_kind, generation_mode, status, error_code,
            first_byte_latency_ms, first_protocol_event_ms, first_model_text_ms,
            first_user_visible_ms, total_latency_ms,
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
      && row.launch_kind === attempt.launchKind
      && row.generation_mode === attempt.generationMode
      && row.status === attempt.status
      && row.error_code === attempt.errorCode
      && row.first_byte_latency_ms === attempt.firstByteLatencyMs
      && row.first_protocol_event_ms === attempt.firstProtocolEventMs
      && row.first_model_text_ms === attempt.firstModelTextMs
      && row.first_user_visible_ms === attempt.firstUserVisibleMs
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
