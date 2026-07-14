import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const accessRoutePath = path.resolve('app/api/access/route.ts');
const chatRoutePath = path.resolve('app/api/chat/route.ts');
const healthRoutePath = path.resolve('app/api/health/route.ts');
const providerFactoryPath = path.resolve('lib/server/provider.ts');

test('access API uses an HttpOnly short-lived cookie and supports logout', () => {
  const source = fs.readFileSync(accessRoutePath, 'utf8');

  assert.match(source, /httpOnly:\s*true/);
  assert.match(source, /sameSite:\s*'lax'/);
  assert.match(source, /secure:\s*process\.env\.NODE_ENV === 'production'/);
  assert.match(source, /export async function DELETE/);
  assert.match(source, /remainingMessages:\s*config\.maxMessagesPerSession/);
  assert.doesNotMatch(source, /OPENAI_API_KEY/);
});

test('chat API authenticates server-side and emits only the public SSE contract', () => {
  const source = fs.readFileSync(chatRoutePath, 'utf8');

  assert.match(source, /authenticateSession/);
  assert.match(source, /normalizeChatRequest/);
  assert.match(source, /text\/event-stream/);
  assert.match(source, /CHAT_NOT_CONFIGURED/);
  assert.match(source, /INVALID_CHAT_REQUEST/);
  for (const event of ['meta', 'delta', 'done', 'error']) {
    assert.match(source, new RegExp(`encodeSse\\('${event}'`));
  }
  assert.doesNotMatch(source, /apiKey.*JSON|stringify.*apiKey/i);
});

test('health API reports database and knowledge readiness without provider secrets', () => {
  const source = fs.readFileSync(healthRoutePath, 'utf8');

  assert.match(source, /knowledge_chunks/);
  assert.match(source, /configured/);
  assert.match(source, /OPENAI_EMBEDDING_MODEL/);
  assert.match(source, /MORSE_INPUT_USD_PER_MILLION/);
  assert.doesNotMatch(source, /OPENAI_API_KEY.*value|apiKey:/i);
});

test('every S8 OpenAI client disables hidden SDK retries', () => {
  const sources = [
    [providerFactoryPath, 2],
    [path.resolve('scripts/ingest-knowledge.mjs'), 1],
    [path.resolve('scripts/rag-eval.mjs'), 1],
  ] as const;

  for (const [sourcePath, expected] of sources) {
    const source = fs.readFileSync(sourcePath, 'utf8');
    assert.equal((source.match(/maxRetries:\s*0/g) ?? []).length, expected, sourcePath);
  }
});
