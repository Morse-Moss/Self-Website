import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool, PoolClient } from 'pg';

import {
  compensateTurn,
  type CompensationInput,
} from '../lib/server/chat-turn-compensation.ts';

const terminalRow = {
  id: '11111111-1111-4111-8111-111111111111',
  access_session_id: '22222222-2222-4222-8222-222222222222',
  conversation_id: '33333333-3333-4333-8333-333333333333',
  workflow: 'chat',
  audience_intent: 'general',
  question: 'test question',
  answer: null,
  status: 'failed',
  error_code: 'PROVIDER_UNAVAILABLE',
  knowledge_sources: [],
  used_search: false,
  execution_pipeline: 'context_packet_v22',
  task_id: null,
  reserved_user_message_id: null,
} as const;

function compensationInput(
  client: PoolClient,
  pool: Pool,
  errorCode: string = terminalRow.error_code,
): CompensationInput {
  return {
    client,
    pool,
    accessSessionId: terminalRow.access_session_id,
    turn: {
      conversationId: terminalRow.conversation_id,
      userMessageId: null,
      turnId: terminalRow.id,
      createdConversation: false,
      behavior: 'v2',
    },
    status: 'failed',
    errorCode,
    answer: null,
    sources: [],
    attempts: [],
    winner: null,
    config: {
      dynamicProviderContextEnabled: true,
      tokenRates: null,
    },
    startedAt: new Date('2026-08-03T00:00:00.000Z'),
    completedAt: new Date('2026-08-03T00:00:01.000Z'),
  };
}

test('terminal compensation retries once with a fresh client and accepts the expected terminal state', async () => {
  const primaryQueries: string[] = [];
  const primary = {
    async query(sql: string) {
      primaryQueries.push(sql);
      if (sql === 'BEGIN') throw new Error('primary connection lost');
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  const recoveryQueries: string[] = [];
  const releases: boolean[] = [];
  const recovery = {
    async query(sql: string) {
      recoveryQueries.push(sql);
      if (/FROM interaction_turns/u.test(sql)) return { rows: [terminalRow], rowCount: 1 };
      return { rows: [], rowCount: null };
    },
    release(destroy?: boolean) {
      releases.push(destroy === true);
    },
  } as unknown as PoolClient;
  let connectionCalls = 0;
  const pool = {
    async connect() {
      connectionCalls += 1;
      return recovery;
    },
  } as unknown as Pool;

  assert.equal(await compensateTurn(compensationInput(primary, pool)), true);
  assert.equal(connectionCalls, 1);
  assert.deepEqual(primaryQueries, ['BEGIN', 'ROLLBACK']);
  assert.equal(recoveryQueries.length, 3);
  assert.equal(recoveryQueries[0], 'BEGIN');
  assert.match(recoveryQueries[1], /FOR UPDATE/u);
  assert.equal(recoveryQueries[2], 'COMMIT');
  assert.deepEqual(releases, [false]);
});

test('terminal compensation never overwrites a different terminal result', async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (/FROM interaction_turns/u.test(sql)) return { rows: [terminalRow], rowCount: 1 };
      return { rows: [], rowCount: null };
    },
  } as unknown as PoolClient;
  let connectionCalls = 0;
  const pool = {
    async connect() {
      connectionCalls += 1;
      throw new Error('must not recover a conflicting terminal result');
    },
  } as unknown as Pool;

  assert.equal(
    await compensateTurn(compensationInput(client, pool, 'DIFFERENT_FAILURE')),
    false,
  );
  assert.equal(queries.length, 3);
  assert.equal(queries[0], 'BEGIN');
  assert.match(queries[1], /FOR UPDATE/u);
  assert.equal(queries[2], 'COMMIT');
  assert.equal(connectionCalls, 0);
});

test('terminal compensation destroys a recovery client after the retry fails', async () => {
  const primary = {
    async query() {
      throw new Error('primary connection lost');
    },
  } as unknown as PoolClient;
  const releases: boolean[] = [];
  const recovery = {
    async query() {
      throw new Error('recovery connection lost');
    },
    release(destroy?: boolean) {
      releases.push(destroy === true);
    },
  } as unknown as PoolClient;
  const pool = {
    async connect() {
      return recovery;
    },
  } as unknown as Pool;

  assert.equal(await compensateTurn(compensationInput(primary, pool)), false);
  assert.deepEqual(releases, [true]);
});
