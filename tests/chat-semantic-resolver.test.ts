import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import type {
  CompletedContextTurn,
  ConversationTaskFrameV22,
  ResolvedTaskSlotRef,
} from '../lib/contracts/chat-context.ts';
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

function completedTurn(overrides: Partial<CompletedContextTurn> = {}): CompletedContextTurn {
  return {
    conversationId: CONVERSATION_ID,
    turnId: '44444444-4444-4444-8444-444444444444',
    contextScopeId: '44444444-4444-4444-8444-444444444444',
    user: { id: '41', role: 'user', text: '先解释一下这个设计。' },
    assistant: { id: '42', role: 'assistant', text: '因为它能降低上下文污染。' },
    completedAt: new Date('2026-07-27T00:00:00.000Z'),
    ...overrides,
  };
}

function resolve(
  message: string,
  options: {
    currentFrame?: ConversationTaskFrameV22 | null;
    discourseContext?: CompletedContextTurn | null;
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
    discourseContext: options.discourseContext ?? null,
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
    [
      '这份岗位不是招单纯会用 AI 工具的人。请讲一个你真正落地过的 AI 项目：原来是什么业务流程，你具体做了什么，最后产生了什么结果？',
      null,
      'project_catalog',
      'project_experience_query',
      false,
    ],
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
  const experience = resolve('请分享一个你做过的 AI Agent 项目，讲清楚问题、动作和结果。');
  assert.deepEqual(experience.resolved.semantic.evidencePlan, ['approved_project_catalog']);
  assert.equal(experience.resolved.semantic.taskAction, 'temporary');
  assert.equal(experience.candidateFrame, null);
  for (const message of [
    '请介绍一下你做过的一个 AI 项目，重点说说你的职责和最终结果。',
    '介绍一个你参与过的人工智能项目，说明你的职责和产出。',
  ]) {
    const synonym = resolve(message);
    assert.equal(synonym.resolved.semantic.intent, 'project_catalog', message);
    assert.equal(synonym.resolved.legacyRoute.reasonCode, 'project_experience_query', message);
    assert.deepEqual(synonym.resolved.semantic.evidencePlan, ['approved_project_catalog'], message);
  }
  assert.notEqual(
    resolve('你认为应该如何介绍一个 AI 项目？').resolved.legacyRoute.reasonCode,
    'project_experience_query',
  );
  for (const message of [
    '一般团队在介绍一个 AI 项目时，需要说明哪些业务问题、实现和验证结果？',
    '面试时应该从哪些问题、实现和结果介绍一个 AI 项目？',
    '请讲一个行业里的 AI 项目案例，说明问题、实现和结果。',
    '请讲一个行业里真正落地过的 AI 项目案例，说明问题、实现和结果。',
    '请分享一个竞争对手做过的 AI Agent 项目，讲清楚问题、动作和结果。',
    '请介绍一个我们团队做过的 AI 项目，说明业务流程和最终结果。',
    '请举例一个公开报道里落地过的 AI 项目案例。',
    '请讲一个一般团队真正落地过的 AI 项目案例。',
    '请分享一个某个团队做过的 AI Agent 项目。',
    '请介绍一个朋友参与过的 AI 项目案例。',
    '请讲一个创业公司完成过的 AI 项目案例。',
    '请讲一个你朋友做过的 AI 项目案例。',
    '请讲一个你的团队落地过的 AI 项目案例。',
    '怎样从问题、实现和结果三个方面介绍一个 AI 项目？',
  ]) {
    const generic = resolve(message);
    assert.notEqual(generic.resolved.legacyRoute.reasonCode, 'project_experience_query', message);
    assert.notEqual(generic.resolved.semantic.intent, 'project_catalog', message);
    assert.notDeepEqual(generic.resolved.semantic.evidencePlan, ['approved_project_catalog'], message);
  }
});

