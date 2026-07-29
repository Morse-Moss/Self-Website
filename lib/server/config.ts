import { readFileSync } from 'node:fs';

import { EMBEDDING_DIMENSIONS } from './embedding.ts';
import type { TokenRates } from './budget.ts';
import type { AnswerReasoningEffort } from './ai-provider.ts';
import {
  parseContextPacketDigestConfig,
  type ContextPacketDigestConfig,
} from './chat-context-packet.ts';

export type OpenAIReasoningEffort = AnswerReasoningEffort;

type Env = Record<string, string | undefined>;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveNumber(env: Env, name: string, fallback?: number): number {
  const raw = env[name]?.trim();
  if (!raw && fallback !== undefined) return fallback;
  if (!raw) throw new Error(`${name} is required.`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

function positiveInteger(env: Env, name: string, fallback: number): number {
  const value = positiveNumber(env, name, fallback);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function optionalPositiveInteger(env: Env, name: string): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > POSTGRES_INTEGER_MAX) {
    throw new Error(`${name} must be a positive PostgreSQL integer.`);
  }
  return value;
}

function boundedNonNegativeInteger(
  env: Env,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an integer between 0 and ${maximum}.`);
  }
  return value;
}

function boundedPositiveInteger(
  env: Env,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = positiveInteger(env, name, fallback);
  if (value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function exactApplicationOrigin(env: Env, name: string): string {
  const raw = required(env, name);
  try {
    const url = new URL(raw);
    const isLoopbackHttp = url.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !isLoopbackHttp)
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new Error(`${name} must be an exact credential-free HTTPS or loopback HTTP origin.`);
  }
}

function interactionRetentionDays(env: Env): number {
  const name = 'MORSE_INTERACTION_RETENTION_DAYS';
  const value = positiveInteger(env, name, 10);
  if (value !== 10) throw new Error(`${name} must be 10.`);
  return value;
}

function booleanSetting(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function uuidList(env: Env, name: string): ReadonlySet<string> {
  const values = env[name]?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = value.toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(normalized)) {
      throw new Error(`${name} must contain comma-separated canonical UUID values.`);
    }
    unique.add(normalized);
  }
  return unique;
}

function exactLabelList(env: Env, name: string): ReadonlySet<string> {
  const configured = env[name];
  if (configured && /[\u0000-\u001f\u007f]/u.test(configured)) {
    throw new Error(`${name} must contain comma-separated labels without control characters.`);
  }
  const raw = configured?.trim();
  if (!raw) return new Set();
  const values = raw.split(',').map((value) => value.trim());
  if (values.length > 100 || values.some((value) => value.length === 0)) {
    throw new Error(`${name} must contain between 1 and 100 non-empty comma-separated labels.`);
  }
  const unique = new Set<string>();
  for (const value of values) {
    if (value.length > 160 || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new Error(`${name} must contain comma-separated labels without control characters.`);
    }
    unique.add(value);
  }
  return unique;
}

function contextPacketDigest(
  env: Env,
  enabled: boolean,
): ContextPacketDigestConfig | null {
  if (!enabled) return null;
  const direct = env.MORSE_CONTEXT_PACKET_DIGEST_KEY;
  const filePath = env.MORSE_CONTEXT_PACKET_DIGEST_KEY_FILE?.trim();
  const directPresent = Boolean(direct?.length);
  const directAllowed = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  if ((directPresent && filePath) || (directPresent && !directAllowed)) {
    throw new Error('CONTEXT_PACKET_DIGEST_CONFIG_INVALID');
  }
  let encoded: string | undefined;
  if (filePath) {
    try {
      encoded = readFileSync(filePath, 'utf8').trim();
    } catch {
      throw new Error('CONTEXT_PACKET_DIGEST_CONFIG_INVALID');
    }
  } else if (directPresent) {
    encoded = direct;
  }
  return parseContextPacketDigestConfig({
    enabled,
    digestKey: encoded,
    digestKeyId: env.MORSE_CONTEXT_PACKET_DIGEST_KEY_ID,
  });
}

function tokenRates(env: Env): TokenRates | null {
  const input = env.MORSE_INPUT_USD_PER_MILLION?.trim();
  const output = env.MORSE_OUTPUT_USD_PER_MILLION?.trim();
  if (!input && !output) return null;
  if (!input || !output) {
    throw new Error(
      'MORSE_INPUT_USD_PER_MILLION and MORSE_OUTPUT_USD_PER_MILLION must both be set or both be omitted.',
    );
  }
  return {
    inputUsdPerMillion: positiveNumber(env, 'MORSE_INPUT_USD_PER_MILLION'),
    outputUsdPerMillion: positiveNumber(env, 'MORSE_OUTPUT_USD_PER_MILLION'),
  };
}

function chatProtocol(env: Env): 'responses' | 'chat_completions' {
  const value = required(env, 'OPENAI_CHAT_PROTOCOL');
  if (value !== 'responses' && value !== 'chat_completions') {
    throw new Error('OPENAI_CHAT_PROTOCOL must be responses or chat_completions.');
  }
  return value;
}

function reasoningEffort(env: Env): AnswerReasoningEffort | undefined {
  const value = env.OPENAI_REASONING_EFFORT?.trim();
  if (!value) return undefined;
  if (!['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value)) {
    throw new Error(
      'OPENAI_REASONING_EFFORT must be none, minimal, low, medium, high, or xhigh.',
    );
  }
  return value as AnswerReasoningEffort;
}

function openAiFallbacks(env: Env): Array<{ apiKey: string; baseUrl: string }> {
  const fallbacks: Array<{ apiKey: string; baseUrl: string }> = [];
  for (const index of [1, 2]) {
    const apiKeyName = `OPENAI_FALLBACK_${index}_API_KEY`;
    const baseUrlName = `OPENAI_FALLBACK_${index}_BASE_URL`;
    const apiKey = env[apiKeyName]?.trim();
    const baseUrl = env[baseUrlName]?.trim();
    if (Boolean(apiKey) !== Boolean(baseUrl)) {
      throw new Error(`${apiKeyName} and ${baseUrlName} must both be set or both be omitted.`);
    }
    if (apiKey && baseUrl) fallbacks.push({ apiKey, baseUrl });
  }
  return fallbacks;
}

function optionalHeaderValue(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  if (value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${name} must be a single HTTP header value of at most 256 characters.`);
  }
  return value;
}

