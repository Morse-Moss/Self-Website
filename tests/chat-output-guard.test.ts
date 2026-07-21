import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inspectChatAnswer } from '../lib/server/chat-output-guard.ts';

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
