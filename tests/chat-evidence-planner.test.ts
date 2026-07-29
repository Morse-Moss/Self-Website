import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  CandidateConversationTaskFrameV22,
  ResolvedChatTurn,
  ResolvedTaskSlotRef,
  SemanticIntent,
} from '../lib/contracts/chat-context.ts';
import type { KnowledgeSource } from '../lib/contracts/chat-runtime.ts';
import type { ConversationSessionSnapshot } from '../lib/contracts/chat-turn-plan.ts';
import { compileCapabilityLedger } from '../lib/server/capability-evidence.ts';
import { compiledChatEvidenceCatalog } from '../lib/server/chat-evidence-catalog.ts';
import { planChatEvidence } from '../lib/server/chat-evidence-planner.ts';
import { planChatTurn } from '../lib/server/chat-turn-planner.ts';
import { chatEvidenceCatalog, siteContent } from '../lib/site-content.ts';
import { hrQaMvpChain } from './fixtures/hr-qa-mvp-chain.ts';

const ledger = compileCapabilityLedger(siteContent, chatEvidenceCatalog);

function sessionSnapshot(
  message: string,
  workflow: ConversationSessionSnapshot['workflow'] = 'jd_match',
): ConversationSessionSnapshot {
  return Object.freeze({
    conversationId: '11111111-1111-4111-8111-111111111111',
    interactionTurnId: '22222222-2222-4222-8222-222222222222',
    currentUserMessageId: '1',
    currentInput: message,
    workflow,
    mode: 'interviewer',
    audienceIntent: 'recruiter',
    pageContext: null,
    currentFrame: null,
    adjacentCompletedTurn: null,
    completedHistory: [],
    legacyBridge: [],
  });
}

function resolved(intent: SemanticIntent, referent: ResolvedChatTurn['semantic']['referent'] = null): ResolvedChatTurn {
  const plan = intent === 'project_catalog'
    ? ['approved_project_catalog'] as const
    : intent === 'project_fit' || intent === 'jd_match'
      ? ['ranked_project_fit'] as const
      : intent === 'named_project_fact'
        ? ['named_approved_project'] as const
        : intent === 'capability_fact'
          ? ['capability_ledger'] as const
          : ['none'] as const;
  return {
    semantic: {
      discourseAction: 'one_shot',
      subject: 'morse',
      intent,
      taskAction: 'temporary',
      referent,
      evidencePlan: [...plan],
      confidence: 0.9,
      reasonCodes: ['test_reason'],
    },
    legacyRoute: {
      routeKind: intent === 'jd_match' ? 'jd' : intent === 'capability_fact' ? 'personal_fact' : 'grounded',
      reasonCode: 'test_reason',
      topicKind: intent === 'capability_fact' ? 'capability' : 'project',
      topicRef: referent?.ref ?? null,
      evidenceClass: 'mixed',
      inheritedFromTurnId: null,
      release: 'complete',
      requiresEmbedding: intent === 'project_fit' || intent === 'jd_match',
      requiresSearch: false,
      deterministicReply: null,
    },
  };
}

function slot(kind: ResolvedTaskSlotRef['slot'], text: string, ordinal = 0): ResolvedTaskSlotRef {
  return {
    slot: kind,
    sourceMessageId: String(10 + ordinal),
    startUtf16: 0,
    endUtf16: text.length,
    contentSha256: 'a'.repeat(64),
    extractorVersion: 'recruitment-slots-v1',
    ordinal,
    text,
  };
}

function frame(slots: ResolvedTaskSlotRef[]): CandidateConversationTaskFrameV22 {
  return {
    conversationId: '11111111-1111-4111-8111-111111111111',
    taskId: '22222222-2222-4222-8222-222222222222',
    expectedVersion: 1,
    taskKind: 'recruitment_evaluation',
    subjectKind: 'morse',
    subjectRef: 'recruitment',
    evidenceFocus: { topicKind: 'project', topicRef: null },
    status: 'active',
    closedReason: null,
    waitingFor: [],
    taskStartedMessageId: '10',
    slots,
  };
}

