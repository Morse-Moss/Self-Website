import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatRouteDecision } from '../lib/server/chat-route-policy.ts';
import {
  resolveChatEvidence,
  type ResolveChatEvidenceInput,
} from '../lib/server/chat-evidence.ts';
import { compileCapabilityLedger } from '../lib/server/capability-evidence.ts';
import { chatCapabilityPolicy, siteContent } from '../lib/site-content.ts';
import type { KnowledgeSource } from '../lib/server/rag.ts';

const ledger = compileCapabilityLedger(siteContent, chatCapabilityPolicy);

function route(
  routeKind: ChatRouteDecision['routeKind'],
  overrides: Partial<ChatRouteDecision> = {},
): ChatRouteDecision {
  return {
    routeKind,
    reasonCode: 'test_route',
    topicKind: 'none',
    topicRef: null,
    evidenceClass: 'none',
    inheritedFromTurnId: null,
    release: 'segment',
    requiresEmbedding: false,
    requiresSearch: false,
    deterministicReply: null,
    ...overrides,
  };
}

function dependencySpies() {
  const calls = { embed: 0, retrieve: 0, search: 0 };
  const embeddingQueries: string[] = [];
  const source: KnowledgeSource = {
    chunkId: 'project-digital-morse:1',
    documentId: 'project-digital-morse',
    title: '数字摩斯',
    sourcePath: 'content/site-content.json#projects.digital-morse',
    href: '/works#digital-morse',
    content: '数字摩斯公开架构证据。',
    score: 0.9,
    projectSlug: 'digital-morse',
    topicIds: ['digital-morse', 'rag'],
  };
  return {
    embed: async (query: string) => {
      calls.embed += 1;
      embeddingQueries.push(query);
      return [1];
    },
    retrieve: async () => { calls.retrieve += 1; return [source]; },
    search: async () => {
      calls.search += 1;
      return { status: 'completed' as const, errorCode: null, results: [] };
    },
    counts: () => ({ ...calls }),
    embeddingQueries: () => [...embeddingQueries],
  };
}

function input(
  routeDecision: ChatRouteDecision,
  question: string,
  spies = dependencySpies(),
): ResolveChatEvidenceInput & {
  counts(): { embed: number; retrieve: number; search: number };
  embeddingQueries(): string[];
} {
  return {
    route: routeDecision,
    question,
    ledger,
    embed: spies.embed,
    retrieve: spies.retrieve,
    search: spies.search,
    counts: spies.counts,
    embeddingQueries: spies.embeddingQueries,
  };
}

test('conversation resolves no evidence dependency', async () => {
  const calls = input(route('conversation'), '今天吃饭了吗？');
  const result = await resolveChatEvidence(calls);

  assert.deepEqual(result, { knowledge: [], search: undefined, capability: null });
  assert.deepEqual(calls.counts(), { embed: 0, retrieve: 0, search: 0 });
});

test('external current searches without personal RAG', async () => {
  const calls = input(route('external_current', {
    topicKind: 'external',
    evidenceClass: 'web',
    requiresSearch: true,
  }), 'Next.js 当前最新版本是什么？');
  await resolveChatEvidence(calls);

  assert.deepEqual(calls.counts(), { embed: 0, retrieve: 0, search: 1 });
});

test('personal capability never uses web and exposes only ledger-backed project sources', async () => {
  const calls = input(route('personal_fact', {
    topicKind: 'capability',
    topicRef: 'kubernetes',
    evidenceClass: 'transferable',
    release: 'complete',
  }), '你有 Kubernetes 生产经验吗？');
  const result = await resolveChatEvidence(calls);

  assert.equal(result.capability?.evidenceClass, 'transferable');
  assert.equal(result.search, undefined);
  assert.ok(result.knowledge.length > 0);
  assert.ok(result.knowledge.every((source) => source.documentId.startsWith('project-') || source.documentId === 'resume-facts'));
  assert.deepEqual(calls.counts(), { embed: 0, retrieve: 0, search: 0 });
});

test('a clarification selection resolves evidence from its controlled capability topic', async () => {
  const calls = input(route('personal_fact', {
    reasonCode: 'clarification_personal_selected',
    topicKind: 'capability',
    topicRef: 'multi-agent',
    evidenceClass: 'direct',
    release: 'complete',
  }), '具体经历');
  const result = await resolveChatEvidence(calls);

  assert.equal(result.capability?.capabilityId, 'multi-agent');
  assert.equal(result.capability?.evidenceClass, 'direct');
  assert.ok(result.knowledge.some((source) => source.projectSlug === 'deep-research'));
  assert.deepEqual(calls.counts(), { embed: 0, retrieve: 0, search: 0 });
});

