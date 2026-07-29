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
  ProviderAttempt,
} from '../lib/server/ai-provider.ts';
import { ProviderRunError } from '../lib/server/ai-provider.ts';
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
import { insertRunningInteraction } from '../lib/server/interaction-log.ts';
import { hashSecret } from '../lib/server/security.ts';
import type { SearchProvider } from '../lib/server/search-provider.ts';
import { siteContent } from '../lib/site-content.ts';
import {
  compiledChatEvidenceCatalog,
  matchCatalogProjects,
} from '../lib/server/chat-evidence-catalog.ts';
import { encodeTurnMessage } from '../lib/server/turn-codec.ts';
import { controlledContextFailureChain } from './fixtures/controlled-context-failure-chain.ts';
import { hrInterviewEightTurnChain } from './fixtures/hr-interview-eight-turn-chain.ts';
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
const matchChatProjectSlugs = (value: string) => (
  matchCatalogProjects(value, compiledChatEvidenceCatalog)
);

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
    { id: 'fixture-deep-research', slug: 'deep-research', first: 1, second: 0 },
    { id: 'fixture-content-agent', slug: 'content-agent', first: 0.999, second: 0.02 },
    { id: 'fixture-auto-operations', slug: 'auto-operations', first: 0.995, second: 0.05 },
    { id: 'fixture-digital-morse-a', slug: 'digital-morse', first: 0.98, second: 0.15 },
    { id: 'fixture-digital-morse-b', slug: 'digital-morse', first: 0.979, second: 0.16 },
    { id: 'fixture-ai-leadgen', slug: 'ai-leadgen', first: 0.9, second: 0.4 },
  ] as const;
  for (const seed of seeds) {
    const project = siteContent.projects.find((candidate) => candidate.slug === seed.slug);
    assert.ok(project, seed.slug);
    await pool.query(
      `INSERT INTO knowledge_documents (id, title, source_path, checksum)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING`,
      [seed.id, project.name, `tests/fixtures/${seed.id}.md`, seed.id.padEnd(64, '0')],
    );
    await pool.query(
      `INSERT INTO knowledge_chunks
         (id, document_id, ordinal, content, embedding, metadata)
       VALUES ($1,$2,0,$3,$4::vector,$5::jsonb)
       ON CONFLICT (id) DO NOTHING`,
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
    interactionRetentionDays: 10,
    tokenRates: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
    chatV2Enabled: true,
    chatV2CanaryPercent: 100,
    chatV2CanaryInviteIds: new Set([fixture.inviteId]),
    contextPacketEnabled: true,
    contextCanaryPercent: 0,
    contextCanaryInviteIds: new Set([fixture.inviteId]),
    contextCanaryInviteLabels: new Set(),
    contextPacketDigest: digest,
    hedgedFailoverEnabled: false,
    chatSafeMode: false,
    providerTotalTimeoutMs: 90_000,
    providerProtocolEventTimeoutMs: 25_000,
    providerModelTextTimeoutMs: 40_000,
    providerStageTimeoutMs: 80_000,
    chatTurnTimeoutMs: 90_000,
    ...overrides,
  };
}