function source(projectSlug: string, score: number, suffix = '1'): KnowledgeSource {
  return {
    chunkId: `project-${projectSlug}:${suffix}`,
    documentId: `project-${projectSlug}`,
    title: projectSlug,
    sourcePath: `content/site-content.json#projects.${projectSlug}`,
    href: `/works#${projectSlug}`,
    content: `retrieved-${projectSlug}-${suffix}`,
    score,
    projectSlug,
    topicIds: [projectSlug],
  };
}

function dependencies(candidates: KnowledgeSource[] = []) {
  const calls = { embed: 0, retrieve: 0, limits: [] as Array<number | undefined> };
  return {
    calls,
    embed: async () => {
      calls.embed += 1;
      return [1, 0, 0];
    },
    retrieve: async (_embedding: number[], limit?: number) => {
      calls.retrieve += 1;
      calls.limits.push(limit);
      return candidates;
    },
  };
}

test('full portfolio admission is invariant across retrieval scores and failures', async () => {
  const session = sessionSnapshot(hrQaMvpChain.jd);
  const plan = planChatTurn(session, compiledChatEvidenceCatalog);
  const approvedFingerprints: string[] = [];

  for (const mode of [
    'success-low-score',
    'empty',
    'embedding-error',
    'retrieval-error',
  ] as const) {
    const bundle = await planChatEvidence({
      plan,
      session,
      catalog: compiledChatEvidenceCatalog,
      retrieval: {
        embedAll: async () => {
          if (mode === 'embedding-error') throw new Error('embedding unavailable');
          return [[1, 0, 0]];
        },
        retrieveAll: async () => {
          if (mode === 'retrieval-error') throw new Error('retrieval unavailable');
          if (mode === 'empty') return [];
          return siteContent.projects.map((project, index) => source(
            project.slug,
            0.01 + index / 1_000,
          ));
        },
      },
    });

    assert.deepEqual(
      bundle.approved.filter((item) => item.projectSlug).map((item) => item.projectSlug),
      siteContent.projects.map((project) => project.slug),
      mode,
    );
    assert.ok(siteContent.profile.resumeFacts?.every((fact) => (
      bundle.approved.some((item) => (
        item.chunkId.includes(fact.id) || item.content.includes(fact.content)
      ))
    )), mode);
    approvedFingerprints.push(bundle.approved.map((item) => item.chunkId).join('|'));
    if (mode === 'success-low-score') {
      assert.ok(bundle.relevance.some((item) => item.score !== null && item.score < 0.45));
      assert.equal(bundle.degradedReason, null);
    } else if (mode === 'empty') {
      assert.ok(bundle.relevance.every((item) => item.score === null));
      assert.equal(bundle.degradedReason, null);
    } else {
      assert.ok(bundle.relevance.every((item) => item.score === null));
      assert.equal(bundle.degradedReason, mode === 'embedding-error' ? 'embedding' : 'retrieval');
    }
  }

  assert.equal(new Set(approvedFingerprints).size, 1);
});

test('Cursor is unavailable metadata and never becomes an approved source', async () => {
  const session = sessionSnapshot('你用过 Cursor 吗？', 'chat');
  const plan = planChatTurn(session, compiledChatEvidenceCatalog);
  const bundle = await planChatEvidence({
    plan,
    session,
    catalog: compiledChatEvidenceCatalog,
    retrieval: {
      embedAll: async () => [[1, 0, 0]],
      retrieveAll: async () => [],
    },
  });

  assert.ok(bundle.unavailableCapabilityIds.includes('cursor'));
  assert.equal(
    bundle.approved.some((item) => item.topicIds?.includes('cursor')),
    false,
  );
});

test('full portfolio preserves unavailable capability boundaries named in the JD', async () => {
  const session = sessionSnapshot(
    '岗位要求：使用 Claude Code 或 Cursor 独立交付网站。',
  );
  const plan = planChatTurn(session, compiledChatEvidenceCatalog);
  assert.equal(plan.evidence.kind, 'portfolio_full');

  const bundle = await planChatEvidence({
    plan,
    session,
    catalog: compiledChatEvidenceCatalog,
    retrieval: {
      embedAll: async () => [[1, 0, 0]],
      retrieveAll: async () => [],
    },
  });

  assert.deepEqual(bundle.unavailableCapabilityIds, ['cursor']);
  assert.equal(bundle.approved.some((item) => item.topicIds?.includes('cursor')), false);
});

