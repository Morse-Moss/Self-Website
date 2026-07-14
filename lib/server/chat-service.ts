import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type { AiMessage, AiProvider, AnswerEvent } from './ai-provider.ts';
import { classifyBudget, estimateCostUsd, type BudgetLevel, type TokenRates, type TokenUsage } from './budget.ts';
import { buildSystemInstructions, type NormalizedChatRequest } from './chat-core.ts';
import { retrieveKnowledge } from './rag.ts';

export type ChatServiceErrorCode =
  | 'BUDGET_EXHAUSTED'
  | 'SESSION_INVALID'
  | 'MESSAGE_LIMIT'
  | 'CONVERSATION_INVALID'
  | 'CONVERSATION_MODE_MISMATCH'
  | 'CONVERSATION_BUSY'
  | 'RETRIEVAL_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
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

interface PublicChatSource {
  documentId: string;
  title: string;
  href: string;
  score: number;
}

export type ChatServiceEvent =
  | {
      type: 'meta';
      conversationId: string;
      budgetLevel: BudgetLevel;
      sources: PublicChatSource[];
    }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      usage: TokenUsage;
      budgetLevel: BudgetLevel;
      consumed: boolean;
      remainingMessages: number;
    };

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
  userMessageId: string;
  turnId: string;
  messages: AiMessage[];
  replayAnswer: string | null;
  replaySources: PublicChatSource[] | null;
}

interface ReservedTurn {
  conversationId: string;
  userMessageId: string;
  message: string;
  replayAnswer: string | null;
  replaySources: PublicChatSource[] | null;
}

const STORED_MESSAGE_PREFIX = 'morse-turn-v1:';

function encodeStoredMessage(
  turnId: string,
  content: string,
  sources?: PublicChatSource[],
): string {
  return `${STORED_MESSAGE_PREFIX}${JSON.stringify({ turnId, content, sources })}`;
}

function decodeStoredMessage(value: string): {
  turnId: string | null;
  content: string;
  sources: PublicChatSource[] | null;
} {
  if (!value.startsWith(STORED_MESSAGE_PREFIX)) {
    return { turnId: null, content: value, sources: null };
  }
  try {
    const parsed = JSON.parse(value.slice(STORED_MESSAGE_PREFIX.length)) as {
      turnId?: unknown;
      content?: unknown;
      sources?: unknown;
    };
    if (typeof parsed.turnId === 'string' && typeof parsed.content === 'string') {
      const sources = Array.isArray(parsed.sources) && parsed.sources.every((source) => (
        source
        && typeof source === 'object'
        && typeof (source as Record<string, unknown>).documentId === 'string'
        && typeof (source as Record<string, unknown>).title === 'string'
        && typeof (source as Record<string, unknown>).href === 'string'
        && typeof (source as Record<string, unknown>).score === 'number'
      )) ? parsed.sources as PublicChatSource[] : null;
      return { turnId: parsed.turnId, content: parsed.content, sources };
    }
  } catch {
    // Treat malformed legacy content as plain text instead of losing history.
  }
  return { turnId: null, content: value, sources: null };
}

async function tryAdvisoryLock(client: PoolClient, key: string): Promise<boolean> {
  const result = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock(hashtextextended($1::text, 0)) AS acquired',
    [key],
  );
  return result.rows[0]?.acquired === true;
}

async function findReservedTurn(
  client: PoolClient,
  accessSessionId: string,
  turnId: string,
): Promise<ReservedTurn | null> {
  const users = await client.query<{
    id: string;
    conversation_id: string;
    content: string;
  }>(
    `SELECT message.id::text AS id,
            message.conversation_id::text AS conversation_id,
            message.content
       FROM conversation_messages AS message
       JOIN conversations AS conversation ON conversation.id = message.conversation_id
      WHERE conversation.access_session_id = $1
        AND message.role = 'user'
      ORDER BY message.id DESC`,
    [accessSessionId],
  );
  const user = users.rows.find((row) => decodeStoredMessage(row.content).turnId === turnId);
  if (!user) return null;

  const decodedUser = decodeStoredMessage(user.content);
  const next = await client.query<{ role: 'user' | 'assistant'; content: string }>(
    `SELECT role, content
       FROM conversation_messages
      WHERE conversation_id = $1 AND id > $2
      ORDER BY id
      LIMIT 1`,
    [user.conversation_id, user.id],
  );
  const nextMessage = next.rows[0];
  const decodedNext = nextMessage ? decodeStoredMessage(nextMessage.content) : null;
  const replayAnswer = nextMessage?.role === 'assistant' && decodedNext?.turnId === turnId
    ? decodedNext.content
    : null;
  const replaySources = replayAnswer === null ? null : decodedNext?.sources ?? null;

  return {
    conversationId: user.conversation_id,
    userMessageId: user.id,
    message: decodedUser.content,
    replayAnswer,
    replaySources,
  };
}

