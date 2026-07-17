import type { TokenUsage } from './budget.ts';
import type { AiProvider, AnswerEvent, AnswerRequest } from './ai-provider.ts';
import { Semaphore } from './concurrency.ts';
import {
  createTimeoutSignal,
  OperationTimeoutError,
  raceWithSignal,
} from './timeout.ts';

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

type OpenAIResponseStreamEvent =
  | { type: 'response.output_text.delta'; delta: string }
  | {
      type: 'response.completed';
      response: { usage?: { input_tokens: number; output_tokens: number } | null };
    }
  | { type: 'response.incomplete'; response?: unknown }
  | { type: 'response.failed'; response?: { error?: { message?: string } | null } }
  | { type: 'error'; message?: string };

interface OpenAIChatCompletionChunk {
  choices: Array<{
    delta: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
}

interface OpenAIRequestOptions {
  signal?: AbortSignal;
}

export interface OpenAIChatClientLike {
  responses?: {
    create(
      body: Record<string, unknown>,
      options?: OpenAIRequestOptions,
    ): Promise<AsyncIterable<OpenAIResponseStreamEvent>>;
  };
  chat?: {
    completions: {
      create(
        body: Record<string, unknown>,
        options?: OpenAIRequestOptions,
      ): Promise<AsyncIterable<OpenAIChatCompletionChunk>>;
    };
  };
}

export interface OpenAIEmbeddingClientLike {
  embeddings: {
    create(
      body: Record<string, unknown>,
      options?: OpenAIRequestOptions,
    ): Promise<EmbeddingResponse>;
  };
}

export type OpenAIChatProtocol = 'responses' | 'chat_completions';

export type OpenAIProviderErrorCode =
  | 'EMBEDDING_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_RESPONSE_INCOMPLETE'
  | 'PROVIDER_RESPONSE_FAILED'
  | 'PROVIDER_STREAM_FAILED';

export class OpenAIProviderError extends Error {
  readonly code: OpenAIProviderErrorCode;

