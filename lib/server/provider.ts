import OpenAI from 'openai';

import { OpenAIProvider, type OpenAIClientLike } from './openai-provider.ts';
import type { loadServerConfig } from './config.ts';

type ServerConfig = ReturnType<typeof loadServerConfig>;

export function createProvider(config: ServerConfig): OpenAIProvider {
  const client = new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseUrl,
  });

  return new OpenAIProvider(client as unknown as OpenAIClientLike, {
    chatModel: config.chatModel,
    embeddingModel: config.embeddingModel,
    embeddingDimensions: config.embeddingDimensions,
    maxOutputTokens: config.maxOutputTokens,
  });
}
