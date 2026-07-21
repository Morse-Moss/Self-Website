import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';

import pg from 'pg';

import { AiConfigError } from '../lib/server/ai-config.ts';
import {
  activateProviderRoute,
  createAdminProviderTransport,
  createProviderConnection,
  createProviderModel,
  deleteProviderConnection,
  deleteProviderModel,
  discoverProviderModels,
  getProviderCatalog,
  getProviderRuntimeSummary,
  testEnvironmentProviderTarget,
  testProviderModel,
  updateProviderConnection,
  updateProviderModel,
  type AdminProviderServiceOptions,
} from '../lib/server/admin-provider-config.ts';
import { createProviderOutboundPolicy } from '../lib/server/provider-outbound.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const adminSessionId = '11111111-1111-4111-8111-111111111111';

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
    child.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(stderr || `migration exited ${code}`)));
  });
}

const model = {
  displayName: 'Primary model',
  modelId: 'gpt-compatible',
  protocol: 'responses' as const,
  reasoningEffort: 'high',
  maxOutputTokens: 4096,
  inputUsdPerMillion: '1.25',
  outputUsdPerMillion: '5',
};

function options(overrides: Partial<AdminProviderServiceOptions> = {}): AdminProviderServiceOptions {
  return {
    actorAdminSessionId: adminSessionId,
    configKey: { key: Buffer.alloc(32, 41), keyVersion: 1 },
    now: () => new Date(),
    resolver: async () => [{ address: '8.8.8.8', family: 4 }],
    runtimeConfig: {
      chatModel: 'gpt-environment',
      chatProtocol: 'responses',
      embeddingApiKey: 'unused-embedding',
      embeddingBaseUrl: 'https://embedding.example/v1',
      embeddingDimensions: 1536,
      embeddingModel: 'embedding-model',
      embeddingTimeoutMs: 8000,
      maxOutputTokens: 600,
      openaiApiKey: 'environment-secret',
      openaiBaseUrl: 'https://environment.example/v1',
      openaiFallbacks: [{ apiKey: 'fallback-secret', baseUrl: 'https://fallback.example/v1' }],
      openaiUserAgent: 'Morse/Test',
      providerConcurrency: 4,
      providerFirstByteTimeoutMs: 20000,
      providerTotalTimeoutMs: 90000,
      reasoningEffort: 'high',
      tokenRates: { inputUsdPerMillion: 2, outputUsdPerMillion: 8 },
    },
    transport: {
      async discover() { return ['model-z', 'model-a', 'model-a']; },
      async test() {
        return { latencyMs: 12, usage: { inputTokens: 3, outputTokens: 1 } };
      },
    },
    ...overrides,
  };
}

async function withDatabase(run: (pool: InstanceType<typeof Pool>) => Promise<void>): Promise<void> {
  const database = await createDisposablePostgresDatabase();
  await migrate(database.connectionString);
  const pool = new Pool({ connectionString: database.connectionString });
  try {
    await run(pool);
  } finally {
    await pool.end();
    await database.dispose();
  }
}

function loseFirstCommitAcknowledgement(
  pool: InstanceType<typeof Pool>,
): InstanceType<typeof Pool> {
  let acknowledgementLost = false;
  return {
    async connect() {
      const client = await pool.connect();
      const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      return {
        async query(statement: unknown, ...args: unknown[]) {
          const result = await query(statement, ...args);
          if (!acknowledgementLost && statement === 'COMMIT') {
            acknowledgementLost = true;
            throw new Error('COMMIT_ACK_LOST');
          }
          return result;
        },
        release() { client.release(); },
      };
    },
  } as unknown as InstanceType<typeof Pool>;
}

async function listenOnLoopback(server: ReturnType<typeof createServer>): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function insertSuccessfulModelTest(
  pool: InstanceType<typeof Pool>,
  modelSeriesId: string,
  createdAt: Date,
): Promise<void> {
  const modelVersion = await pool.query<{ config_digest: string; version: number }>(
    `SELECT config_digest, version FROM ai_model_presets
      WHERE series_id = $1 ORDER BY version DESC LIMIT 1`,
    [modelSeriesId],
  );
  assert.equal(modelVersion.rowCount, 1);
  await pool.query(
    `INSERT INTO ai_config_events
      (event_type, actor_admin_session_id, model_series_id, model_version,
       config_digest, result_code, status, created_at, delete_after)
     VALUES ('provider_test',$1,$2,$3,$4,'AI_CONFIG_TEST_SUCCEEDED','succeeded',$5,$6)`,
    [
      adminSessionId,
      modelSeriesId,
      modelVersion.rows[0].version,
      modelVersion.rows[0].config_digest,
      createdAt,
      new Date(createdAt.getTime() + 180 * 24 * 60 * 60_000),
    ],
  );
}