function commaSeparatedDomains(env: Env, name: string): string[] {
  const values = env[name]?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  const unique = new Map<string, string>();
  for (const value of values) {
    const normalized = value.toLowerCase().replace(/\.$/u, '');
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(normalized)) {
      throw new Error(`${name} must contain comma-separated domain names.`);
    }
    if (normalized === 'github.com') {
      throw new Error(`${name} cannot classify GitHub without an owner allowlist.`);
    }
    unique.set(normalized, normalized);
  }
  return [...unique.values()];
}

function commaSeparatedGithubOwners(env: Env, name: string): string[] {
  const values = env[name]?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  const unique = new Map<string, string>();
  for (const value of values) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/iu.test(value)) {
      throw new Error(`${name} must contain comma-separated GitHub owners.`);
    }
    const key = value.toLowerCase();
    if (!unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()];
}

function bochaBaseUrl(env: Env): string {
  const name = 'BOCHA_BASE_URL';
  const raw = required(env, name);
  try {
    const url = new URL(raw);
    const loopbackHttp = url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if (
      (url.protocol !== 'https:' && !loopbackHttp)
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      throw new Error();
    }
    const pathname = url.pathname.replace(/\/+$/u, '');
    return `${url.origin}${pathname}`;
  } catch {
    throw new Error(`${name} must be a credential-free HTTPS or loopback HTTP base URL.`);
  }
}

function searchSettings(env: Env) {
  const searchEnabled = booleanSetting(env, 'MORSE_SEARCH_ENABLED', false);
  const maxSearchesPerSession = positiveInteger(env, 'MORSE_MAX_SEARCHES_PER_SESSION', 5);
  if (maxSearchesPerSession > 5) {
    throw new Error('MORSE_MAX_SEARCHES_PER_SESSION must be at most 5.');
  }
  const searchConcurrency = positiveInteger(env, 'MORSE_SEARCH_CONCURRENCY', 2);
  if (searchConcurrency > 2) {
    throw new Error('MORSE_SEARCH_CONCURRENCY must be at most 2.');
  }
  const common = {
    searchEnabled,
    maxSearchesPerSession,
    searchConcurrency,
    searchTimeoutMs: positiveNumber(env, 'MORSE_SEARCH_TIMEOUT_MS', 12_000),
    officialSourceDomains: commaSeparatedDomains(env, 'MORSE_OFFICIAL_SOURCE_DOMAINS'),
    officialGithubOwners: commaSeparatedGithubOwners(env, 'MORSE_OFFICIAL_GITHUB_OWNERS'),
  };
  if (!searchEnabled) {
    return {
      ...common,
      searchProvider: null,
      bochaApiKey: null,
      bochaBaseUrl: null,
    } as const;
  }
  const searchProvider = required(env, 'MORSE_SEARCH_PROVIDER');
  if (searchProvider !== 'bocha') {
    throw new Error('MORSE_SEARCH_PROVIDER must be bocha when search is enabled.');
  }
  return {
    ...common,
    searchProvider: 'bocha',
    bochaApiKey: required(env, 'BOCHA_API_KEY'),
    bochaBaseUrl: bochaBaseUrl(env),
  } as const;
}

