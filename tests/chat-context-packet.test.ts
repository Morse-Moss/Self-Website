import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  CanonicalAnswerSourceV2,
  CompletedContextTurn,
  ContextProjection,
  GenerationTargetBindingV2,
  GenerationVariantV2,
  ResolvedChatTurn,
} from '../lib/contracts/chat-context.ts';
import type { EvidenceBundle } from '../lib/contracts/chat-evidence-catalog.ts';
import type { KnowledgeSource } from '../lib/contracts/chat-runtime.ts';
import {
  buildTargetContextPacketV2,
  buildTargetGenerationRequestV2,
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

function v2Source(): CanonicalAnswerSourceV2 {
  return {
    schemaVersion: 'canonical-answer-source-v2',
    ownerPipeline: 'context_packet_v22',
    conversationId: '11111111-1111-4111-8111-111111111111',
    interactionTurnId: '22222222-2222-4222-8222-222222222222',
    contextScopeId: '33333333-3333-4333-8333-333333333333',
    currentUserMessageId: '44444444-4444-4444-8444-444444444444',
    currentInput: 'exact current input',
    trustedInstructions: 'trusted instructions',
    taskFrame: { task: 'analysis' },
    taskInputs: [{ slot: 'requirement', text: 'exact' }],
    approvedEvidence: [{ evidenceId: 'evidence-1', content: 'approved' }],
    completeHistory: [turn('55555555-5555-4555-8555-555555555555')],
    reasoningEffort: 'high',
    releasePolicy: 'complete',
  };
}

function v2Target(overrides: Partial<GenerationTargetBindingV2> = {}): GenerationTargetBindingV2 {
  return {
    configDigestVersion: 2,
    configDigest: 'a'.repeat(64),
    modelId: 'gpt-v2',
    protocol: 'responses',
    contextWindowTokens: 128_000,
    maxOutputTokens: null,
    reasoningEffort: 'high',
    ...overrides,
  };
}

function v2Variant(
  target: GenerationTargetBindingV2,
  revision = 1,
): GenerationVariantV2 {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    revision,
    trigger: 'initial',
    target,
  };
}

test('stable serialization sorts object keys recursively without reordering arrays', () => {
  const left = stableSerialize({ z: 1, nested: { b: 2, a: 1 }, list: [{ y: 2, x: 1 }, 3] });
  const right = stableSerialize({ list: [{ x: 1, y: 2 }, 3], nested: { a: 1, b: 2 }, z: 1 });

  assert.deepEqual(left, right);
  assert.equal(Buffer.from(left).toString('utf8'), '{"list":[{"x":1,"y":2},3],"nested":{"a":1,"b":2},"z":1}');
});

test('unavailable capabilities are protected as mandatory evidence boundaries', () => {
  const build = (capabilityEvidenceBoundaries: string[]) => buildContextPacket({
    resolved: resolved('jd_match'),
    currentInput: '需要使用 Claude Code 或 Cursor 独立交付网站。',
    currentUserMessageId: '21',
    projection: projection(),
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: 'high',
    capabilityEvidenceBoundaries,
  });
  const bounded = build(['cursor', 'cursor']);
  const unbounded = build([]);
  const instructions = bounded.normal.request.baseInstructions;

  assert.match(instructions, /<capability_evidence_boundaries>/u);
  assert.match(instructions, /"unavailableCapabilityIds":\["cursor"\]/u);
  assert.match(instructions, /当前审核资料无证据，建议面试核验/u);
  assert.match(instructions, /不得省略/u);
  assert.match(instructions, /不得表述为“从未使用”/u);
  assert.doesNotMatch(unbounded.normal.request.baseInstructions, /<capability_evidence_boundaries>/u);
  assert.notEqual(
    bounded.normal.generationRequestHmacSha256,
    unbounded.normal.generationRequestHmacSha256,
  );
});

test('context packet serializes bundle-approved evidence and current input exactly once', () => {
  const currentInput = 'exact bundle current input';
  const approved = [
    evidence('content-agent', 'approved content agent', 1),
    evidence('auto-operations', 'approved auto operations', 1),
  ];
  const bundle: EvidenceBundle = {
    catalogVersion: 2,
    approved,
    admissions: approved.map((source) => ({
      evidenceId: source.chunkId,
      level: 'direct',
      projectSlug: source.projectSlug ?? null,
      capabilityId: null,
    })),
    relevance: [
      { evidenceId: approved[0].chunkId, score: 0.12 },
      { evidenceId: approved[1].chunkId, score: null },
    ],
    unavailableCapabilityIds: [],
    degradedReason: null,
  };

  const built = buildContextPacket({
    resolved: resolved('project_fit'),
    currentInput,
    currentUserMessageId: '21',
    projection: projection({ evidence: [evidence('digital-morse', 'legacy projection')] }),
    evidenceBundle: bundle,
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: 'high',
  });
  const serialized = Buffer.from(built.canonicalPacketBytes).toString('utf8');

  for (const source of bundle.approved) {
    assert.equal(serialized.split(source.chunkId).length - 1, 1);
  }
  assert.equal(serialized.split(currentInput).length - 1, 1);
  assert.deepEqual(built.manifest.evidence_ids, approved.map((source) => source.chunkId));
  assert.deepEqual(built.manifest.retrieval_scores, bundle.relevance);
});

