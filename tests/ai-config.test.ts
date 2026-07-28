import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import * as aiConfigModule from '../lib/server/ai-config.ts';
import {
  AI_CONFIG_PUBLIC_ERROR_CODES,
  AiConfigError,
  createRuntimeConfigDigest,
  loadAiConfigKey,
} from '../lib/server/ai-config.ts';

const key = Buffer.alloc(32, 7);
const canonicalKey = key.toString('base64');

test('provider management exposes the complete stable public error code contract', () => {
  assert.deepEqual(AI_CONFIG_PUBLIC_ERROR_CODES, [
    'AI_CONFIG_UNAVAILABLE',
    'AI_CONFIG_INVALID',
    'AI_CONFIG_CONFLICT',
    'AI_CONFIG_TEST_REQUIRED',
    'AI_CONFIG_TEST_FAILED',
    'AI_CONFIG_IN_USE',
    'AI_CONFIG_HISTORY_RETAINED',
    'AI_CONFIG_SECRET_UNAVAILABLE',
    'AI_CONFIG_TARGET_DELETED',
    'AI_CONFIG_RATE_LIMITED',
    'AI_CONFIG_ENVIRONMENT_CHANGED',
    'AI_CONFIG_ENVIRONMENT_UNAVAILABLE',
    'AI_CONFIG_TAKEOVER_EXISTS',
  ]);
});

test('development loads one canonical 32-byte provider configuration key', () => {
  const result = loadAiConfigKey({
    NODE_ENV: 'development',
    MORSE_PROVIDER_CONFIG_KEY: canonicalKey,
    MORSE_PROVIDER_CONFIG_KEY_VERSION: '3',
  });

  assert.deepEqual(result.key, key);
  assert.equal(result.keyVersion, 3);
});

