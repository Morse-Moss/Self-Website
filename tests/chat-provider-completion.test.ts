import assert from 'node:assert/strict';
import test from 'node:test';

import {
  providerCompletionAccounting,
} from '../lib/server/chat-provider-completion.ts';
import type { ProviderAttempt } from '../lib/server/ai-provider.ts';

test('provider completion accounting preserves fallback usage when no attempts exist', () => {
  const usage = { inputTokens: 2, outputTokens: 3 };
  assert.deepEqual(providerCompletionAccounting({
    answer: 'ok',
    usage,
    attempts: [],
    winner: null,
    knownCostUsd: 0.12,
    usageComplete: true,
    costComplete: true,
  }), {
    usage,
    knownCostUsd: 0.12,
    usageComplete: true,
    costComplete: true,
  });
});

test('provider completion accounting prefers routed attempt aggregates', () => {
  const attempts = [{
    attemptIndex: 0,
    provider: 'test',
    model: 'test-model',
    status: 'completed',
    usage: { inputTokens: 4, outputTokens: 6 },
    knownCostUsd: 0.2,
    usageComplete: true,
    costComplete: true,
  }] as unknown as ProviderAttempt[];
  const result = providerCompletionAccounting({
    answer: 'ok',
    usage: null,
    attempts,
    winner: null,
    knownCostUsd: null,
  });
  assert.equal(result.usage?.inputTokens, 4);
  assert.equal(result.knownCostUsd, 0.2);
  assert.equal(result.usageComplete, true);
  assert.equal(result.costComplete, true);
});
