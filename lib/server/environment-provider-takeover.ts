import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import {
  AiConfigError,
  type AiConfigKey,
} from './ai-config.ts';
import {
  createConnectionWithModel,
  insertAiConfigEvent,
} from './ai-config-store.ts';
import type { AdminProviderServiceOptions } from './admin-provider-config.ts';
import {
  listAdminEnvironmentTargets,
  type AdminEnvironmentProviderTarget,
  type EnvironmentTargetKey,
} from './environment-provider-target.ts';
import {
  createProviderOutboundPolicy,
  resolvePublicProviderAddresses,
  validateProviderBaseUrl,
  validateProviderRuntimeBaseUrl,
  type ProviderAddressResolver,
  type ProviderOutboundPolicy,
} from './provider-outbound.ts';
import type { ProviderRuntimeConfig } from './provider-runtime.ts';
import type { ParsedEnvironmentTakeoverInput } from './provider-config-input.ts';

type Pool = pg.Pool;
type Client = pg.PoolClient;
type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

interface TakeoverRow {
  connection_series_id: string;
  connection_version: number;
  environment_target_key: EnvironmentTargetKey;
  model_series_id: string;
  model_version: number;
  takeover_id: string;
}

export interface EnvironmentTakeoverResult {
  connectionSeriesId: string;
  connectionVersion: 1;
  modelSeriesId: string;
  modelVersion: 1;
  takeoverId: string;
}

export interface ActiveEnvironmentTakeover {
  connectionSeriesId: string;
  environmentTargetKey: EnvironmentTargetKey;
  modelSeriesId: string;
  sourceConfigDigest: string;
  takeoverId: string;
}

export async function readActiveEnvironmentTakeovers(
  queryable: Queryable,
): Promise<Map<EnvironmentTargetKey, ActiveEnvironmentTakeover>> {
  const result = await queryable.query<{
    connection_series_id: string;
    environment_target_key: EnvironmentTargetKey;
    model_series_id: string;
    source_config_digest: string;
    takeover_id: string;
  }>(
    `SELECT takeover.id::text AS takeover_id,
            takeover.environment_target_key,
            takeover.source_config_digest,
            connection.series_id::text AS connection_series_id,
            model.series_id::text AS model_series_id
       FROM ai_environment_takeovers takeover
       JOIN ai_connections connection
         ON connection.id = takeover.initial_connection_version_id
       JOIN ai_model_presets model
         ON model.id = takeover.initial_model_version_id
      WHERE takeover.released_at IS NULL`,
  );
  return new Map(result.rows.map((row) => [row.environment_target_key, {
    connectionSeriesId: row.connection_series_id,
    environmentTargetKey: row.environment_target_key,
    modelSeriesId: row.model_series_id,
    sourceConfigDigest: row.source_config_digest,
    takeoverId: row.takeover_id,
  }]));
}

export async function releaseEnvironmentTakeover(
  client: Client,
  connectionSeriesId: string,
  releasedAt: Date,
): Promise<EnvironmentTargetKey | null> {
  const result = await client.query<{ environment_target_key: EnvironmentTargetKey }>(
    `UPDATE ai_environment_takeovers takeover
        SET released_at = $2
      WHERE takeover.released_at IS NULL
        AND takeover.initial_connection_version_id IN (
          SELECT id FROM ai_connections WHERE series_id = $1
        )
      RETURNING takeover.environment_target_key`,
    [connectionSeriesId, releasedAt],
  );
  if ((result.rowCount ?? 0) > 1) throw new AiConfigError('AI_CONFIG_CONFLICT');
  return result.rows[0]?.environment_target_key ?? null;
}

function toResult(row: TakeoverRow, targetKey: EnvironmentTargetKey): EnvironmentTakeoverResult {
  if (
    row.environment_target_key !== targetKey
    || row.connection_version !== 1
    || row.model_version !== 1
  ) {
    throw new AiConfigError('AI_CONFIG_CONFLICT');
  }
  return {
    connectionSeriesId: row.connection_series_id,
    connectionVersion: 1,
    modelSeriesId: row.model_series_id,
    modelVersion: 1,
    takeoverId: row.takeover_id,
  };
}

async function readTakeoverByRequestId(
  client: Client,
  requestId: string,
): Promise<TakeoverRow | null> {
  const result = await client.query<TakeoverRow>(
    `SELECT takeover.id::text AS takeover_id,
            takeover.environment_target_key,
            connection.series_id::text AS connection_series_id,
            connection.version AS connection_version,
            model.series_id::text AS model_series_id,
            model.version AS model_version
       FROM ai_environment_takeovers takeover
       JOIN ai_connections connection
         ON connection.id = takeover.initial_connection_version_id
       JOIN ai_model_presets model
         ON model.id = takeover.initial_model_version_id
      WHERE takeover.request_id = $1`,
    [requestId],
  );
  return result.rows[0] ?? null;
}

function requireEnvironmentTarget(
  runtimeConfig: ProviderRuntimeConfig,
  configKey: AiConfigKey,
  targetKey: EnvironmentTargetKey,
  outboundPolicy: ProviderOutboundPolicy,
): AdminEnvironmentProviderTarget {
  const target = listAdminEnvironmentTargets(runtimeConfig, configKey, outboundPolicy)
    .find((candidate) => candidate.key === targetKey);
  if (!target) throw new AiConfigError('AI_CONFIG_ENVIRONMENT_UNAVAILABLE');
  return target;
}

