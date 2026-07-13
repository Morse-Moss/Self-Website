import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { extractPublicKnowledge } from '../lib/server/public-knowledge.ts';

const contentPath = path.resolve('content/s3-content.json');

test('extractPublicKnowledge produces citable documents only from live public content', () => {
  const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
  const documents = extractPublicKnowledge(content);

  assert.ok(documents.length >= 8);
  assert.ok(documents.some((document) => document.id === 'about'));
  assert.ok(documents.some((document) => document.id.startsWith('project-')));
  assert.ok(documents.some((document) => document.id.startsWith('faq-')));

  for (const document of documents) {
    assert.match(document.sourcePath, /^content\/s3-content\.json#/);
    assert.ok(document.title.length > 0);
    assert.ok(document.content.length > 0);
    assert.doesNotMatch(document.sourcePath, /drafts|E:\\/i);
  }
});

test('extractPublicKnowledge does not publish content-gap placeholders as facts', () => {
  const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
  const serialized = JSON.stringify(extractPublicKnowledge(content));

  assert.doesNotMatch(serialized, /待摩斯补齐|待补证据|待人工定稿|待素材/);
});
