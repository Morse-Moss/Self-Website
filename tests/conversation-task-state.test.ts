import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatRouteDecision } from '../lib/contracts/chat-runtime.ts';
import {
  applyTaskState,
  deriveTaskStateTransition,
  taskStateRequiresWrite,
  type ConversationTaskState,
} from '../lib/server/conversation-task-state.ts';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const START_TURN_ID = '22222222-2222-4222-8222-222222222222';
const SUCCESS_TURN_ID = '33333333-3333-4333-8333-333333333333';

function route(input: Partial<ChatRouteDecision> & Pick<ChatRouteDecision, 'routeKind'>): ChatRouteDecision {
  return {
    reasonCode: 'test_reason',
    topicKind: 'none',
    topicRef: null,
    evidenceClass: 'none',
    inheritedFromTurnId: null,
    release: 'segment',
    requiresEmbedding: false,
    requiresSearch: false,
    safetyBoundary: null,
    ...input,
  };
}

function taskState(input: Partial<ConversationTaskState> = {}): ConversationTaskState {
  return {
    conversationId: '44444444-4444-4444-8444-444444444444',
    taskId: TASK_ID,
    taskKind: 'project_discussion',
    topicKind: 'project',
    topicRef: 'digital-morse',
    status: 'active',
    waitingFor: [],
    taskStartedTurnId: START_TURN_ID,
    lastSuccessfulTurnId: SUCCESS_TURN_ID,
    version: 3,
    updatedByTurnId: SUCCESS_TURN_ID,
    createdAt: new Date('2026-07-27T00:00:00.000Z'),
    updatedAt: new Date('2026-07-27T00:01:00.000Z'),
    activeTopicKind: 'project',
    activeTopicRef: 'digital-morse',
    ...input,
  };
}

test('deriveTaskStateTransition: conversation, identity and clarify do not create a Task Frame', () => {
  for (const decision of [
    route({ routeKind: 'conversation', reasonCode: 'stable_general_conversation' }),
    route({ routeKind: 'identity', reasonCode: 'identity_query' }),
    route({ routeKind: 'clarify', reasonCode: 'anaphoric_topic_unavailable' }),
  ]) {
    const transition = deriveTaskStateTransition(decision, null);
    assert.equal(transition.action, 'continue');
    assert.equal(transition.next, null);
    assert.equal(taskStateRequiresWrite(null, transition), false);
  }
});

test('deriveTaskStateTransition: a conversation detour preserves an existing Task Frame without writing it', () => {
  const current = taskState();
  const transition = deriveTaskStateTransition(
    route({ routeKind: 'conversation', reasonCode: 'stable_general_conversation' }),
    current,
  );

  assert.equal(transition.action, 'continue');
  assert.equal(transition.next, current);
  assert.equal(taskStateRequiresWrite(current, transition), false);
});

test('deriveTaskStateTransition: a new project creates the complete Task Frame candidate', () => {
  const current = taskState();
  const transition = deriveTaskStateTransition(route({
    routeKind: 'grounded',
    reasonCode: 'project_fact_query',
    topicKind: 'project',
    topicRef: 'other-project',
    evidenceClass: 'direct',
  }), current);

  assert.equal(transition.action, 'switch');
  assert.equal(transition.next?.taskKind, 'project_discussion');
  assert.equal(transition.next?.topicKind, 'project');
  assert.equal(transition.next?.topicRef, 'other-project');
  assert.equal(transition.next?.status, 'active');
  assert.deepEqual(transition.next?.waitingFor, []);
  assert.match(transition.next?.taskId ?? '', /^[0-9a-f-]{36}$/u);
  assert.notEqual(transition.next?.taskId, current.taskId);
  assert.equal(transition.next?.taskStartedTurnId, null);
  assert.equal(transition.next?.lastSuccessfulTurnId, null);
  assert.equal(transition.next?.updatedByTurnId, null);
  assert.equal(transition.next?.version, 0);
  assert.equal(taskStateRequiresWrite(current, transition), true);
});

test('deriveTaskStateTransition: continuing the same task preserves identity and requires success advancement', () => {
  const current = taskState();
  const transition = deriveTaskStateTransition(route({
    routeKind: 'grounded',
    reasonCode: 'anaphoric_project_followup',
    topicKind: 'project',
    topicRef: 'digital-morse',
    evidenceClass: 'direct',
  }), current);

  assert.equal(transition.action, 'continue');
  assert.equal(transition.next, current);
  assert.equal(transition.next?.taskId, TASK_ID);
  assert.equal(transition.next?.version, 3);
  assert.equal(taskStateRequiresWrite(current, transition), true);
});

test('deriveTaskStateTransition: JD intake creates a separate waiting task with a controlled slot', () => {
  const current = taskState({
    taskKind: 'capability_verification',
    topicKind: 'capability',
    topicRef: 'multi-agent',
    activeTopicKind: 'capability',
    activeTopicRef: 'multi-agent',
  });
  const transition = deriveTaskStateTransition(
    route({ routeKind: 'jd_intake', reasonCode: 'jd_required' }),
    current,
  );

  assert.equal(transition.action, 'waiting_input');
  assert.equal(transition.next?.taskKind, 'jd_match');
  assert.equal(transition.next?.topicKind, 'jd');
  assert.equal(transition.next?.topicRef, 'jd');
  assert.equal(transition.next?.status, 'waiting_input');
  assert.deepEqual(transition.next?.waitingFor, ['job_description']);
  assert.notEqual(transition.next?.taskId, current.taskId);
  assert.equal(taskStateRequiresWrite(current, transition), true);
});

test('deriveTaskStateTransition: a full JD resumes the same waiting task', () => {
  const current = taskState({
    taskKind: 'jd_match',
    topicKind: 'jd',
    topicRef: 'jd',
    status: 'waiting_input',
    waitingFor: ['job_description'],
    activeTopicKind: 'jd',
    activeTopicRef: 'jd',
  });
  const transition = deriveTaskStateTransition(route({
    routeKind: 'jd',
    reasonCode: 'full_jd_detected',
    topicKind: 'jd',
    topicRef: 'jd',
    evidenceClass: 'mixed',
    release: 'complete',
    requiresEmbedding: true,
  }), current);

  assert.equal(transition.action, 'continue');
  assert.equal(transition.next?.taskId, current.taskId);
  assert.equal(transition.next?.status, 'active');
  assert.deepEqual(transition.next?.waitingFor, []);
  assert.equal(taskStateRequiresWrite(current, transition), true);
});

test('applyTaskState rejects a success write when the completed turn cannot receive task_id', async () => {
  const transition = deriveTaskStateTransition(route({
    routeKind: 'grounded',
    reasonCode: 'project_fact_query',
    topicKind: 'project',
    topicRef: 'digital-morse',
    evidenceClass: 'direct',
  }), null);
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql);
      return { rowCount: calls.length === 1 ? 1 : 0, rows: [] };
    },
  };

  await assert.rejects(
    applyTaskState(
      client as never,
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      transition,
      0,
      new Date('2026-07-27T00:00:00.000Z'),
    ),
    /interaction turn/i,
  );
  assert.equal(calls.length, 2);
});
