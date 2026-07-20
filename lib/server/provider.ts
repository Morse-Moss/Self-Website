import OpenAI from 'openai';

import {
  OpenAIProvider,
  type OpenAIChatClientLike,
  type OpenAIEmbeddingClientLike,
} from './openai-provider.ts';
import type { AiProvider } from './ai-provider.ts';
import { FailoverAiProvider } from './failover-ai-provider.ts';
import { BochaSearchProvider } from './bocha-search-provider.ts';
import type { loadServerConfig } from './config.ts';

type ServerConfig = ReturnType<typeof loadServerConfig>;

export function createProvider(config: ServerConfig): AiProvider {
  const createChatClient = (apiKey: string, baseURL: string | undefined) => new OpenAI({
    apiKey,
    baseURL,
    maxRetries: 0,
    defaultHeaders: config.openaiUserAgent
      ? { 'User-Agent': config.openaiUserAgent }
      : undefined,
  });
  const responseClient = createChatClient(config.openaiApiKey, config.openaiBaseUrl);
  const embeddingClient = new OpenAI({
    apiKey: config.embeddingApiKey,
    baseURL: config.embeddingBaseUrl,
    maxRetries: 0,
  });

  const providerConfig = {
      protocol: config.chatProtocol,
      chatModel: config.chatModel,
      embeddingModel: config.embeddingModel,
      embeddingDimensions: config.embeddingDimensions,
      maxOutputTokens: config.maxOutputTokens,
      embeddingTimeoutMs: config.embeddingTimeoutMs,
      firstByteTimeoutMs: config.providerFirstByteTimeoutMs,
      totalTimeoutMs: config.providerTotalTimeoutMs,
      providerConcurrency: config.providerConcurrency,
      reasoningEffort: config.reasoningEffort,
      outputlessMaxAttempts: config.openaiFallbacks.length > 0 ? 1 : undefined,
  };
  const primary = new OpenAIProvider(
    responseClient as unknown as OpenAIChatClientLike,
    embeddingClient as unknown as OpenAIEmbeddingClientLike,
    providerConfig,
  );
  if (config.openaiFallbacks.length === 0) return primary;

  const fallbacks = config.openaiFallbacks.map(({ apiKey, baseUrl }) => new OpenAIProvider(
    createChatClient(apiKey, baseUrl) as unknown as OpenAIChatClientLike,
    embeddingClient as unknown as OpenAIEmbeddingClientLike,
    providerConfig,
  ));
  const answerProviders = [primary, ...fallbacks];
  return new FailoverAiProvider(
    primary,
    answerProviders,
    config.providerTotalTimeoutMs * answerProviders.length,
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
