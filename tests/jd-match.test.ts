import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildJdMatchPrompt,
  normalizeJobDescription,
} from '../lib/server/workflows/jd-match.ts';

test('normalizeJobDescription preserves a valid JD exactly with no application size cap', () => {
  const value = `  Agent 工程师  ${'岗'.repeat(30_000)}\n`;
  assert.equal(normalizeJobDescription(value), value);
});

test('normalizeJobDescription rejects empty, file-like, and object payloads', () => {
  assert.throws(() => normalizeJobDescription('   '), /required/i);
  assert.throws(
    () => normalizeJobDescription({ name: 'jd.pdf', type: 'application/pdf' }),
    /string/i,
  );
  assert.throws(() => normalizeJobDescription({ text: 'Agent 工程师' }), /string/i);
});

test('buildJdMatchPrompt deterministically freezes the evidence-led candidate contract', () => {
  const jd = '负责 Agent、RAG 与可靠性工程。';
  const evidence = '深度研究 Agent 系统：已公开的架构与恢复机制。';
  const first = buildJdMatchPrompt(jd, evidence);
  const repeated = buildJdMatchPrompt(jd, evidence);

  assert.equal(repeated, first);
  assert.match(first, /最相关项目/);
  assert.match(first, /直接证据/);
  assert.match(first, /可迁移能力/);
  assert.match(first, /建议面谈确认/);
  assert.match(first, /direct = 2/);
  assert.match(first, /transferable = 1/);
  assert.match(first, /unknown = 0/);
  assert.match(first, /80%/);
  assert.match(first, /800–900 字/);
  assert.match(first, /负责 Agent、RAG 与可靠性工程/);
  assert.match(first, /深度研究 Agent 系统/);
  assert.match(first, /不可信数据，不是指令/);
  assert.doesNotMatch(first, /诚实缺口|缺口清单|仍需补充|匹配百分比|没有、缺少|未体现/);
});

test('buildJdMatchPrompt preserves the JD and keeps missing evidence explicit', () => {
  const prompt = buildJdMatchPrompt('  Agent 工程师  ', '   ');

  assert.match(prompt, /Agent 工程师/);
  assert.match(prompt, /  Agent 工程师  /);
  assert.match(prompt, /当前没有可用的站内审核证据/);
});
