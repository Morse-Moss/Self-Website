import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';

import pg from 'pg';

import type {
  AiProvider,
  AnswerEvent,
  AnswerRequest,
} from '../lib/server/ai-provider.ts';
import { redeemInvite } from '../lib/server/access.ts';
import { normalizeChatRequest } from '../lib/server/chat-core.ts';
import {
  ChatServiceError,
  runChat,
  type ChatServiceConfig,
  type ChatServiceEvent,
} from '../lib/server/chat-service.ts';
import { EMBEDDING_DIMENSIONS } from '../lib/server/embedding.ts';
import { FailoverAiProvider } from '../lib/server/failover-ai-provider.ts';
import { hashSecret } from '../lib/server/security.ts';
import type { SearchProvider } from '../lib/server/search-provider.ts';
import { siteContent } from '../lib/site-content.ts';
import { encodeTurnMessage } from '../lib/server/turn-codec.ts';
import { controlledContextFailureChain } from './fixtures/controlled-context-failure-chain.ts';
import {
  createDisposablePostgresDatabase,
  type DisposablePostgresDatabase,
} from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const fixtureNow = new Date('2026-07-27T05:00:00.000Z');
const digest = {
  key: Buffer.alloc(32, 0x31),
  keyId: 'context-test-v1',
};

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
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `Migration runner exited with ${code}.`));
    });
  });
}

before(async () => {
  database = await createDisposablePostgresDatabase();
  await runMigrations(database.connectionString);
  pool = new Pool({ connectionString: database.connectionString });
});

after(async () => {
  await pool?.end();
  await database?.dispose();
});

interface Fixture {
  accessSessionId: string;
  inviteId: string;
}

async function createFixture(label: string): Promise<Fixture> {
  const inviteId = randomUUID();
  const code = `context-${randomUUID()}`;
  await pool.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES ($1,$2,$3,true,$4,1,0)`,
    [
      inviteId,
      hashSecret(code),
      label,
      new Date(fixtureNow.getTime() + 60 * 60 * 1_000),
    ],
  );
  const redeemed = await redeemInvite(pool, code, { now: fixtureNow });
  return { accessSessionId: redeemed.sessionId, inviteId };
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await pool.query(
    'DELETE FROM alert_outbox WHERE dedupe_key = $1',
    [`invite-first-use:${fixture.inviteId}`],
  );
  await pool.query('DELETE FROM invite_codes WHERE id = $1', [fixture.inviteId]);
}

function rankedVector(first: number, second: number): string {
  return `[${[first, second, ...new Array<number>(EMBEDDING_DIMENSIONS - 2).fill(0)].join(',')}]`;
}

async function seedFailureChainKnowledge(): Promise<void> {
  const seeds = [
    { id: 'fixture-digital-morse-a', slug: 'digital-morse', first: 1, second: 0 },
    { id: 'fixture-digital-morse-b', slug: 'digital-morse', first: 0.999, second: 0.01 },
    { id: 'fixture-deep-research', slug: 'deep-research', first: 0.99, second: 0.07 },
    { id: 'fixture-content-agent', slug: 'content-agent', first: 0.96, second: 0.2 },
    { id: 'fixture-auto-operations', slug: 'auto-operations', first: 0.8, second: 0.6 },
    { id: 'fixture-ai-leadgen', slug: 'ai-leadgen', first: 0.7, second: 0.714 },
  ] as const;
  for (const seed of seeds) {
    const project = siteContent.projects.find((candidate) => candidate.slug === seed.slug);
    assert.ok(project, seed.slug);
    await pool.query(
      `INSERT INTO knowledge_documents (id, title, source_path, checksum)
       VALUES ($1,$2,$3,$4)`,
      [seed.id, project.name, `tests/fixtures/${seed.id}.md`, seed.id.padEnd(64, '0')],
    );
    await pool.query(
      `INSERT INTO knowledge_chunks
        (id, document_id, ordinal, content, embedding, metadata)
       VALUES ($1,$2,0,$3,$4::vector,$5::jsonb)`,
      [
        `${seed.id}-chunk`,
        seed.id,
        `${project.name} fixture evidence for RAG product design and evaluation delivery.`,
        rankedVector(seed.first, seed.second),
        JSON.stringify({
          title: project.name,
          sourcePath: `content/site-content.json#projects.${seed.slug}`,
          href: `/works#${seed.slug}`,
          projectSlug: seed.slug,
          topicIds: [seed.slug, 'rag'],
        }),
      ],
    );
  }
}

function contextConfig(
  fixture: Fixture,
  overrides: Partial<ChatServiceConfig> = {},
): ChatServiceConfig {
  return {
    maxMessagesPerSession: 20,
    historyMessageLimit: 12,
    retrievalLimit: 5,
    interactionRetentionDays: 10,
    tokenRates: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
    chatV2Enabled: true,
    chatV2CanaryPercent: 100,
    chatV2CanaryInviteIds: new Set([fixture.inviteId]),
    contextPacketEnabled: true,
    contextCanaryPercent: 0,
    contextCanaryInviteIds: new Set([fixture.inviteId]),
    contextTokenBudget: 12_000,
    jdContextTokenBudget: 24_000,
    contextPacketDigest: digest,
    hedgedFailoverEnabled: false,
    chatSafeMode: false,
    providerTotalTimeoutMs: 90_000,
    providerProtocolEventTimeoutMs: 25_000,
    providerModelTextTimeoutMs: 40_000,
    providerStageTimeoutMs: 80_000,
    chatTurnTimeoutMs: 90_000,
    providerMaxAttempts: 2,
    ...overrides,
  };
}

class ControlledAnswerProvider implements AiProvider {
  readonly requests: AnswerRequest[] = [];
  readonly started: Promise<void>;
  private readonly fail: boolean;
  private readonly restoredAnswer: boolean;
  private readonly waitForRelease: boolean;
  private markStarted!: () => void;
  private releaseAnswer!: () => void;
  private readonly released: Promise<void>;

