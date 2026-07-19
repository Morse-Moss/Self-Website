import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { enqueueAlert } from './alert-service.ts';

const SCRYPT_VERSION = '1';
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_BYTES = 64;
const SCRYPT_SALT_BYTES = 16;
const DEFAULT_TOTP_STEP_SECONDS = 30;
const DEFAULT_TOTP_DIGITS = 6;
const DEFAULT_TOTP_WINDOW = 1;
const DEFAULT_MAX_FAILED_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_MS = 15 * 60_000;
const DEFAULT_SESSION_TTL_MS = 30 * 60_000;
const DEFAULT_SECURITY_STATE_ID = 'admin-login';
const ADMIN_AUTH_GATE_KEY = 'revolution:admin-auth:v1';
const ADMIN_SECURITY_FINGERPRINT = createHash('sha256')
  .update('revolution:admin-login:global', 'utf8')
  .digest('hex');
const FAILED_LOGIN = { ok: false, error: 'ADMIN_LOGIN_FAILED' } as const;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

interface ScryptParameters {
  cost: number;
  blockSize: number;
  parallelization: number;
}

export interface TotpOptions {
  digits?: number;
  stepSeconds?: number;
  window?: number;
}

export interface AdminAuthPolicy {
  maxFailedAttempts?: number;
  lockoutMs?: number;
  sessionTtlMs?: number;
}

export interface AdminLoginCredentials {
  password: string;
}

export interface AdminAuthSettings {
  passwordHash: string;
  now?: Date;
  policy?: AdminAuthPolicy;
}

export type AdminLoginResult =
  | {
    ok: true;
    sessionId: string;
    token: string;
    expiresAt: Date;
  }
  | typeof FAILED_LOGIN;

