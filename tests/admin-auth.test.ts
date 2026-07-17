import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import pg from 'pg';

import {
  authenticateAdmin,
  authenticateAdminSession,
  consumeAdminTotp,
  generateTotp,
  hashAdminPassword,
  revokeAdminSession,
  verifyAdminPassword,
  verifyTotp,
} from '../lib/server/admin-auth.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const password = 'correct horse battery staple';
const totpSecret = 'JBSWY3DPEHPK3PXP';
const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const baseTime = new Date('2035-03-01T09:00:00.000Z');
const adminStateId = 'admin-login';
const adminGateKey = 'revolution:admin-auth:v1';
const adminSecurityFingerprint = createHash('sha256')
  .update('revolution:admin-login:global', 'utf8')
  .digest('hex');

let database: Awaited<ReturnType<typeof createDisposablePostgresDatabase>>;
let pool: InstanceType<typeof Pool>;
let passwordHash: string;

function adminLockoutDedupeKey(now: Date, lockoutMs: number): string {
  const window = Math.floor(now.getTime() / lockoutMs);
  return `security:admin_login_lockout:${adminSecurityFingerprint}:${window}`;
}

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

function loginInput(options: {
  now?: Date;
  candidatePassword?: string;
  secret?: string;
  code?: string;
  maxFailedAttempts?: number;
  lockoutMs?: number;
  sessionTtlMs?: number;
} = {}) {
  const now = options.now ?? baseTime;
  return [
    {
      password: options.candidatePassword ?? password,
      totpCode: options.code ?? generateTotp(totpSecret, now.getTime()),
    },
    {
      passwordHash,
      totpSecret: options.secret ?? totpSecret,
      now,
      policy: {
        maxFailedAttempts: options.maxFailedAttempts,
        lockoutMs: options.lockoutMs,
        sessionTtlMs: options.sessionTtlMs,
      },
    },
  ] as const;
}

function freshTotpInput(options: {
  now?: Date;
  code?: string;
  secret?: string;
  maxFailedAttempts?: number;
  lockoutMs?: number;
  window?: number;
} = {}) {
  const now = options.now ?? baseTime;
  return [
    {
      totpCode: options.code ?? generateTotp(totpSecret, now.getTime()),
    },
    {
      totpSecret: options.secret ?? totpSecret,
      now,
      policy: {
        maxFailedAttempts: options.maxFailedAttempts,
        lockoutMs: options.lockoutMs,
        window: options.window,
      },
    },
  ] as const;
}

before(async () => {
  passwordHash = await hashAdminPassword(password);
  database = await createDisposablePostgresDatabase();
  await runMigrations(database.connectionString);
  pool = new Pool({ connectionString: database.connectionString });
});

beforeEach(async () => {
  await pool.query('TRUNCATE admin_sessions, alert_outbox RESTART IDENTITY');
  await pool.query('DELETE FROM admin_security_state');
});

after(async () => {
  await pool?.end();
  await database?.dispose();
});

