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
  type PreparedTargetAnswer,
  type ProviderTargetSnapshot,
} from './ai-provider.ts';
import { OpenAIProviderError } from './openai-provider.ts';
import {
  isNumericContextOverflow,
  sanitizeProviderFailure,
  type SanitizedProviderFailure,
} from './provider-failure.ts';
import { createProviderDeadline } from './provider-deadline.ts';
import { ProviderHealthRegistry } from './provider-health.ts';
import { createTimeoutSignal, OperationTimeoutError, raceWithSignal } from './timeout.ts';

export interface ProviderNode {
  alias: string;
  provider: AiProvider;
  snapshot: ProviderTargetSnapshot;
}

export type ProviderNodeInput =
  | AiProvider
  | ProviderAnswerTarget
  | (Omit<ProviderNode, 'snapshot'> & { snapshot?: ProviderTargetSnapshot });

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

function isFailoverEligible(error: unknown): boolean {
  return error instanceof OpenAIProviderError
    || error instanceof OperationTimeoutError
    || error instanceof ProviderRunError
    || (error instanceof AnswerExecutionError && error.code === 'PROVIDER_INCOMPLETE');
}

function isTargetPreparationFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return new Set([
    'CONTEXT_PROTECTED_PAYLOAD_TOO_LARGE',
    'CONTEXT_TARGET_INELIGIBLE',
    'CONTEXT_SUMMARY_FAILED',
    'CONTEXT_SUMMARY_CANCELLED',
    'CONTEXT_SUMMARY_NOT_SMALLER',
  ]).has(String((error as { code?: unknown }).code ?? ''));
}

function failureFor(error: unknown): SanitizedProviderFailure {
  if (error instanceof OpenAIProviderError) return error.failure;
  if (error instanceof OperationTimeoutError) {
    return sanitizeProviderFailure({ reason: 'timeout' });
  }
  if (error instanceof AnswerExecutionError) {
    return sanitizeProviderFailure({ reason: 'response_incomplete' });
  }
  return sanitizeProviderFailure({ reason: 'transport' });
}

function snapshotForAttempt(
  snapshot: ProviderTargetSnapshot,
  integrity: ProviderAttempt['integrity'],
): ProviderTargetSnapshot {
  if (!integrity || !('version' in integrity)) return snapshot;
  return {
    ...snapshot,
    configDigestVersion: integrity.target.configDigestVersion,
    configDigest: integrity.target.configDigest,
    modelId: integrity.target.modelId,
    protocol: integrity.target.protocol,
    contextWindowTokens: integrity.target.contextWindowTokens,
    maxOutputTokens: integrity.target.maxOutputTokens,
    reasoningEffort: integrity.target.reasoningEffort,
  };
}

export class FailoverAiProvider implements AiProvider {
  private readonly embeddingProvider: AiProvider;
  private readonly nodes: ProviderNode[];
  private readonly totalTimeoutMs: number;
  private readonly health: ProviderHealthRegistry;

