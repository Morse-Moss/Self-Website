import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildApprovedIdentityCard,
  buildPersonaInstructions,
} from '../lib/server/chat-persona.ts';
import { buildV2SystemInstructions } from '../lib/server/chat-prompt.ts';
import type { ChatRouteDecision } from '../lib/server/chat-route-policy.ts';

function conversationRoute(): ChatRouteDecision {
  return {
    routeKind: 'conversation',
    reasonCode: 'stable_general_conversation',
    topicKind: 'none',
    topicRef: null,
    evidenceClass: 'none',
    inheritedFromTurnId: null,
    release: 'segment',
    requiresEmbedding: false,
    requiresSearch: false,
    deterministicReply: null,
  };
}

function unavailablePersonalFactRoute(): ChatRouteDecision {
  return {
    routeKind: 'personal_fact',
    reasonCode: 'personal_history_query',
    topicKind: 'none',
    topicRef: null,
    evidenceClass: 'unavailable',
    inheritedFromTurnId: null,
    release: 'complete',
    requiresEmbedding: false,
    requiresSearch: false,
    deterministicReply: null,
  };
}

function jdRoute(): ChatRouteDecision {
  return {
    routeKind: 'jd',
    reasonCode: 'explicit_jd_workflow',
    topicKind: 'jd',
    topicRef: 'jd',
    evidenceClass: 'mixed',
    inheritedFromTurnId: null,
    release: 'complete',
    requiresEmbedding: true,
    requiresSearch: false,
    deterministicReply: null,
  };
}

test('conversation prompt contains no project card or recruitment template', () => {
  const prompt = buildV2SystemInstructions({
    route: conversationRoute(),
    question: '今天吃饭了吗？',
    sources: [],
  });

  assert.match(prompt, /数字 Morse/);
  assert.match(prompt, /今天吃饭了吗/);
  assert.doesNotMatch(prompt, /approved_identity_card|公开项目摘要|建议面谈核实|\[来源/);
});

test('conversation prompt makes realtime personal-state questions keep the digital boundary', () => {
  for (const question of ['今天吃饭了吗？', '最近忙什么？']) {
    const prompt = buildV2SystemInstructions({
      route: conversationRoute(),
      question,
      sources: [],
    });

    assert.match(prompt, /实时|身体状态/);
    assert.match(prompt, /数字分身/);
    assert.match(prompt, /不得像真人|不能替真人(?:\s*Morse)?确认/);
  }
});

test('personal fact prompt keeps evidence classes internal and asks for natural wording', () => {
  const prompt = buildV2SystemInstructions({
    route: unavailablePersonalFactRoute(),
    question: '你以前怎么处理同事冲突？',
    sources: [],
  });

  assert.match(prompt, /内部证据类别/);
  assert.match(prompt, /不向用户展示.*(?:标签|等级|评分)/);
  assert.match(prompt, /自然语言/);
  assert.match(prompt, /直接证据.*公开项目/);
});

test('JD prompt requires every recognized capability requirement to be addressed', () => {
  const prompt = buildV2SystemInstructions({
    route: jdRoute(),
    question: '熟悉 PostgreSQL、Docker Compose；有 Kubernetes 生产经验优先。',
    sources: [],
  });

  assert.match(prompt, /已识别.*(?:要求|能力项).*(?:逐项|遗漏)/);
  assert.match(prompt, /Kubernetes.*Docker Compose.*PostgreSQL/);
});

test('JD prompt does not invent RAG from an English word boundary', () => {
  const prompt = buildV2SystemInstructions({
    route: jdRoute(),
    question: '负责 server agent 的部署与维护。',
    sources: [],
  });

  assert.doesNotMatch(prompt, /recognized_jd_capabilities.*RAG/u);
});

test('social persona is first-person and contains no developer-assistant contract', () => {
  const prompt = buildPersonaInstructions('social');

  assert.match(prompt, /我是数字 Morse/);
  assert.match(prompt, /第一人称/);
  assert.match(prompt, /自然交流/);
  assert.doesNotMatch(prompt, /开发助手|招聘审计员|仍需补充|可执行的下一步/);
});

test('approved identity card is built only from public profile and project summaries', () => {
  const card = buildApprovedIdentityCard(['content-agent', 'digital-morse', 'deep-research']);

  assert.match(card, /Agent 系统开发者 × AI Native 实践者/);
  assert.match(card, /我把研究、内容生产、运营协作和个人知识入口/);
  assert.match(card, /内容创作 Agent 系统/);
  assert.match(card, /数字摩斯/);
  assert.doesNotMatch(card, /深度研究 Agent 系统/);
  assert.doesNotMatch(
    card,
    /morse_resume_access|resume_documents|private[\\/]resume|trustedPersonNote/i,
  );
});

test('bare identity card contains positioning without a project list', () => {
  const card = buildApprovedIdentityCard();

  assert.match(card, /公开定位/);
  assert.doesNotMatch(card, /公开项目摘要/);
});

test('persona layer changes with the current turn intent without changing identity', () => {
  const technical = buildPersonaInstructions('technical');
  const recruitment = buildPersonaInstructions('recruitment');

  assert.match(technical, /第一性原理/);
  assert.match(technical, /已实现与规划/);
  assert.match(recruitment, /证据型候选人陈述/);
  assert.match(recruitment, /岗位相关项目/);
  assert.match(technical, /我是数字 Morse/);
  assert.match(recruitment, /我是数字 Morse/);
});
