import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type {
  ChatAudienceIntent,
  ChatMode,
  ChatServiceErrorCode,
  ChatWorkflow,
} from '../contracts/chat.ts';
import type {
  ContextExecutionPipeline,
  ContextPipelineAssignment,
} from '../contracts/chat-context.ts';
import type { AiMessage } from './ai-provider.ts';
import type { ChatBehavior } from './chat-behavior.ts';
import type { NormalizedChatRequest } from './chat-core.ts';
import {
  captureLegacyContextBridge,
  LegacyBridgeValidationError,
} from './conversation-context-state.ts';
import {
  insertRunningInteraction,
  loadInteraction,
  loadInteractionForUpdate,
  restartInteraction,
  type InteractionTurn,
} from './interaction-log.ts';
import { runPoolTransaction } from './transaction-runner.ts';
import { decodeTurnMessage, encodeTurnMessage } from './turn-codec.ts';
import {
  DIAGNOSIS_FIELD_NAMES,
  getDiagnosisCollectionStatus,
  normalizeDiagnosisFields,
  transitionDiagnosisStatus,
  type DiagnosisFields,
  type DiagnosisStatus,
} from './workflows/diagnosis.ts';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface TurnDiagnosis {
  id: string;
  fields: DiagnosisFields;
  status: DiagnosisStatus;
  existing: boolean;
}

export interface TurnContext {
  conversationId: string;
  userMessageId: string | null;
  turnId: string;
  messages: AiMessage[];
  replay: InteractionTurn | null;
  createdConversation: boolean;
  searchCount: number;
  searchAlreadyClaimed: boolean;
  diagnosis: TurnDiagnosis | null;
  behavior: ChatBehavior;
  contextAssignment: ContextPipelineAssignment;
  executionPipeline: ContextExecutionPipeline;
  contextTaskId: string | null;
  legacyBridgeCaptureStatus?: 'not_eligible' | 'invalid';
}

interface TurnReservationConfig {
  maxMessagesPerSession: number;
  chatWindowSeconds?: number;
  chatWindowMaxMessages?: number;
  interactionRetentionDays: number;
  contextPacketDigest?: unknown;
}

interface ReserveTurnInput {
  pool: Pool;
  client: PoolClient;
  accessSessionId: string;
  request: NormalizedChatRequest;
  turnId: string;
  config: TurnReservationConfig;
  now: Date;
  createError(code: ChatServiceErrorCode): Error;
}

interface SessionLockRow {
  expires_at: Date;
  message_count: number;
  search_count: number;
  invite_code_id: string;
  invite_label: string;
  chat_behavior_version: 'v1' | 'v2' | null;
}

interface ConversationRow {
  mode: ChatMode;
  workflow: ChatWorkflow;
  audience_intent: ChatAudienceIntent;
  context_pipeline_assignment: ContextPipelineAssignment;
}

interface ConversationMessageRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface DiagnosisRow {
  id: string;
  fields: unknown;
  status: DiagnosisStatus;
}

function requestWorkflow(request: NormalizedChatRequest): ChatWorkflow {
  return request.workflow ?? 'chat';
}

function selectExecutionPipeline(config: TurnReservationConfig): ContextExecutionPipeline {
  if (!config.contextPacketDigest) {
    throw new Error('CONTEXT_PACKET_DIGEST_CONFIG_INVALID');
  }
  return 'context_packet_v22';
}

function validateInteraction(
  interaction: InteractionTurn,
  accessSessionId: string,
  request: NormalizedChatRequest,
  createError: ReserveTurnInput['createError'],
): void {
  if (
    interaction.accessSessionId !== accessSessionId
    || interaction.workflow !== requestWorkflow(request)
    || interaction.question !== request.message
    || (request.conversationId !== null
      && request.conversationId !== interaction.conversationId)
  ) {
    throw createError('CONVERSATION_INVALID');
  }
}

function validateConversation(
  conversation: ConversationRow,
  request: NormalizedChatRequest,
  createError: ReserveTurnInput['createError'],
): void {
  if (conversation.workflow !== requestWorkflow(request)) {
    throw createError('CONVERSATION_INVALID');
  }
}

