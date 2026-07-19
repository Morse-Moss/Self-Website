import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { NextRequest } from 'next/server.js';
import pg from 'pg';

import { authenticateSession, redeemInvite } from '../lib/server/access.ts';
import { generateTotp } from '../lib/server/admin-auth.ts';
import { ChatServiceError, runChat } from '../lib/server/chat-service.ts';
import { hashSecret } from '../lib/server/security.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const allowedOrigin = 'https://portfolio.example';
const totpSecret = 'JBSWY3DPEHPK3PXP';
const adminToken = `admin-invites-${randomUUID()}`;
const adminCookie = `morse_admin=${adminToken}`;

let database: Awaited<ReturnType<typeof createDisposablePostgresDatabase>>;
let pool: InstanceType<typeof Pool>;

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

async function loadInviteFeature() {
  try {
    const [service, collectionRoute, itemRoute] = await Promise.all([
      import('../lib/server/admin-invites.ts'),
      import('../app/api/admin/invites/route.ts'),
      import('../app/api/admin/invites/[inviteId]/route.ts'),
    ]);
    return { service, collectionRoute, itemRoute };
  } catch (error) {
    assert.fail(
      `Admin invite management modules must exist: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertNoStore(response: Response): void {
  assert.equal(response.headers.get('cache-control'), 'no-store');
}

before(async () => {
  database = await createDisposablePostgresDatabase();
  await runMigrations(database.connectionString);
  pool = new Pool({ connectionString: database.connectionString });

  process.env.DATABASE_URL = database.connectionString;
  process.env.MORSE_ADMIN_PASSWORD_HASH = 'configured-but-unused';
  process.env.MORSE_ADMIN_TOTP_SECRET = totpSecret;
  process.env.MORSE_ADMIN_ALLOWED_ORIGIN = allowedOrigin;
  process.env.MORSE_ADMIN_SESSION_MINUTES = '30';
  process.env.MORSE_ADMIN_MAX_FAILED_ATTEMPTS = '5';
  process.env.MORSE_ADMIN_LOCK_MINUTES = '15';

  const createdAt = new Date();
  await pool.query(
    `INSERT INTO admin_sessions
      (id, token_hash, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $3, $3, $4)`,
    [
      randomUUID(),
      createHash('sha256').update(adminToken, 'utf8').digest('hex'),
      createdAt,
      new Date(createdAt.getTime() + 30 * 60_000),
    ],
  );
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

test('admin invite APIs reject unauthenticated requests without caching them', async () => {
  const { collectionRoute, itemRoute } = await loadInviteFeature();
  const inviteId = randomUUID();
  const responses = [
    await collectionRoute.GET(request('/api/admin/invites')),
    await collectionRoute.POST(request('/api/admin/invites', {
      method: 'POST',
      origin: allowedOrigin,
      body: { label: 'HR', durationHours: 72, maxSessions: 3, totpCode: '000000' },
    })),
    await itemRoute.PATCH(request(`/api/admin/invites/${inviteId}`, {
      method: 'PATCH',
      origin: allowedOrigin,
      body: { active: false },
    }), { params: Promise.resolve({ inviteId }) }),
  ];

  for (const response of responses) {
    assert.equal(response.status, 401);
    assertNoStore(response);
  }
});

test('admin invite mutations require the exact configured Origin', async () => {
  const { collectionRoute, itemRoute } = await loadInviteFeature();
  const inviteId = randomUUID();

  for (const origin of [undefined, 'https://attacker.example']) {
    const created = await collectionRoute.POST(request('/api/admin/invites', {
      method: 'POST',
      cookie: adminCookie,
      origin,
      body: { label: 'HR', durationHours: 72, maxSessions: 3, totpCode: '000000' },
    }));
    assert.equal(created.status, 403);
    assertNoStore(created);

    const patched = await itemRoute.PATCH(request(`/api/admin/invites/${inviteId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      origin,
      body: { active: false },
    }), { params: Promise.resolve({ inviteId }) });
    assert.equal(patched.status, 403);
    assertNoStore(patched);
  }
});

