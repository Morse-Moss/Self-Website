import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import type { ConversationTaskFrameV22, ResolvedTaskSlotRef } from '../lib/contracts/chat-context.ts';
import { normalizeChatRequest } from '../lib/server/chat-core.ts';
import { compileCapabilityLedger } from '../lib/server/capability-evidence.ts';
import { resolveChatSemanticTurn } from '../lib/server/chat-semantic-resolver.ts';
import { chatCapabilityPolicy, siteContent } from '../lib/site-content.ts';

const ledger = compileCapabilityLedger(siteContent, chatCapabilityPolicy);
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const NEXT_TASK_ID = '33333333-3333-4333-8333-333333333333';

function request(message: string) {
  return normalizeChatRequest({ message });
}

function slot(
  kind: ResolvedTaskSlotRef['slot'],
  text: string,
  sourceMessageId: string,
  ordinal = 0,
): ResolvedTaskSlotRef {
  return {
    slot: kind,
    sourceMessageId,
    startUtf16: 0,
    endUtf16: text.length,
    contentSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    extractorVersion: 'recruitment-slots-v1',
    ordinal,
    text,
  };
}

function activeFrame(overrides: Partial<ConversationTaskFrameV22> = {}): ConversationTaskFrameV22 {
  return {
    conversationId: CONVERSATION_ID,
    taskId: TASK_ID,
    taskKind: 'recruitment_evaluation',
    subjectKind: 'morse',
    subjectRef: 'recruitment',
    evidenceFocus: { topicKind: 'none', topicRef: null },
    status: 'active',
    closedReason: null,
    waitingFor: [],
    taskStartedMessageId: '11',
    lastSuccessfulMessageId: '12',
    version: 2,
    updatedByMessageId: '11',
    createdAt: new Date('2026-07-27T00:00:00.000Z'),
    updatedAt: new Date('2026-07-27T00:01:00.000Z'),
    slots: [
      slot('company', '甲方科技', '11'),
      slot('role', 'AI 产品经理', '11'),
    ],
    ...overrides,
  };
}

function resolve(
  message: string,
  options: {
    currentFrame?: ConversationTaskFrameV22 | null;
    workflow?: 'chat' | 'jd_match';
    currentUserMessageId?: string;
  } = {},
) {
  const normalized = options.workflow === 'jd_match'
    ? normalizeChatRequest({ workflow: 'jd_match', jobDescription: message })
    : request(message);
  return resolveChatSemanticTurn({
    request: normalized,
    ledger,
    conversationId: CONVERSATION_ID,
    currentUserMessageId: options.currentUserMessageId ?? '21',
    currentFrame: options.currentFrame ?? null,
    discourseContext: null,
    legacyBridge: [],
    taskIdFactory: () => NEXT_TASK_ID,
  });
}

test('semantic resolver distinguishes catalog, fit, named project, capability, and unsupported history', () => {
  const cases = [
    ['你做过哪些项目？', null, 'project_catalog', 'portfolio_project_collection_query', false],
    ['哪些项目和这个岗位相关？', activeFrame(), 'project_fit', 'recruitment_project_fit', true],
    ['你做过数字 Morse 项目吗？', null, 'named_project_fact', 'personal_named_project_query', true],
    ['你熟悉 PostgreSQL 吗？', null, 'capability_fact', 'personal_capability_query', false],
    ['你做过支付系统吗？', null, 'unsupported_personal_history', 'personal_history_query', false],
  ] as const;

  for (const [message, frame, intent, reasonCode, requiresEmbedding] of cases) {
    const result = resolve(message, { currentFrame: frame });
    assert.equal(result.resolved.semantic.intent, intent, message);
    assert.equal(result.resolved.legacyRoute.reasonCode, reasonCode, message);
    assert.equal(result.resolved.legacyRoute.requiresEmbedding, requiresEmbedding, message);
    assert.equal(result.resolved.legacyRoute.release, 'complete', message);
  }

  assert.equal(resolve('你做过哪些项目？').resolved.semantic.evidencePlan[0], 'approved_project_catalog');
  assert.equal(resolve('你做过数字 Morse 项目吗？').resolved.semantic.referent?.ref, 'digital-morse');
  assert.equal(resolve('你熟悉 PostgreSQL 吗？').resolved.semantic.referent?.ref, 'postgresql');
});

