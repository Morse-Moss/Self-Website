import OpenAI from 'openai';

import {
  OpenAIProvider,
  type OpenAIEmbeddingClientLike,
  type OpenAIResponseClientLike,
} from './openai-provider.ts';
import type { loadServerConfig } from './config.ts';

type ServerConfig = ReturnType<typeof loadServerConfig>;

export function createProvider(config: ServerConfig): OpenAIProvider {
  const responseClient = new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseUrl,
    maxRetries: 0,
  });
  const embeddingClient = new OpenAI({
    apiKey: config.embeddingApiKey,
    baseURL: config.embeddingBaseUrl,
    maxRetries: 0,
  });

  return new OpenAIProvider(
    responseClient as unknown as OpenAIResponseClientLike,
    embeddingClient as unknown as OpenAIEmbeddingClientLike,
    {
      chatModel: config.chatModel,
      embeddingModel: config.embeddingModel,
      embeddingDimensions: config.embeddingDimensions,
      maxOutputTokens: config.maxOutputTokens,
    },
  );
}
