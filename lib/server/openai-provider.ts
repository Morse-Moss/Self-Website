import type { AiProvider, AnswerEvent, AnswerRequest } from './ai-provider.ts';

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

type OpenAIStreamEvent =
  | { type: 'response.output_text.delta'; delta: string }
  | {
      type: 'response.completed';
      response: { usage?: { input_tokens: number; output_tokens: number } | null };
    }
  | { type: 'response.failed'; response?: { error?: { message?: string } | null } }
  | { type: 'error'; message?: string };

export interface OpenAIResponseClientLike {
  responses: {
    create(body: Record<string, unknown>): Promise<AsyncIterable<OpenAIStreamEvent>>;
  };
}

export interface OpenAIEmbeddingClientLike {
  embeddings: {
    create(body: Record<string, unknown>): Promise<EmbeddingResponse>;
  };
}

export interface OpenAIProviderConfig {
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  maxOutputTokens: number;
}

export class OpenAIProvider implements AiProvider {
  private readonly responseClient: OpenAIResponseClientLike;
  private readonly embeddingClient: OpenAIEmbeddingClientLike;
  private readonly config: OpenAIProviderConfig;

  constructor(
    responseClient: OpenAIResponseClientLike,
    embeddingClient: OpenAIEmbeddingClientLike,
    config: OpenAIProviderConfig,
  ) {
    this.responseClient = responseClient;
    this.embeddingClient = embeddingClient;
    this.config = config;
  }

  async embed(inputs: string[]): Promise<number[][]> {
    const response = await this.embeddingClient.embeddings.create({
      model: this.config.embeddingModel,
      input: inputs,
      dimensions: this.config.embeddingDimensions,
      encoding_format: 'float',
    });
    return response.data.map((item) => item.embedding);
  }

  async *streamAnswer(request: AnswerRequest): AsyncIterable<AnswerEvent> {
    const stream = await this.responseClient.responses.create({
      model: this.config.chatModel,
      instructions: request.instructions,
      input: request.messages,
      max_output_tokens: this.config.maxOutputTokens,
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        yield { type: 'delta', text: event.delta };
      } else if (event.type === 'response.completed') {
        const usage = event.response.usage;
        yield {
          type: 'done',
          usage: {
            inputTokens: usage?.input_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0,
          },
        };
        return;
      } else if (event.type === 'response.failed') {
        throw new Error(event.response?.error?.message || 'OpenAI response failed.');
      } else if (event.type === 'error') {
        throw new Error(event.message || 'OpenAI stream failed.');
      }
    }
  }
}