function loopbackPolicy(origin: string) {
  return createProviderOutboundPolicy({
    MORSE_LOCAL_RELEASE_SMOKE: 'true',
    MORSE_PROVIDER_MOCK_ORIGIN: origin,
    NODE_ENV: 'test',
  });
}

test('default admin transport discovers models and runs a fixed probe through pinned loopback HTTP', async () => {
  const requests: Array<{ body: string; method: string | undefined; url: string | undefined }> = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => { body += chunk; });
    request.on('end', () => {
      requests.push({ body, method: request.method, url: request.url });
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          data: [{ id: 'model-b', object: 'model' }, { id: 'model-a', object: 'model' }],
          object: 'list',
        }));
        return;
      }
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(`data: ${JSON.stringify({
          choices: [{ delta: { content: 'OK', role: 'assistant' }, finish_reason: null, index: 0 }],
          created: 0,
          id: 'chatcmpl-admin-test',
          model: 'model-a',
          object: 'chat.completion.chunk',
        })}\n\n`);
        response.end(`data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
          created: 0,
          id: 'chatcmpl-admin-test',
          model: 'model-a',
          object: 'chat.completion.chunk',
          usage: { completion_tokens: 1, prompt_tokens: 3, total_tokens: 4 },
        })}\n\ndata: [DONE]\n\n`);
        return;
      }
      response.writeHead(404).end();
    });
  });
  const origin = await listenOnLoopback(server);
  try {
    const runtimeConfig = { ...options().runtimeConfig, providerTotalTimeoutMs: 1_000 };
    const transport = createAdminProviderTransport(runtimeConfig, { policy: loopbackPolicy(origin) });
    const target = { apiKey: 'fake-admin-key', baseUrl: `${origin}/v1`, userAgent: 'Morse/Test' };

    assert.deepEqual(await transport.discover(target), ['model-b', 'model-a']);
    const probeResult = await transport.test({
      ...target,
      maxOutputTokens: 16,
      modelId: 'model-a',
      protocol: 'chat_completions',
      reasoningEffort: null,
    });
    assert(probeResult.latencyMs >= 0);
    assert.deepEqual(probeResult.usage, { inputTokens: 3, outputTokens: 1 });
    assert.deepEqual(requests.map((request) => `${request.method} ${request.url}`), [
      'GET /v1/models',
      'POST /v1/chat/completions',
    ]);
    const probe = JSON.parse(requests[1].body) as Record<string, unknown>;
    assert.equal(probe.model, 'model-a');
    assert.equal(probe.stream, true);
    assert.equal(probe.max_completion_tokens, 16);
  } finally {
    await closeServer(server);
  }
});

test('default admin model discovery obeys the Provider total timeout', async () => {
  const server = createServer(() => undefined);
  const origin = await listenOnLoopback(server);
  try {
    const runtimeConfig = { ...options().runtimeConfig, providerTotalTimeoutMs: 40 };
    const transport = createAdminProviderTransport(runtimeConfig, { policy: loopbackPolicy(origin) });
    const result = transport.discover({
      apiKey: 'fake-admin-key',
      baseUrl: `${origin}/v1`,
      userAgent: null,
    });
    let guard: ReturnType<typeof setTimeout> | undefined;
    const bounded = Promise.race([
      result.then(() => 'resolved', () => 'rejected'),
      new Promise<'unbounded'>((resolve) => {
        guard = setTimeout(() => resolve('unbounded'), 750);
      }),
    ]);
    try {
      assert.equal(await bounded, 'rejected');
    } finally {
      if (guard) clearTimeout(guard);
    }
  } finally {
    await closeServer(server);
  }
});