test('scrypt password hashes round-trip without storing the password', async () => {
  const encoded = await hashAdminPassword('a second password');

  assert.match(encoded, /^scrypt\$1\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(encoded.includes('a second password'), false);
  assert.equal(await verifyAdminPassword('a second password', encoded), true);
  assert.equal(await verifyAdminPassword('wrong password', encoded), false);
});

test('password verification rejects malformed or unsupported hashes without throwing', async () => {
  assert.equal(await verifyAdminPassword(password, 'not-a-password-hash'), false);
  assert.equal(
    await verifyAdminPassword(password, 'scrypt$2$16384$8$1$c2FsdA$aGFzaA'),
    false,
  );
  assert.equal(
    await verifyAdminPassword(password, 'scrypt$1$999999999$8$1$c2FsdA$aGFzaA'),
    false,
  );
});

test('TOTP generation matches the published RFC 6238 SHA-1 vectors', () => {
  const vectors = [
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ] as const;

  for (const [seconds, expected] of vectors) {
    assert.equal(
      generateTotp(rfcSecret, seconds * 1_000, { digits: 8 }),
      expected,
    );
  }
});

test('TOTP verification accepts only the current counter and its adjacent window', () => {
  const timestampMs = 1_111_111_111_000;
  const currentCounter = BigInt(Math.floor(timestampMs / 1_000 / 30));
  const previousCode = generateTotp(rfcSecret, timestampMs - 30_000, { digits: 8 });
  const currentCode = generateTotp(rfcSecret, timestampMs, { digits: 8 });
  const nextCode = generateTotp(rfcSecret, timestampMs + 30_000, { digits: 8 });
  const outsideCode = generateTotp(rfcSecret, timestampMs + 60_000, { digits: 8 });

  assert.equal(
    verifyTotp(rfcSecret, previousCode, timestampMs, { digits: 8 }),
    currentCounter - BigInt(1),
  );
  assert.equal(verifyTotp(rfcSecret, currentCode, timestampMs, { digits: 8 }), currentCounter);
  assert.equal(
    verifyTotp(rfcSecret, nextCode, timestampMs, { digits: 8 }),
    currentCounter + BigInt(1),
  );
  assert.equal(verifyTotp(rfcSecret, outsideCode, timestampMs, { digits: 8 }), null);
  assert.equal(verifyTotp(rfcSecret, 'not-code', timestampMs, { digits: 8 }), null);
});

test('PostgreSQL login accepts previous, current, and next TOTP counters only', async () => {
  for (const offsetMs of [-30_000, 0, 30_000]) {
    const result = await authenticateAdmin(pool, ...loginInput({
      code: generateTotp(totpSecret, baseTime.getTime() + offsetMs),
    }));
    assert.equal(result.ok, true, `expected offset ${offsetMs} to be accepted`);
  }

  const outside = await authenticateAdmin(pool, ...loginInput({
    code: generateTotp(totpSecret, baseTime.getTime() + 60_000),
  }));
  assert.deepEqual(outside, { ok: false, error: 'ADMIN_LOGIN_FAILED' });
});

test('a successful login stores only a session token hash and resets failure state', async () => {
  await pool.query(
    `INSERT INTO admin_security_state
      (id, failed_attempts, locked_until, updated_at)
     VALUES ($1, 2, NULL, $2)`,
    [adminStateId, new Date(baseTime.getTime() - 1_000)],
  );

  const result = await authenticateAdmin(pool, ...loginInput({
    sessionTtlMs: 30 * 60_000,
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.ok(result.token.length >= 40);
  assert.equal(result.expiresAt.toISOString(), '2035-03-01T09:30:00.000Z');
  const stored = await pool.query<{
    token_hash: string;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date;
    failed_attempts: number;
    locked_until: Date | null;
  }>(
    `SELECT session.token_hash, session.created_at, session.last_seen_at, session.expires_at,
            security.failed_attempts, security.locked_until
       FROM admin_sessions AS session
       JOIN admin_security_state AS security ON security.id = $2
      WHERE session.id = $1`,
    [result.sessionId, adminStateId],
  );
  assert.deepEqual(stored.rows[0], {
    token_hash: createHash('sha256').update(result.token, 'utf8').digest('hex'),
    created_at: baseTime,
    last_seen_at: baseTime,
    expires_at: result.expiresAt,
    failed_attempts: 0,
    locked_until: null,
  });
  assert.notEqual(stored.rows[0].token_hash, result.token);
});

test('password, TOTP and replay failures return the same public result', async () => {
  const expectedFailure = { ok: false, error: 'ADMIN_LOGIN_FAILED' };

  assert.deepEqual(
    await authenticateAdmin(pool, ...loginInput({
      candidatePassword: 'definitely wrong',
    })),
    expectedFailure,
  );
  assert.deepEqual(
    await authenticateAdmin(pool, ...loginInput({
      code: 'not-a-code',
    })),
    expectedFailure,
  );

  const failedCredentials = await pool.query<{ failed_attempts: number }>(
    'SELECT failed_attempts FROM admin_security_state WHERE id = $1',
    [adminStateId],
  );
  assert.equal(failedCredentials.rows[0].failed_attempts, 2);

  const first = await authenticateAdmin(pool, ...loginInput());
  assert.equal(first.ok, true);
  assert.deepEqual(
    await authenticateAdmin(pool, ...loginInput()),
    expectedFailure,
  );

  const replayFailure = await pool.query<{ failed_attempts: number }>(
    'SELECT failed_attempts FROM admin_security_state WHERE id = $1',
    [adminStateId],
  );
  assert.equal(replayFailure.rows[0].failed_attempts, 0);
});

test('concurrent logins cannot consume the same TOTP counter more than once', async () => {
  const sessionsBefore = await pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM admin_sessions',
  );
  const attempts = await Promise.all(Array.from({ length: 4 }, () => (
    authenticateAdmin(pool, ...loginInput())
  )));

  assert.equal(attempts.filter((result) => result.ok).length, 1);
  assert.equal(attempts.filter((result) => !result.ok).length, 3);
  const state = await pool.query<{
    failed_attempts: number;
    last_totp_counter: string;
  }>(
    `SELECT failed_attempts, last_totp_counter
       FROM admin_security_state
      WHERE id = $1`,
    [adminStateId],
  );
  const sessionsAfter = await pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM admin_sessions',
  );
  assert.equal(state.rows[0].failed_attempts, 0);
  assert.equal(state.rows[0].last_totp_counter, String(Math.floor(baseTime.getTime() / 1_000 / 30)));
  assert.equal(sessionsAfter.rows[0].count - sessionsBefore.rows[0].count, 1);
});

test('login and fresh TOTP verification consume one shared global counter', async () => {
  const login = await authenticateAdmin(pool, ...loginInput());
  assert.equal(login.ok, true);
  const currentCode = generateTotp(totpSecret, baseTime.getTime());
  assert.equal(await consumeAdminTotp(pool, ...freshTotpInput({
    code: currentCode,
    now: baseTime,
  })), false);

  const nextTime = new Date(baseTime.getTime() + 30_000);
  const nextCode = generateTotp(totpSecret, nextTime.getTime());
  assert.equal(await consumeAdminTotp(pool, ...freshTotpInput({
    code: nextCode,
    now: nextTime,
  })), true);
  assert.deepEqual(
    await authenticateAdmin(pool, ...loginInput({ now: nextTime })),
    { ok: false, error: 'ADMIN_LOGIN_FAILED' },
  );

  const state = await pool.query<{ failed_attempts: number; last_totp_counter: string }>(
    'SELECT failed_attempts, last_totp_counter FROM admin_security_state WHERE id = $1',
    [adminStateId],
  );
  assert.equal(
    state.rows[0].last_totp_counter,
    String(Math.floor(nextTime.getTime() / 1_000 / 30)),
  );
  assert.equal(state.rows[0].failed_attempts, 0);
});

test('concurrent fresh TOTP verification consumes the same code only once', async () => {
  const totpCode = generateTotp(totpSecret, baseTime.getTime());
  const attempts = await Promise.all(Array.from({ length: 4 }, () => (
    consumeAdminTotp(pool, ...freshTotpInput({ code: totpCode, now: baseTime }))
  )));

  assert.equal(attempts.filter(Boolean).length, 1);
  assert.equal(attempts.filter((accepted) => !accepted).length, 3);
  const state = await pool.query<{ failed_attempts: number; last_totp_counter: string }>(
    'SELECT failed_attempts, last_totp_counter FROM admin_security_state WHERE id = $1',
    [adminStateId],
  );
  assert.equal(
    state.rows[0].last_totp_counter,
    String(Math.floor(baseTime.getTime() / 1_000 / 30)),
  );
  assert.equal(state.rows[0].failed_attempts, 0);
});

test('invalid fresh TOTP verification records a failure without advancing the counter', async () => {
  assert.equal(await consumeAdminTotp(pool, ...freshTotpInput({
    code: 'not-a-code',
    now: baseTime,
  })), false);
  const afterInvalid = await pool.query<{
    failed_attempts: number;
    last_totp_counter: string | null;
  }>(
    'SELECT failed_attempts, last_totp_counter FROM admin_security_state WHERE id = $1',
    [adminStateId],
  );
  assert.deepEqual(afterInvalid.rows[0], {
    failed_attempts: 1,
    last_totp_counter: null,
  });

  const validCode = generateTotp(totpSecret, baseTime.getTime());
  assert.equal(await consumeAdminTotp(pool, ...freshTotpInput({
    code: validCode,
    now: baseTime,
  })), true);
  const afterValid = await pool.query<{ failed_attempts: number; last_totp_counter: string }>(
    'SELECT failed_attempts, last_totp_counter FROM admin_security_state WHERE id = $1',
    [adminStateId],
  );
  assert.deepEqual(afterValid.rows[0], {
    failed_attempts: 0,
    last_totp_counter: String(Math.floor(baseTime.getTime() / 1_000 / 30)),
  });
});

test('fresh TOTP failures lock brute-force attempts and enqueue one security alert', async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(await consumeAdminTotp(pool, ...freshTotpInput({
      code: 'not-a-code',
      now: baseTime,
    })), false);
  }
  const lockedUntil = new Date(baseTime.getTime() + 15 * 60_000);
  const state = await pool.query<{
    failed_attempts: number;
    last_totp_counter: string | null;
    locked_until: Date;
  }>(
    `SELECT failed_attempts, last_totp_counter, locked_until
       FROM admin_security_state
      WHERE id = $1`,
    [adminStateId],
  );
  assert.deepEqual(state.rows[0], {
    failed_attempts: 5,
    last_totp_counter: null,
    locked_until: lockedUntil,
  });

  const validCode = generateTotp(totpSecret, baseTime.getTime());
  assert.equal(await consumeAdminTotp(pool, ...freshTotpInput({
    code: validCode,
    now: baseTime,
  })), false);
  const alert = await pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM alert_outbox WHERE dedupe_key = $1',
    [adminLockoutDedupeKey(baseTime, 15 * 60_000)],
  );
  assert.equal(alert.rows[0].count, 1);

  const afterLock = lockedUntil;
  assert.equal(await consumeAdminTotp(pool, ...freshTotpInput({
    code: generateTotp(totpSecret, afterLock.getTime()),
    now: afterLock,
  })), true);
});

