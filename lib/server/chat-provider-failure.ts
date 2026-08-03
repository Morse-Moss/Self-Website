import type { PoolClient } from 'pg';

import { ProviderRunError, type ProviderAttempt } from './ai-provider.ts';
import { RuntimePhaseError } from './chat-runtime-phase-error.ts';
import { OperationTimeoutError } from './timeout.ts';

interface ProviderFailureRecorder {
  client: PoolClient;
  dependency: 'provider';
  errorCode: string;
  now: Date;
}

interface ProviderFailureInput {
  client: PoolClient;
  now(): Date;
  recordFailure(input: ProviderFailureRecorder): Promise<void>;
}

export interface FailProviderExecutionInput extends ProviderFailureInput {
  error: unknown;
  signal?: AbortSignal;
  errorCode(error: unknown): string;
  mapError(error: unknown): RuntimePhaseError;
  onAttempts?(attempts: ProviderAttempt[]): void;
}

export async function failProviderExecution(input: FailProviderExecutionInput): Promise<never> {
  if (input.error instanceof ProviderRunError) input.onAttempts?.([...input.error.attempts]);
  if (input.signal?.aborted) throw input.error;
  await input.recordFailure({
    client: input.client,
    dependency: 'provider',
    errorCode: input.errorCode(input.error),
    now: input.now(),
  });
  if (input.error instanceof OperationTimeoutError) throw input.error;
  throw input.mapError(input.error);
}

export async function failIncompleteProviderExecution(input: ProviderFailureInput): Promise<never> {
  await input.recordFailure({
    client: input.client,
    dependency: 'provider',
    errorCode: 'PROVIDER_INCOMPLETE',
    now: input.now(),
  });
  throw new RuntimePhaseError('PROVIDER_INCOMPLETE', 'PROVIDER_INCOMPLETE');
}
