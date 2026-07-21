import type { TokenUsage } from './budget.ts';
import {
  ProviderRunError,
  type AiProvider,
  type AnswerEvent,
  type AnswerRequest,
  type ProviderAnswerTarget,
  type ProviderAttempt,
  type ProviderTargetSnapshot,
} from './ai-provider.ts';
import { OpenAIProviderError } from './openai-provider.ts';
import { createTimeoutSignal } from './timeout.ts';

function addUsage(current: TokenUsage | null, next: TokenUsage | null): TokenUsage | null {
  if (!next) return current;
  if (!current) return next;
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
  };
}

export class FailoverAiProvider implements AiProvider {
  private readonly embeddingProvider: AiProvider;
  private readonly answerTargets: ProviderAnswerTarget[];
  private readonly totalTimeoutMs: number;

  constructor(
    embeddingProvider: AiProvider,
    answerProviders: Array<AiProvider | ProviderAnswerTarget>,
    totalTimeoutMs: number,
  ) {
    if (answerProviders.length < 1) throw new Error('At least one answer provider is required.');
    if (!Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs < 1) {
      throw new Error('A positive safe failover timeout is required.');
    }
    this.embeddingProvider = embeddingProvider;
    this.answerTargets = answerProviders.map((item, position) => (
      'provider' in item && 'snapshot' in item
        ? item
        : { provider: item, snapshot: legacySnapshot(position) }
    ));
    this.totalTimeoutMs = totalTimeoutMs;
  }

  embed(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
    return this.embeddingProvider.embed(inputs, signal);
  }

  async *streamAnswer(
    request: AnswerRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AnswerEvent> {
    const totalTimeout = createTimeoutSignal({
      timeoutMs: this.totalTimeoutMs,
      code: 'PROVIDER_TOTAL_TIMEOUT',
      signal,
    });
    const attempts: ProviderAttempt[] = [];

    try {
      for (const [index, target] of this.answerTargets.entries()) {
        if (totalTimeout.signal.aborted) throw totalTimeout.signal.reason;
        let emittedOutput = false;
        let usage: TokenUsage | null = null;
        const startedAt = new Date();
        let firstByteAt: Date | null = null;

        try {
          for await (const event of target.provider.streamAnswer(request, totalTimeout.signal)) {
            if (event.type === 'delta') {
              emittedOutput = true;
              firstByteAt ??= new Date();
              yield event;
            } else if (event.type === 'done') {
              usage = event.usage;
              const attempt = createAttempt({
                attemptIndex: index,
                snapshot: target.snapshot,
                startedAt,
                firstByteAt,
                usage,
                status: 'completed',
                errorCode: null,
              });
              attempts.push(attempt);
              yield { type: 'attempt', attempt };
              const aggregate = aggregateAttempts(attempts);
              yield {
                type: 'done',
                attempts: [...attempts],
                costComplete: aggregate.costComplete,
                knownCostUsd: aggregate.knownCostUsd,
                usage: aggregate.usage,
                usageComplete: aggregate.usageComplete,
                winner: { ...target.snapshot, attemptIndex: index },
              };
              return;
            }
          }
          throw new OpenAIProviderError('PROVIDER_RESPONSE_INCOMPLETE', usage);
        } catch (error) {
          usage = error instanceof OpenAIProviderError ? error.usage : usage;
          const callerStopped = Boolean(signal?.aborted);
          const errorCode = stableProviderErrorCode(error, totalTimeout.signal);
          const attempt = createAttempt({
            attemptIndex: index,
            snapshot: target.snapshot,
            startedAt,
            firstByteAt,
            usage,
            status: callerStopped ? 'stopped' : 'failed',
            errorCode,
          });
          attempts.push(attempt);
          yield { type: 'attempt', attempt };
          if (callerStopped) throw signal?.reason;
          if (totalTimeout.signal.aborted || emittedOutput || index + 1 >= this.answerTargets.length) {
            throw new ProviderRunError(errorCode, attempts);
          }
        }
      }
    } finally {
      totalTimeout.dispose();
    }

    throw new ProviderRunError('PROVIDER_UNAVAILABLE', attempts);
  }
}

function legacySnapshot(position: number): ProviderTargetSnapshot {
  return {
    configDigest: '0'.repeat(64),
    connectionDisplayName: position === 0 ? 'Environment' : `Environment fallback ${position}`,
    connectionVersionId: null,
    inputUsdPerMillion: null,
    modelDisplayName: 'Configured model',
    modelId: 'configured-model',
    modelVersionId: null,
    outputUsdPerMillion: null,
    position,
    protocol: 'responses',
    routeRevisionId: null,
    sourceType: 'environment',
  };
}

function stableProviderErrorCode(error: unknown, signal: AbortSignal): string {
  if (signal.aborted && signal.reason && typeof signal.reason === 'object' && 'code' in signal.reason) {
    const code = (signal.reason as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  if (error instanceof OpenAIProviderError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^PROVIDER_[A-Z_]+$/u.test(code)) return code;
  }
  return 'PROVIDER_UNAVAILABLE';
}

function createAttempt(input: {
  attemptIndex: number;
  snapshot: ProviderTargetSnapshot;
  startedAt: Date;
  firstByteAt: Date | null;
  usage: TokenUsage | null;
  status: ProviderAttempt['status'];
  errorCode: string | null;
}): ProviderAttempt {
  const completedAt = new Date();
  const inputRate = input.snapshot.inputUsdPerMillion === null
    ? null
    : Number(input.snapshot.inputUsdPerMillion);
  const outputRate = input.snapshot.outputUsdPerMillion === null
    ? null
    : Number(input.snapshot.outputUsdPerMillion);
  const costComplete = Boolean(
    input.usage
    && Number.isFinite(inputRate)
    && Number.isFinite(outputRate),
  );
  const knownCostUsd = costComplete && input.usage
    ? ((input.usage.inputTokens * inputRate!) + (input.usage.outputTokens * outputRate!)) / 1_000_000
    : null;
  return {
    ...input.snapshot,
    attemptIndex: input.attemptIndex,
    completedAt,
    costComplete,
    errorCode: input.errorCode,
    firstByteLatencyMs: input.firstByteAt
      ? Math.max(0, input.firstByteAt.getTime() - input.startedAt.getTime())
      : null,
    knownCostUsd,
    startedAt: input.startedAt,
    status: input.status,
    totalLatencyMs: Math.max(0, completedAt.getTime() - input.startedAt.getTime()),
    usage: input.usage,
    usageComplete: input.usage !== null,
  };
}

function aggregateAttempts(attempts: ProviderAttempt[]): {
  costComplete: boolean;
  knownCostUsd: number | null;
  usage: TokenUsage | null;
  usageComplete: boolean;
} {
  const usage = attempts.reduce<TokenUsage | null>(
    (current, attempt) => addUsage(current, attempt.usage),
    null,
  );
  return {
    costComplete: attempts.every((attempt) => attempt.costComplete),
    knownCostUsd: attempts.some((attempt) => attempt.knownCostUsd !== null)
      ? attempts.reduce((sum, attempt) => sum + (attempt.knownCostUsd ?? 0), 0)
      : null,
    usage,
    usageComplete: attempts.every((attempt) => attempt.usageComplete),
  };
}