test('a fresh TOTP Outbox failure rolls back its lockout state', async () => {
  const options = {
    code: 'not-a-code',
    maxFailedAttempts: 2,
    lockoutMs: 12 * 60_000,
  };
  const expectedDedupeKey = adminLockoutDedupeKey(baseTime, options.lockoutMs);
  assert.equal(await consumeAdminTotp(pool, ...freshTotpInput(options)), false);
  await pool.query(`
    CREATE FUNCTION reject_fresh_totp_lockout_alert() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'forced fresh TOTP lockout rollback';
    END;
    $$;
    CREATE TRIGGER reject_fresh_totp_lockout_alert
      BEFORE INSERT ON alert_outbox
      FOR EACH ROW EXECUTE FUNCTION reject_fresh_totp_lockout_alert();
  `);

  try {
    await assert.rejects(
      () => consumeAdminTotp(pool, ...freshTotpInput(options)),
      /forced fresh TOTP lockout rollback/,
    );
  } finally {
    await pool.query('DROP TRIGGER reject_fresh_totp_lockout_alert ON alert_outbox');
    await pool.query('DROP FUNCTION reject_fresh_totp_lockout_alert()');
  }

  const rolledBack = await pool.query<{
    failed_attempts: number;
    locked_until: Date | null;
    alerts: number;
  }>(
    `SELECT security.failed_attempts, security.locked_until,
            (SELECT count(*)::integer FROM alert_outbox WHERE dedupe_key = $2) AS alerts
       FROM admin_security_state AS security
      WHERE security.id = $1`,
    [adminStateId, expectedDedupeKey],
  );
  assert.deepEqual(rolledBack.rows[0], {
    failed_attempts: 1,
    locked_until: null,
    alerts: 0,
  });

  assert.equal(await consumeAdminTotp(pool, ...freshTotpInput(options)), false);
  const retried = await pool.query<{ failed_attempts: number; locked_until: Date; alerts: number }>(
    `SELECT security.failed_attempts, security.locked_until,
            count(alert.id)::integer AS alerts
       FROM admin_security_state AS security
       LEFT JOIN alert_outbox AS alert ON alert.dedupe_key = $2
      WHERE security.id = $1
      GROUP BY security.failed_attempts, security.locked_until`,
    [adminStateId, expectedDedupeKey],
  );
  assert.deepEqual(retried.rows[0], {
    failed_attempts: 2,
    locked_until: new Date(baseTime.getTime() + options.lockoutMs),
    alerts: 1,
  });
});

