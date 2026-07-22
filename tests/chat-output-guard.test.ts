import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  inspectChatAnswer,
  inspectTemplateRepetition,
} from '../lib/server/chat-output-guard.ts';
import type { ChatRouteDecision } from '../lib/server/chat-route-policy.ts';

function personalFactRoute(
  topicRef: string,
  evidenceClass: 'direct' | 'transferable' | 'unavailable',
): ChatRouteDecision {
  return {
    routeKind: 'personal_fact',
    reasonCode: 'personal_capability_query',
    topicKind: 'capability',
    topicRef,
    evidenceClass,
    inheritedFromTurnId: null,
    release: 'complete',
    requiresEmbedding: false,
    requiresSearch: false,
    deterministicReply: null,
  };
}

test('personal fact answer must mention the requested capability', () => {
  const result = inspectChatAnswer({
    answer: '我做过很多容器项目。[来源1]',
    route: personalFactRoute('kubernetes', 'transferable'),
    workflow: 'chat',
    question: '你有 Kubernetes 生产经验吗？',
    sourceCount: 1,
  });

  assert.deepEqual(result.reasons, ['answer_not_direct']);
});

test('transferable evidence cannot be upgraded to direct experience', () => {
  const result = inspectChatAnswer({
    answer: '我有 Kubernetes 生产实战经验。[来源1]',
    route: personalFactRoute('kubernetes', 'transferable'),
    workflow: 'chat',
    question: '你有 Kubernetes 生产经验吗？',
    sourceCount: 1,
  });

  assert.ok(result.reasons.includes('unsupported_evidence_upgrade'));
});

test('conversation rejects grounded and recruitment formatting', () => {
  const route: ChatRouteDecision = {
    ...personalFactRoute('kubernetes', 'unavailable'),
    routeKind: 'conversation',
    topicKind: 'none',
    topicRef: null,
    evidenceClass: 'none',
  };
  const result = inspectChatAnswer({
    answer: '根据资料，项目匹配如下：[来源1] 建议面谈核实。',
    route,
    workflow: 'chat',
    question: '今天吃饭了吗？',
    sourceCount: 1,
  });

  assert.ok(result.reasons.includes('wrong_route_format'));
});

test('different grounded questions reject the same long template answer', () => {
  const current = [
    '这个项目由我负责完整交付，先从目标和约束出发梳理架构，再通过自动化测试、失败恢复、发布冒烟和运行观测确认结果。',
    '回答只引用本轮已审核的公开证据，并明确区分已经验证的行为、仍需核实的边界和后续可以继续讨论的技术取舍。',
  ].join('');
  const result = inspectTemplateRepetition({ current, previousAnswers: [current] });

  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['template_repetition']);
});

test('guard rejects an unsolicited gap list and a fake percentage', () => {
  const result = inspectChatAnswer({
    answer: '匹配度 92%。缺少 Kubernetes、Go 和三年经验。下一步：补充简历。',
    intent: 'recruitment',
    workflow: 'chat',
    question: '哪些项目和岗位相关？',
    sourceCount: 2,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons.sort(), [
    'forced_next_step',
    'match_percentage',
    'unsolicited_gap_list',
  ]);
});

test('guard rejects invalid or missing grounded citations', () => {
  assert.deepEqual(inspectChatAnswer({
    answer: '我完成了数字摩斯的可靠性改造。[来源3]',
    intent: 'project',
    workflow: 'chat',
    question: '介绍项目。',
    sourceCount: 2,
  }).reasons, ['invalid_citation']);

  assert.deepEqual(inspectChatAnswer({
    answer: '我完成了数字摩斯的可靠性改造。',
    intent: 'project',
    workflow: 'chat',
    question: '介绍项目。',
    sourceCount: 2,
  }).reasons, ['missing_grounded_citation']);
});

test('guard bounds interview confirmations and allows explicitly requested advice', () => {
  const tooMany = inspectChatAnswer({
    answer: '建议面谈确认 A。建议面谈确认 B。建议面谈确认 C。',
    intent: 'jd',
    workflow: 'jd_match',
    question: '岗位要求如下。',
    sourceCount: 0,
  });
  assert.deepEqual(tooMany.reasons, ['too_many_interview_confirmations']);

  assert.equal(inspectChatAnswer({
    answer: '建议先看数字摩斯的可靠性设计。[来源1]',
    intent: 'project',
    workflow: 'chat',
    question: '下一步建议看什么？',
    sourceCount: 1,
  }).ok, true);
});

test('guard rejects developer voice and internal system metadata', () => {
  const result = inspectChatAnswer({
    answer: '作为开发助手，我会读取 AGENTS.md 和 MORSE_CHAT_SAFE_MODE。',
    intent: 'technical',
    workflow: 'chat',
    question: '你是谁？',
    sourceCount: 0,
  });

  assert.deepEqual(result.reasons.sort(), ['developer_assistant_voice', 'system_metadata']);
});
