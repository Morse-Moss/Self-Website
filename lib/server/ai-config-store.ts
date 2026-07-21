import { createHmac, randomUUID } from 'node:crypto';

import type pg from 'pg';

import {
  AiConfigError,
  createRuntimeConfigDigest,
  type AiChatProtocol,
  type AiConfigKey,
  type AiRouteRevisionSnapshot,
} from './ai-config.ts';
import {
  decryptAiConfigSecret,
  encryptAiConfigSecret,
} from './ai-config-crypto.ts';

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;
type TransactionClient = pg.PoolClient;

export interface ConnectionInput {
  apiKey: string;
  baseUrl: string;
  displayName: string;
  userAgent: string | null;
}

export interface ModelInput {
  displayName: string;
  inputUsdPerMillion: string | null;
  maxOutputTokens: number;
  modelId: string;
  outputUsdPerMillion: string | null;
  protocol: AiChatProtocol;
  reasoningEffort: string | null;
}

interface ConnectionRow {
  api_key_ciphertext: Buffer | null;
  api_key_iv: Buffer | null;
  api_key_tag: Buffer | null;
  base_url: string;
  display_name: string;
  id: string;
  key_version: number;
  series_id: string;
  user_agent: string | null;
  version: number;
}

interface ModelRow {
  config_digest: string;
  connection_version_id: string;
  display_name: string;
  id: string;
  input_usd_per_million: string | null;
  max_output_tokens: number;
  model_id: string;
  output_usd_per_million: string | null;
  protocol: AiChatProtocol;
  reasoning_effort: string | null;
  series_id: string;
  version: number;
}

function invalid(): never {
  throw new AiConfigError('AI_CONFIG_INVALID');
}

async function assertTransaction(client: TransactionClient): Promise<void> {
  const first = await client.query<{ txid: string }>('SELECT txid_current()::text AS txid');
  const second = await client.query<{ txid: string }>('SELECT txid_current()::text AS txid');
  if (!first.rows[0]?.txid || first.rows[0].txid !== second.rows[0]?.txid) invalid();
}

function normalizeConnection(input: ConnectionInput): ConnectionInput {
  const displayName = input.displayName.trim();
  const apiKey = input.apiKey;
  if (!displayName || displayName.length > 120 || !apiKey) invalid();
  let url: URL;
  try {
    url = new URL(input.baseUrl.trim());
  } catch {
    invalid();
  }
  if (
    !['https:', 'http:'].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) invalid();
  const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/$/u, '');
  const baseUrl = `${url.origin}${pathname}`;
  const userAgent = input.userAgent?.trim() || null;
  if (userAgent && userAgent.length > 512) invalid();
  return { apiKey, baseUrl, displayName, userAgent };
}

function normalizeModel(input: ModelInput): ModelInput {
  const displayName = input.displayName.trim();
  const modelId = input.modelId.trim();
  if (
    !displayName
    || displayName.length > 120
    || !modelId
    || modelId.length > 512
    || !['responses', 'chat_completions'].includes(input.protocol)
    || !Number.isSafeInteger(input.maxOutputTokens)
    || input.maxOutputTokens < 1
  ) invalid();
  return { ...input, displayName, modelId };
}

function connectionDigest(input: ConnectionInput, key: Buffer): string {
  return createHmac('sha256', key).update(JSON.stringify({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    userAgent: input.userAgent,
  }), 'utf8').digest('hex');
}

function runtimeDigest(
  connection: ConnectionInput,
  model: ModelInput,
  key: Buffer,
): string {
  return createRuntimeConfigDigest({
    apiKey: connection.apiKey,
    baseUrl: connection.baseUrl,
    maxOutputTokens: model.maxOutputTokens,
    modelId: model.modelId,
    protocol: model.protocol,
    reasoningEffort: model.reasoningEffort,
    userAgent: connection.userAgent,
  }, key);
}

