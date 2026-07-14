import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = new URL('../', import.meta.url);

function readUtf8(relativePath) {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

function assertIncludesAll(source, expected, label) {
  for (const value of expected) {
    assert.ok(source.includes(value), `${label} must include: ${value}`);
  }
}

test('run-state advances exactly one current pointer to S8 local closeout', () => {
  const runState = readUtf8('docs/task-center/run-state.md');

  assert.equal(runState.match(/^## current_pointer$/gm)?.length, 1);
  assertIncludesAll(
    runState,
    [
      '**S8 CUSTOMER SERVICE CONVERSATION LOCAL PASS**',
      '## S8 customer-service closeout evidence(2026-07-14)',
      'Real Provider BLOCKED',
      'docs/task-center/s8-customer-service-conversation.md',
      '## S7 multipage closeout evidence(2026-07-13)',
      '## M3-RAG local closeout evidence(2026-07-13)',
    ],
    'S8 run-state',
  );
  assert.ok(existsSync(new URL('docs/verify/s8/s8-closeout.md', repoRoot)));
});

test('S8 contract contains automation governance and product boundaries', () => {
  const contract = readUtf8('docs/task-center/s8-customer-service-conversation.md');
  const blueprint = readUtf8('docs/portfolio-blueprint.md');

  assertIncludesAll(
    contract,
    [
      'EXECUTION COMPLETE · LOCAL PASS',
      'Profile:`CRITICAL`',
      '## Current Capability And Gap',
      '## Product And Interaction Contract',
      '## Architecture And Data Flow',
      '## Definition Of Done',
      '## Task Center',
      '## Phase Registry',
      '## Stage Package',
      '## Research Lane',
      '## Preauthorization Matrix',
      '## Failure Register',
      '## Progress Ledger',
      '## Minimal LOOP Contract',
      '## Closeout Policy',
      'S8-CS-1 TURN RELIABILITY',
      'S8-CS-5 REAL E2E',
      'content/site-content.json',
      '最多 3 次 GPT smoke',
      '不部署 Milvus/Qdrant',
      'Automation creation | forbidden',
    ],
    'S8 stage contract',
  );
  assert.match(blueprint, /## 12\. S8 智能客服对话可用性闭环\(2026-07-13\)/);
  assert.match(blueprint, /\| \*\*M4 试驾\*\* \|/);
});

test('S8 has a repeatable dual-width customer-service recovery smoke', () => {
  const packageJson = JSON.parse(readUtf8('package.json'));
  const harnessPath = new URL('scripts/s8-chat-smoke.mjs', repoRoot);

  assert.equal(
    packageJson.scripts['visual:s8-chat'],
    'node scripts/s8-chat-smoke.mjs http://127.0.0.1:3011',
  );
  assert.ok(existsSync(harnessPath), 'scripts/s8-chat-smoke.mjs must exist');

  const harness = readUtf8('scripts/s8-chat-smoke.mjs');
  for (const value of [
    '1440',
    '900',
    '390',
    '844',
    'MORSE_SMOKE_INVITE_CODE',
    'MORSE_SMOKE_EXPIRED_INVITE_CODE',
    'expireLatestSessionForInvite',
    'expired session lock',
    '招人的',
    '找人做事的',
    '同行交流',
    '重试本次问题',
    '回答来源',
    '退出会话',
    'consoleErrors',
    'pageErrors',
    'scrollWidth',
    'Storage.clearDataForOrigin',
    'data-stream-state="done"',
    'quota did not decrement exactly once',
    'consoleErrorCount',
    'expectedAccessErrorCount',
    "entry.url",
    "'/api/access'",
    "'/api/chat'",
    'Number.parseInt',
    'quotaPresent',
    'pageErrorCount',
    "sourcePath !== '/'",
    'Promise.race',
  ]) {
    assert.ok(harness.includes(value), `S8 browser smoke must include: ${value}`);
  }
  assert.doesNotMatch(harness, /Network\.clearBrowserCookies/);
  assert.doesNotMatch(harness, /consoleErrors:\s*client\.consoleErrors/);
  assert.doesNotMatch(harness, /pageErrors:\s*client\.pageErrors/);
});