export interface AdminSession {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface AdminSessionOptions {
  now?: Date;
  sessionTtlMs?: number;
}

export interface AdminTotpCredentials {
  totpCode: string;
}

export interface AdminTotpPolicy {
  maxFailedAttempts?: number;
  lockoutMs?: number;
  window?: number;
}

export interface AdminTotpSettings {
  totpSecret: string;
  now?: Date;
  policy?: AdminTotpPolicy;
}

interface NormalizedAdminAuthPolicy {
  maxFailedAttempts: number;
  lockoutMs: number;
  sessionTtlMs: number;
}

interface NormalizedAdminTotpPolicy {
  maxFailedAttempts: number;
  lockoutMs: number;
  window: number;
}

interface AdminSecurityStateRow {
  last_totp_counter: string | null;
  failed_attempts: number;
  locked_until: Date | null;
}

interface AdminSessionRow {
  id: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
}

function validDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${name} must be a valid Date.`);
  }
  return value;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function normalizePolicy(policy: AdminAuthPolicy | undefined): NormalizedAdminAuthPolicy {
  return {
    maxFailedAttempts: boundedInteger(
      policy?.maxFailedAttempts,
      DEFAULT_MAX_FAILED_ATTEMPTS,
      'Admin max failed attempts',
      1,
      100,
    ),
    lockoutMs: boundedInteger(
      policy?.lockoutMs,
      DEFAULT_LOCKOUT_MS,
      'Admin lockout duration',
      1_000,
      24 * 60 * 60_000,
    ),
    sessionTtlMs: boundedInteger(
      policy?.sessionTtlMs,
      DEFAULT_SESSION_TTL_MS,
      'Admin session duration',
      1_000,
      24 * 60 * 60_000,
    ),
  };
}

function normalizeAdminTotpPolicy(
  policy: AdminTotpPolicy | undefined,
): NormalizedAdminTotpPolicy {
  return {
    maxFailedAttempts: boundedInteger(
      policy?.maxFailedAttempts,
      DEFAULT_MAX_FAILED_ATTEMPTS,
      'Admin max failed attempts',
      1,
      100,
    ),
    lockoutMs: boundedInteger(
      policy?.lockoutMs,
      DEFAULT_LOCKOUT_MS,
      'Admin lockout duration',
      1_000,
      24 * 60 * 60_000,
    ),
    window: boundedInteger(
      policy?.window,
      DEFAULT_TOTP_WINDOW,
      'TOTP window',
      0,
      10,
    ),
  };
}

function scryptMaxMemory(parameters: ScryptParameters): number {
  const required = 128 * parameters.cost * parameters.blockSize
    + 128 * parameters.blockSize * parameters.parallelization;
  return Math.max(32 * 1024 * 1024, required + 1024 * 1024);
}

function deriveScryptKey(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_BYTES, {
      N: parameters.cost,
      r: parameters.blockSize,
      p: parameters.parallelization,
      maxmem: scryptMaxMemory(parameters),
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function decodeCanonicalBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : null;
}

function parseScryptHash(encodedHash: string): {
  parameters: ScryptParameters;
  salt: Buffer;
  expected: Buffer;
} | null {
  const parts = encodedHash.split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== SCRYPT_VERSION) return null;
  if (!parts.slice(2, 5).every((part) => /^[1-9]\d*$/u.test(part))) return null;
  const parameters = {
    cost: Number(parts[2]),
    blockSize: Number(parts[3]),
    parallelization: Number(parts[4]),
  };
  if (
    !Number.isSafeInteger(parameters.cost)
    || parameters.cost < SCRYPT_COST
    || parameters.cost > 65_536
    || (parameters.cost & (parameters.cost - 1)) !== 0
    || !Number.isSafeInteger(parameters.blockSize)
    || parameters.blockSize < 1
    || parameters.blockSize > 16
    || !Number.isSafeInteger(parameters.parallelization)
    || parameters.parallelization < 1
    || parameters.parallelization > 4
  ) {
    return null;
  }
  const salt = decodeCanonicalBase64Url(parts[5]);
  const expected = decodeCanonicalBase64Url(parts[6]);
  if (!salt || salt.length < SCRYPT_SALT_BYTES || salt.length > 64) return null;
  if (!expected || expected.length !== SCRYPT_KEY_BYTES) return null;
  return { parameters, salt, expected };
}

export function isSupportedAdminPasswordHash(encodedHash: string): boolean {
  return parseScryptHash(encodedHash) !== null;
}

export async function hashAdminPassword(password: string): Promise<string> {
  const parameters = {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
  };
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await deriveScryptKey(password, salt, parameters);
  return [
    'scrypt',
    SCRYPT_VERSION,
    parameters.cost,
    parameters.blockSize,
    parameters.parallelization,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyAdminPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parsed = parseScryptHash(encodedHash);
  if (!parsed) return false;
  try {
    const actual = await deriveScryptKey(password, parsed.salt, parsed.parameters);
    return timingSafeEqual(actual, parsed.expected);
  } catch {
    return false;
  }
}

function decodeBase32(secret: string): Buffer {
  const compact = secret.replace(/[\s-]/gu, '').toUpperCase();
  if (!/^[A-Z2-7]+=*$/u.test(compact)) throw new Error('TOTP secret must be valid Base32.');
  const firstPadding = compact.indexOf('=');
  const unpadded = firstPadding === -1 ? compact : compact.slice(0, firstPadding);
  if (!unpadded || (firstPadding !== -1 && !/^=+$/u.test(compact.slice(firstPadding)))) {
    throw new Error('TOTP secret must be valid Base32.');
  }

  let value = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of unpadded) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && value !== 0) throw new Error('TOTP secret has non-zero Base32 padding bits.');
  if (bytes.length === 0) throw new Error('TOTP secret must not be empty.');
  return Buffer.from(bytes);
}

export function isCanonicalAdminTotpSecret(secret: string): boolean {
  const value = secret.trim();
  if (value !== secret || value.length < 16 || /[\s=-]/u.test(value)) return false;
  try {
    return decodeBase32(value).length >= 10;
  } catch {
    return false;
  }
}

function normalizeTotpOptions(options: TotpOptions | undefined): {
  digits: number;
  stepSeconds: number;
  window: number;
} {
  return {
    digits: boundedInteger(
      options?.digits,
      DEFAULT_TOTP_DIGITS,
      'TOTP digits',
      6,
      8,
    ),
    stepSeconds: boundedInteger(
      options?.stepSeconds,
      DEFAULT_TOTP_STEP_SECONDS,
      'TOTP step',
      1,
      3_600,
    ),
    window: boundedInteger(
      options?.window,
      DEFAULT_TOTP_WINDOW,
      'TOTP window',
      0,
      10,
    ),
  };
}

function counterForTimestamp(timestampMs: number, stepSeconds: number): bigint {
  if (!Number.isFinite(timestampMs) || timestampMs < 0 || !Number.isSafeInteger(timestampMs)) {
    throw new Error('TOTP timestamp must be a non-negative safe integer in milliseconds.');
  }
  return BigInt(Math.floor(timestampMs / 1_000 / stepSeconds));
}

function codeForCounter(secret: Buffer, counter: bigint, digits: number): string {
  if (counter < BigInt(0) || counter > BigInt('18446744073709551615')) {
    throw new Error('TOTP counter is out of range.');
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  ) >>> 0;
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

export function generateTotp(
  secret: string,
  timestampMs: number,
  options?: TotpOptions,
): string {
  const normalized = normalizeTotpOptions(options);
  return codeForCounter(
    decodeBase32(secret),
    counterForTimestamp(timestampMs, normalized.stepSeconds),
    normalized.digits,
  );
}

export function verifyTotp(
  secret: string,
  code: string,
  timestampMs: number,
  options?: TotpOptions,
): bigint | null {
  const normalized = normalizeTotpOptions(options);
  const candidate = code.trim();
  if (!new RegExp(`^\\d{${normalized.digits}}$`, 'u').test(candidate)) return null;
  const secretBytes = decodeBase32(secret);
  const currentCounter = counterForTimestamp(timestampMs, normalized.stepSeconds);
  let matchedCounter: bigint | null = null;

  for (let offset = -normalized.window; offset <= normalized.window; offset += 1) {
    const counter = currentCounter + BigInt(offset);
    if (counter < BigInt(0)) continue;
    const expected = codeForCounter(secretBytes, counter, normalized.digits);
    if (timingSafeEqual(Buffer.from(candidate, 'ascii'), Buffer.from(expected, 'ascii'))) {
      if (matchedCounter === null || counter > matchedCounter) matchedCounter = counter;
    }
  }
  return matchedCounter;
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Releasing the client below also ends any unusable transaction state.
  }
}

async function recordFailedLogin(
  client: PoolClient,
  currentFailures: number,
  now: Date,
  policy: Pick<NormalizedAdminAuthPolicy, 'maxFailedAttempts' | 'lockoutMs'>,
): Promise<void> {
  const failedAttempts = currentFailures + 1;
  const lockedUntil = failedAttempts >= policy.maxFailedAttempts
    ? new Date(now.getTime() + policy.lockoutMs)
    : null;
  await client.query(
    `UPDATE admin_security_state
        SET failed_attempts = $2,
            locked_until = $3,
            updated_at = $4
      WHERE id = $1`,
    [DEFAULT_SECURITY_STATE_ID, failedAttempts, lockedUntil, now],
  );
  if (lockedUntil) {
    const window = Math.floor(now.getTime() / policy.lockoutMs);
    await enqueueAlert(client, {
      dedupeKey: `security:admin_login_lockout:${ADMIN_SECURITY_FINGERPRINT}:${window}`,
      category: 'admin_login_lockout',
      payload: {
        lockedUntil: lockedUntil.toISOString(),
        occurredAt: now.toISOString(),
      },
      now,
    });
  }
}

async function hasActiveAdminLock(pool: Pool, now: Date): Promise<boolean> {
  const result = await pool.query<{ locked_until: Date | null }>(
    'SELECT locked_until FROM admin_security_state WHERE id = $1',
    [DEFAULT_SECURITY_STATE_ID],
  );
  const lockedUntil = result.rows[0]?.locked_until;
  return lockedUntil !== null
    && lockedUntil !== undefined
    && lockedUntil.getTime() > now.getTime();
}

async function tryAdminAuthGate(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_xact_lock(
       hashtextextended($1::text, 0)
     ) AS acquired`,
    [ADMIN_AUTH_GATE_KEY],
  );
  return result.rows[0]?.acquired === true;
}

