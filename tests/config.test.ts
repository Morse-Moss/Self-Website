import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadServerConfig } from '../lib/server/config.ts';

const completeEnv = {
  DATABASE_URL: 'postgresql://localhost/revolution',
  OPENAI_API_KEY: 'test-key',
  OPENAI_CHAT_MODEL: 'test-chat',
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
  assert.deepEqual(config.tokenRates, {
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
  });
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