test('provider administration versions configuration and returns only redacted catalog data', async () => {
  await withDatabase(async (pool) => {
    const created = await createProviderConnection(pool, {
      name: 'Gateway',
      baseUrl: 'https://gateway.example/v1',
      userAgent: 'Morse/1.0',
      apiKey: 'top-secret-key',
      firstModel: model,
    }, options());

    await assert.rejects(
      updateProviderConnection(pool, created.connectionSeriesId, {
        name: 'Moved gateway',
        baseUrl: 'https://moved.example/v1',
        userAgent: null,
        apiKey: null,
        reuseKeyAcrossOrigin: false,
      }, options()),
      (error: unknown) => error instanceof AiConfigError && error.code === 'AI_CONFIG_INVALID',
    );
    const updated = await updateProviderConnection(pool, created.connectionSeriesId, {
      name: 'Moved gateway',
      baseUrl: 'https://moved.example/v1',
      userAgent: null,
      apiKey: null,
      reuseKeyAcrossOrigin: true,
    }, options());
    assert.equal(updated.connectionVersion, 2);

    const addedModel = await createProviderModel(pool, created.connectionSeriesId, {
      ...model,
      displayName: 'Second model',
      modelId: 'gpt-second',
    }, options());
    const catalog = await getProviderCatalog(pool, { includeDeleted: false, limit: 25, page: 1 });
    assert.equal(catalog.items.length, 1);
    assert.equal(catalog.items[0].hasApiKey, true);
    assert.equal(catalog.items[0].version, 2);
    assert.equal(catalog.items[0].models.length, 2);
    assert.ok(catalog.items[0].models.some((item) => item.seriesId === addedModel.modelSeriesId));
    assert.doesNotMatch(JSON.stringify(catalog), /top-secret-key|ciphertext|api_key|authorization/iu);
  });
});

test('a connection remains usable after its last unused model is deleted', async () => {
  await withDatabase(async (pool) => {
    const serviceOptions = options();
    const created = await createProviderConnection(pool, {
      name: 'Gateway',
      baseUrl: 'https://gateway.example/v1',
      userAgent: null,
      apiKey: 'top-secret-key',
      firstModel: model,
    }, serviceOptions);
    assert.deepEqual(
      await deleteProviderModel(pool, created.modelSeriesId, model.displayName, serviceOptions),
      { disposition: 'deleted' },
    );

    const replacement = await createProviderModel(pool, created.connectionSeriesId, {
      ...model,
      displayName: 'Replacement model',
      modelId: 'replacement-model',
    }, serviceOptions);
    assert.match(replacement.modelSeriesId, /^[0-9a-f-]{36}$/u);
  });
});

