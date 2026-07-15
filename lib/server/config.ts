import { EMBEDDING_DIMENSIONS } from './embedding.ts';

type Env = Record<string, string | undefined>;

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

function chatProtocol(env: Env): 'responses' | 'chat_completions' {
  const value = required(env, 'OPENAI_CHAT_PROTOCOL');
  if (value !== 'responses' && value !== 'chat_completions') {
    throw new Error('OPENAI_CHAT_PROTOCOL must be responses or chat_completions.');
  }
  return value;
}

export function loadAccessConfig(env: Env = process.env) {
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    cookieName: env.MORSE_ACCESS_COOKIE?.trim() || 'morse_access',
    sessionHours: positiveNumber(env, 'MORSE_SESSION_HOURS', 12),
    maxMessagesPerSession: positiveNumber(env, 'MORSE_MAX_MESSAGES_PER_SESSION', 30),
  };
}

export function loadServerConfig(env: Env = process.env) {
  const access = loadAccessConfig(env);
  const openaiApiKey = required(env, 'OPENAI_API_KEY');
  const openaiBaseUrl = env.OPENAI_BASE_URL?.trim() || undefined;

  return {
    ...access,
    openaiApiKey,
    openaiBaseUrl,
    chatModel: required(env, 'OPENAI_CHAT_MODEL'),
    chatProtocol: chatProtocol(env),
    embeddingApiKey: env.OPENAI_EMBEDDING_API_KEY?.trim() || openaiApiKey,
    embeddingBaseUrl: env.OPENAI_EMBEDDING_BASE_URL?.trim() || openaiBaseUrl,
    embeddingModel: required(env, 'OPENAI_EMBEDDING_MODEL'),
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    embeddingTimeoutMs: positiveNumber(env, 'MORSE_EMBEDDING_TIMEOUT_MS', 8_000),
    providerFirstByteTimeoutMs: positiveNumber(
      env,
      'MORSE_PROVIDER_FIRST_BYTE_TIMEOUT_MS',
      20_000,
    ),
    providerTotalTimeoutMs: positiveNumber(env, 'MORSE_PROVIDER_TOTAL_TIMEOUT_MS', 90_000),
    providerConcurrency: positiveInteger(env, 'MORSE_PROVIDER_CONCURRENCY', 4),
    maxOutputTokens: positiveNumber(env, 'MORSE_MAX_OUTPUT_TOKENS', 600),
    historyMessageLimit: positiveNumber(env, 'MORSE_HISTORY_MESSAGE_LIMIT', 12),
    retrievalLimit: positiveNumber(env, 'MORSE_RETRIEVAL_LIMIT', 5),
    monthlyBudgetUsd: positiveNumber(env, 'MORSE_MONTHLY_BUDGET_USD', 5),
    tokenRates: {
      inputUsdPerMillion: positiveNumber(env, 'MORSE_INPUT_USD_PER_MILLION'),
      outputUsdPerMillion: positiveNumber(env, 'MORSE_OUTPUT_USD_PER_MILLION'),
    },
  };
}