test('legacy v1, legacy v2 and context-packet v2.2 share one complete canonical source', async () => {
  await seedFailureChainKnowledge();
  const scopedMessages = [
    '你的数字 Morse 怎么实现 RAG？',
    '数字 Morse 为什么这样设计？',
    '数字 Morse 的 RAG 设计再展开讲讲。',
  ] as const;
  for (const pipeline of ['legacy_v1', 'legacy_v2', 'context_packet_v22'] as const) {
    const fixture = await createFixture(`unified-${pipeline}`);
    const provider = new ControlledAnswerProvider();
    let conversationId: string | null = null;
    const turnIds: string[] = [];
    try {
      for (let index = 0; index < 3; index += 1) {
        const turnId = randomUUID();
        turnIds.push(turnId);
        const message = pipeline === 'context_packet_v22'
          ? controlledContextFailureChain.steps[[0, 1, 3][index]].message
          : scopedMessages[index];
        const events = await collectChat({
          pool,
          provider: coordinatedProvider(provider),
          accessSessionId: fixture.accessSessionId,
          request: normalizeChatRequest({
            workflow: 'chat',
            message: `${message} marker-${pipeline}-${index}`,
            mode: 'interviewer',
            audienceIntent: 'recruiter',
            conversationId,
            turnId,
          }),
          config: contextConfig(fixture, {
            chatV2Enabled: pipeline !== 'legacy_v1',
            contextPacketEnabled: pipeline === 'context_packet_v22',
            contextCanaryPercent: pipeline === 'context_packet_v22' ? 100 : 0,
            contextCanaryInviteIds: new Set([fixture.inviteId]),
            dynamicProviderContextEnabled: true,
          }),
          now: fixtureNow,
        });
        const meta = events.find((event) => event.type === 'meta');
        assert.equal(meta?.type, 'meta');
        if (meta?.type !== 'meta') return;
        conversationId = meta.conversationId;

        if (index === 1) {
          const completedAt = new Date('2026-07-27T05:01:00.000Z');
          if (pipeline === 'legacy_v2') {
            const activeTask = await pool.query<{ task_id: string }>(
              `SELECT task_id::text
                 FROM conversation_task_state
                WHERE conversation_id = $1
                  AND status <> 'completed'`,
              [conversationId],
            );
            assert.equal(activeTask.rows.length, 1, 'legacy_v2 seeded active task');
            const aligned = await pool.query(
              `UPDATE interaction_turns
                  SET task_id = $1, completed_at = $2
                WHERE id = ANY($3::uuid[])
                  AND status = 'completed'
                  AND execution_pipeline = 'legacy_v2'`,
              [activeTask.rows[0].task_id, completedAt, turnIds],
            );
            assert.equal(aligned.rowCount, 2, 'legacy_v2 seeded same-scope turns');
            const scopes = await pool.query<{ aligned_count: number; scope_count: number }>(
              `SELECT count(*)::integer AS aligned_count,
                      count(DISTINCT task_id)::integer AS scope_count
                 FROM interaction_turns
                WHERE id = ANY($1::uuid[])
                  AND task_id = $2`,
              [turnIds, activeTask.rows[0].task_id],
            );
            assert.equal(scopes.rows[0].aligned_count, 2, 'legacy_v2 two seeded turns');
            assert.equal(scopes.rows[0].scope_count, 1, 'legacy_v2 one seeded scope');
          } else if (pipeline === 'legacy_v1') {
            const aligned = await pool.query(
              `UPDATE interaction_turns
                  SET completed_at = $1
                WHERE id = ANY($2::uuid[])
                  AND status = 'completed'
                  AND execution_pipeline = 'legacy_v1'`,
              [completedAt, turnIds],
            );
            assert.equal(aligned.rowCount, 2, 'legacy_v1 seeded completed turns');
          } else {
            const aligned = await pool.query(
              `UPDATE conversation_context_completed_turns
                  SET completed_at = $1
                WHERE conversation_id = $2
                  AND turn_id = ANY($3::uuid[])`,
              [completedAt, conversationId, turnIds],
            );
            assert.equal(aligned.rowCount, 2, 'context_packet_v22 seeded completed turns');
            const scopes = await pool.query<{ scope_count: number }>(
              `SELECT count(DISTINCT context_scope_id)::integer AS scope_count
                 FROM conversation_context_completed_turns
                WHERE conversation_id = $1
                  AND turn_id = ANY($2::uuid[])`,
              [conversationId, turnIds],
            );
            assert.equal(scopes.rows[0].scope_count, 1, 'context_packet_v22 one seeded scope');
          }
        }
      }

      assert.equal(provider.requests.length, 3, pipeline);
      const finalRequest = provider.requests.at(-1)!;
      assert.ok(finalRequest.preparedOutboundBody, pipeline);
      const integrity = await pool.query<{
        generation_variant_id: string | null;
        generation_request_v2_hmac_sha256: string | null;
        target_config_digest_version: number | null;
      }>(
        `SELECT generation_variant_id::text, generation_request_v2_hmac_sha256,
                target_config_digest_version
           FROM interaction_provider_attempts
          WHERE interaction_turn_id = $1`,
        [turnIds.at(-1)],
      );
      assert.equal(integrity.rows.length, 1, pipeline);
      assert.match(integrity.rows[0].generation_variant_id ?? '', /^[0-9a-f-]{36}$/u, pipeline);
      assert.match(
        integrity.rows[0].generation_request_v2_hmac_sha256 ?? '',
        /^[0-9a-f]{64}$/u,
        pipeline,
      );
      assert.equal(integrity.rows[0].target_config_digest_version, 1, pipeline);
      const finalPayload = [
        finalRequest.instructions,
        ...finalRequest.messages.map((message) => message.content),
      ].join('\n');
      if (pipeline === 'context_packet_v22') {
        assert.match(finalRequest.instructions, /<task_frame>/u);
        assert.match(finalRequest.instructions, /<task_inputs>/u);
        assert.match(finalRequest.instructions, /<approved_evidence>/u);
      }
      for (let index = 0; index < 3; index += 1) {
        const occurrences = finalPayload.split(`marker-${pipeline}-${index}`).length - 1;
        if (index < 2) assert.equal(occurrences, 1, `${pipeline} history marker ${index}`);
        else assert.ok(occurrences >= 1, `${pipeline} current marker ${index}`);
      }
      assert.ok(
        finalPayload.indexOf(`marker-${pipeline}-0`) < finalPayload.indexOf(`marker-${pipeline}-1`),
        `${pipeline} history marker order`,
      );
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

test('legacy JD and diagnosis keep their structured current prompt after completed history', async () => {
  const scenarios = [
    {
      name: 'jd_match',
      requiredTags: ['<job_description>', '<approved_evidence>'],
      firstRequest: () => normalizeChatRequest({
        workflow: 'jd_match',
        jobDescription: 'PRIOR_JD_CONTEXT product discovery and delivery.',
        mode: 'interviewer',
        audienceIntent: 'recruiter',
        conversationId: null,
        turnId: randomUUID(),
      }),
      nextRequest: (conversationId: string) => normalizeChatRequest({
        workflow: 'jd_match',
        jobDescription: 'CURRENT_JD_PAYLOAD RAG evaluation and production ownership.',
        mode: 'interviewer',
        audienceIntent: 'recruiter',
        conversationId,
        turnId: randomUUID(),
      }),
      currentMarker: 'CURRENT_JD_PAYLOAD',
    },
    {
      name: 'diagnosis',
      requiredTags: ['<diagnosis_fields>'],
      firstRequest: () => normalizeChatRequest({
        workflow: 'diagnosis',
        diagnosis: { problem: 'PRIOR_DIAGNOSIS_CONTEXT' },
        audienceIntent: 'collaboration',
        conversationId: null,
        turnId: randomUUID(),
      }),
      nextRequest: (conversationId: string) => normalizeChatRequest({
        workflow: 'diagnosis',
        diagnosis: { goal: 'CURRENT_DIAGNOSIS_PAYLOAD' },
        audienceIntent: 'collaboration',
        conversationId,
        turnId: randomUUID(),
      }),
      currentMarker: 'CURRENT_DIAGNOSIS_PAYLOAD',
    },
  ] as const;

  for (const scenario of scenarios) {
    const fixture = await createFixture(`structured-history-${scenario.name}`);
    const provider = new ControlledAnswerProvider();
    try {
      const firstEvents = await collectChat({
        pool,
        provider: coordinatedProvider(provider),
        accessSessionId: fixture.accessSessionId,
        request: scenario.firstRequest(),
        config: contextConfig(fixture, {
          chatV2Enabled: false,
          contextPacketEnabled: false,
          dynamicProviderContextEnabled: true,
        }),
        now: fixtureNow,
      });
      const meta = firstEvents.find((event) => event.type === 'meta');
      assert.equal(meta?.type, 'meta', scenario.name);
      if (meta?.type !== 'meta') continue;

      await collectChat({
        pool,
        provider: coordinatedProvider(provider),
        accessSessionId: fixture.accessSessionId,
        request: scenario.nextRequest(meta.conversationId),
        config: contextConfig(fixture, {
          chatV2Enabled: false,
          contextPacketEnabled: false,
          dynamicProviderContextEnabled: true,
        }),
        now: fixtureNow,
      });

      assert.equal(provider.requests.length, 2, scenario.name);
      const preparedBody = provider.requests[1].preparedOutboundBody;
      assert.ok(preparedBody, scenario.name);
      const serialized = JSON.stringify(preparedBody);
      for (const tag of scenario.requiredTags) assert.match(serialized, new RegExp(tag, 'u'));
      assert.equal(
        serialized.split(scenario.currentMarker).length - 1,
        1,
        `${scenario.name} current payload occurrence`,
      );
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

class ControlledAnswerProvider implements AiProvider {
  readonly requests: AnswerRequest[] = [];
  readonly started: Promise<void>;
  private readonly fail: boolean;
  private readonly restoredAnswer: boolean;
  private readonly singleProjectAnswer: boolean;
  private readonly waitForRelease: boolean;
  private markStarted!: () => void;
  private releaseAnswer!: () => void;
  private readonly released: Promise<void>;

  constructor(options: {
    fail?: boolean;
    restoredAnswer?: boolean;
    singleProjectAnswer?: boolean;
    waitForRelease?: boolean;
  } = {}) {
    this.fail = options.fail ?? false;
    this.restoredAnswer = options.restoredAnswer ?? false;
    this.singleProjectAnswer = options.singleProjectAnswer ?? false;
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
    const selected = this.singleProjectAnswer ? admitted.slice(0, 1) : admitted;
    const answer = selected.length > 0
      ? this.restoredAnswer
        ? [
            'Current RAG delivery requirements map to independently audited evidence:',
            ...selected.map((project, index) => (
              `${project.name} demonstrates relevant product evaluation and delivery. [来源${index + 1}]`
            )),
          ].join('\n')
        : [
            'For this AI Product Manager role, the strongest audited evidence is:',
            ...selected.map((project, index) => (
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
    const step = controlledContextFailureChain.steps[this.requests.length - 1];
    assert.ok(step);
    const admitted = step.expectedEvidence.map(({ projectSlug }) => {
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

class HrInterviewRegressionProvider implements AiProvider {
  readonly requests: AnswerRequest[] = [];

  async embed(inputs: string[]): Promise<number[][]> {
    return inputs.map(() => {
      const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      vector[0] = 1;
      return vector;
    });
  }

  async *streamAnswer(request: AnswerRequest): AsyncIterable<AnswerEvent> {
    this.requests.push(request);
    const evidenceBlock = request.instructions.match(
      /<approved_evidence>([\s\S]*?)<\/approved_evidence>/u,
    )?.[1];
    const admitted = evidenceBlock
      ? JSON.parse(evidenceBlock) as Array<{ projectSlug?: string }>
      : [];
    const selectedIndex = admitted.findIndex((item) => (
      item.projectSlug === 'ai-leadgen' || item.projectSlug === 'auto-operations'
    ));
    const selected = selectedIndex >= 0
      ? siteContent.projects.find((project) => project.slug === admitted[selectedIndex].projectSlug)
      : null;
    const answer = selected
      ? `我有可核验的相关项目经验：${selected.name}覆盖业务流程拆解、自动化编排和结果验证。[来源${selectedIndex + 1}]`
      : '我会先基于当前岗位信息判断业务目标、交付边界和验证方式。';
    yield { type: 'delta', text: answer };
    yield { type: 'done', usage: { inputTokens: 72, outputTokens: 28 } };
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

class StaticContextAnswerProvider implements AiProvider {
  private readonly answer: string;

  constructor(answer: string) {
    this.answer = answer;
  }

  async embed(): Promise<number[][]> {
    throw new Error('project catalog validation fixture must not embed');
  }

  async *streamAnswer(): AsyncIterable<AnswerEvent> {
    yield { type: 'delta', text: this.answer };
    yield { type: 'done', usage: { inputTokens: 30, outputTokens: 12 } };
  }
}

function coordinatedProvider(inner: AiProvider): AiProvider {
  return new FailoverAiProvider(inner, [inner], 90_000);
}

function terminalFailureAttempt(
  failure: NonNullable<ProviderAttempt['failure']>,
): ProviderAttempt {
  return {
    attemptIndex: 0,
    completedAt: fixtureNow,
    configDigest: '0'.repeat(64),
    configDigestVersion: 1,
    connectionDisplayName: 'Terminal failure fixture',
    connectionVersionId: null,
    contextWindowTokens: failure.contextWindowTokens,
    costComplete: false,
    errorCode: 'PROVIDER_RESPONSE_FAILED',
    failure,
    firstByteLatencyMs: null,
    firstModelTextMs: null,
    firstProtocolEventMs: null,
    firstUserVisibleMs: null,
    generationMode: 'normal',
    inputUsdPerMillion: null,
    knownCostUsd: null,
    launchKind: 'primary',
    modelDisplayName: 'Terminal model',
    modelId: 'terminal-model',
    modelVersionId: null,
    maxOutputTokens: null,
    outputUsdPerMillion: null,
    position: 0,
    protocol: 'responses',
    reasoningEffort: null,
    routeRevisionId: null,
    sourceType: 'environment',
    startedAt: fixtureNow,
    status: 'failed',
    totalLatencyMs: 1,
    usage: null,
    usageComplete: false,
  };
}

class TerminalProviderFailure implements AiProvider {
  private readonly error: ProviderRunError;

  constructor(error: ProviderRunError) {
    this.error = error;
  }

  async embed(inputs: string[]): Promise<number[][]> {
    return inputs.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0));
  }

  async *streamAnswer(): AsyncIterable<AnswerEvent> {
    throw this.error;
  }
}

async function collectChat(input: Parameters<typeof runChat>[0]): Promise<ChatServiceEvent[]> {
  const events: ChatServiceEvent[] = [];
  for await (const event of runChat(input)) events.push(event);
  return events;
}

test('terminal context failures map to stable public codes after fallback exhaustion', async () => {
  const scenarios: Array<{
    error: ProviderRunError;
    expected: ConstructorParameters<typeof ChatServiceError>[0];
  }> = [
    {
      error: new ProviderRunError('CONTEXT_PROTECTED_PAYLOAD_TOO_LARGE', []),
      expected: 'CONTEXT_LIMIT_EXCEEDED',
    },
    {
      error: new ProviderRunError('PROVIDER_RESPONSE_FAILED', [terminalFailureAttempt({
        category: 'context_overflow',
        reason: 'context_length_exceeded',
        httpStatus: 400,
        inputTokens: null,
        outputTokens: null,
        contextWindowTokens: null,
      })]),
      expected: 'CONTEXT_WINDOW_UNKNOWN',
    },
    {
      error: new ProviderRunError('PROVIDER_RESPONSE_INCOMPLETE', [terminalFailureAttempt({
        category: 'output_truncated',
        reason: 'length',
        httpStatus: 200,
        inputTokens: 3_000,
        outputTokens: 1_000,
        contextWindowTokens: 8_192,
      })]),
      expected: 'OUTPUT_TRUNCATED',
    },
    {
      error: new ProviderRunError('CONTEXT_SUMMARY_NOT_SMALLER', []),
      expected: 'CONTEXT_COMPACTION_FAILED',
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    const fixture = await createFixture(`terminal-context-${index}`);
    try {
      await assert.rejects(
        collectChat({
          pool,
          provider: new TerminalProviderFailure(scenario.error),
          accessSessionId: fixture.accessSessionId,
          request: normalizeChatRequest({
            workflow: 'chat',
            message: '今天吃什么？',
            turnId: randomUUID(),
          }),
          config: contextConfig(fixture, {
            chatV2Enabled: false,
            contextPacketEnabled: false,
            dynamicProviderContextEnabled: false,
          }),
          now: fixtureNow,
        }),
        (error: unknown) => error instanceof ChatServiceError
          && error.code === scenario.expected,
        scenario.expected,
      );
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

test('an exact HR interview label upgrades an existing full-invite session from legacy to V2.2', async () => {
  const fixture = await createFixture('HR interview');
  const firstTurnId = randomUUID();
  const firstProvider = new ControlledAnswerProvider();
  try {
    const firstEvents = await collectChat({
      pool,
      provider: coordinatedProvider(firstProvider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        message: '请讲一个真正落地过的 AI 项目，说明原流程、具体动作和结果。',
        turnId: firstTurnId,
      }),
      config: contextConfig(fixture, {
        contextCanaryInviteIds: new Set(),
        contextCanaryInviteLabels: new Set(),
      }),
      now: fixtureNow,
    });
    const meta = firstEvents.find((event) => event.type === 'meta');
    assert.equal(meta?.type, 'meta');
    if (meta?.type !== 'meta') return;

    const secondTurnId = randomUUID();
    const secondProvider = new ControlledAnswerProvider({ singleProjectAnswer: true });
    const secondEvents = await collectChat({
      pool,
      provider: coordinatedProvider(secondProvider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        message: '这份岗位不是招单纯会用 AI 工具的人。请讲一个你真正落地过的 AI 项目：原来是什么业务流程，你具体做了什么，最后产生了什么结果？',
        conversationId: meta.conversationId,
        turnId: secondTurnId,
      }),
      config: contextConfig(fixture, {
        contextCanaryInviteIds: new Set(),
        contextCanaryInviteLabels: new Set(['HR interview']),
      }),
      now: new Date(fixtureNow.getTime() + 1_000),
    });
    assert.equal(secondProvider.requests.length, 1);
    assert.match(secondProvider.requests[0].instructions, /只选择一个/);
    assert.match(secondProvider.requests[0].instructions, /原始业务问题/);
    assert.match(secondProvider.requests[0].instructions, /本人职责/);
    assert.match(secondProvider.requests[0].instructions, /关键决策/);
    assert.match(secondProvider.requests[0].instructions, /系统结构/);
    assert.match(secondProvider.requests[0].instructions, /验证结果/);
    assert.match(secondProvider.requests[0].instructions, /事实边界/);
    assert.doesNotMatch(
      secondProvider.requests[0].instructions,
      /完整列出本轮证据中的全部公开项目/,
    );
    const secondAnswer = secondEvents
      .filter((event): event is Extract<ChatServiceEvent, { type: 'delta' }> => event.type === 'delta')
      .map((event) => event.text)
      .join('');
    assert.equal(matchChatProjectSlugs(secondAnswer).length, 1);
    assert.doesNotMatch(secondAnswer, /没有可核验|无法核验/u);

    const stored = await pool.query<{
      assignment: string;
      first_pipeline: string;
      max_sessions: number;
      second_intent: string;
      second_pipeline: string;
      session_count: number;
    }>(
      `SELECT conversation.context_pipeline_assignment AS assignment,
              first_turn.execution_pipeline AS first_pipeline,
              second_turn.execution_pipeline AS second_pipeline,
              second_turn.semantic_intent AS second_intent,
              invite.session_count, invite.max_sessions
         FROM conversations AS conversation
         JOIN interaction_turns AS first_turn ON first_turn.id = $2
         JOIN interaction_turns AS second_turn ON second_turn.id = $3
         JOIN access_sessions AS session ON session.id = conversation.access_session_id
         JOIN invite_codes AS invite ON invite.id = session.invite_code_id
        WHERE conversation.id = $1`,
      [meta.conversationId, firstTurnId, secondTurnId],
    );
    assert.deepEqual(stored.rows[0], {
      assignment: 'context_packet_v22',
      first_pipeline: 'legacy_v2',
      second_pipeline: 'context_packet_v22',
      second_intent: 'project_catalog',
      session_count: 1,
      max_sessions: 1,
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test('the screenshot HR chain upgrades legacy history into one JD-backed V2.2 task', async () => {
  const fixture = await createFixture('HR interview');
  const legacyTurnIds: string[] = [];
  const upgradedTaskIds: string[] = [];
  let conversationId: string | null = null;
  try {
    await seedFailureChainKnowledge();
    for (const [index, step] of hrInterviewEightTurnChain.slice(0, 5).entries()) {
      const turnId = randomUUID();
      legacyTurnIds.push(turnId);
      const events = await collectChat({
        pool,
        provider: coordinatedProvider(new ControlledAnswerProvider()),
        accessSessionId: fixture.accessSessionId,
        request: normalizeChatRequest({
          workflow: 'chat',
          message: step.message,
          mode: 'interviewer',
          audienceIntent: 'recruiter',
          conversationId,
          turnId,
        }),
        config: contextConfig(fixture, {
          contextCanaryInviteIds: new Set(),
          contextCanaryInviteLabels: new Set(),
        }),
        now: new Date(fixtureNow.getTime() + index * 1_000),
      });
      const meta = events.find((event) => event.type === 'meta');
      assert.equal(meta?.type, 'meta', step.message);
      if (meta?.type !== 'meta') return;
      conversationId ??= meta.conversationId;
      assert.equal(meta.conversationId, conversationId, step.message);
      const stored = await pool.query<{ execution_pipeline: string; status: string }>(
        'SELECT status, execution_pipeline FROM interaction_turns WHERE id = $1',
        [turnId],
      );
      assert.deepEqual(stored.rows[0], {
        status: 'completed',
        execution_pipeline: 'legacy_v2',
      }, step.message);
    }

    assert.ok(conversationId);
    for (const [offset, step] of hrInterviewEightTurnChain.slice(5).entries()) {
      const turnId = randomUUID();
      const provider = new HrInterviewRegressionProvider();
      const events = await collectChat({
        pool,
        provider: coordinatedProvider(provider),
        accessSessionId: fixture.accessSessionId,
        request: normalizeChatRequest({
          workflow: 'chat',
          message: step.message,
          mode: 'interviewer',
          audienceIntent: 'recruiter',
          conversationId,
          turnId,
        }),
        config: contextConfig(fixture, {
          contextCanaryInviteIds: new Set(),
          contextCanaryInviteLabels: new Set(['HR interview']),
        }),
        now: new Date(fixtureNow.getTime() + (offset + 5) * 1_000),
      });
      const meta = events.find((event) => event.type === 'meta');
      assert.equal(meta?.type, 'meta', step.message);
      if (meta?.type !== 'meta') return;
      assert.equal(meta.conversationId, conversationId, step.message);
      assert.equal(provider.requests.length, 1, step.message);
      assert.ok(provider.requests[0].execution?.integrity, step.message);

      const stored = await pool.query<{
        context_manifest: {
          context_build_status: string;
          evidence_ids: string[];
          included_layers: string[];
          legacy_bridge_source_turn_ids: string[];
          legacy_bridge_status: string;
          projected_slot_kinds: string[];
        };
        context_scope_id: string;
        discourse_action: string;
        execution_pipeline: string;
        semantic_intent: string;
        status: string;
        task_action: string;
      }>(
        `SELECT status, execution_pipeline, semantic_intent, discourse_action,
                task_action, context_scope_id::text, context_manifest
           FROM interaction_turns
          WHERE id = $1`,
        [turnId],
      );
      const row = stored.rows[0];
      assert.equal(row.status, 'completed', step.message);
      assert.equal(row.execution_pipeline, 'context_packet_v22', step.message);
      assert.equal(row.semantic_intent, 'project_fit', step.message);
      assert.equal(row.discourse_action, 'follow_up', step.message);
      assert.equal(row.task_action, 'continue', step.message);
      assert.equal(row.context_manifest.context_build_status, 'built', step.message);
      assert.ok(row.context_manifest.evidence_ids.length > 0, step.message);
      assert.ok(row.context_manifest.included_layers.includes('task_frame'), step.message);
      assert.ok(row.context_manifest.included_layers.includes('task_inputs'), step.message);
      assert.ok(row.context_manifest.projected_slot_kinds.includes('job_description'), step.message);
      assert.ok(meta.sources.length > 0, step.message);
      if (offset === 0) {
        assert.equal(row.context_manifest.legacy_bridge_status, 'consumed', step.message);
        assert.deepEqual(row.context_manifest.legacy_bridge_source_turn_ids, [...legacyTurnIds].reverse(), step.message);
      }
      upgradedTaskIds.push(row.context_scope_id);

      const visible = events
        .filter((event): event is Extract<ChatServiceEvent, { type: 'delta' }> => event.type === 'delta')
        .map((event) => event.text)
        .join('');
      assert.ok(
        matchChatProjectSlugs(visible).some((slug) => (
          slug === 'ai-leadgen' || slug === 'auto-operations'
        )),
        step.message,
      );
      assert.doesNotMatch(visible, /没有可核验|无法核验|请.*(?:JD|岗位).*(?:发|提供|补充)/u, step.message);
    }

    assert.equal(new Set(upgradedTaskIds).size, 1);
    const finalState = await pool.query<{
      assignment: string;
      consumed_bridge_count: number;
      frame_count: number;
      jd_slot_count: number;
      max_sessions: number;
      session_count: number;
      task_id: string;
      task_kind: string;
    }>(
      `SELECT conversation.context_pipeline_assignment AS assignment,
              frame.task_id::text, frame.task_kind,
              invite.session_count, invite.max_sessions,
              (SELECT count(*)::integer FROM conversation_context_task_state AS candidate
                WHERE candidate.conversation_id = conversation.id) AS frame_count,
              (SELECT count(*)::integer FROM conversation_context_slot_refs AS slot
                WHERE slot.conversation_id = conversation.id
                  AND slot.task_id = frame.task_id
                  AND slot.slot_kind = 'job_description') AS jd_slot_count,
              (SELECT count(*)::integer FROM conversation_context_legacy_bridge_turns AS bridge
                WHERE bridge.conversation_id = conversation.id
                  AND bridge.status = 'consumed') AS consumed_bridge_count
         FROM conversations AS conversation
         JOIN conversation_context_task_state AS frame
           ON frame.conversation_id = conversation.id
         JOIN access_sessions AS session ON session.id = conversation.access_session_id
         JOIN invite_codes AS invite ON invite.id = session.invite_code_id
        WHERE conversation.id = $1`,
      [conversationId],
    );
    assert.deepEqual(finalState.rows[0], {
      assignment: 'context_packet_v22',
      task_id: upgradedTaskIds[0],
      task_kind: 'recruitment_evaluation',
      session_count: 1,
      max_sessions: 1,
      frame_count: 1,
      jd_slot_count: 1,
      consumed_bridge_count: legacyTurnIds.length,
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test('the first V2.2 recruiter evaluation consumes the adjacent structured-JD legacy bridge', async () => {
  const fixture = await createFixture('HR interview');
  const provider = new ControlledAnswerProvider();
  const jobDescription = [
    '岗位：跨境电商产品经理（Vibe Coding 方向）',
    '工作内容：把业务想法转成产品方案，接手前后端并快速交付。',
    '岗位要求：使用 Claude Code，依据用户反馈和业务数据持续迭代。',
  ].join('\n');
  const legacyTurnIds: string[] = [];
  let conversationId: string | null = null;
  let jobDescriptionMessageId: string | null = null;
  try {
    await seedFailureChainKnowledge();
    for (const [index, message] of [
      '请介绍与岗位最相关的项目和能力证据。',
      jobDescription,
      '综合这份 JD，匹配度如何？',
    ].entries()) {
      const turnId = randomUUID();
      legacyTurnIds.push(turnId);
      const events = await collectChat({
        pool,
        provider: coordinatedProvider(provider),
        accessSessionId: fixture.accessSessionId,
        request: normalizeChatRequest({
          workflow: 'chat',
          message,
          mode: 'interviewer',
          audienceIntent: 'recruiter',
          conversationId,
          turnId,
        }),
        config: contextConfig(fixture, {
          contextCanaryInviteIds: new Set(),
          contextCanaryInviteLabels: new Set(),
        }),
        now: new Date(fixtureNow.getTime() + index * 1_000),
      });
      const meta = events.find((event) => event.type === 'meta');
      assert.equal(meta?.type, 'meta', message);
      if (meta?.type !== 'meta') return;
      conversationId ??= meta.conversationId;
      assert.equal(meta.conversationId, conversationId, message);
      const stored = await pool.query<{ execution_pipeline: string }>(
        `SELECT execution_pipeline
           FROM interaction_turns
          WHERE id = $1`,
        [turnId],
      );
      assert.equal(stored.rows[0].execution_pipeline, 'legacy_v2', message);
      if (index === 1) {
        const userMessage = await pool.query<{ id: string }>(
          `SELECT id::text
             FROM conversation_messages
            WHERE conversation_id = $1 AND role = 'user'
            ORDER BY id DESC
            LIMIT 1`,
          [conversationId],
        );
        jobDescriptionMessageId = userMessage.rows[0].id;
      }
    }

    assert.ok(conversationId);
    assert.ok(jobDescriptionMessageId);
    const turnId = randomUUID();
    const message = '如何把跨境电商业务想法转成可执行产品方案？';
    const events = await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message,
        mode: 'interviewer',
        audienceIntent: 'recruiter',
        conversationId,
        turnId,
      }),
      config: contextConfig(fixture, {
        contextCanaryInviteIds: new Set(),
        contextCanaryInviteLabels: new Set(['HR interview']),
      }),
      now: new Date(fixtureNow.getTime() + 3_000),
    });
    const meta = events.find((event) => event.type === 'meta');
    assert.equal(meta?.type, 'meta');
    if (meta?.type !== 'meta') return;
    assert.ok(meta.sources.length > 0);

    const stored = await pool.query<{
      context_manifest: {
        evidence_ids: string[];
        legacy_bridge_source_turn_ids: string[];
        legacy_bridge_status: string;
        projected_slot_kinds: string[];
      };
      context_scope_id: string;
      discourse_action: string;
      execution_pipeline: string;
      semantic_intent: string;
      task_action: string;
    }>(
      `SELECT execution_pipeline, semantic_intent, discourse_action,
              task_action, context_scope_id::text, context_manifest
         FROM interaction_turns
        WHERE id = $1`,
      [turnId],
    );
    assert.equal(stored.rows[0].execution_pipeline, 'context_packet_v22');
    assert.equal(stored.rows[0].semantic_intent, 'jd_match');
    assert.equal(stored.rows[0].discourse_action, 'follow_up');
    assert.equal(stored.rows[0].task_action, 'continue');
    assert.ok(stored.rows[0].context_manifest.evidence_ids.length > 0);
    assert.equal(stored.rows[0].context_manifest.legacy_bridge_status, 'consumed');
    assert.deepEqual(
      stored.rows[0].context_manifest.legacy_bridge_source_turn_ids,
      [...legacyTurnIds].reverse(),
    );
    assert.ok(stored.rows[0].context_manifest.projected_slot_kinds.includes('job_description'));

    const frame = await pool.query<{
      end_utf16: number;
      source_message_id: string;
      start_utf16: number;
      task_id: string;
      task_kind: string;
    }>(
      `SELECT frame.task_id::text, frame.task_kind,
              slot.source_message_id::text, slot.start_utf16, slot.end_utf16
         FROM conversation_context_task_state AS frame
         JOIN conversation_context_slot_refs AS slot
           ON slot.conversation_id = frame.conversation_id
          AND slot.task_id = frame.task_id
          AND slot.slot_kind = 'job_description'
        WHERE frame.conversation_id = $1`,
      [conversationId],
    );
    assert.equal(frame.rows.length, 1);
    assert.equal(frame.rows[0].task_id, stored.rows[0].context_scope_id);
    assert.equal(frame.rows[0].task_kind, 'recruitment_evaluation');
    assert.equal(frame.rows[0].source_message_id, jobDescriptionMessageId);
    assert.equal(frame.rows[0].start_utf16, 0);
    assert.equal(frame.rows[0].end_utf16, jobDescription.length);
  } finally {
    await cleanupFixture(fixture);
  }
});

test('a V2.2 temporary turn prevents later consumption of a captured legacy JD bridge', async () => {
  const fixture = await createFixture('HR interview');
  const provider = new ControlledAnswerProvider();
  let conversationId: string | null = null;
  try {
    await seedFailureChainKnowledge();
    const legacyTurnId = randomUUID();
    const legacyEvents = await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message: '岗位：AI 产品经理，负责 Agent 产品交付与验证',
        mode: 'interviewer',
        audienceIntent: 'recruiter',
        turnId: legacyTurnId,
      }),
      config: contextConfig(fixture, {
        contextCanaryInviteIds: new Set(),
        contextCanaryInviteLabels: new Set(),
      }),
      now: fixtureNow,
    });
    const legacyMeta = legacyEvents.find((event) => event.type === 'meta');
    assert.equal(legacyMeta?.type, 'meta');
    if (legacyMeta?.type !== 'meta') return;
    conversationId = legacyMeta.conversationId;

    const temporaryTurnId = randomUUID();
    const temporaryEvents = await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message: '为什么天空是蓝色的？',
        mode: 'interviewer',
        audienceIntent: 'recruiter',
        conversationId,
        turnId: temporaryTurnId,
      }),
      config: contextConfig(fixture, {
        contextCanaryInviteIds: new Set(),
        contextCanaryInviteLabels: new Set(['HR interview']),
      }),
      now: new Date(fixtureNow.getTime() + 1_000),
    });
    const temporaryMeta = temporaryEvents.find((event) => event.type === 'meta');
    assert.equal(temporaryMeta?.type, 'meta');
    if (temporaryMeta?.type !== 'meta') return;
    assert.deepEqual(temporaryMeta.sources, []);

    const evaluationTurnId = randomUUID();
    const evaluationEvents = await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message: '如何保证产品交付可验证、可回滚？',
        mode: 'interviewer',
        audienceIntent: 'recruiter',
        conversationId,
        turnId: evaluationTurnId,
      }),
      config: contextConfig(fixture, {
        contextCanaryInviteIds: new Set(),
        contextCanaryInviteLabels: new Set(['HR interview']),
      }),
      now: new Date(fixtureNow.getTime() + 2_000),
    });
    const evaluationMeta = evaluationEvents.find((event) => event.type === 'meta');
    assert.equal(evaluationMeta?.type, 'meta');
    if (evaluationMeta?.type !== 'meta') return;
    assert.deepEqual(evaluationMeta.sources, []);

    const turns = await pool.query<{
      context_manifest: {
        evidence_ids: string[];
        legacy_bridge_status: string;
      };
      context_scope_id: string;
      discourse_action: string;
      id: string;
      semantic_intent: string;
      task_action: string;
    }>(
      `SELECT id::text, semantic_intent, discourse_action, task_action,
              context_scope_id::text, context_manifest
         FROM interaction_turns
        WHERE id = ANY($1::uuid[])
        ORDER BY created_at`,
      [[temporaryTurnId, evaluationTurnId]],
    );
    assert.deepEqual(turns.rows.map((row) => ({
      bridgeStatus: row.context_manifest.legacy_bridge_status,
      contextScopeId: row.context_scope_id,
      discourseAction: row.discourse_action,
      evidenceIds: row.context_manifest.evidence_ids,
      id: row.id,
      semanticIntent: row.semantic_intent,
      taskAction: row.task_action,
    })), [
      {
        bridgeStatus: 'captured',
        contextScopeId: temporaryTurnId,
        discourseAction: 'one_shot',
        evidenceIds: [],
        id: temporaryTurnId,
        semanticIntent: 'general_conversation',
        taskAction: 'temporary',
      },
      {
        bridgeStatus: 'captured',
        contextScopeId: evaluationTurnId,
        discourseAction: 'one_shot',
        evidenceIds: [],
        id: evaluationTurnId,
        semanticIntent: 'general_conversation',
        taskAction: 'temporary',
      },
    ]);
    const state = await pool.query<{
      captured_bridge_count: number;
      frame_count: number;
    }>(
      `SELECT
         (SELECT count(*)::integer
            FROM conversation_context_task_state
           WHERE conversation_id = $1) AS frame_count,
         (SELECT count(*)::integer
            FROM conversation_context_legacy_bridge_turns
           WHERE conversation_id = $1 AND status = 'captured') AS captured_bridge_count`,
      [conversationId],
    );
    assert.deepEqual(state.rows[0], { frame_count: 0, captured_bridge_count: 1 });
  } finally {
    await cleanupFixture(fixture);
  }
});

test('context label matching is case-sensitive and remains additive to the UUID allowlist', async (t) => {
  for (const label of ['hr interview', 'HR Interview', 'general']) {
    await t.test(label, async () => {
      const fixture = await createFixture(label);
      const turnId = randomUUID();
      try {
        await collectChat({
          pool,
          provider: coordinatedProvider(new ControlledAnswerProvider()),
          accessSessionId: fixture.accessSessionId,
          request: normalizeChatRequest({
            message: '请讲一个真正落地过的 AI 项目，说明原流程、具体动作和结果。',
            turnId,
          }),
          config: contextConfig(fixture, {
            contextCanaryInviteIds: new Set(),
            contextCanaryInviteLabels: new Set(['HR interview']),
          }),
          now: fixtureNow,
        });
        const stored = await pool.query<{ execution_pipeline: string }>(
          'SELECT execution_pipeline FROM interaction_turns WHERE id = $1',
          [turnId],
        );
        assert.deepEqual(stored.rows[0], { execution_pipeline: 'legacy_v2' });
      } finally {
        await cleanupFixture(fixture);
      }
    });
  }

  await t.test('static UUID allowlist', async () => {
    const fixture = await createFixture('ordinary invite');
    const turnId = randomUUID();
    try {
      await collectChat({
        pool,
        provider: coordinatedProvider(new ControlledAnswerProvider()),
        accessSessionId: fixture.accessSessionId,
        request: normalizeChatRequest({
          message: '请讲一个真正落地过的 AI 项目，说明原流程、具体动作和结果。',
          turnId,
        }),
        config: contextConfig(fixture, {
          contextCanaryInviteIds: new Set([fixture.inviteId]),
          contextCanaryInviteLabels: new Set(['HR interview']),
        }),
        now: fixtureNow,
      });
      const stored = await pool.query<{ execution_pipeline: string }>(
        'SELECT execution_pipeline FROM interaction_turns WHERE id = $1',
        [turnId],
      );
      assert.deepEqual(stored.rows[0], { execution_pipeline: 'context_packet_v22' });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  await t.test('diagnosis remains on its legacy pipeline', async () => {
    const fixture = await createFixture('HR interview');
    const turnId = randomUUID();
    try {
      await collectChat({
        pool,
        provider: coordinatedProvider(new ControlledAnswerProvider()),
        accessSessionId: fixture.accessSessionId,
        request: normalizeChatRequest({
          workflow: 'diagnosis',
          diagnosis: {
            problem: '客服知识库回答不稳定',
            goal: '形成可验证的改进方案',
          },
          audienceIntent: 'collaboration',
          turnId,
        }),
        config: contextConfig(fixture, {
          contextCanaryInviteIds: new Set(),
          contextCanaryInviteLabels: new Set(['HR interview']),
        }),
        now: fixtureNow,
      });
      const stored = await pool.query<{ execution_pipeline: string }>(
        'SELECT execution_pipeline FROM interaction_turns WHERE id = $1',
        [turnId],
      );
      assert.deepEqual(stored.rows[0], { execution_pipeline: 'legacy_v2' });
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

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

test('V2.2 same-turn retry reuses the signed logical request across execution attempts', async () => {
  const fixture = await createFixture('context-v22-same-turn-retry');
  const turnId = randomUUID();
  const request = jdRequest({ marker: 'SAME_TURN_RETRY_JD', turnId });
  const failedProvider = new ControlledAnswerProvider({ fail: true });
  const successfulProvider = new ControlledAnswerProvider();
  try {
    await assert.rejects(
      collectChat({
        pool,
        provider: coordinatedProvider(failedProvider),
        accessSessionId: fixture.accessSessionId,
        request,
        config: contextConfig(fixture),
        now: fixtureNow,
      }),
      (error: unknown) => error instanceof ChatServiceError
        && error.code === 'PROVIDER_UNAVAILABLE',
    );

    const firstIdentity = await pool.query<{
      reserved_user_message_id: string;
      task_id: string;
    }>(
      `SELECT reserved_user_message_id::text, task_id::text
         FROM interaction_turns
        WHERE id = $1`,
      [turnId],
    );

    const retried = await collectChat({
      pool,
      provider: coordinatedProvider(successfulProvider),
      accessSessionId: fixture.accessSessionId,
      request,
      config: contextConfig(fixture),
      now: new Date(fixtureNow.getTime() + 1_000),
    });
    assert.equal(retried.at(-1)?.type, 'done');

    const retriedIdentity = await pool.query<{
      reserved_user_message_id: string;
      task_id: string;
      user_message_id: string;
    }>(
      `SELECT turn.reserved_user_message_id::text,
              turn.task_id::text,
              completed.user_message_id::text
         FROM interaction_turns AS turn
         JOIN conversation_context_completed_turns AS completed
           ON completed.turn_id = turn.id
        WHERE turn.id = $1`,
      [turnId],
    );
    assert.deepEqual(retriedIdentity.rows[0], {
      reserved_user_message_id: firstIdentity.rows[0].reserved_user_message_id,
      task_id: firstIdentity.rows[0].task_id,
      user_message_id: firstIdentity.rows[0].reserved_user_message_id,
    });
    assert.equal(
      failedProvider.requests[0].execution?.integrity?.packetHmacSha256,
      successfulProvider.requests[0].execution?.integrity?.packetHmacSha256,
    );

    const integrity = await pool.query<{
      execution_count: number;
      packet_hmac_count: number;
      request_hmac_count: number;
    }>(
      `SELECT count(DISTINCT execution_id)::integer AS execution_count,
              count(DISTINCT packet_hmac_sha256)::integer AS packet_hmac_count,
              count(DISTINCT generation_request_hmac_sha256)::integer AS request_hmac_count
         FROM chat_provider_attempts
        WHERE interaction_turn_id = $1`,
      [turnId],
    );
    assert.ok(integrity.rows[0].execution_count >= 2);
    assert.equal(integrity.rows[0].packet_hmac_count, 1);
    assert.equal(integrity.rows[0].request_hmac_count, 1);
  } finally {
    await cleanupFixture(fixture);
  }
});

test('V2.2 explicit conversational follow-up sends only the adjacent completed pair', async () => {
  const fixture = await createFixture('context-v22-explicit-follow-up');
  const provider = new ControlledAnswerProvider();
  try {
    const first = await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message: '先解释一下为什么受控上下文要限制历史。',
        conversationId: null,
        turnId: randomUUID(),
      }),
      config: contextConfig(fixture),
      now: fixtureNow,
    });
    const firstMeta = first.find((event) => event.type === 'meta');
    assert.equal(firstMeta?.type, 'meta');
    if (firstMeta?.type !== 'meta') return;
    const firstRequest = provider.requests[0];

    await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message: '为什么这么说？',
        conversationId: firstMeta.conversationId,
        turnId: randomUUID(),
      }),
      config: contextConfig(fixture),
      now: new Date(fixtureNow.getTime() + 1_000),
    });

    assert.deepEqual(provider.requests[1].messages, [
      { role: 'user', content: firstRequest.messages.at(-1)?.content ?? '' },
      { role: 'assistant', content: 'For this AI Product Manager role, the available public evidence is insufficient.' },
      { role: 'user', content: '为什么这么说？' },
    ]);
    assert.doesNotMatch(provider.requests[1].instructions, /SENSITIVE_OLD_COMPANY|SENSITIVE_OLD_JD/u);
  } finally {
    await cleanupFixture(fixture);
  }
});

test('V2.2 named project implementation question includes the approved project evidence', async () => {
  const fixture = await createFixture('context-v22-named-project-fact');
  const provider = new ControlledAnswerProvider();
  const turnId = randomUUID();
  try {
    const events = await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message: '数字摩斯怎么实现 RAG？',
        conversationId: null,
        turnId,
      }),
      config: contextConfig(fixture),
      now: fixtureNow,
    });
    assert.equal(events.at(-1)?.type, 'done');
    const project = siteContent.projects.find((candidate) => candidate.slug === 'digital-morse');
    assert.ok(project);
    assert.match(provider.requests[0].instructions, new RegExp(project.name, 'u'));
    const stored = await pool.query<{
      evidence_ids: string[];
      semantic_intent: string;
    }>(
      `SELECT context_manifest->'evidence_ids' AS evidence_ids,
              semantic_intent
         FROM interaction_turns
        WHERE id = $1`,
      [turnId],
    );
    assert.equal(stored.rows[0].semantic_intent, 'named_project_fact');
    assert.deepEqual(stored.rows[0].evidence_ids, ['project:digital-morse']);
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
    assert.equal(
      meta.sources.length,
      siteContent.projects.length + (siteContent.profile.resumeFacts?.length ?? 0),
    );
    for (const project of siteContent.projects) {
      assert.match(requests[0].instructions, new RegExp(project.name, 'u'));
    }
  } finally {
    await cleanupFixture(fixture);
  }
});

test('V2.2 quality warnings commit and release the candidate answer', async () => {
  const fixture = await createFixture('context-v22-validation-warn');
  const turnId = randomUUID();
  const answer = '只回答一个未覆盖完整证据的项目。[来源99]';
  try {
    const events = await collectChat({
      pool,
      provider: coordinatedProvider(new StaticContextAnswerProvider(answer)),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message: '你做过哪些项目？',
        conversationId: null,
        turnId,
      }),
      config: contextConfig(fixture),
      now: fixtureNow,
    });

    assert.deepEqual(
      events.filter((event) => event.type === 'delta').map((event) => event.text),
      [answer],
    );
    const stored = await pool.query<{
      answer_validation: { verdict: string; issue_codes: string[] };
      status: string;
    }>(
      `SELECT status, context_manifest->'answer_validation' AS answer_validation
         FROM interaction_turns WHERE id = $1`,
      [turnId],
    );
    assert.equal(stored.rows[0].status, 'completed');
    assert.equal(stored.rows[0].answer_validation.verdict, 'warn');
    assert.ok(stored.rows[0].answer_validation.issue_codes.includes('missing_evidence_coverage'));
    assert.ok(stored.rows[0].answer_validation.issue_codes.includes('invalid_citation'));
  } finally {
    await cleanupFixture(fixture);
  }
});

test('V2.2 secret leakage blocks before delta and persists only the issue code', async () => {
  const fixture = await createFixture('context-v22-validation-block');
  const turnId = randomUUID();
  const events: ChatServiceEvent[] = [];
  try {
    await assert.rejects(
      async () => {
        for await (const event of runChat({
          pool,
          provider: coordinatedProvider(new StaticContextAnswerProvider(
            'Authorization: Bearer sk-12345678901234567890',
          )),
          accessSessionId: fixture.accessSessionId,
          request: normalizeChatRequest({
            workflow: 'chat',
            message: '你做过哪些项目？',
            conversationId: null,
            turnId,
          }),
          config: contextConfig(fixture),
          now: fixtureNow,
        })) events.push(event);
      },
      (error: unknown) => error instanceof ChatServiceError
        && error.code === 'CONVERSATION_INVALID',
    );

    assert.equal(events.some((event) => event.type === 'delta' || event.type === 'done'), false);
    const stored = await pool.query<{
      answer: string | null;
      answer_validation: { verdict: string; issue_codes: string[] };
      context_manifest: unknown;
      status: string;
    }>(
      `SELECT status, answer, context_manifest,
              context_manifest->'answer_validation' AS answer_validation
         FROM interaction_turns WHERE id = $1`,
      [turnId],
    );
    assert.equal(stored.rows[0].status, 'failed');
    assert.equal(stored.rows[0].answer, null);
    assert.equal(stored.rows[0].answer_validation.verdict, 'block');
    assert.ok(stored.rows[0].answer_validation.issue_codes.includes('secret_leak'));
    assert.doesNotMatch(JSON.stringify(stored.rows[0].context_manifest), /12345678901234567890/u);
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
        dynamicProviderContextEnabled: false,
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

test('V2.2 replays the five-turn recruitment failure chain with one bounded task and all qualified audited evidence', async () => {
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
        [
          ...siteContent.projects.map((project) => `/works#${project.slug}`),
          ...(siteContent.profile.resumeFacts ?? []).map(() => '/'),
        ],
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
        [
          ...siteContent.projects.map((project) => `project:${project.slug}`),
          ...(siteContent.profile.resumeFacts ?? []).map((fact) => `resume-fact:${fact.id}`),
        ],
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
        evidenceId: string;
        evidenceLevel: string;
        projectSlug: string | null;
      }>;
      assert.deepEqual(
        projected.map((item) => item.evidenceId),
        [
          ...siteContent.projects.map((project) => `project:${project.slug}`),
          ...(siteContent.profile.resumeFacts ?? []).map((fact) => `resume-fact:${fact.id}`),
        ],
      );
      assert.ok(projected.every((item) => (
        item.evidenceLevel === 'direct' || item.evidenceLevel === 'transferable'
      )));
      for (const forbidden of step.forbiddenProjectSlugs) {
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
    const finalStep = controlledContextFailureChain.steps.at(-1)!;
    for (const { projectSlug } of finalStep.expectedEvidence) {
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

test('V2.2 project ordinal follow-up requires an adjacent successful project catalog', async () => {
  const fixture = await createFixture('context-v22-project-ordinal-follow-up');
  const provider = new ControlledAnswerProvider();
  const failedProvider = new ControlledAnswerProvider({ fail: true });
  const config = contextConfig(fixture);
  let conversationId: string | null = null;
  try {
    await seedFailureChainKnowledge();
    const firstTurnId = randomUUID();
    const first = await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        message: '请介绍与岗位最相关的项目和能力证据。',
        mode: 'interviewer',
        audienceIntent: 'recruiter',
        turnId: firstTurnId,
      }),
      config,
      now: fixtureNow,
    });
    const firstMeta = first.find((event) => event.type === 'meta');
    assert.equal(firstMeta?.type, 'meta');
    if (firstMeta?.type !== 'meta') return;
    conversationId = firstMeta.conversationId;

    const followupTurnId = randomUUID();
    await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        message: '你刚才列了三个项目。只展开第一个，说明其中最难的一次线上故障。',
        mode: 'interviewer',
        audienceIntent: 'recruiter',
        conversationId,
        turnId: followupTurnId,
      }),
      config,
      now: new Date(fixtureNow.getTime() + 1_000),
    });
    const followed = await pool.query<{
      context_manifest: { included_layers: string[]; evidence_ids: string[] };
      discourse_action: string;
      inherited_from_turn_id: string;
      semantic_intent: string;
    }>(
      `SELECT semantic_intent, discourse_action, inherited_from_turn_id::text,
              context_manifest
         FROM interaction_turns WHERE id = $1`,
      [followupTurnId],
    );
    assert.equal(followed.rows[0].semantic_intent, 'named_project_fact');
    assert.equal(followed.rows[0].discourse_action, 'follow_up');
    assert.equal(followed.rows[0].inherited_from_turn_id, firstTurnId);
    assert.ok(followed.rows[0].context_manifest.included_layers.includes('discourse_context'));
    assert.ok(followed.rows[0].context_manifest.included_layers.includes('approved_evidence'));
    assert.deepEqual(followed.rows[0].context_manifest.evidence_ids, ['project:content-agent']);

    await assert.rejects(
      collectChat({
        pool,
        provider: coordinatedProvider(failedProvider),
        accessSessionId: fixture.accessSessionId,
        request: normalizeChatRequest({
          message: '请把上一条回答压缩成一句话。',
          mode: 'interviewer',
          audienceIntent: 'recruiter',
          conversationId,
          turnId: randomUUID(),
        }),
        config,
        now: new Date(fixtureNow.getTime() + 2_000),
      }),
      (error: unknown) => error instanceof ChatServiceError
        && error.code === 'PROVIDER_UNAVAILABLE',
    );

    const afterFailureTurnId = randomUUID();
    await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        message: '你刚才列了三个项目。只展开第一个，说明其中最难的一次线上故障。',
        mode: 'interviewer',
        audienceIntent: 'recruiter',
        conversationId,
        turnId: afterFailureTurnId,
      }),
      config,
      now: new Date(fixtureNow.getTime() + 3_000),
    });
    const isolated = await pool.query<{
      context_manifest: { included_layers: string[]; evidence_ids: string[] };
      discourse_action: string;
      inherited_from_turn_id: string | null;
      semantic_intent: string;
    }>(
      `SELECT semantic_intent, discourse_action, inherited_from_turn_id::text,
              context_manifest
         FROM interaction_turns WHERE id = $1`,
      [afterFailureTurnId],
    );
    assert.equal(isolated.rows[0].discourse_action, 'one_shot');
    assert.equal(isolated.rows[0].inherited_from_turn_id, null);
    assert.equal(isolated.rows[0].context_manifest.included_layers.includes('discourse_context'), false);
    assert.deepEqual(isolated.rows[0].context_manifest.evidence_ids, []);
  } finally {
    await cleanupFixture(fixture);
  }
});