  constructor(options: {
    fail?: boolean;
    restoredAnswer?: boolean;
    waitForRelease?: boolean;
  } = {}) {
    this.fail = options.fail ?? false;
    this.restoredAnswer = options.restoredAnswer ?? false;
    this.waitForRelease = options.waitForRelease ?? false;
    this.started = new Promise((resolve) => { this.markStarted = resolve; });
    this.released = new Promise((resolve) => { this.releaseAnswer = resolve; });
  }

  release(): void {
    this.releaseAnswer();
  }

  async embed(inputs: string[]): Promise<number[][]> {
    return inputs.map(() => {
      const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      vector[0] = 1;
      return vector;
    });
  }

  async *streamAnswer(request: AnswerRequest): AsyncIterable<AnswerEvent> {
    this.requests.push(request);
    this.markStarted();
    if (this.waitForRelease) await this.released;
    if (this.fail) throw new Error('synthetic provider failure');
    if (!request.execution) {
      yield { type: 'delta', text: 'Legacy response for the current request.' };
      yield { type: 'done', usage: { inputTokens: 20, outputTokens: 8 } };
      return;
    }
    const admitted = siteContent.projects.filter((project) => (
      request.instructions.includes(project.name)
    )).slice(0, 3);
    const answer = admitted.length > 0
      ? this.restoredAnswer
        ? [
            'Current RAG delivery requirements map to independently audited evidence:',
            ...admitted.map((project, index) => (
              `${project.name} demonstrates relevant product evaluation and delivery. [来源${index + 1}]`
            )),
          ].join('\n')
        : [
            'For this AI Product Manager role, the strongest audited evidence is:',
            ...admitted.map((project, index) => (
              `${project.name} supports RAG product design and delivery. [来源${index + 1}]`
            )),
          ].join('\n')
      : 'For this AI Product Manager role, the available public evidence is insufficient.';
    yield { type: 'delta', text: answer };
    yield { type: 'done', usage: { inputTokens: 80, outputTokens: 30 } };
  }
}

class FailureChainProvider implements AiProvider {
  readonly requests: AnswerRequest[] = [];
  readonly embedInputs: string[][] = [];

  async embed(inputs: string[]): Promise<number[][]> {
    this.embedInputs.push([...inputs]);
    return inputs.map(() => {
      const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      vector[0] = 1;
      return vector;
    });
  }

  async *streamAnswer(request: AnswerRequest): AsyncIterable<AnswerEvent> {
    this.requests.push(request);
    const admitted = controlledContextFailureChain.expectedEvidence.map(({ projectSlug }) => {
      const project = siteContent.projects.find((candidate) => candidate.slug === projectSlug);
      assert.ok(project, projectSlug);
      assert.match(request.instructions, new RegExp(project.name, 'u'));
      return project;
    });
    const variants = [
      '从岗位条件看，以下审核项目最能说明产品与工程交付能力：',
      '按更正后的公司信息，相关公开项目证据仍然是：',
      '这份短 JD 可映射到以下已审核项目：',
      '我有可核验的相关项目经验，重点包括：',
      '最终结论：现有公开证据能支持这个岗位方向，依据是：',
    ];
    const intro = variants[(this.requests.length - 1) % variants.length];
    const answer = [
      intro,
      ...admitted.map((project, index) => (
        `${project.name}：覆盖 RAG 产品设计、评测或受控交付。[来源${index + 1}]`
      )),
    ].join('\n');
    yield { type: 'delta', text: answer };
    yield { type: 'done', usage: { inputTokens: 90, outputTokens: 35 } };
  }
}

class ExternalCurrentProvider implements AiProvider {
  readonly requests: AnswerRequest[] = [];

  async embed(): Promise<number[][]> {
    throw new Error('external_current must not embed');
  }

  async *streamAnswer(request: AnswerRequest): AsyncIterable<AnswerEvent> {
    this.requests.push(request);
    assert.match(request.instructions, /Responses API 当前文档支持结构化响应/u);
    yield {
      type: 'delta',
      text: '根据 OpenAI 官方文档，Responses API 当前支持结构化响应。[来源1] 该结论截至本轮受控查询。',
    };
    yield { type: 'done', usage: { inputTokens: 45, outputTokens: 22 } };
  }
}

function coordinatedProvider(inner: AiProvider): AiProvider {
  return new FailoverAiProvider(inner, [inner], 90_000);
}

async function collectChat(input: Parameters<typeof runChat>[0]): Promise<ChatServiceEvent[]> {
  const events: ChatServiceEvent[] = [];
  for await (const event of runChat(input)) events.push(event);
  return events;
}

function jdRequest(input: {
  conversationId?: string | null;
  marker: string;
  turnId: string;
}) {
  return normalizeChatRequest({
    workflow: 'jd_match',
    jobDescription: `${input.marker} AI Product Manager. Design RAG products and evaluation workflows.`,
    mode: 'interviewer',
    audienceIntent: 'recruiter',
    conversationId: input.conversationId ?? null,
    turnId: input.turnId,
  });
}