export function loadAccessConfig(env: Env = process.env) {
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    cookieName: env.MORSE_ACCESS_COOKIE?.trim() || 'morse_access',
    maxMessagesPerSession: positiveNumber(env, 'MORSE_MAX_MESSAGES_PER_SESSION', 30),
  };
}

export function loadAdminConfig(env: Env = process.env) {
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    cookieName: env.MORSE_ADMIN_COOKIE?.trim() || 'morse_admin',
    passwordHash: required(env, 'MORSE_ADMIN_PASSWORD_HASH'),
    allowedOrigin: exactApplicationOrigin(env, 'MORSE_ADMIN_ALLOWED_ORIGIN'),
    sessionMinutes: boundedPositiveInteger(
      env,
      'MORSE_ADMIN_SESSION_MINUTES',
      30,
      1,
      30,
    ),
    sessionMaxAgeHours: boundedPositiveInteger(
      env,
      'MORSE_ADMIN_SESSION_MAX_AGE_HOURS',
      12,
      1,
      24,
    ),
    maxFailedAttempts: boundedPositiveInteger(
      env,
      'MORSE_ADMIN_MAX_FAILED_ATTEMPTS',
      5,
      1,
      5,
    ),
    lockMinutes: boundedPositiveInteger(env, 'MORSE_ADMIN_LOCK_MINUTES', 15, 1, 60),
  };
}

export function loadInviteAbuseConfig(env: Env = process.env) {
  const fingerprintSecret = required(env, 'MORSE_INVITE_FINGERPRINT_SECRET');
  if (fingerprintSecret.length < 32) {
    throw new Error('MORSE_INVITE_FINGERPRINT_SECRET must contain at least 32 characters.');
  }
  const attemptWindowSeconds = boundedPositiveInteger(
    env,
    'MORSE_INVITE_ATTEMPT_WINDOW_SECONDS',
    600,
    60,
    3_600,
  );
  const lockSeconds = boundedPositiveInteger(
    env,
    'MORSE_INVITE_LOCK_SECONDS',
    900,
    60,
    86_400,
  );
  if (lockSeconds < attemptWindowSeconds) {
    throw new Error(
      'MORSE_INVITE_LOCK_SECONDS must be at least MORSE_INVITE_ATTEMPT_WINDOW_SECONDS.',
    );
  }
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    fingerprintSecret,
    attemptWindowSeconds,
    maxFailedAttempts: boundedPositiveInteger(
      env,
      'MORSE_INVITE_MAX_FAILED_ATTEMPTS',
      5,
      1,
      5,
    ),
    lockSeconds,
    trustedProxyHops: boundedNonNegativeInteger(
      env,
      'MORSE_INVITE_TRUSTED_PROXY_HOPS',
      0,
      5,
    ),
  };
}

