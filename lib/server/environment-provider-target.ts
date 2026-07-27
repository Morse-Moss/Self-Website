import {
  createRuntimeConfigDigest,
  type AiConfigKey,
  type AiRouteTargetSnapshot,
} from './ai-config.ts';
import type { OpenAIReasoningEffort } from './config.ts';
import {
  validateProviderRuntimeBaseUrl,
  type ProviderOutboundPolicy,
} from './provider-outbound.ts';
import type { ProviderRuntimeConfig } from './provider-runtime.ts';

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export type EnvironmentTargetKey = 'primary' | 'fallback-1' | 'fallback-2';
export type EnvironmentBaseUrlMode =
  | 'public_default'
  | 'server_reusable'
  | 'replacement_required';

export interface AdminEnvironmentProviderTarget {
  apiKey: string;
  baseUrlMode: EnvironmentBaseUrlMode;
  baseUrlPrefill: string | null;
  digestBaseUrl: string;
  effectiveBaseUrl: string;
  key: EnvironmentTargetKey;
  maxOutputTokens: number;
  reasoningEffort: OpenAIReasoningEffort | null;
  snapshot: AiRouteTargetSnapshot;
  userAgent: string | null;
}

function configuredBaseUrlMode(
  baseUrl: string,
  outboundPolicy: ProviderOutboundPolicy,
): EnvironmentBaseUrlMode {
  try {
    validateProviderRuntimeBaseUrl(baseUrl, outboundPolicy);
    return 'server_reusable';
  } catch {
    return 'replacement_required';
  }
}

export function listAdminEnvironmentTargets(
  config: ProviderRuntimeConfig,
  configKey: AiConfigKey,
  outboundPolicy: ProviderOutboundPolicy,
): AdminEnvironmentProviderTarget[] {
  const nodes: Array<{
    apiKey: string;
    configuredBaseUrl: string | undefined;
    key: EnvironmentTargetKey;
    name: string;
  }> = [
    {
      apiKey: config.openaiApiKey,
      configuredBaseUrl: config.openaiBaseUrl,
      key: 'primary',
      name: 'Environment primary',
    },
    ...config.openaiFallbacks.slice(0, 2).map((target, index) => ({
      apiKey: target.apiKey,
      configuredBaseUrl: target.baseUrl,
      key: `fallback-${index + 1}` as EnvironmentTargetKey,
      name: `Environment fallback ${index + 1}`,
    })),
  ];

  return nodes.map((target, position) => {
    const usesPublicDefault = target.key === 'primary' && target.configuredBaseUrl === undefined;
    const digestBaseUrl = target.configuredBaseUrl ?? '';
    const effectiveBaseUrl = target.configuredBaseUrl ?? OPENAI_DEFAULT_BASE_URL;
    const baseUrlMode = usesPublicDefault
      ? 'public_default'
      : configuredBaseUrlMode(effectiveBaseUrl, outboundPolicy);
    const configDigest = createRuntimeConfigDigest({
      apiKey: target.apiKey,
      baseUrl: digestBaseUrl,
      maxOutputTokens: config.maxOutputTokens,
      modelId: config.chatModel,
      protocol: config.chatProtocol,
      reasoningEffort: config.reasoningEffort ?? null,
      userAgent: config.openaiUserAgent ?? null,
    }, configKey.key);

    return {
      apiKey: target.apiKey,
      baseUrlMode,
      baseUrlPrefill: usesPublicDefault ? OPENAI_DEFAULT_BASE_URL : null,
      digestBaseUrl,
      effectiveBaseUrl,
      key: target.key,
      maxOutputTokens: config.maxOutputTokens,
      reasoningEffort: config.reasoningEffort ?? null,
      userAgent: config.openaiUserAgent ?? null,
      snapshot: {
        configDigest,
        connectionDisplayName: target.name,
        databaseModelSeriesId: null,
        databaseModelVersionId: null,
        environmentTargetKey: target.key,
        inputUsdPerMillion: config.tokenRates?.inputUsdPerMillion.toString() ?? null,
        modelDisplayName: config.chatModel,
        modelId: config.chatModel,
        outputUsdPerMillion: config.tokenRates?.outputUsdPerMillion.toString() ?? null,
        position,
        protocol: config.chatProtocol,
        sourceType: 'environment',
      },
    };
  });
}