test('project catalog returns the complete audited catalog without embedding', async () => {
  const deps = dependencies();
  const result = await planChatEvidence({
    resolved: resolved('project_catalog'),
    currentInput: '你做过哪些项目？',
    frame: null,
    ledger,
    embed: deps.embed,
    retrieve: deps.retrieve,
  });

  assert.deepEqual(result.knowledge.map((item) => item.projectSlug), siteContent.projects.map((project) => project.slug));
  assert.deepEqual(deps.calls, { embed: 0, retrieve: 0, limits: [] });
  assert.ok(result.knowledge.every((item) => item.evidenceLevel === 'direct'));
  for (const label of [
    '原始业务问题：',
    '本人职责：',
    '关键决策：',
    '系统结构：',
    '验证结果：',
    '事实边界：',
  ]) {
    assert.match(result.knowledge[0].content, new RegExp(label));
  }
});

test('project fit returns every stable unique threshold-qualified audited project', async () => {
  const deps = dependencies([
    source('digital-morse', 0.94, 'a'),
    source('digital-morse', 0.92, 'b'),
    source('deep-research', 0.91),
    source('content-agent', 0.84),
    source('auto-operations', 0.83),
  ]);
  const result = await planChatEvidence({
    resolved: resolved('project_fit'),
    currentInput: '哪些项目和 Agent 产品岗位相关？',
    frame: frame([slot('role', 'AI 产品经理'), slot('job_description', '负责 Agent 产品与 RAG 评测')]),
    ledger,
    embed: deps.embed,
    retrieve: deps.retrieve,
  });

  assert.deepEqual(deps.calls.limits, [undefined]);
  assert.deepEqual(result.knowledge.map((item) => item.projectSlug), [
    'digital-morse',
    'deep-research',
    'content-agent',
    'auto-operations',
  ]);
  assert.equal(new Set(result.knowledge.map((item) => item.projectSlug)).size, 4);
  assert.ok(result.knowledge.every((item) => item.content !== `retrieved-${item.projectSlug}-1`));
});

test('project fit keeps threshold-qualified direct evidence ahead of higher-scored transferable projects', async () => {
  const deps = dependencies([
    source('auto-operations', 0.97),
    source('ai-leadgen', 0.96),
    source('content-agent', 0.95),
    source('digital-morse', 0.7),
  ]);
  const result = await planChatEvidence({
    resolved: resolved('project_fit'),
    currentInput: 'AI 产品经理，需要设计 RAG 产品与评测方案',
    frame: frame([slot('role', 'AI 产品经理')]),
    ledger,
    embed: deps.embed,
    retrieve: deps.retrieve,
  });

  assert.deepEqual(result.knowledge.map((item) => item.projectSlug), [
    'digital-morse',
    'auto-operations',
    'ai-leadgen',
    'content-agent',
  ]);
  assert.equal(result.knowledge[0].evidenceLevel, 'direct');
  assert.deepEqual(result.retrievalScores.map((item) => item.evidenceId), [
    'project:digital-morse',
    'project:auto-operations',
    'project:ai-leadgen',
    'project:content-agent',
  ]);
});

test('JD match applies the same direct-first ordering before filling by retrieval score', async () => {
  const deps = dependencies([
    source('auto-operations', 0.97),
    source('ai-leadgen', 0.96),
    source('content-agent', 0.95),
    source('digital-morse', 0.7),
  ]);
  const result = await planChatEvidence({
    resolved: resolved('jd_match'),
    currentInput: '负责 RAG 产品与评测方案',
    frame: frame([slot('role', 'AI 产品经理')]),
    ledger,
    embed: deps.embed,
    retrieve: deps.retrieve,
  });

  assert.deepEqual(result.knowledge.map((item) => item.projectSlug), [
    'digital-morse',
    'auto-operations',
    'ai-leadgen',
    'content-agent',
  ]);
});

