import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import pg from 'pg';

import type { AiMessage, AiProvider, AnswerEvent, AnswerRequest } from '../lib/server/ai-provider.ts';
import { redeemInvite } from '../lib/server/access.ts';
import { ChatServiceError, runChat } from '../lib/server/chat-service.ts';
import { hashSecret } from '../lib/server/security.ts';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
const pool = connectionString ? new Pool({ connectionString }) : null;
const inviteId = randomUUID();
const inviteCode = 'm3-chat-service-invite';
const now = new Date('2026-07-13T03:00:00.000Z');
let accessSessionId = '';
let queryEmbedding: number[] = [];

class FakeProvider implements AiProvider {
  requests: AnswerRequest[] = [];

  async embed(inputs: string[]): Promise<number[][]> {
    return inputs.map(() => queryEmbedding);
  }

  async *streamAnswer(request: AnswerRequest): AsyncIterable<AnswerEvent> {
    this.requests.push(request);
    yield { type: 'delta', text: '深度研究系统把证据链作为出厂闸门' };
    yield { type: 'delta', text: '。[来源1]' };
    yield { type: 'done', usage: { inputTokens: 100, outputTokens: 20 } };
  }
}

const provider = new FakeProvider();
const config = {
  maxMessagesPerSession: 2,
  historyMessageLimit: 12,
  retrievalLimit: 3,
  monthlyBudgetUsd: 5,
  tokenRates: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
};

before(async () => {
  if (!pool) return;
  const stored = await pool.query<{ embedding: string }>(
    `SELECT embedding::text AS embedding
       FROM knowledge_chunks
      WHERE document_id = 'project-deep-research'
      ORDER BY ordinal
      LIMIT 1`,
  );
  queryEmbedding = JSON.parse(stored.rows[0].embedding) as number[];
  await pool.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES ($1, $2, $3, true, $4, 1, 0)`,
    [inviteId, hashSecret(inviteCode), 'chat-service-test', new Date('2026-07-13T08:00:00.000Z')],
  );
  const redeemed = await redeemInvite(pool, inviteCode, { now, sessionHours: 4 });
  accessSessionId = redeemed.sessionId;
});

after(async () => {
  if (!pool) return;
  await pool.query('DELETE FROM usage_events WHERE access_session_id = $1', [accessSessionId]);
  await pool.query('DELETE FROM invite_codes WHERE id = $1', [inviteId]);
  await pool.end();
});

test('runChat retrieves sources, streams answer, and persists short-term memory and usage', {
  skip: !pool,
}, async () => {
  const events = [];
  for await (const event of runChat({
    pool: pool!,
    provider,
    accessSessionId,
    request: { message: '深度研究系统怎么保证证据?', mode: 'interviewer', conversationId: null },
    config,
    now,
  })) {
    events.push(event);
  }

  assert.equal(events[0].type, 'meta');
  if (events[0].type !== 'meta') return;
  assert.equal(events[0].sources[0].documentId, 'project-deep-research');
  assert.equal(events[0].budgetLevel, 'normal');
  assert.match(events[0].conversationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(events.slice(1).map((event) => event.type), ['delta', 'delta', 'done']);

  const storedMessages = await pool!.query<{ role: string; content: string }>(
    `SELECT role, content FROM conversation_messages
      WHERE conversation_id = $1 ORDER BY id`,
    [events[0].conversationId],
  );
  assert.deepEqual(storedMessages.rows.map((row) => row.role), ['user', 'assistant']);
  assert.match(storedMessages.rows[1].content, /来源1/);

  const usage = await pool!.query<{ estimated_cost_usd: string }>(
    'SELECT estimated_cost_usd FROM usage_events WHERE access_session_id = $1',
    [accessSessionId],
  );
  assert.equal(Number(usage.rows[0].estimated_cost_usd), 0.00014);

  const secondEvents = [];
  for await (const event of runChat({
    pool: pool!,
    provider,
    accessSessionId,
    request: {
      message: '再讲讲人的职责',
      mode: 'interviewer',
      conversationId: events[0].conversationId,
    },
    config,
    now: new Date('2026-07-13T03:01:00.000Z'),
  })) {
    secondEvents.push(event);
  }

  const secondRequestMessages: AiMessage[] = provider.requests[1].messages;
  assert.deepEqual(secondRequestMessages.map((message) => message.role), [
    'user', 'assistant', 'user',
  ]);
});

test('runChat rejects requests after the access-session message limit', { skip: !pool }, async () => {
  await assert.rejects(async () => {
    for await (const _event of runChat({
      pool: pool!,
      provider,
      accessSessionId,
      request: { message: '第三个问题', mode: 'general', conversationId: null },
      config,
      now: new Date('2026-07-13T03:02:00.000Z'),
    })) {
      // consume stream
    }
  }, (error: unknown) => error instanceof ChatServiceError && error.code === 'MESSAGE_LIMIT');
});
