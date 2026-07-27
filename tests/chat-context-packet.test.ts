import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  CompletedContextTurn,
  ContextProjection,
  ResolvedChatTurn,
} from '../lib/contracts/chat-context.ts';
import type { KnowledgeSource } from '../lib/contracts/chat-runtime.ts';
import {
  ContextPacketBuildError,
  buildContextPacket,
  parseContextPacketDigestConfig,
  stableSerialize,
} from '../lib/server/chat-context-packet.ts';

const KEY = Buffer.alloc(32, 7);
const KEY_ID = 'context-key-v1';

function resolved(intent: ResolvedChatTurn['semantic']['intent'] = 'project_fit'): ResolvedChatTurn {
  return {
    semantic: {
      discourseAction: 'follow_up',
      subject: 'morse',
      intent,
      taskAction: 'continue',
      referent: null,
      evidencePlan: intent === 'project_fit' ? ['ranked_project_fit'] : ['none'],
      confidence: 0.9,
      reasonCodes: ['test_reason'],
    },
    legacyRoute: {
      routeKind: intent === 'project_fit' ? 'grounded' : 'conversation',
      reasonCode: 'test_reason',
      topicKind: intent === 'project_fit' ? 'project' : 'none',
      topicRef: null,
      evidenceClass: intent === 'project_fit' ? 'mixed' : 'none',
      inheritedFromTurnId: null,
      release: intent === 'project_fit' ? 'complete' : 'segment',
      requiresEmbedding: intent === 'project_fit',
      requiresSearch: false,
      deterministicReply: null,
    },
  };
}

function turn(id: string, text = id): CompletedContextTurn {
  return {
    conversationId: '11111111-1111-4111-8111-111111111111',
    turnId: id,
    contextScopeId: '22222222-2222-4222-8222-222222222222',
    user: { id: `${id}-u`, role: 'user', text: `user-${text}` },
    assistant: { id: `${id}-a`, role: 'assistant', text: `assistant-${text}` },
    completedAt: new Date('2026-07-27T00:00:00.000Z'),
  };
}

function evidence(slug: string, content = `evidence-${slug}`, score = 0.9): KnowledgeSource {
  return {
    chunkId: `project:${slug}`,
    documentId: `project-${slug}`,
    title: slug,
    sourcePath: `content/site-content.json#projects.${slug}`,
    href: `/works#${slug}`,
    content,
    score,
    projectSlug: slug,
    topicIds: [slug],
    evidenceLevel: 'direct',
  };
}

function projection(overrides: Partial<ContextProjection> = {}): ContextProjection {
  return {
    version: 'final-context-projection-v1',
    discourse: turn('33333333-3333-4333-8333-333333333333', 'adjacent'),
    frame: {
      taskId: '22222222-2222-4222-8222-222222222222',
      taskKind: 'recruitment_evaluation',
      subjectKind: 'morse',
      subjectRef: 'recruitment',
      evidenceFocus: { topicKind: 'project', topicRef: null },
      status: 'active',
      closedReason: null,
      waitingFor: [],
      taskStartedMessageId: '11',
      taskStateVersion: 2,
    },
    slots: [
      {
        slot: 'role',
        sourceMessageId: '21',
        startUtf16: 0,
        endUtf16: 6,
        contentSha256: 'a'.repeat(64),
        extractorVersion: 'recruitment-slots-v1',
        ordinal: 0,
        text: '后端工程师',
      },
      {
        slot: 'job_description',
        sourceMessageId: '11',
        startUtf16: 0,
        endUtf16: 8,
        contentSha256: 'b'.repeat(64),
        extractorVersion: 'recruitment-slots-v1',
        ordinal: 0,
        text: '负责 RAG 评测',
      },
    ],
    history: [turn('44444444-4444-4444-8444-444444444444', 'history')],
    evidence: [evidence('digital-morse')],
    includedLayers: [
      'current_input',
      'discourse_context',
      'task_frame',
      'task_inputs',
      'task_history',
      'approved_evidence',
    ],
    excludedLayers: [],
    reasonCodes: ['projection_follow_up_current_task'],
    ...overrides,
  };
}