async function insertConnection(
  client: Queryable,
  input: ConnectionInput,
  configKey: AiConfigKey,
  identity: { id: string; previousVersionId: string | null; seriesId: string; version: number },
): Promise<void> {
  const envelope = encryptAiConfigSecret(input.apiKey, configKey.key, {
    connectionVersionId: identity.id,
    keyVersion: configKey.keyVersion,
    seriesId: identity.seriesId,
  });
  await client.query(
    `INSERT INTO ai_connections
      (id, series_id, version, previous_version_id, display_name, base_url, user_agent,
       api_key_ciphertext, api_key_iv, api_key_tag, key_version, config_digest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      identity.id,
      identity.seriesId,
      identity.version,
      identity.previousVersionId,
      input.displayName,
      input.baseUrl,
      input.userAgent,
      envelope.ciphertext,
      envelope.iv,
      envelope.tag,
      configKey.keyVersion,
      connectionDigest(input, configKey.key),
    ],
  );
}

async function insertModel(
  client: Queryable,
  connection: ConnectionInput,
  input: ModelInput,
  configKey: AiConfigKey,
  identity: {
    connectionVersionId: string;
    id: string;
    previousVersionId: string | null;
    seriesId: string;
    version: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO ai_model_presets
      (id, series_id, version, previous_version_id, connection_version_id,
       display_name, model_id, protocol, reasoning_effort, max_output_tokens,
       input_usd_per_million, output_usd_per_million, config_digest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      identity.id,
      identity.seriesId,
      identity.version,
      identity.previousVersionId,
      identity.connectionVersionId,
      input.displayName,
      input.modelId,
      input.protocol,
      input.reasoningEffort,
      input.maxOutputTokens,
      input.inputUsdPerMillion,
      input.outputUsdPerMillion,
      runtimeDigest(connection, input, configKey.key),
    ],
  );
}

export async function createConnectionWithModel(
  client: TransactionClient,
  input: { connection: ConnectionInput; model: ModelInput },
  configKey: AiConfigKey,
): Promise<{
  connectionSeriesId: string;
  connectionVersionId: string;
  modelSeriesId: string;
  modelVersionId: string;
}> {
  const connection = normalizeConnection(input.connection);
  const model = normalizeModel(input.model);
  await assertTransaction(client);
  const connectionSeriesId = randomUUID();
  const connectionVersionId = randomUUID();
  const modelSeriesId = randomUUID();
  const modelVersionId = randomUUID();
  await insertConnection(client, connection, configKey, {
    id: connectionVersionId,
    previousVersionId: null,
    seriesId: connectionSeriesId,
    version: 1,
  });
  await insertModel(client, connection, model, configKey, {
    connectionVersionId,
    id: modelVersionId,
    previousVersionId: null,
    seriesId: modelSeriesId,
    version: 1,
  });
  return { connectionSeriesId, connectionVersionId, modelSeriesId, modelVersionId };
}

export async function createModelForConnection(
  client: TransactionClient,
  connectionSeriesId: string,
  input: ModelInput,
  configKey: AiConfigKey,
): Promise<{
  connectionVersion: number;
  modelSeriesId: string;
  modelVersionId: string;
}> {
  await assertTransaction(client);
  const current = await currentConnectionForUpdate(client, connectionSeriesId);
  const connection = decryptConnection(current, configKey);
  const model = normalizeModel(input);
  const modelSeriesId = randomUUID();
  const modelVersionId = randomUUID();
  await insertModel(client, connection, model, configKey, {
    connectionVersionId: current.id,
    id: modelVersionId,
    previousVersionId: null,
    seriesId: modelSeriesId,
    version: 1,
  });
  return { connectionVersion: current.version, modelSeriesId, modelVersionId };
}

async function currentConnectionForUpdate(
  client: Queryable,
  seriesId: string,
): Promise<ConnectionRow> {
  const result = await client.query<ConnectionRow>(
    `SELECT id, series_id, version, display_name, base_url, user_agent,
            api_key_ciphertext, api_key_iv, api_key_tag, key_version
       FROM ai_connections
      WHERE series_id = $1 AND deleted_at IS NULL AND secret_destroyed_at IS NULL
      ORDER BY version DESC LIMIT 1 FOR UPDATE`,
    [seriesId],
  );
  const row = result.rows[0];
  if (!row) throw new AiConfigError('AI_CONFIG_NOT_FOUND');
  return row;
}

function decryptConnection(row: ConnectionRow, configKey: AiConfigKey): ConnectionInput {
  if (row.key_version !== configKey.keyVersion) {
    throw new AiConfigError('AI_CONFIG_SECRET_UNAVAILABLE');
  }
  const apiKey = decryptAiConfigSecret({
    ciphertext: row.api_key_ciphertext,
    iv: row.api_key_iv,
    tag: row.api_key_tag,
  }, configKey.key, {
    connectionVersionId: row.id,
    keyVersion: row.key_version,
    seriesId: row.series_id,
  });
  return {
    apiKey,
    baseUrl: row.base_url,
    displayName: row.display_name,
    userAgent: row.user_agent,
  };
}

export async function createConnectionVersion(
  client: TransactionClient,
  input: {
    apiKey?: string;
    baseUrl: string;
    displayName: string;
    reuseExistingSecret: boolean;
    seriesId: string;
    userAgent: string | null;
  },
  configKey: AiConfigKey,
): Promise<{ clonedModelCount: number; connectionVersion: number; connectionVersionId: string }> {
  await assertTransaction(client);
  const current = await currentConnectionForUpdate(client, input.seriesId);
  const existing = decryptConnection(current, configKey);
  const apiKey = input.apiKey || (input.reuseExistingSecret ? existing.apiKey : '');
  const connection = normalizeConnection({
    apiKey,
    baseUrl: input.baseUrl,
    displayName: input.displayName,
    userAgent: input.userAgent,
  });
  const connectionVersionId = randomUUID();
  const connectionVersion = current.version + 1;
  await insertConnection(client, connection, configKey, {
    id: connectionVersionId,
    previousVersionId: current.id,
    seriesId: current.series_id,
    version: connectionVersion,
  });

  const models = await client.query<ModelRow>(
    `SELECT DISTINCT ON (series_id)
            id, series_id, version, connection_version_id, display_name, model_id,
            protocol, reasoning_effort, max_output_tokens,
            input_usd_per_million::text, output_usd_per_million::text, config_digest
       FROM ai_model_presets
      WHERE deleted_at IS NULL
      ORDER BY series_id, version DESC`,
  );
  const currentModels = models.rows.filter((model) => model.connection_version_id === current.id);
  for (const model of currentModels) {
    await insertModel(client, connection, {
      displayName: model.display_name,
      inputUsdPerMillion: model.input_usd_per_million,
      maxOutputTokens: model.max_output_tokens,
      modelId: model.model_id,
      outputUsdPerMillion: model.output_usd_per_million,
      protocol: model.protocol,
      reasoningEffort: model.reasoning_effort,
    }, configKey, {
      connectionVersionId,
      id: randomUUID(),
      previousVersionId: model.id,
      seriesId: model.series_id,
      version: model.version + 1,
    });
  }
  return { clonedModelCount: currentModels.length, connectionVersion, connectionVersionId };
}

export async function createModelVersion(
  client: TransactionClient,
  input: ModelInput & { seriesId: string },
  configKey: AiConfigKey,
): Promise<{ modelVersion: number; modelVersionId: string }> {
  await assertTransaction(client);
  const currentResult = await client.query<ModelRow>(
    `SELECT id, series_id, version, connection_version_id, display_name, model_id,
            protocol, reasoning_effort, max_output_tokens,
            input_usd_per_million::text, output_usd_per_million::text, config_digest
       FROM ai_model_presets
      WHERE series_id = $1 AND deleted_at IS NULL
      ORDER BY version DESC LIMIT 1 FOR UPDATE`,
    [input.seriesId],
  );
  const current = currentResult.rows[0];
  if (!current) throw new AiConfigError('AI_CONFIG_NOT_FOUND');
  const connectionResult = await client.query<ConnectionRow>(
    `SELECT id, series_id, version, display_name, base_url, user_agent,
            api_key_ciphertext, api_key_iv, api_key_tag, key_version
       FROM ai_connections WHERE id = $1 AND secret_destroyed_at IS NULL`,
    [current.connection_version_id],
  );
  const connectionRow = connectionResult.rows[0];
  if (!connectionRow) throw new AiConfigError('AI_CONFIG_SECRET_UNAVAILABLE');
  const connection = decryptConnection(connectionRow, configKey);
  const model = normalizeModel(input);
  const modelVersionId = randomUUID();
  const modelVersion = current.version + 1;
  await insertModel(client, connection, model, configKey, {
    connectionVersionId: connectionRow.id,
    id: modelVersionId,
    previousVersionId: current.id,
    seriesId: current.series_id,
    version: modelVersion,
  });
  return { modelVersion, modelVersionId };
}

export interface ResolvedModelRuntime {
  apiKey: string;
  connection: { baseUrl: string; displayName: string; id: string; userAgent: string | null; version: number };
  model: ModelInput & { configDigest: string; id: string; seriesId: string; version: number };
}

type ModelRuntimeRow = ModelRow & ConnectionRow & {
  connection_display_name: string;
  connection_id: string;
  connection_series_id: string;
  connection_version: number;
};

function resolvedModelRuntime(row: ModelRuntimeRow, configKey: AiConfigKey): ResolvedModelRuntime {
  const connectionRow: ConnectionRow = {
    ...row,
    display_name: row.connection_display_name,
    id: row.connection_id,
    series_id: row.connection_series_id,
    version: row.connection_version,
  };
  const connection = decryptConnection(connectionRow, configKey);
  const model: ModelInput = {
    displayName: row.display_name,
    inputUsdPerMillion: row.input_usd_per_million,
    maxOutputTokens: row.max_output_tokens,
    modelId: row.model_id,
    outputUsdPerMillion: row.output_usd_per_million,
    protocol: row.protocol,
    reasoningEffort: row.reasoning_effort,
  };
  if (runtimeDigest(connection, model, configKey.key) !== row.config_digest) {
    throw new AiConfigError('AI_CONFIG_SECRET_UNAVAILABLE');
  }
  return {
    apiKey: connection.apiKey,
    connection: {
      baseUrl: connection.baseUrl,
      displayName: connection.displayName,
      id: connectionRow.id,
      userAgent: connection.userAgent,
      version: connectionRow.version,
    },
    model: {
      ...model,
      configDigest: row.config_digest,
      id: row.id,
      seriesId: row.series_id,
      version: row.version,
    },
  };
}

export async function resolveModelRuntime(
  client: Queryable,
  modelSeriesId: string,
  configKey: AiConfigKey,
): Promise<ResolvedModelRuntime> {
  const result = await client.query<ModelRow & ConnectionRow>(
    `SELECT m.id, m.series_id, m.version, m.connection_version_id,
            m.display_name, m.model_id, m.protocol, m.reasoning_effort,
            m.max_output_tokens, m.input_usd_per_million::text,
            m.output_usd_per_million::text, m.config_digest,
            c.id AS connection_id, c.series_id AS connection_series_id,
            c.version AS connection_version, c.display_name AS connection_display_name,
            c.base_url, c.user_agent, c.api_key_ciphertext, c.api_key_iv,
            c.api_key_tag, c.key_version
       FROM ai_model_presets m
       JOIN ai_connections c ON c.id = m.connection_version_id
      WHERE m.series_id = $1 AND m.deleted_at IS NULL
        AND c.deleted_at IS NULL AND c.secret_destroyed_at IS NULL
      ORDER BY m.version DESC LIMIT 1`,
    [modelSeriesId],
  );
  const row = result.rows[0] as ModelRuntimeRow | undefined;
  if (!row) throw new AiConfigError('AI_CONFIG_NOT_FOUND');
  return resolvedModelRuntime(row, configKey);
}

export async function resolveModelVersionRuntime(
  client: TransactionClient,
  modelVersionId: string,
  configKey: AiConfigKey,
): Promise<ResolvedModelRuntime> {
  await assertTransaction(client);
  const result = await client.query<ModelRuntimeRow>(
    `SELECT m.id, m.series_id, m.version, m.connection_version_id,
            m.display_name, m.model_id, m.protocol, m.reasoning_effort,
            m.max_output_tokens, m.input_usd_per_million::text,
            m.output_usd_per_million::text, m.config_digest,
            c.id AS connection_id, c.series_id AS connection_series_id,
            c.version AS connection_version, c.display_name AS connection_display_name,
            c.base_url, c.user_agent, c.api_key_ciphertext, c.api_key_iv,
            c.api_key_tag, c.key_version
       FROM ai_model_presets m
       JOIN ai_connections c ON c.id = m.connection_version_id
      WHERE m.id = $1 AND m.deleted_at IS NULL
        AND c.deleted_at IS NULL AND c.secret_destroyed_at IS NULL
      FOR UPDATE OF m, c`,
    [modelVersionId],
  );
  const row = result.rows[0];
  if (!row) throw new AiConfigError('AI_CONFIG_TARGET_DELETED');
  return resolvedModelRuntime(row, configKey);
}

export async function listAiConfigCatalog(client: Queryable): Promise<{
  connections: Array<{
    baseUrl: string;
    displayName: string;
    id: string;
    models: Array<{
      configDigest: string;
      displayName: string;
      id: string;
      modelId: string;
      protocol: AiChatProtocol;
      seriesId: string;
      version: number;
    }>;
    seriesId: string;
    userAgent: string | null;
    version: number;
  }>;
}> {
  const connections = await client.query<Omit<ConnectionRow, 'api_key_ciphertext' | 'api_key_iv' | 'api_key_tag' | 'key_version'>>(
    `SELECT DISTINCT ON (series_id) id, series_id, version, display_name, base_url, user_agent
       FROM ai_connections WHERE deleted_at IS NULL
      ORDER BY series_id, version DESC`,
  );
  const models = await client.query<ModelRow>(
    `SELECT DISTINCT ON (series_id)
            id, series_id, version, connection_version_id, display_name, model_id,
            protocol, reasoning_effort, max_output_tokens,
            input_usd_per_million::text, output_usd_per_million::text, config_digest
       FROM ai_model_presets WHERE deleted_at IS NULL
      ORDER BY series_id, version DESC`,
  );
  return {
    connections: connections.rows.map((connection) => ({
      baseUrl: connection.base_url,
      displayName: connection.display_name,
      id: connection.id,
      models: models.rows
        .filter((model) => model.connection_version_id === connection.id)
        .map((model) => ({
          configDigest: model.config_digest,
          displayName: model.display_name,
          id: model.id,
          modelId: model.model_id,
          protocol: model.protocol,
          seriesId: model.series_id,
          version: model.version,
        })),
      seriesId: connection.series_id,
      userAgent: connection.user_agent,
      version: connection.version,
    })),
  };
}

export async function tombstoneModel(
  client: TransactionClient,
  modelSeriesId: string,
  now: Date,
): Promise<void> {
  await assertTransaction(client);
  const result = await client.query(
    `UPDATE ai_model_presets
        SET archived_at = COALESCE(archived_at, $2), deleted_at = COALESCE(deleted_at, $2)
      WHERE series_id = $1 AND deleted_at IS NULL`,
    [modelSeriesId, now],
  );
  if (result.rowCount === 0) throw new AiConfigError('AI_CONFIG_NOT_FOUND');
}

export async function shredConnectionSecret(
  client: TransactionClient,
  connectionSeriesId: string,
  now: Date,
): Promise<void> {
  await assertTransaction(client);
  const result = await client.query(
    `UPDATE ai_connections
        SET api_key_ciphertext = NULL, api_key_iv = NULL, api_key_tag = NULL,
            secret_destroyed_at = COALESCE(secret_destroyed_at, $2)
      WHERE series_id = $1 AND secret_destroyed_at IS NULL`,
    [connectionSeriesId, now],
  );
  if (result.rowCount === 0) throw new AiConfigError('AI_CONFIG_NOT_FOUND');
}

export interface AiConfigEventInput {
  actorAdminSessionId: string | null;
  configDigest?: string | null;
  connectionSeriesId?: string | null;
  connectionVersion?: number | null;
  environmentTargetKey?: 'primary' | 'fallback-1' | 'fallback-2' | null;
  eventType: string;
  inputTokens?: number | null;
  itemCount?: number | null;
  latencyMs?: number | null;
  modelSeriesId?: string | null;
  modelVersion?: number | null;
  outputTokens?: number | null;
  resultCode: string;
  routeRevisionId?: string | null;
  status: 'succeeded' | 'failed' | 'denied';
}

export async function insertAiConfigEvent(
  client: TransactionClient,
  input: AiConfigEventInput,
): Promise<void> {
  await assertTransaction(client);
  await client.query(
    `INSERT INTO ai_config_events
      (event_type, actor_admin_session_id, connection_series_id, connection_version,
       model_series_id, model_version, route_revision_id, environment_target_key,
       config_digest, result_code, status, latency_ms, input_tokens, output_tokens, item_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      input.eventType,
      input.actorAdminSessionId,
      input.connectionSeriesId ?? null,
      input.connectionVersion ?? null,
      input.modelSeriesId ?? null,
      input.modelVersion ?? null,
      input.routeRevisionId ?? null,
      input.environmentTargetKey ?? null,
      input.configDigest ?? null,
      input.resultCode,
      input.status,
      input.latencyMs ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.itemCount ?? null,
    ],
  );
}

