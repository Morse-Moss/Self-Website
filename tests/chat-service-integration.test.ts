import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import pg, { type Pool as PgPool } from 'pg';

import type { AiMessage, AiProvider, AnswerEvent, AnswerRequest } from '../lib/server/ai-provider.ts';
import { redeemInvite } from '../lib/server/access.ts';
import { ChatServiceError, runChat, type ChatServiceEvent } from '../lib/server/chat-service.ts';
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

class FailingProvider extends FakeProvider {
  override async *streamAnswer(_request: AnswerRequest): AsyncIterable<AnswerEvent> {
    throw new Error('provider failed');
  }
}

class FailingEmbeddingProvider extends FakeProvider {
  override async embed(_inputs: string[]): Promise<number[][]> {
    throw new Error('embedding failed');
  }
}

class DelayedProvider extends FakeProvider {
  private releaseAnswer!: () => void;
  readonly started: Promise<void>;
  private readonly released: Promise<void>;

  constructor() {
    super();
    let markStarted!: () => void;
    this.started = new Promise((resolve) => { markStarted = resolve; });
    this.released = new Promise((resolve) => { this.releaseAnswer = resolve; });
    this.markStarted = markStarted;
  }

  private readonly markStarted: () => void;

  release(): void {
    this.releaseAnswer();
  }

  override async *streamAnswer(request: AnswerRequest): AsyncIterable<AnswerEvent> {
    this.requests.push(request);
    this.markStarted();
    await this.released;
    yield { type: 'delta', text: '已完成并发测试回答。[来源1]' };
    yield { type: 'done', usage: { inputTokens: 100, outputTokens: 20 } };
  }
}

class ThrowsAfterDoneProvider extends FakeProvider {
  override async *streamAnswer(request: AnswerRequest): AsyncIterable<AnswerEvent> {
    this.requests.push(request);
    yield { type: 'delta', text: '完成回答。[来源1]' };
    yield { type: 'done', usage: { inputTokens: 100, outputTokens: 20 } };
    throw new Error('late provider failure');
  }
}

class ForbiddenReplayProvider implements AiProvider {
  async embed(): Promise<number[][]> {
    throw new Error('replay must not call embedding');
  }

  async *streamAnswer(): AsyncIterable<AnswerEvent> {
    throw new Error('replay must not call the answer provider');
  }
}

class EmptyAnswerProvider extends FakeProvider {
  override async *streamAnswer(request: AnswerRequest): AsyncIterable<AnswerEvent> {
    this.requests.push(request);
    yield { type: 'delta', text: '   ' };
    yield { type: 'done', usage: { inputTokens: 100, outputTokens: 1 } };
  }
}

class NullUsageProvider extends FakeProvider {
  override async *streamAnswer(request: AnswerRequest): AsyncIterable<AnswerEvent> {
    this.requests.push(request);
    yield { type: 'delta', text: 'Completed answer with unavailable usage. [source 1]' };
    yield { type: 'done', usage: null };
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

interface FailureFixture {
  inviteId: string;
  accessSessionId: string;
}

interface SessionSnapshot {
  messageCount: number;
  messageRows: number;
  usageRows: number;
}

async function createFailureFixture(label: string): Promise<FailureFixture> {
  const fixtureInviteId = randomUUID();
  const code = `s8-${randomUUID()}`;
  await pool!.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES ($1, $2, $3, true, $4, 1, 0)`,
    [
      fixtureInviteId,
      hashSecret(code),
      label,
      new Date('2026-07-13T08:00:00.000Z'),
    ],
  );
  const redeemed = await redeemInvite(pool!, code, { now, sessionHours: 4 });
  return { inviteId: fixtureInviteId, accessSessionId: redeemed.sessionId };
}

async function readSessionSnapshot(sessionId: string): Promise<SessionSnapshot> {
  const session = await pool!.query<{ message_count: number }>(
    'SELECT message_count FROM access_sessions WHERE id = $1',
    [sessionId],
  );
  const messages = await pool!.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM conversation_messages AS message
       JOIN conversations AS conversation ON conversation.id = message.conversation_id
      WHERE conversation.access_session_id = $1`,
    [sessionId],
  );
  const usage = await pool!.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM usage_events WHERE access_session_id = $1',
    [sessionId],
  );
  return {
    messageCount: session.rows[0].message_count,
    messageRows: Number(messages.rows[0].count),
    usageRows: Number(usage.rows[0].count),
  };
}