test('stable serialization sorts object keys recursively without reordering arrays', () => {
  const left = stableSerialize({ z: 1, nested: { b: 2, a: 1 }, list: [{ y: 2, x: 1 }, 3] });
  const right = stableSerialize({ list: [{ x: 1, y: 2 }, 3], nested: { a: 1, b: 2 }, z: 1 });

  assert.deepEqual(left, right);
  assert.equal(Buffer.from(left).toString('utf8'), '{"list":[{"x":1,"y":2},3],"nested":{"a":1,"b":2},"z":1}');
});

test('generation request contains current input once and current-message slots use references', () => {
  const currentInput = 'CURRENT_INPUT_UNIQUE_MARKER';
  const built = buildContextPacket({
    resolved: resolved(),
    currentInput,
    currentUserMessageId: '21',
    projection: projection(),
    tokenBudget: 12_000,
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: 'medium',
  });
  const generation = Buffer.from(built.normal.canonicalBytes).toString('utf8');
  const packet = JSON.parse(Buffer.from(built.canonicalPacketBytes).toString('utf8')) as {
    taskInputs: Array<Record<string, unknown>>;
  };

  assert.equal(generation.split(currentInput).length - 1, 1);
  assert.equal(packet.taskInputs[0].valueSource, 'current_input');
  assert.equal(Object.hasOwn(packet.taskInputs[0], 'text'), false);
  assert.equal(packet.taskInputs[1].text, '负责 RAG 评测');
});

test('historical JD carried by discourse is referenced once instead of duplicated in task inputs', () => {
  const historicalJd = '岗'.repeat(12_000);
  const discourse: CompletedContextTurn = {
    conversationId: '11111111-1111-4111-8111-111111111111',
    turnId: '88888888-8888-4888-8888-888888888888',
    contextScopeId: '22222222-2222-4222-8222-222222222222',
    user: { id: '31', role: 'user', text: historicalJd },
    assistant: { id: '32', role: 'assistant', text: '已完成岗位初步分析。' },
    completedAt: new Date('2026-07-27T00:00:00.000Z'),
  };
  const built = buildContextPacket({
    resolved: resolved(),
    currentInput: '哪些项目最相关？',
    currentUserMessageId: '33',
    projection: projection({
      discourse,
      history: [],
      slots: [{
        slot: 'job_description',
        sourceMessageId: discourse.user.id,
        startUtf16: 0,
        endUtf16: historicalJd.length,
        contentSha256: 'c'.repeat(64),
        extractorVersion: 'recruitment-slots-v1',
        ordinal: 0,
        text: historicalJd,
      }],
    }),
    tokenBudget: 24_000,
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: null,
  });

  const generation = Buffer.from(built.normal.canonicalBytes).toString('utf8');
  assert.equal(generation.split(historicalJd).length - 1, 1);
  assert.equal(built.packet.taskInputs[0].valueSource, 'discourse_context');
  assert.equal(Object.hasOwn(built.packet.taskInputs[0], 'text'), false);
});

test('project catalog retains all audited projects while ranked project fit remains capped at three', () => {
  const catalogEvidence = ['one', 'two', 'three', 'four', 'five'].map((slug) => evidence(slug));
  const catalog = buildContextPacket({
    resolved: resolved('project_catalog'),
    currentInput: '你做过哪些项目？',
    currentUserMessageId: '21',
    projection: projection({ discourse: null, history: [], evidence: catalogEvidence }),
    tokenBudget: 12_000,
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: null,
  });
  const fit = buildContextPacket({
    resolved: resolved('project_fit'),
    currentInput: '哪些项目相关？',
    currentUserMessageId: '21',
    projection: projection({ discourse: null, history: [], evidence: catalogEvidence }),
    tokenBudget: 12_000,
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: null,
  });

  assert.equal(catalog.packet.approvedEvidence.length, 5);
  assert.equal(fit.packet.approvedEvidence.length, 3);
});