async function lockAdminSecurityState(
  client: PoolClient,
  now: Date,
): Promise<AdminSecurityStateRow> {
  await client.query(
    `INSERT INTO admin_security_state (id, updated_at)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_SECURITY_STATE_ID, now],
  );
  const result = await client.query<AdminSecurityStateRow>(
    `SELECT last_totp_counter, failed_attempts, locked_until
       FROM admin_security_state
      WHERE id = $1
      FOR UPDATE`,
    [DEFAULT_SECURITY_STATE_ID],
  );
  const state = result.rows[0];
  if (!state) throw new Error('Admin security state was not initialized.');
  return state;
}

export async function authenticateAdmin(
  pool: Pool,
  credentials: AdminLoginCredentials,
  settings: AdminAuthSettings,
): Promise<AdminLoginResult> {
  const now = validDate(settings.now ?? new Date(), 'Admin login time');
  const policy = normalizePolicy(settings.policy);
  if (await hasActiveAdminLock(pool, now)) return FAILED_LOGIN;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    if (!await tryAdminAuthGate(client)) {
      await client.query('COMMIT');
      return FAILED_LOGIN;
    }
    const state = await lockAdminSecurityState(client, now);

    if (state.locked_until && state.locked_until.getTime() > now.getTime()) {
      await client.query('COMMIT');
      return FAILED_LOGIN;
    }

    const failuresBeforeAttempt = state.locked_until ? 0 : state.failed_attempts;
    const passwordMatches = await verifyAdminPassword(
      credentials.password,
      settings.passwordHash,
    );

    if (!passwordMatches) {
      await recordFailedLogin(client, failuresBeforeAttempt, now, policy);
      await client.query('COMMIT');
      return FAILED_LOGIN;
    }

    const sessionId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + policy.sessionTtlMs);
    await client.query(
      `UPDATE admin_security_state
          SET failed_attempts = 0,
              locked_until = NULL,
              updated_at = $2
        WHERE id = $1`,
      [DEFAULT_SECURITY_STATE_ID, now],
    );
    await client.query(
      `INSERT INTO admin_sessions
        (id, token_hash, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $3, $4)`,
      [sessionId, hashSessionToken(token), now, expiresAt],
    );
    await client.query('COMMIT');
    return { ok: true, sessionId, token, expiresAt };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function reauthenticateAdminPassword(
  pool: Pool,
  password: string,
  settings: AdminAuthSettings,
): Promise<boolean> {
  const now = validDate(settings.now ?? new Date(), 'Admin password reauthentication time');
  const policy = normalizePolicy(settings.policy);
  if (await hasActiveAdminLock(pool, now)) return false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!await tryAdminAuthGate(client)) {
      await client.query('COMMIT');
      return false;
    }
    const state = await lockAdminSecurityState(client, now);
    if (state.locked_until && state.locked_until.getTime() > now.getTime()) {
      await client.query('COMMIT');
      return false;
    }

    const failuresBeforeAttempt = state.locked_until ? 0 : state.failed_attempts;
    if (!await verifyAdminPassword(password, settings.passwordHash)) {
      await recordFailedLogin(client, failuresBeforeAttempt, now, policy);
      await client.query('COMMIT');
      return false;
    }

    await client.query(
      `UPDATE admin_security_state
          SET failed_attempts = 0,
              locked_until = NULL,
              updated_at = $2
        WHERE id = $1`,
      [DEFAULT_SECURITY_STATE_ID, now],
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function consumeAdminTotp(
  pool: Pool,
  credentials: AdminTotpCredentials,
  settings: AdminTotpSettings,
): Promise<boolean> {
  const now = validDate(settings.now ?? new Date(), 'Admin TOTP verification time');
  const policy = normalizeAdminTotpPolicy(settings.policy);
  if (await hasActiveAdminLock(pool, now)) return false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!await tryAdminAuthGate(client)) {
      await client.query('COMMIT');
      return false;
    }
    const state = await lockAdminSecurityState(client, now);
    if (state.locked_until && state.locked_until.getTime() > now.getTime()) {
      await client.query('COMMIT');
      return false;
    }
    const failuresBeforeAttempt = state.locked_until ? 0 : state.failed_attempts;
    const lastCounter = state.last_totp_counter === null
      ? null
      : BigInt(state.last_totp_counter);
    const matchedCounter = verifyTotp(
      settings.totpSecret,
      credentials.totpCode,
      now.getTime(),
      { window: policy.window },
    );
    if (matchedCounter !== null && lastCounter !== null && matchedCounter <= lastCounter) {
      await client.query('COMMIT');
      return false;
    }
    if (matchedCounter === null) {
      await recordFailedLogin(client, failuresBeforeAttempt, now, policy);
      await client.query('COMMIT');
      return false;
    }
    await client.query(
      `UPDATE admin_security_state
          SET last_totp_counter = $2,
              failed_attempts = 0,
              locked_until = NULL,
              updated_at = $3
        WHERE id = $1`,
      [DEFAULT_SECURITY_STATE_ID, matchedCounter.toString(), now],
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function authenticateAdminSession(
  pool: Pool,
  token: string,
  options: AdminSessionOptions = {},
): Promise<AdminSession | null> {
  if (!token) return null;
  const now = validDate(options.now ?? new Date(), 'Admin session time');
  const sessionTtlMs = boundedInteger(
    options.sessionTtlMs,
    DEFAULT_SESSION_TTL_MS,
    'Admin session duration',
    1_000,
    24 * 60 * 60_000,
  );
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query<AdminSessionRow>(
      `SELECT id, created_at, last_seen_at, expires_at
         FROM admin_sessions
        WHERE token_hash = $1
        FOR UPDATE`,
      [hashSessionToken(token)],
    );
    const session = result.rows[0];
    if (!session || session.expires_at.getTime() <= now.getTime()) {
      await client.query('COMMIT');
      return null;
    }

    const lastSeenAt = session.last_seen_at.getTime() > now.getTime()
      ? session.last_seen_at
      : now;
    const expiresAt = new Date(lastSeenAt.getTime() + sessionTtlMs);
    await client.query(
      `UPDATE admin_sessions
          SET last_seen_at = $2,
              expires_at = $3
        WHERE id = $1`,
      [session.id, lastSeenAt, expiresAt],
    );
    await client.query('COMMIT');
    return {
      id: session.id,
      createdAt: session.created_at,
      lastSeenAt,
      expiresAt,
    };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeAdminSession(pool: Pool, token: string): Promise<void> {
  if (!token) return;
  await pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [hashSessionToken(token)]);
}
