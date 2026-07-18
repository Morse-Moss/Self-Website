type Env = Record<string, string | undefined>;

export class WorkerConfigError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'WorkerConfigError';
    this.code = code;
  }
}

function boundedInteger(
  env: Env,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  code: string,
): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new WorkerConfigError(code);
  }
  return value;
}

function webhookUrl(value: string | undefined): string {
  try {
    const url = new URL(value?.trim() ?? '');
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      throw new Error();
    }
    return url.toString();
  } catch {
    throw new WorkerConfigError('WORKER_FEISHU_CONFIG_INVALID');
  }
}

export function loadWorkerConfig(env: Env = process.env) {
  const alerts = env.MORSE_ALERTS_ENABLED?.trim();
  if (alerts !== 'true' && alerts !== 'false') {
    throw new WorkerConfigError('WORKER_ALERT_MODE_REQUIRED');
  }
  const alertsEnabled = alerts === 'true';
  return {
    alertsEnabled,
    webhookUrl: alertsEnabled ? webhookUrl(env.FEISHU_WEBHOOK_URL) : null,
    pollMs: boundedInteger(
      env,
      'MORSE_WORKER_POLL_MS',
      5_000,
      100,
      60_000,
      'WORKER_POLL_INVALID',
    ),
    infrastructureBackoffMaxMs: boundedInteger(
      env,
      'MORSE_WORKER_BACKOFF_MAX_MS',
      60_000,
      1_000,
      60_000,
      'WORKER_BACKOFF_INVALID',
    ),
    cleanupIntervalMs: boundedInteger(
      env,
      'MORSE_CLEANUP_INTERVAL_MS',
      3_600_000,
      60_000,
      86_400_000,
      'WORKER_CLEANUP_INTERVAL_INVALID',
    ),
    dispatchLimit: boundedInteger(
      env,
      'MORSE_ALERT_DISPATCH_LIMIT',
      20,
      1,
      100,
      'WORKER_DISPATCH_LIMIT_INVALID',
    ),
    maxDeliveryAttempts: boundedInteger(
      env,
      'MORSE_ALERT_MAX_ATTEMPTS',
      5,
      1,
      20,
      'WORKER_MAX_ATTEMPTS_INVALID',
    ),
  };
}