test('JD match keeps audited resume capability evidence alongside ranked projects', async () => {
  const deps = dependencies([
    source('content-agent', 0.91),
    source('digital-morse', 0.88),
  ]);
  const currentInput = '要求使用 Claude Code 或 Cursor 独立交付网站，并负责上线维护。';
  const result = await planChatEvidence({
    resolved: resolved('jd_match'),
    currentInput,
    frame: frame([slot('job_description', currentInput)]),
    ledger,
    embed: deps.embed,
    retrieve: deps.retrieve,
  });

  assert.deepEqual(
    result.knowledge.filter((item) => item.projectSlug).map((item) => item.projectSlug),
    ['content-agent', 'digital-morse'],
  );
  const resumeEvidence = result.knowledge.find((item) => item.documentId === 'resume-facts');
  assert.ok(resumeEvidence);
  assert.match(resumeEvidence.content, /使用 Claude Code、Codex、WorkBuddy 完成开发/u);
  assert.ok(resumeEvidence.topicIds?.includes('claude-code'));
  assert.equal(resumeEvidence.topicIds?.includes('cursor'), false);
  assert.ok(result.admissions.some((item) => item.evidenceId === resumeEvidence.chunkId));
  assert.deepEqual(
    result.admissions.filter((item) => item.level === 'unavailable'),
    [{
      evidenceId: null,
      level: 'unavailable',
      projectSlug: null,
      capabilityId: 'cursor',
    }],
  );
});

test('JD match maps Vibe Coding to audited AI programming collaboration evidence', async () => {
  const deps = dependencies([
    source('ai-leadgen', 0.95),
    source('auto-operations', 0.92),
    source('content-agent', 0.89),
    source('digital-morse', 0.86),
    source('deep-research', 0.83),
  ]);
  const currentInput = '岗位是跨境电商产品经理，强调 AI Native、Vibe Coding、独立站持续维护、把业务需求拆成产品方案并快速上线。请介绍与这个岗位最相关的三个项目和能力证据，只使用真实项目事实，也明确没有直接跨境电商经验这一类缺口。';
  const result = await planChatEvidence({
    resolved: resolved('jd_match'),
    currentInput,
    frame: frame([slot('job_description', currentInput)]),
    ledger,
    embed: deps.embed,
    retrieve: deps.retrieve,
  });

  assert.deepEqual(
    new Set(result.knowledge.filter((item) => item.projectSlug).map((item) => item.projectSlug)),
    new Set(['ai-leadgen', 'auto-operations', 'content-agent', 'digital-morse', 'deep-research']),
  );
  const resumeEvidence = result.knowledge.find((item) => item.documentId === 'resume-facts');
  assert.ok(resumeEvidence);
  assert.equal(resumeEvidence.chunkId, 'resume-facts:ledger:jd');
  assert.match(resumeEvidence.content, /使用 Claude Code、Codex、WorkBuddy 完成开发/u);
  assert.ok(resumeEvidence.topicIds?.includes('ai-programming-collaboration'));
});

test('JD match keeps audited resume capability evidence when no project qualifies', async () => {
  const deps = dependencies([
    source('digital-morse', 0.44),
    source('content-agent', 0.43),
  ]);
  const currentInput = '要求使用 Claude Code 或 Cursor 独立交付网站。';
  const result = await planChatEvidence({
    resolved: resolved('jd_match'),
    currentInput,
    frame: frame([slot('job_description', currentInput)]),
    ledger,
    embed: deps.embed,
    retrieve: deps.retrieve,
  });

  assert.deepEqual(result.knowledge.filter((item) => item.projectSlug), []);
  const resumeEvidence = result.knowledge.find((item) => item.documentId === 'resume-facts');
  assert.ok(resumeEvidence);
  assert.ok(resumeEvidence.topicIds?.includes('claude-code'));
  assert.equal(resumeEvidence.topicIds?.includes('cursor'), false);
  assert.deepEqual(result.retrievalScores, []);
  assert.equal(result.degradedReason, null);
});