  constructor(
    embeddingProvider: AiProvider,
    answerProviders: ProviderNodeInput[],
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
          snapshot: 'snapshot' in entry && entry.snapshot ? entry.snapshot : legacySnapshot(index),
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
          if (!isFailoverEligible(error)) throw error;
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
    const timeoutMs = Math.max(1, Math.min(
      execution.totalTimeoutMs,
      execution.budget.remainingMs(Date.now()),
    ));
    const deadlineMs = Date.now() + timeoutMs;
    const timeout = createTimeoutSignal({
      timeoutMs,
      code: 'PROVIDER_TOTAL_TIMEOUT',
      signal,
    });
    const attempts: ProviderAttempt[] = [];
    let lastError: unknown;
    let localAttemptNo = 0;
    let variantRevision = 0;
    let overflowRetryConsumed = false;

    try {
      nodeLoop:
      for (const [nodeIndex, node] of this.nodes.slice(0, 6).entries()) {
        if (timeout.signal.aborted) throw timeout.signal.reason;
        if (!this.health.acquire(node.alias, new Date())) continue;

        let nextVariant: {
          trigger: 'initial' | 'provider_numeric_overflow';
          numericOverflow: SanitizedProviderFailure | null;
        } | null = { trigger: 'initial', numericOverflow: null };

        while (nextVariant) {
          const variant = nextVariant;
          nextVariant = null;
          variantRevision += 1;
          let prepared: PreparedTargetAnswer | null = null;
          let attemptRequest = request;
          let attemptIntegrity = execution.integrity ?? null;
          try {
            if (execution.prepareTarget) {
              prepared = await raceWithSignal(execution.prepareTarget({
                target: node.snapshot,
                provider: node.provider,
                variantId: execution.generationVariantId ?? execution.executionId,
                revision: variantRevision,
                trigger: variant.trigger,
                numericOverflow: variant.numericOverflow,
                signal: timeout.signal,
                deadlineMs,
              }), timeout.signal);
              attemptRequest = {
                ...prepared.request,
                preparedOutboundBody: prepared.outboundBody,
              };
              attemptIntegrity = prepared.integrity;
            }
          } catch (error) {
            if (signal?.aborted) {
              this.health.abort(node.alias);
              throw signal.reason;
            }
            if (timeout.signal.aborted) {
              this.health.abort(node.alias);
              throw timeout.signal.reason;
            }
            if (error && typeof error === 'object' && 'code' in error
              && (error as { code?: unknown }).code === 'CONTEXT_SUMMARY_CANCELLED') {
              this.health.abort(node.alias);
              throw error;
            }
            if (!isTargetPreparationFailure(error)) {
              this.health.abort(node.alias);
              throw error;
            }
            lastError = error;
            break;
          }

          const reservedAt = Date.now();
          if (!execution.budget.canStartAttempt(reservedAt, 10_000)
            || !execution.budget.reserveAttempt(reservedAt)) {
            this.health.abort(node.alias);
            break nodeLoop;
          }
          localAttemptNo += 1;
          const attemptNo = localAttemptNo;
          const launchKind = variant.trigger === 'provider_numeric_overflow'
            ? 'overflow_retry'
            : nodeIndex === 0 ? 'primary' : 'failover';
          const startedAt = Date.now();
          const attemptSnapshot = snapshotForAttempt(node.snapshot, attemptIntegrity);
          const startedEvent: Extract<ProviderAttemptEvent, { type: 'started' }> = {
            type: 'started',
            attemptNo,
            providerAlias: node.alias,
            launchKind,
            generationMode: execution.generationMode,
            ...(prepared ? { generationVariantTrigger: prepared.context.variant.trigger } : {}),
            ...(attemptIntegrity ? { integrity: attemptIntegrity } : {}),
            startedAt: new Date(startedAt),
            startDelayMs: 0,
          };
          await execution.onAttempt(startedEvent);
          if (launchKind !== 'primary') yield { type: 'switching' };

          const controller = new AbortController();
          const forwardAbort = () => controller.abort(timeout.signal.reason);
          if (timeout.signal.aborted) forwardAbort();
          else timeout.signal.addEventListener('abort', forwardAbort, { once: true });
          const iterator = node.provider.streamAnswer(
            attemptRequest,
            controller.signal,
          )[Symbol.asyncIterator]();
          let text = '';
          let firstByteAt: number | null = null;
          let firstProtocolAt: number | null = null;
          let firstModelTextAt: number | null = null;
          let firstUserVisibleAt: number | null = null;
          let latestUsage: TokenUsage | null = null;
          let terminalRecorded = false;
          const providerDeadline = createProviderDeadline({
            startedAtMs: startedAt,
            protocolTimeoutMs: execution.protocolEventTimeoutMs,
            modelTextTimeoutMs: execution.modelTextTimeoutMs,
          });

          const recordProtocol = async (atMs: number) => {
          providerDeadline.recordProtocolEvent(atMs);
          if (firstProtocolAt !== null) return;
          firstProtocolAt = atMs;
          firstByteAt = atMs;
          const elapsedMs = atMs - startedAt;
          await execution.onAttempt({
            type: 'first_protocol', attemptNo, providerAlias: node.alias, elapsedMs,
          });
          await execution.onAttempt({
            type: 'first_byte', attemptNo, providerAlias: node.alias, firstByteMs: elapsedMs,
          });
          };
          const recordModelText = async (atMs: number) => {
          await recordProtocol(atMs);
          providerDeadline.recordModelText(atMs);
          if (firstModelTextAt !== null) return;
          firstModelTextAt = atMs;
          await execution.onAttempt({
            type: 'first_model_text',
            attemptNo,
            providerAlias: node.alias,
            elapsedMs: atMs - startedAt,
          });
          };
          const recordUserVisible = async (atMs: number) => {
          if (firstUserVisibleAt !== null) return;
          firstUserVisibleAt = atMs;
          await execution.onAttempt({
            type: 'first_user_visible',
            attemptNo,
            providerAlias: node.alias,
            elapsedMs: atMs - startedAt,
          });
          };

          const recordTerminal = async (
            status: ProviderAttempt['status'],
            errorCode: string | null,
            eventUsage: TokenUsage | null,
            failure: SanitizedProviderFailure | null,
          ): Promise<ProviderAttempt> => {
            const recorded = createAttempt({
            attemptIndex: attemptNo - 1,
            snapshot: attemptSnapshot,
            startedAt: new Date(startedAt),
            firstByteAt: firstByteAt === null ? null : new Date(firstByteAt),
            firstProtocolAt: firstProtocolAt === null ? null : new Date(firstProtocolAt),
            firstModelTextAt: firstModelTextAt === null ? null : new Date(firstModelTextAt),
            firstUserVisibleAt: firstUserVisibleAt === null ? null : new Date(firstUserVisibleAt),
            usage: eventUsage,
            status,
            errorCode,
            generationMode: execution.generationMode,
            launchKind,
            executionId: execution.executionId,
            attemptNo,
            integrity: attemptIntegrity,
            generationVariantTrigger: prepared?.context.variant.trigger ?? null,
            failure,
          });
            await execution.onAttempt({
            type: status === 'completed' ? 'completed' : status === 'stopped' ? 'aborted' : 'failed',
            attemptNo,
            providerAlias: node.alias,
            durationMs: recorded.totalLatencyMs,
            winner: status === 'completed',
            errorCode,
            usage: eventUsage,
              estimatedCostUsd: recorded.knownCostUsd,
              failure,
          });
            attempts.push(recorded);
            terminalRecorded = true;
            return recorded;
          };

          try {
            while (true) {
            const deadlineMs = providerDeadline.deadlineMs();
            const adaptiveTimeout = deadlineMs === null
              ? null
              : createTimeoutSignal({
                  timeoutMs: Math.max(1, deadlineMs - Date.now()),
                  code: firstProtocolAt === null
                    ? 'PROVIDER_PROTOCOL_TIMEOUT'
                    : 'PROVIDER_MODEL_TEXT_TIMEOUT',
                  signal: timeout.signal,
                });
            let result: IteratorResult<AnswerEvent>;
            try {
              result = await raceWithSignal(
                iterator.next(),
                adaptiveTimeout?.signal ?? timeout.signal,
              );
            } finally {
              adaptiveTimeout?.dispose();
            }
            if (result.done) throw new AnswerExecutionError('PROVIDER_INCOMPLETE');
            const event = result.value;
            if (event.type === 'attempt') continue;
            if (event.type === 'switching') {
              yield event;
              continue;
            }
            if (event.type === 'activity') {
              const observedAt = Date.now();
              if (event.kind === 'protocol') await recordProtocol(observedAt);
              else await recordModelText(observedAt);
              continue;
            }
            if (event.type === 'delta') {
              if (!event.text) continue;
              await recordModelText(Date.now());
              text += event.text;
              continue;
            }

            latestUsage = event.usage;
            if (!text.trim()) throw new AnswerExecutionError('PROVIDER_INCOMPLETE');
            const recorded = await recordTerminal('completed', null, event.usage, null);
            await recordUserVisible(Date.now());
            recorded.firstUserVisibleMs = firstUserVisibleAt === null
              ? null
              : firstUserVisibleAt - startedAt;
            yield { type: 'delta', text };
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
              winner: { ...attemptSnapshot, attemptIndex: attemptNo - 1 },
            };
              return;
            }
          } catch (error) {
            const callerStopped = Boolean(signal?.aborted);
            const errorUsage = error instanceof OpenAIProviderError ? error.usage : latestUsage;
            const errorCode = callerStopped ? null : stableErrorCode(error);
            const failure = callerStopped
              ? sanitizeProviderFailure({ reason: 'cancelled' })
              : failureFor(error);
            if (!terminalRecorded) {
              const recorded = await recordTerminal(
                callerStopped ? 'stopped' : 'failed',
                errorCode,
                errorUsage,
                failure,
              );
              yield { type: 'attempt', attempt: recorded };
            }
            if (callerStopped) {
              this.health.abort(node.alias);
              throw signal?.reason;
            }
            if (!isFailoverEligible(error)) {
              this.health.abort(node.alias);
              throw error;
            }
            lastError = error;
            if (timeout.signal.aborted) throw error;
            if (execution.prepareTarget
              && !overflowRetryConsumed
              && isNumericContextOverflow(failure)) {
              overflowRetryConsumed = true;
              nextVariant = {
                trigger: 'provider_numeric_overflow',
                numericOverflow: failure,
              };
              continue;
            }
            this.health.failure(node.alias, new Date());
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
    configDigestVersion: 1,
    connectionDisplayName: position === 0 ? 'Environment' : `Environment fallback ${position}`,
    connectionVersionId: null,
    contextWindowTokens: null,
    inputUsdPerMillion: null,
    modelDisplayName: 'Configured model',
    modelId: 'configured-model',
    modelVersionId: null,
    maxOutputTokens: null,
    outputUsdPerMillion: null,
    position,
    protocol: 'responses',
    reasoningEffort: null,
    routeRevisionId: null,
    sourceType: 'environment',
  };
}

function createAttempt(input: {
  attemptIndex: number;
  snapshot: ProviderTargetSnapshot;
  startedAt: Date;
  firstByteAt: Date | null;
  firstProtocolAt?: Date | null;
  firstModelTextAt?: Date | null;
  firstUserVisibleAt?: Date | null;
  usage: TokenUsage | null;
  status: ProviderAttempt['status'];
  errorCode: string | null;
  generationMode?: ProviderAttempt['generationMode'];
  launchKind?: ProviderAttempt['launchKind'];
  executionId?: string;
  attemptNo?: number;
  integrity?: ProviderAttempt['integrity'];
  generationVariantTrigger?: ProviderAttempt['generationVariantTrigger'];
  failure?: ProviderAttempt['failure'];
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
    firstModelTextMs: (input.firstModelTextAt ?? input.firstByteAt)
      ? Math.max(0, (input.firstModelTextAt ?? input.firstByteAt)!.getTime() - input.startedAt.getTime())
      : null,
    firstProtocolEventMs: (input.firstProtocolAt ?? input.firstByteAt)
      ? Math.max(0, (input.firstProtocolAt ?? input.firstByteAt)!.getTime() - input.startedAt.getTime())
      : null,
    firstUserVisibleMs: (input.firstUserVisibleAt ?? input.firstByteAt)
      ? Math.max(0, (input.firstUserVisibleAt ?? input.firstByteAt)!.getTime() - input.startedAt.getTime())
      : null,
    generationMode: input.generationMode ?? 'normal',
    ...(input.generationVariantTrigger !== undefined
      ? { generationVariantTrigger: input.generationVariantTrigger }
      : {}),
    knownCostUsd,
    launchKind: input.launchKind ?? (input.attemptIndex === 0 ? 'primary' : 'failover'),
    startedAt: input.startedAt,
    status: input.status,
    totalLatencyMs: Math.max(0, completedAt.getTime() - input.startedAt.getTime()),
    usage: input.usage,
    usageComplete: input.usage !== null,
    ...(input.executionId ? { executionId: input.executionId } : {}),
    ...(input.attemptNo ? { attemptNo: input.attemptNo } : {}),
    ...(input.integrity !== undefined ? { integrity: input.integrity } : {}),
    ...(input.failure !== undefined ? { failure: input.failure } : {}),
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
