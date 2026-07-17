import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  chunkKnowledge,
  knowledgeChecksum,
  knowledgeChunkOptions,
  stableChunkId,
} from '../lib/server/knowledge.ts';

test('chunkKnowledge keeps headings and creates bounded overlapping chunks', () => {
  const text = `# 数字摩斯\n\n${'这是公开知识。'.repeat(80)}\n\n## 项目证据\n\n${'回答必须引用来源。'.repeat(60)}`;
  const chunks = chunkKnowledge(text, { maxChars: 320, overlapChars: 40 });

  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 320));
  assert.match(chunks[0], /数字摩斯/);
  assert.ok(chunks.every((chunk) => chunk.trim().length > 0));
});

test('stableChunkId changes with content but not between identical ingestion runs', () => {
  const first = stableChunkId('public-profile', 0, '公开内容');
  const repeated = stableChunkId('public-profile', 0, '公开内容');
  const changed = stableChunkId('public-profile', 0, '已更新内容');

  assert.equal(first, repeated);
  assert.notEqual(first, changed);
  assert.match(first, /^public-profile:[a-f0-9]{16}$/);
});

test('knowledge chunk policy isolates the short profile principles without fragmenting projects', () => {
  assert.deepEqual(knowledgeChunkOptions('about'), { maxChars: 100, overlapChars: 0 });
  assert.deepEqual(knowledgeChunkOptions('project-deep-research'), {
    maxChars: 900,
    overlapChars: 120,
  });
});

test('knowledgeChecksum forces re-indexing when the model, chunk policy, or source changes', () => {
  const base = {
    title: '深度研究系统',
    sourcePath: 'content/s3-content.json#gallery.deep-research',
    href: '/works/deep-research',
    content: '证据链是出厂闸门。',
  };

  const chunkOptions = { maxChars: 900, overlapChars: 120 };
  const first = knowledgeChecksum(base, 'openai:model-a:1536', chunkOptions);
  assert.equal(first, knowledgeChecksum(base, 'openai:model-a:1536', chunkOptions));
  assert.notEqual(first, knowledgeChecksum(base, 'openai:model-b:1536', chunkOptions));
  assert.notEqual(first, knowledgeChecksum(base, 'openai:model-a:1536', { maxChars: 100, overlapChars: 0 }));
  assert.notEqual(first, knowledgeChecksum({ ...base, sourcePath: `${base.sourcePath}.v2` }, 'openai:model-a:1536', chunkOptions));
  assert.notEqual(first, knowledgeChecksum({ ...base, href: '/works' }, 'openai:model-a:1536', chunkOptions));
});
