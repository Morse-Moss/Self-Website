import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import type {
  CompletedContextTurn,
  ConversationTaskFrameV22,
} from '../lib/contracts/chat-context.ts';
import type { ConversationSessionSnapshot } from '../lib/contracts/chat-turn-plan.ts';
import { compiledChatEvidenceCatalog } from '../lib/server/chat-evidence-catalog.ts';
import { planChatTurn } from '../lib/server/chat-turn-planner.ts';
import { hrQaMvpChain } from './fixtures/hr-qa-mvp-chain.ts';

const conversationId = '11111111-1111-4111-8111-111111111111';
const interactionTurnId = '22222222-2222-4222-8222-222222222222';
const taskId = '33333333-3333-4333-8333-333333333333';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function recruitmentFrame(): ConversationTaskFrameV22 {
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
      endUtf16: hrQaMvpChain.jd.length,
      contentSha256: sha256(hrQaMvpChain.jd),
      extractorVersion: 'recruitment-slots-v1',
      ordinal: 0,
      text: hrQaMvpChain.jd,
    }],
  };
}

function adjacentTurn(frame: ConversationTaskFrameV22): CompletedContextTurn {
  return {
    conversationId,
    turnId: '44444444-4444-4444-8444-444444444444',
    contextScopeId: frame.taskId,
    user: { id: '3', role: 'user', text: hrQaMvpChain.jd },
    assistant: { id: '4', role: 'assistant', text: '已记录岗位信息。' },
    completedAt: new Date('2026-07-29T01:05:00.000Z'),
  };
}

function snapshot(input: {
  message: string;
  frame?: ConversationTaskFrameV22 | null;
  audienceIntent?: ConversationSessionSnapshot['audienceIntent'];
  mode?: ConversationSessionSnapshot['mode'];
  workflow?: ConversationSessionSnapshot['workflow'];
}): ConversationSessionSnapshot {
  const frame = input.frame ?? null;
  const adjacent = frame ? adjacentTurn(frame) : null;
  return Object.freeze({
    conversationId,
    interactionTurnId,
    currentUserMessageId: '5',
    currentInput: input.message,
    workflow: input.workflow ?? 'chat',
    mode: input.mode ?? (frame ? 'interviewer' : 'general'),
    audienceIntent: input.audienceIntent ?? (frame ? 'recruiter' : 'general'),
    pageContext: null,
    currentFrame: frame,
    adjacentCompletedTurn: adjacent,
    completedHistory: adjacent ? [adjacent] : [],
  });
}

test('planner maps the semantic matrix to one direct execution contract', () => {
  const frame = recruitmentFrame();
  const cases = [
    ['你是谁？', null, 'identity_fact', 'identity'],
    ['你做过哪些项目？', null, 'project_catalog', 'portfolio_full'],
    ['哪个项目最能证明你会 Vibe Coding？', frame, 'project_fit', 'portfolio_full'],
    ['你用过 Cursor 吗？', null, 'capability_fact', 'capabilities'],
    ['数字摩斯怎么实现动态上下文？', null, 'named_project_fact', 'named_projects'],
    ['为什么天空是蓝色的？', frame, 'general_conversation', 'none'],
  ] as const;
  const fakeProvider = { calls: 0 };

  for (const [message, currentFrame, intent, evidenceKind] of cases) {
    const plan = planChatTurn(snapshot({ message, frame: currentFrame }), compiledChatEvidenceCatalog);
    assert.equal(plan.semantic.intent, intent, message);
    assert.equal(plan.evidence.kind, evidenceKind, message);
    assert.equal(plan.executor.kind, 'direct');
    assert.equal('reject' in plan, false);
    assert.equal('maxTokens' in plan, false);
    assert.equal('maxEvidence' in plan, false);
    assert.ok(Object.isFrozen(plan));
  }
  assert.equal(fakeProvider.calls, 0);
});

test('all ten HR questions continue one task with full approved evidence requirements', () => {
  const frame = recruitmentFrame();

  for (const question of hrQaMvpChain.questions) {
    const plan = planChatTurn(snapshot({ message: question, frame }), compiledChatEvidenceCatalog);
    assert.equal(plan.taskId, frame.taskId, question);
    assert.equal(plan.semantic.taskAction, 'continue', question);
    assert.ok(
      plan.evidence.kind === 'portfolio_full' || plan.evidence.kind === 'capabilities',
      `${question}: ${plan.evidence.kind}`,
    );
    if (plan.evidence.kind === 'capabilities') {
      assert.equal(plan.evidence.includePortfolio, true, question);
    }
  }
});
