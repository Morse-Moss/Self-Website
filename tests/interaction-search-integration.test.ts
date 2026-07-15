import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';

import pg from 'pg';
import type { Pool as PgPool } from 'pg';

import {
  claimSearch,
  finalizeSearchCompleted,
  finalizeSearchFailed,
} from '../lib/server/interaction-search.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const now = new Date('2035-03-01T09:00:00.000Z');
const deleteAfter = new Date('2035-03-11T09:00:00.000Z');

let database: Awaited<ReturnType<typeof createDisposablePostgresDatabase>>;
let pool: InstanceType<typeof Pool>;

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

async function createFixture(label: string) {
  const inviteId = randomUUID();
  const accessSessionId = randomUUID();
  const turnId = randomUUID();
  await pool.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES ($1, $2, $3, true, $4, 10, 1)`,
    [inviteId, randomUUID().replaceAll('-', '').padEnd(64, '0'), label, deleteAfter],
  );
  await pool.query(
    `INSERT INTO access_sessions
      (id, invite_code_id, token_hash, expires_at, created_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [
      accessSessionId,
      inviteId,
      randomUUID().replaceAll('-', '').padEnd(64, '0'),
      deleteAfter,
      now,
    ],
  );
  await pool.query(
    `INSERT INTO interaction_turns
      (id, access_session_id, workflow, audience_intent, question,
       status, created_at, delete_after)
     VALUES ($1, $2, 'chat', 'general', $3, 'running', $4, $5)`,
    [turnId, accessSessionId, `question:${label}`, now, deleteAfter],
  );
  return { accessSessionId, turnId };
}

