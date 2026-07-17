import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { after, before, test } from 'node:test';

import pg from 'pg';

import { redeemInvite } from '../lib/server/access.ts';
import { hashSecret } from '../lib/server/security.ts';
import { encodeTurnMessage } from '../lib/server/turn-codec.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { NextRequest } = await import('next/server.js');
const { getChatHistoryResponse } = await import('../lib/server/chat-history-route.ts');

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for conversation history integration.');
const pool = new Pool({ connectionString });
const now = new Date();
const future = new Date(now.getTime() + 4 * 60 * 60 * 1000);
const past = new Date(now.getTime() - 60 * 1000);
const ownerInviteId = randomUUID();
const otherInviteId = randomUUID();
const ownerCode = `history-owner-${randomUUID()}`;
const otherCode = `history-other-${randomUUID()}`;
const ownerConversationId = randomUUID();
const expiredConversationId = randomUUID();
const otherConversationId = randomUUID();
const interactionOnlyConversationId = randomUUID();
const interactionTurnId = randomUUID();
const runtimeQuestionTurnId = randomUUID();
const runtimeAnswerTurnId = randomUUID();
let ownerToken = '';
let ownerSessionId = '';
let otherToken = '';
let otherSessionId = '';

const config = {
  databaseUrl: connectionString,
  cookieName: 'morse_access',
  sessionHours: 12,
  maxMessagesPerSession: 30,
};

function historyRequest(token: string, conversationId?: string) {
  const url = new URL('http://localhost/api/chat/history');
  if (conversationId) url.searchParams.set('conversationId', conversationId);
  return new NextRequest(url, {
    headers: token ? { cookie: `morse_access=${token}` } : undefined,
  });
}

before(async () => {
  await pool.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES
      ($1, $2, 'history-owner', true, $5, 1, 0),
      ($3, $4, 'history-other', true, $5, 1, 0)`,
    [ownerInviteId, hashSecret(ownerCode), otherInviteId, hashSecret(otherCode), future],
  );
  const owner = await redeemInvite(pool, ownerCode, { now, sessionHours: 2 });
  const other = await redeemInvite(pool, otherCode, { now, sessionHours: 2 });
  ownerToken = owner.token;
  ownerSessionId = owner.sessionId;
  otherToken = other.token;
  otherSessionId = other.sessionId;

  await pool.query(
    `UPDATE access_sessions SET message_count = 2 WHERE id = $1`,
    [ownerSessionId],
  );
  await pool.query(
    `INSERT INTO conversations
      (id, access_session_id, mode, workflow, audience_intent, expires_at, created_at, updated_at)
     VALUES
      ($1, $2, 'general', 'jd_match', 'recruiter', $6, $7, $7),
      ($3, $2, 'general', 'chat', 'general', $8, $7, $7),
      ($4, $5, 'general', 'chat', 'peer', $6, $7, $7)`,
    [
      ownerConversationId,
      ownerSessionId,
      expiredConversationId,
      otherConversationId,
      otherSessionId,
      future,
      now,
      past,
    ],
  );
  const sources = [{
    documentId: 'project-deep-research',
    title: 'Deep Research',
    href: '/works/deep-research',
    score: 0.9,
  }];
  await pool.query(
    `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
     VALUES
      ($1, 'user', $2, $5),
      ($1, 'assistant', $3, $5),
      ($1, 'user', 'legacy plain question', $5),
      ($4, 'assistant', 'expired runtime answer', $5)`,
    [
      ownerConversationId,
      encodeTurnMessage(runtimeQuestionTurnId, 'decoded question'),
      `morse-turn-v1:${JSON.stringify({
        turnId: runtimeAnswerTurnId,
        content: 'decoded answer',
        sources,
      })}`,
      expiredConversationId,
      now,
    ],
  );
  await pool.query(
    `INSERT INTO interaction_turns
      (id, access_session_id, conversation_id, workflow, audience_intent,
       question, answer, status, created_at, completed_at, delete_after)
     VALUES ($1, $2, $3, 'chat', 'general', 'durable question',
             'durable answer must not restore', 'completed', $4, $4, $5)`,
    [
      interactionTurnId,
      ownerSessionId,
      interactionOnlyConversationId,
      now,
      new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
    ],
  );
});

after(async () => {
  await pool.query('DELETE FROM interaction_turns WHERE id = $1', [interactionTurnId]);
  await pool.query('DELETE FROM invite_codes WHERE id IN ($1, $2)', [ownerInviteId, otherInviteId]);
  await pool.end();
});

test('history route returns only owned unexpired runtime messages with decoded sources', async () => {
  const response = await getChatHistoryResponse(
    historyRequest(ownerToken, ownerConversationId),
    { pool, config, now },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    conversationId: ownerConversationId,
    workflow: 'jd_match',
    audienceIntent: 'recruiter',
    messages: [
      {
        role: 'user',
        turnId: runtimeQuestionTurnId,
        text: 'decoded question',
        sources: [],
      },
      {
        role: 'assistant',
        turnId: runtimeAnswerTurnId,
        text: 'decoded answer',
        sources: [{
          id: 'project-deep-research',
          title: 'Deep Research',
          href: '/works/deep-research',
          kind: 'local',
          domain: null,
          score: 0.9,
        }],
      },
      {
        role: 'user',
        turnId: null,
        text: 'legacy plain question',
        sources: [],
      },
    ],
    remainingMessages: 28,
  });
});

test('history route returns 401 for another session, expired runtime, or interaction-only ids', async () => {
  for (const conversationId of [
    otherConversationId,
    expiredConversationId,
    interactionOnlyConversationId,
  ]) {
    const response = await getChatHistoryResponse(
      historyRequest(ownerToken, conversationId),
      { pool, config, now },
    );
    assert.equal(response.status, 401);
    const body = await response.text();
    assert.doesNotMatch(body, /expired runtime answer|durable answer must not restore/);
  }
});

test('history route requires a valid visitor cookie and never needs Provider configuration', async () => {
  const missing = await getChatHistoryResponse(historyRequest(''), { pool, config, now });
  assert.equal(missing.status, 401);

  await pool.query('UPDATE access_sessions SET expires_at = $2 WHERE id = $1', [otherSessionId, past]);
  const expired = await getChatHistoryResponse(
    historyRequest(otherToken, otherConversationId),
    { pool, config, now },
  );
  assert.equal(expired.status, 401);
});

test('history route without an id selects the latest owned unexpired conversation only', async () => {
  const response = await getChatHistoryResponse(historyRequest(ownerToken), { pool, config, now });
  assert.equal(response.status, 200);
  const body = await response.json() as { conversationId: string; messages: Array<{ text: string }> };
  assert.equal(body.conversationId, ownerConversationId);
  assert.equal(body.messages.some((message) => message.text.includes('durable answer')), false);
});
