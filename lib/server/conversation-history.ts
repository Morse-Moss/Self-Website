import type { Pool } from 'pg';

import { decodeTurnMessage, type TurnSource } from './turn-codec.ts';

export interface ConversationHistoryMessage {
  role: 'user' | 'assistant';
  turnId: string | null;
  text: string;
  sources: TurnSource[];
}

export interface ConversationHistory {
  conversationId: string;
  workflow: 'chat' | 'jd_match' | 'diagnosis';
  audienceIntent: string;
  messages: ConversationHistoryMessage[];
}

interface ConversationRow {
  id: string;
  workflow: ConversationHistory['workflow'];
  audience_intent: string;
}

export async function loadConversationHistory(input: {
  pool: Pool;
  accessSessionId: string;
  conversationId?: string;
  now?: Date;
}): Promise<ConversationHistory | null> {
  const now = input.now ?? new Date();
  const values: unknown[] = [input.accessSessionId, now];
  const requestedConversation = input.conversationId
    ? 'AND id = $3'
    : '';
  if (input.conversationId) values.push(input.conversationId);

  const conversations = await input.pool.query<ConversationRow>(
    `SELECT id::text, workflow, audience_intent
       FROM conversations
      WHERE access_session_id = $1
        AND expires_at > $2
        ${requestedConversation}
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    values,
  );
  const conversation = conversations.rows[0];
  if (!conversation) return null;

  const messages = await input.pool.query<{
    role: 'user' | 'assistant';
    content: string;
  }>(
    `SELECT role, content
       FROM conversation_messages
      WHERE conversation_id = $1
      ORDER BY id`,
    [conversation.id],
  );

  return {
    conversationId: conversation.id,
    workflow: conversation.workflow,
    audienceIntent: conversation.audience_intent,
    messages: messages.rows.map((message) => {
      const decoded = decodeTurnMessage(message.content);
      return {
        role: message.role,
        turnId: decoded.turnId,
        text: decoded.content,
        sources: message.role === 'assistant' ? decoded.sources ?? [] : [],
      };
    }),
  };
}
