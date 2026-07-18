import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ProductionConfigError,
  validateProductionRole,
} from '../lib/server/production-config.ts';

const databaseEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://runtime:password@db.internal/revolution',
  MORSE_DATABASE_SSL_MODE: 'verify-full',
  MORSE_DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----',
};

const validAdminPasswordHash = [
  'scrypt',
  '1',
  '16384',
  '8',
  '1',
  Buffer.alloc(16).toString('base64url'),
  Buffer.alloc(64).toString('base64url'),
].join('$');

const webEnv = {
  ...databaseEnv,
  MORSE_PUBLIC_ORIGIN: 'https://morse.example',
  MORSE_ADMIN_ALLOWED_ORIGIN: 'https://morse.example',
  MORSE_ADMIN_PASSWORD_HASH: validAdminPasswordHash,
  MORSE_ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
  MORSE_INVITE_FINGERPRINT_SECRET: 'invite-fingerprint-secret-32-bytes',
  OPENAI_API_KEY: 'test-production-chat-key',
  OPENAI_BASE_URL: 'https://gateway.example/v1',
  OPENAI_CHAT_MODEL: 'gpt-production',
  OPENAI_CHAT_PROTOCOL: 'responses',
  OPENAI_EMBEDDING_API_KEY: 'test-production-embedding-key',
  OPENAI_EMBEDDING_BASE_URL: 'https://embedding.internal.example/v1',
  OPENAI_EMBEDDING_MODEL: 'bge-production',
  MORSE_ALLOW_TEST_EMBEDDINGS: 'false',
};

test('production preflight validates only the configuration owned by each role', () => {
  assert.deepEqual(validateProductionRole('web', webEnv), {
    alertsEnabled: null,
    role: 'web',
  });
  assert.deepEqual(validateProductionRole('worker', {
    ...databaseEnv,
    MORSE_ALERTS_ENABLED: 'false',
  }), {
    alertsEnabled: false,
    role: 'worker',
  });
  assert.deepEqual(validateProductionRole('worker', {
    ...databaseEnv,
    MORSE_ALERTS_ENABLED: 'true',
    FEISHU_WEBHOOK_URL: 'https://feishu.example/hook/test',
  }), {
    alertsEnabled: true,
    role: 'worker',
  });
  assert.deepEqual(validateProductionRole('migration', databaseEnv), {
    alertsEnabled: null,
    role: 'migration',
  });
  assert.deepEqual(validateProductionRole('ingest', {
    ...databaseEnv,
    OPENAI_EMBEDDING_API_KEY: 'test-production-embedding-key',
    OPENAI_EMBEDDING_BASE_URL: 'https://embedding.internal.example/v1',
    OPENAI_EMBEDDING_MODEL: 'bge-production',
    MORSE_ALLOW_TEST_EMBEDDINGS: 'false',
  }), {
    alertsEnabled: null,
    role: 'ingest',
  });
});

test('production preflight permits only explicitly opted-in private HTTP embeddings', () => {
  const internal = {
    ...webEnv,
    OPENAI_EMBEDDING_BASE_URL: 'http://embedding:18091/v1',
    MORSE_EMBEDDING_ALLOW_PRIVATE_HTTP: 'true',
  };
  assert.deepEqual(validateProductionRole('web', internal), {
    alertsEnabled: null,
    role: 'web',
  });
  assert.throws(
    () => validateProductionRole('web', {
      ...internal,
      MORSE_EMBEDDING_ALLOW_PRIVATE_HTTP: 'false',
    }),
    (error: unknown) => (
      error instanceof ProductionConfigError
      && error.code === 'PRODUCTION_EMBEDDING_CONFIG_INVALID'
    ),
  );
  assert.throws(
    () => validateProductionRole('web', {
      ...internal,
      OPENAI_EMBEDDING_BASE_URL: 'http://embedding.example/v1',
    }),
    (error: unknown) => (
      error instanceof ProductionConfigError
      && error.code === 'PRODUCTION_EMBEDDING_CONFIG_INVALID'
    ),
  );
});

