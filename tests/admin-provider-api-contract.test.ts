import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { NextRequest } from 'next/server.js';
import pg from 'pg';

import { hashAdminPassword } from '../lib/server/admin-auth.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const allowedOrigin = 'https://portfolio.example';
const password = 'correct horse battery staple';
const modelId = '11111111-1111-4111-8111-111111111111';
const routePaths = [
  'app/api/admin/providers/runtime/route.ts',
  'app/api/admin/providers/route.ts',
  'app/api/admin/providers/[connectionId]/route.ts',
  'app/api/admin/providers/[connectionId]/models/route.ts',
  'app/api/admin/providers/[connectionId]/discover/route.ts',
  'app/api/admin/providers/models/[modelId]/route.ts',
  'app/api/admin/providers/models/[modelId]/test/route.ts',
  'app/api/admin/providers/runtime/environment/[targetKey]/test/route.ts',
  'app/api/admin/providers/runtime/environment/[targetKey]/takeover/route.ts',
  'app/api/admin/providers/routes/activate/route.ts',
  'app/api/admin/providers/events/route.ts',
] as const;

let database: Awaited<ReturnType<typeof createDisposablePostgresDatabase>>;
let pool: InstanceType<typeof Pool>;
let sessionRoute: typeof import('../app/api/admin/session/route.ts');
let runtimeRoute: typeof import('../app/api/admin/providers/runtime/route.ts');
let providersRoute: typeof import('../app/api/admin/providers/route.ts');
let eventsRoute: typeof import('../app/api/admin/providers/events/route.ts');
let activateRoute: typeof import('../app/api/admin/providers/routes/activate/route.ts');
let modelTestRoute: typeof import('../app/api/admin/providers/models/[modelId]/test/route.ts');
let modelRoute: typeof import('../app/api/admin/providers/models/[modelId]/route.ts');
let takeoverRoute: typeof import('../app/api/admin/providers/runtime/environment/[targetKey]/takeover/route.ts');

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

function request(pathname: string, input: {
  body?: unknown;
  cookie?: string;
  method?: string;
  origin?: string;
} = {}): NextRequest {
  const headers = new Headers();
  if (input.body !== undefined) headers.set('content-type', 'application/json');
  if (input.cookie) headers.set('cookie', input.cookie);
  if (input.origin) headers.set('origin', input.origin);
  return new NextRequest(`${allowedOrigin}${pathname}`, {
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    headers,
    method: input.method ?? 'GET',
  });
}

function cookieFrom(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').match(/morse_admin=[^;]+/u)?.[0] ?? '';
}

before(async () => {
  database = await createDisposablePostgresDatabase();
  await migrate(database.connectionString);
  pool = new Pool({ connectionString: database.connectionString });
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: database.connectionString,
    MORSE_ADMIN_PASSWORD_HASH: await hashAdminPassword(password),
    MORSE_ADMIN_ALLOWED_ORIGIN: allowedOrigin,
    MORSE_ADMIN_SESSION_MINUTES: '30',
    MORSE_ADMIN_MAX_FAILED_ATTEMPTS: '5',
    MORSE_ADMIN_LOCK_MINUTES: '15',
    MORSE_PROVIDER_CONFIG_KEY: Buffer.alloc(32, 53).toString('base64'),
    MORSE_PROVIDER_CONFIG_KEY_VERSION: '1',
    MORSE_LOCAL_RELEASE_SMOKE: 'true',
    MORSE_PROVIDER_MOCK_ORIGIN: 'http://127.0.0.1:18092',
    OPENAI_API_KEY: 'environment-key',
    OPENAI_BASE_URL: 'https://environment.example/v1',
    OPENAI_CHAT_MODEL: 'gpt-environment',
    OPENAI_CHAT_PROTOCOL: 'responses',
    OPENAI_EMBEDDING_API_KEY: 'embedding-key',
    OPENAI_EMBEDDING_BASE_URL: 'http://127.0.0.1:18091/v1',
    OPENAI_EMBEDDING_MODEL: 'embedding-model',
    MORSE_CONTEXT_PACKET_DIGEST_KEY: Buffer.alloc(32, 1).toString('base64'),
    MORSE_CONTEXT_PACKET_DIGEST_KEY_ID: 'admin-provider-test-v1',
  });
  [
    sessionRoute,
    runtimeRoute,
    providersRoute,
    eventsRoute,
    activateRoute,
    modelTestRoute,
    modelRoute,
    takeoverRoute,
  ] = await Promise.all([
    import('../app/api/admin/session/route.ts'),
    import('../app/api/admin/providers/runtime/route.ts'),
    import('../app/api/admin/providers/route.ts'),
    import('../app/api/admin/providers/events/route.ts'),
    import('../app/api/admin/providers/routes/activate/route.ts'),
    import('../app/api/admin/providers/models/[modelId]/test/route.ts'),
    import('../app/api/admin/providers/models/[modelId]/route.ts'),
    import('../app/api/admin/providers/runtime/environment/[targetKey]/takeover/route.ts'),
  ]);
});

