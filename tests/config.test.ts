import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadAccessConfig, loadServerConfig } from '../lib/server/config.ts';

const completeEnv: Record<string, string> = {
  DATABASE_URL: 'postgresql://localhost/revolution',
  OPENAI_API_KEY: 'test-key',
  OPENAI_BASE_URL: 'http://127.0.0.1:8080/v1',
  OPENAI_CHAT_MODEL: 'test-chat',
  OPENAI_CHAT_PROTOCOL: 'chat_completions',
  OPENAI_EMBEDDING_API_KEY: 'embedding-key',
  OPENAI_EMBEDDING_BASE_URL: 'http://127.0.0.1:18091/v1',
  OPENAI_EMBEDDING_MODEL: 'test-embedding',
  MORSE_EMBEDDING_TIMEOUT_MS: '7000',
  MORSE_PROVIDER_FIRST_BYTE_TIMEOUT_MS: '19000',
  MORSE_PROVIDER_TOTAL_TIMEOUT_MS: '85000',
  MORSE_PROVIDER_CONCURRENCY: '3',
  MORSE_MAX_MESSAGES_PER_SESSION: '30',
  MORSE_SESSION_HOURS: '12',
  MORSE_INPUT_USD_PER_MILLION: '1.25',
  MORSE_OUTPUT_USD_PER_MILLION: '10',
};

test('loadServerConfig parses access, provider, lifecycle, and optional pricing settings', () => {
  const config = loadServerConfig(completeEnv);

  assert.equal(config.databaseUrl, 'postgresql://localhost/revolution');
  assert.equal(config.cookieName, 'morse_access');
  assert.equal(config.sessionHours, 12);
  assert.equal(config.maxMessagesPerSession, 30);
  assert.equal(config.chatModel, 'test-chat');
  assert.equal(config.chatProtocol, 'chat_completions');
  assert.equal(config.openaiBaseUrl, 'http://127.0.0.1:8080/v1');
  assert.equal(config.embeddingApiKey, 'embedding-key');
  assert.equal(config.embeddingBaseUrl, 'http://127.0.0.1:18091/v1');
  assert.equal(config.embeddingTimeoutMs, 7000);
  assert.equal(config.providerFirstByteTimeoutMs, 19000);
  assert.equal(config.providerTotalTimeoutMs, 85000);
  assert.equal(config.providerConcurrency, 3);
  assert.equal(config.chatEnabled, true);
  assert.equal(config.sseHeartbeatMs, 15_000);
  assert.equal(config.interactionRetentionDays, 10);
  assert.equal(config.searchEnabled, false);
  assert.equal(config.maxSearchesPerSession, 5);
  assert.equal(config.searchConcurrency, 2);
  assert.equal(config.searchTimeoutMs, 12_000);
  assert.equal(config.searchProvider, null);
  assert.equal(config.bochaApiKey, null);
  assert.deepEqual(config.tokenRates, {
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
  });
});

test('loadServerConfig falls back to chat credentials for embeddings', () => {
  const env = { ...completeEnv };
  delete env.OPENAI_EMBEDDING_API_KEY;
  delete env.OPENAI_EMBEDDING_BASE_URL;

  const config = loadServerConfig(env);

  assert.equal(config.embeddingApiKey, 'test-key');
  assert.equal(config.embeddingBaseUrl, 'http://127.0.0.1:8080/v1');
});

test('loadServerConfig fails closed for missing secrets or model IDs', () => {
  for (const key of [
    'DATABASE_URL',
    'OPENAI_API_KEY',
    'OPENAI_CHAT_MODEL',
    'OPENAI_CHAT_PROTOCOL',
    'OPENAI_EMBEDDING_MODEL',
  ]) {
    const env = { ...completeEnv };
    delete env[key as keyof typeof env];
    assert.throws(() => loadServerConfig(env), new RegExp(key));
  }
});

test('loadServerConfig enables only strict Bocha search configuration and parses trust lists', () => {
  const config = loadServerConfig({
    ...completeEnv,
    MORSE_SEARCH_ENABLED: 'true',
    MORSE_SEARCH_PROVIDER: 'bocha',
    BOCHA_API_KEY: 'bocha-key',
    BOCHA_BASE_URL: 'https://api.bocha.test/v1/',
    MORSE_MAX_SEARCHES_PER_SESSION: '5',
    MORSE_SEARCH_CONCURRENCY: '1',
    MORSE_SEARCH_TIMEOUT_MS: '9000',
    MORSE_OFFICIAL_SOURCE_DOMAINS: ' OpenAI.com,platform.openai.com,openai.com ',
    MORSE_OFFICIAL_GITHUB_OWNERS: ' Morse-Moss,openai ',
  });

  assert.equal(config.searchEnabled, true);
  assert.equal(config.searchProvider, 'bocha');
  assert.equal(config.bochaApiKey, 'bocha-key');
  assert.equal(config.bochaBaseUrl, 'https://api.bocha.test/v1');
  assert.equal(config.maxSearchesPerSession, 5);
  assert.equal(config.searchConcurrency, 1);
  assert.equal(config.searchTimeoutMs, 9000);
  assert.deepEqual(config.officialSourceDomains, ['openai.com', 'platform.openai.com']);
  assert.deepEqual(config.officialGithubOwners, ['Morse-Moss', 'openai']);
});