test('production preflight fails closed with stable codes and never echoes values', () => {
  const cases = [
    ['PRODUCTION_NODE_ENV_REQUIRED', { ...webEnv, NODE_ENV: 'development' }],
    ['PRODUCTION_DATABASE_TLS_REQUIRED', {
      ...webEnv,
      MORSE_DATABASE_SSL_MODE: 'disable',
    }],
    ['PRODUCTION_PUBLIC_ORIGIN_INVALID', {
      ...webEnv,
      MORSE_PUBLIC_ORIGIN: 'http://morse.example',
    }],
    ['PRODUCTION_ADMIN_ORIGIN_MISMATCH', {
      ...webEnv,
      MORSE_ADMIN_ALLOWED_ORIGIN: 'https://admin.example',
    }],
    ['PRODUCTION_ADMIN_CREDENTIALS_INVALID', {
      ...webEnv,
      MORSE_ADMIN_PASSWORD_HASH: 'x'.repeat(24),
    }],
    ['PRODUCTION_ADMIN_CREDENTIALS_INVALID', {
      ...webEnv,
      MORSE_ADMIN_TOTP_SECRET: 'BBBBBBBBBBBBBBBBB',
    }],
    ['PRODUCTION_TEST_EMBEDDINGS_FORBIDDEN', {
      ...webEnv,
      MORSE_ALLOW_TEST_EMBEDDINGS: 'true',
    }],
    ['PRODUCTION_PROVIDER_CONFIG_INVALID', {
      ...webEnv,
      OPENAI_BASE_URL: 'http://127.0.0.1:8080/v1',
    }],
    ['PRODUCTION_PROVIDER_CONFIG_INVALID', {
      ...webEnv,
      OPENAI_BASE_URL: 'https://gateway.example/v1?unsafe=override',
    }],
    ['PRODUCTION_LOCAL_SMOKE_FORBIDDEN', {
      ...webEnv,
      MORSE_LOCAL_RELEASE_SMOKE: 'true',
    }],
  ] as const;

  for (const [code, env] of cases) {
    assert.throws(
      () => validateProductionRole('web', env),
      (error: unknown) => {
        assert.ok(error instanceof ProductionConfigError);
        assert.equal(error.code, code);
        assert.equal(error.message, code);
        assert.doesNotMatch(String(error), /test-production|password@|BEGIN CERTIFICATE/);
        return true;
      },
      code,
    );
  }
});

test('worker alert delivery must be explicitly enabled or disabled', () => {
  assert.throws(
    () => validateProductionRole('worker', databaseEnv),
    (error: unknown) => (
      error instanceof ProductionConfigError
      && error.code === 'PRODUCTION_ALERT_MODE_REQUIRED'
    ),
  );
  assert.throws(
    () => validateProductionRole('worker', {
      ...databaseEnv,
      MORSE_ALERTS_ENABLED: 'true',
      FEISHU_WEBHOOK_URL: 'http://open.feishu.cn/hook/test',
    }),
    (error: unknown) => (
      error instanceof ProductionConfigError
      && error.code === 'PRODUCTION_FEISHU_CONFIG_INVALID'
    ),
  );

  for (const env of [
    { MORSE_ALERT_DISPATCH_LIMIT: '0' },
    { MORSE_ALERT_MAX_ATTEMPTS: '21' },
    { MORSE_WORKER_POLL_MS: '0' },
    { MORSE_WORKER_BACKOFF_MAX_MS: '60001' },
    { MORSE_CLEANUP_INTERVAL_MS: '1000' },
  ]) {
    assert.throws(
      () => validateProductionRole('worker', {
        ...databaseEnv,
        MORSE_ALERTS_ENABLED: 'false',
        ...env,
      }),
      (error: unknown) => (
        error instanceof ProductionConfigError
        && error.code === 'PRODUCTION_WORKER_CONFIG_INVALID'
      ),
    );
  }
});