after(async () => {
  const globalDatabase = globalThis as typeof globalThis & { morseDatabasePool?: InstanceType<typeof Pool> };
  await globalDatabase.morseDatabasePool?.end();
  delete globalDatabase.morseDatabasePool;
  await pool?.end();
  await database?.dispose();
  for (const key of [
    'DATABASE_URL', 'MORSE_ADMIN_PASSWORD_HASH', 'MORSE_ADMIN_ALLOWED_ORIGIN',
    'MORSE_ADMIN_SESSION_MINUTES', 'MORSE_ADMIN_MAX_FAILED_ATTEMPTS',
    'MORSE_ADMIN_LOCK_MINUTES', 'MORSE_PROVIDER_CONFIG_KEY',
    'MORSE_PROVIDER_CONFIG_KEY_VERSION', 'MORSE_LOCAL_RELEASE_SMOKE',
    'MORSE_PROVIDER_MOCK_ORIGIN', 'OPENAI_API_KEY', 'OPENAI_BASE_URL',
    'OPENAI_CHAT_MODEL', 'OPENAI_CHAT_PROTOCOL', 'OPENAI_EMBEDDING_API_KEY',
    'OPENAI_EMBEDDING_BASE_URL', 'OPENAI_EMBEDDING_MODEL',
    'MORSE_CONTEXT_PACKET_DIGEST_KEY', 'MORSE_CONTEXT_PACKET_DIGEST_KEY_ID',
  ]) delete process.env[key];
});

test('all provider routes are node-only, private, strict, and reuse shared admin security', () => {
  for (const routePath of routePaths) {
    const source = fs.readFileSync(path.resolve(routePath), 'utf8');
    assert.match(source, /export const runtime = 'nodejs'/u, routePath);
    assert.match(source, /requireAdmin/u, routePath);
    assert.doesNotMatch(source, /apiKey.*NextResponse|Authorization.*NextResponse/iu, routePath);
  }
  const shared = fs.readFileSync(path.resolve('app/api/admin/_shared.ts'), 'utf8');
  assert.match(shared, /reauthenticateAdminPassword/u);
  assert.match(shared, /Cache-Control.*no-store/su);
  assert.match(shared, /AI_CONFIG_RATE_LIMITED/u);
  const takeover = fs.readFileSync(path.resolve(
    'app/api/admin/providers/runtime/environment/[targetKey]/takeover/route.ts',
  ), 'utf8');
  assert.match(takeover, /isEnvironmentTargetKey/u);
  assert.doesNotMatch(takeover, /targetKey as/u);
});

test('visitor access is rejected and authenticated read responses are no-store and redacted', async () => {
  for (const response of [
    await runtimeRoute.GET(request('/api/admin/providers/runtime')),
    await providersRoute.GET(request('/api/admin/providers')),
    await eventsRoute.GET(request('/api/admin/providers/events')),
  ]) {
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }

  const login = await sessionRoute.POST(request('/api/admin/session', {
    body: { password }, method: 'POST', origin: allowedOrigin,
  }));
  const cookie = cookieFrom(login);
  assert.ok(cookie);
  const runtime = await runtimeRoute.GET(request('/api/admin/providers/runtime', { cookie }));
  assert.equal(runtime.status, 200);
  assert.equal(runtime.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await runtime.text(), /environment-key|apiKey|authorization/iu);
  const catalog = await providersRoute.GET(request('/api/admin/providers?page=1&limit=25', { cookie }));
  assert.equal(catalog.status, 200);
  assert.equal(catalog.headers.get('cache-control'), 'no-store');
  const invalidQuery = await eventsRoute.GET(request('/api/admin/providers/events?secret=true', { cookie }));
  assert.equal(invalidQuery.status, 400);
});