async function cleanupFailureFixture(fixture: FailureFixture): Promise<void> {
  await pool!.query('DELETE FROM usage_events WHERE access_session_id = $1', [fixture.accessSessionId]);
  await pool!.query('DELETE FROM invite_codes WHERE id = $1', [fixture.inviteId]);
}

async function consumeChat(input: Parameters<typeof runChat>[0]): Promise<void> {
  for await (const _event of runChat(input)) {
    // Consume the complete stream so failures surface in the test.
  }
}

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
  const events: ChatServiceEvent[] = [];
  for await (const event of runChat({
    pool: pool!,
    provider,
    accessSessionId,
        request: {
          message: '深度研究系统怎么保证证据?',
          mode: 'interviewer',
          audienceIntent: 'recruiter',
          conversationId: null,
          turnId: null,
        },
    config,
    now,
  })) {
    events.push(event);
  }

  assert.equal(events[0].type, 'meta');
  if (events[0].type !== 'meta') return;
  assert.equal(events[0].sources[0].documentId, 'project-deep-research');
  assert.equal(events[0].sources[0].href, '/works/deep-research');
  assert.equal('sourcePath' in events[0].sources[0], false);
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

  const secondEvents: ChatServiceEvent[] = [];
  for await (const event of runChat({
    pool: pool!,
    provider,
    accessSessionId,
    request: {
      message: '再讲讲人的职责',
      mode: 'interviewer',
      audienceIntent: 'recruiter',
      conversationId: events[0].conversationId,
      turnId: null,
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
      request: {
        message: '第三个问题',
        mode: 'general',
        audienceIntent: 'general',
        conversationId: null,
        turnId: null,
      },
      config,
      now: new Date('2026-07-13T03:02:00.000Z'),
    })) {
      // consume stream
    }
  }, (error: unknown) => error instanceof ChatServiceError && error.code === 'MESSAGE_LIMIT');
});

