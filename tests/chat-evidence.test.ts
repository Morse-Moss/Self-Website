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
    embed: async () => { calls.embed += 1; return [1]; },
    retrieve: async () => { calls.retrieve += 1; return [source]; },
    search: async () => {
      calls.search += 1;
      return { status: 'completed' as const, errorCode: null, results: [] };
    },
    counts: () => ({ ...calls }),
  };
}

function input(
  routeDecision: ChatRouteDecision,
  question: string,
  spies = dependencySpies(),
): ResolveChatEvidenceInput & { counts(): { embed: number; retrieve: number; search: number } } {
  return {
    route: routeDecision,
    question,
    ledger,
    embed: spies.embed,
    retrieve: spies.retrieve,
    search: spies.search,
    counts: spies.counts,
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