test('recruitment context makes related project experience a Morse project-fit question', () => {
  const result = resolve('你有什么相关项目经验吗？', { currentFrame: activeFrame() });

  assert.equal(result.resolved.semantic.subject, 'morse');
  assert.equal(result.resolved.semantic.intent, 'project_fit');
  assert.equal(result.resolved.semantic.taskAction, 'continue');
  assert.equal(result.candidateFrame?.taskId, TASK_ID);
  assert.deepEqual(result.resolved.semantic.evidencePlan, ['ranked_project_fit']);
});

test('short and list-style job descriptions route without an 80-character or dual-heading requirement', () => {
  for (const message of [
    '后端工程师，负责 Agent 平台，熟悉 PostgreSQL',
    'AI Product Manager，需要设计 RAG 产品并交付评测',
    '岗位：后端工程师\n- 负责多 Agent 编排\n- 要求熟悉 TypeScript',
  ]) {
    const result = resolve(message);
    assert.equal(result.resolved.semantic.intent, 'jd_match', message);
    assert.equal(result.resolved.semantic.taskAction, 'create', message);
    assert.equal(result.candidateFrame?.taskKind, 'recruitment_evaluation', message);
    assert.ok(result.candidateFrame?.slots.some((candidate) => candidate.slot === 'job_description'), message);
  }

  for (const message of [
    '你熟悉 PostgreSQL 吗？',
    'PostgreSQL 适合什么场景？',
    '熟悉 PostgreSQL',
  ]) {
    assert.notEqual(resolve(message).resolved.semantic.intent, 'jd_match', message);
  }
});

test('slot extraction records exact UTF-16 spans and hashes for company, role, and JD', () => {
  const message = '公司：甲方科技，岗位：AI 产品经理，负责 Agent 平台，熟悉 PostgreSQL';
  const result = resolve(message, { currentUserMessageId: '31' });
  const slots = result.candidateFrame?.slots ?? [];

  assert.equal(result.resolved.semantic.intent, 'jd_match');
  for (const [kind, expected] of [
    ['company', '甲方科技'],
    ['role', 'AI 产品经理'],
  ] as const) {
    const extracted = slots.find((candidate) => candidate.slot === kind);
    assert.ok(extracted, kind);
    assert.equal(message.slice(extracted.startUtf16, extracted.endUtf16), expected);
    assert.equal(
      extracted.contentSha256,
      createHash('sha256').update(expected, 'utf8').digest('hex'),
    );
    assert.equal(extracted.sourceMessageId, '31');
  }
  assert.ok(slots.some((candidate) => candidate.slot === 'job_description'));
});

test('correction replaces named slots while incremental JD appends and deduplicates', () => {
  const current = activeFrame({
    slots: [
      slot('company', '甲方科技', '11'),
      slot('role', 'AI 产品经理', '11'),
      slot('job_description', '负责 Agent 产品', '13'),
    ],
  });
  const corrected = resolve('公司不是甲方科技，是乙方智能', { currentFrame: current });
  assert.equal(corrected.resolved.semantic.discourseAction, 'correction');
  assert.equal(corrected.candidateFrame?.taskId, TASK_ID);
  assert.deepEqual(
    corrected.candidateFrame?.slots.filter((candidate) => candidate.slot === 'company').map((candidate) => candidate.text),
    ['乙方智能'],
  );
  assert.deepEqual(
    corrected.candidateFrame?.slots.filter((candidate) => candidate.slot === 'role').map((candidate) => candidate.text),
    ['AI 产品经理'],
  );

  const appended = resolve('还要求做 RAG 评测', { currentFrame: current });
  assert.deepEqual(
    appended.candidateFrame?.slots.filter((candidate) => candidate.slot === 'job_description').map((candidate) => candidate.text),
    ['负责 Agent 产品', '还要求做 RAG 评测'],
  );
  const duplicate = resolve('负责 Agent 产品', { currentFrame: current });
  assert.equal(
    duplicate.candidateFrame?.slots.filter((candidate) => candidate.slot === 'job_description').length,
    1,
  );
});

test('explicit switch clears old slots and creates a new task while temporary chat preserves the saved frame', () => {
  const current = activeFrame({
    slots: [
      slot('company', 'SENSITIVE_OLD_COMPANY', '11'),
      slot('role', 'SENSITIVE_OLD_ROLE', '11'),
      slot('job_description', 'SENSITIVE_OLD_JD', '13'),
    ],
  });
  const switched = resolve('换个岗位：后端工程师，负责 Agent 平台', { currentFrame: current });
  assert.equal(switched.resolved.semantic.taskAction, 'switch');
  assert.equal(switched.candidateFrame?.taskId, NEXT_TASK_ID);
  assert.equal(switched.candidateFrame?.slots.some((candidate) => candidate.text.includes('SENSITIVE_OLD')), false);

  const temporary = resolve('今天吃什么？', { currentFrame: current });
  assert.equal(temporary.resolved.semantic.taskAction, 'temporary');
  assert.equal(temporary.candidateFrame, null);
});

