import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';

import pg from 'pg';

import { AiConfigError } from '../lib/server/ai-config.ts';
import {
  createConnectionVersion,
  createConnectionWithModel,
  createModelVersion,
  insertAiConfigEvent,
  listAiConfigCatalog,
  readActiveRouteRaw,
  resolveModelRuntime,
  shredConnectionSecret,
  tombstoneModel,
} from '../lib/server/ai-config-store.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const key = Buffer.alloc(32, 17);
const keyVersion = 1;

async function migrate(connectionString: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [migrationRunner], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `migration exited ${code}`));
    });
  });
}

test('configuration store versions connections and models without exposing secret envelopes', async () => {
  const database = await createDisposablePostgresDatabase();
  await migrate(database.connectionString);
  const pool = new Pool({ connectionString: database.connectionString });
  try {
    const client = await pool.connect();
    let connectionSeriesId = '';
    let modelSeriesId = '';
    let firstConnectionVersionId = '';
    try {
      await client.query('BEGIN');
      const created = await createConnectionWithModel(client, {
        connection: {
          apiKey: 'secret-one',
          baseUrl: 'https://gateway-one.example/v1',
          displayName: '主线路',
          userAgent: 'Morse/1.0',
        },
        model: {
          displayName: '主模型',
          inputUsdPerMillion: null,
          maxOutputTokens: 4096,
          modelId: 'gpt-example',
          outputUsdPerMillion: null,
          protocol: 'responses',
          reasoningEffort: 'high',
        },
      }, { key, keyVersion });
      connectionSeriesId = created.connectionSeriesId;
      modelSeriesId = created.modelSeriesId;
      firstConnectionVersionId = created.connectionVersionId;
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    await assert.rejects(
      createConnectionWithModel(pool as unknown as pg.PoolClient, {
        connection: {
          apiKey: 'must-not-persist',
          baseUrl: 'https://no-transaction.example/v1',
          displayName: '无事务线路',
          userAgent: null,
        },
        model: {
          displayName: '无事务模型',
          inputUsdPerMillion: null,
          maxOutputTokens: 1024,
          modelId: 'no-transaction-model',
          outputUsdPerMillion: null,
          protocol: 'responses',
          reasoningEffort: null,
        },
      }, { key, keyVersion }),
      (error: unknown) => error instanceof AiConfigError && error.code === 'AI_CONFIG_INVALID',
    );
    const noTransactionRows = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM ai_connections
        WHERE base_url = 'https://no-transaction.example/v1'`,
    );
    assert.equal(noTransactionRows.rows[0].count, 0);

    const firstRuntime = await resolveModelRuntime(pool, modelSeriesId, { key, keyVersion });
    assert.equal(firstRuntime.apiKey, 'secret-one');
    assert.equal(firstRuntime.connection.version, 1);
    assert.equal(firstRuntime.model.version, 1);
    await assert.rejects(
      pool.query(
        `UPDATE ai_connections SET base_url = 'https://tampered.example/v1'
          WHERE id = $1`,
        [firstConnectionVersionId],
      ),
      (error: unknown) => typeof error === 'object' && error !== null
        && 'code' in error && error.code === '23514',
    );
    await assert.rejects(
      pool.query(
        `UPDATE ai_model_presets SET model_id = 'tampered-model'
          WHERE series_id = $1`,
        [modelSeriesId],
      ),
      (error: unknown) => typeof error === 'object' && error !== null
        && 'code' in error && error.code === '23514',
    );

    const versionClient = await pool.connect();
    try {
      await versionClient.query('BEGIN');
      const result = await createConnectionVersion(versionClient, {
        seriesId: connectionSeriesId,
        displayName: '主线路（新域名）',
        baseUrl: 'https://gateway-two.example/v1',
        userAgent: 'Morse/1.0',
        reuseExistingSecret: true,
      }, { key, keyVersion });
      assert.equal(result.connectionVersion, 2);
      assert.equal(result.clonedModelCount, 1);
      await versionClient.query('COMMIT');
    } finally {
      versionClient.release();
    }

    const clonedRuntime = await resolveModelRuntime(pool, modelSeriesId, { key, keyVersion });
    assert.equal(clonedRuntime.apiKey, 'secret-one');
    assert.equal(clonedRuntime.connection.version, 2);
    assert.equal(clonedRuntime.model.version, 2);
    assert.notEqual(clonedRuntime.connection.id, firstConnectionVersionId);

    const modelClient = await pool.connect();
    try {
      await modelClient.query('BEGIN');
      const result = await createModelVersion(modelClient, {
        seriesId: modelSeriesId,
        displayName: '主模型 v2',
        inputUsdPerMillion: '1.25',
        maxOutputTokens: 8192,
        modelId: 'gpt-example-v2',
        outputUsdPerMillion: '5.00',
        protocol: 'chat_completions',
        reasoningEffort: null,
      }, { key, keyVersion });
      assert.equal(result.modelVersion, 3);
      await modelClient.query('COMMIT');
    } finally {
      modelClient.release();
    }

    const catalog = await listAiConfigCatalog(pool);
    const serialized = JSON.stringify(catalog);
    assert.equal(catalog.connections.length, 1);
    assert.equal(catalog.connections[0].version, 2);
    assert.equal(catalog.connections[0].models[0].version, 3);
    assert.doesNotMatch(serialized, /secret-one|ciphertext|apiKey|api_key_iv|api_key_tag/u);

    assert.equal(await readActiveRouteRaw(pool), null);
    const routeClient = await pool.connect();
    const routeId = randomUUID();
    try {
      await routeClient.query('BEGIN');
      await routeClient.query(
        `INSERT INTO ai_route_revisions
          (id, revision_number, activation_kind, activated_at, actor_admin_session_id)
         VALUES ($1, 1, 'bootstrap', now(), NULL)`,
        [routeId],
      );
      await routeClient.query(
        `INSERT INTO ai_route_targets
          (route_revision_id, position, source_type, environment_target_key,
           connection_display_name, model_display_name, model_id, protocol, config_digest)
         VALUES ($1, 0, 'environment', 'primary', '环境主线路', '环境模型',
                 'gpt-environment', 'responses', $2)`,
        [routeId, 'c'.repeat(64)],
      );
      await routeClient.query(
        `UPDATE ai_runtime_state
            SET active_route_revision_id = $1, lock_version = lock_version + 1, updated_at = now()
          WHERE id = true`,
        [routeId],
      );
      await insertAiConfigEvent(routeClient, {
        actorAdminSessionId: null,
        configDigest: 'c'.repeat(64),
        eventType: 'route_activated',
        resultCode: 'AI_CONFIG_ACTIVATED',
        routeRevisionId: routeId,
        status: 'succeeded',
      });
      await routeClient.query('COMMIT');
    } finally {
      routeClient.release();
    }
    const activeRoute = await readActiveRouteRaw(pool);
    assert.equal(activeRoute?.id, routeId);
    assert.equal(activeRoute?.lockVersion, 1);
    assert.deepEqual(activeRoute?.targets.map((target) => target.environmentTargetKey), ['primary']);
    const event = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM ai_config_events
        WHERE route_revision_id = $1 AND event_type = 'route_activated'`,
      [routeId],
    );
    assert.equal(event.rows[0].count, 1);

    const rows = await pool.query<{
      connection_versions: number;
      model_versions: number;
      distinct_envelopes: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM ai_connections WHERE series_id = $1) AS connection_versions,
         (SELECT count(*)::integer FROM ai_model_presets WHERE series_id = $2) AS model_versions,
         (SELECT count(DISTINCT encode(api_key_ciphertext, 'hex'))::integer
            FROM ai_connections WHERE series_id = $1) AS distinct_envelopes`,
      [connectionSeriesId, modelSeriesId],
    );
    assert.deepEqual(rows.rows[0], {
      connection_versions: 2,
      model_versions: 3,
      distinct_envelopes: 2,
    });

    const deleteClient = await pool.connect();
    try {
      await deleteClient.query('BEGIN');
      await tombstoneModel(deleteClient, modelSeriesId, new Date());
      await deleteClient.query('COMMIT');
    } finally {
      deleteClient.release();
    }
    await assert.rejects(
      pool.query(
        `UPDATE ai_model_presets SET archived_at = NULL, deleted_at = NULL
          WHERE series_id = $1`,
        [modelSeriesId],
      ),
      (error: unknown) => typeof error === 'object' && error !== null
        && 'code' in error && error.code === '23514',
    );
    const secretBeforeShred = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM ai_connections
        WHERE series_id = $1 AND api_key_ciphertext IS NOT NULL`,
      [connectionSeriesId],
    );
    assert.equal(secretBeforeShred.rows[0].count, 2);
    await assert.rejects(
      resolveModelRuntime(pool, modelSeriesId, { key, keyVersion }),
      (error: unknown) => error instanceof AiConfigError && error.code === 'AI_CONFIG_NOT_FOUND',
    );

    const shredClient = await pool.connect();
    try {
      await shredClient.query('BEGIN');
      await shredConnectionSecret(shredClient, connectionSeriesId, new Date());
      await shredClient.query('COMMIT');
    } finally {
      shredClient.release();
    }
    const shredded = await pool.query<{
      ciphertext: Buffer | null;
      iv: Buffer | null;
      tag: Buffer | null;
      destroyed: boolean;
    }>(
      `SELECT api_key_ciphertext AS ciphertext, api_key_iv AS iv, api_key_tag AS tag,
              secret_destroyed_at IS NOT NULL AS destroyed
         FROM ai_connections WHERE series_id = $1 ORDER BY version`,
      [connectionSeriesId],
    );
    assert.ok(shredded.rows.every((row) => (
      row.ciphertext === null && row.iv === null && row.tag === null && row.destroyed
    )));
  } finally {
    await pool.end();
    await database.dispose();
  }
});