async function loadTurnDiagnosis(input: {
  client: PoolClient;
  accessSessionId: string;
  conversationId: string;
  turnId: string;
  request: NormalizedChatRequest;
  createError: ReserveTurnInput['createError'];
}): Promise<TurnDiagnosis | null> {
  if (requestWorkflow(input.request) !== 'diagnosis') return null;
  if (!input.request.diagnosis) throw input.createError('CONVERSATION_INVALID');

  const result = await input.client.query<DiagnosisRow>(
    `SELECT id::text AS id, fields, status
       FROM diagnoses
      WHERE access_session_id = $1
        AND conversation_id = $2
      ORDER BY created_at, id
      LIMIT 2
      FOR UPDATE`,
    [input.accessSessionId, input.conversationId],
  );
  if (result.rows.length > 1) throw input.createError('CONVERSATION_INVALID');

  const existing = result.rows[0];
  const existingFields = existing
    ? normalizeDiagnosisFields(existing.fields)
    : null;
  const fields = existingFields
    ? DIAGNOSIS_FIELD_NAMES.reduce<DiagnosisFields>((merged, field) => {
        merged[field] = input.request.diagnosis![field] || existingFields[field];
        return merged;
      }, { ...existingFields })
    : input.request.diagnosis;
  const status = existing
    ? transitionDiagnosisStatus(existing.status, {
        fields,
        outboxEnqueued: false,
      })
    : getDiagnosisCollectionStatus(fields);

  return {
    id: existing?.id ?? input.turnId,
    fields,
    status,
    existing: Boolean(existing),
  };
}

async function captureLegacyBridgeForTurn(input: {
  client: PoolClient;
  conversationId: string;
  userMessageId: string;
  capturedAt: Date;
  contextAssignment: ContextPipelineAssignment;
  executionPipeline: ContextExecutionPipeline;
}): Promise<NonNullable<TurnContext['legacyBridgeCaptureStatus']>> {
  if (input.executionPipeline !== 'context_packet_v22'
    || input.contextAssignment !== 'legacy') return 'not_eligible';
  try {
    await captureLegacyContextBridge(input.client, {
      conversationId: input.conversationId,
      beforeMessageId: input.userMessageId,
      capturedAt: input.capturedAt,
    });
    return 'not_eligible';
  } catch (error) {
    if (!(error instanceof LegacyBridgeValidationError)) throw error;
    return 'invalid';
  }
}

async function recoverRunningTurn(input: {
  client: PoolClient;
  conversationId: string;
  turnId: string;
  request: NormalizedChatRequest;
  searchCount: number;
  searchAlreadyClaimed: boolean;
  diagnosis: TurnDiagnosis | null;
  behavior: ChatBehavior;
  contextAssignment: ContextPipelineAssignment;
  executionPipeline: ContextExecutionPipeline;
  reservedUserMessageId: string | null;
  contextTaskId: string | null;
  now: Date;
  createError: ReserveTurnInput['createError'];
}): Promise<TurnContext> {
  const result = await input.client.query<ConversationMessageRow>(
    `SELECT id::text AS id, role, content
       FROM conversation_messages
      WHERE conversation_id = $1
      ORDER BY id`,
    [input.conversationId],
  );
  const messages = result.rows.map((message) => ({
    ...message,
    decoded: decodeTurnMessage(message.content),
  }));
  const matchingTurn = messages.filter((message) => message.decoded.turnId === input.turnId);
  const reservedUsers = matchingTurn.filter((message) => (
    message.role === 'user' && message.decoded.content === input.request.message
  ));
  const matchingAssistants = matchingTurn.filter((message) => message.role === 'assistant');
  if (
    matchingTurn.length !== 1
    || reservedUsers.length !== 1
    || matchingAssistants.length !== 0
    || (input.reservedUserMessageId !== null
      && reservedUsers[0].id !== input.reservedUserMessageId)
  ) {
    throw input.createError('CONVERSATION_INVALID');
  }

  const legacyBridgeCaptureStatus = await captureLegacyBridgeForTurn({
    client: input.client,
    conversationId: input.conversationId,
    userMessageId: reservedUsers[0].id,
    capturedAt: input.now,
    contextAssignment: input.contextAssignment,
    executionPipeline: input.executionPipeline,
  });

  return {
    conversationId: input.conversationId,
    userMessageId: reservedUsers[0].id,
    turnId: input.turnId,
    messages: [{ role: 'user', content: input.request.message }],
    replay: null,
    createdConversation: result.rows.length === 1,
    searchCount: input.searchCount,
    searchAlreadyClaimed: input.searchAlreadyClaimed,
    diagnosis: input.diagnosis,
    behavior: input.behavior,
    contextAssignment: input.contextAssignment,
    executionPipeline: input.executionPipeline,
    contextTaskId: input.contextTaskId
      ?? (input.executionPipeline === 'context_packet_v22' ? input.turnId : null),
    legacyBridgeCaptureStatus,
  };
}

