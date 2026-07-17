import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const accessRoutePath = path.resolve('app/api/access/route.ts');
const chatRoutePath = path.resolve('app/api/chat/route.ts');
const historyRoutePath = path.resolve('app/api/chat/history/route.ts');
const healthRoutePath = path.resolve('app/api/health/route.ts');
const chatRouteStreamPath = path.resolve('lib/server/chat-route-stream.ts');
const chatHistoryRoutePath = path.resolve('lib/server/chat-history-route.ts');
const providerFactoryPath = path.resolve('lib/server/provider.ts');
const allowedRouteExports = new Set([
  'runtime',
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

test('access API uses an HttpOnly short-lived cookie and supports logout', () => {
  const source = fs.readFileSync(accessRoutePath, 'utf8');

  assert.match(source, /loadInviteAbuseConfig/);
  assert.match(source, /redeemInviteProtected/);
  assert.match(source, /trustedInviteSource/);
  assert.match(source, /trustedProxyHops/);
  assert.doesNotMatch(source, /user-agent/);
  assert.match(source, /httpOnly:\s*true/);
  assert.match(source, /sameSite:\s*'lax'/);
  assert.match(source, /secure:\s*process\.env\.NODE_ENV === 'production'/);
  assert.match(source, /export async function DELETE/);
  assert.match(source, /remainingMessages:\s*config\.maxMessagesPerSession/);
  assert.doesNotMatch(source, /OPENAI_API_KEY/);
  assert.doesNotMatch(source, /access_attempts|alert_outbox/);
});

test('chat API authenticates server-side and emits only the public SSE contract', () => {
  const source = [
    fs.readFileSync(chatRoutePath, 'utf8'),
    fs.readFileSync(chatRouteStreamPath, 'utf8'),
  ].join('\n');

  assert.match(source, /authenticateSession/);
  assert.match(source, /normalizeChatRequest/);
  assert.match(source, /text\/event-stream/);
  assert.match(source, /CHAT_NOT_CONFIGURED/);
  assert.match(source, /CHAT_DISABLED/);
  assert.match(source, /INVALID_CHAT_REQUEST/);
  assert.match(source, /createChatRouteStream/);
  assert.match(source, /createSseStream/);
  assert.match(source, /emit\(event\.type, event\)/);
  assert.match(source, /emit\('error', \{ code: publicErrorCode\(error\) \}\)/);
  assert.match(source, /requestSignal:\s*request\.signal/);
  assert.match(source, /signal,\s*\}\),/);
  assert.doesNotMatch(source, /MORSE_MONTHLY_BUDGET_USD|monthlyBudgetUsd/);
  assert.doesNotMatch(source, /apiKey.*JSON|stringify.*apiKey/i);
});

test('chat history API uses access-only config and cannot restore interaction logs', () => {
  const source = [
    fs.readFileSync(historyRoutePath, 'utf8'),
    fs.readFileSync(chatHistoryRoutePath, 'utf8'),
  ].join('\n');

  assert.match(source, /loadAccessConfig/);
  assert.match(source, /authenticateSession/);
  assert.match(source, /loadConversationHistory/);
  assert.match(source, /ACCESS_REQUIRED/);
  assert.doesNotMatch(source, /loadServerConfig|createProvider|OPENAI_|interaction_turns/);
});

test('health API reports database and knowledge readiness without provider secrets', () => {
  const source = fs.readFileSync(healthRoutePath, 'utf8');

  assert.match(source, /knowledge_chunks/);
  assert.match(source, /configured/);
  assert.match(source, /OPENAI_EMBEDDING_MODEL/);
  assert.match(source, /MORSE_INPUT_USD_PER_MILLION/);
  assert.doesNotMatch(source, /OPENAI_API_KEY.*value|apiKey:/i);
});

test('chat route modules export only Next.js route entrypoints', () => {
  for (const routePath of [chatRoutePath, historyRoutePath]) {
    const source = fs.readFileSync(routePath, 'utf8');
    const exportedNames = [...source.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|interface|type|class)\s+([A-Za-z0-9_]+)/gmu,
    )].map((match) => match[1]);

    assert.deepEqual(
      exportedNames.filter((name) => !allowedRouteExports.has(name)),
      [],
      routePath,
    );
  }
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
