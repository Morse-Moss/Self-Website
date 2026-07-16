import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';

import pg from 'pg';

import {
  recordServiceFailure,
  recordServiceSuccess,
} from '../lib/server/service-incidents.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const now = new Date('2035-04-01T09:00:00.000Z');

let database: Awaited<ReturnType<typeof createDisposablePostgresDatabase>>;
let pool: InstanceType<typeof Pool>;

function fingerprint(): string {
  return randomUUID().replaceAll('-', '').repeat(2);
}

async function runMigrations(connectionString: string): Promise<void> {
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [migrationRunner], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
}

before(async () => {
  database = await createDisposablePostgresDatabase();
  await runMigrations(database.connectionString);
  pool = new Pool({ connectionString: database.connectionString });
});

after(async () => {
  await pool?.end();
  await database?.dispose();
});

test('incident transaction rolls back before releasing when advisory lock acquisition fails', async () => {
  const queries: string[] = [];
  let released = false;
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('pg_advisory_xact_lock')) throw new Error('forced lock failure');
      return { rows: [], rowCount: 0 };
    },
    release() {
      released = true;
    },
  };
  const failingPool = {
    async connect() {
      return client;
    },
  };

  await assert.rejects(
    () => recordServiceFailure(failingPool as never, {
      dependency: 'provider',
      fingerprint: 'a'.repeat(64),
      now,
    }),
    /forced lock failure/,
  );
  assert.deepEqual(queries, [
    'BEGIN',
    'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    'ROLLBACK',
  ]);
  assert.equal(released, true);
});

