import assert from 'node:assert/strict';
import os from 'node:os';
import { test } from 'node:test';

import {
  ReadinessError,
  assertApplicationReady,
} from '../lib/server/readiness.ts';

const validAdminPasswordHash = [
  'scrypt',
  '1',
  '16384',
  '8',
  '1',
  Buffer.alloc(16).toString('base64url'),
  Buffer.alloc(64).toString('base64url'),
].join('$');

const runtimeEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://runtime:password@db.internal/revolution',
  MORSE_DATABASE_SSL_MODE: 'require',
  MORSE_PUBLIC_ORIGIN: 'https://morse.example',
  MORSE_ADMIN_ALLOWED_ORIGIN: 'https://morse.example',
  MORSE_ADMIN_PASSWORD_HASH: validAdminPasswordHash,
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

const manifest = [
  { version: '001', checksum: 'a'.repeat(64) },
  { version: '002', checksum: 'b'.repeat(64) },
];

function poolWith(options: { chunks?: number; migrations?: typeof manifest; throws?: boolean } = {}) {
  return {
    async query(sql: string) {
      if (options.throws) throw new Error('private database failure');
      if (sql.includes('schema_migrations')) {
        return { rows: options.migrations ?? manifest };
      }
      if (sql.includes('knowledge_chunks')) {
        return { rows: [{ present: (options.chunks ?? 1) > 0 }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('readiness accepts valid runtime config, exact migrations and non-empty knowledge', async () => {
  await assert.doesNotReject(assertApplicationReady({
    env: runtimeEnv,
    expectedMigrations: manifest,
    pool: poolWith(),
  }));
});

test('readiness validates enabled resume config in local and production runtimes', async () => {
  const commonResumeEnv = {
    MORSE_RESUME_ENABLED: 'true',
    MORSE_RESUME_STORAGE_DIR: os.tmpdir(),
    MORSE_RESUME_KEY_VERSION: '1',
    MORSE_RESUME_FINGERPRINT_SECRET: 'resume-fingerprint-secret-32-bytes',
  };
  const localKey = Buffer.alloc(32, 5).toString('base64');

  await assert.doesNotReject(assertApplicationReady({
    env: {
      ...runtimeEnv,
      NODE_ENV: 'development',
      ...commonResumeEnv,
      MORSE_RESUME_ENCRYPTION_KEY: localKey,
      MORSE_RESUME_TRUSTED_PROXY_HOPS: '0',
    },
    expectedMigrations: manifest,
    pool: poolWith(),
  }));

  for (const env of [
    {
      ...runtimeEnv,
      NODE_ENV: 'development',
      ...commonResumeEnv,
      MORSE_RESUME_ENCRYPTION_KEY: 'not-canonical-base64',
      MORSE_RESUME_TRUSTED_PROXY_HOPS: '0',
    },
    {
      ...runtimeEnv,
      ...commonResumeEnv,
      MORSE_RESUME_ENCRYPTION_KEY: localKey,
      MORSE_RESUME_TRUSTED_PROXY_HOPS: '1',
    },
  ]) {
    await assert.rejects(
      assertApplicationReady({
        env,
        expectedMigrations: manifest,
        pool: poolWith(),
      }),
      (error: unknown) => {
        assert.ok(error instanceof ReadinessError);
        assert.equal(error.code, 'READINESS_RUNTIME_INVALID');
        assert.equal(error.message, 'READINESS_RUNTIME_INVALID');
        assert.doesNotMatch(String(error), /not-canonical|BQUFBQ/u);
        return true;
      },
    );
  }
});

test('readiness distinguishes internal failure causes without exposing their values', async () => {
  const cases = [
    ['READINESS_RUNTIME_INVALID', {
      env: { ...runtimeEnv, OPENAI_API_KEY: '' },
      expectedMigrations: manifest,
      pool: poolWith(),
    }],
    ['READINESS_MIGRATIONS_INCOMPLETE', {
      env: runtimeEnv,
      expectedMigrations: manifest,
      pool: poolWith({ migrations: manifest.slice(0, 1) }),
    }],
    ['READINESS_KNOWLEDGE_EMPTY', {
      env: runtimeEnv,
      expectedMigrations: manifest,
      pool: poolWith({ chunks: 0 }),
    }],
    ['READINESS_DATABASE_UNAVAILABLE', {
      env: runtimeEnv,
      expectedMigrations: manifest,
      pool: poolWith({ throws: true }),
    }],
  ] as const;

  for (const [code, input] of cases) {
    await assert.rejects(
      assertApplicationReady(input),
      (error: unknown) => {
        assert.ok(error instanceof ReadinessError);
        assert.equal(error.code, code);
        assert.equal(error.message, code);
        assert.doesNotMatch(String(error), /test-production|private database failure/);
        return true;
      },
      code,
    );
  }
});
