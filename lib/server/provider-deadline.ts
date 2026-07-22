export interface ProviderDeadline {
  deadlineMs(): number | null;
  recordProtocolEvent(atMs: number): void;
  recordModelText(atMs: number): void;
}

interface ProviderDeadlineInput {
  startedAtMs: number;
  protocolTimeoutMs: number;
  modelTextTimeoutMs: number;
}

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
}

export function createProviderDeadline(input: ProviderDeadlineInput): ProviderDeadline {
  requireNonNegativeInteger(input.startedAtMs, 'startedAtMs');
  requireNonNegativeInteger(input.protocolTimeoutMs, 'protocolTimeoutMs');
  requireNonNegativeInteger(input.modelTextTimeoutMs, 'modelTextTimeoutMs');
  if (input.protocolTimeoutMs < 1 || input.protocolTimeoutMs >= input.modelTextTimeoutMs) {
    throw new Error('protocolTimeoutMs must be positive and less than modelTextTimeoutMs.');
  }

  let protocolSeen = false;
  let modelTextSeen = false;
  const validateActivity = (atMs: number) => {
    requireNonNegativeInteger(atMs, 'activity timestamp');
    if (atMs < input.startedAtMs) {
      throw new Error('Provider activity must not precede startedAtMs.');
    }
  };

  return {
    deadlineMs() {
      if (modelTextSeen) return null;
      return input.startedAtMs + (
        protocolSeen ? input.modelTextTimeoutMs : input.protocolTimeoutMs
      );
    },
    recordProtocolEvent(atMs) {
      validateActivity(atMs);
      protocolSeen = true;
    },
    recordModelText(atMs) {
      validateActivity(atMs);
      protocolSeen = true;
      modelTextSeen = true;
    },
  };
}
