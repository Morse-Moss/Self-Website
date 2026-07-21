import OpenAI from 'openai';

import {
  OpenAIProvider,
  type OpenAIChatClientLike,
  type OpenAIEmbeddingClientLike,
} from './openai-provider.ts';
import type {
  AiProvider,
  ProviderTargetSnapshot,
} from './ai-provider.ts';
import { FailoverAiProvider } from './failover-ai-provider.ts';
import { ProviderHealthRegistry } from './provider-health.ts';
import { BochaSearchProvider } from './bocha-search-provider.ts';
import type { loadServerConfig } from './config.ts';
import {
  createPinnedProviderFetch,
  createProviderOutboundPolicy,
  type ProviderOutboundPolicy,
} from './provider-outbound.ts';

type ServerConfig = ReturnType<typeof loadServerConfig>;
type ProviderFactoryConfig = Pick<ServerConfig,
  | 'embeddingApiKey'
  | 'embeddingBaseUrl'
  | 'embeddingDimensions'
  | 'embeddingModel'
  | 'embeddingTimeoutMs'
  | 'providerConcurrency'
  | 'providerFirstByteTimeoutMs'
  | 'providerTotalTimeoutMs'
>;
const sharedProviderHealthRegistry = new ProviderHealthRegistry();

export interface ResolvedChatTarget {
  apiKey: string;
  baseUrl: string | undefined;
  maxOutputTokens: number;
  reasoningEffort: ServerConfig['reasoningEffort'];
  snapshot: ProviderTargetSnapshot;
  userAgent: string | null;
}

function createChatClient(
  target: ResolvedChatTarget,
  policy: ProviderOutboundPolicy,
): OpenAIChatClientLike {
  return new OpenAI({
    apiKey: target.apiKey,
    baseURL: target.baseUrl,
    maxRetries: 0,
    defaultHeaders: target.userAgent ? { 'User-Agent': target.userAgent } : undefined,
    fetch: createPinnedProviderFetch({ policy }),
  }) as unknown as OpenAIChatClientLike;
}

function createEmbeddingClient(config: ProviderFactoryConfig): OpenAIEmbeddingClientLike {
  return new OpenAI({
    apiKey: config.embeddingApiKey,
    baseURL: config.embeddingBaseUrl,
    maxRetries: 0,
  }) as unknown as OpenAIEmbeddingClientLike;
}

export function createProviderFromTargets(
  config: ProviderFactoryConfig,
  targets: ResolvedChatTarget[],
  input: { policy?: ProviderOutboundPolicy } = {},
): AiProvider {
  if (targets.length < 1 || targets.length > 6) {
    throw new Error('One to six chat targets are required.');
  }
  const policy = input.policy ?? createProviderOutboundPolicy();
  const embeddingClient = createEmbeddingClient(config);
  const answerTargets = targets.map((target, position) => {
    const provider = new OpenAIProvider(
      createChatClient(target, policy),
      embeddingClient,
      {
        protocol: target.snapshot.protocol,
        chatModel: target.snapshot.modelId,
        embeddingModel: config.embeddingModel,
        embeddingDimensions: config.embeddingDimensions,
        maxOutputTokens: target.maxOutputTokens,
        embeddingTimeoutMs: config.embeddingTimeoutMs,
        firstByteTimeoutMs: config.providerFirstByteTimeoutMs,
        totalTimeoutMs: config.providerTotalTimeoutMs,
        providerConcurrency: config.providerConcurrency,
        reasoningEffort: target.reasoningEffort,
        outputlessMaxAttempts: targets.length > 1 ? 1 : undefined,
      },
    );
    return {
      alias: position === 0 ? 'primary' : `fallback-${position}`,
      provider,
      snapshot: target.snapshot,
    };
  });
  return new FailoverAiProvider(
    answerTargets[0].provider,
    answerTargets,
    config.providerTotalTimeoutMs,
    sharedProviderHealthRegistry,
  );
}

export function createProvider(config: ServerConfig): AiProvider {
  const nodes = [
    { apiKey: config.openaiApiKey, baseUrl: config.openaiBaseUrl },
    ...config.openaiFallbacks,
  ];
  return createProviderFromTargets(config, nodes.map((node, position) => ({
    apiKey: node.apiKey,
    baseUrl: node.baseUrl,
    maxOutputTokens: config.maxOutputTokens,
    reasoningEffort: config.reasoningEffort,
    userAgent: config.openaiUserAgent ?? null,
    snapshot: {
      configDigest: '0'.repeat(64),
      connectionDisplayName: position === 0
        ? 'Environment primary'
        : `Environment fallback ${position}`,
      connectionVersionId: null,
      inputUsdPerMillion: config.tokenRates?.inputUsdPerMillion.toString() ?? null,
      modelDisplayName: config.chatModel,
      modelId: config.chatModel,
      modelVersionId: null,
      outputUsdPerMillion: config.tokenRates?.outputUsdPerMillion.toString() ?? null,
      position,
      protocol: config.chatProtocol,
      routeRevisionId: null,
      sourceType: 'environment',
    },
  })));
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
