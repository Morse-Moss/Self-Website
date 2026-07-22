import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeChatRequest } from '../lib/server/chat-core.ts';
import {
  routeChatTurn,
  type RouteAnchor,
} from '../lib/server/chat-route-policy.ts';
import { compileCapabilityLedger } from '../lib/server/capability-evidence.ts';
import { chatCapabilityPolicy, siteContent } from '../lib/site-content.ts';

const ledger = compileCapabilityLedger(siteContent, chatCapabilityPolicy);

function request(message: string, audienceIntent: 'general' | 'recruiter' = 'general') {
  return normalizeChatRequest({ message, audienceIntent });
}

function projectAnchor(topicRef: string): RouteAnchor {
  return {
    turnId: '11111111-1111-4111-8111-111111111111',
    routeKind: 'grounded',
    topicKind: 'project',
    topicRef,
  };
}

const cases = [
  ['今天吃饭了吗？', 'conversation', 'none'],
  ['职场里怎么和同事处理分歧？', 'conversation', 'none'],
  ['Next.js 当前最新版本是什么？', 'external_current', 'web'],
  ['Morse 当前有哪些项目？', 'grounded', 'direct'],
  ['Kubernetes 是什么？', 'conversation', 'none'],
  ['你有 Kubernetes 生产经验吗？', 'personal_fact', 'transferable'],
] as const;

for (const [message, routeKind, evidenceClass] of cases) {
  test(`routes ${message}`, () => {
    const decision = routeChatTurn({ request: request(message), ledger });
    assert.equal(decision.routeKind, routeKind);
    assert.equal(decision.evidenceClass, evidenceClass);
  });
}

test('current question outranks audience hints and old topics', () => {
  const decision = routeChatTurn({
    request: request('今天吃什么？', 'recruiter'),
    previous: projectAnchor('digital-morse'),
    ledger,
  });

  assert.equal(decision.routeKind, 'conversation');
  assert.equal(decision.topicKind, 'none');
  assert.equal(decision.inheritedFromTurnId, null);
});

test('missing JD fit request is deterministic and provider-free', () => {
  const decision = routeChatTurn({ request: request('给我一份岗位适配度。'), ledger });

  assert.equal(decision.routeKind, 'jd_intake');
  assert.equal(decision.requiresEmbedding, false);
  assert.equal(decision.requiresSearch, false);
  assert.match(decision.deterministicReply ?? '', /完整 JD/);
});

test('explicit JD workflow and a full JD use complete grounded release', () => {
  const explicit = normalizeChatRequest({
    workflow: 'jd_match',
    jobDescription: 'Agent 工程师，负责 RAG 系统。',
    audienceIntent: 'recruiter',
  });
  const fullJd = request([
    'Agent 工程师',
    '岗位职责：负责 Agent 工作流和 RAG 系统的设计与交付。',
    '工作内容：建设 Provider 可靠性和可观测能力。',
    '任职要求：熟悉 TypeScript、PostgreSQL 和生产部署。',
    '资格要求：有复杂 AI 应用落地经验。',
  ].join('\n'));

  for (const candidate of [explicit, fullJd]) {
    const decision = routeChatTurn({ request: candidate, ledger });
    assert.equal(decision.routeKind, 'jd');
    assert.equal(decision.release, 'complete');
    assert.equal(decision.requiresEmbedding, true);
  }
});

test('only an anaphoric short follow-up inherits one persisted topic', () => {
  const previous = projectAnchor('digital-morse');
  const inherited = routeChatTurn({ request: request('这个为什么这样设计？'), previous, ledger });
  const switched = routeChatTurn({ request: request('今天吃什么？'), previous, ledger });

  assert.equal(inherited.topicRef, 'digital-morse');
  assert.equal(inherited.inheritedFromTurnId, previous.turnId);
  assert.equal(switched.inheritedFromTurnId, null);
});

test('personal history without public evidence stays unavailable', () => {
  const decision = routeChatTurn({
    request: request('你以前怎么处理同事冲突？'),
    ledger,
  });

  assert.equal(decision.routeKind, 'personal_fact');
  assert.equal(decision.evidenceClass, 'unavailable');
  assert.equal(decision.requiresSearch, false);
});