test('production accepts only a file-backed provider configuration key', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'morse-provider-key-'));
  const file = path.join(directory, 'provider-key');
  try {
    fs.writeFileSync(file, `${canonicalKey}\n`, { encoding: 'utf8', mode: 0o600 });
    const result = loadAiConfigKey({
      NODE_ENV: 'production',
      MORSE_PROVIDER_CONFIG_KEY: '',
      MORSE_PROVIDER_CONFIG_KEY_FILE: file,
      MORSE_PROVIDER_CONFIG_KEY_VERSION: '1',
    });
    assert.deepEqual(result.key, key);
    assert.equal(result.keyVersion, 1);

    assert.throws(
      () => loadAiConfigKey({
        NODE_ENV: 'production',
        MORSE_PROVIDER_CONFIG_KEY: canonicalKey,
        MORSE_PROVIDER_CONFIG_KEY_VERSION: '1',
      }),
      (error: unknown) => error instanceof AiConfigError
        && error.code === 'AI_CONFIG_KEY_INVALID',
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('provider configuration key loading rejects ambiguous or malformed input', () => {
  const invalidEnvironments = [
    {},
    {
      MORSE_PROVIDER_CONFIG_KEY: canonicalKey,
      MORSE_PROVIDER_CONFIG_KEY_FILE: 'unused',
      MORSE_PROVIDER_CONFIG_KEY_VERSION: '1',
    },
    {
      MORSE_PROVIDER_CONFIG_KEY: Buffer.alloc(31).toString('base64'),
      MORSE_PROVIDER_CONFIG_KEY_VERSION: '1',
    },
    {
      MORSE_PROVIDER_CONFIG_KEY: `${canonicalKey}\n`,
      MORSE_PROVIDER_CONFIG_KEY_VERSION: '1',
    },
    {
      MORSE_PROVIDER_CONFIG_KEY: canonicalKey,
      MORSE_PROVIDER_CONFIG_KEY_VERSION: '0',
    },
    {
      MORSE_PROVIDER_CONFIG_KEY: canonicalKey,
      MORSE_PROVIDER_CONFIG_KEY_VERSION: '1.5',
    },
  ];

  for (const environment of invalidEnvironments) {
    assert.throws(
      () => loadAiConfigKey({ NODE_ENV: 'test', ...environment }),
      (error: unknown) => error instanceof AiConfigError
        && ['AI_CONFIG_KEY_INVALID', 'AI_CONFIG_KEY_VERSION_INVALID'].includes(error.code),
    );
  }
});

test('runtime digest is canonical, secret-bearing, and excludes display metadata', () => {
  const digestKey = Buffer.alloc(32, 9);
  const runtime = {
    apiKey: 'provider-secret-value',
    baseUrl: 'https://gateway.example/v1',
    modelId: 'gpt-example',
    protocol: 'responses' as const,
    reasoningEffort: 'high',
    userAgent: 'Morse/1.0',
    maxOutputTokens: 4096,
  };
  const digest = createRuntimeConfigDigest(runtime, digestKey);
  const reordered = createRuntimeConfigDigest({
    maxOutputTokens: 4096,
    userAgent: 'Morse/1.0',
    reasoningEffort: 'high',
    protocol: 'responses',
    modelId: 'gpt-example',
    baseUrl: 'https://gateway.example/v1',
    apiKey: 'provider-secret-value',
  }, digestKey);

  assert.match(digest, /^[0-9a-f]{64}$/u);
  assert.equal(reordered, digest);
  assert.doesNotMatch(digest, /provider-secret|gateway/u);

  for (const change of [
    { apiKey: 'changed' },
    { baseUrl: 'https://other.example/v1' },
    { modelId: 'gpt-other' },
    { protocol: 'chat_completions' as const },
    { reasoningEffort: 'medium' },
    { userAgent: 'Morse/2.0' },
    { maxOutputTokens: 2048 },
  ]) {
    assert.notEqual(createRuntimeConfigDigest({ ...runtime, ...change }, digestKey), digest);
  }

  assert.equal(createRuntimeConfigDigest({
    ...runtime,
    displayName: 'Renamed',
    inputUsdPerMillion: '1.25',
    outputUsdPerMillion: '4.50',
  }, digestKey), digest);
});

test('runtime digest v1 bytes stay frozen while v2 is capability-bound and domain-separated', () => {
  const digestApi = aiConfigModule as typeof aiConfigModule & {
    createRuntimeConfigDigestV1: typeof createRuntimeConfigDigest;
    createRuntimeConfigDigestV2: (input: {
      apiKey: string;
      baseUrl: string;
      contextWindowTokens: number | null;
      maxOutputTokens: number | null;
      modelId: string;
      protocol: 'responses' | 'chat_completions';
      reasoningEffort: string | null;
      userAgent: string | null;
    }, digestKey: Buffer) => string;
  };
  assert.equal(typeof digestApi.createRuntimeConfigDigestV1, 'function');
  assert.equal(typeof digestApi.createRuntimeConfigDigestV2, 'function');

  const digestKey = Buffer.alloc(32, 9);
  const v1Input = {
    apiKey: 'provider-secret-value',
    baseUrl: 'https://gateway.example/v1',
    maxOutputTokens: 4096,
    modelId: 'gpt-example',
    protocol: 'responses' as const,
    reasoningEffort: 'high',
    userAgent: 'Morse/1.0',
  };
  const frozenV1 = '3fe95838d42a56d565cd63eeb122f45a56f50d4a17f2a37f27e644097d7828e8';

  assert.equal(digestApi.createRuntimeConfigDigestV1(v1Input, digestKey), frozenV1);
  assert.equal(createRuntimeConfigDigest(v1Input, digestKey), frozenV1);

  const v2Input = {
    ...v1Input,
    contextWindowTokens: null,
  };
  const v2 = digestApi.createRuntimeConfigDigestV2(v2Input, digestKey);
  assert.match(v2, /^[0-9a-f]{64}$/u);
  assert.notEqual(v2, frozenV1);
  assert.notEqual(
    digestApi.createRuntimeConfigDigestV2({
      ...v2Input,
      contextWindowTokens: 128_000,
    }, digestKey),
    v2,
  );
  assert.notEqual(
    digestApi.createRuntimeConfigDigestV2({
      ...v2Input,
      maxOutputTokens: null,
    }, digestKey),
    v2,
  );
});