test('personal capability evidence resolves every named resume-backed tool', async () => {
  const calls = input(route('personal_fact', {
    topicKind: 'capability',
    topicRef: 'claude-code',
    evidenceClass: 'direct',
    release: 'complete',
  }), '你使用过 Cursor、Claude Code 和 Codex 吗？');
  const result = await resolveChatEvidence(calls);

  assert.equal(result.capabilities?.length, 3);
  assert.deepEqual(
    result.capabilities?.map((item) => [item.capabilityId, item.evidenceClass]),
    [['cursor', 'none'], ['claude-code', 'direct'], ['codex', 'direct']],
  );
  assert.ok(result.knowledge.some((source) => source.documentId === 'resume-facts'));
  assert.deepEqual(calls.counts(), { embed: 0, retrieve: 0, search: 0 });
});

test('grounded retrieval admits only the current project topic', async () => {
  const calls = input(route('grounded', {
    topicKind: 'project',
    topicRef: 'digital-morse',
    evidenceClass: 'direct',
    requiresEmbedding: true,
  }), '数字摩斯怎么实现 RAG？');
  const result = await resolveChatEvidence(calls);

  assert.deepEqual(result.knowledge.map((source) => source.projectSlug), ['digital-morse']);
  assert.deepEqual(calls.counts(), { embed: 1, retrieve: 1, search: 0 });
});

test('grounded retrieval falls back to structured project evidence when semantic results miss the routed topic', async () => {
  const calls = input(route('grounded', {
    topicKind: 'project',
    topicRef: 'content-agent',
    evidenceClass: 'direct',
    requiresEmbedding: true,
  }), 'Content Agent architecture?');
  const structured: KnowledgeSource[] = [{
    chunkId: 'project:content-agent',
    documentId: 'project-content-agent',
    title: 'Content Agent',
    sourcePath: 'content/site-content.json#projects.content-agent',
    href: '/works#content-agent',
    content: 'Public structured project evidence.',
    score: 1,
    projectSlug: 'content-agent',
    topicIds: ['content-agent'],
  }];

  const result = await resolveChatEvidence({
    ...calls,
    projectKnowledge: () => structured,
  });

  assert.deepEqual(result.knowledge, structured);
  assert.equal(result.evidenceDegraded, undefined);
  assert.deepEqual(calls.counts(), { embed: 1, retrieve: 1, search: 0 });
});

test('project collection evidence returns the full catalog without semantic dependencies', async () => {
  const calls = input(route('grounded', {
    reasonCode: 'portfolio_project_collection_query',
    topicKind: 'project',
    topicRef: null,
    evidenceClass: 'direct',
    requiresEmbedding: false,
  }), '你做过的其他项目有哪些');
  const projectKnowledge: KnowledgeSource[] = siteContent.projects.map((project) => ({
    chunkId: `project:${project.slug}`,
    documentId: `project-${project.slug}`,
    title: project.name,
    sourcePath: `content/site-content.json#projects.${project.slug}`,
    href: `/works#${project.slug}`,
    content: project.summary,
    score: 1,
    projectSlug: project.slug,
    topicIds: [project.slug],
  }));
  const result = await resolveChatEvidence({
    ...calls,
    projectKnowledge: () => projectKnowledge,
  });

  assert.deepEqual(
    result.knowledge.map((source) => source.projectSlug),
    siteContent.projects.map((project) => project.slug),
  );
  assert.deepEqual(calls.counts(), { embed: 0, retrieve: 0, search: 0 });
});

test('project experience evidence uses the complete shared audited catalog without semantic dependencies', async () => {
  const calls = input(route('grounded', {
    reasonCode: 'project_experience_query',
    topicKind: 'project',
    topicRef: null,
    evidenceClass: 'direct',
    release: 'complete',
    requiresEmbedding: false,
  }), '请讲一个真正落地过的 AI 项目，说明原流程、具体动作和结果。');
  const result = await resolveChatEvidence(calls);

  assert.deepEqual(
    result.knowledge.map((source) => source.projectSlug),
    siteContent.projects.map((project) => project.slug),
  );
  assert.match(result.knowledge[0].content, /原始业务问题：/);
  assert.match(result.knowledge[0].content, /本人职责：/);
  assert.match(result.knowledge[0].content, /关键决策：/);
  assert.match(result.knowledge[0].content, /系统结构：/);
  assert.match(result.knowledge[0].content, /验证结果：/);
  assert.match(result.knowledge[0].content, /事实边界：/);
  assert.deepEqual(calls.counts(), { embed: 0, retrieve: 0, search: 0 });
});