test('mutations and Provider operations enforce Origin, strict bodies, and password reauth before work', async () => {
  const login = await sessionRoute.POST(request('/api/admin/session', {
    body: { password }, method: 'POST', origin: allowedOrigin,
  }));
  const cookie = cookieFrom(login);
  const createBody = {
    name: 'Gateway',
    baseUrl: 'https://gateway.example/v1',
    apiKey: 'must-not-leak',
    firstModel: {
      displayName: 'Model', modelId: 'gpt-model', protocol: 'responses',
      reasoningEffort: null, maxOutputTokens: 32,
      inputUsdPerMillion: null, outputUsdPerMillion: null,
    },
    password,
  };
  const missingOrigin = await providersRoute.POST(request('/api/admin/providers', {
    body: createBody, cookie, method: 'POST',
  }));
  assert.equal(missingOrigin.status, 403);
  const wrongPassword = await providersRoute.POST(request('/api/admin/providers', {
    body: { ...createBody, password: 'wrong' }, cookie, method: 'POST', origin: allowedOrigin,
  }));
  assert.equal(wrongPassword.status, 401);
  assert.doesNotMatch(await wrongPassword.text(), /must-not-leak/iu);
  const unknown = await activateRoute.POST(request('/api/admin/providers/routes/activate', {
    body: { expectedActiveRevision: 0, targets: [], password, force: true },
    cookie, method: 'POST', origin: allowedOrigin,
  }));
  assert.equal(unknown.status, 400);
  const testRejected = await modelTestRoute.POST(request(`/api/admin/providers/models/${modelId}/test`, {
    body: { password: 'wrong' }, cookie, method: 'POST', origin: allowedOrigin,
  }), { params: Promise.resolve({ modelId }) });
  assert.equal(testRejected.status, 401);
  assert.equal(testRejected.headers.get('cache-control'), 'no-store');
});

test('an unavailable provider master key is a redacted 503', async () => {
  const login = await sessionRoute.POST(request('/api/admin/session', {
    body: { password }, method: 'POST', origin: allowedOrigin,
  }));
  const cookie = cookieFrom(login);
  const configuredKey = process.env.MORSE_PROVIDER_CONFIG_KEY;
  delete process.env.MORSE_PROVIDER_CONFIG_KEY;
  try {
    const response = await runtimeRoute.GET(request('/api/admin/providers/runtime', { cookie }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: 'AI_CONFIG_UNAVAILABLE' });
  } finally {
    process.env.MORSE_PROVIDER_CONFIG_KEY = configuredKey;
  }
});

