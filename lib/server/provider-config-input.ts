import type { AiChatProtocol } from './ai-config.ts';
import { validateProviderBaseUrl } from './provider-outbound.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DECIMAL = /^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,6})?$/u;
const REASONING = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const PROTOCOLS = new Set<AiChatProtocol>(['responses', 'chat_completions']);
const ENVIRONMENT_TARGETS = new Set(['primary', 'fallback-1', 'fallback-2']);

export class ProviderConfigInputError extends Error {
  readonly code = 'AI_CONFIG_INVALID' as const;

  constructor() {
    super('AI_CONFIG_INVALID');
    this.name = 'ProviderConfigInputError';
  }
}

function invalid(): never {
  throw new ProviderConfigInputError();
}

function record(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((field) => !fields.includes(field))) invalid();
  return value;
}

function stringValue(input: unknown, min: number, max: number): string {
  if (typeof input !== 'string') invalid();
  const value = input.trim();
  if (value.length < min || value.length > max) invalid();
  return value;
}

function nullableString(input: unknown, max: number): string | null {
  if (input === null || input === undefined || input === '') return null;
  return stringValue(input, 1, max);
}

function booleanValue(input: unknown): boolean {
  if (typeof input !== 'boolean') invalid();
  return input;
}

function integer(input: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(input) || (input as number) < min || (input as number) > max) invalid();
  return input as number;
}

function uuid(input: unknown): string {
  const value = stringValue(input, 36, 36);
  if (!UUID.test(value)) invalid();
  return value.toLowerCase();
}

function decimal(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null;
  const value = typeof input === 'number' ? String(input) : input;
  if (typeof value !== 'string' || !DECIMAL.test(value)) invalid();
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000) invalid();
  return value;
}

function baseUrl(input: unknown): string {
  const raw = stringValue(input, 9, 2048);
  try {
    return validateProviderBaseUrl(raw).toString().replace(/\/$/u, '');
  } catch {
    invalid();
  }
}

function password(input: unknown): string {
  if (typeof input !== 'string' || input.length < 1 || input.length > 512) invalid();
  return input;
}

export interface ParsedModelInput {
  displayName: string;
  inputUsdPerMillion: string | null;
  maxOutputTokens: number;
  modelId: string;
  outputUsdPerMillion: string | null;
  protocol: AiChatProtocol;
  reasoningEffort: string | null;
}

export function parseModelInput(input: unknown): ParsedModelInput {
  const body = record(input, [
    'displayName', 'modelId', 'protocol', 'reasoningEffort', 'maxOutputTokens',
    'inputUsdPerMillion', 'outputUsdPerMillion',
  ]);
  if (typeof body.protocol !== 'string' || !PROTOCOLS.has(body.protocol as AiChatProtocol)) invalid();
  const reasoningEffort = nullableString(body.reasoningEffort, 32);
  if (reasoningEffort !== null && !REASONING.has(reasoningEffort)) invalid();
  return {
    displayName: stringValue(body.displayName, 1, 80),
    modelId: stringValue(body.modelId, 1, 200),
    protocol: body.protocol as AiChatProtocol,
    reasoningEffort,
    maxOutputTokens: integer(body.maxOutputTokens, 1, 100000),
    inputUsdPerMillion: decimal(body.inputUsdPerMillion),
    outputUsdPerMillion: decimal(body.outputUsdPerMillion),
  };
}

export function parseModelMutationInput(input: unknown): {
  model: ParsedModelInput;
  password: string;
} {
  const body = record(input, [
    'displayName', 'modelId', 'protocol', 'reasoningEffort', 'maxOutputTokens',
    'inputUsdPerMillion', 'outputUsdPerMillion', 'password',
  ]);
  return {
    model: parseModelInput({
      displayName: body.displayName,
      modelId: body.modelId,
      protocol: body.protocol,
      reasoningEffort: body.reasoningEffort,
      maxOutputTokens: body.maxOutputTokens,
      inputUsdPerMillion: body.inputUsdPerMillion,
      outputUsdPerMillion: body.outputUsdPerMillion,
    }),
    password: password(body.password),
  };
}

export interface ParsedConnectionCreateInput {
  apiKey: string;
  baseUrl: string;
  firstModel: ParsedModelInput;
  name: string;
  password: string;
  userAgent: string | null;
}