test('v2 packet and generation HMACs bind target capabilities, variant and exact outbound body', () => {
  const buildPacket = (target: GenerationTargetBindingV2, revision = 1) => {
    const variant = v2Variant(target, revision);
    return buildTargetContextPacketV2({
      source: v2Source(),
      target,
      variant,
      historySummary: null,
      rawHistory: v2Source().completeHistory,
      digestKey: KEY,
      digestKeyId: 'context-key-v2',
    });
  };
  const baselineTarget = v2Target();
  const baselinePacket = buildPacket(baselineTarget);
  const changedPackets = [
    buildPacket(v2Target({ configDigestVersion: 1 })),
    buildPacket(v2Target({ configDigest: 'b'.repeat(64) })),
    buildPacket(v2Target({ modelId: 'gpt-other' })),
    buildPacket(v2Target({ protocol: 'chat_completions' })),
    buildPacket(v2Target({ contextWindowTokens: 64_000 })),
    buildPacket(v2Target({ maxOutputTokens: 4_000 })),
    buildPacket(v2Target({ reasoningEffort: 'medium' })),
    buildPacket(baselineTarget, 2),
  ];
  for (const changed of changedPackets) {
    assert.notEqual(changed.packetHmacSha256, baselinePacket.packetHmacSha256);
  }

  const buildGeneration = (input: {
    target?: GenerationTargetBindingV2;
    revision?: number;
    body?: Readonly<Record<string, unknown>>;
  } = {}) => {
    const target = input.target ?? baselineTarget;
    const variant = v2Variant(target, input.revision ?? 1);
    return buildTargetGenerationRequestV2({
      variant,
      packetHmacKeyId: baselinePacket.packetHmacKeyId,
      packetHmacSha256: baselinePacket.packetHmacSha256,
      instructions: 'answer from approved evidence',
      messages: [{ role: 'user', content: 'exact current input' }],
      reasoningEffort: target.reasoningEffort,
      maxOutputTokens: target.maxOutputTokens,
      outboundBody: input.body ?? {
        model: target.modelId,
        input: [{ role: 'user', content: 'exact current input' }],
        stream: true,
      },
      digestKey: KEY,
    });
  };
  const baselineGeneration = buildGeneration();
  for (const changed of [
    buildGeneration({ revision: 2 }),
    buildGeneration({ target: v2Target({ reasoningEffort: 'medium' }) }),
    buildGeneration({ body: { model: 'gpt-v2', input: [], stream: true } }),
  ]) {
    assert.notEqual(
      changed.generationRequestHmacSha256,
      baselineGeneration.generationRequestHmacSha256,
    );
  }
  assert.equal(Object.isFrozen(baselineGeneration.request), true);
  assert.equal(Object.isFrozen(baselineGeneration.request.outboundBody), true);
  assert.equal(Object.isFrozen(baselineGeneration.request.messages), true);
});

