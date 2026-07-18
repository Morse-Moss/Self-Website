import {
  DatabaseConfigError,
  createDatabasePoolConfig,
  type DatabaseProcessRole,
} from './database-config.ts';
import {
  loadAdminConfig,
  loadInviteAbuseConfig,
  loadServerConfig,
} from './config.ts';
import {
  isCanonicalAdminTotpSecret,
  isSupportedAdminPasswordHash,
} from './admin-auth.ts';
import { loadWorkerConfig, WorkerConfigError } from './worker-config.ts';

export type ProductionRole = DatabaseProcessRole;
type Env = Record<string, string | undefined>;

export class ProductionConfigError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ProductionConfigError';
    this.code = code;
  }
}

function fail(code: string): never {
  throw new ProductionConfigError(code);
}

function exactHttpsUrl(value: string | undefined, originOnly = false): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.search
      || url.hash
      || (originOnly && (url.pathname !== '/' || url.search))
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/u.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || octets[0] === 127;
}

function privateHttpUrl(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    const internalHostname = hostname === 'localhost'
      || isPrivateIpv4(hostname)
      || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(hostname);
    if (
      url.protocol !== 'http:'
      || !internalHostname
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function validateDatabase(env: Env, role: ProductionRole): void {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) fail('PRODUCTION_DATABASE_CONFIG_INVALID');
  try {
    createDatabasePoolConfig(connectionString, { env, role });
  } catch (error) {
    if (
      error instanceof DatabaseConfigError
      && ['DATABASE_TLS_REQUIRED', 'DATABASE_SSL_MODE_INVALID', 'DATABASE_SSL_CA_REQUIRED']
        .includes(error.code)
    ) {
      fail('PRODUCTION_DATABASE_TLS_REQUIRED');
    }
    fail('PRODUCTION_DATABASE_CONFIG_INVALID');
  }
}

function validateEmbedding(env: Env): void {
  if (env.MORSE_ALLOW_TEST_EMBEDDINGS?.trim() === 'true') {
    fail('PRODUCTION_TEST_EMBEDDINGS_FORBIDDEN');
  }
  if (
    env.MORSE_ALLOW_TEST_EMBEDDINGS?.trim()
    && env.MORSE_ALLOW_TEST_EMBEDDINGS?.trim() !== 'false'
  ) {
    fail('PRODUCTION_EMBEDDING_CONFIG_INVALID');
  }
  const apiKey = env.OPENAI_EMBEDDING_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_EMBEDDING_MODEL?.trim();
  const baseUrl = env.OPENAI_EMBEDDING_BASE_URL?.trim()
    || env.OPENAI_BASE_URL?.trim()
    || 'https://api.openai.com/v1';
  const privateHttpFlag = env.MORSE_EMBEDDING_ALLOW_PRIVATE_HTTP?.trim();
  if (privateHttpFlag && !['true', 'false'].includes(privateHttpFlag)) {
    fail('PRODUCTION_EMBEDDING_CONFIG_INVALID');
  }
  const baseUrlValid = Boolean(exactHttpsUrl(baseUrl))
    || (privateHttpFlag === 'true' && Boolean(privateHttpUrl(baseUrl)));
  if (!apiKey || !model || !baseUrlValid) {
    fail('PRODUCTION_EMBEDDING_CONFIG_INVALID');
  }
}

function validateWeb(env: Env): void {
  const publicOrigin = exactHttpsUrl(env.MORSE_PUBLIC_ORIGIN, true);
  if (!publicOrigin) fail('PRODUCTION_PUBLIC_ORIGIN_INVALID');
  const adminOrigin = exactHttpsUrl(env.MORSE_ADMIN_ALLOWED_ORIGIN, true);
  if (!adminOrigin || adminOrigin.origin !== publicOrigin.origin) {
    fail('PRODUCTION_ADMIN_ORIGIN_MISMATCH');
  }
  if (
    !isSupportedAdminPasswordHash(env.MORSE_ADMIN_PASSWORD_HASH?.trim() ?? '')
    || !isCanonicalAdminTotpSecret(env.MORSE_ADMIN_TOTP_SECRET ?? '')
  ) {
    fail('PRODUCTION_ADMIN_CREDENTIALS_INVALID');
  }
  if ((env.MORSE_INVITE_FINGERPRINT_SECRET?.trim().length ?? 0) < 32) {
    fail('PRODUCTION_INVITE_SECRET_INVALID');
  }
  const providerBaseUrl = env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
  if (
    !env.OPENAI_API_KEY?.trim()
    || !env.OPENAI_CHAT_MODEL?.trim()
    || !['responses', 'chat_completions'].includes(env.OPENAI_CHAT_PROTOCOL?.trim() ?? '')
    || !exactHttpsUrl(providerBaseUrl)
  ) {
    fail('PRODUCTION_PROVIDER_CONFIG_INVALID');
  }
  validateEmbedding(env);
  if (env.MORSE_SEARCH_ENABLED?.trim() === 'true' && !exactHttpsUrl(env.BOCHA_BASE_URL)) {
    fail('PRODUCTION_SEARCH_CONFIG_INVALID');
  }
  try {
    loadServerConfig(env);
    loadAdminConfig(env);
    loadInviteAbuseConfig(env);
  } catch {
    fail('PRODUCTION_RUNTIME_CONFIG_INVALID');
  }
}

function validateWorker(env: Env): boolean {
  try {
    return loadWorkerConfig(env).alertsEnabled;
  } catch (error) {
    if (error instanceof WorkerConfigError) {
      if (error.code === 'WORKER_ALERT_MODE_REQUIRED') fail('PRODUCTION_ALERT_MODE_REQUIRED');
      if (error.code === 'WORKER_FEISHU_CONFIG_INVALID') {
        fail('PRODUCTION_FEISHU_CONFIG_INVALID');
      }
      fail('PRODUCTION_WORKER_CONFIG_INVALID');
    }
    fail('PRODUCTION_WORKER_CONFIG_INVALID');
  }
}

export function validateProductionRole(
  role: ProductionRole,
  env: Env = process.env,
): { alertsEnabled: boolean | null; role: ProductionRole } {
  if (env.NODE_ENV !== 'production') fail('PRODUCTION_NODE_ENV_REQUIRED');
  if (env.MORSE_LOCAL_RELEASE_SMOKE?.trim() === 'true') {
    fail('PRODUCTION_LOCAL_SMOKE_FORBIDDEN');
  }
  validateDatabase(env, role);
  if (role === 'web') validateWeb(env);
  if (role === 'ingest') validateEmbedding(env);
  const alertsEnabled = role === 'worker' ? validateWorker(env) : null;
  return { alertsEnabled, role };
}
