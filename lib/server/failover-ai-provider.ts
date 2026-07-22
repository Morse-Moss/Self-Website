import type { TokenUsage } from './budget.ts';
import {
  AnswerExecutionError,
  ProviderRunError,
  type AiProvider,
  type AnswerEvent,
  type AnswerRequest,
  type ProviderAnswerTarget,
  type ProviderAttempt,
  type ProviderAttemptEvent,
  type ProviderTargetSnapshot,
} from './ai-provider.ts';
import { OpenAIProviderError } from './openai-provider.ts';
import { ProviderHealthRegistry } from './provider-health.ts';
import { createTimeoutSignal } from './timeout.ts';

export interface ProviderNode {
  alias: string;
  provider: AiProvider;
  snapshot: ProviderTargetSnapshot;
}

function addUsage(current: TokenUsage | null, next: TokenUsage | null): TokenUsage | null {
  if (!next) return current;
  if (!current) return next;
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

function stableErrorCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  return /^[A-Z0-9_]{1,80}$/u.test(code) ? code : 'PROVIDER_UNAVAILABLE';
}

export class FailoverAiProvider implements AiProvider {
  private readonly embeddingProvider: AiProvider;
  private readonly nodes: ProviderNode[];
  private readonly totalTimeoutMs: number;
  private readonly health: ProviderHealthRegistry;

  constructor(
    embeddingProvider: AiProvider,
    answerProviders: Array<AiProvider | ProviderAnswerTarget | ProviderNode>,
    totalTimeoutMs: number,
    health = new ProviderHealthRegistry(),
  ) {
    if (answerProviders.length < 1) throw new Error('At least one answer provider is required.');
    if (!Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs < 1) {
      throw new Error('A positive safe failover timeout is required.');
    }
    this.embeddingProvider = embeddingProvider;
    this.nodes = answerProviders.map((entry, index) => {
      const alias = index === 0 ? 'primary' : `fallback-${index}`;
      if ('provider' in entry) {
        return {
          alias: 'alias' in entry ? entry.alias : alias,
          provider: entry.provider,
          snapshot: 'snapshot' in entry ? entry.snapshot : legacySnapshot(index),
        };
      }
      return { alias, provider: entry, snapshot: legacySnapshot(index) };
    });
    this.totalTimeoutMs = totalTimeoutMs;
    this.health = health;
  }

  embed(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
    return this.embeddingProvider.embed(inputs, signal);
  }

  async *streamAnswer(request: AnswerRequest, signal?: AbortSignal): AsyncIterable<AnswerEvent> {
    if (!request.execution) {
      yield* this.streamLegacy(request, signal);
      return;
    }
    yield* this.streamCoordinated(request, signal);
  }

  private async *streamLegacy(
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
      for (const [index, node] of this.nodes.entries()) {
        if (totalTimeout.signal.aborted) throw totalTimeout.signal.reason;
        let emittedOutput = false;
        let usage: TokenUsage | null = null;
        const startedAt = new Date();
        let firstByteAt: Date | null = null;
        try {
          for await (const event of node.provider.streamAnswer(request, totalTimeout.signal)) {
            if (event.type === 'delta') {
              emittedOutput = true;
              firstByteAt ??= new Date();
              yield event;
            } else if (event.type === 'done') {
              usage = event.usage;
              const attempt = createAttempt({
                attemptIndex: index,
                snapshot: node.snapshot,
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
                providerAlias: node.alias,
                usage: aggregate.usage,
                usageComplete: aggregate.usageComplete,
                winner: { ...node.snapshot, attemptIndex: index },
              };
              return;
            }
          }
          throw new OpenAIProviderError('PROVIDER_RESPONSE_INCOMPLETE', usage);
        } catch (error) {
          usage = error instanceof OpenAIProviderError ? error.usage : usage;
          const callerStopped = Boolean(signal?.aborted);
          const errorCode = stableErrorCode(totalTimeout.signal.aborted
            ? totalTimeout.signal.reason
            : error);
          const attempt = createAttempt({
            attemptIndex: index,
            snapshot: node.snapshot,
            startedAt,
            firstByteAt,
            usage,
            status: callerStopped ? 'stopped' : 'failed',
            errorCode,
          });
          attempts.push(attempt);
          yield { type: 'attempt', attempt };
          if (callerStopped) throw signal?.reason;
          if (totalTimeout.signal.aborted || emittedOutput || index + 1 >= this.nodes.length) {
            throw new ProviderRunError(errorCode, attempts);
          }
        }
      }
    } finally {
      totalTimeout.dispose();
    }
    throw new ProviderRunError('PROVIDER_UNAVAILABLE', attempts);
  }

