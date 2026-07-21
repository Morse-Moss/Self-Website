import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadServerConfig } from '../lib/server/config.ts';
import { FailoverAiProvider } from '../lib/server/failover-ai-provider.ts';
import { createProvider } from '../lib/server/provider.ts';

function config(fallbacks = false) {
  return loadServerConfig({
    DATABASE_URL: 'postgresql://revolution@127.0.0.1:55432/revolution',
    OPENAI_API_KEY: 'synthetic-primary-key',
    OPENAI_CHAT_MODEL: 'synthetic-chat',
    OPENAI_CHAT_PROTOCOL: 'responses',
    OPENAI_EMBEDDING_MODEL: 'synthetic-embedding',
    ...(fallbacks ? {
      OPENAI_FALLBACK_1_API_KEY: 'synthetic-fallback-one',
      OPENAI_FALLBACK_1_BASE_URL: 'https://fallback-one.invalid/v1',
      OPENAI_FALLBACK_2_API_KEY: 'synthetic-fallback-two',
      OPENAI_FALLBACK_2_BASE_URL: 'https://fallback-two.invalid/v1',
    } : {}),
  });
}

test('provider factory always wraps stable aliases in the coordinator', () => {
  const primaryOnly = createProvider(config());
  const withFallbacks = createProvider(config(true));

  assert.ok(primaryOnly instanceof FailoverAiProvider);
  assert.ok(withFallbacks instanceof FailoverAiProvider);
  assert.deepEqual(
    (primaryOnly as unknown as { nodes: Array<{ alias: string }> }).nodes.map(({ alias }) => alias),
    ['primary'],
  );
  assert.deepEqual(
    (withFallbacks as unknown as { nodes: Array<{ alias: string }> }).nodes.map(({ alias }) => alias),
    ['primary', 'fallback-1', 'fallback-2'],
  );
});