test('explicit conversational follow-up keeps exactly the adjacent completed turn', () => {
  const result = resolve('为什么这么说？', { discourseContext: completedTurn() });

  assert.equal(result.resolved.semantic.intent, 'general_conversation');
  assert.equal(result.resolved.semantic.taskAction, 'temporary');
  assert.equal(result.resolved.semantic.discourseAction, 'follow_up');
  assert.ok(result.resolved.semantic.reasonCodes.includes('explicit_discourse_reference'));
});

test('named project implementation question keeps named approved project evidence semantics', () => {
  const result = resolve('数字摩斯怎么实现 RAG？');

  assert.equal(result.resolved.semantic.intent, 'named_project_fact');
  assert.equal(result.resolved.semantic.referent?.ref, 'digital-morse');
  assert.deepEqual(result.resolved.semantic.evidencePlan, ['named_approved_project']);
  assert.equal(result.resolved.legacyRoute.reasonCode, 'project_fact_query');
});

test('named project fit questions keep ranked project-fit semantics with or without an active frame', () => {
  for (const frame of [null, activeFrame()] as const) {
    const result = resolve('数字摩斯这个项目适合投 React 岗位吗？', { currentFrame: frame });

    assert.equal(result.resolved.semantic.intent, 'project_fit');
    assert.deepEqual(result.resolved.semantic.evidencePlan, ['ranked_project_fit']);
    assert.equal(result.resolved.semantic.taskAction, frame ? 'continue' : 'create');
    assert.equal(result.resolved.legacyRoute.reasonCode, 'recruitment_project_fit');
  }
});

test('recruitment context makes related project experience a Morse project-fit question', () => {
  const result = resolve('你有什么相关项目经验吗？', { currentFrame: activeFrame() });

  assert.equal(result.resolved.semantic.subject, 'morse');
  assert.equal(result.resolved.semantic.intent, 'project_fit');
  assert.equal(result.resolved.semantic.taskAction, 'continue');
  assert.equal(result.candidateFrame?.taskId, TASK_ID);
  assert.deepEqual(result.resolved.semantic.evidencePlan, ['ranked_project_fit']);
});