test('multi-topic JD retrieval embeds complete smaller sections so one relevant requirement can admit evidence', async () => {
  const calls = { queries: [] as string[], retrieve: 0 };
  const currentInput = [
    '岗位：跨境电商产品经理（Vibe Coding 方向）',
    '岗位背景：重视业务闭环、上线速度与用户反馈，要求使用 AI 工具快速实现需求。',
    '岗位要求：逻辑严谨，能把复杂业务拆成可执行方案，并使用 Claude Code 独立交付 App、网站或工具。',
    '工作内容：接手现有独立站的前端和后端，完成 Bug 修复、功能迭代与部署上线。',
    '协作方式：把运营和市场提出的想法转成产品方案，快速上线并依据反馈继续迭代。',
    '评价方式：关注真实交付、用户反馈和业务闭环，不以手写代码量作为主要衡量标准。',
    '发展方向：熟悉业务后继续使用 AI 创造新的产品和工具，而不是停留在日常维护。',
  ].join('\n');
  const result = await planChatEvidence({
    resolved: resolved('jd_match'),
    currentInput,
    frame: frame([slot('job_description', currentInput)]),
    ledger,
    embed: async (query) => {
      calls.queries.push(query);
      return query.includes('前端和后端') && query.length < currentInput.length ? [1, 0, 0] : [0, 1, 0];
    },
    retrieve: async (embedding) => {
      calls.retrieve += 1;
      return embedding[0] === 1 ? [source('digital-morse', 0.88)] : [];
    },
  });

  assert.ok(calls.queries.length > 1);
  assert.equal(calls.queries.join(''), currentInput);
  assert.equal(calls.retrieve, calls.queries.length);
  assert.deepEqual(
    result.knowledge.filter((item) => item.projectSlug).map((item) => item.projectSlug),
    ['digital-morse'],
  );
});

test('more than three direct projects remain present in deterministic retrieval order', async () => {
  const deps = dependencies([
    source('deep-research', 0.91),
    source('content-agent', 0.94),
    source('auto-operations', 0.97),
    source('digital-morse', 0.93),
    source('ai-leadgen', 0.96),
  ]);
  const result = await planChatEvidence({
    resolved: resolved('project_fit'),
    currentInput: '哪些 TypeScript 项目最匹配？',
    frame: frame([slot('role', 'TypeScript 工程师')]),
    ledger,
    embed: deps.embed,
    retrieve: deps.retrieve,
  });

  assert.deepEqual(result.knowledge.filter((item) => item.projectSlug).map((item) => item.projectSlug), [
    'auto-operations',
    'ai-leadgen',
    'content-agent',
    'digital-morse',
    'deep-research',
  ]);
  assert.ok(result.knowledge.every((item) => item.evidenceLevel === 'direct'));
});

test('direct evidence below the retrieval threshold is not forced into the result', async () => {
  const deps = dependencies([
    source('auto-operations', 0.9),
    source('ai-leadgen', 0.8),
    source('digital-morse', 0.44),
  ]);
  const result = await planChatEvidence({
    resolved: resolved('project_fit'),
    currentInput: 'AI 产品经理，需要设计 RAG 产品',
    frame: frame([slot('role', 'AI 产品经理')]),
    ledger,
    embed: deps.embed,
    retrieve: deps.retrieve,
  });

  assert.deepEqual(result.knowledge.map((item) => item.projectSlug), [
    'auto-operations',
    'ai-leadgen',
  ]);
});

test('successful retrieval with no threshold-qualified project returns empty evidence', async () => {
  const deps = dependencies([
    source('digital-morse', 0.44),
    source('auto-operations', 0.43),
  ]);
  const result = await planChatEvidence({
    resolved: resolved('project_fit'),
    currentInput: 'AI 产品经理，需要设计 RAG 产品',
    frame: frame([slot('role', 'AI 产品经理')]),
    ledger,
    embed: deps.embed,
    retrieve: deps.retrieve,
  });

  assert.deepEqual(result.knowledge, []);
  assert.deepEqual(result.admissions, []);
  assert.deepEqual(result.retrievalScores, []);
  assert.equal(result.degradedReason, null);
});

