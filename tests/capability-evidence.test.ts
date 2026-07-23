import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assessCapability,
  assessCapabilities,
  compileCapabilityLedger,
  type CapabilityPolicy,
} from '../lib/server/capability-evidence.ts';
import { chatCapabilityPolicy, siteContent } from '../lib/site-content.ts';

test('Kubernetes is not promoted from Docker evidence', () => {
  const ledger = compileCapabilityLedger(siteContent, chatCapabilityPolicy);
  const result = assessCapability('你有 K8s 生产经验吗？', ledger);

  assert.equal(result.capabilityId, 'kubernetes');
  assert.equal(result.evidenceClass, 'transferable');
  assert.deepEqual(result.direct, []);
  assert.ok(result.transferable.some((item) => item.capabilityId === 'docker-compose'));
  assert.match(result.boundaryText ?? '', /不能据此确认 Kubernetes 生产实践/);
});

test('Docker Compose remains direct and points to public projects', () => {
  const result = assessCapability(
    '你用过 Docker Compose 吗？',
    compileCapabilityLedger(siteContent, chatCapabilityPolicy),
  );

  assert.equal(result.capabilityId, 'docker-compose');
  assert.equal(result.evidenceClass, 'direct');
  assert.ok(result.direct.some((item) => item.projectSlug === 'digital-morse'));
  assert.deepEqual(result.transferable, []);
  assert.equal(result.boundaryText, null);
});

test('unknown capability has no personal evidence', () => {
  const result = assessCapability(
    '你有 Nomad 生产经验吗？',
    compileCapabilityLedger(siteContent, chatCapabilityPolicy),
  );

  assert.equal(result.capabilityId, null);
  assert.equal(result.evidenceClass, 'none');
  assert.deepEqual(result.direct, []);
  assert.deepEqual(result.transferable, []);
});

test('policy rejects transfer sources absent from public site content', () => {
  const invalidPolicy: CapabilityPolicy = {
    ...chatCapabilityPolicy,
    canonical: [
      ...chatCapabilityPolicy.canonical,
      { id: 'ghost-runtime', label: 'Ghost Runtime', aliases: ['Ghost Runtime'] },
    ],
    transferRules: [{
      target: 'kubernetes',
      from: ['ghost-runtime'],
      allowedWording: 'invalid fixture',
    }],
  };

  assert.throws(
    () => compileCapabilityLedger(siteContent, invalidPolicy),
    /CAPABILITY_POLICY_INVALID/,
  );
});

test('capability matching is NFKC, case-insensitive, and punctuation tolerant', () => {
  const ledger = compileCapabilityLedger(siteContent, chatCapabilityPolicy);

  assert.equal(assessCapability('你用过 ｄｏｃｋｅｒ－ｃｏｍｐｏｓｅ 吗', ledger).capabilityId, 'docker-compose');
  assert.equal(assessCapability('POSTGRES？', ledger).capabilityId, 'postgresql');
});

test('short capability aliases do not match across English word boundaries', () => {
  const results = assessCapabilities(
    '负责 server agent 的部署与维护。',
    compileCapabilityLedger(siteContent, chatCapabilityPolicy),
  );

  assert.doesNotMatch(
    results.map((result) => result.capabilityId).join(','),
    /(?:^|,)rag(?:,|$)/u,
  );
});

test('a JD resolves every explicitly named capability without inventing unknown skills', () => {
  const results = assessCapabilities(
    '设计 RAG，熟悉 PostgreSQL、Docker Compose；Kubernetes 生产经验优先。',
    compileCapabilityLedger(siteContent, chatCapabilityPolicy),
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