test('budget eviction removes oldest whole history turns before evidence', () => {
  const history = [
    turn('55555555-5555-4555-8555-555555555555', 'A'.repeat(900)),
    turn('66666666-6666-4666-8666-666666666666', 'B'.repeat(900)),
    turn('77777777-7777-4777-8777-777777777777', 'C'.repeat(900)),
  ];
  const built = buildContextPacket({
    resolved: resolved(),
    currentInput: '哪些项目相关？',
    currentUserMessageId: '21',
    projection: projection({ history }),
    tokenBudget: 1_100,
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: null,
  });

  assert.ok(built.manifest.evicted_layers.includes('task_history'));
  assert.ok(built.packet.taskHistory.length < history.length);
  assert.equal(built.packet.taskHistory.length % 2, 0);
  assert.equal(built.packet.approvedEvidence.length, 1);
});

test('12k chat budget rejects an uncuttable 12k CJK input while 24k JD budget accepts it once', () => {
  const currentInput = '岗'.repeat(12_000);
  const input = {
    resolved: resolved('jd_match'),
    currentInput,
    currentUserMessageId: '21',
    projection: projection({ discourse: null, history: [], evidence: [] }),
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: null,
  } as const;

  assert.throws(
    () => buildContextPacket({ ...input, tokenBudget: 12_000 }),
    (error: unknown) => error instanceof ContextPacketBuildError && error.code === 'CONTEXT_PACKET_OVER_BUDGET',
  );
  const built = buildContextPacket({ ...input, tokenBudget: 24_000 });
  const generation = Buffer.from(built.normal.canonicalBytes).toString('utf8');
  assert.equal(generation.split(currentInput).length - 1, 1);
});

test('packet and generation HMACs are domain-separated and stable across same-mode attempts', () => {
  const first = buildContextPacket({
    resolved: resolved(),
    currentInput: '哪些项目相关？',
    currentUserMessageId: '21',
    projection: projection(),
    tokenBudget: 12_000,
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: 'low',
  });
  const second = buildContextPacket({
    resolved: resolved(),
    currentInput: '哪些项目相关？',
    currentUserMessageId: '21',
    projection: projection(),
    tokenBudget: 12_000,
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: 'low',
  });

  assert.equal(first.packetHmacSha256, second.packetHmacSha256);
  assert.equal(first.normal.generationRequestHmacSha256, second.normal.generationRequestHmacSha256);
  assert.equal(first.strict.generationRequestHmacSha256, second.strict.generationRequestHmacSha256);
  assert.notEqual(first.packetHmacSha256, first.normal.generationRequestHmacSha256);
  assert.notEqual(first.normal.generationRequestHmacSha256, first.strict.generationRequestHmacSha256);
  assert.equal(first.normal.request.packetHmacSha256, first.strict.request.packetHmacSha256);
});

test('digest config requires canonical base64 with at least 32 decoded bytes and a controlled key id', () => {
  assert.equal(parseContextPacketDigestConfig({ enabled: false }), null);
  assert.deepEqual(parseContextPacketDigestConfig({
    enabled: true,
    digestKey: KEY.toString('base64'),
    digestKeyId: KEY_ID,
  }), { key: KEY, keyId: KEY_ID });

  for (const invalid of [
    { digestKey: Buffer.alloc(31).toString('base64'), digestKeyId: KEY_ID },
    { digestKey: 'not-base64', digestKeyId: KEY_ID },
    { digestKey: KEY.toString('base64'), digestKeyId: 'INVALID KEY ID' },
  ]) {
    assert.throws(
      () => parseContextPacketDigestConfig({ enabled: true, ...invalid }),
      /CONTEXT_PACKET_DIGEST_CONFIG_INVALID/u,
    );
  }
});

test('manifest is redacted even when packet layers contain sensitive markers', () => {
  const built = buildContextPacket({
    resolved: resolved(),
    currentInput: 'SENSITIVE_CURRENT_INPUT',
    currentUserMessageId: '21',
    projection: projection({
      evidence: [evidence('digital-morse', 'SENSITIVE_EVIDENCE_BODY')],
    }),
    tokenBudget: 12_000,
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: null,
  });
  const manifest = JSON.stringify(built.manifest);

  assert.doesNotMatch(manifest, /SENSITIVE_CURRENT_INPUT|SENSITIVE_EVIDENCE_BODY|负责 RAG/u);
  assert.equal(built.manifest.context_build_status, 'built');
  assert.equal(built.manifest.packet_hmac_key_id, KEY_ID);
  assert.match(built.manifest.packet_hmac_sha256 ?? '', /^[0-9a-f]{64}$/u);
});
