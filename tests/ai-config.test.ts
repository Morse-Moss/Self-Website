import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

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
