import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import type {
  CompletedContextTurn,
  ConversationTaskFrameV22,
} from '../lib/contracts/chat-context.ts';
import { decideChatTaskScope } from '../lib/server/chat-task-scope.ts';

const conversationId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';

function frame(): ConversationTaskFrameV22 {
  const jobDescription = '岗位：AI 产品负责人；要求能稳定交付 Agent 产品。';
  return {
    conversationId,
    taskId,
    taskKind: 'recruitment_evaluation',
    subjectKind: 'morse',
    subjectRef: 'recruitment',
    evidenceFocus: { topicKind: 'jd', topicRef: null },
    status: 'active',
    closedReason: null,
    waitingFor: [],
    taskStartedMessageId: '1',
    lastSuccessfulMessageId: '4',
    version: 2,
    updatedByMessageId: '3',
    createdAt: new Date('2026-07-29T01:00:00.000Z'),
    updatedAt: new Date('2026-07-29T01:05:00.000Z'),
    slots: [{
      slot: 'job_description',
      sourceMessageId: '3',
      startUtf16: 0,
      endUtf16: jobDescription.length,
      contentSha256: createHash('sha256').update(jobDescription, 'utf8').digest('hex'),
      extractorVersion: 'recruitment-slots-v1',
      ordinal: 0,
      text: jobDescription,
    }],
  };
}

function adjacentTurn(): CompletedContextTurn {
  return {
    conversationId,
    turnId: '44444444-4444-4444-8444-444444444444',
    contextScopeId: taskId,
    user: { id: '3', role: 'user', text: frame().slots[0]!.text },
    assistant: { id: '4', role: 'assistant', text: '已记录岗位信息。' },
    completedAt: new Date('2026-07-29T01:05:00.000Z'),
  };
}

const recruiterContext = {
  currentFrame: frame(),
  adjacentCompletedTurn: adjacentTurn(),
  workflow: 'chat' as const,
  mode: 'interviewer' as const,
  audienceIntent: 'recruiter' as const,
};

test('active adjacent recruiter scope continues despite an unclassified professional question', () => {
  const decision = decideChatTaskScope({
    ...recruiterContext,
    contentIntent: 'general_conversation',
    independentOneShot: false,
    explicitCommand: 'none',
  });

  assert.equal(decision.taskAction, 'continue');
  assert.equal(decision.taskId, taskId);
});

test('explicit scope commands and marked independent detours are the only active-scope exits', () => {
  for (const [explicitCommand, independentOneShot, expected] of [
    ['switch', false, 'switch'],
    ['clear', false, 'wait'],
    ['complete', false, 'complete'],
    ['none', true, 'temporary'],
  ] as const) {
    const decision = decideChatTaskScope({
      ...recruiterContext,
      contentIntent: 'general_conversation',
      independentOneShot,
      explicitCommand,
    });
    assert.equal(decision.taskAction, expected);
  }
});
