import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  CandidateConversationTaskFrameV22,
  CompletedContextTurn,
  ResolvedChatTurn,
  ResolvedTaskSlotRef,
  SemanticIntent,
} from '../lib/contracts/chat-context.ts';
import type { KnowledgeSource } from '../lib/contracts/chat-runtime.ts';
import { projectFinalContext } from '../lib/server/chat-context-projection.ts';

const CURRENT_USER_ID = '21';
const TASK_ID = '11111111-1111-4111-8111-111111111111';

function resolved(input: {
  intent: SemanticIntent;
  taskAction: ResolvedChatTurn['semantic']['taskAction'];
  discourseAction?: ResolvedChatTurn['semantic']['discourseAction'];
  reasonCodes?: string[];
  deterministicReply?: string | null;
}): ResolvedChatTurn {
  return {
    semantic: {
      discourseAction: input.discourseAction ?? 'follow_up',
      subject: 'morse',
      intent: input.intent,
      taskAction: input.taskAction,
      referent: null,
      evidencePlan: input.intent === 'project_fit' ? ['ranked_project_fit'] : ['none'],
      confidence: 0.9,
      reasonCodes: input.reasonCodes ?? ['test_reason'],
    },
    legacyRoute: {
      routeKind: input.intent === 'project_fit' ? 'grounded' : 'conversation',
      reasonCode: 'test_reason',
      topicKind: input.intent === 'project_fit' ? 'project' : 'none',
      topicRef: null,
      evidenceClass: input.intent === 'project_fit' ? 'mixed' : 'none',
      inheritedFromTurnId: null,
      release: input.intent === 'project_fit' ? 'complete' : 'segment',
      requiresEmbedding: input.intent === 'project_fit',
      requiresSearch: false,
      deterministicReply: input.deterministicReply ?? null,
    },
  };
}

function slot(
  kind: ResolvedTaskSlotRef['slot'],
  sourceMessageId: string,
  text: string,
  ordinal = 0,
): ResolvedTaskSlotRef {
  return {
    slot: kind,
    sourceMessageId,
    startUtf16: 0,
    endUtf16: text.length,
    contentSha256: 'a'.repeat(64),
    extractorVersion: 'recruitment-slots-v1',
    ordinal,
    text,
  };
}

function frame(slots: ResolvedTaskSlotRef[]): CandidateConversationTaskFrameV22 {
  return {
    conversationId: '22222222-2222-4222-8222-222222222222',
    taskId: TASK_ID,
    expectedVersion: 3,
    taskKind: 'recruitment_evaluation',
    subjectKind: 'morse',
    subjectRef: 'recruitment',
    evidenceFocus: { topicKind: 'project', topicRef: null },
    status: 'active',
    closedReason: null,
    waitingFor: [],
    taskStartedMessageId: '11',
    slots,
  };
}

function turn(id: string, scope = TASK_ID): CompletedContextTurn {
  return {
    conversationId: '22222222-2222-4222-8222-222222222222',
    turnId: id,
    contextScopeId: scope,
    user: { id: `${id}-u`, role: 'user', text: `user-${id}` },
    assistant: { id: `${id}-a`, role: 'assistant', text: `assistant-${id}` },
    completedAt: new Date('2026-07-27T00:00:00.000Z'),
  };
}

function evidence(id: string): KnowledgeSource {
  return {
    chunkId: id,
    documentId: `doc-${id}`,
    title: `title-${id}`,
    sourcePath: `/knowledge/${id}.md`,
    href: `/works#${id}`,
    content: `evidence-${id}`,
    score: 0.9,
    projectSlug: id,
  };
}

test('follow-up continuation projects one discourse pair, current frame, same-scope history, and approved evidence', () => {
  const adjacent = turn('33333333-3333-4333-8333-333333333333');
  const older = turn('44444444-4444-4444-8444-444444444444');
  const projection = projectFinalContext({
    resolved: resolved({ intent: 'project_fit', taskAction: 'continue' }),
    currentUserMessageId: CURRENT_USER_ID,
    discourse: adjacent,
    frame: frame([
      slot('company', '11', '甲方科技'),
      slot('role', '11', 'AI 产品经理'),
    ]),
    history: [older, adjacent],
    approvedEvidence: [evidence('digital-morse')],
  });

  assert.equal(projection.discourse?.turnId, adjacent.turnId);
  assert.equal(projection.frame?.taskId, TASK_ID);
  assert.deepEqual(projection.slots.map((candidate) => candidate.slot), ['company', 'role']);
  assert.deepEqual(projection.history.map((candidate) => candidate.turnId), [older.turnId]);
  assert.deepEqual(projection.evidence.map((candidate) => candidate.projectSlug), ['digital-morse']);
  assert.deepEqual(projection.includedLayers, [
    'current_input',
    'discourse_context',
    'task_frame',
    'task_inputs',
    'task_history',
    'approved_evidence',
  ]);
});

