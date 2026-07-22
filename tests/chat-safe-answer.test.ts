import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSafeChatAnswer } from '../lib/server/chat-safe-answer.ts';
import type { KnowledgeSource } from '../lib/server/rag.ts';

function source(id: string, content: string): KnowledgeSource {
  return {
    chunkId: `${id}:1`,
    documentId: id,
    title: `项目 ${id}`,
    sourcePath: `content/site-content.json#${id}`,
    href: `/works#${id}`,
    content,
    score: 0.8,
  };
}

test('safe identity answer is deterministic and uses the public identity source', () => {
  const first = buildSafeChatAnswer({ intent: 'identity', sources: [], operatorSafeMode: true });
  const repeated = buildSafeChatAnswer({ intent: 'identity', sources: [], operatorSafeMode: true });

  assert.deepEqual(repeated, first);
  assert.match(first?.text ?? '', /我是数字 Morse/);
  assert.equal(first?.sources[0]?.documentId, 'about');
});

test('safe project answer summarizes at most two approved sources with valid citations', () => {
  const answer = buildSafeChatAnswer({
    intent: 'project',
    operatorSafeMode: true,
    sources: [
      source('one', '第一项能力。后续说明。'),
      source('two', '第二项能力。'),
      source('three', '第三项能力。'),
    ],
  });

  assert.equal(answer?.sources.length, 2);
  assert.match(answer?.text ?? '', /\[来源1\]/);
  assert.match(answer?.text ?? '', /\[来源2\]/);
  assert.doesNotMatch(answer?.text ?? '', /项目 three/);
});

test('safe answer returns null for an unparsed JD or missing grounded evidence', () => {
  assert.equal(buildSafeChatAnswer({ intent: 'jd', sources: [source('one', '证据')], operatorSafeMode: true }), null);
  assert.equal(buildSafeChatAnswer({ intent: 'project', sources: [], operatorSafeMode: true }), null);
});

test('safe answer is unavailable outside explicit operator safe mode', () => {
  assert.equal(buildSafeChatAnswer({
    intent: 'project',
    sources: [source('one', '证据')],
    operatorSafeMode: false,
  }), null);
});