interface SessionLockRow {
  expires_at: Date;
  message_count: number;
}

async function beginTurn(
  client: PoolClient,
  accessSessionId: string,
  request: NormalizedChatRequest,
  conversationId: string,
  turnId: string,
  reservedTurn: ReservedTurn | null,
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
  if (request.conversationId || reservedTurn) {
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
    await client.query(
      `INSERT INTO conversations (id, access_session_id, mode, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [conversationId, accessSessionId, request.mode, session.expires_at, now],
    );
  }

  if (reservedTurn) {
    if (reservedTurn.conversationId !== conversationId || reservedTurn.message !== request.message) {
      throw new ChatServiceError('CONVERSATION_INVALID');
    }
  } else if (session.message_count >= config.maxMessagesPerSession) {
    throw new ChatServiceError('MESSAGE_LIMIT');
  }

  let userMessageId = reservedTurn?.userMessageId ?? '';
  if (!reservedTurn) {
    const insertedMessage = await client.query<{ id: string }>(
      `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
       VALUES ($1, 'user', $2, $3)
       RETURNING id::text AS id`,
      [conversationId, encodeStoredMessage(turnId, request.message), now],
    );
    userMessageId = insertedMessage.rows[0].id;
    await client.query(
      `UPDATE access_sessions
          SET message_count = message_count + 1, last_seen_at = $2
        WHERE id = $1`,
      [accessSessionId, now],
    );
  }
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

  return {
    conversationId,
    userMessageId,
    turnId,
    messages: history.rows.map((message) => ({
      role: message.role,
      content: decodeStoredMessage(message.content).content,
    })),
    replayAnswer: reservedTurn?.replayAnswer ?? null,
    replaySources: reservedTurn?.replaySources ?? null,
  };
}

async function compensateTurn(
  client: PoolClient,
  accessSessionId: string,
  turn: TurnContext,
): Promise<void> {
  try {
    await client.query('BEGIN');
    const deleted = await client.query(
      `DELETE FROM conversation_messages
        WHERE id = $1
          AND conversation_id = $2
          AND role = 'user'`,
      [turn.userMessageId, turn.conversationId],
    );
    if (deleted.rowCount === 1) {
      await client.query(
        `UPDATE access_sessions
            SET message_count = GREATEST(message_count - 1, 0)
          WHERE id = $1`,
        [accessSessionId],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function monthRange(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

async function getBudgetLevel(
  pool: Pool | PoolClient,
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

async function getRemainingMessages(
  client: Pool | PoolClient,
  accessSessionId: string,
  maxMessagesPerSession: number,
): Promise<number> {
  const result = await client.query<{ message_count: number }>(
    'SELECT message_count FROM access_sessions WHERE id = $1',
    [accessSessionId],
  );
  return Math.max(0, maxMessagesPerSession - (result.rows[0]?.message_count ?? 0));
}

async function completeTurn(input: {
  client: PoolClient;
  accessSessionId: string;
  conversationId: string;
  turnId: string;
  answer: string;
  sources: PublicChatSource[];
  usage: TokenUsage;
  config: ChatServiceConfig;
  now: Date;
  budgetLevel: BudgetLevel;
}): Promise<BudgetLevel> {
  const cost = estimateCostUsd(input.usage, input.config.tokenRates);

  try {
    await input.client.query('BEGIN');
    await input.client.query(
      `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
       VALUES ($1, 'assistant', $2, $3)`,
      [
        input.conversationId,
        encodeStoredMessage(input.turnId, input.answer, input.sources),
        input.now,
      ],
    );
    await input.client.query(
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
    await input.client.query('COMMIT');
  } catch (error) {
    await input.client.query('ROLLBACK');
    throw error;
  }

  let level = input.budgetLevel;
  try {
    level = await getBudgetLevel(input.client, input.now, input.config.monthlyBudgetUsd);
  } catch {
    return level;
  }
  if (level !== 'normal') {
    console.warn(JSON.stringify({ event: 'morse_budget_warning', level }));
  }
  return level;
}

export async function* runChat(input: RunChatInput): AsyncIterable<ChatServiceEvent> {
  const now = input.now ?? new Date();
  const turnId = input.request.turnId ?? randomUUID();
  const lockClient = await input.pool.connect();
  let destroyLockConnection = false;

  try {
    if (!await tryAdvisoryLock(lockClient, `turn:${turnId}`)) {
      throw new ChatServiceError('CONVERSATION_BUSY');
    }
    const reservedTurn = await findReservedTurn(lockClient, input.accessSessionId, turnId);
    if (
      reservedTurn
      && input.request.conversationId
      && input.request.conversationId !== reservedTurn.conversationId
    ) {
      throw new ChatServiceError('CONVERSATION_INVALID');
    }
    const conversationId = reservedTurn?.conversationId
      ?? input.request.conversationId
      ?? randomUUID();
    if (!await tryAdvisoryLock(lockClient, `conversation:${conversationId}`)) {
      throw new ChatServiceError('CONVERSATION_BUSY');
    }

    const budgetLevel = await getBudgetLevel(lockClient, now, input.config.monthlyBudgetUsd);
    if (budgetLevel === 'exhausted' && reservedTurn?.replayAnswer === null) {
      await compensateTurn(lockClient, input.accessSessionId, {
        conversationId: reservedTurn.conversationId,
        userMessageId: reservedTurn.userMessageId,
        turnId,
        messages: [],
        replayAnswer: null,
        replaySources: null,
      });
      throw new ChatServiceError('BUDGET_EXHAUSTED');
    }
    if (budgetLevel === 'exhausted' && !reservedTurn) {
      throw new ChatServiceError('BUDGET_EXHAUSTED');
    }

    let turn: TurnContext;
    try {
      await lockClient.query('BEGIN');
      turn = await beginTurn(
        lockClient,
        input.accessSessionId,
        input.request,
        conversationId,
        turnId,
        reservedTurn,
        input.config,
        now,
      );
      await lockClient.query('COMMIT');
    } catch (error) {
      await lockClient.query('ROLLBACK');
      throw error;
    }

    if (turn.replayAnswer !== null) {
      if (!turn.replaySources) throw new ChatServiceError('PROVIDER_INCOMPLETE');
      yield {
        type: 'meta',
        conversationId: turn.conversationId,
        budgetLevel,
        sources: turn.replaySources,
      };
      yield { type: 'delta', text: turn.replayAnswer };
      const remainingMessages = await getRemainingMessages(
        lockClient,
        input.accessSessionId,
        input.config.maxMessagesPerSession,
      );
      yield {
        type: 'done',
        usage: { inputTokens: 0, outputTokens: 0 },
        budgetLevel,
        consumed: false,
        remainingMessages,
      };
      return;
    }

    let persisted = false;
    let answerIterator: AsyncIterator<AnswerEvent> | null = null;

    try {
      let sources;
      try {
        const [queryEmbedding] = await input.provider.embed([input.request.message]);
        sources = await retrieveKnowledge(lockClient, queryEmbedding, input.config.retrievalLimit);
      } catch {
        throw new ChatServiceError('RETRIEVAL_UNAVAILABLE');
      }
      const publicSources = sources.map((source) => ({
        documentId: source.documentId,
        title: source.title,
        href: source.href,
        score: source.score,
      }));

      yield {
        type: 'meta',
        conversationId: turn.conversationId,
        budgetLevel,
        sources: publicSources,
      };

      const instructions = buildSystemInstructions(
        input.request.mode,
        input.request.audienceIntent,
        sources,
      );
      let answer = '';
      answerIterator = input.provider.streamAnswer({
        instructions,
        messages: turn.messages,
      })[Symbol.asyncIterator]();

      while (true) {
        let next;
        try {
          next = await answerIterator.next();
        } catch {
          throw new ChatServiceError('PROVIDER_UNAVAILABLE');
        }
        if (next.done) throw new ChatServiceError('PROVIDER_INCOMPLETE');

        const event = next.value;
        if (event.type === 'delta') {
          answer += event.text;
          yield event;
        } else {
          if (!answer.trim()) throw new ChatServiceError('PROVIDER_INCOMPLETE');
          const updatedBudgetLevel = await completeTurn({
            client: lockClient,
            accessSessionId: input.accessSessionId,
            conversationId: turn.conversationId,
            turnId,
            answer,
            sources: publicSources,
            usage: event.usage,
            config: input.config,
            now,
            budgetLevel,
          });
          persisted = true;
          const remainingMessages = await getRemainingMessages(
            lockClient,
            input.accessSessionId,
            input.config.maxMessagesPerSession,
          );
          yield {
            type: 'done',
            usage: event.usage,
            budgetLevel: updatedBudgetLevel,
            consumed: true,
            remainingMessages,
          };
          return;
        }
      }
    } finally {
      if (!persisted) {
        try {
          await answerIterator?.return?.();
        } finally {
          await compensateTurn(lockClient, input.accessSessionId, turn);
        }
      }
    }
  } finally {
    try {
      await lockClient.query('SELECT pg_advisory_unlock_all()');
    } catch {
      destroyLockConnection = true;
    }
    lockClient.release(destroyLockConnection);
  }
}