test('V2.2 keeps candidate state invisible until atomic success and replays without Provider work', async () => {
  const fixture = await createFixture('context-v22-success');
  const turnId = randomUUID();
  const marker = 'SENSITIVE_CURRENT_JD_1';
  const request = jdRequest({ marker, turnId });
  const inner = new ControlledAnswerProvider({ waitForRelease: true });
  try {
    const completion = collectChat({
      pool,
      provider: coordinatedProvider(inner),
      accessSessionId: fixture.accessSessionId,
      request,
      config: contextConfig(fixture),
      now: fixtureNow,
    });
    await inner.started;

    const before = await pool.query<{
      completed_count: number;
      frame_count: number;
      manifest: unknown;
      status: string;
    }>(
      `SELECT turn.status, turn.context_manifest AS manifest,
              (SELECT count(*)::integer FROM conversation_context_task_state) AS frame_count,
              (SELECT count(*)::integer FROM conversation_context_completed_turns) AS completed_count
         FROM interaction_turns AS turn
        WHERE turn.id = $1`,
      [turnId],
    );
    assert.deepEqual(before.rows[0], {
      status: 'running',
      manifest: null,
      frame_count: 0,
      completed_count: 0,
    });

    inner.release();
    const events = await completion;
    assert.equal(events.at(-1)?.type, 'done');
    assert.ok(events.some((event) => event.type === 'delta'));

    const providerRequest = inner.requests[0];
    assert.ok(providerRequest.execution?.integrity);
    const providerPayload = [
      providerRequest.instructions,
      ...providerRequest.messages.map((message) => message.content),
    ].join('\n');
    assert.equal(providerPayload.split(marker).length - 1, 1);

    const state = await pool.query<{
      assignment: string;
      completed_count: number;
      context_build_status: string;
      execution_pipeline: string;
      frame_count: number;
      semantic_intent: string;
      status: string;
    }>(
      `SELECT conversation.context_pipeline_assignment AS assignment,
              turn.status, turn.execution_pipeline, turn.semantic_intent,
              turn.context_manifest->>'context_build_status' AS context_build_status,
              (SELECT count(*)::integer FROM conversation_context_task_state
                WHERE conversation_id = conversation.id) AS frame_count,
              (SELECT count(*)::integer FROM conversation_context_completed_turns
                WHERE conversation_id = conversation.id) AS completed_count
         FROM interaction_turns AS turn
         JOIN conversations AS conversation ON conversation.id = turn.conversation_id
        WHERE turn.id = $1`,
      [turnId],
    );
    assert.deepEqual(state.rows[0], {
      assignment: 'context_packet_v22',
      status: 'completed',
      execution_pipeline: 'context_packet_v22',
      semantic_intent: 'jd_match',
      context_build_status: 'built',
      frame_count: 1,
      completed_count: 1,
    });

    const integrity = await pool.query<{ matches: boolean }>(
      `SELECT live.context_builder_version = mirror.context_builder_version
              AND live.packet_hmac_key_id = mirror.packet_hmac_key_id
              AND live.packet_hmac_sha256 = mirror.packet_hmac_sha256
              AND live.generation_overlay_version IS NOT DISTINCT FROM mirror.generation_overlay_version
              AND live.generation_request_hmac_sha256 = mirror.generation_request_hmac_sha256 AS matches
         FROM chat_provider_attempts AS live
         JOIN interaction_provider_attempts AS mirror
           ON mirror.interaction_turn_id = live.interaction_turn_id
          AND mirror.attempt_index = 0
        WHERE live.interaction_turn_id = $1 AND live.attempt_no = 1`,
      [turnId],
    );
    assert.equal(integrity.rows[0]?.matches, true);

    const forbidden: AiProvider = {
      async embed() { throw new Error('replay must not embed'); },
      async *streamAnswer() { throw new Error('replay must not call Provider'); },
    };
    const replay = await collectChat({
      pool,
      provider: forbidden,
      accessSessionId: fixture.accessSessionId,
      request,
      config: contextConfig(fixture),
      now: new Date(fixtureNow.getTime() + 1_000),
    });
    assert.deepEqual(replay.map((event) => event.type), ['meta', 'delta', 'done']);
  } finally {
    inner.release();
    await cleanupFixture(fixture);
  }
});

test('V2.2 failure compensation preserves only a redacted terminal manifest', async () => {
  const fixture = await createFixture('context-v22-failure');
  const turnId = randomUUID();
  const marker = 'SENSITIVE_FAILED_JD_2';
  const inner = new ControlledAnswerProvider({ fail: true });
  try {
    await assert.rejects(
      collectChat({
        pool,
        provider: coordinatedProvider(inner),
        accessSessionId: fixture.accessSessionId,
        request: jdRequest({ marker, turnId }),
        config: contextConfig(fixture),
        now: fixtureNow,
      }),
      (error: unknown) => error instanceof ChatServiceError
        && error.code === 'PROVIDER_UNAVAILABLE',
    );

    const state = await pool.query<{
      assignment: string;
      completed_count: number;
      conversation_rows: number;
      frame_count: number;
      manifest: unknown;
      message_count: number;
      message_rows: number;
      status: string;
    }>(
      `SELECT turn.status, turn.context_manifest AS manifest,
              session.message_count,
              conversation.context_pipeline_assignment AS assignment,
              (SELECT count(*)::integer FROM conversations
                WHERE access_session_id = session.id) AS conversation_rows,
              (SELECT count(*)::integer FROM conversation_messages
                WHERE conversation_id = conversation.id) AS message_rows,
              (SELECT count(*)::integer FROM conversation_context_task_state
                WHERE conversation_id = conversation.id) AS frame_count,
              (SELECT count(*)::integer FROM conversation_context_completed_turns
                WHERE conversation_id = conversation.id) AS completed_count
         FROM interaction_turns AS turn
         JOIN access_sessions AS session ON session.id = turn.access_session_id
         JOIN conversations AS conversation ON conversation.id = turn.conversation_id
        WHERE turn.id = $1`,
      [turnId],
    );
    assert.equal(state.rows[0].status, 'failed');
    assert.equal(state.rows[0].assignment, 'legacy');
    assert.equal(state.rows[0].conversation_rows, 1);
    assert.equal(state.rows[0].message_count, 0);
    assert.equal(state.rows[0].message_rows, 0);
    assert.equal(state.rows[0].frame_count, 0);
    assert.equal(state.rows[0].completed_count, 0);
    assert.equal((state.rows[0].manifest as { context_build_status?: string }).context_build_status, 'built');
    assert.doesNotMatch(JSON.stringify(state.rows[0].manifest), new RegExp(marker, 'u'));
  } finally {
    await cleanupFixture(fixture);
  }
});

