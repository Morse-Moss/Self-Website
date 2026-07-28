import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { normalizeChatRequest } from '../lib/server/chat-core.ts';
import { normalizeJobDescription } from '../lib/server/workflows/jd-match.ts';
import { normalizeDiagnosisFields } from '../lib/server/workflows/diagnosis.ts';

const longChat = `prefix-${'x'.repeat(20_000)}-suffix`;
const longJd = `jd-start-${'y'.repeat(30_000)}-jd-end`;
const longDiagnosis = {
  problem: `problem-start-${'p'.repeat(8_000)}-problem-end`,
  goal: `goal-start-${'g'.repeat(8_000)}-goal-end`,
  currentState: `state-start-${'s'.repeat(8_000)}-state-end`,
  constraints: `constraints-start-${'c'.repeat(8_000)}-constraints-end`,
  expectedTimeline: `timeline-start-${'t'.repeat(2_000)}-timeline-end`,
};

test('chat, JD and diagnosis preserve exact long nonblank strings', () => {
  assert.equal(normalizeChatRequest({ message: longChat }).message, longChat);
  assert.equal(normalizeJobDescription(longJd), longJd);
  assert.deepEqual(normalizeDiagnosisFields(longDiagnosis), longDiagnosis);
});

test('visitor intake controls contain no obsolete client-side content caps', () => {
  const source = [
    'components/chat/ChatComposer.tsx',
    'components/chat/JdIntake.tsx',
    'components/chat/DiagnosisIntake.tsx',
  ].map((file) => fs.readFileSync(path.resolve(file), 'utf8')).join('\n');

  assert.doesNotMatch(source, /maxLength/u);
  assert.doesNotMatch(source, /12,000|6,500|withinTotalLimit|TOTAL_CHARACTER_LIMIT/u);
});

test('retrieval partition preserves every code point and has no count ceiling', async () => {
  const { partitionCompleteRetrievalQuery } = await import('../lib/server/retrieval-query.ts');
  const input = `head-${'a'.repeat(1_000)}\n\nTAIL_SENTINEL-${'b'.repeat(1_000)}`;
  const chunks = partitionCompleteRetrievalQuery(input);

  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), input);
  assert.ok(chunks.some((chunk) => chunk.includes('TAIL_SENTINEL')));
});

test('local embedding source disables silent truncation for oversized inputs', () => {
  const source = fs.readFileSync(path.resolve('scripts/local-embedding-server.py'), 'utf8');

  assert.match(source, /truncation\s*=\s*False/u);
  assert.match(source, /max_seq_length/u);
  assert.match(source, /token-weighted|weighted.*aggregate|aggregate.*weighted/iu);
});

test('canonical V2 source keeps current input, evidence and complete history without a token budget', async () => {
  const { buildCanonicalAnswerSourceV2 } = await import('../lib/server/chat-context-packet.ts');
  const source = buildCanonicalAnswerSourceV2({
    ownerPipeline: 'legacy_v1',
    conversationId: '11111111-1111-4111-8111-111111111111',
    interactionTurnId: '22222222-2222-4222-8222-222222222222',
    contextScopeId: null,
    currentUserMessageId: '101',
    currentInput: longChat,
    trustedInstructions: 'trusted',
    taskFrame: null,
    taskInputs: [],
    approvedEvidence: [{ evidenceId: 'e-1', content: 'evidence' }],
    completeHistory: [],
    reasoningEffort: null,
    releasePolicy: 'complete',
  });

  assert.equal(source.currentInput, longChat);
  assert.equal(source.approvedEvidence[0]?.content, 'evidence');
  assert.equal(Object.hasOwn(source, 'tokenBudget'), false);
});

test('runtime source contains no obsolete application history, retrieval or context budgets', () => {
  const runtimeSource = [
    'app/api/chat/route.ts',
    'lib/server/chat-context-packet.ts',
    'lib/server/chat-service.ts',
    'lib/server/config.ts',
    'lib/server/conversation-context-state.ts',
    '.env.example',
  ].map((file) => fs.readFileSync(path.resolve(file), 'utf8')).join('\n');

  assert.doesNotMatch(runtimeSource, /MORSE_HISTORY_MESSAGE_LIMIT/u);
  assert.doesNotMatch(runtimeSource, /MORSE_RETRIEVAL_LIMIT/u);
  assert.doesNotMatch(runtimeSource, /MORSE_CHAT_CONTEXT_TOKEN_BUDGET/u);
  assert.doesNotMatch(runtimeSource, /MORSE_JD_CONTEXT_TOKEN_BUDGET/u);
  assert.doesNotMatch(runtimeSource, /loadCompletedHistory|loadLegacyCompletedHistory/u);
  assert.doesNotMatch(runtimeSource, /LIMIT 32|candidates\.length >= 6|slice\(0,\s*6\)/u);
  assert.doesNotMatch(runtimeSource, /tokenBudget/u);
});