test('environment takeover API is authenticated, replayable, conflict-safe, and fully redacted', async () => {
  const login = await sessionRoute.POST(request('/api/admin/session', {
    body: { password }, method: 'POST', origin: allowedOrigin,
  }));
  const cookie = cookieFrom(login);
  assert.ok(cookie);
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalBaseUrl = process.env.OPENAI_BASE_URL;
  const inheritedKey = 'environment-inherited-zq7x';
  const changedInheritedKey = 'environment-changed-wk8z';
  const submittedKey = 'submitted-private-jv9q';
  const configuredUrl = 'https://environment.example/v1/private-path-rk9w';
  const unsafeConfiguredUrl = `${configuredUrl}?token=query-secret-pm7v`;
  const evidence: string[] = [];
  const capturedLogs: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => { capturedLogs.push(args.map(String).join(' ')); };
  console.warn = (...args: unknown[]) => { capturedLogs.push(args.map(String).join(' ')); };
  process.env.OPENAI_API_KEY = inheritedKey;
  process.env.OPENAI_BASE_URL = configuredUrl;

  const firstRequestId = '22222222-2222-4222-8222-222222222221';
  const secondRequestId = '22222222-2222-4222-8222-222222222222';
  const thirdRequestId = '22222222-2222-4222-8222-222222222223';
  const fourthRequestId = '22222222-2222-4222-8222-222222222224';
  const model = {
    displayName: 'Editable API model',
    inputUsdPerMillion: null,
    maxOutputTokens: 1200,
    modelId: 'gpt-editable-api',
    outputUsdPerMillion: null,
    protocol: 'responses',
    reasoningEffort: 'high',
  };

  async function responseText(response: Response): Promise<string> {
    const text = await response.text();
    evidence.push(text);
    return text;
  }

  async function takeover(
    targetKey: string,
    body: Record<string, unknown>,
    input: { cookie?: string; origin?: string } = { cookie, origin: allowedOrigin },
  ) {
    return takeoverRoute.POST(request(
      `/api/admin/providers/runtime/environment/${targetKey}/takeover`,
      {
        body,
        cookie: input.cookie,
        method: 'POST',
        origin: input.origin,
      },
    ), { params: Promise.resolve({ targetKey }) });
  }

  async function draftCounts() {
    return (await pool.query<{
      connections: number;
      models: number;
      takeovers: number;
    }>(`SELECT
      (SELECT count(*) FROM ai_connections)::integer AS connections,
      (SELECT count(*) FROM ai_model_presets)::integer AS models,
      (SELECT count(*) FROM ai_environment_takeovers)::integer AS takeovers`)).rows[0];
  }

  let encryptedNeedles: string[] = [];
  try {
    const runtimeResponse = await runtimeRoute.GET(request('/api/admin/providers/runtime', { cookie }));
    const runtimeText = await responseText(runtimeResponse);
    const runtime = JSON.parse(runtimeText) as {
      environmentTargets: Array<{
        baseUrlMode: string;
        configDigest: string;
        environmentTargetKey: string;
      }>;
    };
    const primary = runtime.environmentTargets.find(
      (target) => target.environmentTargetKey === 'primary',
    );
    assert.ok(primary);
    assert.equal(primary.baseUrlMode, 'server_reusable');
    const validBody = {
      apiKey: submittedKey,
      baseUrl: null,
      expectedConfigDigest: primary.configDigest,
      firstModel: model,
      name: 'Editable API primary',
      password,
      requestId: firstRequestId,
      reuseKeyAcrossOrigin: false,
      userAgent: 'Morse/API',
    };

    const unauthenticated = await takeover('primary', validBody, { origin: allowedOrigin });
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get('cache-control'), 'no-store');
    await responseText(unauthenticated);
    const missingOrigin = await takeover('primary', validBody, { cookie });
    assert.equal(missingOrigin.status, 403);
    await responseText(missingOrigin);
    const wrongOrigin = await takeover('primary', validBody, {
      cookie,
      origin: 'https://wrong-origin.example',
    });
    assert.equal(wrongOrigin.status, 403);
    await responseText(wrongOrigin);
    const wrongPassword = await takeover('primary', { ...validBody, password: 'wrong' });
    assert.equal(wrongPassword.status, 401);
    await responseText(wrongPassword);
    assert.deepEqual(await draftCounts(), { connections: 0, models: 0, takeovers: 0 });

    const unknownBody = await takeover('primary', { ...validBody, unexpected: true });
    assert.equal(unknownBody.status, 400);
    await responseText(unknownBody);
    const invalidTarget = await takeover('fallback-9', validBody);
    assert.equal(invalidTarget.status, 400);
    await responseText(invalidTarget);

    process.env.OPENAI_API_KEY = changedInheritedKey;
    const changed = await takeover('primary', validBody);
    assert.equal(changed.status, 409);
    assert.deepEqual(JSON.parse(await responseText(changed)), {
      error: 'AI_CONFIG_ENVIRONMENT_CHANGED',
      ok: false,
    });
    process.env.OPENAI_API_KEY = inheritedKey;

    const created = await takeover('primary', validBody);
    assert.equal(created.status, 200);
    assert.equal(created.headers.get('cache-control'), 'no-store');
    const createdText = await responseText(created);
    const createdBody = JSON.parse(createdText) as {
      connectionSeriesId: string;
      connectionVersion: number;
      modelSeriesId: string;
      modelVersion: number;
      takeoverId: string;
    };
    assert.deepEqual(Object.keys(createdBody), [
      'connectionSeriesId',
      'connectionVersion',
      'modelSeriesId',
      'modelVersion',
      'takeoverId',
    ]);
    assert.equal(createdBody.connectionVersion, 1);
    assert.equal(createdBody.modelVersion, 1);
    const afterCreate = await draftCounts();
    assert.deepEqual(afterCreate, { connections: 1, models: 1, takeovers: 1 });

    const replay = await takeover('primary', validBody);
    assert.equal(replay.status, 200);
    const replayText = await responseText(replay);
    assert.equal(replayText, createdText);
    assert.deepEqual(await draftCounts(), afterCreate);

    const conflict = await takeover('primary', { ...validBody, requestId: secondRequestId });
    assert.equal(conflict.status, 409);
    assert.deepEqual(JSON.parse(await responseText(conflict)), {
      error: 'AI_CONFIG_TAKEOVER_EXISTS',
      ok: false,
    });
    assert.deepEqual(await draftCounts(), afterCreate);

    const unavailable = await takeover('fallback-2', {
      ...validBody,
      expectedConfigDigest: 'a'.repeat(64),
      requestId: thirdRequestId,
    });
    assert.equal(unavailable.status, 503);
    assert.deepEqual(JSON.parse(await responseText(unavailable)), {
      error: 'AI_CONFIG_ENVIRONMENT_UNAVAILABLE',
      ok: false,
    });

    process.env.OPENAI_BASE_URL = unsafeConfiguredUrl;
    const unsafeRuntimeResponse = await runtimeRoute.GET(request('/api/admin/providers/runtime', { cookie }));
    const unsafeRuntimeText = await responseText(unsafeRuntimeResponse);
    const unsafeRuntime = JSON.parse(unsafeRuntimeText) as {
      environmentTargets: Array<{
        baseUrlMode: string;
        configDigest: string;
        environmentTargetKey: string;
      }>;
    };
    const unsafePrimary = unsafeRuntime.environmentTargets.find(
      (target) => target.environmentTargetKey === 'primary',
    );
    assert.ok(unsafePrimary);
    assert.equal(unsafePrimary.baseUrlMode, 'replacement_required');
    const invalidReuse = await takeover('primary', {
      ...validBody,
      expectedConfigDigest: unsafePrimary.configDigest,
      requestId: fourthRequestId,
    });
    assert.equal(invalidReuse.status, 400);
    assert.deepEqual(JSON.parse(await responseText(invalidReuse)), {
      error: 'AI_CONFIG_INVALID',
      ok: false,
    });
    assert.deepEqual(await draftCounts(), afterCreate);

    const encrypted = await pool.query<{
      ciphertext_base64: string;
      ciphertext_hex: string;
      tag_base64: string;
      tag_hex: string;
    }>(`SELECT encode(connection.api_key_ciphertext, 'base64') AS ciphertext_base64,
              encode(connection.api_key_ciphertext, 'hex') AS ciphertext_hex,
              encode(connection.api_key_tag, 'base64') AS tag_base64,
              encode(connection.api_key_tag, 'hex') AS tag_hex
         FROM ai_environment_takeovers takeover
         JOIN ai_connections connection
           ON connection.id = takeover.initial_connection_version_id
        WHERE takeover.id = $1`, [createdBody.takeoverId]);
    encryptedNeedles = Object.values(encrypted.rows[0]);
    evidence.push((await pool.query<{ raw: string }>(
      `SELECT COALESCE(json_agg(event ORDER BY id), '[]'::json)::text AS raw
         FROM ai_config_events event`,
    )).rows[0].raw);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalBaseUrl;
  }

  evidence.push(...capturedLogs);
  const serializedEvidence = evidence.join('\n');
  for (const needle of [
    inheritedKey,
    inheritedKey.slice(-4),
    changedInheritedKey,
    changedInheritedKey.slice(-4),
    submittedKey,
    submittedKey.slice(-4),
    configuredUrl,
    'private-path-rk9w',
    unsafeConfiguredUrl,
    'query-secret-pm7v',
    ...encryptedNeedles,
  ]) {
    assert.equal(serializedEvidence.includes(needle), false, `leaked sensitive value: ${needle}`);
  }
});