test('bare recheck continues an active recruitment task without becoming general conversation', () => {
  const acceptanceJd = '跟海外红人做合作式外贸，要求能全栈开发，了解自动化流程搭建，工具迭代与问题优化';
  const jdCapture = resolve(acceptanceJd, {
    currentFrame: activeFrame(),
    discourseContext: completedTurn({ contextScopeId: TASK_ID }),
  });
  const capturedJd = jdCapture.candidateFrame?.slots.find((candidate) => candidate.slot === 'job_description');
  assert.equal(jdCapture.resolved.semantic.intent, 'jd_match');
  assert.equal(capturedJd?.text, acceptanceJd);
  assert.equal(
    capturedJd?.contentSha256,
    createHash('sha256').update(acceptanceJd, 'utf8').digest('hex'),
  );

  const contextual = resolve('你再去查一下', {
    currentFrame: activeFrame({
      slots: [
        slot('role', 'AI 产品经理', '11'),
        slot('job_description', '海外红人合作式外贸，要求全栈开发和自动化流程搭建', '13'),
      ],
    }),
    discourseContext: completedTurn({ contextScopeId: TASK_ID }),
  });

  assert.equal(contextual.resolved.semantic.intent, 'project_fit');
  assert.equal(contextual.resolved.semantic.taskAction, 'continue');
  assert.equal(contextual.resolved.semantic.discourseAction, 'follow_up');
  assert.equal(contextual.resolved.legacyRoute.reasonCode, 'recruitment_context_follow_up');
  assert.equal(contextual.resolved.legacyRoute.requiresEmbedding, true);
  assert.equal(contextual.candidateFrame?.taskId, TASK_ID);
  assert.deepEqual(contextual.resolved.semantic.evidencePlan, ['ranked_project_fit']);

  const standalone = resolve('你再去查一下');
  assert.equal(standalone.resolved.semantic.intent, 'general_conversation');
  assert.equal(standalone.resolved.semantic.taskAction, 'temporary');

  const afterTemporaryTurn = resolve('重新确认一下', {
    currentFrame: activeFrame(),
    discourseContext: completedTurn({
      contextScopeId: '44444444-4444-4444-8444-444444444444',
      user: { id: '41', role: 'user', text: '查一下今天的新闻。' },
      assistant: { id: '42', role: 'assistant', text: '这是当前新闻摘要。' },
    }),
  });
  assert.equal(afterTemporaryTurn.resolved.semantic.intent, 'general_conversation');
  assert.equal(afterTemporaryTurn.resolved.semantic.taskAction, 'temporary');

  const waitingForJd = resolve('你再去查一下', {
    currentFrame: activeFrame({ status: 'waiting_input', waitingFor: ['job_description'] }),
    discourseContext: completedTurn({ contextScopeId: TASK_ID }),
  });
  assert.equal(waitingForJd.resolved.semantic.intent, 'general_conversation');
  assert.equal(waitingForJd.resolved.semantic.taskAction, 'temporary');
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

test('explicit JD workflow treats negative wording as job data instead of conversation control', () => {
  const message = [
    '岗位：跨境电商产品经理（Vibe Coding 方向）',
    '岗位背景：不是按部就班的传统代码机器。',
    '岗位要求：不要求深奥的底层代码能力，需要使用 Claude Code 独立交付网站或工具。',
    '工作内容：接手前后端，完成 Bug 修复和功能迭代，不只做日常修补。',
  ].join('\n');
  const result = resolve(message, { workflow: 'jd_match' });

  assert.equal(result.resolved.semantic.intent, 'jd_match');
  assert.equal(result.resolved.semantic.taskAction, 'create');
  assert.equal(result.resolved.semantic.discourseAction, 'new_task');
  assert.equal(result.candidateFrame?.taskKind, 'jd_match');
  assert.deepEqual(result.candidateFrame?.slots.map((candidate) => candidate.slot), ['job_description']);
  assert.equal(result.candidateFrame?.slots[0]?.text, message);
});

test('recruiter chat treats a full JD after the starter turn as data instead of correction', () => {
  const message = [
    '岗位：跨境电商产品经理（Vibe Coding 方向）',
    '岗位背景：不是按部就班的传统代码机器，而是使用 AI 快速完成业务闭环。',
    '岗位要求：不要求深奥的底层代码能力，需要使用 Claude Code 独立交付网站或工具。',
    '工作内容：接手前后端，完成 Bug 修复和功能迭代，不只做日常修补。',
  ].join('\n');
  const result = resolve(message, { currentFrame: activeFrame() });

  assert.equal(result.resolved.semantic.intent, 'jd_match');
  assert.equal(result.resolved.semantic.taskAction, 'continue');
  assert.equal(result.resolved.semantic.discourseAction, 'follow_up');
  assert.equal(result.candidateFrame?.taskId, TASK_ID);
  assert.equal(
    result.candidateFrame?.slots.find((candidate) => candidate.slot === 'job_description')?.text,
    message,
  );
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

test('project experience keeps its explicit intent when the first V2.2 turn bridges legacy history', () => {
  const message = '请讲一个真正落地过的 AI 项目，说明原流程、具体动作和结果。';
  const legacyTurn = completedTurn({
    user: { id: '61', role: 'user', text: message },
    assistant: { id: '62', role: 'assistant', text: '旧链路回答' },
  });
  const result = resolveChatSemanticTurn({
    request: normalizeChatRequest({
      message,
      mode: 'interviewer',
      audienceIntent: 'recruiter',
    }),
    ledger,
    conversationId: CONVERSATION_ID,
    currentUserMessageId: '63',
    currentFrame: null,
    discourseContext: null,
    legacyBridge: [legacyTurn],
    taskIdFactory: () => NEXT_TASK_ID,
  });

  assert.equal(result.resolved.semantic.intent, 'project_catalog');
  assert.equal(result.resolved.legacyRoute.reasonCode, 'project_experience_query');
  assert.equal(result.resolved.semantic.taskAction, 'temporary');
  assert.equal(result.candidateFrame, null);
});
