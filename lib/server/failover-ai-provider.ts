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

interface ActiveAttempt {
  attemptNo: number;
  node: ProviderNode;
  controller: AbortController;
  iterator: AsyncIterator<AnswerEvent>;
  next: Promise<AttemptResult>;
  firstByteAt: number | null;
  startedAt: number;
  text: string;
  releasedLength: number;
  firstByte: boolean;
}

type AttemptResult =
  | { attempt: ActiveAttempt; kind: 'event'; result: IteratorResult<AnswerEvent> }
  | { attempt: ActiveAttempt; kind: 'error'; error: unknown };

function addUsage(current: TokenUsage | null, next: TokenUsage | null): TokenUsage | null {
  if (!next) return current;
  if (!current) return next;
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
  };
}

function stableErrorCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  return /^[A-Z0-9_]{1,80}$/u.test(code) ? code : 'PROVIDER_UNAVAILABLE';
}

function wait(milliseconds: number): Promise<'timer'> {
  return new Promise((resolve) => setTimeout(() => resolve('timer'), Math.max(0, milliseconds)));
}

function nextResult(attempt: ActiveAttempt): Promise<AttemptResult> {
  return attempt.iterator.next().then(
    (result) => ({ attempt, kind: 'event' as const, result }),
    (error: unknown) => ({ attempt, kind: 'error' as const, error }),
  );
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
    const timeout = createTimeoutSignal({ timeoutMs: execution.totalTimeoutMs, code: 'PROVIDER_TOTAL_TIMEOUT', signal });
    const active = new Set<ActiveAttempt>();
    const attempts: ProviderAttempt[] = [];
    const startedAt = Date.now();
    let nextNode = 0;
    let usage: TokenUsage | null = null;
    let winner: ActiveAttempt | null = null;
    let lastError: unknown;
    let guardRejected = false;
    let hedgeBlockedNode: number | null = null;
    const timeoutFailure = new Promise<never>((_resolve, reject) => {
      if (timeout.signal.aborted) reject(timeout.signal.reason);
      else timeout.signal.addEventListener('abort', () => reject(timeout.signal.reason), { once: true });
    });

    const startAttempt = async (index: number, launchKind: 'primary' | 'hedge' | 'failover') => {
      const node = this.nodes[index];
      if (!this.health.acquire(node.alias, new Date())) return false;
      const event: Extract<ProviderAttemptEvent, { type: 'started' }> = {
        type: 'started', attemptNo: index + 1, providerAlias: node.alias, launchKind,
        startedAt: new Date(), startDelayMs: execution.delaysMs[index] ?? 0,
      };
      if (launchKind === 'hedge') {
        if (!await execution.reserveHedgedAttempt(event)) {
          this.health.abort(node.alias);
          return false;
        }
      } else {
        await execution.onAttempt(event);
      }
      const controller = new AbortController();
      const abort = () => controller.abort(timeout.signal.reason);
      if (timeout.signal.aborted) abort();
      else timeout.signal.addEventListener('abort', abort, { once: true });
      const iterator = node.provider.streamAnswer(request, controller.signal)[Symbol.asyncIterator]();
      const attempt = {
        attemptNo: index + 1, node, controller, iterator, startedAt: Date.now(),
        text: '', releasedLength: 0, firstByte: false, firstByteAt: null,
      } as ActiveAttempt;
      attempt.next = nextResult(attempt);
      active.add(attempt);
      return true;
    };

    const launchEligible = async () => {
      while (nextNode < this.nodes.length && active.size < 2 && !winner) {
        const eligibleAt = execution.delaysMs[nextNode] ?? 0;
        if (Date.now() - startedAt < eligibleAt) break;
        const launchKind = nextNode === 0 ? 'primary' : active.size === 0 ? 'failover' : 'hedge';
        if (launchKind === 'hedge' && !execution.hedgingEnabled) break;
        if (launchKind === 'hedge' && hedgeBlockedNode === nextNode) break;
        const launched = await startAttempt(nextNode, launchKind);
        if (!launched && launchKind === 'hedge') {
          hedgeBlockedNode = nextNode;
          break;
        }
        hedgeBlockedNode = null;
        nextNode += 1;
      }
    };

    try {
      await launchEligible();
      while (active.size > 0 || nextNode < this.nodes.length) {
        if (timeout.signal.aborted) throw timeout.signal.reason;
        await launchEligible();
        if (active.size === 0) {
          const delay = (execution.delaysMs[nextNode] ?? 0) - (Date.now() - startedAt);
          if (delay > 0) await Promise.race([wait(delay), timeoutFailure]);
          await launchEligible();
          if (active.size === 0 && nextNode >= this.nodes.length) break;
        }
        const nextDelay = nextNode < this.nodes.length && !(hedgeBlockedNode === nextNode && active.size > 0)
          ? (execution.delaysMs[nextNode] ?? 0) - (Date.now() - startedAt)
          : Number.POSITIVE_INFINITY;
        const races: Array<Promise<AttemptResult | 'timer'>> = [...active].map((attempt) => attempt.next);
        if (Number.isFinite(nextDelay) && active.size < 2 && !winner) races.push(wait(nextDelay));
        races.push(timeoutFailure);
        const outcome = await Promise.race(races);
        if (outcome === 'timer') continue;
        const attempt = outcome.attempt;
        if (!active.has(attempt)) continue;

        if (outcome.kind === 'error') {
          active.delete(attempt);
          const aborted = attempt.controller.signal.aborted;
          const errorUsage = outcome.error instanceof OpenAIProviderError ? outcome.error.usage : null;
          usage = addUsage(usage, errorUsage);
          await execution.onAttempt({
            type: aborted ? 'aborted' : 'failed', attemptNo: attempt.attemptNo,
            providerAlias: attempt.node.alias, durationMs: Date.now() - attempt.startedAt,
            winner: false, errorCode: aborted ? null : stableErrorCode(outcome.error), usage: errorUsage,
          });
          const recordedAttempt = createAttempt({
            attemptIndex: attempt.attemptNo - 1,
            snapshot: attempt.node.snapshot,
            startedAt: new Date(attempt.startedAt),
            firstByteAt: attempt.firstByteAt === null ? null : new Date(attempt.firstByteAt),
            usage: errorUsage,
            status: aborted ? 'stopped' : 'failed',
            errorCode: aborted ? null : stableErrorCode(outcome.error),
          });
          attempts.push(recordedAttempt);
          yield { type: 'attempt', attempt: recordedAttempt };
          if (aborted) this.health.abort(attempt.node.alias);
          else this.health.failure(attempt.node.alias, new Date());
          if (!aborted) lastError = outcome.error;
          continue;
        }

        if (outcome.result.done) {
          active.delete(attempt);
          if (!winner) {
            lastError = new AnswerExecutionError('PROVIDER_INCOMPLETE');
            this.health.failure(attempt.node.alias, new Date());
            await execution.onAttempt({
              type: 'failed',
              attemptNo: attempt.attemptNo,
              providerAlias: attempt.node.alias,
              durationMs: Date.now() - attempt.startedAt,
              winner: false,
              errorCode: 'PROVIDER_INCOMPLETE',
              usage: null,
            });
            const recordedAttempt = createAttempt({
              attemptIndex: attempt.attemptNo - 1,
              snapshot: attempt.node.snapshot,
              startedAt: new Date(attempt.startedAt),
              firstByteAt: attempt.firstByteAt === null ? null : new Date(attempt.firstByteAt),
              usage: null,
              status: 'failed',
              errorCode: 'PROVIDER_INCOMPLETE',
            });
            attempts.push(recordedAttempt);
            yield { type: 'attempt', attempt: recordedAttempt };
          }
          continue;
        }
        const event = outcome.result.value;
        if (event.type === 'delta') {
          if (!attempt.firstByte) {
            attempt.firstByte = true;
            attempt.firstByteAt = Date.now();
            await execution.onAttempt({ type: 'first_byte', attemptNo: attempt.attemptNo, providerAlias: attempt.node.alias, firstByteMs: Date.now() - attempt.startedAt });
          }
          attempt.text += event.text;
          const completeSegment = /[.!?\n\u3002\uFF01\uFF1F]\s*$/u.test(attempt.text);
          if (execution.releasePolicy === 'segment' && completeSegment && attempt.text.length >= execution.minimumBufferCharacters) {
            if (execution.acceptCandidate(attempt.text, false)) {
              if (!winner) {
                winner = attempt;
                for (const other of active) if (other !== attempt) other.controller.abort(new Error('LOSER_ABORTED'));
              }
              if (winner === attempt && attempt.text.length > attempt.releasedLength) {
                yield { type: 'delta', text: attempt.text.slice(attempt.releasedLength) };
                attempt.releasedLength = attempt.text.length;
              }
            } else if (winner === attempt) {
              await execution.onAttempt({
                type: 'failed', attemptNo: attempt.attemptNo, providerAlias: attempt.node.alias,
                durationMs: Date.now() - attempt.startedAt, winner: false,
                errorCode: 'OUTPUT_GUARD_REJECTED', usage: null,
              });
              const recordedAttempt = createAttempt({
                attemptIndex: attempt.attemptNo - 1,
                snapshot: attempt.node.snapshot,
                startedAt: new Date(attempt.startedAt),
                firstByteAt: attempt.firstByteAt === null ? null : new Date(attempt.firstByteAt),
                usage: null,
                status: 'failed',
                errorCode: 'OUTPUT_GUARD_REJECTED',
              });
              attempts.push(recordedAttempt);
              yield { type: 'attempt', attempt: recordedAttempt };
              active.delete(attempt);
              this.health.success(attempt.node.alias);
              attempt.controller.abort(new Error('OUTPUT_GUARD_REJECTED'));
              throw new AnswerExecutionError('OUTPUT_GUARD_REJECTED');
            }
          }
          attempt.next = nextResult(attempt);
          continue;
        }

        if (event.type === 'attempt') {
          attempt.next = nextResult(attempt);
          continue;
        }

        usage = addUsage(usage, event.usage);
        const accepted = execution.acceptCandidate(attempt.text, true);
        if (execution.releasePolicy === 'complete' && accepted && !winner) {
          winner = attempt;
          for (const other of active) if (other !== attempt) other.controller.abort(new Error('LOSER_ABORTED'));
          if (attempt.text) yield { type: 'delta', text: attempt.text };
        } else if (execution.releasePolicy === 'segment' && !winner && accepted) {
          winner = attempt;
          if (attempt.text) yield { type: 'delta', text: attempt.text };
        }
        const isWinner = winner === attempt;
        await execution.onAttempt({
          type: accepted ? 'completed' : 'failed', attemptNo: attempt.attemptNo,
          providerAlias: attempt.node.alias, durationMs: Date.now() - attempt.startedAt,
          winner: isWinner, errorCode: accepted ? null : 'OUTPUT_GUARD_REJECTED', usage: event.usage,
        });
        const recordedAttempt = createAttempt({
          attemptIndex: attempt.attemptNo - 1,
          snapshot: attempt.node.snapshot,
          startedAt: new Date(attempt.startedAt),
          firstByteAt: attempt.firstByteAt === null ? null : new Date(attempt.firstByteAt),
          usage: event.usage,
          status: accepted ? 'completed' : 'failed',
          errorCode: accepted ? null : 'OUTPUT_GUARD_REJECTED',
        });
        attempts.push(recordedAttempt);
        yield { type: 'attempt', attempt: recordedAttempt };
        active.delete(attempt);
        if (accepted) this.health.success(attempt.node.alias);
        else {
          guardRejected = true;
          this.health.success(attempt.node.alias);
        }
      }
      if (!winner) {
        if (guardRejected) throw new AnswerExecutionError('OUTPUT_GUARD_REJECTED');
        throw lastError ?? new AnswerExecutionError('PROVIDER_INCOMPLETE');
      }
      const aggregate = aggregateAttempts(attempts);
      yield {
        type: 'done',
        attempts: [...attempts],
        costComplete: aggregate.costComplete,
        knownCostUsd: aggregate.knownCostUsd,
        providerAlias: winner.node.alias,
        usage: aggregate.usage,
        usageComplete: aggregate.usageComplete,
        winner: {
          ...winner.node.snapshot,
          attemptIndex: winner.attemptNo - 1,
        },
      };
    } finally {
      for (const attempt of active) {
        attempt.controller.abort(timeout.signal.reason ?? new Error('EXECUTION_CLOSED'));
        await execution.onAttempt({
          type: 'aborted', attemptNo: attempt.attemptNo, providerAlias: attempt.node.alias,
          durationMs: Date.now() - attempt.startedAt, winner: false, errorCode: null, usage: null,
        });
        this.health.abort(attempt.node.alias);
      }
      await Promise.all([...active].map(async (attempt) => {
        if (!attempt.iterator.return) return;
        await Promise.race([
          Promise.resolve(attempt.iterator.return()).catch(() => undefined),
          wait(100),
        ]);
      }));
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