test('explicit clearing and completion produce controlled frame transitions', () => {
  const current = activeFrame({
    slots: [
      slot('company', '甲方科技', '11'),
      slot('role', 'AI 产品经理', '11'),
      slot('job_description', '负责 Agent 产品', '13'),
    ],
  });
  const cleared = resolve('忽略前面的公司和 JD', { currentFrame: current });
  assert.equal(cleared.resolved.semantic.taskAction, 'wait');
  assert.equal(cleared.candidateFrame?.status, 'waiting_input');
  assert.deepEqual(cleared.candidateFrame?.waitingFor, ['company']);
  assert.deepEqual(cleared.candidateFrame?.slots.map((candidate) => candidate.slot), ['role']);

  const completed = resolve('就按这个岗位给出最终结论并结束', { currentFrame: current });
  assert.equal(completed.resolved.semantic.taskAction, 'complete');
  assert.equal(completed.candidateFrame?.status, 'completed');
  assert.equal(completed.candidateFrame?.closedReason, 'task_complete');
});

test('explicit jd_match replaces the whole JD and switches after a completed task', () => {
  const completed = activeFrame({ status: 'completed', closedReason: 'task_complete' });
  const result = resolve('后端工程师，负责 Agent 平台', {
    currentFrame: completed,
    workflow: 'jd_match',
  });

  assert.equal(result.resolved.semantic.intent, 'jd_match');
  assert.equal(result.resolved.semantic.taskAction, 'switch');
  assert.equal(result.candidateFrame?.taskId, NEXT_TASK_ID);
  assert.deepEqual(
    result.candidateFrame?.slots.filter((candidate) => candidate.slot === 'job_description').map((candidate) => candidate.text),
    ['后端工程师，负责 Agent 平台'],
  );
});

test('legacy bridge reconstructs recruitment slots from user messages for the first V2.2 follow-up', () => {
  const legacyBridge = [
    {
      conversationId: CONVERSATION_ID,
      turnId: '44444444-4444-4444-8444-444444444444',
      contextScopeId: '44444444-4444-4444-8444-444444444444',
      user: { id: '41', role: 'user' as const, text: '公司：甲方科技，岗位：AI 产品经理' },
      assistant: { id: '42', role: 'assistant' as const, text: 'SENSITIVE_ASSISTANT_ASSERTION' },
      completedAt: new Date('2026-07-27T00:00:00.000Z'),
    },
    {
      conversationId: CONVERSATION_ID,
      turnId: '55555555-5555-4555-8555-555555555555',
      contextScopeId: '55555555-5555-4555-8555-555555555555',
      user: { id: '43', role: 'user' as const, text: '还要求负责 Agent 产品，熟悉 RAG' },
      assistant: { id: '44', role: 'assistant' as const, text: 'SENSITIVE_ASSISTANT_EVIDENCE' },
      completedAt: new Date('2026-07-27T00:01:00.000Z'),
    },
  ];
  const result = resolveChatSemanticTurn({
    request: request('你有什么相关项目经验吗？'),
    ledger,
    conversationId: CONVERSATION_ID,
    currentUserMessageId: '45',
    currentFrame: null,
    discourseContext: legacyBridge[1],
    legacyBridge,
    taskIdFactory: () => NEXT_TASK_ID,
  });

  assert.equal(result.resolved.semantic.intent, 'project_fit');
  assert.equal(result.resolved.semantic.discourseAction, 'follow_up');
  assert.equal(result.legacyBridgeStatus, 'used');
  assert.deepEqual(result.legacyBridgeSourceTurnIds, legacyBridge.map((turn) => turn.turnId));
  assert.deepEqual(
    result.candidateFrame?.slots.map((candidate) => [candidate.slot, candidate.text]),
    [
      ['company', '甲方科技'],
      ['role', 'AI 产品经理'],
      ['job_description', '还要求负责 Agent 产品，熟悉 RAG'],
    ],
  );
  assert.equal(
    result.candidateFrame?.slots.some((candidate) => candidate.text.includes('SENSITIVE_ASSISTANT')),
    false,
  );
});

