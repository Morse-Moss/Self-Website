import type { TokenUsage } from './budget.ts';
import type {
  AiProvider,
  AnswerEvent,
  AnswerReasoningEffort,
  AnswerRequest,
} from './ai-provider.ts';
import { Semaphore } from './concurrency.ts';
import {
  createTimeoutSignal,
  OperationTimeoutError,
  raceWithSignal,
} from './timeout.ts';
import {
  sanitizeProviderFailure,
  type SanitizedProviderFailure,
} from './provider-failure.ts';

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

interface OpenAIResponseUsage {
  input_tokens: number;
  output_tokens: number;
}

type OpenAIResponseStreamEvent =
  | { type: 'response.created'; response?: unknown }
  | {
      type: 'response.output_text.delta';
      delta: string;
      item_id?: string;
      output_index?: number;
      content_index?: number;
    }
  | {
      type: 'response.output_text.done';
      text: string;
      item_id?: string;
      output_index?: number;
      content_index?: number;
    }
  | {
      type: 'response.completed';
      response: { usage?: OpenAIResponseUsage | null };
    }
  | {
      type: 'response.incomplete';
      response?: {
        usage?: OpenAIResponseUsage | null;
        incomplete_details?: { reason?: unknown } | null;
        context_window_tokens?: unknown;
      };
    }
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
  readonly failure: SanitizedProviderFailure;
  readonly usage: TokenUsage | null;

  constructor(
    code: OpenAIProviderErrorCode,
    usage: TokenUsage | null = null,
    failure?: SanitizedProviderFailure,
  ) {
    super(code);
    this.name = 'OpenAIProviderError';
    this.code = code;
    this.failure = Object.freeze(failure ?? sanitizeProviderFailure({
      reason: code === 'PROVIDER_RESPONSE_INCOMPLETE'
        ? 'response_incomplete'
        : code === 'PROVIDER_RESPONSE_FAILED'
          ? 'response_failed'
          : code === 'PROVIDER_STREAM_FAILED'
            ? 'stream_failed'
            : 'transport',
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    }));
    this.usage = usage;
  }
}

export interface OpenAIProviderConfig {
  protocol: OpenAIChatProtocol;
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  maxOutputTokens: number | null;
  contextWindowTokens: number | null;
  embeddingTimeoutMs: number;
  firstByteTimeoutMs: number;
  totalTimeoutMs: number;
  providerConcurrency: number;
  reasoningEffort?: AnswerReasoningEffort;
  outputlessMaxAttempts?: number;
}

export type OpenAIEmbeddingConfig = Pick<
  OpenAIProviderConfig,
  'embeddingModel' | 'embeddingDimensions' | 'embeddingTimeoutMs'
>;

export class OpenAIEmbeddingProvider {
  private readonly client: OpenAIEmbeddingClientLike;
  private readonly config: OpenAIEmbeddingConfig;

  constructor(
    client: OpenAIEmbeddingClientLike,
    config: OpenAIEmbeddingConfig,
  ) {
    this.client = client;
    this.config = config;
  }

  async embed(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
    const timeout = createTimeoutSignal({
      timeoutMs: this.config.embeddingTimeoutMs,
      code: 'EMBEDDING_TIMEOUT',
      signal,
    });

    try {
      const response = await raceWithSignal(
        this.client.embeddings.create({
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
}

export type OpenAIAnswerBodyConfig = Pick<
  OpenAIProviderConfig,
  'chatModel' | 'maxOutputTokens' | 'reasoningEffort'
>;

function freezeOutboundValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => freezeOutboundValue(item)));
  }
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      copy[key] = freezeOutboundValue(item);
    }
    return Object.freeze(copy);
  }
  return value;
}

function freezeOutboundBody(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return freezeOutboundValue(value) as Readonly<Record<string, unknown>>;
}

function effectiveOutputTokens(
  request: AnswerRequest,
  config: OpenAIAnswerBodyConfig,
): number | null {
  const value = request.maxOutputTokens ?? config.maxOutputTokens;
  if (value !== null && safeInteger(value, 1) !== value) throw preparedBodyError();
  return value;
}

function isDeepFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object') return true;
  if (seen.has(value)) return false;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as Record<string, unknown>)
    .every((item) => isDeepFrozen(item, seen));
}

function preparedBodyError(): OpenAIProviderError {
  return new OpenAIProviderError(
    'PROVIDER_UNAVAILABLE',
    null,
    sanitizeProviderFailure({ reason: 'transport' }),
  );
}

function validatePreparedBody(
  body: Readonly<Record<string, unknown>>,
  protocol: OpenAIChatProtocol,
  model: string,
): Readonly<Record<string, unknown>> {
  if (!isDeepFrozen(body)
    || body.model !== model
    || body.stream !== true) {
    throw preparedBodyError();
  }
  if (protocol === 'responses') {
    if (!Array.isArray(body.input)
      || Object.hasOwn(body, 'messages')
      || body.store !== false
      || Object.hasOwn(body, 'max_completion_tokens')
      || (Object.hasOwn(body, 'max_output_tokens')
        && safeInteger(body.max_output_tokens, 1) !== body.max_output_tokens)) {
      throw preparedBodyError();
    }
  } else if (!Array.isArray(body.messages)
    || Object.hasOwn(body, 'input')
    || Object.hasOwn(body, 'max_output_tokens')
    || (Object.hasOwn(body, 'max_completion_tokens')
      && safeInteger(body.max_completion_tokens, 1) !== body.max_completion_tokens)
    || safeRecord(body.stream_options).include_usage !== true) {
    throw preparedBodyError();
  }
  return body;
}

function safeInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

function sdkFailure(error: unknown, configuredWindow: number | null): SanitizedProviderFailure {
  const outer = safeRecord(error);
  const nested = safeRecord(outer.error);
  const usage = safeRecord(outer.usage);
  return sanitizeProviderFailure({
    httpStatus: safeInteger(outer.status, 100, 599),
    code: outer.code === 'context_length_exceeded'
      ? outer.code
      : nested.code === 'context_length_exceeded' ? nested.code : null,
    inputTokens: safeInteger(
      outer.input_tokens ?? usage.input_tokens ?? usage.prompt_tokens,
      0,
    ),
    outputTokens: safeInteger(
      outer.output_tokens ?? usage.output_tokens ?? usage.completion_tokens,
      0,
    ),
    contextWindowTokens: safeInteger(
      outer.context_window_tokens ?? nested.context_window_tokens,
      1,
    ) ?? configuredWindow,
  });
}

export function buildOpenAIResponsesBody(
  request: AnswerRequest,
  config: OpenAIAnswerBodyConfig,
): Readonly<Record<string, unknown>> {
  const reasoningEffort = request.reasoningEffort ?? config.reasoningEffort;
  const maxOutputTokens = effectiveOutputTokens(request, config);
  return freezeOutboundBody({
    model: config.chatModel,
    instructions: request.instructions,
    input: request.messages,
    ...(maxOutputTokens === null ? {} : { max_output_tokens: maxOutputTokens }),
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    stream: true,
    store: false,
  });
}

export function buildOpenAIChatCompletionsBody(
  request: AnswerRequest,
  config: OpenAIAnswerBodyConfig,
): Readonly<Record<string, unknown>> {
  const reasoningEffort = request.reasoningEffort ?? config.reasoningEffort;
  const maxOutputTokens = effectiveOutputTokens(request, config);
  return freezeOutboundBody({
    model: config.chatModel,
    messages: [
      { role: 'system', content: request.instructions },
      ...request.messages,
    ],
    ...(maxOutputTokens === null ? {} : { max_completion_tokens: maxOutputTokens }),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    stream: true,
    stream_options: { include_usage: true },
  });
}

export function buildResponsesAnswerBody(
  config: OpenAIAnswerBodyConfig,
  request: AnswerRequest,
): Readonly<Record<string, unknown>> {
  return buildOpenAIResponsesBody(request, config);
}