export function loadServerConfig(env: Env = process.env) {
  const access = loadAccessConfig(env);
  const openaiApiKey = required(env, 'OPENAI_API_KEY');
  const openaiBaseUrl = env.OPENAI_BASE_URL?.trim() || undefined;
  const search = searchSettings(env);
  const chatV2CanaryPercent = boundedNonNegativeInteger(
    env,
    'MORSE_CHAT_V2_CANARY_PERCENT',
    0,
    100,
  );
  const chatV2CanaryInviteIds = uuidList(env, 'MORSE_CHAT_V2_CANARY_INVITE_IDS');
  const contextPacketEnabled = booleanSetting(
    env,
    'MORSE_CHAT_CONTEXT_PACKET_ENABLED',
    false,
  );
  const contextCanaryPercent = boundedNonNegativeInteger(
    env,
    'MORSE_CHAT_CONTEXT_CANARY_PERCENT',
    0,
    100,
  );
  const contextCanaryInviteIds = uuidList(env, 'MORSE_CHAT_CONTEXT_CANARY_INVITE_IDS');
  const contextCanaryInviteLabels = exactLabelList(
    env,
    'MORSE_CHAT_CONTEXT_CANARY_INVITE_LABELS',
  );
  const dynamicProviderContextEnabled = booleanSetting(
    env,
    'MORSE_DYNAMIC_PROVIDER_CONTEXT_ENABLED',
    false,
  );
  const contextPacketDigestConfig = contextPacketDigest(
    env,
    contextPacketEnabled || dynamicProviderContextEnabled,
  );
  const providerFirstByteTimeoutMs = positiveNumber(
    env,
    'MORSE_PROVIDER_FIRST_BYTE_TIMEOUT_MS',
    40_000,
  );
  const providerProtocolEventTimeoutMs = positiveNumber(
    env,
    'MORSE_PROVIDER_PROTOCOL_EVENT_TIMEOUT_MS',
    35_000,
  );
  const providerModelTextTimeoutMs = positiveNumber(
    env,
    'MORSE_PROVIDER_MODEL_TEXT_TIMEOUT_MS',
    70_000,
  );
  const providerStageTimeoutMs = positiveNumber(
    env,
    'MORSE_PROVIDER_STAGE_TIMEOUT_MS',
    300_000,
  );
  const chatTurnTimeoutMs = positiveNumber(env, 'MORSE_CHAT_TURN_TIMEOUT_MS', 330_000);
  const chatWindowSeconds = boundedPositiveInteger(
    env,
    'MORSE_CHAT_WINDOW_SECONDS',
    60,
    1,
    3_600,
  );
  const chatWindowMaxMessages = boundedPositiveInteger(
    env,
    'MORSE_CHAT_WINDOW_MAX_MESSAGES',
    10,
    1,
    100,
  );
  if (
    providerFirstByteTimeoutMs < providerProtocolEventTimeoutMs
    || providerProtocolEventTimeoutMs >= providerModelTextTimeoutMs
    || providerModelTextTimeoutMs > providerStageTimeoutMs
    || providerStageTimeoutMs >= chatTurnTimeoutMs
  ) {
    throw new Error(
      'MORSE_PROVIDER timing must satisfy first byte >= protocol event < model text <= provider stage < chat turn.',
    );
  }
  return {
    ...access,
    ...search,
    openaiApiKey,
    openaiBaseUrl,
    openaiUserAgent: optionalHeaderValue(env, 'OPENAI_COMPAT_USER_AGENT'),
    chatModel: required(env, 'OPENAI_CHAT_MODEL'),
    chatProtocol: chatProtocol(env),
    reasoningEffort: reasoningEffort(env),
    openaiFallbacks: openAiFallbacks(env),
    embeddingApiKey: env.OPENAI_EMBEDDING_API_KEY?.trim() || openaiApiKey,
    embeddingBaseUrl: env.OPENAI_EMBEDDING_BASE_URL?.trim() || openaiBaseUrl,
    embeddingModel: required(env, 'OPENAI_EMBEDDING_MODEL'),
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    embeddingTimeoutMs: positiveNumber(env, 'MORSE_EMBEDDING_TIMEOUT_MS', 8_000),
    providerFirstByteTimeoutMs,
    providerTotalTimeoutMs: positiveNumber(env, 'MORSE_PROVIDER_TOTAL_TIMEOUT_MS', 300_000),
    providerProtocolEventTimeoutMs,
    providerModelTextTimeoutMs,
    providerStageTimeoutMs,
    chatTurnTimeoutMs,
    chatWindowSeconds,
    chatWindowMaxMessages,
    providerConcurrency: positiveInteger(env, 'MORSE_PROVIDER_CONCURRENCY', 4),
    chatContextWindowTokens: optionalPositiveInteger(env, 'MORSE_CHAT_CONTEXT_WINDOW_TOKENS'),
    maxOutputTokens: optionalPositiveInteger(env, 'MORSE_MAX_OUTPUT_TOKENS'),
    dynamicProviderContextEnabled,
    chatEnabled: booleanSetting(env, 'MORSE_CHAT_ENABLED', true),
    chatV2Enabled: booleanSetting(env, 'MORSE_CHAT_V2_ENABLED', false),
    chatV2CanaryPercent,
    chatV2CanaryInviteIds,
    contextPacketEnabled,
    contextCanaryPercent,
    contextCanaryInviteIds,
    contextCanaryInviteLabels,
    contextPacketDigest: contextPacketDigestConfig,
    hedgedFailoverEnabled: booleanSetting(env, 'MORSE_CHAT_HEDGED_FAILOVER_ENABLED', false),
    chatSafeMode: booleanSetting(env, 'MORSE_CHAT_SAFE_MODE', false),
    sseHeartbeatMs: positiveInteger(env, 'MORSE_SSE_HEARTBEAT_MS', 15_000),
    interactionRetentionDays: interactionRetentionDays(env),
    tokenRates: tokenRates(env),
  };
}
