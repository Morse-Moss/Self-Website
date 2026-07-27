import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  CandidateConversationTaskFrameV22,
  ResolvedChatTurn,
  ResolvedTaskSlotRef,
  SemanticIntent,
} from '../lib/contracts/chat-context.ts';
import type { KnowledgeSource } from '../lib/contracts/chat-runtime.ts';
import { compileCapabilityLedger } from '../lib/server/capability-evidence.ts';
import { planChatEvidence } from '../lib/server/chat-evidence-planner.ts';
import { chatCapabilityPolicy, siteContent } from '../lib/site-content.ts';

const ledger = compileCapabilityLedger(siteContent, chatCapabilityPolicy);

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
  const calls = { embed: 0, retrieve: 0, limits: [] as number[] };
  return {
    calls,
    embed: async () => {
      calls.embed += 1;
      return [1, 0, 0];
    },
    retrieve: async (_embedding: number[], limit: number) => {
      calls.retrieve += 1;
      calls.limits.push(limit);
      return candidates;
    },
  };
}

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
});

test('project fit over-fetches 15 chunks and returns stable top three unique audited projects', async () => {
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

  assert.deepEqual(deps.calls.limits, [15]);
  assert.deepEqual(result.knowledge.map((item) => item.projectSlug), [
    'digital-morse',
    'deep-research',
    'content-agent',
  ]);
  assert.equal(new Set(result.knowledge.map((item) => item.projectSlug)).size, 3);
  assert.ok(result.knowledge.every((item) => item.content !== `retrieved-${item.projectSlug}-1`));
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
