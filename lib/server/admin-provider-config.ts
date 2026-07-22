import { randomUUID } from 'node:crypto';

import OpenAI from 'openai';
import type pg from 'pg';

import {
  AiConfigError,
  createRuntimeConfigDigest,
  type AiChatProtocol,
  type AiConfigKey,
  type AiProviderTestSummary,
  type AiRouteTargetSnapshot,
} from './ai-config.ts';
import {
  createConnectionVersion,
  createConnectionWithModel,
  createModelForConnection,
  createModelVersion,
  insertAiConfigEvent,
  readActiveRouteRaw,
  resolveModelRuntime,
  resolveModelVersionRuntime,
  shredConnectionSecret,
  tombstoneModel,
  type ModelInput,
} from './ai-config-store.ts';
import type { OpenAIReasoningEffort } from './config.ts';
import { OpenAIProvider } from './openai-provider.ts';
import {
  createPinnedProviderFetch,
  createProviderOutboundPolicy,
  resolvePublicProviderAddresses,
  validateProviderBaseUrl,
  validateProviderRuntimeBaseUrl,
  type ProviderAddressResolver,
  type ProviderOutboundPolicy,
} from './provider-outbound.ts';
import type { ProviderRuntimeConfig } from './provider-runtime.ts';
import type { ParsedRouteTarget } from './provider-config-input.ts';

type Pool = pg.Pool;
type Client = pg.PoolClient;

export interface AdminProviderTransportTarget {
  apiKey: string;
  baseUrl: string;
  maxOutputTokens?: number;
  modelId?: string;
  protocol?: AiChatProtocol;
  reasoningEffort?: OpenAIReasoningEffort | null;
  userAgent: string | null;
}

export interface AdminProviderTransport {
  discover(target: AdminProviderTransportTarget, signal?: AbortSignal): Promise<string[]>;
  test(target: Required<Pick<AdminProviderTransportTarget,
    'apiKey' | 'baseUrl' | 'maxOutputTokens' | 'modelId' | 'protocol'
  >> & Pick<AdminProviderTransportTarget, 'reasoningEffort' | 'userAgent'>, signal?: AbortSignal): Promise<{
    latencyMs: number;
    usage: { inputTokens: number; outputTokens: number } | null;
  }>;
}

export interface AdminProviderServiceOptions {
  actorAdminSessionId: string;
  configKey: AiConfigKey;
  now?: () => Date;
  outboundPolicy?: ProviderOutboundPolicy;
  resolver?: ProviderAddressResolver;
  runtimeConfig: ProviderRuntimeConfig;
  transport: AdminProviderTransport;
}

interface ConnectionMutationInput {
  apiKey: string | null;
  baseUrl: string;
  name: string;
  reuseKeyAcrossOrigin: boolean;
  userAgent: string | null;
}

interface ConnectionCreationInput {
  apiKey: string;
  baseUrl: string;
  firstModel: ModelInput;
  name: string;
  userAgent: string | null;
}

const TEST_WINDOW_MS = 30 * 60_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 3;

function now(input: AdminProviderServiceOptions): Date {
  return input.now?.() ?? new Date();
}

