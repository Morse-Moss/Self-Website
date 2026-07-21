import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProviderHealthRegistry } from '../lib/server/provider-health.ts';

function plus(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

test('provider health opens after three failures and permits one half-open probe', () => {
  const registry = new ProviderHealthRegistry();
  const now = new Date('2026-07-22T12:00:00.000Z');

  assert.ok(registry.acquire('primary', now));
  registry.failure('primary', now);
  registry.failure('primary', now);
  assert.equal(registry.snapshot('primary', now).state, 'closed');
  registry.failure('primary', now);

  assert.equal(registry.snapshot('primary', now).state, 'open');
  assert.equal(registry.acquire('primary', plus(now, 30_000)), null);
  const probe = registry.acquire('primary', plus(now, 60_000));
  assert.ok(probe?.halfOpen);
  assert.equal(registry.snapshot('primary', plus(now, 60_000)).state, 'half_open');
  assert.equal(registry.acquire('primary', plus(now, 60_001)), null);

  registry.success('primary');
  assert.equal(registry.snapshot('primary', plus(now, 60_002)).state, 'closed');
  assert.ok(registry.acquire('primary', plus(now, 60_002)));
});

test('aborting a half-open probe releases the lease without adding a failure', () => {
  const registry = new ProviderHealthRegistry({ failureThreshold: 1, openMs: 60_000 });
  const now = new Date('2026-07-22T12:00:00.000Z');
  registry.failure('fallback-1', now);

  assert.ok(registry.acquire('fallback-1', plus(now, 60_000))?.halfOpen);
  registry.abort('fallback-1');

  const snapshot = registry.snapshot('fallback-1', plus(now, 60_001));
  assert.equal(snapshot.consecutiveFailures, 1);
  assert.equal(snapshot.state, 'open');
  assert.ok(registry.acquire('fallback-1', plus(now, 60_001))?.halfOpen);
});

test('a failed half-open probe reopens for a full interval', () => {
  const registry = new ProviderHealthRegistry({ failureThreshold: 1, openMs: 60_000 });
  const now = new Date('2026-07-22T12:00:00.000Z');
  registry.failure('fallback-2', now);
  assert.ok(registry.acquire('fallback-2', plus(now, 60_000))?.halfOpen);

  registry.failure('fallback-2', plus(now, 60_010));

  assert.equal(registry.acquire('fallback-2', plus(now, 120_000)), null);
  assert.ok(registry.acquire('fallback-2', plus(now, 120_010))?.halfOpen);
});