async function reserveTurnInTransaction(input: ReserveTurnInput): Promise<TurnContext> {
  const sessionResult = await input.client.query<SessionLockRow>(
    `SELECT session.expires_at, session.message_count, session.search_count,
            session.invite_code_id::text, invite.label AS invite_label,
            session.chat_behavior_version
       FROM access_sessions AS session
       JOIN invite_codes AS invite ON invite.id = session.invite_code_id
      WHERE session.id = $1
        AND session.expires_at > $2
      FOR UPDATE OF session`,
    [input.accessSessionId, input.now],
  );
  const session = sessionResult.rows[0];
  if (!session) throw input.createError('SESSION_INVALID');

  const behavior: ChatBehavior = 'v2';
  const interaction = await loadInteractionForUpdate(input.client, input.turnId);
  let degradedReplay = false;
  if (interaction) {
    validateInteraction(interaction, input.accessSessionId, input.request, input.createError);
    if (
      interaction.status !== 'running'
      && interaction.status !== 'completed'
      && interaction.status !== 'stopped'
      && interaction.status !== 'failed'
    ) {
      throw input.createError('CONVERSATION_INVALID');
    }
    degradedReplay = interaction.status === 'failed'
      && interaction.errorCode === 'SAFE_DEGRADED'
      && interaction.answer !== null;
  }

  if (interaction?.status !== 'completed' && !degradedReplay) {
    const running = await input.client.query<{ id: string }>(
      `SELECT id::text AS id
         FROM interaction_turns
        WHERE access_session_id = $1 AND status = 'running'
        FOR UPDATE`,
      [input.accessSessionId],
    );
    if (running.rows.some((row) => row.id !== input.turnId)) {
      throw input.createError('CONVERSATION_BUSY');
    }
  }

  const conversationId = interaction?.conversationId
    ?? input.request.conversationId
    ?? randomUUID();
  if (!conversationId) throw input.createError('CONVERSATION_INVALID');

  const conversationResult = await input.client.query<ConversationRow>(
    `SELECT mode, workflow, audience_intent, context_pipeline_assignment
       FROM conversations
      WHERE id = $1 AND access_session_id = $2 AND expires_at > $3`,
    [conversationId, input.accessSessionId, input.now],
  );
  const conversation = conversationResult.rows[0];
  const contextAssignment = conversation?.context_pipeline_assignment ?? 'legacy';
  const selectedExecutionPipeline = interaction?.status === 'running'
    && interaction.executionPipeline
    ? interaction.executionPipeline
    : selectExecutionPipeline(input.config);

  if (interaction?.status === 'completed') {
    if (!conversation || interaction.answer === null) {
      throw input.createError('CONVERSATION_INVALID');
    }
    validateConversation(conversation, input.request, input.createError);
    return {
      conversationId,
      userMessageId: null,
      turnId: input.turnId,
      messages: [],
      replay: interaction,
      createdConversation: false,
      searchCount: session.search_count,
      searchAlreadyClaimed: interaction.usedSearch,
      diagnosis: null,
      behavior,
      contextAssignment,
      executionPipeline: interaction.executionPipeline ?? selectedExecutionPipeline,
      contextTaskId: interaction.taskId,
    };
  }

  if (interaction && degradedReplay) {
    if (!conversation) throw input.createError('CONVERSATION_INVALID');
    validateConversation(conversation, input.request, input.createError);
    return {
      conversationId,
      userMessageId: null,
      turnId: input.turnId,
      messages: [],
      replay: interaction,
      createdConversation: false,
      searchCount: session.search_count,
      searchAlreadyClaimed: interaction.usedSearch,
      diagnosis: null,
      behavior,
      contextAssignment,
      executionPipeline: interaction.executionPipeline ?? selectedExecutionPipeline,
      contextTaskId: interaction.taskId,
    };
  }

  if (interaction?.status === 'running') {
    if (!conversation) throw input.createError('CONVERSATION_INVALID');
    validateConversation(conversation, input.request, input.createError);
    const diagnosis = await loadTurnDiagnosis({
      client: input.client,
      accessSessionId: input.accessSessionId,
      conversationId,
      turnId: input.turnId,
      request: input.request,
      createError: input.createError,
    });
    return recoverRunningTurn({
      client: input.client,
      conversationId,
      turnId: input.turnId,
      request: input.request,
      searchCount: session.search_count,
      searchAlreadyClaimed: interaction.usedSearch,
      diagnosis,
      behavior,
      contextAssignment,
      executionPipeline: selectedExecutionPipeline,
      reservedUserMessageId: interaction.reservedUserMessageId,
      contextTaskId: interaction.taskId,
      now: input.now,
      createError: input.createError,
    });
  }

  if (session.message_count >= input.config.maxMessagesPerSession) {
    throw input.createError('MESSAGE_LIMIT');
  }

  const windowSeconds = input.config.chatWindowSeconds ?? 60;
  const windowMaxMessages = input.config.chatWindowMaxMessages ?? 10;
  const windowUsage = await input.client.query<{ window_messages: number }>(
    `SELECT count(*)::int AS window_messages
       FROM conversation_messages AS message
       JOIN conversations AS conversation ON conversation.id = message.conversation_id
      WHERE conversation.access_session_id = $1
        AND message.role = 'user'
        AND message.created_at > $2`,
    [input.accessSessionId, new Date(input.now.getTime() - windowSeconds * 1_000)],
  );
  if ((windowUsage.rows[0]?.window_messages ?? 0) >= windowMaxMessages) {
    throw input.createError('CHAT_RATE_LIMITED');
  }

  let createdConversation = false;
  if (conversation) {
    validateConversation(conversation, input.request, input.createError);
  } else {
    if (input.request.conversationId !== null && !interaction) {
      throw input.createError('CONVERSATION_INVALID');
    }
    await input.client.query(
      `INSERT INTO conversations
        (id, access_session_id, mode, workflow, audience_intent,
         expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [
        conversationId,
        input.accessSessionId,
        input.request.mode,
        requestWorkflow(input.request),
        input.request.audienceIntent,
        session.expires_at,
        input.now,
      ],
    );
    createdConversation = true;
  }

  const diagnosis = await loadTurnDiagnosis({
    client: input.client,
    accessSessionId: input.accessSessionId,
    conversationId,
    turnId: input.turnId,
    request: input.request,
    createError: input.createError,
  });

  const insertedMessage = interaction?.reservedUserMessageId
    ? await input.client.query<{ id: string }>(
        `INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, 'user', $3, $4)
         RETURNING id::text AS id`,
        [
          interaction.reservedUserMessageId,
          conversationId,
          encodeTurnMessage(input.turnId, input.request.message),
          input.now,
        ],
      )
    : await input.client.query<{ id: string }>(
        `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
         VALUES ($1, 'user', $2, $3)
         RETURNING id::text AS id`,
        [conversationId, encodeTurnMessage(input.turnId, input.request.message), input.now],
      );
  const userMessageId = insertedMessage.rows[0].id;
  const contextTaskId = selectedExecutionPipeline === 'context_packet_v22'
    ? interaction?.taskId ?? input.turnId
    : interaction?.taskId ?? null;

  await input.client.query(
    `UPDATE access_sessions
        SET message_count = message_count + 1, last_seen_at = $2
      WHERE id = $1`,
    [input.accessSessionId, input.now],
  );
  await input.client.query(
    'UPDATE conversations SET updated_at = $2 WHERE id = $1',
    [conversationId, input.now],
  );

  if (interaction) {
    await restartInteraction({
      client: input.client,
      turnId: input.turnId,
      executionPipeline: selectedExecutionPipeline,
      taskId: contextTaskId,
      reservedUserMessageId: userMessageId,
    });
  } else {
    const deleteAfter = new Date(
      input.now.getTime() + input.config.interactionRetentionDays * MILLISECONDS_PER_DAY,
    );
    await insertRunningInteraction({
      client: input.client,
      turnId: input.turnId,
      accessSessionId: input.accessSessionId,
      inviteLabel: session.invite_label,
      conversationId,
      workflow: requestWorkflow(input.request),
      audienceIntent: input.request.audienceIntent,
      question: input.request.message,
      executionPipeline: selectedExecutionPipeline,
      taskId: contextTaskId,
      reservedUserMessageId: userMessageId,
      now: input.now,
      deleteAfter,
    });
  }

  const legacyBridgeCaptureStatus = await captureLegacyBridgeForTurn({
    client: input.client,
    conversationId,
    userMessageId,
    capturedAt: input.now,
    contextAssignment,
    executionPipeline: selectedExecutionPipeline,
  });

  return {
    conversationId,
    userMessageId,
    turnId: input.turnId,
    messages: [{ role: 'user', content: input.request.message }],
    replay: null,
    createdConversation,
    searchCount: session.search_count,
    searchAlreadyClaimed: interaction?.usedSearch ?? false,
    diagnosis,
    behavior,
    contextAssignment,
    executionPipeline: selectedExecutionPipeline,
    contextTaskId,
    legacyBridgeCaptureStatus,
  };
}

export async function reserveTurn(input: ReserveTurnInput): Promise<TurnContext> {
  let turn: TurnContext | null = null;
  return runPoolTransaction<TurnContext>({
    client: input.client,
    work: async () => {
      turn = await reserveTurnInTransaction(input);
      return turn;
    },
    recoverAfterCommit: async () => {
      if (turn) {
        const durable = await loadInteraction(input.pool, input.turnId).catch(() => null);
        const expectedStatus = turn.replay?.status ?? 'running';
        if (durable?.status === expectedStatus) {
          validateInteraction(
            durable,
            input.accessSessionId,
            input.request,
            input.createError,
          );
          return { recovered: true, result: turn };
        }
      }
      return { recovered: false };
    },
  });
}
