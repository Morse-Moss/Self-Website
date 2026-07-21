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
    OPENAI_API_KEY: 'environment-key',
    OPENAI_BASE_URL: 'https://environment.example/v1',
    OPENAI_CHAT_MODEL: 'gpt-environment',
    OPENAI_CHAT_PROTOCOL: 'responses',
    OPENAI_EMBEDDING_MODEL: 'embedding-model',
  });
  [sessionRoute, runtimeRoute, providersRoute, eventsRoute, activateRoute, modelTestRoute] = await Promise.all([
    import('../app/api/admin/session/route.ts'),
    import('../app/api/admin/providers/runtime/route.ts'),
    import('../app/api/admin/providers/route.ts'),
    import('../app/api/admin/providers/events/route.ts'),
    import('../app/api/admin/providers/routes/activate/route.ts'),
    import('../app/api/admin/providers/models/[modelId]/test/route.ts'),
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
    'MORSE_PROVIDER_CONFIG_KEY_VERSION', 'OPENAI_API_KEY', 'OPENAI_BASE_URL',
    'OPENAI_CHAT_MODEL', 'OPENAI_CHAT_PROTOCOL', 'OPENAI_EMBEDDING_MODEL',
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