  constructor(code: OpenAIProviderErrorCode) {
    super(code);
    this.name = 'OpenAIProviderError';
    this.code = code;
  }
}

export interface OpenAIProviderConfig {
  protocol: OpenAIChatProtocol;
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  maxOutputTokens: number;
  embeddingTimeoutMs: number;
  firstByteTimeoutMs: number;
  totalTimeoutMs: number;
  providerConcurrency: number;
}

const generationSemaphores = new Map<number, Semaphore>();
const PROVIDER_STREAM_CLEANUP_GRACE_MS = 100;
const EMPTY_STREAM_MAX_ATTEMPTS = 2;

function isRetryableEmptyStreamError(error: unknown): boolean {
  if (!(error instanceof OpenAIProviderError)) return false;
  return error.code === 'PROVIDER_RESPONSE_INCOMPLETE';
}

function getGenerationSemaphore(capacity: number): Semaphore {
  let semaphore = generationSemaphores.get(capacity);
  if (!semaphore) {
    semaphore = new Semaphore(capacity);
    generationSemaphores.set(capacity, semaphore);
  }
  return semaphore;
}

async function closeIterator<T>(iterator: AsyncIterator<T> | undefined): Promise<void> {
  if (!iterator?.return) return;

  let cleanup: Promise<void>;
  try {
    cleanup = Promise.resolve(iterator.return()).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timer = undefined;
      resolve();
    }, PROVIDER_STREAM_CLEANUP_GRACE_MS);
  });

  try {
    await Promise.race([cleanup, grace]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function* streamWithTimeout<T>(input: {
  create: (signal: AbortSignal) => Promise<AsyncIterable<T>>;
  totalSignal: AbortSignal;
  firstByteTimeoutMs: number;
}): AsyncIterable<T> {
  const firstByteTimeout = createTimeoutSignal({
    timeoutMs: input.firstByteTimeoutMs,
    code: 'PROVIDER_FIRST_BYTE_TIMEOUT',
    signal: input.totalSignal,
  });
  let iterator: AsyncIterator<T> | undefined;
  let completed = false;

  try {
    const stream = await raceWithSignal(
      input.create(firstByteTimeout.signal),
      firstByteTimeout.signal,
    );
    iterator = stream[Symbol.asyncIterator]();
    let waitingForFirstByte = true;

    while (true) {
      const next = await raceWithSignal(iterator.next(), firstByteTimeout.signal);
      if (waitingForFirstByte) {
        waitingForFirstByte = false;
        firstByteTimeout.cancelTimeout();
      }
      if (next.done) {
        completed = true;
        return;
      }
      yield next.value;
    }
  } finally {
    if (!completed) {
      firstByteTimeout.abort();
      await closeIterator(iterator);
    }
    firstByteTimeout.dispose();
  }
}

export class OpenAIProvider implements AiProvider {
  private readonly chatClient: OpenAIChatClientLike;
  private readonly embeddingClient: OpenAIEmbeddingClientLike;
  private readonly config: OpenAIProviderConfig;
  private readonly generationSemaphore: Semaphore;

  constructor(
    chatClient: OpenAIChatClientLike,
    embeddingClient: OpenAIEmbeddingClientLike,
    config: OpenAIProviderConfig,
  ) {
    this.chatClient = chatClient;
    this.embeddingClient = embeddingClient;
    this.config = config;
    this.generationSemaphore = getGenerationSemaphore(config.providerConcurrency);
  }

  async embed(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
    const timeout = createTimeoutSignal({
      timeoutMs: this.config.embeddingTimeoutMs,
      code: 'EMBEDDING_TIMEOUT',
      signal,
    });

    try {
      const response = await raceWithSignal(
        this.embeddingClient.embeddings.create({
          model: this.config.embeddingModel,
          input: inputs,
          dimensions: this.config.embeddingDimensions,
          encoding_format: 'float',
        }, { signal: timeout.signal }),
        timeout.signal,
      );
      return response.data.map((item) => item.embedding);
    } catch (error) {
      if (timeout.signal.aborted) throw timeout.signal.reason;
      if (error instanceof OperationTimeoutError) throw error;
      throw new OpenAIProviderError('EMBEDDING_UNAVAILABLE');
    } finally {
      timeout.dispose();
    }
  }

  async *streamAnswer(
    request: AnswerRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AnswerEvent> {
    const totalTimeout = createTimeoutSignal({
      timeoutMs: this.config.totalTimeoutMs,
      code: 'PROVIDER_TOTAL_TIMEOUT',
      signal,
    });
    let release: (() => void) | undefined;
    let usage: TokenUsage | null = null;

    try {
      release = await this.generationSemaphore.acquire(totalTimeout.signal);
      for (let attempt = 0; attempt < EMPTY_STREAM_MAX_ATTEMPTS; attempt += 1) {
        const stream = this.config.protocol === 'responses'
          ? this.streamResponses(request, totalTimeout.signal)
          : this.streamChatCompletions(request, totalTimeout.signal);
        const iterator = stream[Symbol.asyncIterator]();
        let emittedOutput = false;
        let completed = false;

        try {
          while (true) {
            const next = await iterator.next();
            if (next.done) {
              usage = next.value;
              completed = true;
              break;
            }
            emittedOutput = true;
            yield next.value;
          }
          break;
        } catch (error) {
          const canRetry = attempt + 1 < EMPTY_STREAM_MAX_ATTEMPTS
            && !emittedOutput
            && !totalTimeout.signal.aborted
            && isRetryableEmptyStreamError(error);
          if (!canRetry) throw error;
        } finally {
          if (!completed) await closeIterator(iterator);
        }
      }
    } catch (error) {
      if (totalTimeout.signal.aborted) throw totalTimeout.signal.reason;
      if (error instanceof OperationTimeoutError || error instanceof OpenAIProviderError) {
        throw error;
      }
      throw new OpenAIProviderError('PROVIDER_UNAVAILABLE');
    } finally {
      release?.();
      totalTimeout.dispose();
    }

    yield { type: 'done', usage };
  }

  private async *streamResponses(
    request: AnswerRequest,
    totalSignal: AbortSignal,
  ): AsyncGenerator<AnswerEvent, TokenUsage | null, void> {
    const responses = this.chatClient.responses;
    if (!responses) throw new Error('Configured Responses client is unavailable.');

    const stream = streamWithTimeout({
      create: (requestSignal) => responses.create({
        model: this.config.chatModel,
        instructions: request.instructions,
        input: request.messages,
        max_output_tokens: this.config.maxOutputTokens,
        stream: true,
        store: false,
      }, { signal: requestSignal }),
      totalSignal,
      firstByteTimeoutMs: this.config.firstByteTimeoutMs,
    });

    let completed = false;
    let usage: TokenUsage | null = null;

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        yield { type: 'delta', text: event.delta };
      } else if (event.type === 'response.completed') {
        completed = true;
        usage = event.response.usage ? toResponseUsage(event.response.usage) : null;
      } else if (event.type === 'response.incomplete') {
        throw new OpenAIProviderError('PROVIDER_RESPONSE_INCOMPLETE');
      } else if (event.type === 'response.failed') {
        throw new OpenAIProviderError('PROVIDER_RESPONSE_FAILED');
      } else if (event.type === 'error') {
        throw new OpenAIProviderError('PROVIDER_STREAM_FAILED');
      }
    }

    if (!completed) throw new OpenAIProviderError('PROVIDER_RESPONSE_INCOMPLETE');
    return usage;
  }

  private async *streamChatCompletions(
    request: AnswerRequest,
    totalSignal: AbortSignal,
  ): AsyncGenerator<AnswerEvent, TokenUsage | null, void> {
    const completions = this.chatClient.chat?.completions;
    if (!completions) throw new Error('Configured Chat Completions client is unavailable.');

    const stream = streamWithTimeout({
      create: (requestSignal) => completions.create({
        model: this.config.chatModel,
        messages: [
          { role: 'system', content: request.instructions },
          ...request.messages,
        ],
        max_completion_tokens: this.config.maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      }, { signal: requestSignal }),
      totalSignal,
      firstByteTimeoutMs: this.config.firstByteTimeoutMs,
    });
    let usage: TokenUsage | null = null;
    let completed = false;

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        };
      }
      for (const choice of chunk.choices) {
        if (typeof choice.finish_reason === 'string' && choice.finish_reason.trim()) {
          completed = true;
        }
        if (choice.delta.content) {
          yield { type: 'delta', text: choice.delta.content };
        }
      }
    }

    if (!completed) throw new OpenAIProviderError('PROVIDER_RESPONSE_INCOMPLETE');
    return usage;
  }
}

function toResponseUsage(usage: {
  input_tokens: number;
  output_tokens: number;
}): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
}