test('generation request contains current input once and current-message slots use references', () => {
  const currentInput = 'CURRENT_INPUT_UNIQUE_MARKER';
  const built = buildContextPacket({
    resolved: resolved(),
    currentInput,
    currentUserMessageId: '21',
    projection: projection(),
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

test('canonical packet preserves task and slot source ids inside the packet HMAC', () => {
  const input = {
    resolved: resolved(),
    currentInput: '哪些项目相关？',
    currentUserMessageId: '21',
    projection: projection(),
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: null,
  } as const;
  const built = buildContextPacket(input);

  assert.equal(built.packet.taskFrame?.taskId, '22222222-2222-4222-8222-222222222222');
  assert.equal(built.packet.taskFrame?.taskStartedMessageId, '11');
  assert.deepEqual(
    built.packet.taskInputs.map((candidate) => candidate.sourceMessageId),
    ['21', '11'],
  );

  const changedTaskId = buildContextPacket({
    ...input,
    projection: projection({
      frame: {
        ...projection().frame!,
        taskId: '99999999-9999-4999-8999-999999999999',
      },
    }),
  });
  const changedStartedMessage = buildContextPacket({
    ...input,
    projection: projection({
      frame: {
        ...projection().frame!,
        taskStartedMessageId: '12',
      },
    }),
  });
  const changedSlotSource = buildContextPacket({
    ...input,
    projection: projection({
      slots: projection().slots.map((candidate, index) => (
        index === 1 ? { ...candidate, sourceMessageId: '12' } : candidate
      )),
    }),
  });

  for (const changed of [changedTaskId, changedStartedMessage, changedSlotSource]) {
    assert.notEqual(changed.packetHmacSha256, built.packetHmacSha256);
  }
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
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: null,
  });

  const generation = Buffer.from(built.normal.canonicalBytes).toString('utf8');
  assert.equal(generation.split(historicalJd).length - 1, 1);
  assert.equal(built.packet.taskInputs[0].valueSource, 'discourse_context');
  assert.equal(Object.hasOwn(built.packet.taskInputs[0], 'text'), false);
});

test('canonical packet retains all approved evidence for catalog and ranked fit', () => {
  const catalogEvidence = ['one', 'two', 'three', 'four', 'five'].map((slug) => evidence(slug));
  const catalog = buildContextPacket({
    resolved: resolved('project_catalog'),
    currentInput: '你做过哪些项目？',
    currentUserMessageId: '21',
    projection: projection({ discourse: null, history: [], evidence: catalogEvidence }),
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: null,
  });
  const fit = buildContextPacket({
    resolved: resolved('project_fit'),
    currentInput: '哪些项目相关？',
    currentUserMessageId: '21',
    projection: projection({ discourse: null, history: [], evidence: catalogEvidence }),
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: null,
  });

  assert.equal(catalog.packet.approvedEvidence.length, 5);
  assert.equal(fit.packet.approvedEvidence.length, 5);
});

test('project experience packet requires one complete audited delivery narrative', () => {
  const experienceResolved = resolved('project_catalog');
  experienceResolved.semantic.reasonCodes = ['project_experience_query'];
  experienceResolved.legacyRoute = {
    ...experienceResolved.legacyRoute,
    routeKind: 'grounded',
    reasonCode: 'project_experience_query',
    topicKind: 'project',
    evidenceClass: 'direct',
    release: 'complete',
    requiresEmbedding: false,
  };
  const built = buildContextPacket({
    resolved: experienceResolved,
    currentInput: '请讲一个真正落地过的 AI 项目，说明原流程、具体动作和结果。',
    currentUserMessageId: '21',
    projection: projection({ discourse: null, history: [], evidence: [evidence('digital-morse')] }),
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: null,
  });

  const instructions = built.normal.request.baseInstructions;
  assert.match(instructions, /只选择一个/);
  assert.match(instructions, /原始业务问题/);
  assert.match(instructions, /本人职责/);
  assert.match(instructions, /关键决策/);
  assert.match(instructions, /系统结构/);
  assert.match(instructions, /验证结果/);
  assert.match(instructions, /事实边界/);
  assert.doesNotMatch(instructions, /完整列出本轮证据中的全部公开项目/);
});

test('canonical packet preserves all whole history turns and evidence without eviction', () => {
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
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: null,
  });

  assert.deepEqual(built.manifest.evicted_layers, []);
  assert.equal(built.packet.taskHistory.length, history.length * 2);
  assert.equal(built.packet.taskHistory.length % 2, 0);
  assert.equal(built.packet.approvedEvidence.length, 1);
});

test('canonical packet preserves a long current input exactly once without a fixed budget', () => {
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

  const built = buildContextPacket(input);
  const generation = Buffer.from(built.normal.canonicalBytes).toString('utf8');
  assert.equal(generation.split(currentInput).length - 1, 1);
});

test('packet builder emits one normal request with no strict overlay', () => {
  const first = buildContextPacket({
    resolved: resolved(),
    currentInput: '哪些项目相关？',
    currentUserMessageId: '21',
    projection: projection(),
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: 'low',
  });
  const second = buildContextPacket({
    resolved: resolved(),
    currentInput: '哪些项目相关？',
    currentUserMessageId: '21',
    projection: projection(),
    digestKey: KEY,
    digestKeyId: KEY_ID,
    reasoningEffort: 'low',
  });

  assert.equal(first.packetHmacSha256, second.packetHmacSha256);
  assert.equal(first.normal.generationRequestHmacSha256, second.normal.generationRequestHmacSha256);
  assert.notEqual(first.packetHmacSha256, first.normal.generationRequestHmacSha256);
  assert.equal(first.normal.request.generationMode, 'normal');
  assert.equal(first.normal.request.overlay, null);
  assert.equal('strict' in first, false);
  assert.equal(Object.hasOwn(first.manifest.token_estimate_by_layer, 'strict_overlay'), false);
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
