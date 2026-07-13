import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type { AiMessage, AiProvider } from './ai-provider.ts';
import { classifyBudget, estimateCostUsd, type BudgetLevel, type TokenRates, type TokenUsage } from './budget.ts';
import { buildSystemInstructions, type NormalizedChatRequest } from './chat-core.ts';
import { retrieveKnowledge } from './rag.ts';

export type ChatServiceErrorCode =
  | 'BUDGET_EXHAUSTED'
  | 'SESSION_INVALID'
  | 'MESSAGE_LIMIT'
  | 'CONVERSATION_INVALID'
  | 'CONVERSATION_MODE_MISMATCH'
  | 'PROVIDER_INCOMPLETE';

export class ChatServiceError extends Error {
  readonly code: ChatServiceErrorCode;

  constructor(code: ChatServiceErrorCode) {
    super(code);
    this.name = 'ChatServiceError';
    this.code = code;
  }
}

export interface ChatServiceConfig {
  maxMessagesPerSession: number;
  historyMessageLimit: number;
  retrievalLimit: number;
  monthlyBudgetUsd: number;
  tokenRates: TokenRates;
  providerName?: string;
  model?: string;
}

export type ChatServiceEvent =
  | {
      type: 'meta';
      conversationId: string;
      budgetLevel: BudgetLevel;
      sources: Array<{
        documentId: string;
        title: string;
        sourcePath: string;
        score: number;
      }>;
    }
  | { type: 'delta'; text: string }
  | { type: 'done'; usage: TokenUsage; budgetLevel: BudgetLevel };

export interface RunChatInput {
  pool: Pool;
  provider: AiProvider;
  accessSessionId: string;
  request: NormalizedChatRequest;
  config: ChatServiceConfig;
  now?: Date;
}

interface TurnContext {
  conversationId: string;
  messages: AiMessage[];
}

interface SessionLockRow {
  expires_at: Date;
  message_count: number;
}

async function beginTurn(
  client: PoolClient,
  accessSessionId: string,
  request: NormalizedChatRequest,
  config: ChatServiceConfig,
  now: Date,
): Promise<TurnContext> {
  const sessionResult = await client.query<SessionLockRow>(
    `SELECT session.expires_at, session.message_count
       FROM access_sessions AS session
       JOIN invite_codes AS invite ON invite.id = session.invite_code_id
      WHERE session.id = $1
        AND session.expires_at > $2
        AND invite.active = true
        AND invite.expires_at > $2
      FOR UPDATE OF session`,
    [accessSessionId, now],
  );
  const session = sessionResult.rows[0];
  if (!session) throw new ChatServiceError('SESSION_INVALID');
  if (session.message_count >= config.maxMessagesPerSession) {
    throw new ChatServiceError('MESSAGE_LIMIT');
  }

  let conversationId = request.conversationId;
  if (conversationId) {
    const existing = await client.query<{ mode: string }>(
      `SELECT mode FROM conversations
        WHERE id = $1 AND access_session_id = $2 AND expires_at > $3`,
      [conversationId, accessSessionId, now],
    );
    if (!existing.rows[0]) throw new ChatServiceError('CONVERSATION_INVALID');
    if (existing.rows[0].mode !== request.mode) {
      throw new ChatServiceError('CONVERSATION_MODE_MISMATCH');
    }
  } else {
    conversationId = randomUUID();
    await client.query(
      `INSERT INTO conversations (id, access_session_id, mode, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [conversationId, accessSessionId, request.mode, session.expires_at, now],
    );
  }

  await client.query(
    `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
     VALUES ($1, 'user', $2, $3)`,
    [conversationId, request.message, now],
  );
  await client.query(
    `UPDATE access_sessions
        SET message_count = message_count + 1, last_seen_at = $2
      WHERE id = $1`,
    [accessSessionId, now],
  );
  await client.query(
    'UPDATE conversations SET updated_at = $2 WHERE id = $1',
    [conversationId, now],
  );

  const history = await client.query<{ role: 'user' | 'assistant'; content: string }>(
    `SELECT role, content FROM (
       SELECT id, role, content
         FROM conversation_messages
        WHERE conversation_id = $1
        ORDER BY id DESC
        LIMIT $2
     ) AS recent
     ORDER BY id`,
    [conversationId, config.historyMessageLimit],
  );

  return { conversationId, messages: history.rows };
}

function monthRange(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

async function getBudgetLevel(
  pool: Pool,
  now: Date,
  limitUsd: number,
): Promise<BudgetLevel> {
  const { start, end } = monthRange(now);
  const result = await pool.query<{ spent: string }>(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0)::text AS spent
       FROM usage_events
      WHERE created_at >= $1 AND created_at < $2`,
    [start, end],
  );
  return classifyBudget(Number(result.rows[0]?.spent ?? 0), limitUsd);
}

async function completeTurn(input: {
  pool: Pool;
  accessSessionId: string;
  conversationId: string;
  answer: string;
  usage: TokenUsage;
  config: ChatServiceConfig;
  now: Date;
}): Promise<BudgetLevel> {
  const cost = estimateCostUsd(input.usage, input.config.tokenRates);
  const client = await input.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
       VALUES ($1, 'assistant', $2, $3)`,
      [input.conversationId, input.answer, input.now],
    );
    await client.query(
      `INSERT INTO usage_events
        (access_session_id, conversation_id, provider, model, input_tokens, output_tokens, estimated_cost_usd, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.accessSessionId,
        input.conversationId,
        input.config.providerName ?? 'openai',
        input.config.model ?? 'configured-model',
        input.usage.inputTokens,
        input.usage.outputTokens,
        cost,
        input.now,
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const level = await getBudgetLevel(input.pool, input.now, input.config.monthlyBudgetUsd);
  if (level !== 'normal') {
    console.warn(JSON.stringify({ event: 'morse_budget_warning', level }));
  }
  return level;
}

export async function* runChat(input: RunChatInput): AsyncIterable<ChatServiceEvent> {
  const now = input.now ?? new Date();
  const budgetLevel = await getBudgetLevel(input.pool, now, input.config.monthlyBudgetUsd);
  if (budgetLevel === 'exhausted') throw new ChatServiceError('BUDGET_EXHAUSTED');

  const client = await input.pool.connect();
  let turn: TurnContext;
  try {
    await client.query('BEGIN');
    turn = await beginTurn(
      client,
      input.accessSessionId,
      input.request,
      input.config,
      now,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const [queryEmbedding] = await input.provider.embed([input.request.message]);
  const sources = await retrieveKnowledge(input.pool, queryEmbedding, input.config.retrievalLimit);
  yield {
    type: 'meta',
    conversationId: turn.conversationId,
    budgetLevel,
    sources: sources.map((source) => ({
      documentId: source.documentId,
      title: source.title,
      sourcePath: source.sourcePath,
      score: source.score,
    })),
  };

  const instructions = buildSystemInstructions(input.request.mode, sources);
  let answer = '';
  let completed = false;

  for await (const event of input.provider.streamAnswer({ instructions, messages: turn.messages })) {
    if (event.type === 'delta') {
      answer += event.text;
      yield event;
    } else {
      completed = true;
      const updatedBudgetLevel = await completeTurn({
        pool: input.pool,
        accessSessionId: input.accessSessionId,
        conversationId: turn.conversationId,
        answer,
        usage: event.usage,
        config: input.config,
        now,
      });
      yield { type: 'done', usage: event.usage, budgetLevel: updatedBudgetLevel };
    }
  }

  if (!completed) throw new ChatServiceError('PROVIDER_INCOMPLETE');
}