test('equal project scores use audited catalog order and do not force unrelated projects', async () => {
  const deps = dependencies([
    source('digital-morse', 0.9),
    source('content-agent', 0.9),
  ]);
  const result = await planChatEvidence({
    resolved: resolved('project_fit'),
    currentInput: '哪些项目相关？',
    frame: frame([slot('role', 'AI 产品经理')]),
    ledger,
    embed: deps.embed,
    retrieve: deps.retrieve,
  });

  assert.deepEqual(result.knowledge.map((item) => item.projectSlug), ['content-agent', 'digital-morse']);
  assert.equal(result.knowledge.length, 2);
});

test('named project locks the audited slug and capability facts use only the ledger', async () => {
  const namedDeps = dependencies([source('deep-research', 0.99)]);
  const named = await planChatEvidence({
    resolved: resolved('named_project_fact', { kind: 'project', ref: 'digital-morse' }),
    currentInput: '你做过数字 Morse 项目吗？',
    frame: null,
    ledger,
    embed: namedDeps.embed,
    retrieve: namedDeps.retrieve,
  });
  assert.deepEqual(named.knowledge.map((item) => item.projectSlug), ['digital-morse']);
  assert.deepEqual(namedDeps.calls, { embed: 0, retrieve: 0, limits: [] });

  const capabilityDeps = dependencies([source('auto-operations', 0.99)]);
  const capability = await planChatEvidence({
    resolved: resolved('capability_fact', { kind: 'capability', ref: 'postgresql' }),
    currentInput: '你熟悉 PostgreSQL 吗？',
    frame: null,
    ledger,
    embed: capabilityDeps.embed,
    retrieve: capabilityDeps.retrieve,
  });
  assert.ok(capability.knowledge.length > 0);
  assert.ok(capability.knowledge.every((item) => item.topicIds?.includes('postgresql')));
  assert.deepEqual(capabilityDeps.calls, { embed: 0, retrieve: 0, limits: [] });
});

test('embedding failure degrades to structured direct or transferable projects without claiming unavailable', async () => {
  const deps = dependencies();
  const result = await planChatEvidence({
    resolved: resolved('jd_match'),
    currentInput: '后端工程师，负责 RAG，熟悉 PostgreSQL',
    frame: frame([slot('role', '后端工程师'), slot('job_description', '负责 RAG，熟悉 PostgreSQL')]),
    ledger,
    embed: async () => {
      deps.calls.embed += 1;
      throw Object.assign(new Error('embedding down'), { code: 'EMBEDDING_UNAVAILABLE' });
    },
    retrieve: deps.retrieve,
  });

  assert.equal(result.degradedReason, 'embedding');
  assert.ok(result.knowledge.length > 0);
  assert.ok(result.knowledge.every((item) => item.evidenceLevel === 'direct' || item.evidenceLevel === 'transferable'));
  assert.equal(result.admissions.some((item) => item.level === 'unavailable'), false);
  assert.equal(deps.calls.retrieve, 0);
});

test('retrieval failure degrades to structured direct or transferable projects', async () => {
  const deps = dependencies();
  const result = await planChatEvidence({
    resolved: resolved('project_fit'),
    currentInput: 'AI 产品经理，需要设计 RAG 产品',
    frame: frame([slot('role', 'AI 产品经理')]),
    ledger,
    embed: deps.embed,
    retrieve: async () => {
      deps.calls.retrieve += 1;
      throw Object.assign(new Error('retrieval down'), { code: 'RETRIEVAL_UNAVAILABLE' });
    },
  });

  assert.equal(result.degradedReason, 'retrieval');
  assert.deepEqual(result.knowledge.map((item) => item.projectSlug), ['digital-morse']);
  assert.ok(result.knowledge.every((item) => item.evidenceLevel === 'direct'));
  assert.equal(deps.calls.retrieve, 1);
});