test('failed attempts lock login temporarily and a completed lock starts a fresh window', async () => {
  const lockoutMs = 15 * 60_000;
  const expectedFailure = { ok: false, error: 'ADMIN_LOGIN_FAILED' };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.deepEqual(
      await authenticateAdmin(pool, ...loginInput({
        candidatePassword: 'wrong password',
      })),
      expectedFailure,
    );
  }
  assert.deepEqual(
    await authenticateAdmin(pool, ...loginInput()),
    expectedFailure,
  );

  const locked = await pool.query<{ failed_attempts: number; locked_until: Date }>(
    `SELECT failed_attempts, locked_until
       FROM admin_security_state
      WHERE id = $1`,
    [adminStateId],
  );
  assert.deepEqual(locked.rows[0], {
    failed_attempts: 5,
    locked_until: new Date(baseTime.getTime() + lockoutMs),
  });
  const expectedDedupeKey = adminLockoutDedupeKey(baseTime, lockoutMs);
  const alert = await pool.query<{
    dedupe_key: string;
    category: string;
    payload: Record<string, unknown>;
    expires_at: Date;
  }>(
    `SELECT dedupe_key, category, payload, expires_at
       FROM alert_outbox
      WHERE dedupe_key = $1`,
    [expectedDedupeKey],
  );
  assert.deepEqual(alert.rows[0], {
    dedupe_key: expectedDedupeKey,
    category: 'admin_login_lockout',
    payload: {
      lockedUntil: locked.rows[0].locked_until.toISOString(),
      occurredAt: baseTime.toISOString(),
    },
    expires_at: new Date('2035-03-11T09:00:00.000Z'),
  });
  assert.deepEqual(Object.keys(alert.rows[0].payload).sort(), ['lockedUntil', 'occurredAt']);

  await authenticateAdmin(pool, ...loginInput());
  const repeatedAlerts = await pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM alert_outbox WHERE dedupe_key = $1',
    [expectedDedupeKey],
  );
  assert.equal(repeatedAlerts.rows[0].count, 1);

  const afterLock = new Date(baseTime.getTime() + lockoutMs);
  const success = await authenticateAdmin(pool, ...loginInput({
    now: afterLock,
  }));
  assert.equal(success.ok, true);
  const reset = await pool.query<{ failed_attempts: number; locked_until: Date | null }>(
    'SELECT failed_attempts, locked_until FROM admin_security_state WHERE id = $1',
    [adminStateId],
  );
  assert.deepEqual(reset.rows[0], { failed_attempts: 0, locked_until: null });
});

