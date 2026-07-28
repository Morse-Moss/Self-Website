import {
  AnswerExecutionError,
  ProviderRunError,
  type AnswerEvent,
  type ProviderAttempt,
  type ProviderWinner,
} from './ai-provider.ts';
import type { TokenUsage } from './budget.ts';
import type { ChatExecutionBudget } from './chat-execution-budget.ts';

export type ChatAnswerRunnerEvent =
  | { type: 'delta'; text: string }
  | { type: 'switching' }
  | { type: 'attempt'; attempt: ProviderAttempt }
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

export interface GenerateChatAnswerInput {
  remainingAttempts: number;
  remainingProviderMs: number;
}

export interface ChatAnswerRunnerInput {
  budget: ChatExecutionBudget;
  now(): number;
  releasePolicy: 'segment' | 'complete';
  generate(input: GenerateChatAnswerInput): AsyncIterable<AnswerEvent>;
}

export async function* runChatAnswer(
  input: ChatAnswerRunnerInput,
): AsyncGenerator<ChatAnswerRunnerEvent> {
  const attempts = new Map<number, ProviderAttempt>();
  let answer = '';

  try {
    for await (const event of input.generate({
      remainingAttempts: input.budget.remainingAttempts(),
      remainingProviderMs: input.budget.remainingMs(input.now()),
    })) {
      if (event.type === 'delta') {
        answer += event.text;
        continue;
      }
      if (event.type === 'attempt') {
        attempts.set(event.attempt.attemptIndex, event.attempt);
        yield event;
        continue;
      }
      if (event.type === 'switching') {
        yield event;
        continue;
      }
      if (event.type === 'activity') continue;

      if (!answer.trim()) throw new AnswerExecutionError('PROVIDER_INCOMPLETE');
      yield { type: 'delta', text: answer };
      for (const attempt of event.attempts ?? []) {
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
        winner: event.winner ?? null,
        degraded: false,
        providerAlias: event.providerAlias ?? null,
      };
      return;
    }
    throw new AnswerExecutionError('PROVIDER_INCOMPLETE');
  } catch (error) {
    if (error instanceof ProviderRunError) {
      for (const attempt of error.attempts) {
        if (!attempts.has(attempt.attemptIndex)) {
          attempts.set(attempt.attemptIndex, attempt);
          yield { type: 'attempt', attempt };
        }
      }
    }
    throw error;
  }
}