test('activation requires fresh matching tests, is atomic on conflict, and preserves safe deletion semantics', async () => {
  await withDatabase(async (pool) => {
    const serviceOptions = options();
    const created = await createProviderConnection(pool, {
      name: 'Gateway',
      baseUrl: 'https://gateway.example/v1',
      userAgent: null,
      apiKey: 'top-secret-key',
      firstModel: model,
    }, serviceOptions);

    await assert.rejects(
      activateProviderRoute(pool, {
        expectedActiveRevision: 0,
        targets: [{ source: 'database', modelId: created.modelSeriesId }],
      }, serviceOptions),
      (error: unknown) => error instanceof AiConfigError && error.code === 'AI_CONFIG_TEST_REQUIRED',
    );
    const tested = await testProviderModel(pool, created.modelSeriesId, serviceOptions);
    assert.equal(tested.status, 'succeeded');
    assert.equal(tested.resultCode, 'AI_CONFIG_TEST_SUCCEEDED');

    const activated = await activateProviderRoute(pool, {
      expectedActiveRevision: 0,
      targets: [{ source: 'database', modelId: created.modelSeriesId }],
    }, serviceOptions);
    assert.equal(activated.activeRevision, 1);
    assert.equal(activated.targets[0].sourceType, 'database');

    await assert.rejects(
      activateProviderRoute(pool, {
        expectedActiveRevision: 0,
        targets: [{ source: 'database', modelId: created.modelSeriesId }],
      }, serviceOptions),
      (error: unknown) => error instanceof AiConfigError && error.code === 'AI_CONFIG_CONFLICT',
    );
    const revisionCount = await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM ai_route_revisions',
    );
    assert.equal(revisionCount.rows[0].count, 1);
    const unchanged = await activateProviderRoute(pool, {
      expectedActiveRevision: 1,
      targets: [{ source: 'database', modelId: created.modelSeriesId }],
    }, options({ now: () => new Date(Date.now() + 31 * 60_000) }));
    assert.equal(unchanged.activeRevision, 2);
    await assert.rejects(
      deleteProviderModel(pool, created.modelSeriesId, 'Primary model', serviceOptions),
      (error: unknown) => error instanceof AiConfigError && error.code === 'AI_CONFIG_IN_USE',
    );

    const unused = await createProviderModel(pool, created.connectionSeriesId, {
      ...model,
      displayName: 'Unused model',
      modelId: 'unused-model',
    }, serviceOptions);
    const removed = await deleteProviderModel(pool, unused.modelSeriesId, 'Unused model', serviceOptions);
    assert.equal(removed.disposition, 'deleted');

    await testEnvironmentProviderTarget(pool, 'primary', serviceOptions);
    const environmentRoute = await activateProviderRoute(pool, {
      expectedActiveRevision: 2,
      targets: [{ source: 'environment', environmentTargetKey: 'primary' }],
    }, serviceOptions);
    assert.equal(environmentRoute.activeRevision, 3);
    const retainedModel = await deleteProviderModel(
      pool,
      created.modelSeriesId,
      'Primary model',
      serviceOptions,
    );
    assert.equal(retainedModel.disposition, 'history_retained');
    const sharedSecret = await pool.query<{ remaining: number }>(
      `SELECT count(*) FILTER (WHERE api_key_ciphertext IS NOT NULL)::integer AS remaining
         FROM ai_connections WHERE series_id = $1`,
      [created.connectionSeriesId],
    );
    assert.ok(sharedSecret.rows[0].remaining > 0);
    const deleted = await deleteProviderConnection(pool, created.connectionSeriesId, 'Gateway', serviceOptions);
    assert.equal(deleted.disposition, 'history_retained');
    const secrets = await pool.query<{ remaining: number }>(
      `SELECT count(*) FILTER (WHERE api_key_ciphertext IS NOT NULL)::integer AS remaining
         FROM ai_connections WHERE series_id = $1`,
      [created.connectionSeriesId],
    );
    assert.equal(secrets.rows[0].remaining, 0);
    const runtime = await getProviderRuntimeSummary(pool, serviceOptions);
    assert.equal(runtime.activeRevision, 3);
    assert.equal(runtime.targets[0].environmentTargetKey, 'primary');
  });
});

test('failed activations remain atomic and persist only stable denied audit results', async () => {
  await withDatabase(async (pool) => {
    const serviceOptions = options();
    const created = await createProviderConnection(pool, {
      name: 'Gateway', baseUrl: 'https://gateway.example/v1', userAgent: null,
      apiKey: 'top-secret-key', firstModel: model,
    }, serviceOptions);
    await assert.rejects(
      activateProviderRoute(pool, {
        expectedActiveRevision: 0,
        targets: [{ source: 'database', modelId: created.modelSeriesId }],
      }, serviceOptions),
      (error: unknown) => error instanceof AiConfigError && error.code === 'AI_CONFIG_TEST_REQUIRED',
    );
    assert.equal((await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM ai_route_revisions',
    )).rows[0].count, 0);

    await testProviderModel(pool, created.modelSeriesId, serviceOptions);
    await activateProviderRoute(pool, {
      expectedActiveRevision: 0,
      targets: [{ source: 'database', modelId: created.modelSeriesId }],
    }, serviceOptions);
    await assert.rejects(
      activateProviderRoute(pool, {
        expectedActiveRevision: 0,
        targets: [{ source: 'database', modelId: created.modelSeriesId }],
      }, serviceOptions),
      (error: unknown) => error instanceof AiConfigError && error.code === 'AI_CONFIG_CONFLICT',
    );
    const denied = await pool.query<{ result_code: string; status: string }>(
      `SELECT result_code, status FROM ai_config_events
        WHERE event_type = 'route_activation_denied' ORDER BY id`,
    );
    assert.deepEqual(denied.rows, [
      { result_code: 'AI_CONFIG_TEST_REQUIRED', status: 'denied' },
      { result_code: 'AI_CONFIG_CONFLICT', status: 'denied' },
    ]);
    assert.equal((await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM ai_route_revisions',
    )).rows[0].count, 1);
  });
});

