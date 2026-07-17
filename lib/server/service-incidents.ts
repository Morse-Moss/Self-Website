import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { enqueueAlert } from './alert-service.ts';

export const SERVICE_INCIDENT_WINDOW_MS = 5 * 60 * 1000;

export type ServiceIncidentStatus = 'observing' | 'down' | 'recovered';

export interface ServiceIncidentEvent {
  dependency: string;
  fingerprint: string;
  now?: Date;
}

export interface ServiceFailureEvent extends ServiceIncidentEvent {
  errorCode?: string | null;
}

export interface ServiceIncidentResult {
  incidentId: string;
  status: ServiceIncidentStatus;
  failureCount: number;
  alertInserted: boolean;
}

export interface ServiceRecoveryEvent {
  dependency: string;
  now?: Date;
}

type IncidentDatabase = Pool | PoolClient;

interface IncidentRow {
  id: string;
  dependency: string;
  fingerprint: string;
  status: ServiceIncidentStatus;
  failure_count: number;
  window_started_at: Date;
  last_failure_at: Date;
}

interface NormalizedEvent {
  dependency: string;
  fingerprint: string;
  now: Date;
}

function normalizeEvent(event: ServiceIncidentEvent): NormalizedEvent {
  const dependency = event.dependency.trim();
  const fingerprint = event.fingerprint.trim().toLowerCase();
  const now = event.now ?? new Date();
  if (!dependency || !/^[a-f0-9]{64}$/u.test(fingerprint) || Number.isNaN(now.getTime())) {
    throw new Error('SERVICE_INCIDENT_INPUT_INVALID');
  }
  return { dependency, fingerprint, now };
}

async function beginIncidentTransaction(
  database: IncidentDatabase,
  event: NormalizedEvent,
): Promise<{ client: PoolClient; release: () => void }> {
  const borrowed = typeof (database as PoolClient).release === 'function';
  const client = borrowed ? database as PoolClient : await (database as Pool).connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [JSON.stringify([event.dependency])],
    );
    return {
      client,
      release: borrowed ? () => undefined : () => client.release(),
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Releasing the connection is still required when PostgreSQL is unavailable.
    }
    if (!borrowed) client.release();
    throw error;
  }
}

async function loadActiveIncident(
  client: PoolClient,
  event: NormalizedEvent,
): Promise<IncidentRow | null> {
  const result = await client.query<IncidentRow>(
    `SELECT id, dependency, fingerprint, status, failure_count,
            window_started_at, last_failure_at
       FROM service_incidents
      WHERE dependency = $1
        AND fingerprint = $2
        AND status IN ('observing', 'down')
      FOR UPDATE`,
    [event.dependency, event.fingerprint],
  );
  return result.rows[0] ?? null;
}

function resultFrom(row: IncidentRow, alertInserted = false): ServiceIncidentResult {
  return {
    incidentId: row.id,
    status: row.status,
    failureCount: row.failure_count,
    alertInserted,
  };
}

export async function recordServiceFailure(
  database: IncidentDatabase,
  input: ServiceFailureEvent,
): Promise<ServiceIncidentResult> {
  const event = normalizeEvent(input);
  const errorCode = input.errorCode?.trim() || null;
  const transaction = await beginIncidentTransaction(database, event);
  const { client } = transaction;

  try {
    const active = await loadActiveIncident(client, event);
    let row: IncidentRow;
    let alertInserted = false;

    if (!active) {
      const inserted = await client.query<IncidentRow>(
        `INSERT INTO service_incidents
          (id, dependency, fingerprint, status, failure_count,
           window_started_at, last_failure_at, last_error_code, created_at, updated_at)
         VALUES ($1, $2, $3, 'observing', 1, $4, $4, $5, $4, $4)
         RETURNING id, dependency, fingerprint, status, failure_count,
                   window_started_at, last_failure_at`,
        [randomUUID(), event.dependency, event.fingerprint, event.now, errorCode],
      );
      row = inserted.rows[0];
    } else if (active.status === 'down') {
      const updated = await client.query<IncidentRow>(
        `UPDATE service_incidents
            SET failure_count = failure_count + 1,
                last_failure_at = $2,
                last_error_code = $3,
                updated_at = $2
          WHERE id = $1
        RETURNING id, dependency, fingerprint, status, failure_count,
                  window_started_at, last_failure_at`,
        [active.id, event.now, errorCode],
      );
      row = updated.rows[0];
    } else {
      const earliestFailure = new Date(Math.min(
        active.window_started_at.getTime(),
        event.now.getTime(),
      ));
      const latestFailure = new Date(Math.max(
        active.last_failure_at.getTime(),
        event.now.getTime(),
      ));
      const inWindow = (
        latestFailure.getTime() - earliestFailure.getTime()
        <= SERVICE_INCIDENT_WINDOW_MS
      );
      if (!inWindow && event.now.getTime() < active.window_started_at.getTime()) {
        await client.query('COMMIT');
        return resultFrom(active);
      }
      const nextCount = inWindow ? active.failure_count + 1 : 1;
      const nextStatus: ServiceIncidentStatus = nextCount >= 3 ? 'down' : 'observing';
      const windowStartedAt = inWindow ? earliestFailure : event.now;
      const lastFailureAt = inWindow ? latestFailure : event.now;
      const updated = await client.query<IncidentRow>(
        `UPDATE service_incidents
            SET status = $2,
                failure_count = $3,
                window_started_at = $4,
                last_failure_at = $5,
                down_at = CASE WHEN $2 = 'down' THEN $5::timestamptz ELSE NULL END,
                last_error_code = $6,
                updated_at = $5
          WHERE id = $1
        RETURNING id, dependency, fingerprint, status, failure_count,
                  window_started_at, last_failure_at`,
        [
          active.id,
          nextStatus,
          nextCount,
          windowStartedAt,
          lastFailureAt,
          errorCode,
        ],
      );
      row = updated.rows[0];
      if (nextStatus === 'down') {
        alertInserted = await enqueueAlert(client, {
          dedupeKey: `service-down:${row.id}`,
          category: 'service_down',
          payload: {
            dependency: event.dependency,
            incidentId: row.id,
            occurredAt: lastFailureAt.toISOString(),
          },
          now: lastFailureAt,
        });
      }
    }

    await client.query('COMMIT');
    return resultFrom(row, alertInserted);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    transaction.release();
  }
}