test('recruiter-chat JD projects audited Claude Code evidence into V2.2', async () => {
  const fixture = await createFixture('HR interview');
  const provider = new ControlledAnswerProvider();
  let conversationId: string | null = null;
  try {
    await seedFailureChainKnowledge();
    for (const [index, message] of [
      '请介绍与岗位最相关的项目和能力证据。',
      [
        '岗位：跨境电商产品经理（Vibe Coding 方向）',
        '岗位背景：不是传统代码机器，而是使用 AI 快速完成业务闭环。',
        '岗位要求：不要求深奥底层代码，需要使用 Claude Code 或 Cursor 独立交付网站。',
        '工作内容：接手前后端，完成 Bug 修复、功能迭代和上线维护。',
      ].join('\n'),
    ].entries()) {
      const events = await collectChat({
        pool,
        provider: coordinatedProvider(provider),
        accessSessionId: fixture.accessSessionId,
        request: normalizeChatRequest({
          workflow: 'chat',
          message,
          mode: 'interviewer',
          audienceIntent: 'recruiter',
          conversationId,
          turnId: randomUUID(),
        }),
        config: contextConfig(fixture, {
          contextCanaryInviteIds: new Set(),
          contextCanaryInviteLabels: new Set(['HR interview']),
        }),
        now: new Date(fixtureNow.getTime() + index * 1_000),
      });
      const meta = events.find((event) => event.type === 'meta');
      assert.equal(meta?.type, 'meta');
      if (meta?.type !== 'meta') return;
      conversationId ??= meta.conversationId;
      assert.equal(meta.conversationId, conversationId);
    }

    assert.equal(provider.requests.length, 2);
    const evidenceBlock = provider.requests[1].instructions.match(
      /<approved_evidence>([\s\S]*?)<\/approved_evidence>/u,
    )?.[1];
    assert.ok(evidenceBlock);
    const evidence = JSON.parse(evidenceBlock) as Array<{
      content: string;
      documentId: string;
      topicIds: string[];
    }>;
    const resumeEvidence = evidence.find((item) => item.documentId === 'resume-facts');
    assert.ok(resumeEvidence);
    assert.match(resumeEvidence.content, /使用 Claude Code、Codex、WorkBuddy 完成开发/u);
    assert.ok(resumeEvidence.topicIds.includes('claude-code'));
    assert.equal(resumeEvidence.topicIds.includes('cursor'), false);
    const boundaryBlock = provider.requests[1].instructions.match(
      /<capability_evidence_boundaries>([\s\S]*?)<\/capability_evidence_boundaries>/u,
    )?.[1];
    assert.ok(boundaryBlock);
    assert.match(boundaryBlock, /"unavailableCapabilityIds":\["cursor"\]/u);
    assert.match(boundaryBlock, /当前审核资料无证据，建议面试核验/u);
    assert.match(boundaryBlock, /不得省略/u);
    assert.match(boundaryBlock, /不得表述为“从未使用”/u);
  } finally {
    await cleanupFixture(fixture);
  }
});

