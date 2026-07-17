import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractCitationIndexes,
  parseChatInline,
  parseChatMessageBlocks,
} from '../lib/client/chat-message-format.ts';

test('assistant formatting parses section labels, paragraphs, and Markdown lists', () => {
  assert.deepEqual(parseChatMessageBlocks([
    '**事实依据：**',
    '',
    '- 第一条 **重点**。[来源2]',
    '- 第二条。',
    '',
    '最后给出下一步。',
  ].join('\n')), [
    { kind: 'section', content: '事实依据：' },
    { kind: 'unordered-list', items: ['第一条 **重点**。[来源2]', '第二条。'] },
    { kind: 'paragraph', content: '最后给出下一步。' },
  ]);
});

test('assistant formatting renders Markdown dividers as structural blocks', () => {
  assert.deepEqual(parseChatMessageBlocks('第一部分\n\n---\n\n第二部分'), [
    { kind: 'paragraph', content: '第一部分' },
    { kind: 'divider' },
    { kind: 'paragraph', content: '第二部分' },
  ]);
});

test('assistant formatting turns bold, inline code, and citations into structured tokens', () => {
  assert.deepEqual(parseChatInline('这是 **重点**，使用 `pgvector`。[来源2][来源1]'), [
    { kind: 'text', value: '这是 ' },
    { kind: 'strong', value: '重点' },
    { kind: 'text', value: '，使用 ' },
    { kind: 'code', value: 'pgvector' },
    { kind: 'text', value: '。' },
    { kind: 'citation', index: 2 },
    { kind: 'citation', index: 1 },
  ]);
});

test('citation extraction keeps only valid referenced source indexes', () => {
  assert.deepEqual(
    extractCitationIndexes('先看[来源2]，再看[来源1]，重复[来源2]，越界[来源9]。', 3),
    [2, 1],
  );
});
