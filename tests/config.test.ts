import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadServerConfig } from '../lib/server/config.ts';

const completeEnv = {
  DATABASE_URL: 'postgresql://localhost/revolution',
  OPENAI_API_KEY: 'test-key',
  OPENAI_BASE_URL: 'http://127.0.0.1:8080/v1',
  OPENAI_CHAT_MODEL: 'test-chat',
  OPENAI_EMBEDDING_API_KEY: 'embedding-key',
  OPENAI_EMBEDDING_BASE_URL: 'http://127.0.0.1:18091/v1',
  OPENAI_EMBEDDING_MODEL: 'test-embedding',
  MORSE_MAX_MESSAGES_PER_SESSION: '30',
  MORSE_SESSION_HOURS: '12',
  MORSE_MONTHLY_BUDGET_USD: '5',
  MORSE_INPUT_USD_PER_MILLION: '1.25',
  MORSE_OUTPUT_USD_PER_MILLION: '10',
};

test('loadServerConfig parses access, provider, and budget settings', () => {
  const config = loadServerConfig(completeEnv);

  assert.equal(config.databaseUrl, 'postgresql://localhost/revolution');
  assert.equal(config.cookieName, 'morse_access');
  assert.equal(config.sessionHours, 12);
  assert.equal(config.maxMessagesPerSession, 30);
  assert.equal(config.chatModel, 'test-chat');
  assert.equal(config.openaiBaseUrl, 'http://127.0.0.1:8080/v1');
  assert.equal(config.embeddingApiKey, 'embedding-key');
  assert.equal(config.embeddingBaseUrl, 'http://127.0.0.1:18091/v1');
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

test('loadServerConfig fails closed for missing secrets, model IDs, or pricing', () => {
  for (const key of [
    'DATABASE_URL',
    'OPENAI_API_KEY',
    'OPENAI_CHAT_MODEL',
    'OPENAI_EMBEDDING_MODEL',
    'MORSE_INPUT_USD_PER_MILLION',
    'MORSE_OUTPUT_USD_PER_MILLION',
  ]) {
    const env = { ...completeEnv };
    delete env[key as keyof typeof env];
    assert.throws(() => loadServerConfig(env), new RegExp(key));
  }
});
