export type ProviderHealthState = 'closed' | 'open' | 'half_open';

export interface ProviderHealthLease {
  alias: string;
  halfOpen: boolean;
}

export interface ProviderHealthSnapshot {
  consecutiveFailures: number;
  retryAt: Date | null;
  state: ProviderHealthState;
}

export interface ProviderHealthOptions {
  failureThreshold?: number;
  openMs?: number;
}

interface ProviderHealthRecord {
  consecutiveFailures: number;
  halfOpenInFlight: boolean;
  openedAt: Date | null;
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_OPEN_MS = 60_000;

export class ProviderHealthRegistry {
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly records = new Map<string, ProviderHealthRecord>();

  constructor(options: ProviderHealthOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.openMs = options.openMs ?? DEFAULT_OPEN_MS;
    if (!Number.isSafeInteger(this.failureThreshold) || this.failureThreshold < 1) {
      throw new Error('Provider health failure threshold must be a positive integer.');
    }
    if (!Number.isSafeInteger(this.openMs) || this.openMs < 1) {
      throw new Error('Provider health open interval must be a positive integer.');
    }
  }

  acquire(alias: string, now: Date): ProviderHealthLease | null {
    const record = this.records.get(alias);
    if (!record || record.consecutiveFailures < this.failureThreshold) {
      return { alias, halfOpen: false };
    }
    if (record.halfOpenInFlight) return null;
    const openedAt = record.openedAt;
    if (!openedAt || now.getTime() - openedAt.getTime() < this.openMs) return null;

    record.halfOpenInFlight = true;
    return { alias, halfOpen: true };
  }

  success(alias: string): void {
    this.records.delete(alias);
  }

  failure(alias: string, now: Date): void {
    const record = this.records.get(alias) ?? {
      consecutiveFailures: 0,
      halfOpenInFlight: false,
      openedAt: null,
    };
    const wasHalfOpen = record.halfOpenInFlight;
    record.consecutiveFailures += 1;
    record.halfOpenInFlight = false;
    if (wasHalfOpen || record.consecutiveFailures >= this.failureThreshold) {
      record.openedAt = now;
    }
    this.records.set(alias, record);
  }

  abort(alias: string): void {
    const record = this.records.get(alias);
    if (record) record.halfOpenInFlight = false;
  }

  snapshot(alias: string, now: Date): ProviderHealthSnapshot {
    const record = this.records.get(alias);
    if (!record) {
      return { consecutiveFailures: 0, retryAt: null, state: 'closed' };
    }
    if (record.halfOpenInFlight) {
      return {
        consecutiveFailures: record.consecutiveFailures,
        retryAt: null,
        state: 'half_open',
      };
    }
    if (record.consecutiveFailures < this.failureThreshold || !record.openedAt) {
      return {
        consecutiveFailures: record.consecutiveFailures,
        retryAt: null,
        state: 'closed',
      };
    }
    return {
      consecutiveFailures: record.consecutiveFailures,
      retryAt: new Date(record.openedAt.getTime() + this.openMs),
      state: 'open',
    };
  }
}
