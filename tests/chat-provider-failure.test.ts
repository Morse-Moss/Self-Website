import assert from 'node:assert/strict';
import test from 'node:test';

import { ProviderRunError, type ProviderAttempt } from '../lib/server/ai-provider.ts';
import { RuntimePhaseError } from '../lib/server/chat-runtime-phase-error.ts';
import {
  failIncompleteProviderExecution,
  failProviderExecution,
} from '../lib/server/chat-provider-failure.ts';

const attempt = {
  attemptIndex: 0,
  provider: 'test',
  model: 'test-model',
  status: 'failed',
} as unknown as ProviderAttempt;

test('provider execution failure retains routed attempts and maps the original error', async () => {
  const error = new ProviderRunError('PROVIDER_DOWN', [attempt]);
  const attempts: ProviderAttempt[][] = [];
  const failures: string[] = [];

  await assert.rejects(
    () => failProviderExecution({
      client: {} as never,
      error,
      now: () => new Date('2026-08-03T00:00:00.000Z'),
      errorCode: () => 'PROVIDER_DOWN',
      mapError: (cause) => new RuntimePhaseError('PROVIDER_UNAVAILABLE', 'PROVIDER_DOWN', cause),
      onAttempts: (value) => attempts.push(value),
      recordFailure: ({ errorCode }) => {
        failures.push(errorCode);
        return Promise.resolve();
      },
    }),
    (actual) => actual instanceof RuntimePhaseError && actual.original === error,
  );
  assert.deepEqual(attempts, [[attempt]]);
  assert.deepEqual(failures, ['PROVIDER_DOWN']);
});

test('incomplete provider execution records one stable failure phase', async () => {
  const failures: string[] = [];
  await assert.rejects(
    () => failIncompleteProviderExecution({
      client: {} as never,
      now: () => new Date('2026-08-03T00:00:00.000Z'),
      recordFailure: ({ errorCode }) => {
        failures.push(errorCode);
        return Promise.resolve();
      },
    }),
    (actual) => actual instanceof RuntimePhaseError
      && actual.publicCode === 'PROVIDER_INCOMPLETE'
      && actual.logCode === 'PROVIDER_INCOMPLETE',
  );
  assert.deepEqual(failures, ['PROVIDER_INCOMPLETE']);
});