test('loadServerConfig keeps search disabled without a key and fails closed when enabled settings are unsafe', () => {
  assert.doesNotThrow(() => loadServerConfig({ ...completeEnv, MORSE_SEARCH_ENABLED: 'false' }));

  for (const [name, env, pattern] of [
    ['missing key', { MORSE_SEARCH_ENABLED: 'true', MORSE_SEARCH_PROVIDER: 'bocha' }, /BOCHA_API_KEY/],
    ['wrong provider', { MORSE_SEARCH_ENABLED: 'true', MORSE_SEARCH_PROVIDER: 'other', BOCHA_API_KEY: 'key' }, /MORSE_SEARCH_PROVIDER.*bocha/],
    ['unsafe base', { MORSE_SEARCH_ENABLED: 'true', MORSE_SEARCH_PROVIDER: 'bocha', BOCHA_API_KEY: 'key', BOCHA_BASE_URL: 'http:\/\/bocha.test' }, /BOCHA_BASE_URL.*HTTPS/],
    ['concurrency above two', { MORSE_SEARCH_CONCURRENCY: '3' }, /MORSE_SEARCH_CONCURRENCY.*2/],
    ['quota above five', { MORSE_MAX_SEARCHES_PER_SESSION: '6' }, /MORSE_MAX_SEARCHES_PER_SESSION.*5/],
    ['bad domain', { MORSE_OFFICIAL_SOURCE_DOMAINS: 'https:\/\/openai.com/docs' }, /MORSE_OFFICIAL_SOURCE_DOMAINS/],
    ['github cannot bypass owner rules', { MORSE_OFFICIAL_SOURCE_DOMAINS: 'github.com' }, /MORSE_OFFICIAL_SOURCE_DOMAINS.*GitHub/],
    ['bad owner', { MORSE_OFFICIAL_GITHUB_OWNERS: 'Morse\/Moss' }, /MORSE_OFFICIAL_GITHUB_OWNERS/],
  ] as const) {
    assert.throws(() => loadServerConfig({ ...completeEnv, ...env }), pattern, name);
  }
});

test('loadServerConfig permits only loopback HTTP for the local Bocha Mock', () => {
  const config = loadServerConfig({
    ...completeEnv,
    MORSE_SEARCH_ENABLED: 'true',
    MORSE_SEARCH_PROVIDER: 'bocha',
    BOCHA_API_KEY: 'mock-key',
    BOCHA_BASE_URL: 'http://127.0.0.1:43123/v1/',
  });

  assert.equal(config.bochaBaseUrl, 'http://127.0.0.1:43123/v1');
});

test('loadServerConfig accepts omitted token rates and rejects partial or invalid pairs', () => {
  const omitted = { ...completeEnv };
  delete omitted.MORSE_INPUT_USD_PER_MILLION;
  delete omitted.MORSE_OUTPUT_USD_PER_MILLION;
  assert.equal(loadServerConfig(omitted).tokenRates, null);

  const missingOutput = { ...completeEnv };
  delete missingOutput.MORSE_OUTPUT_USD_PER_MILLION;
  assert.throws(() => loadServerConfig(missingOutput), /MORSE_INPUT_USD_PER_MILLION.*MORSE_OUTPUT_USD_PER_MILLION/);

  const missingInput = { ...completeEnv };
  delete missingInput.MORSE_INPUT_USD_PER_MILLION;
  assert.throws(() => loadServerConfig(missingInput), /MORSE_INPUT_USD_PER_MILLION.*MORSE_OUTPUT_USD_PER_MILLION/);

  assert.throws(
    () => loadServerConfig({ ...completeEnv, MORSE_INPUT_USD_PER_MILLION: '0' }),
    /MORSE_INPUT_USD_PER_MILLION.*positive number/,
  );
});

test('loadServerConfig ignores the removed monthly budget setting', () => {
  const config = loadServerConfig({ ...completeEnv, MORSE_MONTHLY_BUDGET_USD: 'not-a-number' });
  assert.equal('monthlyBudgetUsd' in config, false);
});

test('loadServerConfig parses kill switch, heartbeat, and fixed retention settings', () => {
  const disabled = loadServerConfig({
    ...completeEnv,
    MORSE_CHAT_ENABLED: 'false',
    MORSE_SSE_HEARTBEAT_MS: '2500',
    MORSE_INTERACTION_RETENTION_DAYS: '10',
  });
  assert.equal(disabled.chatEnabled, false);
  assert.equal(disabled.sseHeartbeatMs, 2500);
  assert.equal(disabled.interactionRetentionDays, 10);

  assert.throws(
    () => loadServerConfig({ ...completeEnv, MORSE_CHAT_ENABLED: 'yes' }),
    /MORSE_CHAT_ENABLED.*true.*false/,
  );
});

test('loadServerConfig rejects interaction retention other than ten days', () => {
  for (const days of ['7', '14']) {
    assert.throws(
      () => loadServerConfig({ ...completeEnv, MORSE_INTERACTION_RETENTION_DAYS: days }),
      /MORSE_INTERACTION_RETENTION_DAYS.*10/,
    );
  }
});

test('loadAccessConfig needs only database and access settings', () => {
  assert.deepEqual(loadAccessConfig({ DATABASE_URL: 'postgresql://localhost/revolution' }), {
    databaseUrl: 'postgresql://localhost/revolution',
    cookieName: 'morse_access',
    sessionHours: 12,
    maxMessagesPerSession: 30,
  });
});

test('loadServerConfig rejects an unsupported explicit chat protocol', () => {
  assert.throws(
    () => loadServerConfig({ ...completeEnv, OPENAI_CHAT_PROTOCOL: 'automatic' }),
    /OPENAI_CHAT_PROTOCOL.*responses.*chat_completions/,
  );
});

test('loadServerConfig rejects a non-integer provider concurrency', () => {
  assert.throws(
    () => loadServerConfig({ ...completeEnv, MORSE_PROVIDER_CONCURRENCY: '1.5' }),
    /MORSE_PROVIDER_CONCURRENCY.*positive integer/,
  );
});
