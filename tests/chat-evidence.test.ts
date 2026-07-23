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
  assert.ok(result.knowledge.every((source) => source.documentId.startsWith('project-')));
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