test('an ambiguous commit acknowledgement never creates a false denied activation audit', async () => {
  await withDatabase(async (pool) => {
    const serviceOptions = options();
    const created = await createProviderConnection(pool, {
      name: 'Gateway', baseUrl: 'https://gateway.example/v1', userAgent: null,
      apiKey: 'top-secret-key', firstModel: model,
    }, serviceOptions);
    await testProviderModel(pool, created.modelSeriesId, serviceOptions);

    await assert.rejects(
      activateProviderRoute(loseFirstCommitAcknowledgement(pool), {
        expectedActiveRevision: 0,
        targets: [{ source: 'database', modelId: created.modelSeriesId }],
      }, serviceOptions),
      /COMMIT_ACK_LOST/u,
    );
    const runtime = await getProviderRuntimeSummary(pool, serviceOptions);
    assert.equal(runtime.activeRevision, 1);
    const events = await pool.query<{ event_type: string; status: string }>(
      `SELECT event_type, status FROM ai_config_events
        WHERE event_type IN ('route_activated', 'route_activation_denied') ORDER BY id`,
    );
    assert.deepEqual(events.rows, [{ event_type: 'route_activated', status: 'succeeded' }]);
  });
});

test('provider testing is session-serialized, rate-limited, and never persists output text', async () => {
  await withDatabase(async (pool) => {
    const serviceOptions = options();
    const otherSessionOptions = options({
      actorAdminSessionId: '22222222-2222-4222-8222-222222222222',
    });
    const created = await createProviderConnection(pool, {
      name: 'Gateway', baseUrl: 'https://gateway.example/v1', userAgent: null,
      apiKey: 'top-secret-key', firstModel: model,
    }, serviceOptions);
    assert.deepEqual(await discoverProviderModels(pool, created.connectionSeriesId, serviceOptions), {
      items: ['model-a', 'model-z'],
    });
    await testProviderModel(pool, created.modelSeriesId, otherSessionOptions);
    await testProviderModel(pool, created.modelSeriesId, serviceOptions);
    await assert.rejects(
      testProviderModel(pool, created.modelSeriesId, otherSessionOptions),
      (error: unknown) => error instanceof AiConfigError && error.code === 'AI_CONFIG_RATE_LIMITED',
    );
    const events = await pool.query<{ raw: string }>(
      'SELECT json_agg(event ORDER BY id)::text AS raw FROM ai_config_events event',
    );
    assert.equal((await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM ai_config_events
        WHERE status = 'denied' AND result_code = 'AI_CONFIG_RATE_LIMITED'`,
    )).rows[0].count, 1);
    assert.doesNotMatch(events.rows[0].raw, /top-secret-key|output text|authorization/iu);
  });
});

test('failed provider tests persist only a stable audit result before returning the error', async () => {
  await withDatabase(async (pool) => {
    const serviceOptions = options({
      transport: {
        async discover() { throw new Error('RAW_PRIVATE_DISCOVERY_PAYLOAD'); },
        async test() { throw new Error('RAW_PRIVATE_PROVIDER_PAYLOAD'); },
      },
    });
    const created = await createProviderConnection(pool, {
      name: 'Gateway', baseUrl: 'https://gateway.example/v1', userAgent: null,
      apiKey: 'top-secret-key', firstModel: model,
    }, serviceOptions);
    await assert.rejects(
      testProviderModel(pool, created.modelSeriesId, serviceOptions),
      (error: unknown) => error instanceof AiConfigError && error.code === 'AI_CONFIG_TEST_FAILED',
    );
    const events = await pool.query<{ raw: string; result_code: string; status: string }>(
      `SELECT row_to_json(event)::text AS raw, result_code, status
         FROM ai_config_events event WHERE event_type = 'provider_test'`,
    );
    assert.equal(events.rowCount, 1);
    assert.equal(events.rows[0].status, 'failed');
    assert.equal(events.rows[0].result_code, 'AI_CONFIG_TEST_FAILED');
    assert.doesNotMatch(events.rows[0].raw, /RAW_PRIVATE|top-secret-key|authorization/iu);
  });
});

test('activating the previous logical route creates a rollback revision with its immutable snapshots', async () => {
  await withDatabase(async (pool) => {
    const serviceOptions = options();
    const created = await createProviderConnection(pool, {
      name: 'Gateway', baseUrl: 'https://gateway.example/v1', userAgent: null,
      apiKey: 'top-secret-key', firstModel: model,
    }, serviceOptions);
    await testProviderModel(pool, created.modelSeriesId, serviceOptions);
    const first = await activateProviderRoute(pool, {
      expectedActiveRevision: 0,
      targets: [{ source: 'database', modelId: created.modelSeriesId }],
    }, serviceOptions);

    await updateProviderModel(pool, created.modelSeriesId, {
      ...model,
      displayName: 'Primary model v2',
      modelId: 'gpt-compatible-v2',
    }, serviceOptions);
    await testProviderModel(pool, created.modelSeriesId, serviceOptions);
    const second = await activateProviderRoute(pool, {
      expectedActiveRevision: 1,
      targets: [{ source: 'database', modelId: created.modelSeriesId }],
    }, serviceOptions);
    assert.notEqual(second.targets[0].databaseModelVersionId, first.targets[0].databaseModelVersionId);

    await assert.rejects(
      activateProviderRoute(pool, {
        expectedActiveRevision: 2,
        targets: [{ source: 'database', modelId: created.modelSeriesId }],
      }, options({ configKey: { key: Buffer.alloc(32, 42), keyVersion: 2 } })),
      (error: unknown) => error instanceof AiConfigError
        && error.code === 'AI_CONFIG_SECRET_UNAVAILABLE',
    );

    const rollback = await activateProviderRoute(pool, {
      expectedActiveRevision: 2,
      targets: [{ source: 'database', modelId: created.modelSeriesId }],
    }, serviceOptions);
    assert.equal(rollback.activeRevision, 3);
    assert.equal(rollback.targets[0].databaseModelVersionId, first.targets[0].databaseModelVersionId);
    const stored = await pool.query<{ activation_kind: string }>(
      'SELECT activation_kind FROM ai_route_revisions WHERE id = $1',
      [rollback.routeRevisionId],
    );
    assert.equal(stored.rows[0].activation_kind, 'rollback');
  });
});

test('one admin session cannot overlap Provider operations', async () => {
  await withDatabase(async (pool) => {
    let release!: () => void;
    let started!: () => void;
    const operationStarted = new Promise<void>((resolve) => { started = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const serviceOptions = options({
      transport: {
        async discover() { return []; },
        async test() {
          started();
          await blocked;
          return { latencyMs: 1, usage: null };
        },
      },
    });
    const created = await createProviderConnection(pool, {
      name: 'Gateway', baseUrl: 'https://gateway.example/v1', userAgent: null,
      apiKey: 'top-secret-key', firstModel: model,
    }, serviceOptions);
    const otherSessionOptions = {
      ...serviceOptions,
      actorAdminSessionId: '22222222-2222-4222-8222-222222222222',
    };
    const first = testProviderModel(pool, created.modelSeriesId, serviceOptions);
    await operationStarted;
    const second = testProviderModel(pool, created.modelSeriesId, otherSessionOptions);
    let guard: ReturnType<typeof setTimeout> | undefined;
    try {
      assert.equal(await Promise.race([
        second.then(() => 'resolved', (error: unknown) => (
          error instanceof AiConfigError ? error.code : 'unexpected_error'
        )),
        new Promise<'unbounded'>((resolve) => {
          guard = setTimeout(() => resolve('unbounded'), 500);
        }),
      ]), 'AI_CONFIG_RATE_LIMITED');
    } finally {
      if (guard) clearTimeout(guard);
      release();
    }
    assert.equal((await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM ai_config_events
        WHERE status = 'denied' AND result_code = 'AI_CONFIG_RATE_LIMITED'`,
    )).rows[0].count, 1);
    assert.equal((await first).status, 'succeeded');
  });
});

