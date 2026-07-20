import type { TokenUsage } from './budget.ts';
import type { AiProvider, AnswerEvent, AnswerRequest } from './ai-provider.ts';
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
  private readonly answerProviders: AiProvider[];
  private readonly totalTimeoutMs: number;

  constructor(
    embeddingProvider: AiProvider,
    answerProviders: AiProvider[],
    totalTimeoutMs: number,
  ) {
    if (answerProviders.length < 1) throw new Error('At least one answer provider is required.');
    if (!Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs < 1) {
      throw new Error('A positive safe failover timeout is required.');
    }
    this.embeddingProvider = embeddingProvider;
    this.answerProviders = answerProviders;
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
    let previousUsage: TokenUsage | null = null;
    let lastError: unknown;

    try {
      for (const [index, provider] of this.answerProviders.entries()) {
        if (totalTimeout.signal.aborted) throw totalTimeout.signal.reason;
        let emittedOutput = false;

        try {
          for await (const event of provider.streamAnswer(request, totalTimeout.signal)) {
            if (event.type === 'delta') {
              emittedOutput = true;
              yield event;
            } else {
              yield { type: 'done', usage: addUsage(previousUsage, event.usage) };
            }
          }
          return;
        } catch (error) {
          if (totalTimeout.signal.aborted) throw totalTimeout.signal.reason;
          if (emittedOutput) throw error;
          if (error instanceof OpenAIProviderError) {
            previousUsage = addUsage(previousUsage, error.usage);
          }
          lastError = error;
          if (index + 1 >= this.answerProviders.length) throw error;
        }
      }
    } finally {
      totalTimeout.dispose();
    }

    throw lastError;
  }
}
