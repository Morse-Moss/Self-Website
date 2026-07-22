import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProviderDeadline } from '../lib/server/provider-deadline.ts';

test('protocol activity extends once to an absolute model-text deadline', () => {
  const state = createProviderDeadline({
    startedAtMs: 0,
    protocolTimeoutMs: 25_000,
    modelTextTimeoutMs: 40_000,
  });

  assert.equal(state.deadlineMs(), 25_000);
  state.recordProtocolEvent(24_000);
  assert.equal(state.deadlineMs(), 40_000);
  state.recordProtocolEvent(39_000);
  assert.equal(state.deadlineMs(), 40_000);
  state.recordModelText(39_500);
  assert.equal(state.deadlineMs(), null);
});

test('provider deadline rejects invalid ordering and pre-start activity', () => {
  assert.throws(() => createProviderDeadline({
    startedAtMs: 0,
    protocolTimeoutMs: 40_000,
    modelTextTimeoutMs: 25_000,
  }), /protocolTimeoutMs/);

  const state = createProviderDeadline({
    startedAtMs: 1_000,
    protocolTimeoutMs: 25_000,
    modelTextTimeoutMs: 40_000,
  });
  assert.throws(() => state.recordProtocolEvent(999), /startedAtMs/);
});