test('activation rejects distinct logical targets with one runtime digest before route persistence', async () => {
  await withDatabase(async (pool) => {
    const serviceOptions = options();
    const created = await createProviderConnection(pool, {
      name: 'Gateway', baseUrl: 'https://gateway.example/v1', userAgent: null,
      apiKey: 'top-secret-key', firstModel: model,
    }, serviceOptions);
    const duplicate = await createProviderModel(
      pool,
      created.connectionSeriesId,
      model,
      serviceOptions,
    );
    await testProviderModel(pool, created.modelSeriesId, serviceOptions);
    await assert.rejects(
      activateProviderRoute(pool, {
        expectedActiveRevision: 0,
        targets: [
          { source: 'database', modelId: created.modelSeriesId },
          { source: 'database', modelId: duplicate.modelSeriesId },
        ],
      }, serviceOptions),
      (error: unknown) => error instanceof AiConfigError && error.code === 'AI_CONFIG_INVALID',
    );
    const revisions = await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM ai_route_revisions',
    );
    assert.equal(revisions.rows[0].count, 0);
  });
});

test('activation verifies database targets against the active master key before persistence', async () => {
  await withDatabase(async (pool) => {
    const serviceOptions = options();
    const created = await createProviderConnection(pool, {
      name: 'Gateway', baseUrl: 'https://gateway.example/v1', userAgent: null,
      apiKey: 'top-secret-key', firstModel: model,
    }, serviceOptions);
    await testProviderModel(pool, created.modelSeriesId, serviceOptions);
    await activateProviderRoute(pool, {
      expectedActiveRevision: 0,
      targets: [{ source: 'database', modelId: created.modelSeriesId }],
    }, serviceOptions);

    await assert.rejects(
      activateProviderRoute(pool, {
        expectedActiveRevision: 1,
        targets: [{ source: 'database', modelId: created.modelSeriesId }],
      }, options({ configKey: { key: Buffer.alloc(32, 42), keyVersion: 2 } })),
      (error: unknown) => error instanceof AiConfigError
        && error.code === 'AI_CONFIG_SECRET_UNAVAILABLE',
    );
    const revisions = await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM ai_route_revisions',
    );
    assert.equal(revisions.rows[0].count, 1);
  });
});

