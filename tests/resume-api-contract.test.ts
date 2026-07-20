import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { NextRequest } from 'next/server.js';
import pg from 'pg';

import { disableResumeInvite } from '../lib/server/resume-access.ts';
import { hashSecret } from '../lib/server/security.ts';
import { writeResumeCiphertext } from '../lib/server/resume-storage.ts';
import { syntheticResumePdf } from './fixtures/synthetic-resume.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const publicOrigin = 'https://portfolio.example';
const cookieName = 'private_resume';
const encryptionKey = Buffer.alloc(32, 29);
const envKeys = [
  'NODE_ENV',
  'DATABASE_URL',
  'MORSE_PUBLIC_ORIGIN',
  'MORSE_RESUME_ENABLED',
  'MORSE_RESUME_COOKIE',
  'MORSE_RESUME_STORAGE_DIR',
  'MORSE_RESUME_ENCRYPTION_KEY',
  'MORSE_RESUME_ENCRYPTION_KEY_FILE',
  'MORSE_RESUME_KEY_VERSION',
  'MORSE_RESUME_FINGERPRINT_SECRET',
  'MORSE_RESUME_TRUSTED_PROXY_HOPS',
] as const;
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

let accessRoute: typeof import('../app/api/resume/access/route.ts');
let fileRoute: typeof import('../app/api/resume/file/route.ts');
let database: Awaited<ReturnType<typeof createDisposablePostgresDatabase>>;
let pool: InstanceType<typeof Pool>;
let storageDir: string;
let currentDocumentId: string;
let currentCipherHash: string;
let authorizedToken = '';
let redeemedCode = '';

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
    referer?: string;
  } = {},
): NextRequest {
  const headers = new Headers({
    'user-agent': 'Synthetic Resume Browser/2.0',
    'x-forwarded-for': '192.0.2.80',
    'sec-ch-ua': '"Synthetic";v="2"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Test"',
  });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.origin) headers.set('origin', options.origin);
  if (options.referer) headers.set('referer', options.referer);
  return new NextRequest(`${publicOrigin}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function createInvite(note = 'Synthetic Trusted Person'): Promise<{
  adminSessionId: string;
  code: string;
  inviteId: string;
}> {
  const adminSessionId = randomUUID();
  const code = `resume_${randomUUID()}_${randomUUID()}`;
  const inviteId = randomUUID();
  await pool.query(
    `INSERT INTO resume_invites
      (id, code_hash, trusted_person_note, expires_at, created_by_admin_session)
     VALUES ($1, $2, $3, clock_timestamp() + interval '7 days', $4)`,
    [inviteId, hashSecret(code), note, adminSessionId],
  );
  return { adminSessionId, code, inviteId };
}

function assertNoStore(response: Response): void {
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}

function assertAccessKeys(payload: Record<string, unknown>): void {
  assert.deepEqual(Object.keys(payload).sort(), [
    'authorized',
    'documentAvailable',
    'enabled',
    'expiresAt',
  ]);
}

async function redeem(code: string): Promise<{ expiresAt: string; token: string }> {
  const response = await accessRoute.POST(request('/api/resume/access', {
    method: 'POST',
    origin: publicOrigin,
    body: { code },
  }));
  assert.equal(response.status, 200);
  assertNoStore(response);
  const payload = await response.json() as Record<string, unknown>;
  assertAccessKeys(payload);
  assert.equal(payload.enabled, true);
  assert.equal(payload.authorized, true);
  assert.equal(payload.documentAvailable, true);
  assert.equal(typeof payload.expiresAt, 'string');
  const setCookie = response.headers.get('set-cookie') ?? '';
  const token = new RegExp(`${cookieName}=([^;]+)`, 'u').exec(setCookie)?.[1] ?? '';
  assert.ok(token);
  assert.match(setCookie, /HttpOnly/iu);
  assert.match(setCookie, /SameSite=strict/iu);
  assert.match(setCookie, /Path=\//u);
  return { expiresAt: String(payload.expiresAt), token };
}

before(async () => {
  database = await createDisposablePostgresDatabase();
  await runMigrations(database.connectionString);
  pool = new Pool({ connectionString: database.connectionString });
  storageDir = await mkdtemp(path.join(os.tmpdir(), 'revolution-resume-api-'));
  const stored = await writeResumeCiphertext({
    storageDir,
    pdf: syntheticResumePdf(),
    key: encryptionKey,
    keyVersion: 1,
    syncDirectory: async () => undefined,
  });
  currentDocumentId = stored.id;
  currentCipherHash = stored.cipherSha256;
  await pool.query(
    `INSERT INTO resume_documents
      (id, storage_name, cipher_sha256, plaintext_bytes, ciphertext_bytes,
       envelope_version, key_version, uploaded_by_admin_session)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      stored.id,
      stored.storageName,
      stored.cipherSha256,
      stored.plaintextBytes,
      stored.ciphertextBytes,
      stored.envelopeVersion,
      stored.keyVersion,
      randomUUID(),
    ],
  );

  process.env.DATABASE_URL = database.connectionString;
  process.env.NODE_ENV = 'test';
  process.env.MORSE_PUBLIC_ORIGIN = publicOrigin;
  process.env.MORSE_RESUME_ENABLED = 'true';
  process.env.MORSE_RESUME_COOKIE = cookieName;
  process.env.MORSE_RESUME_STORAGE_DIR = storageDir;
  process.env.MORSE_RESUME_ENCRYPTION_KEY = encryptionKey.toString('base64');
  delete process.env.MORSE_RESUME_ENCRYPTION_KEY_FILE;
  process.env.MORSE_RESUME_KEY_VERSION = '1';
  process.env.MORSE_RESUME_FINGERPRINT_SECRET = 'synthetic-resume-fingerprint-secret-32-bytes';
  process.env.MORSE_RESUME_TRUSTED_PROXY_HOPS = '1';

  [accessRoute, fileRoute] = await Promise.all([
    import('../app/api/resume/access/route.ts'),
    import('../app/api/resume/file/route.ts'),
  ]);
});

