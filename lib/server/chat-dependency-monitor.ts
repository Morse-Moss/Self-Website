import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

import { recordServiceFailure, recordServiceRecovery } from './service-incidents.ts';

export type MonitoredDependency = 'provider' | 'search';

function serviceFingerprint(dependency: MonitoredDependency, errorCode: string): string {
  return createHash('sha256')
    .update(`morse-service-incident:v1:${dependency}:${errorCode}`, 'utf8')
    .digest('hex');
}

export async function recordDependencyFailure(input: {
  client: PoolClient;
  dependency: MonitoredDependency;
  errorCode: string;
  now: Date;
}): Promise<void> {
  try {
    await recordServiceFailure(input.client, {
      dependency: input.dependency,
      fingerprint: serviceFingerprint(input.dependency, input.errorCode),
      errorCode: input.errorCode,
      now: input.now,
    });
  } catch {
    console.error(JSON.stringify({
      event: 'morse_service_incident_record_failed',
      code: 'SERVICE_INCIDENT_RECORD_FAILED',
      dependency: input.dependency,
    }));
  }
}

export async function recordDependencySuccess(input: {
  client: PoolClient;
  dependency: MonitoredDependency;
  now: Date;
}): Promise<void> {
  try {
    await recordServiceRecovery(input.client, {
      dependency: input.dependency,
      now: input.now,
    });
  } catch {
    console.error(JSON.stringify({
      event: 'morse_service_incident_record_failed',
      code: 'SERVICE_INCIDENT_RECORD_FAILED',
      dependency: input.dependency,
    }));
  }
}
