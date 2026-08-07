import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

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

const providerKeyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-provider-key-'));
const providerKeyFile = path.join(providerKeyDirectory, 'provider.key');
const contextDigestKeyFile = path.join(providerKeyDirectory, 'context-digest.key');
fs.writeFileSync(providerKeyFile, `${Buffer.alloc(32, 14).toString('base64')}\n`, 'utf8');
fs.writeFileSync(contextDigestKeyFile, `${Buffer.alloc(32, 15).toString('base64')}\n`, 'utf8');
after(() => fs.rmSync(providerKeyDirectory, { force: true, recursive: true }));

const runtimeEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://runtime:password@db.internal/revolution',
  MORSE_DATABASE_SSL_MODE: 'require',
  MORSE_PUBLIC_ORIGIN: 'https://morse.example',
  MORSE_ADMIN_ALLOWED_ORIGIN: 'https://morse.example',
  MORSE_ADMIN_PASSWORD_HASH: validAdminPasswordHash,
  MORSE_INVITE_FINGERPRINT_SECRET: 'invite-fingerprint-secret-32-bytes',
  MORSE_INVITE_TRUSTED_PROXY_HOPS: '1',
  MORSE_PROVIDER_CONFIG_KEY_FILE: providerKeyFile,
  MORSE_PROVIDER_CONFIG_KEY_VERSION: '1',
  MORSE_CONTEXT_PACKET_DIGEST_KEY_FILE: contextDigestKeyFile,
  MORSE_CONTEXT_PACKET_DIGEST_KEY_ID: 'test-context-key',
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