  private async *streamCoordinated(request: AnswerRequest, signal?: AbortSignal): AsyncIterable<AnswerEvent> {
    const execution = request.execution!;
    const timeout = createTimeoutSignal({
      timeoutMs: Math.max(1, Math.min(
        execution.totalTimeoutMs,
        execution.budget.remainingMs(Date.now()),
      )),
      code: 'PROVIDER_TOTAL_TIMEOUT',
      signal,
    });
    const attempts: ProviderAttempt[] = [];
    let lastError: unknown;
    let localAttemptNo = 0;

    try {
      for (const [nodeIndex, node] of this.nodes.entries()) {
        if (timeout.signal.aborted) throw timeout.signal.reason;
        if (!this.health.acquire(node.alias, new Date())) continue;

        const reservedAt = Date.now();
        if (!execution.budget.canStartAttempt(reservedAt, 10_000)
          || !execution.budget.reserveAttempt(reservedAt)) {
          this.health.abort(node.alias);
          break;
        }
        localAttemptNo += 1;
        const attemptNo = localAttemptNo;
        const launchKind = nodeIndex === 0 ? 'primary' : 'failover';
        const startedAt = Date.now();
        const startedEvent: Extract<ProviderAttemptEvent, { type: 'started' }> = {
          type: 'started',
          attemptNo,
          providerAlias: node.alias,
          launchKind,
          startedAt: new Date(startedAt),
          startDelayMs: 0,
        };
        await execution.onAttempt(startedEvent);
        if (launchKind === 'failover') yield { type: 'switching' };

        const controller = new AbortController();
        const forwardAbort = () => controller.abort(timeout.signal.reason);
        if (timeout.signal.aborted) forwardAbort();
        else timeout.signal.addEventListener('abort', forwardAbort, { once: true });
        const iterator = node.provider.streamAnswer(request, controller.signal)[Symbol.asyncIterator]();
        let text = '';
        let releasedLength = 0;
        let firstByteAt: number | null = null;
        let terminalRecorded = false;

        const recordTerminal = async (
          status: ProviderAttempt['status'],
          errorCode: string | null,
          eventUsage: TokenUsage | null,
        ): Promise<ProviderAttempt> => {
          await execution.onAttempt({
            type: status === 'completed' ? 'completed' : status === 'stopped' ? 'aborted' : 'failed',
            attemptNo,
            providerAlias: node.alias,
            durationMs: Date.now() - startedAt,
            winner: status === 'completed',
            errorCode,
            usage: eventUsage,
          });
          const recorded = createAttempt({
            attemptIndex: attemptNo - 1,
            snapshot: node.snapshot,
            startedAt: new Date(startedAt),
            firstByteAt: firstByteAt === null ? null : new Date(firstByteAt),
            usage: eventUsage,
            status,
            errorCode,
            generationMode: execution.generationMode,
            launchKind,
          });
          attempts.push(recorded);
          terminalRecorded = true;
          return recorded;
        };

        try {
          while (true) {
            const result = await Promise.race([
              iterator.next(),
              new Promise<never>((_resolve, reject) => {
                if (timeout.signal.aborted) reject(timeout.signal.reason);
                else timeout.signal.addEventListener('abort', () => reject(timeout.signal.reason), { once: true });
              }),
            ]);
            if (result.done) throw new AnswerExecutionError('PROVIDER_INCOMPLETE');
            const event = result.value;
            if (event.type === 'attempt') continue;
            if (event.type === 'switching') {
              yield event;
              continue;
            }
            if (event.type === 'delta') {
              if (!event.text) continue;
              if (firstByteAt === null) {
                firstByteAt = Date.now();
                await execution.onAttempt({
                  type: 'first_byte',
                  attemptNo,
                  providerAlias: node.alias,
                  firstByteMs: firstByteAt - startedAt,
                });
              }
              text += event.text;
              const completeSegment = /[.!?\n\u3002\uFF01\uFF1F]\s*$/u.test(text);
              if (execution.releasePolicy === 'segment'
                && completeSegment
                && text.length >= execution.minimumBufferCharacters) {
                if (!execution.acceptCandidate(text, false)) {
                  throw new AnswerExecutionError('OUTPUT_GUARD_REJECTED');
                }
                yield { type: 'delta', text: text.slice(releasedLength) };
                releasedLength = text.length;
              }
              continue;
            }

            if (!text.trim()) throw new AnswerExecutionError('PROVIDER_INCOMPLETE');
            if (!execution.acceptCandidate(text, true)) {
              throw new AnswerExecutionError('OUTPUT_GUARD_REJECTED');
            }
            if (execution.releasePolicy === 'complete' || releasedLength === 0) {
              yield { type: 'delta', text: text.slice(releasedLength) };
            }
            const recorded = await recordTerminal('completed', null, event.usage);
            yield { type: 'attempt', attempt: recorded };
            this.health.success(node.alias);
            const aggregate = aggregateAttempts(attempts);
            yield {
              type: 'done',
              attempts: [...attempts],
              costComplete: aggregate.costComplete,
              knownCostUsd: aggregate.knownCostUsd,
              providerAlias: node.alias,
              usage: aggregate.usage,
              usageComplete: aggregate.usageComplete,
              winner: { ...node.snapshot, attemptIndex: attemptNo - 1 },
            };
            return;
          }
        } catch (error) {
          const callerStopped = Boolean(signal?.aborted);
          const guardRejected = error instanceof AnswerExecutionError
            && error.code === 'OUTPUT_GUARD_REJECTED';
          const errorUsage = error instanceof OpenAIProviderError ? error.usage : null;
          const errorCode = callerStopped ? null : stableErrorCode(error);
          if (!terminalRecorded) {
            const recorded = await recordTerminal(
              callerStopped ? 'stopped' : 'failed',
              guardRejected ? 'OUTPUT_GUARD_REJECTED' : errorCode,
              errorUsage,
            );
            yield { type: 'attempt', attempt: recorded };
          }
          if (callerStopped) {
            this.health.abort(node.alias);
            throw signal?.reason;
          }
          if (guardRejected) {
            this.health.success(node.alias);
            throw error;
          }
          this.health.failure(node.alias, new Date());
          lastError = error;
          if (releasedLength > 0 || timeout.signal.aborted) throw error;
        } finally {
          timeout.signal.removeEventListener('abort', forwardAbort);
          controller.abort(new Error('ATTEMPT_CLOSED'));
          if (iterator.return) {
            await Promise.race([
              Promise.resolve(iterator.return()).catch(() => undefined),
              wait(100),
            ]);
          }
        }
      }
      throw new ProviderRunError(stableErrorCode(lastError), attempts);
    } finally {
      timeout.dispose();
    }
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

function createAttempt(input: {
  attemptIndex: number;
  snapshot: ProviderTargetSnapshot;
  startedAt: Date;
  firstByteAt: Date | null;
  usage: TokenUsage | null;
  status: ProviderAttempt['status'];
  errorCode: string | null;
  generationMode?: ProviderAttempt['generationMode'];
  launchKind?: ProviderAttempt['launchKind'];
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
    firstModelTextMs: input.firstByteAt
      ? Math.max(0, input.firstByteAt.getTime() - input.startedAt.getTime())
      : null,
    firstProtocolEventMs: null,
    firstUserVisibleMs: input.firstByteAt
      ? Math.max(0, input.firstByteAt.getTime() - input.startedAt.getTime())
      : null,
    generationMode: input.generationMode ?? 'normal',
    knownCostUsd,
    launchKind: input.launchKind ?? (input.attemptIndex === 0 ? 'primary' : 'failover'),
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