test('production Vibe Coding question keeps five project sources and audited AI programming evidence', async () => {
  const fixture = await createFixture('HR interview');
  const provider = new ControlledAnswerProvider();
  try {
    await seedFailureChainKnowledge();
    const message = '岗位是跨境电商产品经理，强调 AI Native、Vibe Coding、独立站持续维护、把业务需求拆成产品方案并快速上线。请介绍与这个岗位最相关的三个项目和能力证据，只使用真实项目事实，也明确没有直接跨境电商经验这一类缺口。';
    const events = await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message,
        mode: 'interviewer',
        audienceIntent: 'recruiter',
        conversationId: null,
        turnId: randomUUID(),
      }),
      config: contextConfig(fixture, {
        contextCanaryInviteIds: new Set(),
        contextCanaryInviteLabels: new Set(['HR interview']),
      }),
      now: fixtureNow,
    });

    assert.ok(events.some((event) => event.type === 'done'));
    assert.equal(provider.requests.length, 1);
    const evidenceBlock = provider.requests[0].instructions.match(
      /<approved_evidence>([\s\S]*?)<\/approved_evidence>/u,
    )?.[1];
    assert.ok(evidenceBlock);
    const evidence = JSON.parse(evidenceBlock) as Array<{
      content: string;
      documentId: string;
      projectSlug: string | null;
      topicIds: string[];
    }>;
    assert.deepEqual(
      new Set(evidence.filter((item) => item.projectSlug).map((item) => item.projectSlug)),
      new Set(['ai-leadgen', 'auto-operations', 'content-agent', 'digital-morse', 'deep-research']),
    );
    const resumeEvidence = evidence.find((item) => item.documentId === 'resume-facts');
    assert.ok(resumeEvidence);
    assert.match(resumeEvidence.content, /使用 Claude Code、Codex、WorkBuddy 完成开发/u);
    assert.ok(resumeEvidence.topicIds.includes('ai-programming-collaboration'));
  } finally {
    await cleanupFixture(fixture);
  }
});