function poolWith(options: {
  activeV1EnvironmentRoute?: boolean;
  chunks?: number;
  configThrows?: boolean;
  dynamicContextReady?: boolean;
  migrations?: typeof manifest;
  queries?: string[];
  runtimeRows?: unknown[];
  throws?: boolean;
} = {}) {
  return {
    async query(sql: string) {
      options.queries?.push(sql);
      if (options.throws) throw new Error('private database failure');
      if (sql.includes('schema_migrations')) {
        return { rows: options.migrations ?? manifest };
      }
      if (sql.includes('knowledge_chunks')) {
        return { rows: [{ present: (options.chunks ?? 1) > 0 }] };
      }
      if (sql.includes('FROM ai_runtime_state state')) {
        return { rows: [options.activeV1EnvironmentRoute
          ? { id: '10000000-0000-4000-8000-000000000002', lock_version: '2', revision_number: '2' }
          : { id: null, lock_version: '0', revision_number: null }] };
      }
      if (sql.includes('FROM ai_route_targets target')) {
        if (!options.activeV1EnvironmentRoute) throw new Error('unexpected inactive route target query');
        return { rows: [{
          config_digest: 'a'.repeat(64),
          config_digest_version: 1,
          connection_display_name: 'Environment primary',
          context_window_tokens: null,
          database_model_series_id: null,
          database_model_version_id: null,
          environment_target_key: 'primary',
          input_usd_per_million: null,
          max_output_tokens: null,
          model_display_name: 'gpt-production',
          model_id: 'gpt-production',
          output_usd_per_million: null,
          position: 0,
          protocol: 'responses',
          reasoning_effort: null,
          source_type: 'environment',
        }] };
      }
      if (sql.includes('ai_runtime_state')) {
        return { rows: options.runtimeRows ?? [{ id: true, active_route_revision_id: null }] };
      }
      if (sql.includes('ai_connections')) {
        if (options.configThrows) throw new Error('private configuration permission failure');
        return { rows: [{
          connections_readable: true,
          models_readable: true,
          routes_readable: true,
          takeovers_readable: sql.includes('ai_environment_takeovers'),
          targets_readable: true,
        }] };
      }
      if (sql.includes('dynamic_context_ready')) {
        return { rows: [{ dynamic_context_ready: options.dynamicContextReady ?? true }] };
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

test('feature-off readiness accepts schema 012 or current without referencing 013 objects', async () => {
  const expected = Array.from({ length: 14 }, (_, index) => ({
    version: String(index + 1).padStart(3, '0'),
    checksum: String(index + 1).repeat(64).slice(0, 64),
  }));
  for (const actual of [expected.slice(0, 12), expected]) {
    const queries: string[] = [];
    await assert.doesNotReject(assertApplicationReady({
      env: { ...runtimeEnv, MORSE_DYNAMIC_PROVIDER_CONTEXT_ENABLED: 'false' },
      expectedMigrations: expected,
      pool: poolWith({ migrations: actual, queries }),
    }));
    assert.doesNotMatch(
      queries.join('\n'),
      /conversation_history_compactions|chat_history_summary_attempts|context_window_tokens|config_digest_version/u,
    );
  }
  await assert.rejects(
    assertApplicationReady({
      env: { ...runtimeEnv, MORSE_DYNAMIC_PROVIDER_CONTEXT_ENABLED: 'false' },
      expectedMigrations: expected,
      pool: poolWith({ migrations: expected.slice(0, 13) }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof ReadinessError);
      assert.equal(error.code, 'READINESS_MIGRATIONS_INCOMPLETE');
      return true;
    },
  );
});

test('feature-on readiness fails closed when required migrations or dynamic-context grants are unavailable', async () => {
  const expected = Array.from({ length: 14 }, (_, index) => ({
    version: String(index + 1).padStart(3, '0'),
    checksum: String(index + 1).repeat(64).slice(0, 64),
  }));
  const enabledEnv = {
    ...runtimeEnv,
    MORSE_DYNAMIC_PROVIDER_CONTEXT_ENABLED: 'true',
    MORSE_CONTEXT_PACKET_DIGEST_KEY_FILE: contextDigestKeyFile,
    MORSE_CONTEXT_PACKET_DIGEST_KEY_ID: 'readiness-context-v1',
  };
  for (const pool of [
    poolWith({ migrations: expected.slice(0, 12) }),
    poolWith({ migrations: expected, dynamicContextReady: false }),
  ]) {
    await assert.rejects(
      assertApplicationReady({ env: enabledEnv, expectedMigrations: expected, pool }),
      (error: unknown) => {
        assert.ok(error instanceof ReadinessError);
        assert.equal(error.code, 'READINESS_DYNAMIC_CONTEXT_UNAVAILABLE');
        return true;
      },
    );
  }
  await assert.rejects(
    assertApplicationReady({
      env: enabledEnv,
      expectedMigrations: expected,
      pool: poolWith({ migrations: expected.slice(0, 13) }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof ReadinessError);
      assert.equal(error.code, 'READINESS_MIGRATIONS_INCOMPLETE');
      return true;
    },
  );
  const queries: string[] = [];
  await assert.doesNotReject(assertApplicationReady({
    env: enabledEnv,
    expectedMigrations: expected,
    pool: poolWith({ migrations: expected, dynamicContextReady: true, queries }),
  }));
  const dynamicContextQuery = queries.find((sql) => sql.includes('dynamic_context_ready'));
  assert.ok(dynamicContextQuery);
  assert.match(dynamicContextQuery, /public\.conversation_history_compactions/u);
  assert.match(dynamicContextQuery, /has_table_privilege\(current_user, 'conversation_history_compactions', 'SELECT'\)/u);
  assert.match(dynamicContextQuery, /has_table_privilege\(current_user, 'conversation_history_compactions', 'INSERT'\)/u);
  assert.match(dynamicContextQuery, /has_table_privilege\(current_user, 'conversation_history_compactions', 'UPDATE'\)/u);
  assert.match(dynamicContextQuery, /has_table_privilege\(current_user, 'conversation_history_compactions', 'DELETE'\)/u);
  assert.doesNotMatch(dynamicContextQuery, /(?:public\.)?chat_history_compactions/u);
});

test('readiness fails closed when an active v1 environment route needs the removed output limit', async () => {
  const expected = Array.from({ length: 14 }, (_, index) => ({
    version: String(index + 1).padStart(3, '0'),
    checksum: String(index + 1).repeat(64).slice(0, 64),
  }));
  const env = {
    ...runtimeEnv,
    MORSE_DYNAMIC_PROVIDER_CONTEXT_ENABLED: 'true',
    MORSE_CONTEXT_PACKET_DIGEST_KEY_FILE: contextDigestKeyFile,
    MORSE_CONTEXT_PACKET_DIGEST_KEY_ID: 'readiness-context-v1',
  };
  await assert.rejects(
    assertApplicationReady({
      env,
      expectedMigrations: expected,
      pool: poolWith({
        activeV1EnvironmentRoute: true,
        dynamicContextReady: true,
        migrations: expected,
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof ReadinessError);
      assert.equal(error.code, 'READINESS_AI_CONFIG_UNAVAILABLE');
      return true;
    },
  );
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
    ['READINESS_AI_CONFIG_UNAVAILABLE', {
      env: runtimeEnv,
      expectedMigrations: manifest,
      pool: poolWith({ runtimeRows: [] }),
    }],
    ['READINESS_AI_CONFIG_UNAVAILABLE', {
      env: runtimeEnv,
      expectedMigrations: manifest,
      pool: poolWith({ configThrows: true }),
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