test('runtime identity supports exact old-snapshot reorder and explicit v2-to-v1 rollback through HTTP', async () => {
  const login = await sessionRoute.POST(request('/api/admin/session', {
    body: { password }, method: 'POST', origin: allowedOrigin,
  }));
  const cookie = cookieFrom(login);
  const create = await providersRoute.POST(request('/api/admin/providers', {
    body: {
      name: 'Versioned gateway',
      baseUrl: 'http://127.0.0.1:18092/v1',
      apiKey: 'versioned-secret',
      firstModel: {
        displayName: 'Version one', modelId: 'gpt-version-one', protocol: 'responses',
        reasoningEffort: null, maxOutputTokens: 64,
        inputUsdPerMillion: null, outputUsdPerMillion: null,
      },
      password,
    },
    cookie, method: 'POST', origin: allowedOrigin,
  }));
  assert.equal(create.status, 201);
  const created = await create.json() as { modelSeriesId: string };

  async function latestVersion() {
    return (await pool.query<{
      config_digest: string;
      id: string;
      version: number;
    }>(
      `SELECT id::text, version, config_digest FROM ai_model_presets
        WHERE series_id = $1 ORDER BY version DESC LIMIT 1`,
      [created.modelSeriesId],
    )).rows[0];
  }

  async function recordTest(version: Awaited<ReturnType<typeof latestVersion>>) {
    await pool.query(
      `INSERT INTO ai_config_events
        (event_type, model_series_id, model_version, config_digest, result_code, status, created_at, delete_after)
       VALUES ('provider_test',$1,$2,$3,'AI_CONFIG_TEST_SUCCEEDED','succeeded',now(),now() + interval '180 days')`,
      [created.modelSeriesId, version.version, version.config_digest],
    );
  }

  const v1 = await latestVersion();
  await recordTest(v1);
  const boot = await activateRoute.POST(request('/api/admin/providers/routes/activate', {
    body: {
      expectedActiveRevision: 0,
      targets: [
        { source: 'database', modelId: created.modelSeriesId, modelVersionId: v1.id },
        { source: 'environment', environmentTargetKey: 'primary' },
      ],
      password,
    },
    cookie, method: 'POST', origin: allowedOrigin,
  }));
  assert.equal(boot.status, 200);

  const updated = await modelRoute.PATCH(request(`/api/admin/providers/models/${created.modelSeriesId}`, {
    body: {
      displayName: 'Version two', modelId: 'gpt-version-two', protocol: 'responses',
      reasoningEffort: null, maxOutputTokens: 96,
      inputUsdPerMillion: null, outputUsdPerMillion: null,
      password,
    },
    cookie, method: 'PATCH', origin: allowedOrigin,
  }), { params: Promise.resolve({ modelId: created.modelSeriesId }) });
  assert.equal(updated.status, 200);
  const v2 = await latestVersion();
  await recordTest(v2);

  const runtimeResponse = await runtimeRoute.GET(request('/api/admin/providers/runtime', { cookie }));
  const runtime = await runtimeResponse.json() as {
    activeRevision: number;
    targets: Array<{ databaseModelSeriesId: string | null; databaseModelVersionId: string | null }>;
  };
  assert.equal(runtime.targets[0].databaseModelSeriesId, created.modelSeriesId);
  const reordered = await activateRoute.POST(request('/api/admin/providers/routes/activate', {
    body: {
      expectedActiveRevision: runtime.activeRevision,
      targets: [
        { source: 'environment', environmentTargetKey: 'primary' },
        {
          source: 'database',
          modelId: runtime.targets[0].databaseModelSeriesId,
          modelVersionId: runtime.targets[0].databaseModelVersionId,
        },
      ],
      password,
    },
    cookie, method: 'POST', origin: allowedOrigin,
  }));
  assert.equal(reordered.status, 200);
  const reorderedBody = await reordered.json() as { targets: Array<{ databaseModelVersionId: string | null }> };
  assert.equal(reorderedBody.targets[1].databaseModelVersionId, v1.id);

  const activateV2 = await activateRoute.POST(request('/api/admin/providers/routes/activate', {
    body: {
      expectedActiveRevision: 2,
      targets: [{ source: 'database', modelId: created.modelSeriesId, modelVersionId: v2.id }],
      password,
    },
    cookie, method: 'POST', origin: allowedOrigin,
  }));
  assert.equal(activateV2.status, 200);
  const rollback = await activateRoute.POST(request('/api/admin/providers/routes/activate', {
    body: { expectedActiveRevision: 3, rollbackToPrevious: true, password },
    cookie, method: 'POST', origin: allowedOrigin,
  }));
  assert.equal(rollback.status, 200);
  const rollbackBody = await rollback.json() as {
    routeRevisionId: string;
    targets: Array<{ databaseModelVersionId: string | null }>;
  };
  assert.equal(
    rollbackBody.targets.find((target) => target.databaseModelVersionId)?.databaseModelVersionId,
    v1.id,
  );
  const stored = await pool.query<{ activation_kind: string }>(
    'SELECT activation_kind FROM ai_route_revisions WHERE id = $1',
    [rollbackBody.routeRevisionId],
  );
  assert.equal(stored.rows[0].activation_kind, 'rollback');
});
