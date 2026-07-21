import { createHmac } from 'node:crypto';

import type { Pool } from 'pg';

import {
  AiConfigError,
  createRuntimeConfigDigest,
  loadAiConfigKey,
  type AiChatProtocol,
} from './ai-config.ts';
import { decryptAiConfigSecret } from './ai-config-crypto.ts';
import { readActiveRouteRaw } from './ai-config-store.ts';
import type { ProviderTargetSnapshot } from './ai-provider.ts';
import type { TokenRates } from './budget.ts';
import type { OpenAIReasoningEffort } from './config.ts';
import {
  createProviderFromTargets,
  type ResolvedChatTarget,
} from './provider.ts';
import {
  createProviderOutboundPolicy,
  validateProviderRuntimeBaseUrl,
  type ProviderOutboundPolicy,
} from './provider-outbound.ts';

export interface ProviderRuntimeConfig {
  chatModel: string;
  chatProtocol: AiChatProtocol;
  embeddingApiKey: string;
  embeddingBaseUrl: string | undefined;
  embeddingDimensions: number;
  embeddingModel: string;
  embeddingTimeoutMs: number;
  maxOutputTokens: number;
  openaiApiKey: string;
  openaiBaseUrl: string | undefined;
  openaiFallbacks: Array<{ apiKey: string; baseUrl: string }>;
  openaiUserAgent: string | undefined;
  providerConcurrency: number;
  providerFirstByteTimeoutMs: number;
  providerTotalTimeoutMs: number;
  reasoningEffort: OpenAIReasoningEffort | undefined;
  tokenRates: TokenRates | null;
}

interface DatabaseTargetRow {
  api_key_ciphertext: Buffer | null;
  api_key_iv: Buffer | null;
  api_key_tag: Buffer | null;
  base_url: string;
  config_digest: string;
  connection_display_name: string;
  connection_deleted_at: Date | null;
  connection_series_id: string;
  connection_version_id: string;
  deleted_at: Date | null;
  input_usd_per_million: string | null;
  key_version: number;
  max_output_tokens: number;
  model_display_name: string;
  model_id: string;
  model_version_id: string;
  output_usd_per_million: string | null;
  protocol: AiChatProtocol;
  reasoning_effort: OpenAIReasoningEffort | null;
  secret_destroyed_at: Date | null;
  user_agent: string | null;
}

export interface ProviderRuntimeSnapshot {
  provider: ReturnType<typeof createProviderFromTargets>;
  routeRevisionId: string | null;
  targets: ProviderTargetSnapshot[];
}

function unavailable(): never {
  throw new AiConfigError('AI_CONFIG_UNAVAILABLE');
}

function environmentNodes(config: ProviderRuntimeConfig) {
  return [
    {
      apiKey: config.openaiApiKey,
      baseUrl: config.openaiBaseUrl,
      key: 'primary',
      name: 'Environment primary',
    },
    ...config.openaiFallbacks.map((node, index) => ({
      ...node,
      key: `fallback-${index + 1}`,
      name: `Environment fallback ${index + 1}`,
    })),
  ];
}

function fallbackEnvironmentDigest(input: {
  apiKey: string;
  baseUrl: string | undefined;
  config: ProviderRuntimeConfig;
}): string {
  return createHmac('sha256', input.apiKey).update(JSON.stringify({
    baseUrl: input.baseUrl ?? '',
    maxOutputTokens: input.config.maxOutputTokens,
    modelId: input.config.chatModel,
    protocol: input.config.chatProtocol,
    reasoningEffort: input.config.reasoningEffort ?? null,
    userAgent: input.config.openaiUserAgent ?? null,
  }), 'utf8').digest('hex');
}

function environmentTarget(
  config: ProviderRuntimeConfig,
  node: ReturnType<typeof environmentNodes>[number],
  position: number,
  routeRevisionId: string | null,
  policy: ProviderOutboundPolicy,
  digestKey?: Buffer,
): ResolvedChatTarget {
  if (node.baseUrl) validateProviderRuntimeBaseUrl(node.baseUrl, policy);
  const digestInput = {
    apiKey: node.apiKey,
    baseUrl: node.baseUrl ?? '',
    maxOutputTokens: config.maxOutputTokens,
    modelId: config.chatModel,
    protocol: config.chatProtocol,
    reasoningEffort: config.reasoningEffort ?? null,
    userAgent: config.openaiUserAgent ?? null,
  };
  return {
    apiKey: node.apiKey,
    baseUrl: node.baseUrl,
    maxOutputTokens: config.maxOutputTokens,
    reasoningEffort: config.reasoningEffort,
    userAgent: config.openaiUserAgent ?? null,
    snapshot: {
      configDigest: digestKey
        ? createRuntimeConfigDigest(digestInput, digestKey)
        : fallbackEnvironmentDigest({ apiKey: node.apiKey, baseUrl: node.baseUrl, config }),
      connectionDisplayName: node.name,
      connectionVersionId: null,
      inputUsdPerMillion: config.tokenRates?.inputUsdPerMillion.toString() ?? null,
      modelDisplayName: config.chatModel,
      modelId: config.chatModel,
      modelVersionId: null,
      outputUsdPerMillion: config.tokenRates?.outputUsdPerMillion.toString() ?? null,
      position,
      protocol: config.chatProtocol,
      routeRevisionId,
      sourceType: 'environment',
    },
  };
}

