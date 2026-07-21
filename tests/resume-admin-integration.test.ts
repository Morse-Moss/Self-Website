import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import pg from 'pg';

import { authenticateResumeSession, redeemResumeInviteProtected } from '../lib/server/resume-access.ts';
import { ResumeAdminInputError, createResumeInvite, getAdminResumeDashboard, replaceCurrentResume, validateFinalPdf } from '../lib/server/resume-admin.ts';
import { hashSecret } from '../lib/server/security.ts';
import { syntheticResumePdf } from './fixtures/synthetic-resume.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const runner = path.resolve('scripts/migrate-db.mjs');
const key = Buffer.alloc(32, 41);
const syncDirectory = async () => undefined;
let database: Awaited<ReturnType<typeof createDisposablePostgresDatabase>>;
let pool: InstanceType<typeof Pool>;
let storageDir: string;

async function migrate(url: string) {
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [runner], { env: { ...process.env, DATABASE_URL: url }, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
}

before(async () => {
  database = await createDisposablePostgresDatabase();
  await migrate(database.connectionString);
  pool = new Pool({ connectionString: database.connectionString });
  storageDir = await mkdtemp(path.join(os.tmpdir(), 'revolution-resume-admin-'));
});
after(async () => {
  await pool?.end();
  await database?.dispose();
  await rm(storageDir, { recursive: true, force: true });
});

function replacement(overrides: Record<string, unknown> = {}) {
  return {
    pool, adminSessionId: randomUUID(), fileName: 'resume.pdf', mimeType: 'application/pdf',
    pdf: syntheticResumePdf(), maxPdfBytes: 10 * 1024 * 1024, storageDir, key, keyVersion: 1,
    auditRetentionDays: 30, syncDirectory, ...overrides,
  };
}

test('final PDF validation rejects size, extension, MIME, and header mismatches', () => {
  const cases: Array<[string, string, Buffer, number]> = [
    ['resume.txt', 'application/pdf', syntheticResumePdf(), 1024],
    ['resume.pdf', 'text/plain', syntheticResumePdf(), 1024],
    ['resume.pdf', 'application/pdf', Buffer.from('not a pdf'), 1024],
    ['resume.pdf', 'application/pdf', syntheticResumePdf(), 4],
  ];
  for (const input of cases) {
    assert.throws(() => validateFinalPdf(...input), (error: unknown) => error instanceof ResumeAdminInputError);
  }
});

test('upload and replacement switch atomically before retiring old ciphertext', async () => {
  const first = await replaceCurrentResume(replacement());
  const second = await replaceCurrentResume(replacement());
  assert.notEqual(first.id, second.id);
  assert.deepEqual((await pool.query<{ id: string }>('SELECT id FROM resume_documents WHERE is_current = true')).rows, [{ id: second.id }]);
  assert.equal((await readdir(storageDir)).length, 1);
  assert.deepEqual((await pool.query<{ event_type: string }>(
    "SELECT event_type FROM resume_access_events WHERE event_type IN ('document_uploaded','document_replaced') ORDER BY id",
  )).rows.map((row) => row.event_type), ['document_uploaded', 'document_replaced']);
});

test('database rollback retains current metadata and removes the new ciphertext', async () => {
  const before = await pool.query<{ id: string }>('SELECT id FROM resume_documents WHERE is_current = true');
  const files = await readdir(storageDir);
  await pool.query(`CREATE FUNCTION reject_resume_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced insert rollback'; END; $$;
    CREATE TRIGGER reject_resume_insert BEFORE INSERT ON resume_documents FOR EACH ROW EXECUTE FUNCTION reject_resume_insert();`);
  try {
    await assert.rejects(() => replaceCurrentResume(replacement()), /forced insert rollback/u);
  } finally {
    await pool.query('DROP TRIGGER reject_resume_insert ON resume_documents; DROP FUNCTION reject_resume_insert()');
  }
  assert.deepEqual((await pool.query('SELECT id FROM resume_documents WHERE is_current = true')).rows, before.rows);
  assert.deepEqual(await readdir(storageDir), files);
});

test('lost COMMIT acknowledgement preserves a durably switched current ciphertext', async () => {
  const wrappedPool = {
    query: pool.query.bind(pool),
    async connect() {
      const client = await pool.connect();
      return {
        query: async (sql: string, params?: unknown[]) => {
          const result = await client.query(sql, params);
          if (sql === 'COMMIT') throw new Error('lost COMMIT acknowledgement');
          return result;
        },
        release: () => client.release(),
      };
    },
  };
  const switched = await replaceCurrentResume(replacement({ pool: wrappedPool }));
  assert.equal((await pool.query('SELECT 1 FROM resume_documents WHERE id=$1 AND is_current=true', [switched.id])).rowCount, 1);
  assert.equal((await readdir(storageDir)).length, 1);
});

test('retired ciphertext cleanup failure preserves new current and records recovery', async () => {
  const old = (await pool.query<{ storage_name: string }>('SELECT storage_name FROM resume_documents WHERE is_current = true')).rows[0].storage_name;
  const next = await replaceCurrentResume(replacement({
    removeCiphertext: async (_dir: string, name: string) => {
      if (name === old) throw new Error('forced cleanup failure');
      await rm(path.join(storageDir, name), { force: true });
    },
  }));
  assert.equal((await pool.query('SELECT 1 FROM resume_documents WHERE id = $1 AND is_current = true', [next.id])).rowCount, 1);
  assert.equal((await pool.query("SELECT 1 FROM resume_access_events WHERE event_type='storage_recovery' AND result_code='RETIRED_CIPHERTEXT_CLEANUP_FAILED'")).rowCount, 1);
});

test('resume invite plaintext is one-time, dashboard omits hashes, and disable revokes Session', async () => {
  const adminSessionId = randomUUID();
  const created = await createResumeInvite(pool, { trustedPersonNote: 'Synthetic colleague', adminSessionId, auditRetentionDays: 30 });
  assert.match(created.code, /^[A-Za-z0-9_-]{24}$/u);
  const stored = await pool.query<{ code_hash: string; row: string }>('SELECT code_hash, row_to_json(resume_invites)::text AS row FROM resume_invites WHERE id=$1', [created.id]);
  assert.equal(stored.rows[0].code_hash, hashSecret(created.code));
  assert.doesNotMatch(stored.rows[0].row, new RegExp(created.code, 'u'));
  const dashboard = await getAdminResumeDashboard(pool);
  assert.doesNotMatch(JSON.stringify(dashboard), /code_hash|token_hash/iu);
  assert.deepEqual(Object.keys(dashboard.events[0]).sort(), [
    'createdAt',
    'deviceInfo',
    'eventType',
    'id',
    'ip',
    'resultCode',
    'userAgent',
  ]);
  assert.equal(dashboard.events[0].eventType, 'invite_created');
  assert.equal(dashboard.events[0].resultCode, 'OK');
  const context = { ip: '192.0.2.91', userAgent: 'Synthetic/1', deviceInfo: {}, fingerprintHash: hashSecret('resume-admin-fingerprint') };
  const session = await redeemResumeInviteProtected(pool, created.code, context, { sessionHours: 72, attemptWindowSeconds: 600, maxFailedAttempts: 5, lockSeconds: 900, auditRetentionDays: 30 });
  assert.ok(await authenticateResumeSession(pool, session.token));
  assert.equal(await created.disable(adminSessionId), true);
  assert.equal(await authenticateResumeSession(pool, session.token), null);
});