test('only the immediately previous route receives the rollback test-window exemption', async () => {
  await withDatabase(async (pool) => {
    const base = new Date();
    let operationNow = base;
    const serviceOptions = options({ now: () => operationNow });
    const created = await createProviderConnection(pool, {
      name: 'Gateway', baseUrl: 'https://gateway.example/v1', userAgent: null,
      apiKey: 'top-secret-key', firstModel: model,
    }, serviceOptions);
    const second = await createProviderModel(pool, created.connectionSeriesId, {
      ...model, displayName: 'Second model', modelId: 'second-model',
    }, serviceOptions);
    const third = await createProviderModel(pool, created.connectionSeriesId, {
      ...model, displayName: 'Third model', modelId: 'third-model',
    }, serviceOptions);

    await insertSuccessfulModelTest(pool, created.modelSeriesId, base);
    operationNow = new Date(base.getTime() + 29 * 60_000);
    await activateProviderRoute(pool, {
      expectedActiveRevision: 0,
      targets: [{ source: 'database', modelId: created.modelSeriesId }],
    }, serviceOptions);

    await insertSuccessfulModelTest(pool, second.modelSeriesId, new Date(operationNow.getTime() + 1_000));
    operationNow = new Date(operationNow.getTime() + 2_000);
    await activateProviderRoute(pool, {
      expectedActiveRevision: 1,
      targets: [{ source: 'database', modelId: second.modelSeriesId }],
    }, serviceOptions);

    await insertSuccessfulModelTest(pool, third.modelSeriesId, new Date(operationNow.getTime() + 1_000));
    operationNow = new Date(operationNow.getTime() + 2_000);
    await activateProviderRoute(pool, {
      expectedActiveRevision: 2,
      targets: [{ source: 'database', modelId: third.modelSeriesId }],
    }, serviceOptions);

    operationNow = new Date(base.getTime() + 31 * 60_000);
    await assert.rejects(
      activateProviderRoute(pool, {
        expectedActiveRevision: 3,
        targets: [{ source: 'database', modelId: created.modelSeriesId }],
      }, serviceOptions),
      (error: unknown) => error instanceof AiConfigError && error.code === 'AI_CONFIG_TEST_REQUIRED',
    );
  });
});
