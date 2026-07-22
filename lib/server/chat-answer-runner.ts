import type { ChatGuardResult } from './chat-output-guard.ts';
import type { SafeChatAnswer } from './chat-safe-answer.ts';
import {
  AnswerExecutionError,
  ProviderRunError,
  type AnswerEvent,
  type ProviderAttempt,
  type ProviderWinner,
} from './ai-provider.ts';
import type { TokenUsage } from './budget.ts';

export type ChatAnswerRunnerEvent =
  | { type: 'delta'; text: string }
  | { type: 'attempt'; attempt: ProviderAttempt }
  | { type: 'reset' }
  | {
      type: 'complete';
      answer: string;
      attempts: ProviderAttempt[];
      costComplete: boolean;
      usage: TokenUsage | null;
      usageComplete: boolean;
      knownCostUsd: number | null;
      winner: ProviderWinner | null;
      degraded: boolean;
      providerAlias: string | null;
    };

export interface ChatAnswerRunnerInput {
  generate(strict: boolean): AsyncIterable<AnswerEvent>;
  inspect(answer: string): ChatGuardResult;
  safeAnswer(): SafeChatAnswer | null;
  canRegenerate(error: unknown): boolean;
}

export async function* runGuardedChatAnswer(
  input: ChatAnswerRunnerInput,
): AsyncGenerator<ChatAnswerRunnerEvent> {
  let regenerationError: unknown;
  let attemptOffset = 0;
  const attempts = new Map<number, ProviderAttempt>();

  const normalizeAttempt = (
    attempt: ProviderAttempt,
    offset: number,
  ): ProviderAttempt => ({
    ...attempt,
    attemptIndex: attempt.attemptIndex + offset,
  });

  for (const strict of [false, true]) {
    if (strict && !input.canRegenerate(regenerationError)) throw regenerationError;
    let answer = '';
    let emitted = false;
    let maximumLocalAttemptIndex = -1;
    try {
      for await (const event of input.generate(strict)) {
        if (event.type === 'delta') {
          const nextAnswer = answer + event.text;
          if (!input.inspect(nextAnswer).ok) {
            throw new AnswerExecutionError('OUTPUT_GUARD_REJECTED');
          }
          answer = nextAnswer;
          emitted = true;
          yield event;
          continue;
        }
        if (event.type === 'attempt') {
          maximumLocalAttemptIndex = Math.max(
            maximumLocalAttemptIndex,
            event.attempt.attemptIndex,
          );
          const attempt = normalizeAttempt(event.attempt, attemptOffset);
          attempts.set(attempt.attemptIndex, attempt);
          yield { type: 'attempt', attempt };
          continue;
        }
        if (!answer.trim()) throw new AnswerExecutionError('PROVIDER_INCOMPLETE');
        const completedAttempts = (event.attempts ?? []).map((attempt) => {
          maximumLocalAttemptIndex = Math.max(
            maximumLocalAttemptIndex,
            attempt.attemptIndex,
          );
          return normalizeAttempt(attempt, attemptOffset);
        });
        for (const attempt of completedAttempts) {
          attempts.set(attempt.attemptIndex, attempt);
        }
        yield {
          type: 'complete',
          answer,
          attempts: [...attempts.values()].sort(
            (left, right) => left.attemptIndex - right.attemptIndex,
          ),
          costComplete: event.costComplete ?? false,
          usage: event.usage,
          usageComplete: event.usageComplete ?? event.usage !== null,
          knownCostUsd: event.knownCostUsd ?? null,
          winner: event.winner
            ? {
                ...event.winner,
                attemptIndex: event.winner.attemptIndex + attemptOffset,
              }
            : null,
          degraded: false,
          providerAlias: event.providerAlias ?? null,
        };
        return;
      }
      throw new AnswerExecutionError('PROVIDER_INCOMPLETE');
    } catch (error) {
      if (error instanceof ProviderRunError) {
        for (const rawAttempt of error.attempts) {
          maximumLocalAttemptIndex = Math.max(
            maximumLocalAttemptIndex,
            rawAttempt.attemptIndex,
          );
          const attempt = normalizeAttempt(rawAttempt, attemptOffset);
          if (!attempts.has(attempt.attemptIndex)) {
            attempts.set(attempt.attemptIndex, attempt);
            yield { type: 'attempt', attempt };
          }
        }
      }
      if (!input.canRegenerate(error)) throw error;
      regenerationError = error;
      if (emitted) yield { type: 'reset' };
      attemptOffset += maximumLocalAttemptIndex + 1;
    }
  }

  const safe = input.safeAnswer();
  if (!safe) throw new AnswerExecutionError('OUTPUT_GUARD_REJECTED');
  yield { type: 'delta', text: safe.text };
  yield {
    type: 'complete',
    answer: safe.text,
    attempts: [...attempts.values()].sort(
      (left, right) => left.attemptIndex - right.attemptIndex,
    ),
    costComplete: attempts.size > 0
      && [...attempts.values()].every((attempt) => attempt.costComplete),
    usage: null,
    usageComplete: attempts.size > 0
      && [...attempts.values()].every((attempt) => attempt.usageComplete),
    knownCostUsd: attempts.size > 0
      && [...attempts.values()].some((attempt) => attempt.knownCostUsd !== null)
      ? [...attempts.values()].reduce(
          (total, attempt) => total + (attempt.knownCostUsd ?? 0),
          0,
        )
      : null,
    winner: null,
    degraded: true,
    providerAlias: null,
  };
}