test('recruiter evaluation follow-ups keep the original JD and audited evidence', async () => {
  const fixture = await createFixture('HR interview');
  const provider = new ControlledAnswerProvider();
  const jobDescription = [
    '岗位：跨境电商产品经理（Vibe Coding 方向）',
    '工作内容：把业务想法转成产品方案，接手前后端并快速交付。',
    '岗位要求：使用 Claude Code，依据用户反馈和业务数据持续迭代。',
  ].join('\n');
  const messages = [
    '请介绍与岗位最相关的项目和能力证据。',
    jobDescription,
    '综合这份 JD，匹配度如何？请给三项优势和两项缺口。',
    '结合岗位要求，分析你最大的能力差距。',
    '请结合这份 JD 分析：\n1. 三项优势\n2. 两项风险',
    '请回答两个问题：\n1. 如何接手陌生代码\n2. 如何保证可回滚',
    '哪个项目最能证明你能用 Vibe Coding 独立交付？',
    '如何把跨境电商业务想法转成可执行产品方案？',
    '如何接手陌生的 AI 生成前后端代码？',
    '如何保证快速交付仍可验证、可回滚？',
    '如何在主备模型之间切换并保证可回滚？',
    '你如何适应新岗位并快速交付？',
    '你如何切换到新岗位并快速适应？',
    '切换到新岗位后，你如何快速适应并交付？',
    'Claude Code 与模型渠道的真实能力边界是什么？',
    '如何依据用户反馈和业务数据持续迭代？',
    '独立技术负责时具体承担哪些工作？',
    '当前最明显的能力差距是什么？',
    '为什么你适合 AI 产品负责人岗位？',
  ];
  const taskIds: string[] = [];
  type SlotSnapshot = {
    content_sha256: string;
    end_utf16: number;
    ordinal: number;
    slot_kind: string;
    source_message_id: string;
    start_utf16: number;
  };
  let originalSlots: SlotSnapshot[] | null = null;
  let conversationId: string | null = null;
  const testConfig = contextConfig(fixture, {
    maxMessagesPerSession: 40,
    chatWindowMaxMessages: 40,
    contextCanaryInviteIds: new Set(),
    contextCanaryInviteLabels: new Set(['HR interview']),
  });
  try {
    await seedFailureChainKnowledge();
    for (const [index, message] of messages.entries()) {
      const turnId = randomUUID();
      const events = await collectChat({
        pool,
        provider: coordinatedProvider(provider),
        accessSessionId: fixture.accessSessionId,
        request: normalizeChatRequest({
          workflow: 'chat',
          message,
          mode: 'interviewer',
          audienceIntent: 'recruiter',
          conversationId,
          turnId,
        }),
        config: testConfig,
        now: new Date(fixtureNow.getTime() + index * 1_000),
      });
      const meta = events.find((event) => event.type === 'meta');
      assert.equal(meta?.type, 'meta', message);
      if (meta?.type !== 'meta') return;
      conversationId ??= meta.conversationId;
      assert.equal(meta.conversationId, conversationId, message);

      const stored = await pool.query<{
        context_manifest: {
          context_build_status: string;
          evidence_ids: string[];
          included_layers: string[];
          projected_slot_kinds: string[];
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
      assert.equal(row.status, 'completed', message);
      taskIds.push(row.context_scope_id);
      if (index >= 2) {
        assert.equal(row.semantic_intent, index === 6 ? 'project_fit' : 'jd_match', message);
        assert.equal(row.discourse_action, 'follow_up', message);
        assert.equal(row.task_action, 'continue', message);
        assert.equal(row.context_manifest.context_build_status, 'built', message);
        assert.ok(row.context_manifest.evidence_ids.length > 0, message);
        assert.ok(meta.sources.length > 0, message);
        assert.ok(row.context_manifest.included_layers.includes('task_frame'), message);
        assert.ok(row.context_manifest.included_layers.includes('task_inputs'), message);
        assert.ok(row.context_manifest.projected_slot_kinds.includes('job_description'), message);
      }
      if (index === 1) {
        const snapshot = await pool.query<SlotSnapshot>(
          `SELECT slot_kind, ordinal, source_message_id::text,
                  start_utf16, end_utf16, content_sha256
             FROM conversation_context_slot_refs
            WHERE conversation_id = $1
            ORDER BY slot_kind, ordinal`,
          [conversationId],
        );
        originalSlots = snapshot.rows;
      }
    }

    assert.ok(conversationId);
    assert.equal(new Set(taskIds).size, 1);
    assert.ok(originalSlots);
    const slots = await pool.query<SlotSnapshot>(
      `SELECT slot_kind, ordinal, source_message_id::text,
              start_utf16, end_utf16, content_sha256
         FROM conversation_context_slot_refs
        WHERE conversation_id = $1
        ORDER BY slot_kind, ordinal`,
      [conversationId],
    );
    assert.deepEqual(slots.rows, originalSlots);
    assert.equal(provider.requests.length, messages.length);
    assert.match(provider.requests.at(-1)!.instructions, /跨境电商产品经理/u);
    assert.match(provider.requests.at(-1)!.instructions, /用户反馈和业务数据/u);

    const temporaryTurnId = randomUUID();
    const temporaryEvents = await collectChat({
      pool,
      provider: coordinatedProvider(provider),
      accessSessionId: fixture.accessSessionId,
      request: normalizeChatRequest({
        workflow: 'chat',
        message: '为什么天空是蓝色的？',
        mode: 'interviewer',
        audienceIntent: 'recruiter',
        conversationId,
        turnId: temporaryTurnId,
      }),
      config: testConfig,
      now: new Date(fixtureNow.getTime() + messages.length * 1_000),
    });
    const temporaryMeta = temporaryEvents.find((event) => event.type === 'meta');
    assert.equal(temporaryMeta?.type, 'meta');
    if (temporaryMeta?.type !== 'meta') return;
    const temporary = await pool.query<{
      context_manifest: {
        evidence_ids: string[];
        included_layers: string[];
      };
      context_scope_id: string;
      discourse_action: string;
      semantic_intent: string;
      task_action: string;
    }>(
      `SELECT semantic_intent, discourse_action, task_action,
              context_scope_id::text, context_manifest
         FROM interaction_turns
        WHERE id = $1`,
      [temporaryTurnId],
    );
    assert.deepEqual(
      {
        contextScopeId: temporary.rows[0].context_scope_id,
        discourseAction: temporary.rows[0].discourse_action,
        semanticIntent: temporary.rows[0].semantic_intent,
        taskAction: temporary.rows[0].task_action,
      },
      {
        contextScopeId: temporaryTurnId,
        discourseAction: 'one_shot',
        semanticIntent: 'general_conversation',
        taskAction: 'temporary',
      },
    );
    assert.deepEqual(temporary.rows[0].context_manifest.evidence_ids, []);
    assert.equal(temporary.rows[0].context_manifest.included_layers.includes('task_frame'), false);
    assert.equal(temporary.rows[0].context_manifest.included_layers.includes('task_inputs'), false);
    assert.deepEqual(temporaryMeta.sources, []);
    assert.equal(provider.requests.length, messages.length + 1);
  } finally {
    await cleanupFixture(fixture);
  }
});

test('an exact eight-turn HR interview chain keeps one recruitment task with JD-backed project follow-ups', async () => {
  const fixture = await createFixture('HR interview');
  const provider = new HrInterviewRegressionProvider();
  const taskIds: string[] = [];
  const taskTrace: Array<{
    discourseAction: string;
    semanticIntent: string;
    taskAction: string;
    taskId: string;
    turn: number;
  }> = [];
  let conversationId: string | null = null;
  try {
    await seedFailureChainKnowledge();
    for (const [index, step] of hrInterviewEightTurnChain.entries()) {
      const turnId = randomUUID();
      const events = await collectChat({
        pool,
        provider: coordinatedProvider(provider),
        accessSessionId: fixture.accessSessionId,
        request: normalizeChatRequest({
          workflow: 'chat',
          message: step.message,
          mode: 'interviewer',
          audienceIntent: 'recruiter',
          conversationId,
          turnId,
        }),
        config: contextConfig(fixture, {
          contextCanaryInviteIds: new Set(),
          contextCanaryInviteLabels: new Set(['HR interview']),
        }),
        now: new Date(fixtureNow.getTime() + index * 1_000),
      });
      const meta = events.find((event) => event.type === 'meta');
      assert.equal(meta?.type, 'meta', step.message);
      if (meta?.type !== 'meta') return;
      conversationId ??= meta.conversationId;
      assert.equal(meta.conversationId, conversationId, step.message);

      const stored = await pool.query<{
        context_manifest: {
          context_build_status: string;
          evidence_ids: string[];
          included_layers: string[];
          projected_slot_kinds: string[];
        };
        context_scope_id: string;
        discourse_action: string;
        execution_pipeline: string;
        semantic_intent: string;
        status: string;
        task_action: string;
      }>(
        `SELECT status, execution_pipeline, semantic_intent, discourse_action,
                task_action, context_scope_id::text, context_manifest
           FROM interaction_turns
          WHERE id = $1`,
        [turnId],
      );
      const row = stored.rows[0];
      assert.equal(row.status, 'completed', step.message);
      assert.equal(row.execution_pipeline, 'context_packet_v22', step.message);
      assert.match(row.context_scope_id, /^[0-9a-f-]{36}$/u, step.message);
      taskIds.push(row.context_scope_id);
      taskTrace.push({
        discourseAction: row.discourse_action,
        semanticIntent: row.semantic_intent,
        taskAction: row.task_action,
        taskId: row.context_scope_id,
        turn: index + 1,
      });

      const visible = events
        .filter((event): event is Extract<ChatServiceEvent, { type: 'delta' }> => event.type === 'delta')
        .map((event) => event.text)
        .join('');
      if (step.requireEvidence) {
        assert.equal(row.context_manifest.context_build_status, 'built', step.message);
        assert.ok(row.context_manifest.evidence_ids.length > 0, step.message);
        assert.ok(meta.sources.length > 0, step.message);
      }
      if (step.requireFollowUp) {
        assert.equal(row.semantic_intent, 'project_fit', step.message);
        assert.equal(row.discourse_action, 'follow_up', step.message);
        assert.equal(row.task_action, 'continue', step.message);
        assert.ok(row.context_manifest.included_layers.includes('task_frame'), step.message);
        assert.ok(row.context_manifest.included_layers.includes('task_inputs'), step.message);
        assert.ok(row.context_manifest.projected_slot_kinds.includes('job_description'), step.message);
        assert.ok(
          matchChatProjectSlugs(visible).some((slug) => (
            slug === 'ai-leadgen' || slug === 'auto-operations'
          )),
          step.message,
        );
        assert.doesNotMatch(visible, /没有可核验|无法核验|请.*(?:JD|岗位).*(?:发|提供|补充)/u);
      }
    }

    assert.deepEqual(
      taskTrace.slice(0, 2).map((item) => ({
        discourseAction: item.discourseAction,
        semanticIntent: item.semanticIntent,
        taskAction: item.taskAction,
      })),
      [
        { discourseAction: 'one_shot', semanticIntent: 'general_conversation', taskAction: 'temporary' },
        { discourseAction: 'one_shot', semanticIntent: 'general_conversation', taskAction: 'temporary' },
      ],
    );
    assert.equal(
      new Set(taskIds.slice(2)).size,
      1,
      JSON.stringify(taskTrace),
    );
    assert.notEqual(taskIds[0], taskIds[1]);
    assert.notEqual(taskIds[1], taskIds[2]);
    assert.ok(provider.requests.length >= 5);
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
        dynamicProviderContextEnabled: false,
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

test('V2.2 running-turn recovery revalidates an invalid legacy bridge after reserve commit', async () => {
  const fixture = await createFixture('context-v22-invalid-bridge-running-recovery');
  const legacyProvider = new ControlledAnswerProvider();
  const legacyTurnId = randomUUID();
  const orphanTurnId = randomUUID();
  const currentTurnId = randomUUID();
  const currentMessage = '你有什么相关的项目经验吗？';
  let conversationId: string | null = null;
  let providerCalls = 0;
  const forbiddenProvider: AiProvider = {
    async embed() {
      providerCalls += 1;
      throw new Error('invalid bridge recovery must fail before embedding');
    },
    async *streamAnswer() {
      providerCalls += 1;
      throw new Error('invalid bridge recovery must fail before Provider');
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
        dynamicProviderContextEnabled: false,
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
        encodeTurnMessage(orphanTurnId, 'ORPHAN_RECOVERY_BRIDGE_MARKER'),
        new Date(fixtureNow.getTime() + 1_000),
      ],
    );

    const client = await pool.connect();
    try {
      const reservedAt = new Date(fixtureNow.getTime() + 2_000);
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
         VALUES ($1,'user',$2,$3)`,
        [conversationId, encodeTurnMessage(currentTurnId, currentMessage), reservedAt],
      );
      await client.query(
        `UPDATE access_sessions
            SET message_count = message_count + 1, last_seen_at = $2
          WHERE id = $1`,
        [fixture.accessSessionId, reservedAt],
      );
      await insertRunningInteraction({
        client,
        turnId: currentTurnId,
        accessSessionId: fixture.accessSessionId,
        inviteLabel: 'context-v22-invalid-bridge-running-recovery',
        conversationId,
        workflow: 'chat',
        audienceIntent: 'general',
        question: currentMessage,
        executionPipeline: 'context_packet_v22',
        now: reservedAt,
        deleteAfter: new Date(reservedAt.getTime() + 10 * 24 * 60 * 60 * 1_000),
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    await assert.rejects(
      collectChat({
        pool,
        provider: forbiddenProvider,
        accessSessionId: fixture.accessSessionId,
        request: normalizeChatRequest({
          workflow: 'chat',
          message: currentMessage,
          conversationId,
          turnId: currentTurnId,
        }),
        config: contextConfig(fixture),
        now: new Date(fixtureNow.getTime() + 3_000),
      }),
      (error: unknown) => error instanceof ChatServiceError
        && error.code === 'CONVERSATION_INVALID',
    );
    assert.equal(providerCalls, 0);
    const stored = await pool.query<{
      context_build_error_code: string;
      legacy_bridge_status: string;
      status: string;
    }>(
      `SELECT status,
              context_manifest->>'context_build_error_code' AS context_build_error_code,
              context_manifest->>'legacy_bridge_status' AS legacy_bridge_status
         FROM interaction_turns
        WHERE id = $1`,
      [currentTurnId],
    );
    assert.deepEqual(stored.rows[0], {
      status: 'failed',
      context_build_error_code: 'LEGACY_BRIDGE_INVALID',
      legacy_bridge_status: 'invalid',
    });
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
      const fixture = await createFixture('HR interview');
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
          config: contextConfig(fixture, {
            ...variant.overrides,
            contextCanaryInviteIds: new Set(),
            contextCanaryInviteLabels: new Set(['HR interview']),
            dynamicProviderContextEnabled: false,
          }),
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
          config: contextConfig(fixture, { dynamicProviderContextEnabled: false }),
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
            dynamicProviderContextEnabled: false,
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
