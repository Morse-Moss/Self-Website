import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';

import pg from 'pg';

import { normalizeChatRequest } from '../lib/server/chat-core.ts';
import { loadConversationSessionSnapshot } from '../lib/server/chat-conversation-session.ts';
import { insertCompletedContextTurn } from '../lib/server/conversation-context-state.ts';
import { encodeTurnMessage } from '../lib/server/turn-codec.ts';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');

let database: DisposablePostgresDatabase;
let pool: InstanceType<typeof Pool>;

async function runMigrations(connectionString: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [migrationRunner], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(stderr || `Migration runner exited with ${code}.`)));
  });
}

before(async () => {
  database = await createDisposablePostgresDatabase();
  pool = new Pool({ connectionString: database.connectionString });
  await runMigrations(database.connectionString);
});

after(async () => {
  await pool?.end();
  await database?.dispose();
});

async function insertConversation() {
  const inviteId = randomUUID();
  const sessionId = randomUUID();
  const conversationId = randomUUID();
  await pool.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES ($1, $2, 'session snapshot fixture', true,
             now() + interval '30 days', 3, 1)`,
    [inviteId, randomUUID().replaceAll('-', '').repeat(2)],
  );
  await pool.query(
    `INSERT INTO access_sessions
      (id, invite_code_id, token_hash, expires_at, message_count)
     VALUES ($1, $2, $3, now() + interval '30 days', 0)`,
    [sessionId, inviteId, randomUUID().replaceAll('-', '').repeat(2)],
  );
  await pool.query(
    `INSERT INTO conversations
      (id, access_session_id, mode, workflow, audience_intent, expires_at,
       context_pipeline_assignment)
     VALUES ($1, $2, 'interviewer', 'chat', 'recruiter',
             now() + interval '30 days', 'context_packet_v22')`,
    [conversationId, sessionId],
  );
  return { conversationId, sessionId };
}

async function insertInteraction(input: {
  sessionId: string;
  conversationId: string;
  turnId: string;
  question: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  answer?: string | null;
}) {
  await pool.query(
    `INSERT INTO interaction_turns
      (id, access_session_id, conversation_id, workflow, audience_intent,
       question, answer, status, created_at, completed_at, delete_after,
       execution_pipeline)
     VALUES ($1,$2,$3,'chat','recruiter',$4,$5,$6,now(),
             CASE WHEN $6 = 'running' THEN NULL ELSE now() END,
             now() + interval '30 days', 'context_packet_v22')`,
    [
      input.turnId,
      input.sessionId,
      input.conversationId,
      input.question,
      input.answer ?? null,
      input.status,
    ],
  );
}

async function insertMessagePair(
  conversationId: string,
  turnId: string,
  userText: string,
  assistantText: string,
) {
  const user = await pool.query<{ id: string }>(
    `INSERT INTO conversation_messages (conversation_id, role, content)
     VALUES ($1, 'user', $2) RETURNING id::text`,
    [conversationId, encodeTurnMessage(turnId, userText)],
  );
  const assistant = await pool.query<{ id: string }>(
    `INSERT INTO conversation_messages (conversation_id, role, content)
     VALUES ($1, 'assistant', $2) RETURNING id::text`,
    [conversationId, encodeTurnMessage(turnId, assistantText)],
  );
  return {
    userMessageId: user.rows[0].id,
    assistantMessageId: assistant.rows[0].id,
  };
}

test('snapshot freezes exact current input and completed-only same-scope history', async () => {
  const fixture = await insertConversation();
  const scopeId = randomUUID();
  const excludedTurnIds: string[] = [];
  for (const status of ['failed', 'stopped', 'running'] as const) {
    const turnId = randomUUID();
    excludedTurnIds.push(turnId);
    await insertMessagePair(
      fixture.conversationId,
      turnId,
      `${status} user`,
      `${status} assistant`,
    );
    await insertInteraction({
      ...fixture,
      turnId,
      question: `${status} user`,
      answer: `${status} assistant`,
      status,
    });
  }

  const completedTurnIds = [randomUUID(), randomUUID()];
  const completedPairs = [];
  for (const [index, turnId] of completedTurnIds.entries()) {
    const pair = await insertMessagePair(
      fixture.conversationId,
      turnId,
      `completed user ${index}`,
      `completed assistant ${index}`,
    );
    completedPairs.push(pair);
    await insertInteraction({
      ...fixture,
      turnId,
      question: `completed user ${index}`,
      answer: `completed assistant ${index}`,
      status: 'completed',
    });
    const client = await pool.connect();
    try {
      await insertCompletedContextTurn(client, {
        conversationId: fixture.conversationId,
        turnId,
        contextScopeId: scopeId,
        ...pair,
        completedAt: new Date(`2026-07-29T0${index + 1}:00:00.000Z`),
      });
    } finally {
      client.release();
    }
  }

  const currentTurnId = randomUUID();
  excludedTurnIds.push(currentTurnId);
  const exactCurrentInput = '  继续比较这些项目与岗位的匹配度。  ';
  const current = await pool.query<{ id: string }>(
    `INSERT INTO conversation_messages (conversation_id, role, content)
     VALUES ($1, 'user', $2) RETURNING id::text`,
    [fixture.conversationId, encodeTurnMessage(currentTurnId, exactCurrentInput)],
  );
  await insertInteraction({
    ...fixture,
    turnId: currentTurnId,
    question: exactCurrentInput,
    status: 'running',
  });
  const request = normalizeChatRequest({
    message: exactCurrentInput,
    mode: 'interviewer',
    audienceIntent: 'recruiter',
  });

  const snapshot = await loadConversationSessionSnapshot(pool, {
    conversationId: fixture.conversationId,
    interactionTurnId: currentTurnId,
    currentUserMessageId: current.rows[0].id,
    request,
  });

  assert.equal(snapshot.currentInput, exactCurrentInput);
  assert.equal(snapshot.adjacentCompletedTurn?.turnId, completedTurnIds[1]);
  assert.deepEqual(snapshot.completedHistory.map((turn) => turn.turnId), completedTurnIds);
  assert.equal(
    snapshot.completedHistory.some((turn) => excludedTurnIds.includes(turn.turnId)),
    false,
  );
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.completedHistory));
  assert.ok(snapshot.completedHistory.every((turn) => Object.isFrozen(turn)));
});

test('snapshot returns meaningful whitespace and a long JD without an application cap', async () => {
  const fixture = await insertConversation();
  const currentTurnId = randomUUID();
  const exactCurrentInput = `  岗位职责：${'负责 Agent 平台与 RAG 评测；'.repeat(2_000)}  `;
  const current = await pool.query<{ id: string }>(
    `INSERT INTO conversation_messages (conversation_id, role, content)
     VALUES ($1, 'user', $2) RETURNING id::text`,
    [fixture.conversationId, encodeTurnMessage(currentTurnId, exactCurrentInput)],
  );
  await insertInteraction({
    ...fixture,
    turnId: currentTurnId,
    question: exactCurrentInput,
    status: 'running',
  });

  const snapshot = await loadConversationSessionSnapshot(pool, {
    conversationId: fixture.conversationId,
    interactionTurnId: currentTurnId,
    currentUserMessageId: current.rows[0].id,
    request: normalizeChatRequest({
      message: exactCurrentInput,
      mode: 'interviewer',
      audienceIntent: 'recruiter',
    }),
  });

  assert.equal(snapshot.currentInput, exactCurrentInput);
  assert.equal(snapshot.currentInput.length, exactCurrentInput.length);
  assert.ok(snapshot.currentInput.startsWith('  岗位职责：'));
  assert.ok(snapshot.currentInput.endsWith('；  '));
  assert.deepEqual(snapshot.completedHistory, []);
});
