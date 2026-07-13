import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OpenAIProvider } from '../lib/server/openai-provider.ts';

async function* fakeResponseStream() {
  yield { type: 'response.output_text.delta', delta: '你好' };
  yield { type: 'response.output_text.delta', delta: ',我是数字摩斯。' };
  yield {
    type: 'response.completed',
    response: { usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } },
  };
}

test('OpenAIProvider routes embeddings and Responses through separate clients', async () => {
  const calls: Array<{ kind: string; body: unknown }> = [];
  const embeddingClient = {
    embeddings: {
      create: async (body: unknown) => {
        calls.push({ kind: 'embedding', body });
        return { data: [{ embedding: [0.1, 0.2] }] };
      },
    },
  };
  const responseClient = {
    responses: {
      create: async (body: unknown) => {
        calls.push({ kind: 'response', body });
        return fakeResponseStream();
      },
    },
  };
  const provider = new OpenAIProvider(responseClient, embeddingClient, {
    chatModel: 'test-chat-model',
    embeddingModel: 'test-embedding-model',
    embeddingDimensions: 2,
    maxOutputTokens: 400,
  });

  assert.deepEqual(await provider.embed(['问题']), [[0.1, 0.2]]);

  const events = [];
  for await (const event of provider.streamAnswer({
    instructions: '只使用证据',
    messages: [{ role: 'user', content: '你好' }],
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: 'delta', text: '你好' },
    { type: 'delta', text: ',我是数字摩斯。' },
    { type: 'done', usage: { inputTokens: 120, outputTokens: 30 } },
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    kind: 'embedding',
    body: {
      model: 'test-embedding-model',
      input: ['问题'],
      dimensions: 2,
      encoding_format: 'float',
    },
  });
  assert.equal((calls[1].body as { stream: boolean }).stream, true);
});
