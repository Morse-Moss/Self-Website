import type pg from 'pg';

export type DatabaseProcessRole = 'web' | 'worker' | 'migration' | 'ingest';
type Env = Record<string, string | undefined>;

export class DatabaseConfigError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'DatabaseConfigError';
    this.code = code;
  }
}

function boundedInteger(
  env: Env,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  code: string,
): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new DatabaseConfigError(code);
  }
  return value;
}

function validateConnectionString(connectionString: string): URL {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new DatabaseConfigError('DATABASE_URL_INVALID');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new DatabaseConfigError('DATABASE_URL_INVALID');
  }
  const forbiddenTlsParameters = ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'];
  if (forbiddenTlsParameters.some((name) => url.searchParams.has(name))) {
    throw new DatabaseConfigError('DATABASE_URL_TLS_OVERRIDE_FORBIDDEN');
  }
  if (url.searchParams.size > 0) {
    throw new DatabaseConfigError('DATABASE_URL_QUERY_FORBIDDEN');
  }
  return url;
}

function isLocalReleaseContext(env: Env, databaseUrl: URL): boolean {
  if (env.MORSE_LOCAL_RELEASE_SMOKE?.trim() !== 'true') return false;
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(databaseUrl.hostname)) return false;
  try {
    const publicOrigin = new URL(env.MORSE_PUBLIC_ORIGIN?.trim() ?? '');
    return publicOrigin.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(publicOrigin.hostname)
      && publicOrigin.username === ''
      && publicOrigin.password === ''
      && publicOrigin.pathname === '/'
      && publicOrigin.search === ''
      && publicOrigin.hash === '';
  } catch {
    return false;
  }
}

function databaseSsl(env: Env, databaseUrl: URL): pg.ConnectionConfig['ssl'] {
  const mode = env.MORSE_DATABASE_SSL_MODE?.trim()
    || (env.NODE_ENV === 'production' ? '' : 'disable');
  if (mode === 'disable') {
    if (env.NODE_ENV === 'production' && !isLocalReleaseContext(env, databaseUrl)) {
      throw new DatabaseConfigError('DATABASE_TLS_REQUIRED');
    }
    return false;
  }
  if (mode === 'require') {
    return { rejectUnauthorized: false };
  }
  if (mode === 'verify-full') {
    const ca = env.MORSE_DATABASE_SSL_CA?.trim();
    if (!ca) throw new DatabaseConfigError('DATABASE_SSL_CA_REQUIRED');
    return { ca, rejectUnauthorized: true };
  }
  throw new DatabaseConfigError('DATABASE_SSL_MODE_INVALID');
}

export interface DatabasePoolConfigInput {
  env?: Env;
  role: DatabaseProcessRole;
}

export function createDatabaseClientConfig(
  connectionString: string,
  input: DatabasePoolConfigInput,
): pg.ClientConfig {
  const env = input.env ?? process.env;
  const databaseUrl = validateConnectionString(connectionString);
  return {
    connectionString,
    connectionTimeoutMillis: boundedInteger(
      env,
      'MORSE_DATABASE_CONNECT_TIMEOUT_MS',
      5_000,
      100,
      60_000,
      'DATABASE_CONNECT_TIMEOUT_INVALID',
    ),
    statement_timeout: boundedInteger(
      env,
      'MORSE_DATABASE_STATEMENT_TIMEOUT_MS',
      30_000,
      100,
      600_000,
      'DATABASE_STATEMENT_TIMEOUT_INVALID',
    ),
    idle_in_transaction_session_timeout: boundedInteger(
      env,
      'MORSE_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS',
      30_000,
      100,
      600_000,
      'DATABASE_IDLE_TRANSACTION_TIMEOUT_INVALID',
    ),
    application_name: `revolution-${input.role}`,
    ssl: databaseSsl(env, databaseUrl),
  };
}

export function createDatabasePoolConfig(
  connectionString: string,
  input: DatabasePoolConfigInput,
): pg.PoolConfig {
  const env = input.env ?? process.env;
  return {
    ...createDatabaseClientConfig(connectionString, input),
    max: boundedInteger(
      env,
      'MORSE_DATABASE_POOL_MAX',
      input.role === 'worker' ? 3 : 10,
      1,
      100,
      'DATABASE_POOL_MAX_INVALID',
    ),
    idleTimeoutMillis: boundedInteger(
      env,
      'MORSE_DATABASE_IDLE_TIMEOUT_MS',
      30_000,
      1_000,
      600_000,
      'DATABASE_IDLE_TIMEOUT_INVALID',
    ),
  };
}
