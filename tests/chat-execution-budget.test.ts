import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createChatExecutionBudget } from '../lib/server/chat-execution-budget.ts';

test('normal, strict and failover share three attempts and one absolute deadline', () => {
  const budget = createChatExecutionBudget({
    turnStartedAtMs: 1_000,
    providerStartedAtMs: 1_000,
    turnTimeoutMs: 90_000,
    providerTimeoutMs: 80_000,
    maxAttempts: 3,
  });

  assert.equal(budget.reserveAttempt(1_000), true);
  assert.equal(budget.reserveAttempt(2_000), true);
  assert.equal(budget.reserveAttempt(3_000), true);
  assert.equal(budget.reserveAttempt(4_000), false);
  assert.equal(budget.remainingAttempts(), 0);
  assert.equal(budget.remainingMs(40_000), 41_000);
});

test('the 90 second turn deadline caps routing and the provider remainder', () => {
  const budget = createChatExecutionBudget({
    turnStartedAtMs: 0,
    providerStartedAtMs: 15_000,
    turnTimeoutMs: 90_000,
    providerTimeoutMs: 80_000,
    maxAttempts: 3,
  });

  assert.equal(budget.providerDeadlineMs(), 90_000);
  assert.equal(budget.remainingMs(15_000), 75_000);
  assert.equal(budget.canStartAttempt(80_001, 10_000), false);
  assert.equal(budget.reserveAttempt(90_000), false);
});

test('execution budget rejects invalid timing and attempt contracts', () => {
  assert.throws(() => createChatExecutionBudget({
    turnStartedAtMs: 0,
    providerStartedAtMs: -1,
    turnTimeoutMs: 90_000,
    providerTimeoutMs: 80_000,
    maxAttempts: 3,
  }), /providerStartedAtMs/);
  assert.throws(() => createChatExecutionBudget({
    turnStartedAtMs: 0,
    providerStartedAtMs: 0,
    turnTimeoutMs: 90_000,
    providerTimeoutMs: 80_000,
    maxAttempts: 4,
  }), /maxAttempts/);
});