test('admin invite creation rejects malformed and out-of-range input before TOTP consumption', async () => {
  const { collectionRoute } = await loadInviteFeature();
  const valid = { label: 'HR interview', durationHours: 72, maxSessions: 3, totpCode: '000000' };
  const invalidBodies = [
    null,
    'invalid',
    { ...valid, label: '' },
    { ...valid, label: 'x'.repeat(81) },
    { ...valid, durationHours: 0 },
    { ...valid, durationHours: 721 },
    { ...valid, durationHours: 1.5 },
    { ...valid, maxSessions: 0 },
    { ...valid, maxSessions: 101 },
    { ...valid, maxSessions: 1.5 },
    { ...valid, totpCode: '12345' },
  ];

  for (const body of invalidBodies) {
    const response = await collectionRoute.POST(request('/api/admin/invites', {
      method: 'POST',
      cookie: adminCookie,
      origin: allowedOrigin,
      body,
    }));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(await response.json(), { ok: false, error: 'INVALID_ADMIN_INVITE' });
    assertNoStore(response);
  }

  const securityState = await pool.query('SELECT 1 FROM admin_security_state');
  assert.equal(securityState.rowCount, 0);
});

test('fresh TOTP creates one high-entropy invite while retaining only its SHA-256 hash', async () => {
  const { collectionRoute } = await loadInviteFeature();
  const totpCode = generateTotp(totpSecret, Date.now());
  const response = await collectionRoute.POST(request('/api/admin/invites', {
    method: 'POST',
    cookie: adminCookie,
    origin: allowedOrigin,
    body: { label: '  HR interview  ', durationHours: 72, maxSessions: 3, totpCode },
  }));

  assert.equal(response.status, 201);
  assertNoStore(response);
  const payload = await response.json() as {
    code: string;
    invite: {
      id: string;
      label: string;
      status: string;
      maxSessions: number;
      sessionCount: number;
    };
  };
  assert.match(payload.code, /^morse_[A-Za-z0-9_-]{32}$/u);
  assert.equal(Buffer.from(payload.code.slice('morse_'.length), 'base64url').length, 24);
  assert.equal(payload.invite.label, 'HR interview');
  assert.equal(payload.invite.status, 'active');
  assert.equal(payload.invite.maxSessions, 3);
  assert.equal(payload.invite.sessionCount, 0);

  const stored = await pool.query<{ code_hash: string; row_text: string }>(
    `SELECT code_hash, row_to_json(invite_codes)::text AS row_text
       FROM invite_codes
      WHERE id = $1`,
    [payload.invite.id],
  );
  assert.equal(stored.rows[0].code_hash, hashSecret(payload.code));
  assert.notEqual(stored.rows[0].code_hash, payload.code);
  assert.doesNotMatch(stored.rows[0].row_text, new RegExp(payload.code, 'u'));

  const replayed = await collectionRoute.POST(request('/api/admin/invites', {
    method: 'POST',
    cookie: adminCookie,
    origin: allowedOrigin,
    body: { label: 'replay', durationHours: 72, maxSessions: 3, totpCode },
  }));
  assert.equal(replayed.status, 401);
  assert.deepEqual(await replayed.json(), { ok: false, error: 'ADMIN_TOTP_REQUIRED' });
  assertNoStore(replayed);
  const replayRows = await pool.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM invite_codes WHERE label = 'replay'",
  );
  assert.equal(replayRows.rows[0].count, 0);
});

