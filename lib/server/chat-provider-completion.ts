import type { PoolClient } from 'pg';

import type { TokenUsage } from '../contracts/chat.ts';
import {
  type ProviderAttempt,
  type ProviderWinner,
} from './ai-provider.ts';
import { aggregateProviderAttempts } from './chat-turn-compensation.ts';
import { RuntimePhaseError } from './chat-runtime-phase-error.ts';

export interface ProviderCompletionCandidate {
  answer: string;
  usage: TokenUsage | null;
  attempts: ProviderAttempt[];
  winner: ProviderWinner | null;
  knownCostUsd?: number | null;
  usageComplete?: boolean;
  costComplete?: boolean;
}

export interface ProviderCompletionAccounting {
  usage: TokenUsage | null;
  knownCostUsd: number | null;
  usageComplete: boolean;
  costComplete: boolean;
}

export function providerCompletionAccounting(
  candidate: ProviderCompletionCandidate,
): ProviderCompletionAccounting {
  if (candidate.attempts.length > 0) {
    const aggregate = aggregateProviderAttempts([...candidate.attempts]);
    return {
      usage: aggregate.usage,
      knownCostUsd: aggregate.knownCostUsd,
      usageComplete: aggregate.usageComplete,
      costComplete: aggregate.costComplete,
    };
  }
  return {
    usage: candidate.usage,
    knownCostUsd: candidate.knownCostUsd ?? null,
    usageComplete: candidate.usageComplete ?? candidate.usage !== null,
    costComplete: candidate.costComplete ?? false,
  };
}

export interface CoordinateProviderCompletionInput {
  client: PoolClient;
  candidate: ProviderCompletionCandidate;
  signal?: AbortSignal;
  now(): Date;
  recordDependencySuccess(input: { client: PoolClient; dependency: 'provider'; now: Date }): Promise<void>;
  complete(input: ProviderCompletionCandidate & ProviderCompletionAccounting): Promise<TokenUsage | null>;
}

export async function coordinateProviderCompletion(
  input: CoordinateProviderCompletionInput,
): Promise<TokenUsage | null> {
  if (input.signal?.aborted) throw input.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
  await input.recordDependencySuccess({
    client: input.client,
    dependency: 'provider',
    now: input.now(),
  });
  const accounting = providerCompletionAccounting(input.candidate);
  try {
    return await input.complete({ ...input.candidate, ...accounting });
  } catch (error) {
    throw new RuntimePhaseError(
      'PROVIDER_UNAVAILABLE',
      'PERSISTENCE_FAILED',
      error,
      true,
    );
  }
}
