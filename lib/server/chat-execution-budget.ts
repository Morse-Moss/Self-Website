export interface ChatExecutionBudget {
  providerDeadlineMs(): number;
  remainingAttempts(): number;
  remainingMs(nowMs: number): number;
  reserveAttempt(nowMs: number): boolean;
  canStartAttempt(nowMs: number, minimumMs: number): boolean;
}

interface ChatExecutionBudgetInput {
  turnStartedAtMs: number;
  providerStartedAtMs: number;
  turnTimeoutMs: number;
  providerTimeoutMs: number;
  maxAttempts: number;
}

function requireTimestamp(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
}

function requirePositiveDuration(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
}

export function createChatExecutionBudget(
  input: ChatExecutionBudgetInput,
): ChatExecutionBudget {
  requireTimestamp(input.turnStartedAtMs, 'turnStartedAtMs');
  requireTimestamp(input.providerStartedAtMs, 'providerStartedAtMs');
  requirePositiveDuration(input.turnTimeoutMs, 'turnTimeoutMs');
  requirePositiveDuration(input.providerTimeoutMs, 'providerTimeoutMs');
  if (input.providerStartedAtMs < input.turnStartedAtMs) {
    throw new Error('providerStartedAtMs must not precede turnStartedAtMs.');
  }
  if (input.maxAttempts !== 3) {
    throw new Error('maxAttempts must equal the Chat v2 contract of 3.');
  }

  const deadlineMs = Math.min(
    input.turnStartedAtMs + input.turnTimeoutMs,
    input.providerStartedAtMs + input.providerTimeoutMs,
  );
  let attempts = 0;

  return {
    providerDeadlineMs: () => deadlineMs,
    remainingAttempts: () => Math.max(0, input.maxAttempts - attempts),
    remainingMs: (nowMs) => Math.max(0, deadlineMs - nowMs),
    canStartAttempt(nowMs, minimumMs) {
      requireTimestamp(nowMs, 'nowMs');
      requirePositiveDuration(minimumMs, 'minimumMs');
      return attempts < input.maxAttempts && deadlineMs - nowMs >= minimumMs;
    },
    reserveAttempt(nowMs) {
      requireTimestamp(nowMs, 'nowMs');
      if (attempts >= input.maxAttempts || nowMs >= deadlineMs) return false;
      attempts += 1;
      return true;
    },
  };
}
