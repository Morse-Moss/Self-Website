export type ProviderFailureCategory =
  | 'context_overflow'
  | 'output_truncated'
  | 'incomplete'
  | 'provider_failed'
  | 'transport'
  | 'timeout'
  | 'cancelled';

export type ProviderFailureReason =
  | 'http_413'
  | 'context_length_exceeded'
  | 'max_output_tokens'
  | 'length'
  | 'response_incomplete'
  | 'response_failed'
  | 'stream_failed'
  | 'transport'
  | 'timeout'
  | 'cancelled';

export interface SanitizedProviderFailure {
  category: ProviderFailureCategory;
  reason: ProviderFailureReason;
  httpStatus: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  contextWindowTokens: number | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function allowlistedReason(value: unknown): ProviderFailureReason | null {
  switch (value) {
    case 'context_length_exceeded':
    case 'max_output_tokens':
    case 'length':
    case 'response_incomplete':
    case 'response_failed':
    case 'stream_failed':
    case 'transport':
    case 'timeout':
    case 'cancelled':
      return value;
    default:
      return null;
  }
}

function isNearKnownContextLimit(input: {
  inputTokens: number | null;
  outputTokens: number | null;
  contextWindowTokens: number | null;
}): boolean {
  return input.outputTokens === 0
    && input.contextWindowTokens !== null
    && input.inputTokens !== null
    && input.inputTokens >= Math.floor(input.contextWindowTokens * 0.99);
}

export function sanitizeProviderFailure(value: unknown): SanitizedProviderFailure {
  const input = record(value);
  const httpStatus = integer(input.httpStatus, 100, 599);
  const inputTokens = integer(input.inputTokens, 0);
  const outputTokens = integer(input.outputTokens, 0);
  const contextWindowTokens = integer(input.contextWindowTokens, 1);
  const code = allowlistedReason(input.code);
  const suppliedReason = allowlistedReason(input.reason);
  const numeric = { inputTokens, outputTokens, contextWindowTokens };

  let category: ProviderFailureCategory;
  let reason: ProviderFailureReason;
  if (httpStatus === 413) {
    category = 'context_overflow';
    reason = 'http_413';
  } else if (code === 'context_length_exceeded' || suppliedReason === 'context_length_exceeded') {
    category = 'context_overflow';
    reason = 'context_length_exceeded';
  } else if (suppliedReason === 'max_output_tokens' || suppliedReason === 'length') {
    category = isNearKnownContextLimit(numeric) ? 'context_overflow' : 'output_truncated';
    reason = suppliedReason;
  } else if (suppliedReason === 'response_incomplete') {
    category = 'incomplete';
    reason = suppliedReason;
  } else if (suppliedReason === 'response_failed' || suppliedReason === 'stream_failed') {
    category = 'provider_failed';
    reason = suppliedReason;
  } else if (suppliedReason === 'timeout') {
    category = 'timeout';
    reason = suppliedReason;
  } else if (suppliedReason === 'cancelled') {
    category = 'cancelled';
    reason = suppliedReason;
  } else {
    category = 'transport';
    reason = 'transport';
  }

  return {
    category,
    reason,
    httpStatus,
    inputTokens,
    outputTokens,
    contextWindowTokens,
  };
}

export function isNumericContextOverflow(failure: SanitizedProviderFailure): boolean {
  return failure.category === 'context_overflow'
    && failure.contextWindowTokens !== null
    && failure.contextWindowTokens > 0;
}
