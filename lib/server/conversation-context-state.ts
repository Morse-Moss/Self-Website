import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  CONTEXT_PIPELINE_VERSION,
  CONTEXT_SLOT_EXTRACTOR_VERSION,
  type CompletedContextTurn,
  type ContextPacketManifest,
  type ContextEvidenceTopicKind,
  type ContextSubjectKind,
  type ContextTaskKind,
  type ContextWaitingFor,
  type ConversationTaskFrameV22,
  type ResolvedChatTurn,
  type ResolvedTaskSlotRef,
  type TaskSlotRef,
} from '../contracts/chat-context.ts';
import { decodeTurnMessage } from './turn-codec.ts';

export class LegacyBridgeValidationError extends Error {
  readonly code = 'LEGACY_BRIDGE_INVALID';

  constructor() {
    super('LEGACY_BRIDGE_INVALID');
    this.name = 'LegacyBridgeValidationError';
  }
}

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

interface ContextTaskStateRow {
  closed_reason: ConversationTaskFrameV22['closedReason'];
  conversation_id: string;
  created_at: Date;
  evidence_topic_kind: ContextEvidenceTopicKind;
  evidence_topic_ref: string | null;
  last_successful_message_id: string;
  status: ConversationTaskFrameV22['status'];
  subject_kind: ContextSubjectKind;
  subject_ref: string;
  task_id: string;
  task_kind: ContextTaskKind;
  task_started_message_id: string;
  updated_at: Date;
  updated_by_message_id: string;
  version: number;
  waiting_for: ContextWaitingFor[];
}

interface SlotRow {
  content: string;
  content_sha256: string;
  end_utf16: number;
  extractor_version: typeof CONTEXT_SLOT_EXTRACTOR_VERSION;
  ordinal: number;
  role: 'user' | 'assistant';
  slot_kind: TaskSlotRef['slot'];
  source_message_id: string;
  start_utf16: number;
}

interface CompletedTurnRow {
  assistant_content: string;
  assistant_message_id: string;
  completed_at: Date;
  context_scope_id: string;
  conversation_id: string;
  turn_id: string;
  user_content: string;
  user_message_id: string;
}

interface BridgeMessageRow {
  content: string;
  created_at: Date;
  id: string;
  role: 'user' | 'assistant';
}

