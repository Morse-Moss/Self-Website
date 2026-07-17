import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { NextRequest } from 'next/server.js';
import pg from 'pg';

import { generateTotp, hashAdminPassword } from '../lib/server/admin-auth.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const allowedOrigin = 'https://portfolio.example';
const password = 'correct horse battery staple';
const totpSecret = 'JBSWY3DPEHPK3PXP';

let database: Awaited<ReturnType<typeof createDisposablePostgresDatabase>>;
let pool: InstanceType<typeof Pool>;
let sessionRoute: typeof import('../app/api/admin/session/route.ts');
let turnsRoute: typeof import('../app/api/admin/turns/route.ts');
let turnRoute: typeof import('../app/api/admin/turns/[turnId]/route.ts');
let exportRoute: typeof import('../app/api/admin/export/route.ts');
let turnId = '';

async function runMigrations(connectionString: string): Promise<void> {
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [migrationRunner], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
}

function request(
  pathname: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    origin?: string;
  } = {},
): NextRequest {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.origin) headers.set('origin', options.origin);
  return new NextRequest(`https://portfolio.example${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/(?:^|,\s*)(morse_admin=[^;]+)/u);
  assert.ok(match, setCookie);
  return match[1];
}

async function nextUnusedTotp(): Promise<string> {
  const state = await pool.query<{ last_totp_counter: string }>(
    "SELECT last_totp_counter::text FROM admin_security_state WHERE id = 'admin-login'",
  );
  const nextCounter = Number(state.rows[0].last_totp_counter) + 1;
  return generateTotp(totpSecret, nextCounter * 30_000 + 1);
}

before(async () => {
  database = await createDisposablePostgresDatabase();
  await runMigrations(database.connectionString);
  pool = new Pool({ connectionString: database.connectionString });

  process.env.DATABASE_URL = database.connectionString;
  process.env.MORSE_ADMIN_PASSWORD_HASH = await hashAdminPassword(password);
  process.env.MORSE_ADMIN_TOTP_SECRET = totpSecret;
  process.env.MORSE_ADMIN_ALLOWED_ORIGIN = allowedOrigin;
  process.env.MORSE_ADMIN_SESSION_MINUTES = '30';
  process.env.MORSE_ADMIN_MAX_FAILED_ATTEMPTS = '5';
  process.env.MORSE_ADMIN_LOCK_MINUTES = '15';

  turnId = randomUUID();
  const createdAt = new Date();
  await pool.query(
    `INSERT INTO interaction_turns
      (id, access_session_id, conversation_id, workflow, audience_intent,
       question, answer, status, knowledge_sources, input_tokens, output_tokens,
       estimated_cost_usd, provider, model, latency_ms, used_search,
       created_at, completed_at, delete_after)
     VALUES ($1, $2, $3, 'chat', 'general', '=unsafe question', 'safe answer',
             'completed', $4::jsonb, 100, 20, 0.00014, 'openai', 'configured-model',
             120, false, $5, $5, $6)`,
    [
      turnId,
      randomUUID(),
      randomUUID(),
      JSON.stringify([{
        id: 'local-1',
        title: 'Public evidence',
        href: '/works/deep-research',
        kind: 'local',
        domain: null,
        score: 0.8,
      }]),
      createdAt,
      new Date(createdAt.getTime() + 10 * 24 * 60 * 60 * 1_000),
    ],
  );

  sessionRoute = await import('../app/api/admin/session/route.ts');
  turnsRoute = await import('../app/api/admin/turns/route.ts');
  turnRoute = await import('../app/api/admin/turns/[turnId]/route.ts');
  exportRoute = await import('../app/api/admin/export/route.ts');
});

after(async () => {
  const globalDatabase = globalThis as typeof globalThis & { morseDatabasePool?: InstanceType<typeof Pool> };
  await globalDatabase.morseDatabasePool?.end();
  delete globalDatabase.morseDatabasePool;
  await pool?.end();
  await database?.dispose();
  for (const key of [
    'DATABASE_URL',
    'MORSE_ADMIN_PASSWORD_HASH',
    'MORSE_ADMIN_TOTP_SECRET',
    'MORSE_ADMIN_ALLOWED_ORIGIN',
    'MORSE_ADMIN_SESSION_MINUTES',
    'MORSE_ADMIN_MAX_FAILED_ATTEMPTS',
    'MORSE_ADMIN_LOCK_MINUTES',
  ]) delete process.env[key];
});

test('visitor cookie and missing admin cookie cannot access any admin record API', async () => {
  for (const cookie of ['', 'morse_access=visitor-only-token']) {
    const list = await turnsRoute.GET(request('/api/admin/turns', { cookie }));
    assert.equal(list.status, 401);
    const detail = await turnRoute.GET(request(`/api/admin/turns/${turnId}`, { cookie }), {
      params: Promise.resolve({ turnId }),
    });
    assert.equal(detail.status, 401);
  }
});

test('admin login, query, badcase, fresh-TOTP export, replay denial, and logout enforce the full route contract', async () => {
  const currentCode = generateTotp(totpSecret, Date.now());
  const badOrigin = await sessionRoute.POST(request('/api/admin/session', {
    method: 'POST',
    origin: 'https://attacker.example',
    body: { password, totpCode: currentCode },
  }));
  assert.equal(badOrigin.status, 403);

  const overrideAttempt = await sessionRoute.POST(request('/api/admin/session', {
    method: 'POST',
    origin: allowedOrigin,
    body: {
      password: 'attacker-password',
      totpCode: '000000',
      passwordHash: await hashAdminPassword('attacker-password'),
      totpSecret: 'GEZDGNBVGY3TQOJQ',
      now: '2035-01-01T00:00:00.000Z',
      policy: { maxFailedAttempts: 999 },
    },
  }));
  assert.equal(overrideAttempt.status, 401);

  const loginCode = generateTotp(totpSecret, Date.now());
  const login = await sessionRoute.POST(request('/api/admin/session', {
    method: 'POST',
    origin: allowedOrigin,
    body: { password, totpCode: loginCode },
  }));
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /morse_admin=/u);
  assert.match(setCookie, /HttpOnly/iu);
  assert.match(setCookie, /Secure/iu);
  assert.match(setCookie, /SameSite=Strict/iu);
  assert.doesNotMatch(setCookie, /(?:Expires|Max-Age)=/iu);
  const cookie = cookieFrom(login);

  const list = await turnsRoute.GET(request('/api/admin/turns?workflow=chat&limit=20', { cookie }));
  assert.equal(list.status, 200);
  const listed = await list.json() as { total: number; items: Array<{ id: string; question: string }> };
  assert.equal(listed.total, 1);
  assert.deepEqual(listed.items.map((item) => item.id), [turnId]);
  assert.equal(listed.items[0].question, '=unsafe question');

  const detail = await turnRoute.GET(request(`/api/admin/turns/${turnId}`, { cookie }), {
    params: Promise.resolve({ turnId }),
  });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json() as { id: string }).id, turnId);

  const missingOrigin = await turnRoute.PATCH(request(`/api/admin/turns/${turnId}`, {
    method: 'PATCH',
    cookie,
    body: { badcase: true, note: 'needs review' },
  }), { params: Promise.resolve({ turnId }) });
  assert.equal(missingOrigin.status, 403);

  const updated = await turnRoute.PATCH(request(`/api/admin/turns/${turnId}`, {
    method: 'PATCH',
    cookie,
    origin: allowedOrigin,
    body: { badcase: true, note: ' needs review ' },
  }), { params: Promise.resolve({ turnId }) });
  assert.equal(updated.status, 200);
  assert.deepEqual(
    await updated.json() as { badcase: boolean; adminNote: string },
    { badcase: true, adminNote: 'needs review' },
  );

  const exportCode = await nextUnusedTotp();
  const exported = await exportRoute.POST(request('/api/admin/export', {
    method: 'POST',
    cookie,
    origin: allowedOrigin,
    body: { format: 'csv', totpCode: exportCode, filters: { workflow: 'chat' } },
  }));
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-type') ?? '', /text\/csv/iu);
  assert.match(exported.headers.get('content-disposition') ?? '', /attachment/iu);
  const bytes = new Uint8Array(await exported.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder().decode(bytes);
  assert.match(csv, /"'=unsafe question"/u);
  assert.doesNotMatch(csv, /apiKey|cookie|providerRawPayload|sessionToken|tokenHash/iu);

  const replayed = await exportRoute.POST(request('/api/admin/export', {
    method: 'POST',
    cookie,
    origin: allowedOrigin,
    body: { format: 'json', totpCode: exportCode, filters: {} },
  }));
  assert.equal(replayed.status, 401);

  const logout = await sessionRoute.DELETE(request('/api/admin/session', {
    method: 'DELETE',
    cookie,
    origin: allowedOrigin,
  }));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/iu);
  assert.equal((await turnsRoute.GET(request('/api/admin/turns', { cookie }))).status, 401);
});
