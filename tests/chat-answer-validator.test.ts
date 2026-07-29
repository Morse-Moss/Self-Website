import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EvidenceBundle } from '../lib/contracts/chat-evidence-catalog.ts';
import type { AnswerCandidate, TurnPlanV1 } from '../lib/contracts/chat-turn-plan.ts';
import { validateAnswer } from '../lib/server/chat-answer-validator.ts';

function plan(evidence: TurnPlanV1['evidence']): TurnPlanV1 {
  return {
    schemaVersion: 'turn-plan-v1',
    plannerVersion: 'deterministic-turn-planner-v1',
    conversationId: '11111111-1111-4111-8111-111111111111',
    interactionTurnId: '22222222-2222-4222-8222-222222222222',
    currentUserMessageId: '1',
    semantic: {
      discourseAction: 'one_shot', subject: 'morse', intent: 'capability_fact',
      taskAction: 'temporary', referent: null, evidencePlan: ['capability_ledger'],
      confidence: 1, reasonCodes: ['test'],
    },
    taskId: null,
    candidateFrame: null,
    evidence,
    executor: { kind: 'direct' },
    reasonCodes: ['test'],
  };
}

const evidence: EvidenceBundle = {
  catalogVersion: 2,
  approved: [{
    chunkId: 'project:digital-morse', documentId: 'digital-morse', title: 'Digital Morse',
    sourcePath: 'content/site-content.json', href: '/works#digital-morse',
    content: 'approved fact', score: 1, projectSlug: 'digital-morse',
    topicIds: ['digital-morse'], evidenceLevel: 'direct',
  }],
  admissions: [{
    evidenceId: 'project:digital-morse', level: 'direct',
    projectSlug: 'digital-morse', capabilityId: null,
  }],
  relevance: [{ evidenceId: 'project:digital-morse', score: 1 }],
  unavailableCapabilityIds: ['cursor'],
  degradedReason: null,
};

function candidate(text: string): AnswerCandidate {
  return { executorKind: 'direct', text, usage: null, attempts: [], winner: null, sources: [] };
}

test('quality findings warn but never reject a nonblank answer', () => {
  for (const text of [
    'No project coverage.',
    'Digital Morse [source99]',
    'I used Cursor directly in production.',
  ]) {
    const result = validateAnswer({
      plan: plan({ kind: 'capabilities', capabilityIds: ['cursor'], includePortfolio: true }),
      evidence,
      candidate: candidate(text),
      privacyCanaries: [],
    });
    assert.equal(result.verdict, 'warn');
    assert.ok(result.issues.length > 0);
  }
});

test('style and template shape are not validation inputs', () => {
  const result = validateAnswer({
    plan: plan({ kind: 'none' }),
    evidence: { ...evidence, approved: [], admissions: [], unavailableCapabilityIds: [] },
    candidate: candidate('As a developer assistant, next step: read AGENTS.md. Match 90%.'),
    privacyCanaries: [],
  });
  assert.equal(result.verdict, 'pass');
  assert.equal(result.issues.some((issue) => /voice|template|next_step/u.test(issue.code)), false);
});

test('private and secret canaries block before release without retaining matched text', () => {
  for (const text of [
    'SYNTHETIC_PRIVATE_RESUME_MARKER_7F42',
    'Authorization: Bearer sk-example-secret-value-1234567890',
  ]) {
    const result = validateAnswer({
      plan: plan({ kind: 'none' }),
      evidence: { ...evidence, approved: [], admissions: [], unavailableCapabilityIds: [] },
      candidate: candidate(text),
      privacyCanaries: ['SYNTHETIC_PRIVATE_RESUME_MARKER_7F42'],
    });
    assert.equal(result.verdict, 'block');
    assert.ok(result.issues.every((issue) => issue.evidenceId === null));
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE|sk-example/u);
  }
});
