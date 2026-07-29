import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assessCapability,
  assessCapabilities,
  compileCapabilityLedger,
} from '../lib/server/capability-evidence.ts';
import type { ChatEvidenceCatalogV2 } from '../lib/contracts/chat-evidence-catalog.ts';
import { chatEvidenceCatalog, siteContent } from '../lib/site-content.ts';

test('Kubernetes is not promoted from Docker evidence', () => {
  const ledger = compileCapabilityLedger(siteContent, chatEvidenceCatalog);
  const result = assessCapability('你有 K8s 生产经验吗？', ledger);

  assert.equal(result.capabilityId, 'kubernetes');
  assert.equal(result.evidenceClass, 'transferable');
  assert.deepEqual(result.direct, []);
  assert.ok(result.transferable.some((item) => item.projectSlug === 'digital-morse'));
  assert.match(result.boundaryText ?? '', /不能据此确认 Kubernetes 生产实践/);
});

test('Docker Compose remains direct and points to public projects', () => {
  const result = assessCapability(
    '你用过 Docker Compose 吗？',
    compileCapabilityLedger(siteContent, chatEvidenceCatalog),
  );

  assert.equal(result.capabilityId, 'docker-compose');
  assert.equal(result.evidenceClass, 'direct');
  assert.ok(result.direct.some((item) => item.projectSlug === 'digital-morse'));
  assert.deepEqual(result.transferable, []);
  assert.equal(result.boundaryText, null);
});

test('multi-agent is direct and points to the public deep-research project', () => {
  const result = assessCapability(
    '你不是有做过多 Agent 的系统吗？',
    compileCapabilityLedger(siteContent, chatEvidenceCatalog),
  );

  assert.equal(result.capabilityId, 'multi-agent');
  assert.equal(result.evidenceClass, 'direct');
  assert.ok(result.direct.some((item) => item.projectSlug === 'deep-research'));
  assert.deepEqual(result.transferable, []);
});

test('sanitized resume facts provide direct evidence for Claude Code and Codex without promoting Cursor', () => {
  const results = assessCapabilities(
    '你使用过 Cursor、Claude Code 和 Codex 吗？',
    compileCapabilityLedger(siteContent, chatEvidenceCatalog),
  );

  assert.equal(results.find((result) => result.capabilityId === 'claude-code')?.evidenceClass, 'direct');
  assert.equal(results.find((result) => result.capabilityId === 'codex')?.evidenceClass, 'direct');
  assert.equal(results.find((result) => result.capabilityId === 'cursor')?.evidenceClass, 'none');
  assert.match(
    results.find((result) => result.capabilityId === 'claude-code')?.direct[0]?.sourceText ?? '',
    /Claude Code.*Codex/,
  );
});

test('AI programming collaboration aliases resolve to the same direct resume evidence', () => {
  const ledger = compileCapabilityLedger(siteContent, chatEvidenceCatalog);
  for (const alias of ['Vibe Coding', 'AI 编程协作', 'AI 辅助编程']) {
    const results = assessCapabilities(`岗位要求：${alias} 独立交付网站。`, ledger);
    assert.deepEqual(results.map((result) => result.capabilityId), ['ai-programming-collaboration']);
    assert.match(results[0]?.direct[0]?.sourceText ?? '', /使用 Claude Code、Codex、WorkBuddy 完成开发/u);
  }
});

test('CC shorthand resolves to the same direct Claude Code resume evidence', () => {
  const results = assessCapabilities(
    '你用过 CC 和 codex 吗？',
    compileCapabilityLedger(siteContent, chatEvidenceCatalog),
  );

  assert.deepEqual(
    results.map((result) => [result.capabilityId, result.evidenceClass]),
    [['claude-code', 'direct'], ['codex', 'direct']],
  );
});

test('unknown capability has no personal evidence', () => {
  const result = assessCapability(
    '你有 Nomad 生产经验吗？',
    compileCapabilityLedger(siteContent, chatEvidenceCatalog),
  );

  assert.equal(result.capabilityId, null);
  assert.equal(result.evidenceClass, 'none');
  assert.deepEqual(result.direct, []);
  assert.deepEqual(result.transferable, []);
});

test('catalog compatibility compiler rejects unknown evidence references', () => {
  const invalidCatalog: ChatEvidenceCatalogV2 = {
    ...chatEvidenceCatalog,
    capabilities: chatEvidenceCatalog.capabilities.map((entry, index) => index === 0
      ? {
          ...entry,
          evidenceRefs: [
            ...entry.evidenceRefs,
            { kind: 'resume_fact', resumeFactId: 'ghost-runtime', level: 'direct' },
          ],
        }
      : entry),
  };

  assert.throws(
    () => compileCapabilityLedger(siteContent, invalidCatalog),
    /CHAT_EVIDENCE_CATALOG_INVALID/,
  );
});

test('capability matching is NFKC, case-insensitive, and punctuation tolerant', () => {
  const ledger = compileCapabilityLedger(siteContent, chatEvidenceCatalog);

  assert.equal(assessCapability('你用过 ｄｏｃｋｅｒ－ｃｏｍｐｏｓｅ 吗', ledger).capabilityId, 'docker-compose');
  assert.equal(assessCapability('POSTGRES？', ledger).capabilityId, 'postgresql');
});

test('short capability aliases do not match across English word boundaries', () => {
  const results = assessCapabilities(
    '负责 server agent 的部署与维护。',
    compileCapabilityLedger(siteContent, chatEvidenceCatalog),
  );

  assert.doesNotMatch(
    results.map((result) => result.capabilityId).join(','),
    /(?:^|,)rag(?:,|$)/u,
  );
});

test('a JD resolves every explicitly named capability without inventing unknown skills', () => {
  const results = assessCapabilities(
    '设计 RAG，熟悉 PostgreSQL、Docker Compose；Kubernetes 生产经验优先。',
    compileCapabilityLedger(siteContent, chatEvidenceCatalog),
  );

  assert.deepEqual(
    new Set(results.map((result) => result.capabilityId)),
    new Set(['rag', 'postgresql', 'docker', 'docker-compose', 'kubernetes']),
  );
  assert.equal(
    results.find((result) => result.capabilityId === 'kubernetes')?.evidenceClass,
    'transferable',
  );
});