test('runChat keeps a committed turn when the post-commit budget refresh fails', {
  skip: !pool,
}, async () => {
  const fixture = await createFailureFixture('s8-budget-refresh-failure');
  let budgetReads = 0;
  const refreshFailingPool = new Proxy(pool!, {
    get(target, property) {
      if (property === 'connect') {
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(clientTarget, clientProperty) {
              if (clientProperty === 'query') {
                return async (query: string, values?: unknown[]) => {
                  if (query.includes('FROM usage_events')) {
                    budgetReads += 1;
                    if (budgetReads === 2) throw new Error('budget refresh failed');
                  }
                  return clientTarget.query(query, values);
                };
              }
              const value = Reflect.get(clientTarget, clientProperty);
              return typeof value === 'function' ? value.bind(clientTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as PgPool;

  try {
    const events: ChatServiceEvent[] = [];
    for await (const event of runChat({
      pool: refreshFailingPool,
      provider: new FakeProvider(),
      accessSessionId: fixture.accessSessionId,
      request: {
        message: '介绍深度研究系统',
        mode: 'general',
        audienceIntent: 'general',
        conversationId: null,
        turnId: null,
      },
      config,
      now,
    })) {
      events.push(event);
    }

    assert.equal(events.at(-1)?.type, 'done');
    assert.deepEqual(await readSessionSnapshot(fixture.accessSessionId), {
      messageCount: 1,
      messageRows: 2,
      usageRows: 1,
    });
  } finally {
    await cleanupFailureFixture(fixture);
  }
});

test('runChat commits an answer without writing legacy usage when provider usage is missing', {
  skip: !pool,
}, async () => {
  const fixture = await createFailureFixture('s10-null-provider-usage');
  try {
    const events: ChatServiceEvent[] = [];
    for await (const event of runChat({
      pool: pool!,
      provider: new NullUsageProvider(),
      accessSessionId: fixture.accessSessionId,
      request: {
        message: 'Describe the research system.',
        mode: 'general',
        audienceIntent: 'general',
        conversationId: null,
        turnId: randomUUID(),
      },
      config,
      now,
    })) {
      events.push(event);
    }

    const done = events.at(-1);
    assert.equal(done?.type, 'done');
    if (done?.type !== 'done') throw new Error('done event is missing');
    assert.equal(done.usage, null);
    assert.equal(done.consumed, true);
    assert.deepEqual(await readSessionSnapshot(fixture.accessSessionId), {
      messageCount: 1,
      messageRows: 2,
      usageRows: 0,
    });
  } finally {
    await cleanupFailureFixture(fixture);
  }
});

test('runChat rejects a concurrent turn before it can read pending conversation history', {
  skip: !pool,
}, async () => {
  const fixture = await createFailureFixture('s8-conversation-single-flight');
  const firstProvider = new DelayedProvider();
  const secondProvider = new FakeProvider();
  const firstEvents: ChatServiceEvent[] = [];
  const firstRun = (async () => {
    for await (const event of runChat({
      pool: pool!,
      provider: firstProvider,
      accessSessionId: fixture.accessSessionId,
      request: {
        message: '第一轮并发问题',
        mode: 'general',
        audienceIntent: 'general',
        conversationId: null,
        turnId: null,
      },
      config,
      now,
    })) {
      firstEvents.push(event);
    }
  })();
  try {
    await firstProvider.started;
    const firstMeta = firstEvents.find((event) => event.type === 'meta');
    assert.equal(firstMeta?.type, 'meta');
    if (firstMeta?.type !== 'meta') throw new Error('first turn metadata is missing');

    await assert.rejects(
      consumeChat({
        pool: pool!,
        provider: secondProvider,
        accessSessionId: fixture.accessSessionId,
        request: {
          message: '第二轮并发问题',
          mode: 'general',
          audienceIntent: 'general',
          conversationId: firstMeta.conversationId,
          turnId: null,
        },
        config,
        now,
      }),
      (error: unknown) => (
        error instanceof ChatServiceError && error.code === 'CONVERSATION_BUSY'
      ),
    );
    firstProvider.release();
    await firstRun;

    assert.equal(secondProvider.requests.length, 0);
    assert.deepEqual(await readSessionSnapshot(fixture.accessSessionId), {
      messageCount: 1,
      messageRows: 2,
      usageRows: 1,
    });
  } finally {
    firstProvider.release();
    await firstRun.catch(() => undefined);
    await cleanupFailureFixture(fixture);
  }
});

test('runChat replays a completed turn id without a second provider answer or quota charge', {
  skip: !pool,
}, async () => {
  const fixture = await createFailureFixture('s8-turn-idempotency');
  const turnId = randomUUID();
  const request = {
    message: '介绍深度研究系统',
    mode: 'general' as const,
    audienceIntent: 'general' as const,
    conversationId: null,
    turnId,
  };

  try {
    const firstEvents: ChatServiceEvent[] = [];
    for await (const event of runChat({
      pool: pool!,
      provider: new FakeProvider(),
      accessSessionId: fixture.accessSessionId,
      request,
      config,
      now,
    })) {
      firstEvents.push(event);
    }
    const firstMeta = firstEvents.find((event) => event.type === 'meta');
    assert.equal(firstMeta?.type, 'meta');
    if (firstMeta?.type !== 'meta') throw new Error('first turn metadata is missing');
    const afterFirst = await readSessionSnapshot(fixture.accessSessionId);

    const replayEvents: ChatServiceEvent[] = [];
    for await (const event of runChat({
      pool: pool!,
      provider: new ForbiddenReplayProvider(),
      accessSessionId: fixture.accessSessionId,
      request: { ...request, conversationId: firstMeta.conversationId },
      config,
      now: new Date(now.getTime() + 1000),
    })) {
      replayEvents.push(event);
    }

    assert.deepEqual(await readSessionSnapshot(fixture.accessSessionId), afterFirst);
    assert.deepEqual(replayEvents.map((event) => event.type), ['meta', 'delta', 'done']);
    const replayMeta = replayEvents.find((event) => event.type === 'meta');
    assert.equal(replayMeta?.type, 'meta');
    if (replayMeta?.type !== 'meta') throw new Error('replay metadata is missing');
    assert.deepEqual(replayMeta.sources, firstMeta.sources);
    const replayDone = replayEvents.at(-1);
    assert.equal(replayDone?.type, 'done');
    if (replayDone?.type !== 'done') throw new Error('replay done event is missing');
    assert.equal(replayDone.consumed, false);
    assert.equal(replayDone.remainingMessages, 1);
  } finally {
    await cleanupFailureFixture(fixture);
  }
});

test('runChat does not require a nested pool connection while two turns hold advisory locks', {
  skip: !pool,
}, async () => {
  const firstFixture = await createFailureFixture('s8-lock-pool-first');
  const secondFixture = await createFailureFixture('s8-lock-pool-second');
  const constrainedPool = new Pool({
    connectionString: connectionString!,
    max: 2,
    connectionTimeoutMillis: 250,
  });
  let connectCount = 0;
  let releaseBarrier!: () => void;
  const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
  const coordinatedPool = new Proxy(constrainedPool, {
    get(target, property) {
      if (property === 'connect') {
        return async () => {
          const client = await target.connect();
          connectCount += 1;
          if (connectCount === 2) releaseBarrier();
          await barrier;
          return client;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as PgPool;

  try {
    await Promise.all([
      consumeChat({
        pool: coordinatedPool,
        provider: new FakeProvider(),
        accessSessionId: firstFixture.accessSessionId,
        request: {
          message: '第一条独立会话',
          mode: 'general',
          audienceIntent: 'general',
          conversationId: null,
          turnId: randomUUID(),
        },
        config,
        now,
      }),
      consumeChat({
        pool: coordinatedPool,
        provider: new FakeProvider(),
        accessSessionId: secondFixture.accessSessionId,
        request: {
          message: '第二条独立会话',
          mode: 'general',
          audienceIntent: 'general',
          conversationId: null,
          turnId: randomUUID(),
        },
        config,
        now,
      }),
    ]);
    assert.deepEqual(await readSessionSnapshot(firstFixture.accessSessionId), {
      messageCount: 1,
      messageRows: 2,
      usageRows: 1,
    });
    assert.deepEqual(await readSessionSnapshot(secondFixture.accessSessionId), {
      messageCount: 1,
      messageRows: 2,
      usageRows: 1,
    });
  } finally {
    releaseBarrier();
    await constrainedPool.end();
    await cleanupFailureFixture(firstFixture);
    await cleanupFailureFixture(secondFixture);
  }
});

test('runChat stops consuming provider events after the first done event', {
  skip: !pool,
}, async () => {
  const fixture = await createFailureFixture('s8-provider-terminal-done');
  try {
    const events: ChatServiceEvent[] = [];
    for await (const event of runChat({
      pool: pool!,
      provider: new ThrowsAfterDoneProvider(),
      accessSessionId: fixture.accessSessionId,
      request: {
        message: '介绍深度研究系统',
        mode: 'general',
        audienceIntent: 'general',
        conversationId: null,
        turnId: randomUUID(),
      },
      config,
      now,
    })) {
      events.push(event);
    }

    assert.deepEqual(events.map((event) => event.type), ['meta', 'delta', 'done']);
    assert.deepEqual(await readSessionSnapshot(fixture.accessSessionId), {
      messageCount: 1,
      messageRows: 2,
      usageRows: 1,
    });
  } finally {
    await cleanupFailureFixture(fixture);
  }
});

test('runChat compensates a provider completion without meaningful answer text', {
  skip: !pool,
}, async () => {
  const fixture = await createFailureFixture('s8-empty-provider-answer');
  try {
    const before = await readSessionSnapshot(fixture.accessSessionId);
    await assert.rejects(consumeChat({
      pool: pool!,
      provider: new EmptyAnswerProvider(),
      accessSessionId: fixture.accessSessionId,
      request: {
        message: '介绍深度研究系统',
        mode: 'general',
        audienceIntent: 'general',
        conversationId: null,
        turnId: randomUUID(),
      },
      config,
      now,
    }), (error: unknown) => (
      error instanceof ChatServiceError && error.code === 'PROVIDER_INCOMPLETE'
    ));
    assert.deepEqual(await readSessionSnapshot(fixture.accessSessionId), before);
  } finally {
    await cleanupFailureFixture(fixture);
  }
});

test('runChat compensates when the assistant and usage transaction cannot commit', {
  skip: !pool,
}, async () => {
  const fixture = await createFailureFixture('s8-completion-commit-failure');
  let commitCount = 0;
  const commitFailingPool = new Proxy(pool!, {
    get(target, property) {
      if (property === 'connect') {
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(clientTarget, clientProperty) {
              if (clientProperty === 'query') {
                return async (query: string, values?: unknown[]) => {
                  if (query === 'COMMIT') {
                    commitCount += 1;
                    if (commitCount === 2) throw new Error('completion commit failed');
                  }
                  return clientTarget.query(query, values);
                };
              }
              const value = Reflect.get(clientTarget, clientProperty);
              return typeof value === 'function' ? value.bind(clientTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as PgPool;

  try {
    const before = await readSessionSnapshot(fixture.accessSessionId);
    await assert.rejects(consumeChat({
      pool: commitFailingPool,
      provider: new FakeProvider(),
      accessSessionId: fixture.accessSessionId,
      request: {
        message: '介绍深度研究系统',
        mode: 'general',
        audienceIntent: 'general',
        conversationId: null,
        turnId: randomUUID(),
      },
      config,
      now,
    }), /completion commit failed/);
    assert.deepEqual(await readSessionSnapshot(fixture.accessSessionId), before);
  } finally {
    await cleanupFailureFixture(fixture);
  }
});

test('runChat compensates a provider failure without consuming quota or retaining history', {
  skip: !pool,
}, async () => {
  const fixture = await createFailureFixture('s8-provider-failure');
  try {
    const before = await readSessionSnapshot(fixture.accessSessionId);
    await assert.rejects(
      consumeChat({
        pool: pool!,
        provider: new FailingProvider(),
        accessSessionId: fixture.accessSessionId,
        request: {
          message: '介绍深度研究系统',
          mode: 'general',
          audienceIntent: 'general',
          conversationId: null,
          turnId: null,
        },
        config,
        now,
      }),
      (error: unknown) => (
        error instanceof ChatServiceError && error.code === 'PROVIDER_UNAVAILABLE'
      ),
    );
    assert.deepEqual(await readSessionSnapshot(fixture.accessSessionId), before);
  } finally {
    await cleanupFailureFixture(fixture);
  }
});

test('runChat compensates an embedding failure without consuming quota or retaining history', {
  skip: !pool,
}, async () => {
  const fixture = await createFailureFixture('s8-embedding-failure');
  try {
    const before = await readSessionSnapshot(fixture.accessSessionId);
    await assert.rejects(
      consumeChat({
        pool: pool!,
        provider: new FailingEmbeddingProvider(),
        accessSessionId: fixture.accessSessionId,
        request: {
          message: '介绍内容创作系统',
          mode: 'general',
          audienceIntent: 'general',
          conversationId: null,
          turnId: null,
        },
        config,
        now,
      }),
      (error: unknown) => (
        error instanceof ChatServiceError && error.code === 'RETRIEVAL_UNAVAILABLE'
      ),
    );
    assert.deepEqual(await readSessionSnapshot(fixture.accessSessionId), before);
  } finally {
    await cleanupFailureFixture(fixture);
  }
});
