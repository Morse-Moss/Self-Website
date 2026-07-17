import OpenAI from 'openai';

import {
  OpenAIProvider,
  type OpenAIChatClientLike,
  type OpenAIEmbeddingClientLike,
} from './openai-provider.ts';
import { BochaSearchProvider } from './bocha-search-provider.ts';
import type { loadServerConfig } from './config.ts';

type ServerConfig = ReturnType<typeof loadServerConfig>;

export function createProvider(config: ServerConfig): OpenAIProvider {
  const responseClient = new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseUrl,
    maxRetries: 0,
    defaultHeaders: config.openaiUserAgent
      ? { 'User-Agent': config.openaiUserAgent }
      : undefined,
  });
  const embeddingClient = new OpenAI({
    apiKey: config.embeddingApiKey,
    baseURL: config.embeddingBaseUrl,
    maxRetries: 0,
  });

  return new OpenAIProvider(
    responseClient as unknown as OpenAIChatClientLike,
    embeddingClient as unknown as OpenAIEmbeddingClientLike,
    {
      protocol: config.chatProtocol,
      chatModel: config.chatModel,
      embeddingModel: config.embeddingModel,
      embeddingDimensions: config.embeddingDimensions,
      maxOutputTokens: config.maxOutputTokens,
      embeddingTimeoutMs: config.embeddingTimeoutMs,
      firstByteTimeoutMs: config.providerFirstByteTimeoutMs,
      totalTimeoutMs: config.providerTotalTimeoutMs,
      providerConcurrency: config.providerConcurrency,
    },
  );
}

export function createSearchProvider(config: ServerConfig): BochaSearchProvider | null {
  if (
    !config.searchEnabled
    || config.searchProvider !== 'bocha'
    || !config.bochaApiKey
    || !config.bochaBaseUrl
  ) return null;

  return new BochaSearchProvider({
    apiKey: config.bochaApiKey,
    baseUrl: config.bochaBaseUrl,
    timeoutMs: config.searchTimeoutMs,
    concurrency: config.searchConcurrency,
    officialDomains: config.officialSourceDomains,
    githubOwners: config.officialGithubOwners,
  });
}
