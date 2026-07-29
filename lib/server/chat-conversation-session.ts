import type { Pool, PoolClient } from 'pg';

import type { ConversationSessionSnapshot } from '../contracts/chat-turn-plan.ts';
import type { NormalizedChatRequest } from '../contracts/chat-runtime.ts';
import {
  loadAdjacentCompletedContextTurn,
  loadCanonicalAnswerHistory,
  loadCapturedLegacyContextBridge,
  loadContextTaskFrame,
} from './conversation-context-state.ts';
import { decodeTurnMessage } from './turn-codec.ts';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

interface CurrentUserMessageRow {
  content: string;
  id: string;
  role: 'user' | 'assistant';
}

export interface LoadConversationSessionSnapshotInput {
  conversationId: string;
  interactionTurnId: string;
  currentUserMessageId: string;
  request: NormalizedChatRequest;
  pageContext?: Readonly<Record<string, string>> | null;
}

function validatedPageContext(
  input: Readonly<Record<string, string>> | null | undefined,
): Readonly<Record<string, string>> | null {
  if (!input) return null;
  const entries = Object.entries(input);
  for (const [key, value] of entries) {
    if (!/^[a-z][a-z0-9_]{0,31}$/u.test(key)
      || !/^[a-z0-9][a-z0-9/_-]{0,127}$/iu.test(value)) {
      throw new Error('CONVERSATION_SESSION_PAGE_CONTEXT_INVALID');
    }
  }
  return Object.fromEntries(entries);
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

async function loadCurrentUserMessage(
  client: Queryable,
  input: LoadConversationSessionSnapshotInput,
): Promise<string> {
  const result = await client.query<CurrentUserMessageRow>(
    `SELECT message.id::text, message.role, message.content
       FROM interaction_turns AS turn_record
       JOIN conversation_messages AS message
         ON message.conversation_id = turn_record.conversation_id
      WHERE turn_record.id = $1
        AND turn_record.conversation_id = $2
        AND message.id = $3`,
    [input.interactionTurnId, input.conversationId, input.currentUserMessageId],
  );
  const row = result.rows[0];
  if (!row || row.role !== 'user') throw new Error('CONVERSATION_SESSION_CURRENT_MESSAGE_INVALID');
  let decoded: ReturnType<typeof decodeTurnMessage>;
  try {
    decoded = decodeTurnMessage(row.content);
  } catch {
    throw new Error('CONVERSATION_SESSION_CURRENT_MESSAGE_INVALID');
  }
  if (decoded.turnId !== input.interactionTurnId || decoded.content !== input.request.message) {
    throw new Error('CONVERSATION_SESSION_CURRENT_MESSAGE_INVALID');
  }
  return decoded.content;
}

export async function loadConversationSessionSnapshot(
  client: Queryable,
  input: LoadConversationSessionSnapshotInput,
): Promise<ConversationSessionSnapshot> {
  const currentInput = await loadCurrentUserMessage(client, input);
  const currentFrame = await loadContextTaskFrame(client, input.conversationId);
  const adjacentCompletedTurn = await loadAdjacentCompletedContextTurn(
    client,
    input.conversationId,
    input.currentUserMessageId,
  );
  const legacyBridge = await loadCapturedLegacyContextBridge(client, input.conversationId);
  const contextScopeId = currentFrame?.taskId ?? adjacentCompletedTurn?.contextScopeId ?? null;
  const completedHistory = contextScopeId
    ? await loadCanonicalAnswerHistory(client, {
        conversationId: input.conversationId,
        ownerPipeline: 'context_packet_v22',
        contextScopeId,
        includeConversation: false,
      })
    : [];

  return deepFreeze({
    conversationId: input.conversationId,
    interactionTurnId: input.interactionTurnId,
    currentUserMessageId: input.currentUserMessageId,
    currentInput,
    workflow: input.request.workflow ?? 'chat',
    mode: input.request.mode,
    audienceIntent: input.request.audienceIntent,
    pageContext: validatedPageContext(input.pageContext),
    currentFrame,
    adjacentCompletedTurn,
    completedHistory,
    legacyBridge,
  });
}
