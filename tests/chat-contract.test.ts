import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BUDGET_LEVELS,
  CHAT_AUDIENCE_INTENTS,
  CHAT_ERROR_CODES,
  CHAT_MODES,
  CHAT_PHASES,
  CHAT_SERVICE_ERROR_CODES,
  CHAT_SOURCE_KINDS,
  CHAT_WORKFLOWS,
  DIAGNOSIS_FIELD_NAMES,
  RECOVERABLE_CHAT_ERROR_CODES,
  type ChatSource,
} from '../lib/contracts/chat.ts';

test('chat contract exposes the exact shipped workflow and public value sets', () => {
  assert.deepEqual(CHAT_MODES, ['general', 'interviewer']);
  assert.deepEqual(CHAT_AUDIENCE_INTENTS, [
    'general',
    'recruiter',
    'collaboration',
    'peer',
  ]);
  assert.deepEqual(CHAT_WORKFLOWS, ['chat', 'jd_match', 'diagnosis']);
  assert.deepEqual(CHAT_PHASES, ['routing', 'knowledge', 'web', 'answering', 'handoff']);
  assert.deepEqual(CHAT_SOURCE_KINDS, ['local', 'official', 'github', 'web']);
  assert.deepEqual(DIAGNOSIS_FIELD_NAMES, [
    'problem',
    'goal',
    'currentState',
    'constraints',
    'expectedTimeline',
  ]);
  assert.deepEqual(BUDGET_LEVELS, ['normal', 'notice', 'warning', 'critical', 'exhausted']);
});

test('chat contract keeps the current stable and service error allowlists exact', () => {
  assert.deepEqual(CHAT_ERROR_CODES, [
    'ACCESS_REQUIRED',
    'SESSION_INVALID',
    'MESSAGE_LIMIT',
    'BUDGET_EXHAUSTED',
    'RETRIEVAL_UNAVAILABLE',
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_INCOMPLETE',
    'CONVERSATION_BUSY',
    'CONVERSATION_INVALID',
    'CONVERSATION_MODE_MISMATCH',
    'CHAT_UNAVAILABLE',
  ]);
  assert.deepEqual(CHAT_SERVICE_ERROR_CODES, [
    'SESSION_INVALID',
    'MESSAGE_LIMIT',
    'CONVERSATION_INVALID',
    'CONVERSATION_MODE_MISMATCH',
    'CONVERSATION_BUSY',
    'RETRIEVAL_UNAVAILABLE',
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_INCOMPLETE',
  ]);
  assert.deepEqual(RECOVERABLE_CHAT_ERROR_CODES, [
    'RETRIEVAL_UNAVAILABLE',
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_INCOMPLETE',
    'CONVERSATION_BUSY',
    'CONVERSATION_INVALID',
    'CONVERSATION_MODE_MISMATCH',
    'CHAT_UNAVAILABLE',
  ]);

  const stableCodes = new Set(CHAT_ERROR_CODES);
  assert.ok(RECOVERABLE_CHAT_ERROR_CODES.every((code) => stableCodes.has(code)));
  assert.ok(CHAT_SERVICE_ERROR_CODES.every((code) => stableCodes.has(code)));
});

test('chat source contract preserves the public JSON field shape', () => {
  const source = {
    id: 'local-1',
    title: '公开资料',
    href: '/works#digital-morse',
    kind: 'local',
    domain: null,
    score: 0.9,
  } satisfies ChatSource;

  assert.deepEqual(JSON.parse(JSON.stringify(source)), {
    id: 'local-1',
    title: '公开资料',
    href: '/works#digital-morse',
    kind: 'local',
    domain: null,
    score: 0.9,
  });
});

test('public chat contracts expose no private resume capability or identifier', () => {
  const serialized = JSON.stringify({
    modes: CHAT_MODES,
    audienceIntents: CHAT_AUDIENCE_INTENTS,
    workflows: CHAT_WORKFLOWS,
    phases: CHAT_PHASES,
    sources: CHAT_SOURCE_KINDS,
    errors: CHAT_ERROR_CODES,
  });
  assert.doesNotMatch(
    serialized,
    /resume|morse_resume_access|resume_documents|private[\\/]resume|trustedPersonNote/i,
  );
});