export async function recordServiceSuccess(
  database: IncidentDatabase,
  input: ServiceIncidentEvent,
): Promise<ServiceIncidentResult | null> {
  const event = normalizeEvent(input);
  const transaction = await beginIncidentTransaction(database, event);
  const { client } = transaction;

  try {
    const active = await loadActiveIncident(client, event);
    if (!active) {
      await client.query('COMMIT');
      return null;
    }

    const updated = await client.query<IncidentRow>(
      `UPDATE service_incidents
          SET status = 'recovered',
              recovered_at = $2,
              updated_at = $2
        WHERE id = $1
      RETURNING id, dependency, fingerprint, status, failure_count,
                window_started_at, last_failure_at`,
      [active.id, event.now],
    );
    const row = updated.rows[0];
    let alertInserted = false;
    if (active.status === 'down') {
      alertInserted = await enqueueAlert(client, {
        dedupeKey: `service-recovered:${row.id}`,
        category: 'service_recovered',
        payload: {
          dependency: event.dependency,
          incidentId: row.id,
          occurredAt: event.now.toISOString(),
        },
        now: event.now,
      });
    }

    await client.query('COMMIT');
    return resultFrom(row, alertInserted);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    transaction.release();
  }
}

export async function recordServiceRecovery(
  database: IncidentDatabase,
  input: ServiceRecoveryEvent,
): Promise<ServiceIncidentResult[]> {
  const dependency = input.dependency.trim();
  const now = input.now ?? new Date();
  if (!dependency || Number.isNaN(now.getTime())) {
    throw new Error('SERVICE_INCIDENT_INPUT_INVALID');
  }
  const event: NormalizedEvent = {
    dependency,
    fingerprint: '0'.repeat(64),
    now,
  };
  const transaction = await beginIncidentTransaction(database, event);
  const { client } = transaction;

  try {
    const active = await client.query<IncidentRow>(
      `SELECT id, dependency, fingerprint, status, failure_count,
              window_started_at, last_failure_at
         FROM service_incidents
        WHERE dependency = $1
          AND status IN ('observing', 'down')
        ORDER BY id
        FOR UPDATE`,
      [dependency],
    );
    const results: ServiceIncidentResult[] = [];
    for (const incident of active.rows) {
      const updated = await client.query<IncidentRow>(
        `UPDATE service_incidents
            SET status = 'recovered',
                recovered_at = $2,
                updated_at = $2
          WHERE id = $1
        RETURNING id, dependency, fingerprint, status, failure_count,
                  window_started_at, last_failure_at`,
        [incident.id, now],
      );
      let alertInserted = false;
      if (incident.status === 'down') {
        alertInserted = await enqueueAlert(client, {
          dedupeKey: `service-recovered:${incident.id}`,
          category: 'service_recovered',
          payload: {
            dependency,
            incidentId: incident.id,
            occurredAt: now.toISOString(),
          },
          now,
        });
      }
      results.push(resultFrom(updated.rows[0], alertInserted));
    }
    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    transaction.release();
  }
}