after(async () => {
  const globalDatabase = globalThis as typeof globalThis & { morseDatabasePool?: InstanceType<typeof Pool> };
  await globalDatabase.morseDatabasePool?.end();
  delete globalDatabase.morseDatabasePool;
  await pool?.end();
  await database?.dispose();
  await rm(storageDir, { force: true, recursive: true });
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('disabled resume status is explicit and never cacheable', async () => {
  process.env.MORSE_RESUME_ENABLED = 'false';
  try {
    const response = await accessRoute.GET(request('/api/resume/access'));
    assert.equal(response.status, 200);
    assertNoStore(response);
    const payload = await response.json() as Record<string, unknown>;
    assertAccessKeys(payload);
    assert.deepEqual(payload, {
      enabled: false,
      authorized: false,
      documentAvailable: false,
      expiresAt: null,
    });
  } finally {
    process.env.MORSE_RESUME_ENABLED = 'true';
  }
});

test('resume redemption requires the exact Origin and returns only public state', async () => {
  const invite = await createInvite('Synthetic Note That Must Not Leak');
  for (const origin of [undefined, 'https://attacker.example']) {
    const forbidden = await accessRoute.POST(request('/api/resume/access', {
      method: 'POST',
      origin,
      body: { code: invite.code },
    }));
    assert.equal(forbidden.status, 403);
    assertNoStore(forbidden);
    assert.doesNotMatch(await forbidden.text(), /Synthetic Note|trusted_person_note/iu);
  }

  const redeemed = await redeem(invite.code);
  authorizedToken = redeemed.token;
  redeemedCode = invite.code;
});

test('malformed, unknown, and reused codes share one stable unauthorized state', async () => {
  for (const body of [
    null,
    {},
    { code: '' },
    { code: 'x'.repeat(129) },
    { code: 'unknown' },
    { code: redeemedCode },
  ]) {
    const response = await accessRoute.POST(request('/api/resume/access', {
      method: 'POST',
      origin: publicOrigin,
      body,
    }));
    assert.equal(response.status, 401, JSON.stringify(body));
    assertNoStore(response);
    const payload = await response.json() as Record<string, unknown>;
    assertAccessKeys(payload);
    assert.deepEqual(payload, {
      enabled: true,
      authorized: false,
      documentAvailable: true,
      expiresAt: null,
    });
  }
});

test('access status trusts only the independent resume cookie', async () => {
  for (const cookie of [undefined, 'morse_access=chat-session', `${cookieName}=unknown-session`]) {
    const response = await accessRoute.GET(request('/api/resume/access', { cookie }));
    assert.equal(response.status, 401);
    assertNoStore(response);
    const payload = await response.json() as Record<string, unknown>;
    assertAccessKeys(payload);
    assert.equal(payload.authorized, false);
    assert.equal(payload.documentAvailable, true);
  }

  const authorized = await accessRoute.GET(request('/api/resume/access', {
    cookie: `${cookieName}=${authorizedToken}`,
  }));
  assert.equal(authorized.status, 200);
  assertNoStore(authorized);
  const payload = await authorized.json() as Record<string, unknown>;
  assertAccessKeys(payload);
  assert.equal(payload.authorized, true);
  assert.equal(typeof payload.expiresAt, 'string');
});

test('no Cookie, chat permission, query, Referer, or storage-name guess can read the PDF', async () => {
  const storageName = await pool.query<{ storage_name: string }>(
    'SELECT storage_name FROM resume_documents WHERE id = $1',
    [currentDocumentId],
  );
  const probes = [
    request('/api/resume/file'),
    request('/api/resume/file', { cookie: 'morse_access=chat-session' }),
    request(`/api/resume/file?session=${encodeURIComponent(authorizedToken)}`),
    request(`/api/resume/file?name=${encodeURIComponent(storageName.rows[0].storage_name)}`),
    request('/api/resume/file', { referer: `${publicOrigin}/?resume=${authorizedToken}` }),
  ];
  for (const probe of probes) {
    const response = await fileRoute.GET(probe);
    assert.equal(response.status, 401);
    assertNoStore(response);
    assert.deepEqual(await response.json(), { ok: false, error: 'RESUME_AUTH_REQUIRED' });
  }
});

test('authorized PDF response is private, inline, and never cacheable', async () => {
  const response = await fileRoute.GET(request('/api/resume/file', {
    cookie: `${cookieName}=${authorizedToken}`,
  }));
  assert.equal(response.status, 200);
  assertNoStore(response);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('content-disposition'), 'inline; filename="Morse-Resume.pdf"');
  assert.equal(response.headers.get('content-length'), String(syntheticResumePdf().length));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), syntheticResumePdf());

  const events = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count
       FROM resume_access_events
      WHERE event_type = 'file_returned'`,
  );
  assert.equal(events.rows[0].count, 1);
});

test('authorized no-document and corrupted-document states remain metadata-free', async () => {
  await pool.query('UPDATE resume_documents SET is_current = false WHERE id = $1', [currentDocumentId]);
  try {
    const status = await accessRoute.GET(request('/api/resume/access', {
      cookie: `${cookieName}=${authorizedToken}`,
    }));
    assert.equal(status.status, 200);
    const statusPayload = await status.json() as Record<string, unknown>;
    assertAccessKeys(statusPayload);
    assert.equal(statusPayload.authorized, true);
    assert.equal(statusPayload.documentAvailable, false);

    const missing = await fileRoute.GET(request('/api/resume/file', {
      cookie: `${cookieName}=${authorizedToken}`,
    }));
    assert.equal(missing.status, 404);
    assertNoStore(missing);
    assert.deepEqual(await missing.json(), { ok: false, error: 'RESUME_NOT_AVAILABLE' });
  } finally {
    await pool.query('UPDATE resume_documents SET is_current = true WHERE id = $1', [currentDocumentId]);
  }

  await pool.query(
    "UPDATE resume_documents SET cipher_sha256 = repeat('0', 64) WHERE id = $1",
    [currentDocumentId],
  );
  try {
    const corrupted = await fileRoute.GET(request('/api/resume/file', {
      cookie: `${cookieName}=${authorizedToken}`,
    }));
    assert.equal(corrupted.status, 503);
    assertNoStore(corrupted);
    const serialized = await corrupted.text();
    assert.equal(serialized, JSON.stringify({ ok: false, error: 'RESUME_UNAVAILABLE' }));
    assert.doesNotMatch(serialized, /morsepdf|storage|cipher|key|path/iu);
  } finally {
    await pool.query(
      'UPDATE resume_documents SET cipher_sha256 = $2 WHERE id = $1',
      [currentDocumentId, currentCipherHash],
    );
  }
});

test('logout and admin revocation invalidate the next status and file request', async () => {
  const logoutInvite = await createInvite();
  const loggedIn = await redeem(logoutInvite.code);
  for (const origin of [undefined, 'https://attacker.example']) {
    const forbidden = await accessRoute.DELETE(request('/api/resume/access', {
      method: 'DELETE',
      cookie: `${cookieName}=${loggedIn.token}`,
      origin,
    }));
    assert.equal(forbidden.status, 403);
    assertNoStore(forbidden);
    assert.ok(await accessRoute.GET(request('/api/resume/access', {
      cookie: `${cookieName}=${loggedIn.token}`,
    })).then((response) => response.status === 200));
  }
  const logout = await accessRoute.DELETE(request('/api/resume/access', {
    method: 'DELETE',
    cookie: `${cookieName}=${loggedIn.token}`,
    origin: publicOrigin,
  }));
  assert.equal(logout.status, 200);
  assertNoStore(logout);
  assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/iu);
  for (const response of [
    await accessRoute.GET(request('/api/resume/access', { cookie: `${cookieName}=${loggedIn.token}` })),
    await fileRoute.GET(request('/api/resume/file', { cookie: `${cookieName}=${loggedIn.token}` })),
  ]) assert.equal(response.status, 401);

  const revokedInvite = await createInvite();
  const revoked = await redeem(revokedInvite.code);
  assert.equal(
    await disableResumeInvite(pool, revokedInvite.inviteId, revokedInvite.adminSessionId),
    true,
  );
  for (const response of [
    await accessRoute.GET(request('/api/resume/access', { cookie: `${cookieName}=${revoked.token}` })),
    await fileRoute.GET(request('/api/resume/file', { cookie: `${cookieName}=${revoked.token}` })),
  ]) {
    assert.equal(response.status, 401);
    assertNoStore(response);
  }
});
