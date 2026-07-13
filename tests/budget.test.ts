import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyBudget, estimateCostUsd } from '../lib/server/budget.ts';

test('classifyBudget exposes the agreed 50/75/90/100 percent levels', () => {
  assert.equal(classifyBudget(0, 10), 'normal');
  assert.equal(classifyBudget(5, 10), 'notice');
  assert.equal(classifyBudget(7.5, 10), 'warning');
  assert.equal(classifyBudget(9, 10), 'critical');
  assert.equal(classifyBudget(10, 10), 'exhausted');
});

test('estimateCostUsd uses configured per-million token rates', () => {
  assert.equal(
    estimateCostUsd(
      { inputTokens: 1_000_000, outputTokens: 500_000 },
      { inputUsdPerMillion: 0.25, outputUsdPerMillion: 2 },
    ),
    1.25,
  );
});