export function buildChatCompletionsAnswerBody(
  config: OpenAIAnswerBodyConfig,
  request: AnswerRequest,
): Readonly<Record<string, unknown>> {
  return buildOpenAIChatCompletionsBody(request, config);
}

const generationSemaphores = new Map<number, Semaphore>();
const PROVIDER_STREAM_CLEANUP_GRACE_MS = 100;

function responseTextPartKey(event: {
  item_id?: string;
  output_index?: number;
  content_index?: number;
}): string {
  return `${event.item_id ?? ''}:${event.output_index ?? ''}:${event.content_index ?? ''}`;
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
  private readonly embeddingProvider: OpenAIEmbeddingProvider;
  private readonly config: OpenAIProviderConfig;
  private readonly generationSemaphore: Semaphore;

  constructor(
    chatClient: OpenAIChatClientLike,
    embeddingClient: OpenAIEmbeddingClientLike,
    config: OpenAIProviderConfig,
  ) {
    this.chatClient = chatClient;
    this.embeddingProvider = new OpenAIEmbeddingProvider(embeddingClient, config);
    this.config = config;
    this.generationSemaphore = getGenerationSemaphore(config.providerConcurrency);
  }

  async embed(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
    return this.embeddingProvider.embed(inputs, signal);
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
            if (!emittedOutput) {
              throw new OpenAIProviderError('PROVIDER_RESPONSE_INCOMPLETE', usage);
            }
            completed = true;
            break;
          }
          if (next.value.type === 'delta' && next.value.text.trim()) {
            emittedOutput = true;
          }
          yield next.value;
        }
      } finally {
        if (!completed) await closeIterator(iterator);
      }
    } catch (error) {
      if (totalTimeout.signal.aborted) throw totalTimeout.signal.reason;
      if (error instanceof OperationTimeoutError || error instanceof OpenAIProviderError) {
        throw error;
      }
      throw new OpenAIProviderError(
        'PROVIDER_UNAVAILABLE',
        null,
        sdkFailure(error, this.config.contextWindowTokens),
      );
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

    const startedAt = Date.now();
    const body = request.preparedOutboundBody
      ? validatePreparedBody(request.preparedOutboundBody, 'responses', this.config.chatModel)
      : buildResponsesAnswerBody(this.config, request);
    const stream = streamWithTimeout({
      create: (requestSignal) => responses.create(
        body as Record<string, unknown>,
        { signal: requestSignal },
      ),
      totalSignal,
      firstByteTimeoutMs: request.execution
        ? Math.min(this.config.totalTimeoutMs, request.execution.totalTimeoutMs)
        : this.config.firstByteTimeoutMs,
    });

    let completed = false;
    let usage: TokenUsage | null = null;
    const streamedTextParts = new Set<string>();
    let protocolEmitted = false;
    let modelTextEmitted = false;

    for await (const event of stream) {
      if (request.execution && !protocolEmitted) {
        protocolEmitted = true;
        yield { type: 'activity', kind: 'protocol', elapsedMs: Date.now() - startedAt };
      }
      if (event.type === 'response.output_text.delta') {
        if (!event.delta) continue;
        if (request.execution && !modelTextEmitted) {
          modelTextEmitted = true;
          yield { type: 'activity', kind: 'model_text', elapsedMs: Date.now() - startedAt };
        }
        streamedTextParts.add(responseTextPartKey(event));
        yield { type: 'delta', text: event.delta };
      } else if (event.type === 'response.output_text.done') {
        const partKey = responseTextPartKey(event);
        if (event.text && !streamedTextParts.has(partKey)) {
          if (request.execution && !modelTextEmitted) {
            modelTextEmitted = true;
            yield { type: 'activity', kind: 'model_text', elapsedMs: Date.now() - startedAt };
          }
          streamedTextParts.add(partKey);
          yield { type: 'delta', text: event.text };
        }
      } else if (event.type === 'response.completed') {
        completed = true;
        usage = event.response.usage ? toResponseUsage(event.response.usage) : null;
      } else if (event.type === 'response.incomplete') {
        const incompleteUsage = event.response?.usage
          ? toResponseUsage(event.response.usage)
          : null;
        const suppliedReason = event.response?.incomplete_details?.reason;
        const reason = suppliedReason === 'max_output_tokens'
          ? suppliedReason
          : suppliedReason === 'context_length_exceeded'
            ? suppliedReason
            : 'response_incomplete';
        throw new OpenAIProviderError(
          'PROVIDER_RESPONSE_INCOMPLETE',
          incompleteUsage,
          sanitizeProviderFailure({
            reason,
            inputTokens: incompleteUsage?.inputTokens,
            outputTokens: incompleteUsage?.outputTokens,
            contextWindowTokens: safeInteger(event.response?.context_window_tokens, 1)
              ?? this.config.contextWindowTokens,
          }),
        );
      } else if (event.type === 'response.failed') {
        throw new OpenAIProviderError(
          'PROVIDER_RESPONSE_FAILED',
          null,
          sanitizeProviderFailure({ reason: 'response_failed' }),
        );
      } else if (event.type === 'error') {
        throw new OpenAIProviderError(
          'PROVIDER_STREAM_FAILED',
          null,
          sanitizeProviderFailure({ reason: 'stream_failed' }),
        );
      }
    }

    if (!completed) {
      throw new OpenAIProviderError(
        'PROVIDER_RESPONSE_INCOMPLETE',
        usage,
        sanitizeProviderFailure({
          reason: 'response_incomplete',
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          contextWindowTokens: this.config.contextWindowTokens,
        }),
      );
    }
    return usage;
  }

  private async *streamChatCompletions(
    request: AnswerRequest,
    totalSignal: AbortSignal,
  ): AsyncGenerator<AnswerEvent, TokenUsage | null, void> {
    const completions = this.chatClient.chat?.completions;
    if (!completions) throw new Error('Configured Chat Completions client is unavailable.');

    const startedAt = Date.now();
    const body = request.preparedOutboundBody
      ? validatePreparedBody(request.preparedOutboundBody, 'chat_completions', this.config.chatModel)
      : buildChatCompletionsAnswerBody(this.config, request);
    const stream = streamWithTimeout({
      create: (requestSignal) => completions.create(
        body as Record<string, unknown>,
        { signal: requestSignal },
      ),
      totalSignal,
      firstByteTimeoutMs: request.execution
        ? Math.min(this.config.totalTimeoutMs, request.execution.totalTimeoutMs)
        : this.config.firstByteTimeoutMs,
    });
    let usage: TokenUsage | null = null;
    let completed = false;
    let terminalFinishReason: string | null = null;
    let protocolEmitted = false;
    let modelTextEmitted = false;

    for await (const chunk of stream) {
      if (request.execution && !protocolEmitted) {
        protocolEmitted = true;
        yield { type: 'activity', kind: 'protocol', elapsedMs: Date.now() - startedAt };
      }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        };
      }
      for (const choice of chunk.choices) {
        if (typeof choice.finish_reason === 'string' && choice.finish_reason.trim()) {
          completed = true;
          if (choice.finish_reason === 'length') terminalFinishReason = 'length';
        }
        if (choice.delta.content) {
          if (request.execution && !modelTextEmitted) {
            modelTextEmitted = true;
            yield { type: 'activity', kind: 'model_text', elapsedMs: Date.now() - startedAt };
          }
          yield { type: 'delta', text: choice.delta.content };
        }
      }
    }

    if (!completed) {
      throw new OpenAIProviderError(
        'PROVIDER_RESPONSE_INCOMPLETE',
        usage,
        sanitizeProviderFailure({
          reason: 'response_incomplete',
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          contextWindowTokens: this.config.contextWindowTokens,
        }),
      );
    }
    if (terminalFinishReason === 'length') {
      throw new OpenAIProviderError(
        'PROVIDER_RESPONSE_INCOMPLETE',
        usage,
        sanitizeProviderFailure({
          reason: 'length',
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          contextWindowTokens: this.config.contextWindowTokens,
        }),
      );
    }
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