async function createTurn(accessSessionId: string, label: string): Promise<string> {
  const turnId = randomUUID();
  await pool.query(
    `INSERT INTO interaction_turns
      (id, access_session_id, workflow, audience_intent, question,
       status, created_at, delete_after)
     VALUES ($1, $2, 'chat', 'general', $3, 'running', $4, $5)`,
    [turnId, accessSessionId, `question:${label}`, now, deleteAfter],
  );
  return turnId;
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

test('claimSearch persists the first pending claim and consumes one search slot', async () => {
  const fixture = await createFixture('first-claim');
  const result = await claimSearch({
    pool,
    ...fixture,
    query: 'latest PostgreSQL release',
    routeReason: 'recency',
    now,
  });

  assert.equal(result.kind, 'claimed');
  assert.equal(result.search.status, 'pending');
  assert.equal(result.search.deleteAfter.getTime(), deleteAfter.getTime());
  const state = await pool.query<{
    search_count: number;
    search_rows: number;
    used_search: boolean;
  }>(
    `SELECT session.search_count, turn.used_search,
            count(search.id)::integer AS search_rows
       FROM access_sessions AS session
       JOIN interaction_turns AS turn ON turn.access_session_id = session.id
       LEFT JOIN interaction_searches AS search ON search.interaction_turn_id = turn.id
      WHERE session.id = $1 AND turn.id = $2
      GROUP BY session.search_count, turn.used_search`,
    [fixture.accessSessionId, fixture.turnId],
  );
  assert.deepEqual(state.rows[0], { search_count: 1, search_rows: 1, used_search: true });
});

test('claimSearch returns a durable pending claim without consuming quota twice', async () => {
  const fixture = await createFixture('repeat-pending');
  const first = await claimSearch({
    pool,
    ...fixture,
    query: 'first query',
    routeReason: 'recency',
    now,
  });
  const repeated = await claimSearch({
    pool,
    ...fixture,
    query: 'changed retry payload',
    routeReason: 'explicit',
    now: new Date(now.getTime() + 60_000),
  });

  assert.equal(first.kind, 'claimed');
  assert.equal(repeated.kind, 'existing');
  assert.equal(repeated.search.id, first.search.id);
  assert.equal(repeated.search.query, 'first query');
  const state = await pool.query<{ search_count: number; search_rows: number }>(
    `SELECT session.search_count, count(search.id)::integer AS search_rows
       FROM access_sessions AS session
       JOIN interaction_turns AS turn ON turn.access_session_id = session.id
       LEFT JOIN interaction_searches AS search ON search.interaction_turn_id = turn.id
      WHERE session.id = $1 AND turn.id = $2
      GROUP BY session.search_count`,
    [fixture.accessSessionId, fixture.turnId],
  );
  assert.deepEqual(state.rows[0], { search_count: 1, search_rows: 1 });
});

test('claimSearch resolves a lost COMMIT acknowledgement from its durable search id', async () => {
  const fixture = await createFixture('commit-ack-lost');
  const singleConnectionPool = new Pool({
    connectionString: database.connectionString,
    connectionTimeoutMillis: 500,
    max: 1,
  });
  let commitAttempts = 0;
  let insertAttempts = 0;
  let releasedWithDestroy = false;
  const ambiguousPool = new Proxy(singleConnectionPool, {
    get(target, property) {
      if (property === 'connect') {
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(clientTarget, clientProperty) {
              if (clientProperty === 'query') {
                return async (query: string, values?: unknown[]) => {
                  if (query.includes('INSERT INTO interaction_searches')) insertAttempts += 1;
                  if (query === 'COMMIT') {
                    commitAttempts += 1;
                    await clientTarget.query(query, values);
                    throw new Error('search claim COMMIT acknowledgement lost');
                  }
                  return clientTarget.query(query, values);
                };
              }
              if (clientProperty === 'release') {
                return (destroy?: boolean) => {
                  releasedWithDestroy = destroy === true;
                  clientTarget.release(destroy);
                };
              }
              const value = Reflect.get(clientTarget, clientProperty);
              return typeof value === 'function' ? value.bind(clientTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as PgPool;

  try {
    const result = await claimSearch({
      pool: ambiguousPool,
      ...fixture,
      query: 'commit ambiguity query',
      routeReason: 'recency',
      now,
    });
    assert.equal(result.kind, 'claimed');
    assert.equal(commitAttempts, 1);
    assert.equal(insertAttempts, 1);
    assert.equal(releasedWithDestroy, true);
    const durable = await pool.query<{ id: string; search_count: number }>(
      `SELECT search.id::text AS id, session.search_count
         FROM interaction_searches AS search
         JOIN interaction_turns AS turn ON turn.id = search.interaction_turn_id
         JOIN access_sessions AS session ON session.id = turn.access_session_id
        WHERE search.interaction_turn_id = $1`,
      [fixture.turnId],
    );
    assert.equal(durable.rows.length, 1);
    assert.equal(durable.rows[0].id, result.search.id);
    assert.equal(durable.rows[0].search_count, 1);
  } finally {
    await singleConnectionPool.end();
  }
});

test('a borrowed client never treats a pre-send COMMIT failure as a durable claim', async () => {
  const fixture = await createFixture('borrowed-commit-before-send');
  const client = await pool.connect();
  const borrowed = new Proxy(client, {
    get(target, property) {
      if (property === 'query') {
        return async (query: string, values?: unknown[]) => {
          if (query === 'COMMIT') {
            throw new Error('borrowed COMMIT failed before send');
          }
          return target.query(query, values);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  try {
    await assert.rejects(claimSearch({
      pool,
      client: borrowed,
      ...fixture,
      query: 'must not escape an uncommitted transaction',
      routeReason: 'recency',
      now,
    }), /before send/);
    const durable = await pool.query<{ search_count: number; search_rows: number }>(
      `SELECT session.search_count, count(search.id)::integer AS search_rows
         FROM access_sessions AS session
         JOIN interaction_turns AS turn ON turn.access_session_id = session.id
         LEFT JOIN interaction_searches AS search ON search.interaction_turn_id = turn.id
        WHERE session.id = $1 AND turn.id = $2
        GROUP BY session.search_count`,
      [fixture.accessSessionId, fixture.turnId],
    );
    assert.deepEqual(durable.rows[0], { search_count: 0, search_rows: 0 });
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
});

test('a borrowed client confirms a post-COMMIT acknowledgement loss only after ending the transaction', async () => {
  const fixture = await createFixture('borrowed-commit-ack-lost');
  const client = await pool.connect();
  let rollbackAttempts = 0;
  const borrowed = new Proxy(client, {
    get(target, property) {
      if (property === 'query') {
        return async (query: string, values?: unknown[]) => {
          if (query === 'COMMIT') {
            await target.query(query, values);
            throw new Error('borrowed COMMIT acknowledgement lost');
          }
          if (query === 'ROLLBACK') rollbackAttempts += 1;
          return target.query(query, values);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  try {
    const result = await claimSearch({
      pool,
      client: borrowed,
      ...fixture,
      query: 'durable after commit acknowledgement loss',
      routeReason: 'recency',
      now,
    });
    assert.equal(result.kind, 'claimed');
    assert.equal(rollbackAttempts, 1);
    const durable = await pool.query<{ search_count: number; search_rows: number }>(
      `SELECT session.search_count, count(search.id)::integer AS search_rows
         FROM access_sessions AS session
         JOIN interaction_turns AS turn ON turn.access_session_id = session.id
         LEFT JOIN interaction_searches AS search ON search.interaction_turn_id = turn.id
        WHERE session.id = $1 AND turn.id = $2
        GROUP BY session.search_count`,
      [fixture.accessSessionId, fixture.turnId],
    );
    assert.deepEqual(durable.rows[0], { search_count: 1, search_rows: 1 });
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
});

test('search finalization persists completed and failed payloads without sliding retention', async () => {
  const completedFixture = await createFixture('finalize-completed');
  const failedFixture = await createFixture('finalize-failed');
  const completedClaim = await claimSearch({
    pool,
    ...completedFixture,
    query: 'completed query',
    routeReason: 'recency',
    now,
  });
  const failedClaim = await claimSearch({
    pool,
    ...failedFixture,
    query: 'failed query',
    routeReason: 'explicit',
    now,
  });
  assert.equal(completedClaim.kind, 'claimed');
  assert.equal(failedClaim.kind, 'claimed');
  if (completedClaim.kind !== 'claimed' || failedClaim.kind !== 'claimed') return;

  const safeResults = [{
    title: 'PostgreSQL documentation',
    summary: 'Sanitized summary',
    url: 'https://www.postgresql.org/docs/',
  }];
  const completed = await finalizeSearchCompleted({
    pool,
    turnId: completedFixture.turnId,
    results: safeResults,
  });
  const failed = await finalizeSearchFailed({
    pool,
    turnId: failedFixture.turnId,
    results: [],
    errorCode: 'BOCHA_TIMEOUT',
  });

  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.results, safeResults);
  assert.equal(completed.errorCode, null);
  assert.equal(completed.createdAt.getTime(), completedClaim.search.createdAt.getTime());
  assert.equal(completed.deleteAfter.getTime(), completedClaim.search.deleteAfter.getTime());
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.results, []);
  assert.equal(failed.errorCode, 'BOCHA_TIMEOUT');
  assert.equal(failed.createdAt.getTime(), failedClaim.search.createdAt.getTime());
  assert.equal(failed.deleteAfter.getTime(), failedClaim.search.deleteAfter.getTime());

  const [completedReplay, failedReplay] = await Promise.all([
    claimSearch({
      pool,
      ...completedFixture,
      query: 'must not replace completed query',
      routeReason: 'retry',
      now: new Date(now.getTime() + 86_400_000),
    }),
    claimSearch({
      pool,
      ...failedFixture,
      query: 'must not replace failed query',
      routeReason: 'retry',
      now: new Date(now.getTime() + 86_400_000),
    }),
  ]);
  assert.equal(completedReplay.kind, 'existing');
  assert.equal(failedReplay.kind, 'existing');
  if (completedReplay.kind === 'existing' && failedReplay.kind === 'existing') {
    assert.equal(completedReplay.search.status, 'completed');
    assert.equal(failedReplay.search.status, 'failed');
    assert.equal(completedReplay.search.deleteAfter.getTime(), deleteAfter.getTime());
    assert.equal(failedReplay.search.deleteAfter.getTime(), deleteAfter.getTime());
  }
});

test('six concurrent turns atomically claim five session slots and signal only five calls', async () => {
  const fixture = await createFixture('concurrent-quota');
  const turnIds: string[] = [fixture.turnId];
  for (let index = 1; index < 6; index += 1) {
    turnIds.push(await createTurn(fixture.accessSessionId, `concurrent-quota-${index}`));
  }
  let externalCallSignals = 0;

  const results = await Promise.all(turnIds.map(async (turnId, index) => {
    const result = await claimSearch({
      pool,
      accessSessionId: fixture.accessSessionId,
      turnId,
      query: `query ${index}`,
      routeReason: 'recency',
      maxSearches: 5,
      now,
    });
    if (result.kind === 'claimed') externalCallSignals += 1;
    return result;
  }));

  assert.equal(results.filter((result) => result.kind === 'claimed').length, 5);
  assert.equal(results.filter((result) => result.kind === 'quota_exhausted').length, 1);
  assert.equal(externalCallSignals, 5);
  const state = await pool.query<{
    search_count: number;
    search_rows: number;
    used_turns: number;
  }>(
    `SELECT session.search_count,
            count(search.id)::integer AS search_rows,
            count(*) FILTER (WHERE turn.used_search)::integer AS used_turns
       FROM access_sessions AS session
       JOIN interaction_turns AS turn ON turn.access_session_id = session.id
       LEFT JOIN interaction_searches AS search ON search.interaction_turn_id = turn.id
      WHERE session.id = $1
      GROUP BY session.search_count`,
    [fixture.accessSessionId],
  );
  assert.deepEqual(state.rows[0], { search_count: 5, search_rows: 5, used_turns: 5 });
});

test('concurrent retries and an aborted pending claim never signal a second external call', async () => {
  const fixture = await createFixture('same-turn-single-claim');
  let externalCallSignals = 0;
  const claimOnce = async () => {
    const result = await claimSearch({
      pool,
      ...fixture,
      query: 'same turn query',
      routeReason: 'explicit',
      now,
    });
    if (result.kind === 'claimed') externalCallSignals += 1;
    return result;
  };

  const concurrent = await Promise.all(Array.from({ length: 6 }, claimOnce));
  assert.equal(concurrent.filter((result) => result.kind === 'claimed').length, 1);
  assert.equal(concurrent.filter((result) => result.kind === 'existing').length, 5);
  assert.equal(new Set(concurrent.map((result) => result.search?.id)).size, 1);
  assert.equal(externalCallSignals, 1);

  const afterAbort = await claimOnce();
  assert.equal(afterAbort.kind, 'existing');
  assert.equal(afterAbort.search?.status, 'pending');
  assert.equal(externalCallSignals, 1);
});

test('claimSearch rejects foreign or non-running turns without rows or quota changes', async () => {
  const owner = await createFixture('turn-owner');
  const foreign = await createFixture('foreign-session');

  await assert.rejects(
    claimSearch({
      pool,
      accessSessionId: foreign.accessSessionId,
      turnId: owner.turnId,
      query: 'foreign ownership attempt',
      routeReason: 'explicit',
      now,
    }),
    /Search turn is invalid/,
  );
  await pool.query(
    "UPDATE interaction_turns SET status = 'completed' WHERE id = $1",
    [owner.turnId],
  );
  await assert.rejects(
    claimSearch({
      pool,
      ...owner,
      query: 'completed turn attempt',
      routeReason: 'explicit',
      now,
    }),
    /Search turn is invalid/,
  );

  const state = await pool.query<{ search_count: number; search_rows: number }>(
    `SELECT session.search_count,
            count(search.id)::integer AS search_rows
       FROM access_sessions AS session
       LEFT JOIN interaction_turns AS turn ON turn.access_session_id = session.id
       LEFT JOIN interaction_searches AS search ON search.interaction_turn_id = turn.id
      WHERE session.id IN ($1, $2)
      GROUP BY session.id, session.search_count
      ORDER BY session.id`,
    [owner.accessSessionId, foreign.accessSessionId],
  );
  assert.equal(state.rows.length, 2);
  assert.ok(state.rows.every((row) => row.search_count === 0 && row.search_rows === 0));
});