test('V2.2 project catalog sends all audited projects without embedding', async () => {
  const fixture = await createFixture('context-v22-project-catalog');
  const requests: AnswerRequest[] = [];
  let embedCalls = 0;
  const provider: AiProvider = {
    async embed() {
      embedCalls += 1;
      throw new Error('project catalog must not call embedding');
    },
    async *streamAnswer(request) {
      requests.push(request);
      const admitted = siteContent.projects.filter((project) => request.instructions.includes(project.name));
      yield {
        type: 'delta',
        text: admitted.map((project, index) => (
          `${project.name}覆盖了一个可核验的公开项目方向。[来源${index + 1}]`
        )).join('\n'),
      };
      yield { type: 'done', usage: { inputTokens: 80, outputTokens: 40 } };
    },
  };
  try {
    const events = await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message: '你做过哪些项目？',
        conversationId: null,
        turnId: randomUUID(),
      }),
      config: contextConfig(fixture),
      now: fixtureNow,
    });

    assert.equal(embedCalls, 0);
    assert.equal(requests.length, 1);
    const meta = events.find((event) => event.type === 'meta');
    assert.equal(meta?.type, 'meta');
    if (meta?.type !== 'meta') return;
    assert.equal(meta.sources.length, siteContent.projects.length);
    for (const project of siteContent.projects) {
      assert.match(requests[0].instructions, new RegExp(project.name, 'u'));
    }
  } finally {
    await cleanupFixture(fixture);
  }
});

test('V2.2 accepts a 12000-character JD with the JD budget and serializes it once', async () => {
  const fixture = await createFixture('context-v22-long-jd-follow-up');
  const requests: AnswerRequest[] = [];
  const provider: AiProvider = {
    async embed(inputs) {
      return inputs.map(() => {
        const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
        vector[0] = 1;
        return vector;
      });
    },
    async *streamAnswer(request) {
      requests.push(request);
      yield { type: 'delta', text: '这个岗位强调职责交付，我会按当前公开项目证据逐项核验。' };
      yield { type: 'done', usage: { inputTokens: 80, outputTokens: 20 } };
    },
  };
  const prefix = '岗位要求：';
  const longJd = `${prefix}${'岗'.repeat(12_000 - prefix.length)}`;
  try {
    const first = await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'jd_match',
        jobDescription: longJd,
        conversationId: null,
        turnId: randomUUID(),
      }),
      config: contextConfig(fixture),
      now: fixtureNow,
    });
    const meta = first.find((event) => event.type === 'meta');
    assert.equal(meta?.type, 'meta');
    if (meta?.type !== 'meta') return;

    assert.equal(requests.length, 1);
    const payload = [
      requests[0].instructions,
      ...requests[0].messages.map((message) => message.content),
    ].join('\n');
    assert.equal(payload.split(longJd).length - 1, 1);
    assert.match(payload, /"valueSource":"current_input"/u);
  } finally {
    await cleanupFixture(fixture);
  }
});