export function parseConnectionCreateInput(input: unknown): ParsedConnectionCreateInput {
  const body = record(input, ['name', 'baseUrl', 'userAgent', 'apiKey', 'firstModel', 'password']);
  return {
    name: stringValue(body.name, 1, 80),
    baseUrl: baseUrl(body.baseUrl),
    userAgent: nullableString(body.userAgent, 256),
    apiKey: typeof body.apiKey === 'string' && body.apiKey.length >= 1 && body.apiKey.length <= 8192
      ? body.apiKey
      : invalid(),
    firstModel: parseModelInput(body.firstModel),
    password: password(body.password),
  };
}

export interface ParsedConnectionUpdateInput {
  apiKey: string | null;
  baseUrl: string;
  name: string;
  password: string;
  reuseKeyAcrossOrigin: boolean;
  userAgent: string | null;
}

export function parseConnectionUpdateInput(input: unknown): ParsedConnectionUpdateInput {
  const body = record(input, [
    'name', 'baseUrl', 'userAgent', 'apiKey', 'reuseKeyAcrossOrigin', 'password',
  ]);
  const apiKey = body.apiKey === null || body.apiKey === undefined || body.apiKey === ''
    ? null
    : typeof body.apiKey === 'string' && body.apiKey.length <= 8192 ? body.apiKey : invalid();
  return {
    name: stringValue(body.name, 1, 80),
    baseUrl: baseUrl(body.baseUrl),
    userAgent: nullableString(body.userAgent, 256),
    apiKey,
    reuseKeyAcrossOrigin: booleanValue(body.reuseKeyAcrossOrigin),
    password: password(body.password),
  };
}

export function parsePasswordInput(input: unknown): { password: string } {
  const body = record(input, ['password']);
  return { password: password(body.password) };
}

export function parseDeleteInput(input: unknown): { confirmationName: string; password: string } {
  const body = record(input, ['password', 'confirmationName']);
  return {
    password: password(body.password),
    confirmationName: stringValue(body.confirmationName, 1, 80),
  };
}

export type ParsedRouteTarget =
  | { source: 'database'; modelId: string }
  | { source: 'environment'; environmentTargetKey: 'primary' | 'fallback-1' | 'fallback-2' };

export function parseActivateRouteInput(input: unknown): {
  expectedActiveRevision: number;
  password: string;
  targets: ParsedRouteTarget[];
} {
  const body = record(input, ['expectedActiveRevision', 'password', 'targets']);
  if (!Array.isArray(body.targets) || body.targets.length < 1 || body.targets.length > 6) invalid();
  const targets = body.targets.map((target): ParsedRouteTarget => {
    const value = record(target, ['source', 'modelId', 'environmentTargetKey']);
    if (value.source === 'database') {
      if (value.environmentTargetKey !== undefined) invalid();
      return { source: 'database', modelId: uuid(value.modelId) };
    }
    if (value.source === 'environment') {
      if (value.modelId !== undefined || typeof value.environmentTargetKey !== 'string'
        || !ENVIRONMENT_TARGETS.has(value.environmentTargetKey)) invalid();
      return {
        source: 'environment',
        environmentTargetKey: value.environmentTargetKey as 'primary' | 'fallback-1' | 'fallback-2',
      };
    }
    invalid();
  });
  const identities = targets.map((target) => target.source === 'database'
    ? `database:${target.modelId}`
    : `environment:${target.environmentTargetKey}`);
  if (new Set(identities).size !== identities.length) invalid();
  return {
    expectedActiveRevision: integer(body.expectedActiveRevision, 0, Number.MAX_SAFE_INTEGER),
    password: password(body.password),
    targets,
  };
}

function query(input: URLSearchParams, fields: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of input) {
    if (!fields.includes(name) || name in result) invalid();
    result[name] = value;
  }
  return result;
}

function queryInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^[0-9]+$/u.test(value)) invalid();
  return integer(Number(value), min, max);
}

export function parseCatalogQuery(input: URLSearchParams): {
  includeDeleted: boolean;
  limit: number;
  page: number;
} {
  const values = query(input, ['page', 'limit', 'includeDeleted']);
  if (values.includeDeleted !== undefined && !['true', 'false'].includes(values.includeDeleted)) invalid();
  return {
    page: queryInteger(values.page, 1, 1, 100000),
    limit: queryInteger(values.limit, 25, 1, 100),
    includeDeleted: values.includeDeleted === 'true',
  };
}

export function parseEventQuery(input: URLSearchParams): { limit: number; page: number } {
  const values = query(input, ['page', 'limit']);
  return {
    page: queryInteger(values.page, 1, 1, 100000),
    limit: queryInteger(values.limit, 25, 1, 100),
  };
}