test('invite listing exposes metadata and derived states without hashes or plaintext codes', async () => {
  const { collectionRoute } = await loadInviteFeature();
  const now = new Date();
  const fixtures = [
    { id: randomUUID(), label: 'expired', active: true, expiresAt: new Date(now.getTime() - 1), max: 3, count: 0 },
    { id: randomUUID(), label: 'exhausted', active: true, expiresAt: new Date(now.getTime() + 60_000), max: 2, count: 2 },
    { id: randomUUID(), label: 'inactive', active: false, expiresAt: new Date(now.getTime() + 60_000), max: 3, count: 0 },
  ];
  for (const fixture of fixtures) {
    await pool.query(
      `INSERT INTO invite_codes
        (id, code_hash, label, active, expires_at, max_sessions, session_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        fixture.id,
        hashSecret(`fixture-${fixture.id}`),
        fixture.label,
        fixture.active,
        fixture.expiresAt,
        fixture.max,
        fixture.count,
      ],
    );
  }

  const response = await collectionRoute.GET(request('/api/admin/invites', { cookie: adminCookie }));
  assert.equal(response.status, 200);
  assertNoStore(response);
  const payload = await response.json() as { items: Array<Record<string, unknown>> };
  const byId = new Map(payload.items.map((item) => [item.id, item]));
  assert.equal(byId.get(fixtures[0].id)?.status, 'expired');
  assert.equal(byId.get(fixtures[1].id)?.status, 'exhausted');
  assert.equal(byId.get(fixtures[2].id)?.status, 'inactive');

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /code_hash|codeHash/iu);
  assert.ok(payload.items.every((item) => !Object.hasOwn(item, 'code')));
});

test('deactivation blocks new redemption but preserves an already authenticated visitor session', async () => {
  const { service, itemRoute } = await loadInviteFeature();
  const created = await service.createAdminInvite(
    pool,
    { label: 'existing visitor', durationHours: 72, maxSessions: 3 },
  );
  const redeemed = await redeemInvite(pool, created.code, { sessionHours: 12 });

  const response = await itemRoute.PATCH(request(`/api/admin/invites/${created.invite.id}`, {
    method: 'PATCH',
    cookie: adminCookie,
    origin: allowedOrigin,
    body: { active: false },
  }), { params: Promise.resolve({ inviteId: created.invite.id }) });
  assert.equal(response.status, 200);
  assertNoStore(response);
  assert.equal((await response.json() as { status: string }).status, 'inactive');

  await assert.rejects(
    () => redeemInvite(pool, created.code, { sessionHours: 12 }),
    /INVITE_UNAVAILABLE/u,
  );
  assert.equal((await authenticateSession(pool, redeemed.token))?.id, redeemed.sessionId);

  let embedCalls = 0;
  const provider = {
    async embed(): Promise<number[][]> {
      embedCalls += 1;
      throw new Error('probe stops after session reservation');
    },
    async *streamAnswer(): AsyncIterable<never> {
      throw new Error('answer must not run');
    },
  };
  await assert.rejects(async () => {
    for await (const _event of runChat({
      pool,
      provider,
      accessSessionId: redeemed.sessionId,
      request: {
        message: 'Can this existing visitor still ask a question?',
        mode: 'general',
        audienceIntent: 'recruiter',
        conversationId: null,
        turnId: null,
      },
      config: {
        maxMessagesPerSession: 30,
        historyMessageLimit: 12,
        retrievalLimit: 3,
        interactionRetentionDays: 10,
        tokenRates: null,
      },
    })) {
      // The probe provider fails after reservation; reaching it proves the session stayed usable.
    }
  }, (error: unknown) => error instanceof ChatServiceError && error.code === 'RETRIEVAL_UNAVAILABLE');
  assert.equal(embedCalls, 1);
});

test('invite deactivation rejects unsupported updates and unknown records', async () => {
  const { itemRoute } = await loadInviteFeature();
  const inviteId = randomUUID();
  const invalid = await itemRoute.PATCH(request(`/api/admin/invites/${inviteId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    origin: allowedOrigin,
    body: { active: true },
  }), { params: Promise.resolve({ inviteId }) });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { ok: false, error: 'INVALID_ADMIN_INVITE_UPDATE' });
  assertNoStore(invalid);

  const nullBody = await itemRoute.PATCH(request(`/api/admin/invites/${inviteId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    origin: allowedOrigin,
    body: null,
  }), { params: Promise.resolve({ inviteId }) });
  assert.equal(nullBody.status, 400);
  assert.deepEqual(await nullBody.json(), { ok: false, error: 'INVALID_ADMIN_INVITE_UPDATE' });
  assertNoStore(nullBody);

  const missing = await itemRoute.PATCH(request(`/api/admin/invites/${inviteId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    origin: allowedOrigin,
    body: { active: false },
  }), { params: Promise.resolve({ inviteId }) });
  assert.equal(missing.status, 404);
  assertNoStore(missing);
});
