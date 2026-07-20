import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { NextRequest } from 'next/server.js';
import pg from 'pg';

import { hashAdminPassword } from '../lib/server/admin-auth.ts';
import { syntheticResumePdf } from './fixtures/synthetic-resume.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const origin = 'https://portfolio.example';
const password = 'synthetic correct password';
const token = `resume-admin-${randomUUID()}`;
const cookie = `morse_admin=${token}`;
const envNames = ['NODE_ENV', 'DATABASE_URL', 'MORSE_ADMIN_PASSWORD_HASH', 'MORSE_ADMIN_ALLOWED_ORIGIN', 'MORSE_ADMIN_SESSION_MINUTES', 'MORSE_ADMIN_MAX_FAILED_ATTEMPTS', 'MORSE_ADMIN_LOCK_MINUTES', 'MORSE_RESUME_ENABLED', 'MORSE_PUBLIC_ORIGIN', 'MORSE_RESUME_STORAGE_DIR', 'MORSE_RESUME_ENCRYPTION_KEY', 'MORSE_RESUME_KEY_VERSION', 'MORSE_RESUME_FINGERPRINT_SECRET', 'MORSE_RESUME_TRUSTED_PROXY_HOPS'] as const;
const originals = new Map(envNames.map((name) => [name, process.env[name]]));
let database: Awaited<ReturnType<typeof createDisposablePostgresDatabase>>;
let pool: InstanceType<typeof Pool>;
let storageDir: string;
let resumeRoute: typeof import('../app/api/admin/resume/route.ts');
let invitesRoute: typeof import('../app/api/admin/resume/invites/route.ts');
let inviteRoute: typeof import('../app/api/admin/resume/invites/[inviteId]/route.ts');

async function migrate(url: string) {
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('scripts/migrate-db.mjs')], { env: { ...process.env, DATABASE_URL: url }, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (value: string) => { stderr += value; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
}

function request(pathname: string, options: { method?: string; cookie?: string; origin?: string; body?: BodyInit; contentLength?: string } = {}) {
  const headers = new Headers();
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.origin) headers.set('origin', options.origin);
  if (options.contentLength) headers.set('content-length', options.contentLength);
  return new NextRequest(`${origin}${pathname}`, { method: options.method ?? 'GET', headers, body: options.body });
}
function uploadForm(file: File, submittedPassword = password) {
  const form = new FormData();
  form.set('password', submittedPassword);
  form.set('file', file);
  return form;
}