test('switch projects only the candidate task and slots extracted from the current input', () => {
  const projection = projectFinalContext({
    resolved: resolved({
      intent: 'jd_match',
      taskAction: 'switch',
      discourseAction: 'new_task',
    }),
    currentUserMessageId: CURRENT_USER_ID,
    discourse: turn('33333333-3333-4333-8333-333333333333'),
    frame: frame([
      slot('company', '11', 'SENSITIVE_OLD_COMPANY'),
      slot('job_description', '13', 'SENSITIVE_OLD_JD'),
      slot('role', CURRENT_USER_ID, '后端工程师'),
      slot('job_description', CURRENT_USER_ID, '负责 Agent 平台'),
    ]),
    history: [turn('44444444-4444-4444-8444-444444444444')],
    approvedEvidence: [],
  });

  assert.equal(projection.discourse, null);
  assert.deepEqual(projection.slots.map((candidate) => candidate.text), ['后端工程师', '负责 Agent 平台']);
  assert.deepEqual(projection.history, []);
  assert.deepEqual(projection.evidence, []);
  assert.ok(projection.reasonCodes.includes('projection_new_task_excludes_prior_context'));
});

test('temporary and one-shot turns cannot project a saved recruitment frame or its history', () => {
  const projection = projectFinalContext({
    resolved: resolved({
      intent: 'general_conversation',
      taskAction: 'temporary',
      discourseAction: 'one_shot',
    }),
    currentUserMessageId: CURRENT_USER_ID,
    discourse: turn('33333333-3333-4333-8333-333333333333'),
    frame: frame([
      slot('company', '11', 'SENSITIVE_OLD_COMPANY'),
      slot('job_description', '13', 'SENSITIVE_OLD_JD'),
    ]),
    history: [turn('44444444-4444-4444-8444-444444444444')],
    approvedEvidence: [],
  });

  assert.equal(projection.discourse, null);
  assert.equal(projection.frame, null);
  assert.deepEqual(projection.slots, []);
  assert.deepEqual(projection.history, []);
  assert.deepEqual(projection.evidence, []);
  assert.deepEqual(projection.includedLayers, ['current_input']);
  assert.ok(projection.reasonCodes.includes('projection_temporary_isolated'));
});

test('explicit temporary follow-up projects only the adjacent discourse pair', () => {
  const adjacent = turn('33333333-3333-4333-8333-333333333333');
  const projection = projectFinalContext({
    resolved: resolved({
      intent: 'general_conversation',
      taskAction: 'temporary',
      discourseAction: 'follow_up',
      reasonCodes: ['anaphoric_conversation_followup', 'explicit_discourse_reference'],
    }),
    currentUserMessageId: CURRENT_USER_ID,
    discourse: adjacent,
    frame: frame([
      slot('company', '11', 'SENSITIVE_OLD_COMPANY'),
      slot('job_description', '13', 'SENSITIVE_OLD_JD'),
    ]),
    history: [turn('44444444-4444-4444-8444-444444444444')],
    approvedEvidence: [evidence('SENSITIVE_OLD_PROJECT')],
  });

  assert.equal(projection.discourse?.turnId, adjacent.turnId);
  assert.equal(projection.frame, null);
  assert.deepEqual(projection.slots, []);
  assert.deepEqual(projection.history, []);
  assert.deepEqual(projection.evidence, []);
  assert.deepEqual(projection.includedLayers, ['current_input', 'discourse_context']);
});

test('deterministic clarification projects no provider context', () => {
  const projection = projectFinalContext({
    resolved: resolved({
      intent: 'clarify',
      taskAction: 'wait',
      deterministicReply: '请补充岗位。',
    }),
    currentUserMessageId: CURRENT_USER_ID,
    discourse: turn('33333333-3333-4333-8333-333333333333'),
    frame: frame([slot('company', '11', '甲方科技')]),
    history: [turn('44444444-4444-4444-8444-444444444444')],
    approvedEvidence: [evidence('digital-morse')],
  });

  assert.equal(projection.frame, null);
  assert.deepEqual(projection.includedLayers, ['current_input']);
  assert.ok(projection.reasonCodes.includes('projection_deterministic_no_provider'));
});

test('provider-backed completion keeps adjacent discourse, current-task inputs, and evidence without older history', () => {
  const projection = projectFinalContext({
    resolved: resolved({ intent: 'project_fit', taskAction: 'complete' }),
    currentUserMessageId: CURRENT_USER_ID,
    discourse: turn('33333333-3333-4333-8333-333333333333'),
    frame: { ...frame([slot('role', '11', 'AI 产品经理')]), status: 'completed', closedReason: 'task_complete' },
    history: [turn('44444444-4444-4444-8444-444444444444')],
    approvedEvidence: [evidence('digital-morse')],
  });

  assert.equal(projection.frame?.status, 'completed');
  assert.equal(projection.discourse?.turnId, '33333333-3333-4333-8333-333333333333');
  assert.deepEqual(projection.history, []);
  assert.equal(projection.evidence.length, 1);
  assert.equal(projection.includedLayers.includes('task_history'), false);
  assert.ok(projection.reasonCodes.includes('projection_task_complete_minimal'));
});