test('an active login lock rejects before parsing or deriving credentials', async () => {
  assert.deepEqual(
    await authenticateAdmin(pool, ...loginInput({
      candidatePassword: 'wrong password',
      maxFailedAttempts: 1,
    })),
    { ok: false, error: 'ADMIN_LOGIN_FAILED' },
  );

  assert.deepEqual(
    await authenticateAdmin(pool, ...loginInput({
      secret: 'invalid-base32-secret!',
      maxFailedAttempts: 1,
    })),
    { ok: false, error: 'ADMIN_LOGIN_FAILED' },
  );

  const [credentials, settings] = loginInput({ maxFailedAttempts: 1 });
  const passwordHashTrap = {
    split() {
      throw new Error('password verification must not run while locked');
    },
  } as unknown as string;
  assert.deepEqual(
    await authenticateAdmin(pool, credentials, { ...settings, passwordHash: passwordHashTrap }),
    { ok: false, error: 'ADMIN_LOGIN_FAILED' },
  );
});

test('login rechecks a lock created after the cheap preflight query', async () => {
  let injectedLock = false;
  const racedPool = new Proxy(pool, {
    get(target, property) {
      if (property === 'query') {
        return async (query: string, values?: unknown[]) => {
          const result = await target.query(query, values);
          if (!injectedLock && query.startsWith('SELECT locked_until FROM admin_security_state')) {
            injectedLock = true;
            await target.query(
              `INSERT INTO admin_security_state
                (id, failed_attempts, locked_until, updated_at)
               VALUES ($1, 5, $2, $3)`,
              [adminStateId, new Date(baseTime.getTime() + 15 * 60_000), baseTime],
            );
          }
          return result;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  const result = await authenticateAdmin(racedPool, ...loginInput());
  assert.deepEqual(result, { ok: false, error: 'ADMIN_LOGIN_FAILED' });
  const sessions = await pool.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM admin_sessions',
  );
  assert.equal(sessions.rows[0].count, 0);
});

test('a durable login gate bounds burst verification before the first lock commits', async () => {
  const waiterCount = 8;
  let preflightCount = 0;
  let gateHeld = false;
  let releaseGate!: () => void;
  let reportGateHeld!: () => void;
  let reportAllPreflights!: () => void;
  const gateRelease = new Promise<void>((resolve) => { releaseGate = resolve; });
  const gateObserved = new Promise<void>((resolve) => { reportGateHeld = resolve; });
  const allPreflights = new Promise<void>((resolve) => { reportAllPreflights = resolve; });
  await pool.query(
    `INSERT INTO admin_security_state
      (id, failed_attempts, locked_until, updated_at)
     VALUES ($1, 0, NULL, $2)`,
    [adminStateId, baseTime],
  );
  const gatedPool = new Proxy(pool, {
    get(target, property) {
      if (property === 'query') {
        return async (query: string, values?: unknown[]) => {
          const result = await target.query(query, values);
          if (query.startsWith('SELECT locked_until FROM admin_security_state')) {
            preflightCount += 1;
            if (preflightCount === waiterCount + 1) reportAllPreflights();
          }
          return result;
        };
      }
      if (property === 'connect') {
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(clientTarget, clientProperty) {
              if (clientProperty === 'query') {
                return async (query: string, values?: unknown[]) => {
                  const result = await clientTarget.query(query, values);
                  if (!gateHeld && query.includes('FOR UPDATE')) {
                    gateHeld = true;
                    reportGateHeld();
                    await gateRelease;
                  }
                  return result;
                };
              }
              const value = Reflect.get(clientTarget, clientProperty);
              return typeof value === 'function' ? value.bind(clientTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  const first = authenticateAdmin(gatedPool, ...loginInput({
    candidatePassword: 'wrong password',
    maxFailedAttempts: 1,
  }));
  await gateObserved;
  const waiters = Array.from({ length: waiterCount }, () => authenticateAdmin(
    gatedPool,
    ...loginInput({
      secret: 'invalid-base32-secret!',
      maxFailedAttempts: 1,
    }),
  ));
  const settledWaiters = Promise.allSettled(waiters);
  await allPreflights;
  releaseGate();

  assert.deepEqual(await first, { ok: false, error: 'ADMIN_LOGIN_FAILED' });
  const settled = await settledWaiters;
  assert.ok(settled.every((result) => (
    result.status === 'fulfilled'
    && result.value.ok === false
    && result.value.error === 'ADMIN_LOGIN_FAILED'
  )));
  const state = await pool.query<{ failed_attempts: number; locked_until: Date }>(
    'SELECT failed_attempts, locked_until FROM admin_security_state WHERE id = $1',
    [adminStateId],
  );
  assert.deepEqual(state.rows[0], {
    failed_attempts: 1,
    locked_until: new Date(baseTime.getTime() + 15 * 60_000),
  });
});

test('a busy durable gate rejects an admin burst without occupying the shared pool', async () => {
  await pool.query(
    `INSERT INTO admin_security_state
      (id, failed_attempts, locked_until, updated_at)
     VALUES ($1, 0, NULL, $2)`,
    [adminStateId, baseTime],
  );
  const burstPool = new Pool({
    connectionString: database.connectionString,
    connectionTimeoutMillis: 1_000,
    max: 5,
  });
  const blocker = await burstPool.connect();
  await blocker.query('BEGIN');
  await blocker.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    [adminGateKey],
  );
  await blocker.query(
    'SELECT id FROM admin_security_state WHERE id = $1 FOR UPDATE',
    [adminStateId],
  );

  const attempts = Array.from({ length: 20 }, () => authenticateAdmin(
    burstPool,
    ...loginInput({
      secret: 'invalid-base32-secret!',
      maxFailedAttempts: 1,
    }),
  ));
  const settledAttempts = Promise.allSettled(attempts);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const outcome = await Promise.race([
      settledAttempts.then(() => 'settled' as const),
      new Promise<'timeout'>((resolve) => {
        timeout = setTimeout(() => resolve('timeout'), 2_000);
      }),
    ]);
    assert.equal(outcome, 'settled', 'admin requests must not wait behind a busy auth gate');
    const bypass = await burstPool.query<{ value: number }>('SELECT 1::integer AS value');
    assert.equal(bypass.rows[0].value, 1);
    const settled = await settledAttempts;
    assert.ok(settled.every((result) => (
      result.status === 'fulfilled'
      && result.value.ok === false
      && result.value.error === 'ADMIN_LOGIN_FAILED'
    )));
  } finally {
    if (timeout) clearTimeout(timeout);
    await blocker.query('ROLLBACK');
    blocker.release();
    await settledAttempts;
    await burstPool.end();
  }
});

test('an Outbox failure rolls back the lockout state and can be retried safely', async () => {
  const options = {
    candidatePassword: 'wrong password',
    maxFailedAttempts: 2,
    lockoutMs: 11 * 60_000,
  };
  const expectedDedupeKey = adminLockoutDedupeKey(baseTime, options.lockoutMs);
  await authenticateAdmin(pool, ...loginInput(options));
  await pool.query(`
    CREATE FUNCTION reject_admin_lockout_alert() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'forced admin lockout alert rollback';
    END;
    $$;
    CREATE TRIGGER reject_admin_lockout_alert
      BEFORE INSERT ON alert_outbox
      FOR EACH ROW EXECUTE FUNCTION reject_admin_lockout_alert();
  `);

  try {
    await assert.rejects(
      () => authenticateAdmin(pool, ...loginInput(options)),
      /forced admin lockout alert rollback/,
    );
  } finally {
    await pool.query('DROP TRIGGER reject_admin_lockout_alert ON alert_outbox');
    await pool.query('DROP FUNCTION reject_admin_lockout_alert()');
  }

  const rolledBack = await pool.query<{
    failed_attempts: number;
    locked_until: Date | null;
    alert_count: number;
  }>(
    `SELECT security.failed_attempts, security.locked_until,
            (SELECT count(*)::integer FROM alert_outbox
              WHERE dedupe_key = $2) AS alert_count
       FROM admin_security_state AS security
      WHERE security.id = $1`,
    [adminStateId, expectedDedupeKey],
  );
  assert.deepEqual(rolledBack.rows[0], {
    failed_attempts: 1,
    locked_until: null,
    alert_count: 0,
  });

  assert.deepEqual(
    await authenticateAdmin(pool, ...loginInput(options)),
    { ok: false, error: 'ADMIN_LOGIN_FAILED' },
  );
  const retried = await pool.query<{ failed_attempts: number; locked_until: Date; alerts: number }>(
    `SELECT security.failed_attempts, security.locked_until,
            count(alert.id)::integer AS alerts
       FROM admin_security_state AS security
       LEFT JOIN alert_outbox AS alert ON alert.dedupe_key = $2
      WHERE security.id = $1
      GROUP BY security.failed_attempts, security.locked_until`,
    [adminStateId, expectedDedupeKey],
  );
  assert.deepEqual(retried.rows[0], {
    failed_attempts: 2,
    locked_until: new Date(baseTime.getTime() + options.lockoutMs),
    alerts: 1,
  });
});

test('a failed session insert rolls back the accepted TOTP counter', async () => {
  await pool.query(`
    CREATE FUNCTION reject_admin_session_insert() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'forced admin session rollback';
    END;
    $$;
    CREATE TRIGGER reject_admin_session_insert
      BEFORE INSERT ON admin_sessions
      FOR EACH ROW EXECUTE FUNCTION reject_admin_session_insert();
  `);

  try {
    await assert.rejects(
      () => authenticateAdmin(pool, ...loginInput()),
      /forced admin session rollback/,
    );
  } finally {
    await pool.query('DROP TRIGGER reject_admin_session_insert ON admin_sessions');
    await pool.query('DROP FUNCTION reject_admin_session_insert()');
  }

  const rolledBack = await pool.query<{ last_totp_counter: string | null }>(
    'SELECT last_totp_counter FROM admin_security_state WHERE id = $1',
    [adminStateId],
  );
  assert.equal(rolledBack.rowCount, 0);

  const retry = await authenticateAdmin(pool, ...loginInput());
  assert.equal(retry.ok, true);
});

test('admin sessions slide by 30 minutes and reject expired or unknown tokens', async () => {
  const result = await authenticateAdmin(pool, ...loginInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const twentyMinutesLater = new Date(baseTime.getTime() + 20 * 60_000);
  const session = await authenticateAdminSession(pool, result.token, { now: twentyMinutesLater });
  assert.equal(session?.id, result.sessionId);
  assert.equal(session?.createdAt.toISOString(), baseTime.toISOString());
  assert.equal(session?.lastSeenAt.toISOString(), twentyMinutesLater.toISOString());
  assert.equal(
    session?.expiresAt.toISOString(),
    '2035-03-01T09:50:00.000Z',
  );

  assert.equal(
    await authenticateAdminSession(
      pool,
      result.token,
      { now: new Date('2035-03-01T09:50:00.000Z') },
    ),
    null,
  );
  assert.equal(await authenticateAdminSession(pool, 'unknown-admin-token', { now: baseTime }), null);
});

test('revoking an admin session invalidates its token without affecting other sessions', async () => {
  const first = await authenticateAdmin(pool, ...loginInput());
  const secondTime = new Date(baseTime.getTime() + 30_000);
  const second = await authenticateAdmin(pool, ...loginInput({ now: secondTime }));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;

  await revokeAdminSession(pool, first.token);

  assert.equal(await authenticateAdminSession(pool, first.token, { now: baseTime }), null);
  assert.equal(
    (await authenticateAdminSession(pool, second.token, { now: secondTime }))?.id,
    second.sessionId,
  );
});