test('legacy bridge resolves equal-time rows chronologically instead of letting older slots win', () => {
  const completedAt = new Date('2026-07-27T00:00:00.000Z');
  const newer = {
    conversationId: CONVERSATION_ID,
    turnId: '55555555-5555-4555-8555-555555555555',
    contextScopeId: '55555555-5555-4555-8555-555555555555',
    user: {
      id: '43',
      role: 'user' as const,
      text: '公司不是甲方科技，而是乙方科技，岗位不是 AI 产品经理，而是 AI 产品负责人',
    },
    assistant: { id: '44', role: 'assistant' as const, text: '新回答' },
    completedAt,
  };
  const older = {
    conversationId: CONVERSATION_ID,
    turnId: '44444444-4444-4444-8444-444444444444',
    contextScopeId: '44444444-4444-4444-8444-444444444444',
    user: { id: '41', role: 'user' as const, text: '公司：甲方科技，岗位：AI 产品经理' },
    assistant: { id: '42', role: 'assistant' as const, text: '旧回答' },
    completedAt,
  };
  const result = resolveChatSemanticTurn({
    request: request('你有什么相关项目经验吗？'),
    ledger,
    conversationId: CONVERSATION_ID,
    currentUserMessageId: '45',
    currentFrame: null,
    discourseContext: newer,
    legacyBridge: [newer, older],
    taskIdFactory: () => NEXT_TASK_ID,
  });

  assert.deepEqual(
    result.candidateFrame?.slots
      .filter((slot) => slot.slot !== 'job_description')
      .map((slot) => [slot.slot, slot.text]),
    [['company', '乙方科技'], ['role', 'AI 产品负责人']],
  );
});

test('legacy bridge asks for clarification when conflicting task slots have no correction boundary', () => {
  const completedAt = new Date('2026-07-27T00:00:00.000Z');
  const result = resolveChatSemanticTurn({
    request: request('你有什么相关项目经验吗？'),
    ledger,
    conversationId: CONVERSATION_ID,
    currentUserMessageId: '45',
    currentFrame: null,
    discourseContext: null,
    legacyBridge: [
      {
        conversationId: CONVERSATION_ID,
        turnId: '44444444-4444-4444-8444-444444444444',
        contextScopeId: '44444444-4444-4444-8444-444444444444',
        user: { id: '41', role: 'user' as const, text: '公司：甲方科技，岗位：AI 产品经理' },
        assistant: { id: '42', role: 'assistant' as const, text: '旧回答' },
        completedAt,
      },
      {
        conversationId: CONVERSATION_ID,
        turnId: '55555555-5555-4555-8555-555555555555',
        contextScopeId: '55555555-5555-4555-8555-555555555555',
        user: { id: '43', role: 'user' as const, text: '公司：乙方科技，岗位：AI 产品负责人' },
        assistant: { id: '44', role: 'assistant' as const, text: '新回答' },
        completedAt,
      },
    ],
    taskIdFactory: () => NEXT_TASK_ID,
  });

  assert.equal(result.resolved.semantic.intent, 'clarify');
  assert.ok(result.resolved.legacyRoute.deterministicReply);
  assert.equal(result.candidateFrame, null);
  assert.equal(result.legacyBridgeStatus, 'ambiguous');
});

test('temporary chat leaves a captured legacy bridge untouched', () => {
  const legacyTurn = {
    conversationId: CONVERSATION_ID,
    turnId: '66666666-6666-4666-8666-666666666666',
    contextScopeId: '66666666-6666-4666-8666-666666666666',
    user: { id: '51', role: 'user' as const, text: '公司：甲方科技，岗位：AI 产品经理' },
    assistant: { id: '52', role: 'assistant' as const, text: '上一轮回答' },
    completedAt: new Date('2026-07-27T00:00:00.000Z'),
  };
  const result = resolveChatSemanticTurn({
    request: request('今天吃什么？'),
    ledger,
    conversationId: CONVERSATION_ID,
    currentUserMessageId: '53',
    currentFrame: null,
    discourseContext: legacyTurn,
    legacyBridge: [legacyTurn],
    taskIdFactory: () => NEXT_TASK_ID,
  });

  assert.equal(result.resolved.semantic.taskAction, 'temporary');
  assert.equal(result.candidateFrame, null);
  assert.equal(result.legacyBridgeStatus, 'captured');
});