async function transaction<T>(pool: Pool, run: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function recordDeniedEvent(
  pool: Pool,
  options: AdminProviderServiceOptions,
  eventType: string,
  resultCode: string,
): Promise<void> {
  await transaction(pool, async (client) => {
    await insertAiConfigEvent(client, {
      actorAdminSessionId: options.actorAdminSessionId,
      eventType,
      resultCode,
      status: 'denied',
    });
  });
}

async function validateOutboundBaseUrl(
  value: string,
  resolver?: ProviderAddressResolver,
  policy?: ProviderOutboundPolicy,
): Promise<string> {
  let url: URL;
  try {
    url = policy
      ? validateProviderRuntimeBaseUrl(value, policy)
      : validateProviderBaseUrl(value);
    if (url.protocol === 'https:') await resolvePublicProviderAddresses(url.hostname, resolver);
  } catch {
    throw new AiConfigError('AI_CONFIG_INVALID');
  }
  return url.toString().replace(/\/$/u, '');
}

async function connectionIdentity(pool: Pool | Client, seriesId: string): Promise<{
  baseUrl: string;
  displayName: string;
  id: string;
  secretAvailable: boolean;
  version: number;
}> {
  const result = await pool.query<{
    base_url: string;
    display_name: string;
    id: string;
    secret_available: boolean;
    version: number;
  }>(
    `SELECT id::text, display_name, base_url, version,
            api_key_ciphertext IS NOT NULL AND secret_destroyed_at IS NULL AS secret_available
       FROM ai_connections WHERE series_id = $1
      ORDER BY version DESC LIMIT 1`,
    [seriesId],
  );
  const row = result.rows[0];
  if (!row) throw new AiConfigError('AI_CONFIG_NOT_FOUND');
  return {
    baseUrl: row.base_url,
    displayName: row.display_name,
    id: row.id,
    secretAvailable: row.secret_available,
    version: row.version,
  };
}

export async function createProviderConnection(
  pool: Pool,
  input: ConnectionCreationInput,
  options: AdminProviderServiceOptions,
) {
  const baseUrl = await validateOutboundBaseUrl(input.baseUrl, options.resolver, options.outboundPolicy);
  return transaction(pool, async (client) => {
    const created = await createConnectionWithModel(client, {
      connection: {
        apiKey: input.apiKey,
        baseUrl,
        displayName: input.name,
        userAgent: input.userAgent,
      },
      model: input.firstModel,
    }, options.configKey);
    await insertAiConfigEvent(client, {
      actorAdminSessionId: options.actorAdminSessionId,
      connectionSeriesId: created.connectionSeriesId,
      connectionVersion: 1,
      eventType: 'connection_created',
      modelSeriesId: created.modelSeriesId,
      modelVersion: 1,
      resultCode: 'AI_CONFIG_CREATED',
      status: 'succeeded',
    });
    return created;
  });
}

export async function updateProviderConnection(
  pool: Pool,
  seriesId: string,
  input: ConnectionMutationInput,
  options: AdminProviderServiceOptions,
) {
  const current = await connectionIdentity(pool, seriesId);
  const baseUrl = await validateOutboundBaseUrl(input.baseUrl, options.resolver, options.outboundPolicy);
  const originChanged = new URL(current.baseUrl).origin !== new URL(baseUrl).origin;
  if (!input.apiKey && originChanged && !input.reuseKeyAcrossOrigin) {
    throw new AiConfigError('AI_CONFIG_INVALID');
  }
  return transaction(pool, async (client) => {
    const updated = await createConnectionVersion(client, {
      apiKey: input.apiKey ?? undefined,
      baseUrl,
      displayName: input.name,
      reuseExistingSecret: input.apiKey === null,
      seriesId,
      userAgent: input.userAgent,
    }, options.configKey);
    await insertAiConfigEvent(client, {
      actorAdminSessionId: options.actorAdminSessionId,
      connectionSeriesId: seriesId,
      connectionVersion: updated.connectionVersion,
      eventType: 'connection_version_created',
      resultCode: 'AI_CONFIG_UPDATED',
      status: 'succeeded',
    });
    return updated;
  });
}

async function currentModelForConnection(pool: Pool | Client, connectionSeriesId: string): Promise<string> {
  const result = await pool.query<{ series_id: string }>(
    `SELECT m.series_id::text
       FROM ai_model_presets m
       JOIN ai_connections c ON c.id = m.connection_version_id
      WHERE c.series_id = $1 AND c.deleted_at IS NULL AND c.secret_destroyed_at IS NULL
        AND m.deleted_at IS NULL
      ORDER BY c.version DESC, m.version DESC LIMIT 1`,
    [connectionSeriesId],
  );
  if (!result.rows[0]) throw new AiConfigError('AI_CONFIG_NOT_FOUND');
  return result.rows[0].series_id;
}

export async function createProviderModel(
  pool: Pool,
  connectionSeriesId: string,
  input: ModelInput,
  options: AdminProviderServiceOptions,
) {
  return transaction(pool, async (client) => {
    const created = await createModelForConnection(client, connectionSeriesId, input, options.configKey);
    await insertAiConfigEvent(client, {
      actorAdminSessionId: options.actorAdminSessionId,
      connectionSeriesId,
      connectionVersion: created.connectionVersion,
      eventType: 'model_created',
      modelSeriesId: created.modelSeriesId,
      modelVersion: 1,
      resultCode: 'AI_CONFIG_CREATED',
      status: 'succeeded',
    });
    return {
      modelSeriesId: created.modelSeriesId,
      modelVersionId: created.modelVersionId,
      modelVersion: 1,
    };
  });
}

export async function updateProviderModel(
  pool: Pool,
  modelSeriesId: string,
  input: ModelInput,
  options: AdminProviderServiceOptions,
) {
  return transaction(pool, async (client) => {
    const updated = await createModelVersion(client, { ...input, seriesId: modelSeriesId }, options.configKey);
    await insertAiConfigEvent(client, {
      actorAdminSessionId: options.actorAdminSessionId,
      eventType: 'model_version_created',
      modelSeriesId,
      modelVersion: updated.modelVersion,
      resultCode: 'AI_CONFIG_UPDATED',
      status: 'succeeded',
    });
    return updated;
  });
}

export async function getProviderCatalog(
  pool: Pool,
  input: { includeDeleted: boolean; limit: number; page: number },
) {
  const offset = (input.page - 1) * input.limit;
  const connections = await pool.query<{
    archived_at: Date | null;
    base_url: string;
    deleted_at: Date | null;
    display_name: string;
    has_api_key: boolean;
    id: string;
    series_id: string;
    user_agent: string | null;
    version: number;
  }>(
    `WITH current_connections AS (
       SELECT DISTINCT ON (series_id) id, series_id, version, display_name, base_url,
              user_agent, archived_at, deleted_at,
              api_key_ciphertext IS NOT NULL AND secret_destroyed_at IS NULL AS has_api_key
         FROM ai_connections
        ORDER BY series_id, version DESC
     )
     SELECT *, count(*) OVER()::integer AS total
       FROM current_connections
      WHERE ($1::boolean OR deleted_at IS NULL)
      ORDER BY display_name, series_id LIMIT $2 OFFSET $3`,
    [input.includeDeleted, input.limit, offset],
  );
  const ids = connections.rows.map((row) => row.id);
  const models = ids.length === 0 ? { rows: [] as Array<{
    archived_at: Date | null; config_digest: string; connection_version_id: string;
    deleted_at: Date | null; display_name: string; id: string;
    input_usd_per_million: string | null; max_output_tokens: number; model_id: string;
    output_usd_per_million: string | null; protocol: AiChatProtocol;
    reasoning_effort: string | null; series_id: string; version: number;
  }> } : await pool.query(
    `SELECT DISTINCT ON (series_id) id::text, series_id::text, version,
            connection_version_id::text, display_name, model_id, protocol, reasoning_effort,
            max_output_tokens, input_usd_per_million::text, output_usd_per_million::text,
            config_digest, archived_at, deleted_at
       FROM ai_model_presets
      WHERE connection_version_id = ANY($1::uuid[])
        AND ($2::boolean OR deleted_at IS NULL)
      ORDER BY series_id, version DESC`,
    [ids, input.includeDeleted],
  );
  return {
    items: connections.rows.map((connection) => ({
      archivedAt: connection.archived_at?.toISOString() ?? null,
      baseUrl: connection.base_url,
      deletedAt: connection.deleted_at?.toISOString() ?? null,
      displayName: connection.display_name,
      hasApiKey: connection.has_api_key,
      id: connection.id,
      models: models.rows.filter((model) => model.connection_version_id === connection.id).map((model) => ({
        archivedAt: model.archived_at?.toISOString() ?? null,
        configDigest: model.config_digest,
        deletedAt: model.deleted_at?.toISOString() ?? null,
        displayName: model.display_name,
        id: model.id,
        inputUsdPerMillion: model.input_usd_per_million,
        maxOutputTokens: model.max_output_tokens,
        modelId: model.model_id,
        outputUsdPerMillion: model.output_usd_per_million,
        protocol: model.protocol,
        reasoningEffort: model.reasoning_effort,
        seriesId: model.series_id,
        version: model.version,
      })),
      seriesId: connection.series_id,
      userAgent: connection.user_agent,
      version: connection.version,
    })),
    limit: input.limit,
    page: input.page,
    total: Number((connections.rows[0] as { total?: number } | undefined)?.total ?? 0),
  };
}

function environmentTargets(options: AdminProviderServiceOptions): Array<{
  apiKey: string;
  baseUrl: string;
  key: 'primary' | 'fallback-1' | 'fallback-2';
  snapshot: AiRouteTargetSnapshot;
  userAgent: string | null;
}> {
  const config = options.runtimeConfig;
  const nodes = [
    { apiKey: config.openaiApiKey, baseUrl: config.openaiBaseUrl ?? '', key: 'primary' as const, name: 'Environment primary' },
    ...config.openaiFallbacks.slice(0, 2).map((target, index) => ({
      ...target,
      key: `fallback-${index + 1}` as 'fallback-1' | 'fallback-2',
      name: `Environment fallback ${index + 1}`,
    })),
  ];
  return nodes.map((target, position) => {
    const digest = createRuntimeConfigDigest({
      apiKey: target.apiKey,
      baseUrl: target.baseUrl,
      maxOutputTokens: config.maxOutputTokens,
      modelId: config.chatModel,
      protocol: config.chatProtocol,
      reasoningEffort: config.reasoningEffort ?? null,
      userAgent: config.openaiUserAgent ?? null,
    }, options.configKey.key);
    return {
      apiKey: target.apiKey,
      baseUrl: target.baseUrl,
      key: target.key,
      userAgent: config.openaiUserAgent ?? null,
      snapshot: {
        configDigest: digest,
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

async function withOperationGate<T>(
  pool: Pool,
  options: AdminProviderServiceOptions,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  try {
    return await transaction(pool, async (client) => {
      const lock = await client.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS acquired`,
        ['revolution:admin-provider-operation'],
      );
      if (lock.rows[0]?.acquired !== true) throw new AiConfigError('AI_CONFIG_RATE_LIMITED');
      const operationNow = now(options);
      const recent = await client.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM ai_config_events
          WHERE event_type IN ('provider_discover', 'provider_test', 'environment_test')
            AND created_at >= $1::timestamptz - interval '60 seconds'`,
        [operationNow],
      );
      if (recent.rows[0].count >= RATE_LIMIT) throw new AiConfigError('AI_CONFIG_RATE_LIMITED');
      return run(client);
    });
  } catch (error) {
    if (error instanceof AiConfigError && error.code === 'AI_CONFIG_RATE_LIMITED') {
      await recordDeniedEvent(
        pool,
        options,
        'provider_operation_denied',
        error.code,
      ).catch(() => undefined);
    }
    throw error;
  }
}

export async function discoverProviderModels(
  pool: Pool,
  connectionSeriesId: string,
  options: AdminProviderServiceOptions,
): Promise<{ items: string[] }> {
  const modelSeriesId = await currentModelForConnection(pool, connectionSeriesId);
  const runtime = await resolveModelRuntime(pool, modelSeriesId, options.configKey);
  const outcome = await withOperationGate(pool, options, async (client) => {
    const started = Date.now();
    try {
      const items = [...new Set(await options.transport.discover({
        apiKey: runtime.apiKey,
        baseUrl: runtime.connection.baseUrl,
        userAgent: runtime.connection.userAgent,
      }))].filter((item) => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim()).sort().slice(0, 200);
      await insertAiConfigEvent(client, {
        actorAdminSessionId: options.actorAdminSessionId,
        connectionSeriesId,
        connectionVersion: runtime.connection.version,
        eventType: 'provider_discover',
        itemCount: items.length,
        latencyMs: Math.max(0, Date.now() - started),
        resultCode: 'AI_CONFIG_DISCOVERED',
        status: 'succeeded',
      });
      return { ok: true as const, items };
    } catch (error) {
      if (error instanceof AiConfigError) throw error;
      await insertAiConfigEvent(client, {
        actorAdminSessionId: options.actorAdminSessionId,
        connectionSeriesId,
        connectionVersion: runtime.connection.version,
        eventType: 'provider_discover',
        resultCode: 'AI_CONFIG_TEST_FAILED',
        status: 'failed',
      });
      return { ok: false as const };
    }
  });
  if (!outcome.ok) throw new AiConfigError('AI_CONFIG_TEST_FAILED');
  return { items: outcome.items };
}

async function recordTest(
  pool: Pool,
  target: AdminProviderTransportTarget & Required<Pick<AdminProviderTransportTarget,
    'maxOutputTokens' | 'modelId' | 'protocol'
  >>,
  event: {
    configDigest: string;
    connectionSeriesId?: string;
    connectionVersion?: number;
    environmentTargetKey?: 'primary' | 'fallback-1' | 'fallback-2';
    modelSeriesId?: string;
    modelVersion?: number;
  },
  options: AdminProviderServiceOptions,
): Promise<AiProviderTestSummary> {
  const outcome = await withOperationGate(pool, options, async (client) => {
    const testedAt = now(options);
    try {
      const result = await options.transport.test(target);
      await insertAiConfigEvent(client, {
        actorAdminSessionId: options.actorAdminSessionId,
        ...event,
        eventType: event.environmentTargetKey ? 'environment_test' : 'provider_test',
        inputTokens: result.usage?.inputTokens ?? null,
        latencyMs: result.latencyMs,
        outputTokens: result.usage?.outputTokens ?? null,
        resultCode: 'AI_CONFIG_TEST_SUCCEEDED',
        status: 'succeeded',
      });
      return { ok: true as const, summary: {
        configDigest: event.configDigest,
        itemCount: null,
        latencyMs: result.latencyMs,
        resultCode: 'AI_CONFIG_TEST_SUCCEEDED',
        status: 'succeeded' as const,
        testedAt,
      } };
    } catch (error) {
      if (error instanceof AiConfigError) throw error;
      await insertAiConfigEvent(client, {
        actorAdminSessionId: options.actorAdminSessionId,
        ...event,
        eventType: event.environmentTargetKey ? 'environment_test' : 'provider_test',
        resultCode: 'AI_CONFIG_TEST_FAILED',
        status: 'failed',
      });
      return { ok: false as const };
    }
  });
  if (!outcome.ok) throw new AiConfigError('AI_CONFIG_TEST_FAILED');
  return outcome.summary;
}

export async function testProviderModel(
  pool: Pool,
  modelSeriesId: string,
  options: AdminProviderServiceOptions,
): Promise<AiProviderTestSummary> {
  const runtime = await resolveModelRuntime(pool, modelSeriesId, options.configKey);
  return recordTest(pool, {
    apiKey: runtime.apiKey,
    baseUrl: runtime.connection.baseUrl,
    maxOutputTokens: Math.min(runtime.model.maxOutputTokens, 16),
    modelId: runtime.model.modelId,
    protocol: runtime.model.protocol,
    reasoningEffort: runtime.model.reasoningEffort as OpenAIReasoningEffort | null,
    userAgent: runtime.connection.userAgent,
  }, {
    configDigest: runtime.model.configDigest,
    modelSeriesId,
    modelVersion: runtime.model.version,
  }, options);
}

export async function testEnvironmentProviderTarget(
  pool: Pool,
  targetKey: 'primary' | 'fallback-1' | 'fallback-2',
  options: AdminProviderServiceOptions,
): Promise<AiProviderTestSummary> {
  const target = environmentTargets(options).find((item) => item.key === targetKey);
  if (!target) throw new AiConfigError('AI_CONFIG_INVALID');
  return recordTest(pool, {
    apiKey: target.apiKey,
    baseUrl: target.baseUrl,
    maxOutputTokens: Math.min(options.runtimeConfig.maxOutputTokens, 16),
    modelId: options.runtimeConfig.chatModel,
    protocol: options.runtimeConfig.chatProtocol,
    reasoningEffort: options.runtimeConfig.reasoningEffort ?? null,
    userAgent: target.userAgent,
  }, {
    configDigest: target.snapshot.configDigest,
    environmentTargetKey: target.key,
  }, options);
}

async function testedRecently(
  client: Client,
  digest: string,
  activationNow: Date,
  rollbackRevisionId: string | null,
  rollbackDepartureRevisionId: string | null,
): Promise<boolean> {
  const result = await client.query<{ valid: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM ai_config_events
        WHERE config_digest = $1 AND status = 'succeeded'
          AND event_type IN ('provider_test', 'environment_test')
          AND created_at >= $2::timestamptz - interval '30 minutes'
       UNION ALL
       SELECT 1 FROM ai_route_targets target
       JOIN ai_route_revisions departure ON departure.id = $4::uuid
        WHERE target.config_digest = $1 AND target.route_revision_id = $3::uuid
          AND departure.activated_at >= $2::timestamptz - interval '30 minutes'
       ) AS valid`,
    [digest, activationNow, rollbackRevisionId, rollbackDepartureRevisionId],
  );
  return result.rows[0]?.valid === true;
}

async function databaseRouteTarget(
  client: Client,
  modelSeriesId: string,
  configKey: AiConfigKey,
  modelVersionId?: string,
): Promise<AiRouteTargetSnapshot> {
  const result = await client.query<{
    config_digest: string;
    connection_display_name: string;
    connection_deleted_at: Date | null;
    database_model_version_id: string;
    deleted_at: Date | null;
    input_usd_per_million: string | null;
    model_display_name: string;
    model_id: string;
    output_usd_per_million: string | null;
    protocol: AiChatProtocol;
    secret_destroyed_at: Date | null;
  }>(
    `SELECT m.id::text AS database_model_version_id, m.display_name AS model_display_name,
            m.model_id, m.protocol, m.config_digest, m.input_usd_per_million::text,
            m.output_usd_per_million::text, m.deleted_at,
            c.display_name AS connection_display_name, c.deleted_at AS connection_deleted_at,
            c.secret_destroyed_at
       FROM ai_model_presets m JOIN ai_connections c ON c.id = m.connection_version_id
      WHERE m.series_id = $1 AND ($2::uuid IS NULL OR m.id = $2::uuid)
      ORDER BY m.version DESC LIMIT 1 FOR UPDATE`,
    [modelSeriesId, modelVersionId ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new AiConfigError('AI_CONFIG_NOT_FOUND');
  if (row.deleted_at || row.connection_deleted_at || row.secret_destroyed_at) {
    throw new AiConfigError('AI_CONFIG_TARGET_DELETED');
  }
  const runtime = await resolveModelVersionRuntime(client, row.database_model_version_id, configKey);
  if (runtime.model.configDigest !== row.config_digest) {
    throw new AiConfigError('AI_CONFIG_SECRET_UNAVAILABLE');
  }
  return {
    configDigest: row.config_digest,
    connectionDisplayName: row.connection_display_name,
    databaseModelSeriesId: modelSeriesId,
    databaseModelVersionId: row.database_model_version_id,
    environmentTargetKey: null,
    inputUsdPerMillion: row.input_usd_per_million,
    modelDisplayName: row.model_display_name,
    modelId: row.model_id,
    outputUsdPerMillion: row.output_usd_per_million,
    position: 0,
    protocol: row.protocol,
    sourceType: 'database',
  };
}

export async function activateProviderRoute(
  pool: Pool,
  input: { expectedActiveRevision: number; rollbackToPrevious?: true; targets: ParsedRouteTarget[] },
  options: AdminProviderServiceOptions,
) {
  try {
    return await transaction(pool, async (client) => {
    const state = await client.query<{
      active_route_revision_id: string | null;
      previous_active_revision_id: string | null;
      revision_number: string | null;
    }>(
      `SELECT state.active_route_revision_id::text,
              revision.revision_number::text,
              revision.previous_active_revision_id::text
         FROM ai_runtime_state state
         LEFT JOIN ai_route_revisions revision ON revision.id = state.active_route_revision_id
        WHERE state.id = true FOR UPDATE OF state`,
    );
    const activeId = state.rows[0]?.active_route_revision_id ?? null;
    const previousActiveId = state.rows[0]?.previous_active_revision_id ?? null;
    const activeRevision = Number(state.rows[0]?.revision_number ?? 0);
    if (activeRevision !== input.expectedActiveRevision) throw new AiConfigError('AI_CONFIG_CONFLICT');
    const currentTargets = activeId
      ? await client.query<{ config_digest: string; position: number }>(
          `SELECT config_digest, position FROM ai_route_targets
            WHERE route_revision_id = $1 ORDER BY position`,
          [activeId],
        )
      : { rows: [] };
    const currentDigests = new Set(currentTargets.rows.map((target) => target.config_digest));
    const environment = new Map(environmentTargets(options).map((target) => [target.key, target]));
    const previousTargets = previousActiveId
      ? await client.query<{
          config_digest: string;
          connection_deleted_at: Date | null;
          connection_display_name: string;
          database_model_version_id: string | null;
          environment_target_key: 'primary' | 'fallback-1' | 'fallback-2' | null;
          input_usd_per_million: string | null;
          model_deleted_at: Date | null;
          model_display_name: string;
          model_id: string;
          model_series_id: string | null;
          output_usd_per_million: string | null;
          position: number;
          protocol: AiChatProtocol;
          secret_destroyed_at: Date | null;
          source_type: 'database' | 'environment';
        }>(
          `SELECT target.position, target.source_type, target.database_model_version_id::text,
                  target.environment_target_key, target.connection_display_name,
                  target.model_display_name, target.model_id, target.protocol,
                  target.config_digest, target.input_usd_per_million::text,
                  target.output_usd_per_million::text, model.series_id::text AS model_series_id,
                  model.deleted_at AS model_deleted_at,
                  connection.deleted_at AS connection_deleted_at, connection.secret_destroyed_at
             FROM ai_route_targets target
             LEFT JOIN ai_model_presets model ON model.id = target.database_model_version_id
             LEFT JOIN ai_connections connection ON connection.id = model.connection_version_id
            WHERE target.route_revision_id = $1 ORDER BY target.position`,
          [previousActiveId],
        )
      : { rows: [] };
    const previousRouteMatches = previousTargets.rows.length === input.targets.length
      && previousTargets.rows.every((previous, index) => {
        const requested = input.targets[index];
        if (previous.source_type !== requested.source) return false;
        if (requested.source === 'environment') {
          return previous.environment_target_key === requested.environmentTargetKey;
        }
        return previous.model_series_id === requested.modelId
          && (!requested.modelVersionId
            || previous.database_model_version_id === requested.modelVersionId);
      })
      && previousTargets.rows.some(
        (target, index) => target.config_digest !== currentTargets.rows[index]?.config_digest,
      );
    const previousRouteDiffers = previousTargets.rows.some(
      (target, index) => target.config_digest !== currentTargets.rows[index]?.config_digest,
    );
    if (input.rollbackToPrevious && (input.targets.length > 0
      || previousTargets.rows.length === 0 || !previousRouteDiffers)) {
      throw new AiConfigError('AI_CONFIG_INVALID');
    }
    const rollbackRequested = input.rollbackToPrevious === true || previousRouteMatches;
    const rollbackSnapshots = rollbackRequested
      ? previousTargets.rows.map((target): AiRouteTargetSnapshot => {
          if (target.source_type === 'database') {
            if (!target.database_model_version_id || !target.model_series_id
              || target.model_deleted_at || target.connection_deleted_at || target.secret_destroyed_at) {
              throw new AiConfigError('AI_CONFIG_TARGET_DELETED');
            }
          } else {
            const currentEnvironment = target.environment_target_key
              ? environment.get(target.environment_target_key)
              : null;
            if (!currentEnvironment || currentEnvironment.snapshot.configDigest !== target.config_digest) {
              throw new AiConfigError('AI_CONFIG_TEST_REQUIRED');
            }
          }
          return {
            configDigest: target.config_digest,
            connectionDisplayName: target.connection_display_name,
            databaseModelSeriesId: target.model_series_id,
            databaseModelVersionId: target.database_model_version_id,
            environmentTargetKey: target.environment_target_key,
            inputUsdPerMillion: target.input_usd_per_million,
            modelDisplayName: target.model_display_name,
            modelId: target.model_id,
            outputUsdPerMillion: target.output_usd_per_million,
            position: target.position,
            protocol: target.protocol,
            sourceType: target.source_type,
          };
        })
      : null;
    const activationTargets = rollbackSnapshots
      ? previousTargets.rows.map((target): ParsedRouteTarget => target.source_type === 'database'
        ? {
            source: 'database',
            modelId: target.model_series_id!,
            modelVersionId: target.database_model_version_id!,
          }
        : {
            source: 'environment',
            environmentTargetKey: target.environment_target_key!,
          })
      : input.targets;
    const snapshots: AiRouteTargetSnapshot[] = [];
    for (const [position, target] of activationTargets.entries()) {
      const snapshot = rollbackSnapshots?.[position] ?? (target.source === 'database'
        ? await databaseRouteTarget(client, target.modelId, options.configKey, target.modelVersionId)
        : environment.get(target.environmentTargetKey)?.snapshot);
      if (!snapshot) throw new AiConfigError('AI_CONFIG_INVALID');
      const positioned = { ...snapshot, position };
      if (rollbackSnapshots && positioned.sourceType === 'database') {
        if (!positioned.databaseModelVersionId) throw new AiConfigError('AI_CONFIG_INVALID');
        const runtime = await resolveModelVersionRuntime(
          client,
          positioned.databaseModelVersionId,
          options.configKey,
        );
        if (runtime.model.configDigest !== positioned.configDigest) {
          throw new AiConfigError('AI_CONFIG_SECRET_UNAVAILABLE');
        }
      }
      if (!currentDigests.has(positioned.configDigest)
        && !(activeId === null && positioned.sourceType === 'environment')
        && !await testedRecently(
          client,
          positioned.configDigest,
          now(options),
          rollbackRequested ? previousActiveId : null,
          rollbackRequested ? activeId : null,
        )) {
        throw new AiConfigError('AI_CONFIG_TEST_REQUIRED');
      }
      snapshots.push(positioned);
    }
    if (new Set(snapshots.map((target) => target.configDigest)).size !== snapshots.length) {
      throw new AiConfigError('AI_CONFIG_INVALID');
    }
    const revision = await client.query<{ next_revision: string }>(
      `SELECT (COALESCE(max(revision_number), 0) + 1)::text AS next_revision
         FROM ai_route_revisions`,
    );
    const revisionNumber = Number(revision.rows[0].next_revision);
    const routeRevisionId = randomUUID();
    const activationNow = now(options);
    await client.query(
      `INSERT INTO ai_route_revisions
        (id, revision_number, previous_active_revision_id, activation_kind,
         activated_at, actor_admin_session_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [routeRevisionId, revisionNumber, activeId,
        rollbackRequested ? 'rollback' : activeId ? 'activate' : 'bootstrap', activationNow,
        options.actorAdminSessionId],
    );
    for (const target of snapshots) {
      await client.query(
        `INSERT INTO ai_route_targets
          (route_revision_id, position, source_type, database_model_version_id,
           environment_target_key, connection_display_name, model_display_name,
           model_id, protocol, config_digest, input_usd_per_million, output_usd_per_million)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          routeRevisionId, target.position, target.sourceType, target.databaseModelVersionId,
          target.environmentTargetKey, target.connectionDisplayName, target.modelDisplayName,
          target.modelId, target.protocol, target.configDigest, target.inputUsdPerMillion,
          target.outputUsdPerMillion,
        ],
      );
    }
    await client.query(
      `UPDATE ai_runtime_state SET active_route_revision_id = $1,
              lock_version = lock_version + 1, updated_at = $2 WHERE id = true`,
      [routeRevisionId, activationNow],
    );
    await insertAiConfigEvent(client, {
      actorAdminSessionId: options.actorAdminSessionId,
      eventType: rollbackRequested ? 'route_rolled_back' : 'route_activated',
      itemCount: snapshots.length,
      resultCode: 'AI_CONFIG_ACTIVATED',
      routeRevisionId,
      status: 'succeeded',
    });
      return { activeRevision: revisionNumber, routeRevisionId, targets: snapshots };
    });
  } catch (error) {
    if (error instanceof AiConfigError) {
      await recordDeniedEvent(
        pool,
        options,
        'route_activation_denied',
        error.code,
      ).catch(() => undefined);
    }
    throw error;
  }
}

async function activeSeries(
  client: Client,
  input: { connectionSeriesId?: string; modelSeriesId?: string },
): Promise<boolean> {
  const result = await client.query<{ active: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM ai_runtime_state state
       JOIN ai_route_targets target ON target.route_revision_id = state.active_route_revision_id
       LEFT JOIN ai_model_presets model ON model.id = target.database_model_version_id
       LEFT JOIN ai_connections connection ON connection.id = model.connection_version_id
       WHERE state.id = true
         AND ($1::uuid IS NULL OR model.series_id = $1)
         AND ($2::uuid IS NULL OR connection.series_id = $2)
     ) AS active`,
    [input.modelSeriesId ?? null, input.connectionSeriesId ?? null],
  );
  return result.rows[0]?.active === true;
}

async function modelHistory(client: Client, modelSeriesId: string): Promise<boolean> {
  const result = await client.query<{ historical: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM ai_route_targets target
       JOIN ai_model_presets model ON model.id = target.database_model_version_id
       WHERE model.series_id = $1
       UNION ALL
       SELECT 1 FROM interaction_provider_attempts attempt
       JOIN ai_model_presets model ON model.id = attempt.model_version_id
       WHERE model.series_id = $1
     ) AS historical`,
    [modelSeriesId],
  );
  return result.rows[0]?.historical === true;
}

export async function deleteProviderModel(
  pool: Pool,
  modelSeriesId: string,
  confirmationName: string,
  options: AdminProviderServiceOptions,
): Promise<{ disposition: 'deleted' | 'history_retained' }> {
  return transaction(pool, async (client) => {
    const identity = await client.query<{ display_name: string }>(
      `SELECT display_name FROM ai_model_presets WHERE series_id = $1
        ORDER BY version DESC LIMIT 1 FOR UPDATE`,
      [modelSeriesId],
    );
    if (!identity.rows[0]) throw new AiConfigError('AI_CONFIG_NOT_FOUND');
    if (identity.rows[0].display_name !== confirmationName) throw new AiConfigError('AI_CONFIG_INVALID');
    if (await activeSeries(client, { modelSeriesId })) throw new AiConfigError('AI_CONFIG_IN_USE');
    const historical = await modelHistory(client, modelSeriesId);
    if (historical) await tombstoneModel(client, modelSeriesId, now(options));
    else await client.query('DELETE FROM ai_model_presets WHERE series_id = $1', [modelSeriesId]);
    await insertAiConfigEvent(client, {
      actorAdminSessionId: options.actorAdminSessionId,
      eventType: historical ? 'model_history_retained' : 'model_deleted',
      modelSeriesId,
      resultCode: historical ? 'AI_CONFIG_HISTORY_RETAINED' : 'AI_CONFIG_DELETED',
      status: 'succeeded',
    });
    return { disposition: historical ? 'history_retained' : 'deleted' };
  });
}

async function connectionHistory(client: Client, connectionSeriesId: string): Promise<boolean> {
  const result = await client.query<{ historical: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM ai_route_targets target
       JOIN ai_model_presets model ON model.id = target.database_model_version_id
       JOIN ai_connections connection ON connection.id = model.connection_version_id
       WHERE connection.series_id = $1
       UNION ALL
       SELECT 1 FROM interaction_provider_attempts attempt
       JOIN ai_connections connection ON connection.id = attempt.connection_version_id
       WHERE connection.series_id = $1
     ) AS historical`,
    [connectionSeriesId],
  );
  return result.rows[0]?.historical === true;
}

export async function deleteProviderConnection(
  pool: Pool,
  connectionSeriesId: string,
  confirmationName: string,
  options: AdminProviderServiceOptions,
): Promise<{ disposition: 'deleted' | 'history_retained' }> {
  return transaction(pool, async (client) => {
    const identity = await connectionIdentity(client, connectionSeriesId);
    if (identity.displayName !== confirmationName) throw new AiConfigError('AI_CONFIG_INVALID');
    if (await activeSeries(client, { connectionSeriesId })) throw new AiConfigError('AI_CONFIG_IN_USE');
    const historical = await connectionHistory(client, connectionSeriesId);
    if (!historical) {
      await client.query(
        `DELETE FROM ai_model_presets WHERE connection_version_id IN
          (SELECT id FROM ai_connections WHERE series_id = $1)`,
        [connectionSeriesId],
      );
      await client.query('DELETE FROM ai_connections WHERE series_id = $1', [connectionSeriesId]);
    } else {
      const deletionTime = now(options);
      await shredConnectionSecret(client, connectionSeriesId, deletionTime);
      await client.query(
        `UPDATE ai_connections SET archived_at = COALESCE(archived_at, $2),
                deleted_at = COALESCE(deleted_at, $2) WHERE series_id = $1`,
        [connectionSeriesId, deletionTime],
      );
      await client.query(
        `UPDATE ai_model_presets SET archived_at = COALESCE(archived_at, $2),
                deleted_at = COALESCE(deleted_at, $2)
          WHERE connection_version_id IN
            (SELECT id FROM ai_connections WHERE series_id = $1)`,
        [connectionSeriesId, deletionTime],
      );
    }
    await insertAiConfigEvent(client, {
      actorAdminSessionId: options.actorAdminSessionId,
      connectionSeriesId,
      eventType: historical ? 'connection_secret_destroyed' : 'connection_deleted',
      resultCode: historical ? 'AI_CONFIG_HISTORY_RETAINED' : 'AI_CONFIG_DELETED',
      status: 'succeeded',
    });
    return { disposition: historical ? 'history_retained' : 'deleted' };
  });
}

export async function getProviderRuntimeSummary(
  pool: Pool,
  options: AdminProviderServiceOptions,
) {
  const route = await readActiveRouteRaw(pool);
  const canRollback = route ? (await pool.query<{ can_rollback: boolean }>(
    `SELECT previous_active_revision_id IS NOT NULL AS can_rollback
       FROM ai_route_revisions WHERE id = $1`,
    [route.id],
  )).rows[0]?.can_rollback === true : false;
  return {
    activeRevision: route?.revisionNumber ?? 0,
    canRollback,
    routeRevisionId: route?.id ?? null,
    targets: route?.targets ?? [],
    environmentTargets: environmentTargets(options).map((target) => ({
      configDigest: target.snapshot.configDigest,
      connectionDisplayName: target.snapshot.connectionDisplayName,
      environmentTargetKey: target.key,
      modelId: target.snapshot.modelId,
      protocol: target.snapshot.protocol,
    })),
  };
}

export async function listProviderEvents(
  pool: Pool,
  input: { limit: number; page: number },
) {
  const offset = (input.page - 1) * input.limit;
  const result = await pool.query<{
    config_digest: string | null; created_at: Date; event_type: string; id: string;
    item_count: number | null; latency_ms: number | null; result_code: string; status: string;
  }>(
    `SELECT id::text, event_type, config_digest, result_code, status, latency_ms,
            item_count, created_at, count(*) OVER()::integer AS total
       FROM ai_config_events ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
    [input.limit, offset],
  );
  return {
    items: result.rows.map((row) => ({
      configDigest: row.config_digest,
      createdAt: row.created_at.toISOString(),
      eventType: row.event_type,
      id: row.id,
      itemCount: row.item_count,
      latencyMs: row.latency_ms,
      resultCode: row.result_code,
      status: row.status,
    })),
    limit: input.limit,
    page: input.page,
    total: Number((result.rows[0] as { total?: number } | undefined)?.total ?? 0),
  };
}

export function createAdminProviderTransport(
  runtimeConfig: ProviderRuntimeConfig,
  input: { policy?: ProviderOutboundPolicy } = {},
): AdminProviderTransport {
  const policy = input.policy ?? createProviderOutboundPolicy();
  const providerFetch = createPinnedProviderFetch({ policy });
  return {
    async discover(target, signal) {
      const client = new OpenAI({
        apiKey: target.apiKey,
        baseURL: target.baseUrl,
        defaultHeaders: target.userAgent ? { 'User-Agent': target.userAgent } : undefined,
        fetch: providerFetch,
        maxRetries: 0,
        timeout: runtimeConfig.providerTotalTimeoutMs,
      });
      const page = await client.models.list({ signal });
      return page.data.map((item) => item.id);
    },
    async test(target, signal) {
      const client = new OpenAI({
        apiKey: target.apiKey,
        baseURL: target.baseUrl,
        defaultHeaders: target.userAgent ? { 'User-Agent': target.userAgent } : undefined,
        fetch: providerFetch,
        maxRetries: 0,
      });
      const provider = new OpenAIProvider(
        client as never,
        { embeddings: { async create() { return { data: [] }; } } },
        {
          chatModel: target.modelId,
          embeddingDimensions: runtimeConfig.embeddingDimensions,
          embeddingModel: runtimeConfig.embeddingModel,
          embeddingTimeoutMs: runtimeConfig.embeddingTimeoutMs,
          firstByteTimeoutMs: runtimeConfig.providerFirstByteTimeoutMs,
          maxOutputTokens: target.maxOutputTokens,
          protocol: target.protocol,
          providerConcurrency: runtimeConfig.providerConcurrency,
          reasoningEffort: target.reasoningEffort ?? undefined,
          totalTimeoutMs: runtimeConfig.providerTotalTimeoutMs,
        },
      );
      const started = Date.now();
      let text = '';
      let usage: { inputTokens: number; outputTokens: number } | null = null;
      for await (const event of provider.streamAnswer({
        instructions: 'Return exactly OK.',
        messages: [{ role: 'user', content: 'OK' }],
      }, signal)) {
        if (event.type === 'delta') text += event.text;
        if (event.type === 'done') usage = event.usage;
      }
      if (!text.trim()) throw new Error('AI_CONFIG_TEST_FAILED');
      return { latencyMs: Math.max(0, Date.now() - started), usage };
    },
  };
}
