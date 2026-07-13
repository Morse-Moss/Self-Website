import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('RAG gold set covers every approved public document', () => {
  const filePath = path.join(process.cwd(), 'content', 'rag-eval.json');
  const cases = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Array<{
    query: string;
    expectedDocumentId: string;
  }>;

  assert.equal(cases.length, 9);
  assert.deepEqual(
    new Set(cases.map((item) => item.expectedDocumentId)),
    new Set([
      'about',
      'project-content-agent',
      'project-auto-operations',
      'project-deep-research',
      'project-digital-morse',
      'faq-1',
      'faq-2',
      'faq-3',
      'faq-4',
    ]),
  );
  assert.ok(cases.every((item) => item.query.trim().length > 0));
  assert.equal(
    cases.find((item) => item.query === '数字摩斯为什么还没有访问系统按钮?')
      ?.expectedDocumentId,
    'project-digital-morse',
  );
  assert.ok(cases.some((item) => item.expectedDocumentId === 'project-auto-operations'));
});

test('RAG evaluator reports top-1/top-3 metrics and fails missed top-3 cases', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'rag-eval.mjs'),
    'utf8',
  );

  assert.match(source, /OPENAI_EMBEDDING_BASE_URL/);
  assert.match(source, /top1/i);
  assert.match(source, /top3/i);
  assert.match(source, /loopbackHosts\.has\(embeddingUrl\.hostname\)/);
  assert.match(source, /configured semantic embeddings/);
  assert.match(source, /process\.exitCode\s*=\s*1/);
});
