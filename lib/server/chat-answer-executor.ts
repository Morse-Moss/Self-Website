import type { ChatSource } from '../contracts/chat.ts';
import type {
  AnswerCandidate,
  AnswerExecutor,
} from '../contracts/chat-turn-plan.ts';
import type { AnswerEvent } from './ai-provider.ts';
import {
  runChatAnswer,
  type ChatAnswerRunnerEvent,
} from './chat-answer-runner.ts';
import type { ChatExecutionBudget } from './chat-execution-budget.ts';

export type DirectAnswerOperationalEvent = Extract<
  ChatAnswerRunnerEvent,
  { type: 'attempt' | 'switching' }
>;

export interface DirectAnswerExecutionInput {
  budget: ChatExecutionBudget;
  now(): number;
  releasePolicy: 'segment' | 'complete';
  sources: readonly ChatSource[];
  generate(input: {
    remainingAttempts: number;
    remainingProviderMs: number;
  }): AsyncIterable<AnswerEvent>;
  onOperationalEvent?(event: DirectAnswerOperationalEvent): void | Promise<void>;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

export class DirectAnswerExecutor implements AnswerExecutor<DirectAnswerExecutionInput> {
  async *stream(
    input: DirectAnswerExecutionInput,
    signal: AbortSignal,
  ): AsyncGenerator<ChatAnswerRunnerEvent> {
    throwIfAborted(signal);
    for await (const event of runChatAnswer({
      budget: input.budget,
      now: input.now,
      releasePolicy: input.releasePolicy,
      generate: input.generate,
    })) {
      if (event.type === 'attempt' || event.type === 'switching') {
        await input.onOperationalEvent?.(event);
      }
      throwIfAborted(signal);
      yield event;
    }
  }

  async execute(
    input: DirectAnswerExecutionInput,
    signal: AbortSignal,
  ): Promise<AnswerCandidate> {
    for await (const event of this.stream(input, signal)) {
      if (event.type !== 'complete') continue;
      return {
        executorKind: 'direct',
        text: event.answer,
        usage: event.usage,
        attempts: event.attempts,
        winner: event.winner,
        sources: [...input.sources],
      };
    }
    throw new Error('DIRECT_ANSWER_EXECUTOR_INCOMPLETE');
  }
}
