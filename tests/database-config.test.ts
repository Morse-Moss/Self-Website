import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createDatabaseClientConfig,
  createDatabasePool,
  createDatabasePoolConfig,
} from '../lib/server/db.ts';

test('production database pools centralize TLS, limits, timeouts and role identity', () => {
  const config = createDatabasePoolConfig(
    'postgresql://runtime:password@db.internal/revolution',
    {
      env: {
        NODE_ENV: 'production',
        MORSE_DATABASE_SSL_MODE: 'verify-full',
        MORSE_DATABASE_SSL_CA: 'test-ca',
        MORSE_DATABASE_POOL_MAX: '7',
        MORSE_DATABASE_CONNECT_TIMEOUT_MS: '4100',
        MORSE_DATABASE_IDLE_TIMEOUT_MS: '29000',
        MORSE_DATABASE_STATEMENT_TIMEOUT_MS: '22000',
        MORSE_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: '17000',
      },
      role: 'web',
    },
  );

  assert.equal(config.max, 7);
  assert.equal(config.connectionTimeoutMillis, 4100);
  assert.equal(config.idleTimeoutMillis, 29000);
  assert.equal(config.statement_timeout, 22000);
  assert.equal(config.idle_in_transaction_session_timeout, 17000);
  assert.equal(config.application_name, 'revolution-web');
  assert.deepEqual(config.ssl, {
    ca: 'test-ca',
    rejectUnauthorized: true,
  });
});

test('migration and ingest clients consume the same TLS and timeout source as pools', () => {
  const config = createDatabaseClientConfig(
    'postgresql://migration:password@db.internal/revolution',
    {
      env: {
        NODE_ENV: 'production',
        MORSE_DATABASE_SSL_MODE: 'require',
        MORSE_DATABASE_CONNECT_TIMEOUT_MS: '4500',
        MORSE_DATABASE_STATEMENT_TIMEOUT_MS: '120000',
        MORSE_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: '45000',
      },
      role: 'migration',
    },
  );

  assert.equal(config.application_name, 'revolution-migration');
  assert.equal(config.connectionTimeoutMillis, 4500);
  assert.equal(config.statement_timeout, 120000);
  assert.equal(config.idle_in_transaction_session_timeout, 45000);
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

test('development database pools keep loopback compatibility with bounded defaults', () => {
  const config = createDatabasePoolConfig(
    'postgresql://revolution@127.0.0.1:55432/revolution',
    { env: { NODE_ENV: 'development' }, role: 'web' },
  );

  assert.equal(config.max, 10);
  assert.equal(config.connectionTimeoutMillis, 5_000);
  assert.equal(config.idleTimeoutMillis, 30_000);
  assert.equal(config.statement_timeout, 30_000);
  assert.equal(config.idle_in_transaction_session_timeout, 30_000);
  assert.equal(config.application_name, 'revolution-web');
  assert.equal(config.ssl, false);
});

test('local production smoke may use only a loopback database with an exact loopback HTTP origin', () => {
  const config = createDatabasePoolConfig(
    'postgresql://revolution@127.0.0.1:55432/revolution',
    {
      env: {
        NODE_ENV: 'production',
        MORSE_LOCAL_RELEASE_SMOKE: 'true',
        MORSE_DATABASE_SSL_MODE: 'disable',
        MORSE_PUBLIC_ORIGIN: 'http://127.0.0.1:3010',
      },
      role: 'web',
    },
  );
  assert.equal(config.ssl, false);

  assert.throws(
    () => createDatabasePoolConfig(
      'postgresql://revolution@127.0.0.1:55432/revolution',
      {
        env: {
          NODE_ENV: 'production',
          MORSE_LOCAL_RELEASE_SMOKE: 'true',
          MORSE_DATABASE_SSL_MODE: 'disable',
          MORSE_PUBLIC_ORIGIN: 'https://morse.example',
        },
        role: 'web',
      },
    ),
    /DATABASE_TLS_REQUIRED/,
  );
});

test('database pool configuration rejects URL-level TLS overrides and unsafe bounds', () => {
  assert.throws(
    () => createDatabasePoolConfig(
      'postgresql://runtime@db.internal/revolution?sslmode=disable',
      {
        env: {
          NODE_ENV: 'production',
          MORSE_DATABASE_SSL_MODE: 'require',
        },
        role: 'worker',
      },
    ),
    /DATABASE_URL_TLS_OVERRIDE_FORBIDDEN/,
  );
  assert.throws(
    () => createDatabasePoolConfig(
      'postgresql://runtime@db.internal/revolution',
      {
        env: {
          NODE_ENV: 'production',
          MORSE_DATABASE_SSL_MODE: 'require',
          MORSE_DATABASE_POOL_MAX: '101',
        },
        role: 'worker',
      },
    ),
    /DATABASE_POOL_MAX_INVALID/,
  );

  for (const query of [
    'ssl=no-verify',
    'application_name=override&statement_timeout=0',
    'connect_timeout=0',
  ]) {
    assert.throws(
      () => createDatabasePoolConfig(
        `postgresql://runtime@db.internal/revolution?${query}`,
        {
          env: {
            NODE_ENV: 'production',
            MORSE_DATABASE_SSL_MODE: 'verify-full',
            MORSE_DATABASE_SSL_CA: 'test-ca',
          },
          role: 'web',
        },
      ),
      /DATABASE_URL_QUERY_FORBIDDEN/,
      query,
    );
  }
});

test('application database pools handle idle client errors with a stable privacy-safe signal', async () => {
  const events: string[] = [];
  const pool = createDatabasePool(
    'postgresql://revolution@127.0.0.1:55432/revolution',
    {
      env: { NODE_ENV: 'test' },
      onIdleError: (code) => events.push(code),
      role: 'web',
    },
  );
  try {
    assert.ok(pool.listenerCount('error') > 0);
    pool.emit('error', new Error('private database detail'));
    assert.deepEqual(events, ['DATABASE_POOL_IDLE_ERROR']);
  } finally {
    await pool.end();
  }
});