test('an inherited project follow-up anchors the embedding query to the persisted project', async () => {
  const calls = input(route('grounded', {
    reasonCode: 'anaphoric_project_followup',
    topicKind: 'project',
    topicRef: 'digital-morse',
    evidenceClass: 'direct',
    inheritedFromTurnId: '11111111-1111-4111-8111-111111111111',
    requiresEmbedding: true,
  }), '这个为什么这样设计？');
  const result = await resolveChatEvidence(calls);

  assert.deepEqual(result.knowledge.map((source) => source.projectSlug), ['digital-morse']);
  assert.match(calls.embeddingQueries()[0] ?? '', /数字摩斯/);
  assert.match(calls.embeddingQueries()[0] ?? '', /这个为什么这样设计/);
});

test('JD evidence supplements semantic retrieval with ledger-backed capability projects', async () => {
  const calls = input(route('jd', {
    topicKind: 'jd',
    topicRef: 'jd',
    evidenceClass: 'mixed',
    release: 'complete',
    requiresEmbedding: true,
  }), '设计 RAG，熟悉 PostgreSQL、Docker Compose；Kubernetes 生产经验优先。');
  const result = await resolveChatEvidence({
    ...calls,
    retrieve: async () => [{
      chunkId: 'project-deep-research:1',
      documentId: 'project-deep-research',
      title: '深度研究 Agent 系统',
      sourcePath: 'content/site-content.json#projects.deep-research',
      href: '/works#deep-research',
      content: '多 Agent 工作流与证据治理。',
      score: 0.9,
      projectSlug: 'deep-research',
      topicIds: ['agent'],
    }],
  });

  const digitalMorse = result.knowledge.find((source) => source.projectSlug === 'digital-morse');
  assert.ok(digitalMorse);
  assert.match(digitalMorse.content, /PostgreSQL/);
  assert.match(digitalMorse.content, /RAG/);
  assert.match(result.knowledge.map((source) => source.content).join('\n'), /不能据此确认 Kubernetes/);
});

test('grounded project evidence degrades to structured public project data when embedding fails', async () => {
  const calls = input(route('grounded', {
    topicKind: 'project',
    topicRef: 'digital-morse',
    evidenceClass: 'direct',
    requiresEmbedding: true,
  }), '数字摩斯怎么实现 RAG？');
  const structured: KnowledgeSource[] = [{
    chunkId: 'project:digital-morse',
    documentId: 'project-digital-morse',
    title: '数字摩斯',
    sourcePath: 'content/site-content.json#projects.digital-morse',
    href: '/works#digital-morse',
    content: '数字摩斯使用公开作品集证据增强回答。',
    score: 1,
    projectSlug: 'digital-morse',
    topicIds: ['digital-morse', 'rag'],
  }];

  const result = await resolveChatEvidence({
    ...calls,
    projectKnowledge: () => structured,
    embed: async () => { throw Object.assign(new Error('embedding down'), { code: 'EMBEDDING_UNAVAILABLE' }); },
  });

  assert.deepEqual(result.knowledge, structured);
  assert.equal(result.evidenceDegraded, 'embedding');
  assert.deepEqual(calls.counts(), { embed: 0, retrieve: 0, search: 0 });
});

test('JD evidence degrades to the public capability ledger when pgvector retrieval fails', async () => {
  const calls = input(route('jd', {
    topicKind: 'jd',
    topicRef: 'jd',
    evidenceClass: 'mixed',
    release: 'complete',
    requiresEmbedding: true,
  }), '设计 RAG，熟悉 PostgreSQL、Docker Compose。');

  const result = await resolveChatEvidence({
    ...calls,
    retrieve: async () => { throw Object.assign(new Error('pgvector down'), { code: 'RETRIEVAL_UNAVAILABLE' }); },
  });

  assert.equal(result.evidenceDegraded, 'retrieval');
  assert.ok(result.knowledge.some((source) => source.projectSlug === 'digital-morse'));
  assert.match(result.knowledge.map((source) => source.content).join('\n'), /PostgreSQL|RAG/);
});