async function validateReplacementBaseUrl(
  value: string,
  resolver?: ProviderAddressResolver,
  policy?: ProviderOutboundPolicy,
): Promise<string> {
  let url: URL;
  try {
    url = policy
      ? validateProviderRuntimeBaseUrl(value, policy)
      : validateProviderBaseUrl(value);
    if (url.protocol === 'https:') {
      await resolvePublicProviderAddresses(url.hostname, resolver);
    }
  } catch {
    throw new AiConfigError('AI_CONFIG_INVALID');
  }
  return url.toString().replace(/\/$/u, '');
}

function inheritedBaseUrl(environment: AdminEnvironmentProviderTarget): string {
  if (environment.baseUrlMode === 'replacement_required') {
    throw new AiConfigError('AI_CONFIG_INVALID');
  }
  return environment.effectiveBaseUrl;
}

function isActiveTargetConflict(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === '23505'
    && 'constraint' in error
    && error.constraint === 'ai_environment_takeovers_active_target_idx',
  );
}

async function recordConflict(
  pool: Pool,
  targetKey: EnvironmentTargetKey,
  expectedConfigDigest: string,
  options: AdminProviderServiceOptions,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertAiConfigEvent(client, {
      actorAdminSessionId: options.actorAdminSessionId,
      configDigest: expectedConfigDigest,
      environmentTargetKey: targetKey,
      eventType: 'environment_takeover_conflict',
      resultCode: 'AI_CONFIG_TAKEOVER_EXISTS',
      status: 'denied',
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function executeTakeover(
  pool: Pool,
  targetKey: EnvironmentTargetKey,
  input: Omit<ParsedEnvironmentTakeoverInput, 'password'>,
  options: AdminProviderServiceOptions,
): Promise<EnvironmentTakeoverResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [`revolution:environment-provider-takeover:${targetKey}`],
    );

    const replay = await readTakeoverByRequestId(client, input.requestId);
    if (replay) {
      const result = toResult(replay, targetKey);
      await client.query('COMMIT');
      return result;
    }

    const runtimeConfig = options.runtimeConfigLoader?.() ?? options.runtimeConfig;
    const outboundPolicy = options.outboundPolicy ?? createProviderOutboundPolicy();
    const environment = requireEnvironmentTarget(
      runtimeConfig,
      options.configKey,
      targetKey,
      outboundPolicy,
    );
    if (environment.snapshot.configDigest !== input.expectedConfigDigest) {
      throw new AiConfigError('AI_CONFIG_ENVIRONMENT_CHANGED');
    }

    const baseUrl = input.baseUrl === null
      ? inheritedBaseUrl(environment)
      : await validateReplacementBaseUrl(input.baseUrl, options.resolver, options.outboundPolicy);
    const originChanged = new URL(baseUrl).origin !== new URL(environment.effectiveBaseUrl).origin;
    if (input.apiKey === null && originChanged && !input.reuseKeyAcrossOrigin) {
      throw new AiConfigError('AI_CONFIG_INVALID');
    }

    const created = await createConnectionWithModel(client, {
      connection: {
        apiKey: input.apiKey ?? environment.apiKey,
        baseUrl,
        displayName: input.name,
        userAgent: input.userAgent,
      },
      model: input.firstModel,
    }, options.configKey);
    const takeoverId = randomUUID();
    await client.query(
      `INSERT INTO ai_environment_takeovers
        (id, request_id, environment_target_key, source_config_digest,
         initial_connection_version_id, initial_model_version_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        takeoverId,
        input.requestId,
        targetKey,
        environment.snapshot.configDigest,
        created.connectionVersionId,
        created.modelVersionId,
      ],
    );
    await insertAiConfigEvent(client, {
      actorAdminSessionId: options.actorAdminSessionId,
      configDigest: environment.snapshot.configDigest,
      connectionSeriesId: created.connectionSeriesId,
      connectionVersion: 1,
      environmentTargetKey: targetKey,
      eventType: 'environment_takeover_created',
      modelSeriesId: created.modelSeriesId,
      modelVersion: 1,
      resultCode: 'AI_CONFIG_CREATED',
      status: 'succeeded',
    });
    await client.query('COMMIT');
    return {
      connectionSeriesId: created.connectionSeriesId,
      connectionVersion: 1,
      modelSeriesId: created.modelSeriesId,
      modelVersion: 1,
      takeoverId,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function takeoverEnvironmentProvider(
  pool: Pool,
  targetKey: EnvironmentTargetKey,
  input: Omit<ParsedEnvironmentTakeoverInput, 'password'>,
  options: AdminProviderServiceOptions,
): Promise<EnvironmentTakeoverResult> {
  try {
    return await executeTakeover(pool, targetKey, input, options);
  } catch (error) {
    if (!isActiveTargetConflict(error)) throw error;
    await recordConflict(pool, targetKey, input.expectedConfigDigest, options);
    throw new AiConfigError('AI_CONFIG_TAKEOVER_EXISTS');
  }
}