before(async () => {
  database = await createDisposablePostgresDatabase();
  await migrate(database.connectionString);
  pool = new Pool({ connectionString: database.connectionString });
  storageDir = await mkdtemp(path.join(os.tmpdir(), 'revolution-resume-admin-api-'));
  const now = new Date();
  await pool.query('INSERT INTO admin_sessions (id,token_hash,created_at,last_seen_at,expires_at) VALUES ($1,$2,$3,$3,$4)', [randomUUID(), createHash('sha256').update(token).digest('hex'), now, new Date(now.getTime() + 1_800_000)]);
  Object.assign(process.env, {
    NODE_ENV: 'test', DATABASE_URL: database.connectionString, MORSE_ADMIN_PASSWORD_HASH: await hashAdminPassword(password), MORSE_ADMIN_ALLOWED_ORIGIN: origin,
    MORSE_ADMIN_SESSION_MINUTES: '30', MORSE_ADMIN_MAX_FAILED_ATTEMPTS: '5', MORSE_ADMIN_LOCK_MINUTES: '15', MORSE_RESUME_ENABLED: 'true', MORSE_PUBLIC_ORIGIN: origin,
    MORSE_RESUME_STORAGE_DIR: storageDir, MORSE_RESUME_ENCRYPTION_KEY: Buffer.alloc(32, 51).toString('base64'), MORSE_RESUME_KEY_VERSION: '1',
    MORSE_RESUME_FINGERPRINT_SECRET: 'synthetic-admin-resume-fingerprint-secret', MORSE_RESUME_TRUSTED_PROXY_HOPS: '1',
  });
  [resumeRoute, invitesRoute, inviteRoute] = await Promise.all([import('../app/api/admin/resume/route.ts'), import('../app/api/admin/resume/invites/route.ts'), import('../app/api/admin/resume/invites/[inviteId]/route.ts')]);
});
after(async () => {
  const globalDb = globalThis as typeof globalThis & { morseDatabasePool?: InstanceType<typeof Pool> };
  await globalDb.morseDatabasePool?.end(); delete globalDb.morseDatabasePool;
  await pool?.end(); await database?.dispose(); await rm(storageDir, { recursive: true, force: true });
  for (const name of envNames) { const value = originals.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});

test('admin resume writes require Cookie, exact Origin, and password reauthentication', async () => {
  assert.equal((await resumeRoute.GET(request('/api/admin/resume'))).status, 401);
  const file = new File([new Uint8Array(syntheticResumePdf())], 'resume.pdf', { type: 'application/pdf' });
  assert.equal((await resumeRoute.POST(request('/api/admin/resume', { method: 'POST', origin, body: uploadForm(file) }))).status, 401);
  assert.equal((await resumeRoute.POST(request('/api/admin/resume', { method: 'POST', cookie, body: uploadForm(file) }))).status, 403);
  assert.equal((await resumeRoute.POST(request('/api/admin/resume', { method: 'POST', cookie, origin, body: uploadForm(file, '') }))).status, 400);
  assert.equal((await resumeRoute.POST(request('/api/admin/resume', { method: 'POST', cookie, origin, body: uploadForm(file, 'wrong') }))).status, 401);
});

test('upload rejects declared overflow and invalid final PDFs', async () => {
  const valid = new File([new Uint8Array(syntheticResumePdf())], 'resume.pdf', { type: 'application/pdf' });
  assert.equal((await resumeRoute.POST(request('/api/admin/resume', { method: 'POST', cookie, origin, body: uploadForm(valid), contentLength: '11000001' }))).status, 413);
  const chunkedTooLarge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'resume.pdf', { type: 'application/pdf' });
  assert.equal((await resumeRoute.POST(request('/api/admin/resume', { method: 'POST', cookie, origin, body: uploadForm(chunkedTooLarge) }))).status, 400);
  for (const file of [new File([new Uint8Array(Buffer.from('no'))], 'resume.pdf', { type: 'application/pdf' }), new File([new Uint8Array(syntheticResumePdf())], 'resume.txt', { type: 'application/pdf' }), new File([new Uint8Array(syntheticResumePdf())], 'resume.pdf', { type: 'text/plain' })]) {
    const response = await resumeRoute.POST(request('/api/admin/resume', { method: 'POST', cookie, origin, body: uploadForm(file) }));
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error: 'INVALID_RESUME_PDF' });
  }
});

test('admin uploads a synthetic PDF and reads metadata without bytes or secrets', async () => {
  const file = new File([new Uint8Array(syntheticResumePdf())], 'resume.pdf', { type: 'application/pdf' });
  assert.equal((await resumeRoute.POST(request('/api/admin/resume', { method: 'POST', cookie, origin, body: uploadForm(file) }))).status, 200);
  const response = await resumeRoute.GET(request('/api/admin/resume', { cookie }));
  assert.equal(response.status, 200); assert.doesNotMatch(await response.text(), /%PDF-|token_hash|code_hash|encryptionKey|MORSE_RESUME/iu);
});

test('invite plaintext appears once and listing omits hashes', async () => {
  const created = await invitesRoute.POST(request('/api/admin/resume/invites', { method: 'POST', cookie, origin, body: JSON.stringify({ password, trustedPersonNote: 'Synthetic colleague' }) }));
  assert.equal(created.status, 201);
  const createdPayload = await created.json() as { invite: { code: string; id: string } };
  const code = createdPayload.invite.code;
  assert.match(code, /^[A-Za-z0-9_-]{24}$/u);
  const listed = await invitesRoute.GET(request('/api/admin/resume/invites', { cookie }));
  const serialized = await listed.text(); assert.equal(listed.status, 200); assert.doesNotMatch(serialized, new RegExp(code, 'u')); assert.doesNotMatch(serialized, /code_hash|token_hash/iu);
  const inviteId = createdPayload.invite.id;
  const disabled = await inviteRoute.DELETE(request(`/api/admin/resume/invites/${inviteId}`, { method: 'DELETE', cookie, origin, body: JSON.stringify({ password }) }), { params: Promise.resolve({ inviteId }) });
  assert.equal(disabled.status, 200);
});