export interface UpsertContextTaskFrameInput {
  conversationId: string;
  taskId: string;
  taskKind: ContextTaskKind;
  subjectKind: ContextSubjectKind;
  subjectRef: string;
  evidenceFocus: {
    topicKind: ContextEvidenceTopicKind;
    topicRef: string | null;
  };
  status: ConversationTaskFrameV22['status'];
  closedReason: ConversationTaskFrameV22['closedReason'];
  waitingFor: ContextWaitingFor[];
  taskStartedMessageId: string;
  lastSuccessfulMessageId: string;
  updatedByMessageId: string;
  expectedVersion: number;
  slots: readonly (TaskSlotRef | ResolvedTaskSlotRef)[];
  now: Date;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function decodeSlot(row: SlotRow): ResolvedTaskSlotRef {
  if (row.role !== 'user') throw new Error('CONTEXT_SLOT_SOURCE_ROLE_INVALID');
  const decoded = decodeTurnMessage(row.content).content;
  if (row.start_utf16 < 0 || row.end_utf16 > decoded.length || row.end_utf16 <= row.start_utf16) {
    throw new Error('CONTEXT_SLOT_SOURCE_SPAN_INVALID');
  }
  const text = decoded.slice(row.start_utf16, row.end_utf16);
  if (sha256(text) !== row.content_sha256) {
    throw new Error('CONTEXT_SLOT_SOURCE_HASH_MISMATCH');
  }
  return {
    slot: row.slot_kind,
    sourceMessageId: row.source_message_id,
    startUtf16: row.start_utf16,
    endUtf16: row.end_utf16,
    contentSha256: row.content_sha256,
    extractorVersion: row.extractor_version,
    ordinal: row.ordinal,
    text,
  };
}

async function loadAndValidateSlots(
  client: Queryable,
  conversationId: string,
  slots: readonly (TaskSlotRef | ResolvedTaskSlotRef)[],
): Promise<ResolvedTaskSlotRef[]> {
  const resolved: ResolvedTaskSlotRef[] = [];
  for (const slot of slots) {
    if (slot.extractorVersion !== CONTEXT_SLOT_EXTRACTOR_VERSION) {
      throw new Error('CONTEXT_SLOT_EXTRACTOR_UNSUPPORTED');
    }
    const result = await client.query<SlotRow>(
      `SELECT message.id::text AS source_message_id, message.role, message.content,
              $3::text AS slot_kind, $4::smallint AS ordinal,
              $5::integer AS start_utf16, $6::integer AS end_utf16,
              $7::text AS content_sha256, $8::text AS extractor_version
         FROM conversation_messages AS message
        WHERE message.conversation_id = $1 AND message.id = $2`,
      [
        conversationId,
        slot.sourceMessageId,
        slot.slot,
        slot.ordinal,
        slot.startUtf16,
        slot.endUtf16,
        slot.contentSha256,
        slot.extractorVersion,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('CONTEXT_SLOT_SOURCE_MISSING');
    resolved.push(decodeSlot(row));
  }
  return resolved;
}

export async function loadContextTaskFrame(
  client: Queryable,
  conversationId: string,
  options: { forUpdate?: boolean } = {},
): Promise<ConversationTaskFrameV22 | null> {
  const state = await client.query<ContextTaskStateRow>(
    `SELECT conversation_id::text, task_id::text, task_kind, subject_kind,
            subject_ref, evidence_topic_kind, evidence_topic_ref, status,
            closed_reason, waiting_for, task_started_message_id::text,
            last_successful_message_id::text, version,
            updated_by_message_id::text, created_at, updated_at
       FROM conversation_context_task_state
      WHERE conversation_id = $1
      ${options.forUpdate ? 'FOR UPDATE' : ''}`,
    [conversationId],
  );
  const row = state.rows[0];
  if (!row) return null;
  const slots = await client.query<SlotRow>(
    `SELECT slot.slot_kind, slot.ordinal, slot.source_message_id::text,
            slot.start_utf16, slot.end_utf16, slot.content_sha256,
            slot.extractor_version, message.role, message.content
       FROM conversation_context_slot_refs AS slot
       JOIN conversation_messages AS message
         ON message.conversation_id = slot.conversation_id
        AND message.id = slot.source_message_id
      WHERE slot.conversation_id = $1 AND slot.task_id = $2
      ORDER BY CASE slot.slot_kind
        WHEN 'company' THEN 0 WHEN 'role' THEN 1 ELSE 2 END,
        slot.ordinal`,
    [conversationId, row.task_id],
  );
  return {
    conversationId: row.conversation_id,
    taskId: row.task_id,
    taskKind: row.task_kind,
    subjectKind: row.subject_kind,
    subjectRef: row.subject_ref,
    evidenceFocus: {
      topicKind: row.evidence_topic_kind,
      topicRef: row.evidence_topic_ref,
    },
    status: row.status,
    closedReason: row.closed_reason,
    waitingFor: row.waiting_for,
    taskStartedMessageId: row.task_started_message_id,
    lastSuccessfulMessageId: row.last_successful_message_id,
    version: row.version,
    updatedByMessageId: row.updated_by_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    slots: slots.rows.map(decodeSlot),
  };
}

async function validateFrameMessages(
  client: Queryable,
  input: UpsertContextTaskFrameInput,
): Promise<void> {
  const result = await client.query<{ id: string; role: 'user' | 'assistant' }>(
    `SELECT id::text, role
       FROM conversation_messages
      WHERE conversation_id = $1 AND id = ANY($2::bigint[])`,
    [
      input.conversationId,
      [input.taskStartedMessageId, input.lastSuccessfulMessageId, input.updatedByMessageId],
    ],
  );
  const roles = new Map(result.rows.map((row) => [row.id, row.role]));
  if (roles.get(input.taskStartedMessageId) !== 'user'
    || roles.get(input.updatedByMessageId) !== 'user'
    || roles.get(input.lastSuccessfulMessageId) !== 'assistant') {
    throw new Error('CONTEXT_TASK_MESSAGE_ROLE_INVALID');
  }
}

export async function upsertContextTaskFrame(
  client: PoolClient,
  input: UpsertContextTaskFrameInput,
): Promise<number> {
  await validateFrameMessages(client, input);
  const slots = await loadAndValidateSlots(client, input.conversationId, input.slots);
  const existing = await client.query<{ task_id: string; version: number }>(
    `SELECT task_id::text, version
       FROM conversation_context_task_state
      WHERE conversation_id = $1
      FOR UPDATE`,
    [input.conversationId],
  );
  const current = existing.rows[0];
  if ((!current && input.expectedVersion !== 0)
    || (current && current.version !== input.expectedVersion)) return 0;

  if (current) {
    await client.query(
      `DELETE FROM conversation_context_slot_refs WHERE conversation_id = $1`,
      [input.conversationId],
    );
    await client.query(
      `UPDATE conversation_context_task_state
          SET task_id = $2, task_kind = $3, subject_kind = $4, subject_ref = $5,
              evidence_topic_kind = $6, evidence_topic_ref = $7, status = $8,
              closed_reason = $9, waiting_for = $10,
              task_started_message_id = $11, last_successful_message_id = $12,
              version = version + 1, updated_by_message_id = $13, updated_at = $14,
              created_at = CASE WHEN task_id = $2 THEN created_at ELSE $14 END
        WHERE conversation_id = $1`,
      [
        input.conversationId, input.taskId, input.taskKind, input.subjectKind,
        input.subjectRef, input.evidenceFocus.topicKind, input.evidenceFocus.topicRef,
        input.status, input.closedReason, input.waitingFor,
        input.taskStartedMessageId, input.lastSuccessfulMessageId,
        input.updatedByMessageId, input.now,
      ],
    );
  } else {
    await client.query(
      `INSERT INTO conversation_context_task_state
        (conversation_id, task_id, task_kind, subject_kind, subject_ref,
         evidence_topic_kind, evidence_topic_ref, status, closed_reason,
         waiting_for, task_started_message_id, last_successful_message_id,
         version, updated_by_message_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,$14)`,
      [
        input.conversationId, input.taskId, input.taskKind, input.subjectKind,
        input.subjectRef, input.evidenceFocus.topicKind, input.evidenceFocus.topicRef,
        input.status, input.closedReason, input.waitingFor,
        input.taskStartedMessageId, input.lastSuccessfulMessageId,
        input.updatedByMessageId, input.now,
      ],
    );
  }

  for (const slot of slots) {
    await client.query(
      `INSERT INTO conversation_context_slot_refs
        (conversation_id, task_id, slot_kind, ordinal, source_message_id,
         start_utf16, end_utf16, content_sha256, extractor_version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.conversationId, input.taskId, slot.slot, slot.ordinal,
        slot.sourceMessageId, slot.startUtf16, slot.endUtf16,
        slot.contentSha256, slot.extractorVersion, input.now,
      ],
    );
  }
  return 1;
}

function toCompletedContextTurn(row: CompletedTurnRow): CompletedContextTurn {
  const user = decodeTurnMessage(row.user_content);
  const assistant = decodeTurnMessage(row.assistant_content);
  if (user.turnId !== row.turn_id || assistant.turnId !== row.turn_id) {
    throw new Error('CONTEXT_COMPLETED_MESSAGE_TURN_MISMATCH');
  }
  return {
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    contextScopeId: row.context_scope_id,
    user: { id: row.user_message_id, role: 'user', text: user.content },
    assistant: { id: row.assistant_message_id, role: 'assistant', text: assistant.content },
    completedAt: row.completed_at,
  };
}

export async function insertCompletedContextTurn(
  client: Queryable,
  input: {
    conversationId: string;
    turnId: string;
    contextScopeId: string;
    userMessageId: string;
    assistantMessageId: string;
    completedAt: Date;
  },
): Promise<void> {
  const messages = await client.query<{
    content: string;
    id: string;
    role: 'user' | 'assistant';
  }>(
    `SELECT id::text, role, content
       FROM conversation_messages
      WHERE conversation_id = $1 AND id = ANY($2::bigint[])`,
    [input.conversationId, [input.userMessageId, input.assistantMessageId]],
  );
  const user = messages.rows.find((message) => message.id === input.userMessageId);
  const assistant = messages.rows.find((message) => message.id === input.assistantMessageId);
  if (user?.role !== 'user' || assistant?.role !== 'assistant') {
    throw new Error('CONTEXT_COMPLETED_MESSAGE_ROLE_INVALID');
  }
  if (decodeTurnMessage(user.content).turnId !== input.turnId
    || decodeTurnMessage(assistant.content).turnId !== input.turnId) {
    throw new Error('CONTEXT_COMPLETED_MESSAGE_TURN_MISMATCH');
  }
  await client.query(
    `INSERT INTO conversation_context_completed_turns
      (conversation_id, turn_id, context_scope_id, user_message_id,
       assistant_message_id, pipeline_version, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.conversationId, input.turnId, input.contextScopeId,
      input.userMessageId, input.assistantMessageId,
      CONTEXT_PIPELINE_VERSION, input.completedAt,
    ],
  );
}

const completedTurnSelection = `
  SELECT completed.conversation_id::text, completed.turn_id::text,
         completed.context_scope_id::text, completed.user_message_id::text,
         completed.assistant_message_id::text, completed.completed_at,
         user_message.content AS user_content,
         assistant_message.content AS assistant_content
    FROM conversation_context_completed_turns AS completed
    JOIN conversation_messages AS user_message
      ON user_message.conversation_id = completed.conversation_id
     AND user_message.id = completed.user_message_id
     AND user_message.role = 'user'
    JOIN conversation_messages AS assistant_message
      ON assistant_message.conversation_id = completed.conversation_id
     AND assistant_message.id = completed.assistant_message_id
     AND assistant_message.role = 'assistant'`;

export async function loadAdjacentCompletedContextTurn(
  client: Queryable,
  conversationId: string,
): Promise<CompletedContextTurn | null> {
  const result = await client.query<CompletedTurnRow>(
    `${completedTurnSelection}
      WHERE completed.conversation_id = $1
      ORDER BY completed.completed_at DESC, completed.turn_id DESC
      LIMIT 1`,
    [conversationId],
  );
  return result.rows[0] ? toCompletedContextTurn(result.rows[0]) : null;
}

function estimateTokens(value: string): number {
  const cjk = value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const other = value.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, '').length;
  return Math.max(1, cjk + Math.ceil(other / 4));
}

export async function loadCompletedContextHistory(
  client: Queryable,
  conversationId: string,
  contextScopeId: string,
  options: { tokenBudget: number },
): Promise<CompletedContextTurn[]> {
  const result = await client.query<CompletedTurnRow>(
    `${completedTurnSelection}
      WHERE completed.conversation_id = $1
        AND completed.context_scope_id = $2
      ORDER BY completed.completed_at, completed.turn_id`,
    [conversationId, contextScopeId],
  );
  const turns = result.rows.map(toCompletedContextTurn);
  const selected: CompletedContextTurn[] = [];
  let used = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const size = estimateTokens(turn.user.text) + estimateTokens(turn.assistant.text);
    if (selected.length > 0 && used + size > options.tokenBudget) break;
    selected.push(turn);
    used += size;
  }
  return selected.reverse();
}

function bridgeTurnFromRows(input: {
  conversationId: string;
  turnId: string;
  messages: BridgeMessageRow[];
}): CompletedContextTurn {
  if (input.messages.length !== 2) throw new LegacyBridgeValidationError();
  const user = input.messages.find((message) => message.role === 'user');
  const assistant = input.messages.find((message) => message.role === 'assistant');
  if (!user || !assistant) throw new LegacyBridgeValidationError();
  const decodedUser = decodeTurnMessage(user.content);
  const decodedAssistant = decodeTurnMessage(assistant.content);
  if (decodedUser.turnId !== input.turnId || decodedAssistant.turnId !== input.turnId) {
    throw new LegacyBridgeValidationError();
  }
  return {
    conversationId: input.conversationId,
    turnId: input.turnId,
    contextScopeId: input.turnId,
    user: { id: user.id, role: 'user', text: decodedUser.content },
    assistant: { id: assistant.id, role: 'assistant', text: decodedAssistant.content },
    completedAt: assistant.created_at,
  };
}

export async function loadCapturedLegacyContextBridge(
  client: Queryable,
  conversationId: string,
): Promise<CompletedContextTurn[]> {
  const result = await client.query<{
    assistant_content: string;
    completed_at: Date;
    assistant_message_id: string;
    captured_at: Date;
    legacy_turn_id: string;
    user_content: string;
    user_message_id: string;
  }>(
    `SELECT bridge.legacy_turn_id::text,
            bridge.user_message_id::text, bridge.assistant_message_id::text,
            assistant_message.created_at AS completed_at,
            user_message.content AS user_content,
            assistant_message.content AS assistant_content
       FROM conversation_context_legacy_bridge_turns AS bridge
       JOIN conversation_messages AS user_message
         ON user_message.conversation_id = bridge.conversation_id
        AND user_message.id = bridge.user_message_id
        AND user_message.role = 'user'
       JOIN conversation_messages AS assistant_message
         ON assistant_message.conversation_id = bridge.conversation_id
        AND assistant_message.id = bridge.assistant_message_id
        AND assistant_message.role = 'assistant'
      WHERE bridge.conversation_id = $1 AND bridge.status = 'captured'
      ORDER BY bridge.ordinal`,
    [conversationId],
  );
  return result.rows.map((row) => bridgeTurnFromRows({
    conversationId,
      turnId: row.legacy_turn_id,
      messages: [
        { id: row.user_message_id, role: 'user', content: row.user_content, created_at: row.completed_at },
        { id: row.assistant_message_id, role: 'assistant', content: row.assistant_content, created_at: row.completed_at },
    ],
  }));
}

export async function captureLegacyContextBridge(
  client: PoolClient,
  input: {
    conversationId: string;
    beforeMessageId: string;
    capturedAt: Date;
  },
): Promise<CompletedContextTurn[]> {
  const locked = await client.query(
    `SELECT id FROM conversations WHERE id = $1 FOR UPDATE`,
    [input.conversationId],
  );
  if (locked.rowCount !== 1) throw new Error('LEGACY_BRIDGE_CONVERSATION_MISSING');
  const completed = await client.query(
    `SELECT 1 FROM conversation_context_completed_turns
      WHERE conversation_id = $1 LIMIT 1`,
    [input.conversationId],
  );
  if ((completed.rowCount ?? 0) > 0) return [];
  const existing = await loadCapturedLegacyContextBridge(client, input.conversationId);
  if (existing.length > 0) return existing;

  const messages = await client.query<BridgeMessageRow>(
    `SELECT message.id::text, message.role, message.content, message.created_at
       FROM conversation_messages AS message
      WHERE message.conversation_id = $1 AND message.id < $2
      ORDER BY message.id DESC
      LIMIT 32`,
    [input.conversationId, input.beforeMessageId],
  );
  const groups = new Map<string, BridgeMessageRow[]>();
  const order: string[] = [];
  for (const message of messages.rows) {
    const turnId = decodeTurnMessage(message.content).turnId;
    if (!turnId) throw new LegacyBridgeValidationError();
    if (!groups.has(turnId)) order.push(turnId);
    groups.set(turnId, [...(groups.get(turnId) ?? []), message]);
  }

  const candidates: CompletedContextTurn[] = [];
  for (const turnId of order) {
    if (candidates.length >= 6) break;
    const group = groups.get(turnId) ?? [];
    const status = await client.query<{ execution_pipeline: string | null; status: string }>(
      `SELECT status, execution_pipeline FROM interaction_turns WHERE id = $1`,
      [turnId],
    );
    const interaction = status.rows[0];
    if (interaction && (
      interaction.status !== 'completed'
      || interaction.execution_pipeline === 'context_packet_v22'
    )) {
      throw new LegacyBridgeValidationError();
    }
    candidates.push(bridgeTurnFromRows({
      conversationId: input.conversationId,
      turnId,
      messages: group,
    }));
  }

  for (const [ordinal, turn] of candidates.entries()) {
    await client.query(
      `INSERT INTO conversation_context_legacy_bridge_turns
        (conversation_id, ordinal, legacy_turn_id, user_message_id,
         assistant_message_id, captured_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        input.conversationId, ordinal, turn.turnId,
        turn.user.id, turn.assistant.id, input.capturedAt,
      ],
    );
  }
  return candidates;
}

export async function resolveLegacyContextBridge(
  client: Queryable,
  input: {
    conversationId: string;
    status: 'consumed' | 'invalidated';
    resolvedByTurnId: string;
    resolvedAt: Date;
  },
): Promise<number> {
  const result = await client.query(
    `UPDATE conversation_context_legacy_bridge_turns
        SET status = $2, resolved_by_turn_id = $3, resolved_at = $4
      WHERE conversation_id = $1 AND status = 'captured'`,
    [input.conversationId, input.status, input.resolvedByTurnId, input.resolvedAt],
  );
  return result.rowCount ?? 0;
}

export async function persistContextTerminalManifest(
  client: Queryable,
  input: {
    interactionTurnId: string;
    conversationId: string;
    contextScopeId: string | null;
    resolved: ResolvedChatTurn | null;
    manifest: ContextPacketManifest;
  },
): Promise<void> {
  const semanticIntent = input.resolved?.semantic.intent ?? input.manifest.semantic_intent;
  const discourseAction = input.resolved?.semantic.discourseAction
    ?? input.manifest.discourse_action;
  const taskAction = input.resolved?.semantic.taskAction ?? input.manifest.task_action;
  const result = await client.query(
    `UPDATE interaction_turns
        SET execution_pipeline = 'context_packet_v22',
            semantic_intent = $3,
            discourse_action = $4,
            task_action = $5,
            task_id = $6,
            context_scope_id = $6,
            context_manifest = $7::jsonb
      WHERE id = $1 AND conversation_id = $2`,
    [
      input.interactionTurnId,
      input.conversationId,
      semanticIntent,
      discourseAction,
      taskAction,
      input.contextScopeId,
      JSON.stringify(input.manifest),
    ],
  );
  if (result.rowCount !== 1) throw new Error('CONTEXT_INTERACTION_MISSING');
}

export async function persistContextSuccessState(
  client: PoolClient,
  input: {
    interactionTurnId: string;
    conversationId: string;
    contextScopeId: string;
    userMessageId: string;
    assistantMessageId: string;
    resolved: ResolvedChatTurn;
    frame: UpsertContextTaskFrameInput | null;
    manifest: ContextPacketManifest;
    completedAt: Date;
    bridgeResolution?: 'consumed' | 'invalidated' | null;
  },
): Promise<void> {
  await persistContextTerminalManifest(client, {
    interactionTurnId: input.interactionTurnId,
    conversationId: input.conversationId,
    contextScopeId: input.contextScopeId,
    resolved: input.resolved,
    manifest: input.manifest,
  });
  if (input.frame) {
    const applied = await upsertContextTaskFrame(client, input.frame);
    if (applied !== 1) throw new Error('CONTEXT_TASK_VERSION_CONFLICT');
  }
  await insertCompletedContextTurn(client, {
    conversationId: input.conversationId,
    turnId: input.interactionTurnId,
    contextScopeId: input.contextScopeId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    completedAt: input.completedAt,
  });
  if (input.bridgeResolution) {
    await resolveLegacyContextBridge(client, {
      conversationId: input.conversationId,
      status: input.bridgeResolution,
      resolvedByTurnId: input.interactionTurnId,
      resolvedAt: input.completedAt,
    });
  }
  const assignment = await client.query(
    `UPDATE conversations
        SET context_pipeline_assignment = 'context_packet_v22'
      WHERE id = $1
        AND context_pipeline_assignment IN ('legacy', 'context_packet_v22')`,
    [input.conversationId],
  );
  if (assignment.rowCount !== 1) throw new Error('CONTEXT_PIPELINE_LOCKED');
}

export async function lockContextPipelineAfterLegacySuccess(
  client: PoolClient,
  input: {
    conversationId: string;
    userMessageId: string;
    interactionTurnId: string;
    completedAt: Date;
  },
): Promise<boolean> {
  const assignment = await client.query(
    `UPDATE conversations
        SET context_pipeline_assignment = 'legacy_locked_after_v22'
      WHERE id = $1 AND context_pipeline_assignment = 'context_packet_v22'`,
    [input.conversationId],
  );
  if (assignment.rowCount === 0) return false;

  await client.query(
    `UPDATE conversation_context_task_state
        SET status = 'completed',
            closed_reason = 'pipeline_rollback',
            waiting_for = '{}',
            updated_by_message_id = $2,
            version = version + 1,
            updated_at = $3
      WHERE conversation_id = $1`,
    [input.conversationId, input.userMessageId, input.completedAt],
  );
  await resolveLegacyContextBridge(client, {
    conversationId: input.conversationId,
    status: 'invalidated',
    resolvedByTurnId: input.interactionTurnId,
    resolvedAt: input.completedAt,
  });
  return true;
}
