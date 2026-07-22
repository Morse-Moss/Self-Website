import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

type Env = Record<string, string | undefined>;

export const AI_CONFIG_PUBLIC_ERROR_CODES = [
  'AI_CONFIG_UNAVAILABLE',
  'AI_CONFIG_INVALID',
  'AI_CONFIG_CONFLICT',
  'AI_CONFIG_TEST_REQUIRED',
  'AI_CONFIG_TEST_FAILED',
  'AI_CONFIG_IN_USE',
  'AI_CONFIG_HISTORY_RETAINED',
  'AI_CONFIG_SECRET_UNAVAILABLE',
  'AI_CONFIG_TARGET_DELETED',
  'AI_CONFIG_RATE_LIMITED',
] as const;

export type AiConfigPublicErrorCode = typeof AI_CONFIG_PUBLIC_ERROR_CODES[number];

export type AiConfigErrorCode = AiConfigPublicErrorCode
  | 'AI_CONFIG_KEY_INVALID'
  | 'AI_CONFIG_KEY_VERSION_INVALID'
  | 'AI_CONFIG_NOT_FOUND';

export class AiConfigError extends Error {
  readonly code: AiConfigErrorCode;

  constructor(code: AiConfigErrorCode) {
    super(code);
    this.name = 'AiConfigError';
    this.code = code;
  }
}

export interface AiConfigKey {
  key: Buffer;
  keyVersion: number;
}

export type AiChatProtocol = 'responses' | 'chat_completions';
export type AiRouteSourceType = 'database' | 'environment';

export interface AiRouteTargetSnapshot {
  configDigest: string;
  connectionDisplayName: string;
  databaseModelSeriesId: string | null;
  databaseModelVersionId: string | null;
  environmentTargetKey: 'primary' | 'fallback-1' | 'fallback-2' | null;
  inputUsdPerMillion: string | null;
  modelDisplayName: string;
  modelId: string;
  position: number;
  protocol: AiChatProtocol;
  outputUsdPerMillion: string | null;
  sourceType: AiRouteSourceType;
}

export interface AiRouteRevisionSnapshot {
  id: string;
  lockVersion: number;
  revisionNumber: number;
  targets: AiRouteTargetSnapshot[];
}

export interface AiProviderTestSummary {
  configDigest: string;
  itemCount: number | null;
  latencyMs: number | null;
  resultCode: string;
  status: 'succeeded' | 'failed' | 'denied';
  testedAt: Date;
}

export interface AiProviderAttemptSummary {
  attemptIndex: number;
  configDigest: string;
  costComplete: boolean;
  inputTokens: number | null;
  knownCostUsd: string | null;
  outputTokens: number | null;
  status: 'started' | 'completed' | 'failed' | 'stopped';
  targetPosition: number | null;
}

export interface RuntimeConfigDigestInput {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  protocol: AiChatProtocol;
  reasoningEffort: string | null;
  userAgent: string | null;
  maxOutputTokens: number;
  displayName?: string;
  inputUsdPerMillion?: string | null;
  outputUsdPerMillion?: string | null;
}

function fail(code: AiConfigErrorCode): never {
  throw new AiConfigError(code);
}

function decodeKey(value: string): Buffer {
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length !== 32 || decoded.toString('base64') !== value) {
      fail('AI_CONFIG_KEY_INVALID');
    }
    return decoded;
  } catch (error) {
    if (error instanceof AiConfigError) throw error;
    fail('AI_CONFIG_KEY_INVALID');
  }
}

function parseKeyVersion(value: string | undefined): number {
  const version = Number(value?.trim());
  if (!Number.isSafeInteger(version) || version < 1) {
    fail('AI_CONFIG_KEY_VERSION_INVALID');
  }
  return version;
}

export function loadAiConfigKey(env: Env = process.env): AiConfigKey {
  const directValue = env.MORSE_PROVIDER_CONFIG_KEY;
  const directPresent = Boolean(directValue?.length);
  const filePath = env.MORSE_PROVIDER_CONFIG_KEY_FILE?.trim();
  const directAllowed = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  if (
    (directPresent && filePath)
    || (directPresent && !directAllowed)
  ) {
    fail('AI_CONFIG_KEY_INVALID');
  }

  let encoded: string;
  if (filePath) {
    try {
      encoded = readFileSync(filePath, 'utf8').trim();
    } catch {
      fail('AI_CONFIG_KEY_INVALID');
    }
  } else if (directPresent && directValue !== undefined) {
    encoded = directValue;
  } else {
    fail('AI_CONFIG_KEY_INVALID');
  }

  return {
    key: decodeKey(encoded),
    keyVersion: parseKeyVersion(env.MORSE_PROVIDER_CONFIG_KEY_VERSION),
  };
}

function canonicalRuntimeValue(input: RuntimeConfigDigestInput): string {
  return JSON.stringify({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    maxOutputTokens: input.maxOutputTokens,
    modelId: input.modelId,
    protocol: input.protocol,
    reasoningEffort: input.reasoningEffort,
    userAgent: input.userAgent,
  });
}

export function createRuntimeConfigDigest(
  input: RuntimeConfigDigestInput,
  digestKey: Buffer,
): string {
  if (digestKey.length !== 32) fail('AI_CONFIG_KEY_INVALID');
  return createHmac('sha256', digestKey)
    .update(canonicalRuntimeValue(input), 'utf8')
    .digest('hex');
}
