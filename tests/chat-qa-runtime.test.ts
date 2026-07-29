import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { EvidenceBundle } from '../lib/contracts/chat-evidence-catalog.ts';
import type {
  AnswerCandidate,
  AnswerValidationResult,
  ConversationSessionSnapshot,
  TurnPlanV1,
} from '../lib/contracts/chat-turn-plan.ts';
import { QaAnswerBlockedError, runQaTurn } from '../lib/server/chat-qa-runtime.ts';

const session = {
  conversationId: '11111111-1111-4111-8111-111111111111',
  interactionTurnId: '22222222-2222-4222-8222-222222222222',
  currentUserMessageId: '1', currentInput: 'question', workflow: 'chat', mode: 'general',
  audienceIntent: 'recruiter', pageContext: null, currentFrame: null,
  adjacentCompletedTurn: null, completedHistory: [], legacyBridge: [],
} satisfies ConversationSessionSnapshot;
const plan = {
  schemaVersion: 'turn-plan-v1', plannerVersion: 'deterministic-turn-planner-v1',
  conversationId: session.conversationId, interactionTurnId: session.interactionTurnId,
  currentUserMessageId: session.currentUserMessageId,
  semantic: {
    discourseAction: 'one_shot', subject: 'morse', intent: 'project_fit',
    taskAction: 'temporary', referent: null, evidencePlan: ['ranked_project_fit'],
    confidence: 1, reasonCodes: ['test'],
  },
  taskId: null, candidateFrame: null,
  evidence: { kind: 'portfolio_full', rankForQuestion: true },
  executor: { kind: 'direct' }, reasonCodes: ['test'],
} satisfies TurnPlanV1;
const evidence = {
  catalogVersion: 2, approved: [], admissions: [], relevance: [],
  unavailableCapabilityIds: [], degradedReason: null,
} satisfies EvidenceBundle;
const candidate = {
  executorKind: 'direct', text: 'committed candidate', usage: null,
  attempts: [], winner: null, sources: [],
} satisfies AnswerCandidate;

function dependencies(validation: AnswerValidationResult) {
  const trace: string[] = [];
  let successCalls = 0;
  let compensationCalls = 0;
  return {
    trace,
    successCalls: () => successCalls,
    compensationCalls: () => compensationCalls,
    value: {
      async loadSession() { trace.push('load-session'); return session; },
      planTurn() { trace.push('plan-turn'); return plan; },
      async buildEvidence() { trace.push('build-evidence'); return evidence; },
      async buildContext() { trace.push('build-context'); return { signed: true }; },
      async executeDirect() { trace.push('execute-direct'); return candidate; },
      validateAnswer() { trace.push('validate-answer'); return validation; },
      async commitSuccess() { trace.push('commit-success'); successCalls += 1; },
      async compensateBlock() { trace.push('compensate-block'); compensationCalls += 1; },
    },
  };
}

test('warning candidate commits before the caller can release its complete answer', async () => {
  const fixture = dependencies({
    verdict: 'warn',
    issues: [{ code: 'missing_evidence_coverage', evidenceId: null }],
  });
  const result = await runQaTurn({ privacyCanaries: [] }, fixture.value);
  fixture.trace.push('release-answer');

  assert.deepEqual(fixture.trace, [
    'load-session', 'plan-turn', 'build-evidence', 'build-context',
    'execute-direct', 'validate-answer', 'commit-success', 'release-answer',
  ]);
  assert.equal(result.validation.verdict, 'warn');
  assert.equal(result.committed, true);
  assert.equal(result.publicAnswer, candidate.text);
  assert.equal(fixture.successCalls(), 1);
});

test('security block compensates without success commit or public answer', async () => {
  const fixture = dependencies({
    verdict: 'block',
    issues: [{ code: 'secret_leak', evidenceId: null }],
  });
  await assert.rejects(
    runQaTurn({ privacyCanaries: [] }, fixture.value),
    (error: unknown) => error instanceof QaAnswerBlockedError,
  );

  assert.equal(fixture.successCalls(), 0);
  assert.equal(fixture.compensationCalls(), 1);
  assert.equal(fixture.trace.includes('release-answer'), false);
  assert.deepEqual(fixture.trace, [
    'load-session', 'plan-turn', 'build-evidence', 'build-context',
    'execute-direct', 'validate-answer', 'compensate-block',
  ]);
});

test('runtime owns the default answer validator when no override is injected', async () => {
  const fixture = dependencies({ verdict: 'pass', issues: [] });
  const runtimeDependencies = { ...fixture.value } as Partial<typeof fixture.value>;
  delete runtimeDependencies.validateAnswer;

  const result = await runQaTurn(
    { privacyCanaries: [] },
    runtimeDependencies as Omit<typeof fixture.value, 'validateAnswer'>,
  );

  assert.equal(result.validation.verdict, 'pass');
  assert.equal(fixture.successCalls(), 1);
});

test('chat service depends on the Q&A runtime instead of its planning internals', () => {
  const source = readFileSync(
    new URL('../lib/server/chat-service.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /from '\.\/chat-qa-runtime\.ts'/u);
  assert.match(source, /runQaTurn\(/u);
  for (const forbiddenImport of [
    './chat-answer-validator.ts',
    './chat-context-coordinator.ts',
    './chat-evidence-catalog.ts',
    './chat-evidence-planner.ts',
    './chat-turn-planner.ts',
  ]) {
    assert.doesNotMatch(source, new RegExp(`from '${forbiddenImport.replaceAll('.', '\\.')}';`, 'u'));
  }
});