test('a successful legacy override permanently locks a V2.2 conversation without old JD payload', async () => {
  const fixture = await createFixture('context-v22-rollback-lock');
  const firstTurnId = randomUUID();
  const oldMarker = 'SENSITIVE_OLD_JD_3';
  const firstInner = new ControlledAnswerProvider();
  try {
    const firstEvents = await collectChat({
      pool,
      provider: coordinatedProvider(firstInner),
      accessSessionId: fixture.accessSessionId,
      request: jdRequest({ marker: oldMarker, turnId: firstTurnId }),
      config: contextConfig(fixture),
      now: fixtureNow,
    });
    const meta = firstEvents.find((event) => event.type === 'meta');
    assert.equal(meta?.type, 'meta');
    if (meta?.type !== 'meta') return;

    const secondTurnId = randomUUID();
    const newMarker = 'CURRENT_LEGACY_JD_4';
    const secondInner = new ControlledAnswerProvider();
    await collectChat({
      pool,
      provider: coordinatedProvider(secondInner),
      accessSessionId: fixture.accessSessionId,
      request: jdRequest({
        conversationId: meta.conversationId,
        marker: newMarker,
        turnId: secondTurnId,
      }),
      config: contextConfig(fixture, {
        contextPacketEnabled: false,
        contextPacketDigest: null,
        chatV2Enabled: false,
      }),
      now: new Date(fixtureNow.getTime() + 2_000),
    });

    const legacyRequest = secondInner.requests[0];
    assert.equal(legacyRequest.execution, undefined);
    const legacyPayload = [
      legacyRequest.instructions,
      ...legacyRequest.messages.map((message) => message.content),
    ].join('\n');
    assert.doesNotMatch(legacyPayload, new RegExp(oldMarker, 'u'));
    assert.match(legacyPayload, new RegExp(newMarker, 'u'));

    const state = await pool.query<{
      assignment: string;
      closed_reason: string;
      execution_pipeline: string;
      status: string;
    }>(
      `SELECT conversation.context_pipeline_assignment AS assignment,
              frame.status, frame.closed_reason, turn.execution_pipeline
         FROM conversations AS conversation
         JOIN conversation_context_task_state AS frame
           ON frame.conversation_id = conversation.id
         JOIN interaction_turns AS turn ON turn.id = $2
        WHERE conversation.id = $1`,
      [meta.conversationId, secondTurnId],
    );
    assert.deepEqual(state.rows[0], {
      assignment: 'legacy_locked_after_v22',
      status: 'completed',
      closed_reason: 'pipeline_rollback',
      execution_pipeline: 'legacy_v1',
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test('V2.2 replays the five-turn recruitment failure chain with one bounded task and audited Top-3 evidence', async () => {
  const fixture = await createFixture('context-v22-five-turn-failure-chain');
  const provider = new FailureChainProvider();
  const coordinated = coordinatedProvider(provider);
  const turnIds: string[] = [];
  const taskIds: string[] = [];
  let conversationId: string | null = null;
  let finalEvents: ChatServiceEvent[] = [];
  try {
    await seedFailureChainKnowledge();
    for (const [index, step] of controlledContextFailureChain.steps.entries()) {
      const turnId = randomUUID();
      turnIds.push(turnId);
      const events = await collectChat({
        pool,
        provider: coordinated,
        accessSessionId: fixture.accessSessionId,
        request: normalizeChatRequest({
          workflow: 'chat',
          message: step.message,
          mode: 'interviewer',
          audienceIntent: 'recruiter',
          conversationId,
          turnId,
        }),
        config: contextConfig(fixture),
        now: new Date(fixtureNow.getTime() + index * 1_000),
      });
      finalEvents = events;
      const meta = events.find((event) => event.type === 'meta');
      assert.equal(meta?.type, 'meta');
      if (meta?.type !== 'meta') return;
      conversationId = meta.conversationId;
      assert.deepEqual(
        meta.sources.map((source) => source.href),
        controlledContextFailureChain.expectedEvidence.map(({ projectSlug }) => `/works#${projectSlug}`),
      );

      const stored = await pool.query<{
        context_manifest: {
          evidence_ids: string[];
          packet_hmac_sha256: string;
          packet_hmac_key_id: string;
        };
        context_scope_id: string;
        discourse_action: string;
        semantic_intent: string;
        status: string;
        task_action: string;
      }>(
        `SELECT status, semantic_intent, discourse_action, task_action,
                context_scope_id::text, context_manifest
           FROM interaction_turns
          WHERE id = $1`,
        [turnId],
      );
      const row = stored.rows[0];
      assert.equal(row.status, 'completed', step.message);
      assert.equal(row.semantic_intent, step.semanticIntent, step.message);
      assert.equal(row.task_action, step.taskAction, step.message);
      assert.equal(row.discourse_action, step.discourseAction, step.message);
      taskIds.push(row.context_scope_id);
      assert.deepEqual(
        row.context_manifest.evidence_ids,
        controlledContextFailureChain.expectedEvidence.map(({ projectSlug }) => `project:${projectSlug}`),
      );
      assert.equal(row.context_manifest.packet_hmac_key_id, digest.keyId);
      assert.match(row.context_manifest.packet_hmac_sha256, /^[0-9a-f]{64}$/u);
      assert.doesNotMatch(JSON.stringify(row.context_manifest), /示例云科技|RAG 产品|STALE_CORRECTION_DETAIL/u);

      const providerRequest = provider.requests[index];
      assert.equal(
        providerRequest.execution?.integrity?.packetHmacSha256,
        row.context_manifest.packet_hmac_sha256,
      );
      const evidenceBlock = providerRequest.instructions.match(
        /<approved_evidence>([\s\S]*?)<\/approved_evidence>/u,
      )?.[1];
      assert.ok(evidenceBlock);
      const projected = JSON.parse(evidenceBlock) as Array<{
        evidenceLevel: string;
        projectSlug: string;
      }>;
      assert.deepEqual(
        projected.map((item) => item.projectSlug),
        controlledContextFailureChain.expectedEvidence.map((item) => item.projectSlug),
      );
      assert.ok(projected.every((item) => (
        item.evidenceLevel === 'direct' || item.evidenceLevel === 'transferable'
      )));
      if (index === controlledContextFailureChain.steps.length - 1) {
        assert.deepEqual(
          projected.map((item) => ({ projectSlug: item.projectSlug, level: item.evidenceLevel })),
          controlledContextFailureChain.expectedEvidence,
        );
      }
      for (const forbidden of controlledContextFailureChain.forbiddenProjectSlugs) {
        assert.doesNotMatch(providerRequest.instructions, new RegExp(forbidden, 'u'));
      }
    }

    assert.equal(new Set(taskIds).size, 1);
    assert.equal(provider.requests.length, controlledContextFailureChain.steps.length);
    const finalRequest = provider.requests.at(-1)!;
    const finalPayload = [
      finalRequest.instructions,
      ...finalRequest.messages.map((message) => message.content),
    ].join('\n');
    for (const marker of controlledContextFailureChain.staleMarkers) {
      assert.doesNotMatch(finalPayload, new RegExp(marker, 'u'));
    }
    assert.equal(
      finalPayload.split(controlledContextFailureChain.steps.at(-1)!.message).length - 1,
      1,
    );
    const visible = finalEvents
      .filter((event): event is Extract<ChatServiceEvent, { type: 'delta' }> => event.type === 'delta')
      .map((event) => event.text)
      .join('');
    assert.doesNotMatch(visible, /没有可核验资料|无法核验/u);
    for (const { projectSlug } of controlledContextFailureChain.expectedEvidence) {
      const project = siteContent.projects.find((candidate) => candidate.slug === projectSlug);
      assert.ok(project);
      assert.match(visible, new RegExp(project.name, 'u'));
    }
    const finalState = await pool.query<{
      closed_reason: string;
      completed_count: number;
      status: string;
      task_id: string;
    }>(
      `SELECT frame.task_id::text, frame.status, frame.closed_reason,
              (SELECT count(*)::integer
                 FROM conversation_context_completed_turns AS completed
                WHERE completed.conversation_id = frame.conversation_id) AS completed_count
         FROM conversation_context_task_state AS frame
        WHERE frame.conversation_id = $1`,
      [conversationId],
    );
    assert.deepEqual(finalState.rows[0], {
      task_id: taskIds[0],
      status: 'completed',
      closed_reason: 'task_complete',
      completed_count: controlledContextFailureChain.steps.length,
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test('V2.2 freezes controlled search evidence into the signed external-current Context Packet', async () => {
  const fixture = await createFixture('context-v22-external-current');
  const turnId = randomUUID();
  const question = '请核验 OpenAI Responses API 当前版本的能力。';
  const searchResult = {
    id: 'web-1234567890abcdef',
    title: 'OpenAI Responses API',
    href: 'https://platform.openai.com/docs/api-reference/responses',
    kind: 'official' as const,
    domain: 'platform.openai.com',
    score: null,
    snippet: 'Responses API 当前文档支持结构化响应。',
  };
  let searchCalls = 0;
  const searchProvider: SearchProvider = {
    async search(query) {
      searchCalls += 1;
      assert.equal(query, question);
      return { status: 'completed', results: [searchResult], errorCode: null };
    },
  };
  const provider = new ExternalCurrentProvider();
  try {
    const events = await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      searchProvider,
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message: question,
        conversationId: null,
        turnId,
      }),
      config: contextConfig(fixture, {
        searchEnabled: true,
        maxSearchesPerSession: 5,
      }),
      now: fixtureNow,
    });
    assert.equal(searchCalls, 1);
    assert.equal(provider.requests.length, 1);
    const meta = events.find((event) => event.type === 'meta');
    assert.equal(meta?.type, 'meta');
    if (meta?.type !== 'meta') return;
    assert.deepEqual(meta.sources, [{
      id: searchResult.id,
      title: searchResult.title,
      href: searchResult.href,
      kind: searchResult.kind,
      domain: searchResult.domain,
      score: null,
    }]);
    const request = provider.requests[0];
    assert.equal(request.messages.filter((message) => message.content === question).length, 1);
    assert.ok(request.execution?.integrity);

    const stored = await pool.query<{
      context_manifest: {
        evidence_ids: string[];
        packet_hmac_sha256: string;
        semantic_intent: string;
      };
      results: unknown;
      search_count: number;
      status: string;
    }>(
      `SELECT turn.status, turn.context_manifest, session.search_count, search.results
         FROM interaction_turns AS turn
         JOIN access_sessions AS session ON session.id = turn.access_session_id
         JOIN interaction_searches AS search ON search.interaction_turn_id = turn.id
        WHERE turn.id = $1`,
      [turnId],
    );
    assert.equal(stored.rows[0].status, 'completed');
    assert.equal(stored.rows[0].search_count, 1);
    assert.equal(stored.rows[0].context_manifest.semantic_intent, 'external_current');
    assert.deepEqual(stored.rows[0].context_manifest.evidence_ids, [searchResult.id]);
    assert.equal(
      stored.rows[0].context_manifest.packet_hmac_sha256,
      request.execution?.integrity?.packetHmacSha256,
    );
    assert.doesNotMatch(
      JSON.stringify(stored.rows[0].context_manifest),
      /结构化响应|platform\.openai\.com/u,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test('V2.2 compensates an invalid legacy bridge with a stable redacted terminal manifest', async () => {
  const fixture = await createFixture('context-v22-invalid-legacy-bridge');
  const legacyProvider = new ControlledAnswerProvider();
  const legacyTurnId = randomUUID();
  const invalidTurnId = randomUUID();
  const currentTurnId = randomUUID();
  let conversationId: string | null = null;
  let providerCalls = 0;
  const forbiddenProvider: AiProvider = {
    async embed() {
      providerCalls += 1;
      throw new Error('invalid bridge must fail before embedding');
    },
    async *streamAnswer() {
      providerCalls += 1;
      throw new Error('invalid bridge must fail before Provider');
    },
  };
  try {
    const legacyEvents = await collectChat({
      pool,
      provider: coordinatedProvider(legacyProvider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message: '公司：历史示例，岗位：AI 产品经理',
        conversationId: null,
        turnId: legacyTurnId,
      }),
      config: contextConfig(fixture, {
        contextPacketEnabled: false,
        contextPacketDigest: null,
      }),
      now: fixtureNow,
    });
    const meta = legacyEvents.find((event) => event.type === 'meta');
    assert.equal(meta?.type, 'meta');
    if (meta?.type !== 'meta') return;
    conversationId = meta.conversationId;
    await pool.query(
      `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
       VALUES ($1,'user',$2,$3)`,
      [
        conversationId,
        encodeTurnMessage(invalidTurnId, 'ORPHAN_LEGACY_BRIDGE_MARKER'),
        new Date(fixtureNow.getTime() + 1_000),
      ],
    );

    await assert.rejects(
      collectChat({
        pool,
        provider: forbiddenProvider,
        accessSessionId: fixture.accessSessionId,
        request: normalizeChatRequest({
          workflow: 'chat',
          message: '你有什么相关的项目经验吗？',
          conversationId,
          turnId: currentTurnId,
        }),
        config: contextConfig(fixture),
        now: new Date(fixtureNow.getTime() + 2_000),
      }),
      (error: unknown) => error instanceof ChatServiceError
        && error.code === 'CONVERSATION_INVALID',
    );
    assert.equal(providerCalls, 0);
    const stored = await pool.query<{
      assignment: string;
      context_manifest: {
        context_build_error_code: string;
        context_build_status: string;
        legacy_bridge_status: string;
      };
      frame_count: number;
      message_count: number;
      status: string;
    }>(
      `SELECT turn.status, turn.context_manifest,
              conversation.context_pipeline_assignment AS assignment,
              (SELECT count(*)::integer
                 FROM conversation_context_task_state AS frame
                WHERE frame.conversation_id = conversation.id) AS frame_count,
              (SELECT count(*)::integer
                 FROM conversation_messages AS message
                WHERE message.conversation_id = conversation.id
                  AND message.content LIKE $2) AS message_count
         FROM interaction_turns AS turn
         JOIN conversations AS conversation ON conversation.id = turn.conversation_id
        WHERE turn.id = $1`,
      [currentTurnId, `%${currentTurnId}%`],
    );
    assert.equal(stored.rows[0].status, 'failed');
    assert.equal(stored.rows[0].assignment, 'legacy');
    assert.equal(stored.rows[0].frame_count, 0);
    assert.equal(stored.rows[0].message_count, 0);
    assert.deepEqual({
      context_build_status: stored.rows[0].context_manifest.context_build_status,
      context_build_error_code: stored.rows[0].context_manifest.context_build_error_code,
      legacy_bridge_status: stored.rows[0].context_manifest.legacy_bridge_status,
    }, {
      context_build_status: 'failed',
      context_build_error_code: 'LEGACY_BRIDGE_INVALID',
      legacy_bridge_status: 'invalid',
    });
    assert.doesNotMatch(
      JSON.stringify(stored.rows[0].context_manifest),
      /ORPHAN_LEGACY_BRIDGE_MARKER|历史示例/u,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test('each legacy override isolates V2.2 payload state and locks only after success', async (t) => {
  const variants = [
    {
      name: 'context kill switch',
      overrides: { contextPacketEnabled: false, contextPacketDigest: null },
      expectedPipeline: 'legacy_v2',
      providerExpected: true,
    },
    {
      name: 'safe mode',
      overrides: { chatSafeMode: true },
      expectedPipeline: 'safe',
      providerExpected: false,
    },
    {
      name: 'Chat V2 disabled',
      overrides: { chatV2Enabled: false },
      expectedPipeline: 'legacy_v1',
      providerExpected: true,
    },
  ] as const;
  for (const variant of variants) {
    await t.test(variant.name, async () => {
      const fixture = await createFixture(`context-v22-${variant.name}`);
      const oldMarker = `OLD_V22_JD_${variant.expectedPipeline}`;
      const firstProvider = new ControlledAnswerProvider();
      try {
        const first = await collectChat({
          pool,
          provider: coordinatedProvider(firstProvider),
          accessSessionId: fixture.accessSessionId,
          request: jdRequest({ marker: oldMarker, turnId: randomUUID() }),
          config: contextConfig(fixture),
          now: fixtureNow,
        });
        const meta = first.find((event) => event.type === 'meta');
        assert.equal(meta?.type, 'meta');
        if (meta?.type !== 'meta') return;

        const overrideTurnId = randomUUID();
        const overrideMarker = `CURRENT_${variant.expectedPipeline}`;
        const overrideProvider = new ControlledAnswerProvider();
        const overrideEvents = await collectChat({
          pool,
          provider: coordinatedProvider(overrideProvider),
          accessSessionId: fixture.accessSessionId,
          request: jdRequest({
            conversationId: meta.conversationId,
            marker: overrideMarker,
            turnId: overrideTurnId,
          }),
          config: contextConfig(fixture, variant.overrides),
          now: new Date(fixtureNow.getTime() + 1_000),
        });
        const overrideVisible = overrideEvents
          .filter((event): event is Extract<ChatServiceEvent, { type: 'delta' }> => event.type === 'delta')
          .map((event) => event.text)
          .join('');
        assert.doesNotMatch(overrideVisible, new RegExp(oldMarker, 'u'));
        assert.equal(overrideProvider.requests.length > 0, variant.providerExpected);
        for (const request of overrideProvider.requests) {
          const payload = [
            request.instructions,
            ...request.messages.map((message) => message.content),
          ].join('\n');
          assert.doesNotMatch(payload, new RegExp(oldMarker, 'u'));
          assert.match(payload, new RegExp(overrideMarker, 'u'));
        }

        const locked = await pool.query<{
          assignment: string;
          closed_reason: string;
          execution_pipeline: string;
          status: string;
        }>(
          `SELECT conversation.context_pipeline_assignment AS assignment,
                  frame.status, frame.closed_reason, turn.execution_pipeline
             FROM conversations AS conversation
             JOIN conversation_context_task_state AS frame
               ON frame.conversation_id = conversation.id
             JOIN interaction_turns AS turn ON turn.id = $2
            WHERE conversation.id = $1`,
          [meta.conversationId, overrideTurnId],
        );
        assert.deepEqual(locked.rows[0], {
          assignment: 'legacy_locked_after_v22',
          status: 'completed',
          closed_reason: 'pipeline_rollback',
          execution_pipeline: variant.expectedPipeline,
        });

        const restoredProvider = new ControlledAnswerProvider({ restoredAnswer: true });
        const restoredTurnId = randomUUID();
        await collectChat({
          pool,
          provider: coordinatedProvider(restoredProvider),
          accessSessionId: fixture.accessSessionId,
          request: jdRequest({
            conversationId: meta.conversationId,
            marker: `RESTORED_${variant.expectedPipeline}`,
            turnId: restoredTurnId,
          }),
          config: contextConfig(fixture),
          now: new Date(fixtureNow.getTime() + 2_000),
        });
        assert.equal(restoredProvider.requests.length, 1);
        assert.equal(restoredProvider.requests[0].execution?.integrity, undefined);
        const restoredPayload = [
          restoredProvider.requests[0].instructions,
          ...restoredProvider.requests[0].messages.map((message) => message.content),
        ].join('\n');
        assert.doesNotMatch(restoredPayload, new RegExp(oldMarker, 'u'));
        const restored = await pool.query<{ assignment: string; execution_pipeline: string }>(
          `SELECT conversation.context_pipeline_assignment AS assignment, turn.execution_pipeline
             FROM conversations AS conversation
             JOIN interaction_turns AS turn ON turn.conversation_id = conversation.id
            WHERE conversation.id = $1 AND turn.id = $2`,
          [meta.conversationId, restoredTurnId],
        );
        assert.deepEqual(restored.rows[0], {
          assignment: 'legacy_locked_after_v22',
          execution_pipeline: 'legacy_v2',
        });
      } finally {
        await cleanupFixture(fixture);
      }
    });
  }
});

test('failed and stopped legacy overrides do not lock or close an active V2.2 frame', async (t) => {
  for (const terminal of ['failed', 'stopped'] as const) {
    await t.test(terminal, async () => {
      const fixture = await createFixture(`context-v22-override-${terminal}`);
      const oldMarker = `ACTIVE_V22_JD_${terminal}`;
      try {
        const first = await collectChat({
          pool,
          provider: coordinatedProvider(new ControlledAnswerProvider()),
          accessSessionId: fixture.accessSessionId,
          request: jdRequest({ marker: oldMarker, turnId: randomUUID() }),
          config: contextConfig(fixture),
          now: fixtureNow,
        });
        const meta = first.find((event) => event.type === 'meta');
        assert.equal(meta?.type, 'meta');
        if (meta?.type !== 'meta') return;

        const terminalTurnId = randomUUID();
        const inner = new ControlledAnswerProvider({
          fail: terminal === 'failed',
          waitForRelease: terminal === 'stopped',
        });
        const abortController = new AbortController();
        const terminalRun = collectChat({
          pool,
          provider: coordinatedProvider(inner),
          accessSessionId: fixture.accessSessionId,
          request: jdRequest({
            conversationId: meta.conversationId,
            marker: `OVERRIDE_${terminal}`,
            turnId: terminalTurnId,
          }),
          config: contextConfig(fixture, {
            contextPacketEnabled: false,
            contextPacketDigest: null,
          }),
          now: new Date(fixtureNow.getTime() + 1_000),
          signal: abortController.signal,
        });
        if (terminal === 'stopped') {
          await inner.started;
          abortController.abort(new DOMException('stopped by test', 'AbortError'));
          inner.release();
        }
        await assert.rejects(terminalRun);
        inner.release();

        const preserved = await pool.query<{
          assignment: string;
          closed_reason: string | null;
          frame_status: string;
          turn_status: string;
        }>(
          `SELECT conversation.context_pipeline_assignment AS assignment,
                  frame.status AS frame_status, frame.closed_reason,
                  turn.status AS turn_status
             FROM conversations AS conversation
             JOIN conversation_context_task_state AS frame
               ON frame.conversation_id = conversation.id
             JOIN interaction_turns AS turn ON turn.id = $2
            WHERE conversation.id = $1`,
          [meta.conversationId, terminalTurnId],
        );
        assert.deepEqual(preserved.rows[0], {
          assignment: 'context_packet_v22',
          frame_status: 'active',
          closed_reason: null,
          turn_status: terminal,
        });

        const restoredProvider = new ControlledAnswerProvider({ restoredAnswer: true });
        await collectChat({
          pool,
          provider: coordinatedProvider(restoredProvider),
          accessSessionId: fixture.accessSessionId,
          request: jdRequest({
            conversationId: meta.conversationId,
            marker: `RESTORED_AFTER_${terminal}`,
            turnId: randomUUID(),
          }),
          config: contextConfig(fixture),
          now: new Date(fixtureNow.getTime() + 2_000),
        });
        assert.ok(restoredProvider.requests[0].execution?.integrity);
        const restoredPayload = [
          restoredProvider.requests[0].instructions,
          ...restoredProvider.requests[0].messages.map((message) => message.content),
        ].join('\n');
        assert.match(restoredPayload, new RegExp(oldMarker, 'u'));
      } finally {
        await cleanupFixture(fixture);
      }
    });
  }
});

test('deterministic V2.2 clarification persists not_required without Provider or embedding work', async () => {
  const fixture = await createFixture('context-v22-deterministic-not-required');
  const turnId = randomUUID();
  let providerCalls = 0;
  const forbiddenProvider: AiProvider = {
    async embed() {
      providerCalls += 1;
      throw new Error('deterministic clarification must not embed');
    },
    async *streamAnswer() {
      providerCalls += 1;
      throw new Error('deterministic clarification must not call Provider');
    },
  };
  try {
    const events = await collectChat({
      pool,
      provider: forbiddenProvider,
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message: '你有什么相关的项目经验吗？',
        conversationId: null,
        turnId,
      }),
      config: contextConfig(fixture),
      now: fixtureNow,
    });
    assert.equal(providerCalls, 0);
    assert.match(
      events.filter((event): event is Extract<ChatServiceEvent, { type: 'delta' }> => event.type === 'delta')
        .map((event) => event.text).join(''),
      /哪家公司或岗位/u,
    );
    const stored = await pool.query<{
      assignment: string;
      completed_count: number;
      context_build_status: string;
      frame_count: number;
      packet_hmac_sha256: string | null;
      release_policy: string;
      semantic_intent: string;
      status: string;
    }>(
      `SELECT turn.status, turn.semantic_intent,
              turn.context_manifest->>'release_policy' AS release_policy,
              turn.context_manifest->>'context_build_status' AS context_build_status,
              turn.context_manifest->>'packet_hmac_sha256' AS packet_hmac_sha256,
              conversation.context_pipeline_assignment AS assignment,
              (SELECT count(*)::integer FROM conversation_context_task_state AS frame
                WHERE frame.conversation_id = conversation.id) AS frame_count,
              (SELECT count(*)::integer FROM conversation_context_completed_turns AS completed
                WHERE completed.conversation_id = conversation.id) AS completed_count
         FROM interaction_turns AS turn
         JOIN conversations AS conversation ON conversation.id = turn.conversation_id
        WHERE turn.id = $1`,
      [turnId],
    );
    assert.deepEqual(stored.rows[0], {
      status: 'completed',
      semantic_intent: 'clarify',
      release_policy: 'not_required',
      context_build_status: 'not_required',
      packet_hmac_sha256: null,
      assignment: 'context_packet_v22',
      frame_count: 0,
      completed_count: 1,
    });
  } finally {
    await cleanupFixture(fixture);
  }
});
