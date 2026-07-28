import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { AnswerReasoningEffort } from './ai-provider.ts';

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
  'AI_CONFIG_ENVIRONMENT_CHANGED',
  'AI_CONFIG_ENVIRONMENT_UNAVAILABLE',
  'AI_CONFIG_TAKEOVER_EXISTS',
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
export type AiConfigDigestVersion = 1 | 2;

export interface ModelCapabilities {
  contextWindowTokens: number | null;
  maxOutputTokens: number | null;
}

export interface AiRouteTargetSnapshot extends ModelCapabilities {
  configDigest: string;
  configDigestVersion: AiConfigDigestVersion;
  connectionDisplayName: string;
  databaseModelSeriesId: string | null;
  databaseModelVersionId: string | null;
  environmentTargetKey: 'primary' | 'fallback-1' | 'fallback-2' | null;
  inputUsdPerMillion: string | null;
  modelDisplayName: string;
  modelId: string;
  position: number;
  protocol: AiChatProtocol;
  reasoningEffort: AnswerReasoningEffort | null;
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

export interface AiProviderTestState {
  eligibility: 'untested' | 'eligible' | 'expired';
  latestTest: null | {
    latencyMs: number | null;
    resultCode: string;
    status: 'succeeded' | 'failed';
    testedAt: string;
  };
  successExpiresAt: string | null;
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

export interface RuntimeConfigDigestInputV1 {
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

export type RuntimeConfigDigestInputV2 = Omit<RuntimeConfigDigestInputV1, 'maxOutputTokens'>
  & ModelCapabilities;

export type RuntimeConfigDigestInput = RuntimeConfigDigestInputV1;

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

function canonicalRuntimeValueV1(input: RuntimeConfigDigestInputV1): string {
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

function canonicalRuntimeValueV2(input: RuntimeConfigDigestInputV2): string {
  return JSON.stringify({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    contextWindowTokens: input.contextWindowTokens,
    maxOutputTokens: input.maxOutputTokens,
    modelId: input.modelId,
    protocol: input.protocol,
    reasoningEffort: input.reasoningEffort,
    userAgent: input.userAgent,
  });
}

function assertDigestKey(digestKey: Buffer): void {
  if (digestKey.length !== 32) fail('AI_CONFIG_KEY_INVALID');
}

export function createRuntimeConfigDigestV1(
  input: RuntimeConfigDigestInputV1,
  digestKey: Buffer,
): string {
  assertDigestKey(digestKey);
  return createHmac('sha256', digestKey)
    .update(canonicalRuntimeValueV1(input), 'utf8')
    .digest('hex');
}

export function createRuntimeConfigDigestV2(
  input: RuntimeConfigDigestInputV2,
  digestKey: Buffer,
): string {
  assertDigestKey(digestKey);
  return createHmac('sha256', digestKey)
    .update('morse/runtime-config/v2\0', 'utf8')
    .update(canonicalRuntimeValueV2(input), 'utf8')
    .digest('hex');
}

export function createRuntimeConfigDigest(
  input: RuntimeConfigDigestInputV1,
  digestKey: Buffer,
): string {
  return createRuntimeConfigDigestV1(input, digestKey);
}
