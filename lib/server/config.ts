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

  return {
    ...access,
    openaiApiKey: required(env, 'OPENAI_API_KEY'),
    openaiBaseUrl: env.OPENAI_BASE_URL?.trim() || undefined,
    chatModel: required(env, 'OPENAI_CHAT_MODEL'),
    embeddingModel: required(env, 'OPENAI_EMBEDDING_MODEL'),
    embeddingDimensions: EMBEDDING_DIMENSIONS,
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