async function databaseRows(pool: Pool, ids: string[]): Promise<Map<string, DatabaseTargetRow>> {
  if (ids.length === 0) return new Map();
  const result = await pool.query<DatabaseTargetRow>(
    `SELECT m.id::text AS model_version_id, m.model_id,
            m.display_name AS model_display_name, m.protocol, m.reasoning_effort,
            m.max_output_tokens, m.input_usd_per_million::text,
            m.output_usd_per_million::text, m.config_digest, m.deleted_at,
            c.id::text AS connection_version_id, c.series_id::text AS connection_series_id,
            c.display_name AS connection_display_name, c.base_url, c.user_agent,
            c.api_key_ciphertext, c.api_key_iv, c.api_key_tag, c.key_version,
            c.deleted_at AS connection_deleted_at, c.secret_destroyed_at
       FROM ai_model_presets m
       JOIN ai_connections c ON c.id = m.connection_version_id
      WHERE m.id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(result.rows.map((row) => [row.model_version_id, row]));
}

export async function resolveProviderRuntime(
  pool: Pool,
  config: ProviderRuntimeConfig,
  input: { env?: Record<string, string | undefined> } = {},
): Promise<ProviderRuntimeSnapshot> {
  try {
    const route = await readActiveRouteRaw(pool);
    const policy = createProviderOutboundPolicy(input.env ?? process.env);
    if (!route) {
      const targets = environmentNodes(config).map((node, position) => (
        environmentTarget(config, node, position, null, policy)
      ));
      return {
        provider: createProviderFromTargets(config, targets, { policy }),
        routeRevisionId: null,
        targets: targets.map((target) => target.snapshot),
      };
    }
    if (route.targets.some((target, index) => target.position !== index)) unavailable();
    const configKey = loadAiConfigKey(input.env ?? process.env);
    const rows = await databaseRows(
      pool,
      route.targets.flatMap((target) => target.databaseModelVersionId ?? []),
    );
    const envNodes = environmentNodes(config);
    const targets = route.targets.map((target): ResolvedChatTarget => {
      if (target.sourceType === 'environment') {
        const index = target.environmentTargetKey === 'primary'
          ? 0
          : Number(target.environmentTargetKey?.slice(-1));
        const node = envNodes[index];
        if (!node) unavailable();
        const resolved = environmentTarget(
          config,
          node,
          target.position,
          route.id,
          policy,
          configKey.key,
        );
        if (
          resolved.snapshot.configDigest !== target.configDigest
          || resolved.snapshot.connectionDisplayName !== target.connectionDisplayName
          || resolved.snapshot.modelDisplayName !== target.modelDisplayName
          || resolved.snapshot.modelId !== target.modelId
          || resolved.snapshot.protocol !== target.protocol
        ) unavailable();
        return {
          ...resolved,
          snapshot: {
            ...resolved.snapshot,
            inputUsdPerMillion: target.inputUsdPerMillion,
            outputUsdPerMillion: target.outputUsdPerMillion,
          },
        };
      }
      if (!target.databaseModelVersionId) unavailable();
      const row = rows.get(target.databaseModelVersionId);
      if (
        !row
        || row.deleted_at
        || row.connection_deleted_at
        || row.secret_destroyed_at
        || row.key_version !== configKey.keyVersion
        || row.config_digest !== target.configDigest
        || row.connection_display_name !== target.connectionDisplayName
        || row.model_display_name !== target.modelDisplayName
        || row.model_id !== target.modelId
        || row.protocol !== target.protocol
      ) unavailable();
      const apiKey = decryptAiConfigSecret({
        ciphertext: row.api_key_ciphertext,
        iv: row.api_key_iv,
        tag: row.api_key_tag,
      }, configKey.key, {
        connectionVersionId: row.connection_version_id,
        keyVersion: row.key_version,
        seriesId: row.connection_series_id,
      });
      validateProviderRuntimeBaseUrl(row.base_url, policy);
      const runtimeDigest = createRuntimeConfigDigest({
        apiKey,
        baseUrl: row.base_url,
        maxOutputTokens: row.max_output_tokens,
        modelId: row.model_id,
        protocol: row.protocol,
        reasoningEffort: row.reasoning_effort,
        userAgent: row.user_agent,
      }, configKey.key);
      if (runtimeDigest !== row.config_digest || runtimeDigest !== target.configDigest) unavailable();
      return {
        apiKey,
        baseUrl: row.base_url,
        maxOutputTokens: row.max_output_tokens,
        reasoningEffort: row.reasoning_effort ?? undefined,
        userAgent: row.user_agent,
        snapshot: {
          configDigest: row.config_digest,
          connectionDisplayName: row.connection_display_name,
          connectionVersionId: row.connection_version_id,
          inputUsdPerMillion: target.inputUsdPerMillion,
          modelDisplayName: row.model_display_name,
          modelId: row.model_id,
          modelVersionId: row.model_version_id,
          outputUsdPerMillion: target.outputUsdPerMillion,
          position: target.position,
          protocol: row.protocol,
          routeRevisionId: route.id,
          sourceType: 'database',
        },
      };
    });
    return {
      provider: createProviderFromTargets(config, targets, { policy }),
      routeRevisionId: route.id,
      targets: targets.map((target) => target.snapshot),
    };
  } catch (error) {
    if (error instanceof AiConfigError && error.code === 'AI_CONFIG_UNAVAILABLE') throw error;
    unavailable();
  }
}