export async function readActiveRouteRaw(
  client: Queryable,
): Promise<AiRouteRevisionSnapshot | null> {
  const revision = await client.query<{
    id: string | null;
    lock_version: string;
    revision_number: string | null;
  }>(
    `SELECT state.active_route_revision_id AS id, state.lock_version::text,
            revision.revision_number::text
       FROM ai_runtime_state state
       LEFT JOIN ai_route_revisions revision ON revision.id = state.active_route_revision_id
      WHERE state.id = true`,
  );
  const row = revision.rows[0];
  if (!row) throw new AiConfigError('AI_CONFIG_UNAVAILABLE');
  if (!row.id) return null;
  if (!row.revision_number) throw new AiConfigError('AI_CONFIG_UNAVAILABLE');
  const targets = await client.query<{
    config_digest: string;
    connection_display_name: string;
    database_model_version_id: string | null;
    environment_target_key: 'primary' | 'fallback-1' | 'fallback-2' | null;
    input_usd_per_million: string | null;
    model_display_name: string;
    model_id: string;
    position: number;
    protocol: 'responses' | 'chat_completions';
    output_usd_per_million: string | null;
    source_type: 'database' | 'environment';
  }>(
    `SELECT position, source_type, database_model_version_id, environment_target_key,
            connection_display_name, model_display_name, model_id, protocol, config_digest,
            input_usd_per_million::text, output_usd_per_million::text
       FROM ai_route_targets WHERE route_revision_id = $1 ORDER BY position`,
    [row.id],
  );
  if (targets.rows.length < 1 || targets.rows.length > 6) {
    throw new AiConfigError('AI_CONFIG_UNAVAILABLE');
  }
  return {
    id: row.id,
    lockVersion: Number(row.lock_version),
    revisionNumber: Number(row.revision_number),
    targets: targets.rows.map((target) => ({
      configDigest: target.config_digest,
      connectionDisplayName: target.connection_display_name,
      databaseModelVersionId: target.database_model_version_id,
      environmentTargetKey: target.environment_target_key,
      inputUsdPerMillion: target.input_usd_per_million,
      modelDisplayName: target.model_display_name,
      modelId: target.model_id,
      position: target.position,
      protocol: target.protocol,
      outputUsdPerMillion: target.output_usd_per_million,
      sourceType: target.source_type,
    })),
  };
}