test('incident recording can borrow a caller-owned client without leasing or releasing another connection', async () => {
  const client = await pool.connect();
  let releaseCalls = 0;
  const borrowed = new Proxy(client, {
    get(target, property) {
      if (property === 'release') {
        return () => { releaseCalls += 1; };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try {
    const result = await recordServiceFailure(borrowed as never, {
      dependency: `borrowed-${randomUUID()}`,
      fingerprint: fingerprint(),
      errorCode: 'PROVIDER_UNAVAILABLE',
      now,
    });
    assert.equal(result.status, 'observing');
    assert.equal(releaseCalls, 0);
    assert.equal((await borrowed.query('SELECT 1::integer AS value')).rows[0].value, 1);
  } finally {
    client.release();
  }
});

test('three concurrent failures within five minutes open one incident and enqueue one down alert', async () => {
  const dependency = `provider-${randomUUID()}`;
  const errorFingerprint = fingerprint();

  await Promise.all(Array.from({ length: 3 }, () => recordServiceFailure(pool, {
    dependency,
    fingerprint: errorFingerprint,
    errorCode: 'PROVIDER_UNAVAILABLE',
    now,
  })));

  const incident = await pool.query<{
    id: string;
    status: string;
    failure_count: number;
    window_started_at: Date;
    down_at: Date;
  }>(
    `SELECT id, status, failure_count, window_started_at, down_at
       FROM service_incidents
      WHERE dependency = $1 AND fingerprint = $2`,
    [dependency, errorFingerprint],
  );
  assert.equal(incident.rowCount, 1);
  assert.deepEqual(incident.rows[0], {
    id: incident.rows[0].id,
    status: 'down',
    failure_count: 3,
    window_started_at: now,
    down_at: now,
  });

  const downAlerts = await pool.query<{
    dedupe_key: string;
    category: string;
    payload: Record<string, unknown>;
  }>(
    "SELECT dedupe_key, category, payload FROM alert_outbox WHERE category = 'service_down'",
  );
  assert.deepEqual(downAlerts.rows, [{
    dedupe_key: `service-down:${incident.rows[0].id}`,
    category: 'service_down',
    payload: {
      dependency,
      incidentId: incident.rows[0].id,
      occurredAt: now.toISOString(),
    },
  }]);

  await recordServiceFailure(pool, {
    dependency,
    fingerprint: errorFingerprint,
    errorCode: 'PROVIDER_UNAVAILABLE',
    now: new Date(now.getTime() + 60_000),
  });
  const afterReplay = await pool.query<{ failure_count: number; alerts: number }>(
    `SELECT incident.failure_count,
            (SELECT count(*)::integer FROM alert_outbox WHERE dedupe_key = $2) AS alerts
       FROM service_incidents AS incident
      WHERE incident.id = $1`,
    [incident.rows[0].id, `service-down:${incident.rows[0].id}`],
  );
  assert.deepEqual(afterReplay.rows[0], { failure_count: 4, alerts: 1 });
});

test('out-of-order failure timestamps within one window still open the incident', async () => {
  const dependency = `out-of-order-${randomUUID()}`;
  const errorFingerprint = fingerprint();
  const latest = new Date(now.getTime() + 2 * 60_000);
  for (const eventTime of [
    latest,
    new Date(now.getTime() + 60_000),
    now,
  ]) {
    await recordServiceFailure(pool, {
      dependency,
      fingerprint: errorFingerprint,
      errorCode: 'PROVIDER_UNAVAILABLE',
      now: eventTime,
    });
  }

  const incident = await pool.query<{
    id: string;
    status: string;
    failure_count: number;
    window_started_at: Date;
    last_failure_at: Date;
    down_at: Date;
  }>(
    `SELECT id, status, failure_count, window_started_at, last_failure_at, down_at
       FROM service_incidents
      WHERE dependency = $1 AND fingerprint = $2`,
    [dependency, errorFingerprint],
  );
  assert.deepEqual(incident.rows[0], {
    id: incident.rows[0].id,
    status: 'down',
    failure_count: 3,
    window_started_at: now,
    last_failure_at: latest,
    down_at: latest,
  });
  const alert = await pool.query<{ payload: Record<string, unknown> }>(
    'SELECT payload FROM alert_outbox WHERE dedupe_key = $1',
    [`service-down:${incident.rows[0].id}`],
  );
  assert.equal(alert.rows[0].payload.occurredAt, latest.toISOString());
});

test('one success recovers a down incident once and the same fingerprint can open a new incident', async () => {
  const dependency = `search-${randomUUID()}`;
  const errorFingerprint = fingerprint();
  for (let index = 0; index < 3; index += 1) {
    await recordServiceFailure(pool, {
      dependency,
      fingerprint: errorFingerprint,
      errorCode: 'SEARCH_FAILED',
      now: new Date(now.getTime() + index * 60_000),
    });
  }
  const first = await pool.query<{ id: string }>(
    'SELECT id FROM service_incidents WHERE dependency = $1 AND fingerprint = $2',
    [dependency, errorFingerprint],
  );
  const recoveredAt = new Date(now.getTime() + 3 * 60_000);

  const recovered = await recordServiceSuccess(pool, {
    dependency,
    fingerprint: errorFingerprint,
    now: recoveredAt,
  });
  assert.equal(recovered?.incidentId, first.rows[0].id);
  assert.equal(recovered?.status, 'recovered');
  assert.equal(await recordServiceSuccess(pool, {
    dependency,
    fingerprint: errorFingerprint,
    now: new Date(recoveredAt.getTime() + 1),
  }), null);

  const nextOutageAt = new Date(now.getTime() + 10 * 60_000);
  for (let index = 0; index < 3; index += 1) {
    await recordServiceFailure(pool, {
      dependency,
      fingerprint: errorFingerprint,
      errorCode: 'SEARCH_FAILED',
      now: new Date(nextOutageAt.getTime() + index * 60_000),
    });
  }

  const incidents = await pool.query<{ id: string; status: string }>(
    `SELECT id, status
       FROM service_incidents
      WHERE dependency = $1 AND fingerprint = $2
      ORDER BY created_at, id`,
    [dependency, errorFingerprint],
  );
  assert.equal(incidents.rowCount, 2);
  assert.equal(incidents.rows[0].id, first.rows[0].id);
  assert.equal(incidents.rows[0].status, 'recovered');
  assert.notEqual(incidents.rows[1].id, first.rows[0].id);
  assert.equal(incidents.rows[1].status, 'down');

  const alerts = await pool.query<{ dedupe_key: string; category: string }>(
    `SELECT dedupe_key, category
       FROM alert_outbox
      WHERE category IN ('service_down', 'service_recovered')
        AND payload ->> 'dependency' = $1
      ORDER BY id`,
    [dependency],
  );
  assert.deepEqual(alerts.rows, [
    { dedupe_key: `service-down:${incidents.rows[0].id}`, category: 'service_down' },
    { dedupe_key: `service-recovered:${incidents.rows[0].id}`, category: 'service_recovered' },
    { dedupe_key: `service-down:${incidents.rows[1].id}`, category: 'service_down' },
  ]);
});

test('a five-minute window reset and an early success break the consecutive failure sequence', async () => {
  const dependency = `window-${randomUUID()}`;
  const errorFingerprint = fingerprint();
  await recordServiceFailure(pool, { dependency, fingerprint: errorFingerprint, now });
  await recordServiceFailure(pool, {
    dependency,
    fingerprint: errorFingerprint,
    now: new Date(now.getTime() + 4 * 60_000),
  });
  const outsideWindow = new Date(now.getTime() + 5 * 60_000 + 1);
  const reset = await recordServiceFailure(pool, {
    dependency,
    fingerprint: errorFingerprint,
    now: outsideWindow,
  });
  assert.equal(reset.status, 'observing');
  assert.equal(reset.failureCount, 1);

  const recovered = await recordServiceSuccess(pool, {
    dependency,
    fingerprint: errorFingerprint,
    now: new Date(outsideWindow.getTime() + 1),
  });
  assert.equal(recovered?.status, 'recovered');
  const alertCount = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count
       FROM alert_outbox
      WHERE payload ->> 'dependency' = $1`,
    [dependency],
  );
  assert.equal(alertCount.rows[0].count, 0);
});

test('a down-alert enqueue failure rolls back the third failure transition', async () => {
  const dependency = `rollback-${randomUUID()}`;
  const errorFingerprint = fingerprint();
  await recordServiceFailure(pool, { dependency, fingerprint: errorFingerprint, now });
  await recordServiceFailure(pool, {
    dependency,
    fingerprint: errorFingerprint,
    now: new Date(now.getTime() + 60_000),
  });

  await pool.query(`
    CREATE FUNCTION reject_service_down_alert() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.category = 'service_down' THEN
        RAISE EXCEPTION 'forced service alert rollback';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER reject_service_down_alert
      BEFORE INSERT ON alert_outbox
      FOR EACH ROW EXECUTE FUNCTION reject_service_down_alert();
  `);
  try {
    await assert.rejects(
      () => recordServiceFailure(pool, {
        dependency,
        fingerprint: errorFingerprint,
        now: new Date(now.getTime() + 2 * 60_000),
      }),
      /forced service alert rollback/,
    );
  } finally {
    await pool.query('DROP TRIGGER reject_service_down_alert ON alert_outbox');
    await pool.query('DROP FUNCTION reject_service_down_alert()');
  }

  const rolledBack = await pool.query<{
    status: string;
    failure_count: number;
    alerts: number;
  }>(
    `SELECT incident.status, incident.failure_count,
            (SELECT count(*)::integer FROM alert_outbox
              WHERE payload ->> 'dependency' = $2) AS alerts
       FROM service_incidents AS incident
      WHERE incident.dependency = $1 AND incident.fingerprint = $3`,
    [dependency, dependency, errorFingerprint],
  );
  assert.deepEqual(rolledBack.rows[0], {
    status: 'observing',
    failure_count: 2,
    alerts: 0,
  });

  const retry = await recordServiceFailure(pool, {
    dependency,
    fingerprint: errorFingerprint,
    now: new Date(now.getTime() + 2 * 60_000),
  });
  assert.equal(retry.status, 'down');
});
