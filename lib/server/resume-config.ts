import { readFileSync } from 'node:fs';
import path from 'node:path';

type Env = Record<string, string | undefined>;

export type ResumeConfigErrorCode =
  | 'RESUME_ENABLED_INVALID'
  | 'RESUME_DATABASE_URL_INVALID'
  | 'RESUME_PUBLIC_ORIGIN_INVALID'
  | 'RESUME_STORAGE_DIR_INVALID'
  | 'RESUME_ENCRYPTION_KEY_INVALID'
  | 'RESUME_KEY_VERSION_INVALID'
  | 'RESUME_FINGERPRINT_SECRET_INVALID'
  | 'RESUME_TRUSTED_PROXY_HOPS_INVALID';

export class ResumeConfigError extends Error {
  readonly code: ResumeConfigErrorCode;

  constructor(code: ResumeConfigErrorCode) {
    super(code);
    this.name = 'ResumeConfigError';
    this.code = code;
  }
}

export interface DisabledResumeConfig {
  enabled: false;
  cookieName: string;
}

export interface EnabledResumeConfig {
  enabled: true;
  databaseUrl: string;
  publicOrigin: string;
  cookieName: string;
  inviteDays: 7;
  sessionHours: 72;
  auditRetentionDays: 30;
  maxPdfBytes: number;
  storageDir: string;
  encryptionKey: Buffer;
  keyVersion: number;
  fingerprintSecret: string;
  trustedProxyHops: number;
}

export type ResumeConfig = DisabledResumeConfig | EnabledResumeConfig;

function fail(code: ResumeConfigErrorCode): never {
  throw new ResumeConfigError(code);
}

function required(env: Env, name: string, code: ResumeConfigErrorCode): string {
  const value = env[name]?.trim();
  if (!value) fail(code);
  return value;
}

function exactPublicOrigin(env: Env): string {
  const raw = required(env, 'MORSE_PUBLIC_ORIGIN', 'RESUME_PUBLIC_ORIGIN_INVALID');
  try {
    const url = new URL(raw);
    if (
      url.origin !== raw
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      fail('RESUME_PUBLIC_ORIGIN_INVALID');
    }
    return raw;
  } catch (error) {
    if (error instanceof ResumeConfigError) throw error;
    fail('RESUME_PUBLIC_ORIGIN_INVALID');
  }
}

function integerSetting(
  env: Env,
  name: string,
  minimum: number,
  maximum: number,
  code: ResumeConfigErrorCode,
  fallback?: number,
): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (value === undefined) fail(code);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code);
  return value;
}

function decodeEncryptionKey(value: string): Buffer {
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length !== 32 || decoded.toString('base64') !== value) {
      fail('RESUME_ENCRYPTION_KEY_INVALID');
    }
    return decoded;
  } catch (error) {
    if (error instanceof ResumeConfigError) throw error;
    fail('RESUME_ENCRYPTION_KEY_INVALID');
  }
}

function encryptionKey(env: Env): Buffer {
  const directValue = env.MORSE_RESUME_ENCRYPTION_KEY?.trim();
  const filePath = env.MORSE_RESUME_ENCRYPTION_KEY_FILE?.trim();
  const directKeyAllowed = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  if ((directValue && filePath) || (directValue && !directKeyAllowed)) {
    fail('RESUME_ENCRYPTION_KEY_INVALID');
  }

  if (filePath) {
    try {
      return decodeEncryptionKey(readFileSync(filePath, 'utf8').trim());
    } catch {
      fail('RESUME_ENCRYPTION_KEY_INVALID');
    }
  }
  if (directValue) return decodeEncryptionKey(directValue);
  fail('RESUME_ENCRYPTION_KEY_INVALID');
}

export function loadResumeConfig(env: Env = process.env): ResumeConfig {
  const enabledValue = env.MORSE_RESUME_ENABLED;
  const cookieName = env.MORSE_RESUME_COOKIE?.trim() || 'morse_resume_access';
  if (enabledValue === undefined || enabledValue.trim() === 'false') {
    return { enabled: false, cookieName };
  }
  if (enabledValue.trim() !== 'true') fail('RESUME_ENABLED_INVALID');

  const storageDir = required(
    env,
    'MORSE_RESUME_STORAGE_DIR',
    'RESUME_STORAGE_DIR_INVALID',
  );
  if (!path.isAbsolute(storageDir)) fail('RESUME_STORAGE_DIR_INVALID');
  const fingerprintSecret = required(
    env,
    'MORSE_RESUME_FINGERPRINT_SECRET',
    'RESUME_FINGERPRINT_SECRET_INVALID',
  );
  if (fingerprintSecret.length < 32) fail('RESUME_FINGERPRINT_SECRET_INVALID');

  return {
    enabled: true,
    databaseUrl: required(env, 'DATABASE_URL', 'RESUME_DATABASE_URL_INVALID'),
    publicOrigin: exactPublicOrigin(env),
    cookieName,
    inviteDays: 7,
    sessionHours: 72,
    auditRetentionDays: 30,
    maxPdfBytes: 10 * 1024 * 1024,
    storageDir,
    encryptionKey: encryptionKey(env),
    keyVersion: integerSetting(
      env,
      'MORSE_RESUME_KEY_VERSION',
      1,
      Number.MAX_SAFE_INTEGER,
      'RESUME_KEY_VERSION_INVALID',
    ),
    fingerprintSecret,
    trustedProxyHops: integerSetting(
      env,
      'MORSE_RESUME_TRUSTED_PROXY_HOPS',
      0,
      5,
      'RESUME_TRUSTED_PROXY_HOPS_INVALID',
      0,
    ),
  };
}
