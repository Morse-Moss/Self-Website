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

  assert.ok(cases.length >= 20, 'S8 retrieval evaluation must contain at least 20 cases');
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

test('S8 chat evaluation covers answer safety, runtime errors, and source navigation', () => {
  const dataPath = path.join(process.cwd(), 'content', 'chat-eval.json');
  const runnerPath = path.join(process.cwd(), 'scripts', 'chat-eval.mjs');
  assert.ok(fs.existsSync(dataPath), 'content/chat-eval.json must exist');
  assert.ok(fs.existsSync(runnerPath), 'scripts/chat-eval.mjs must exist');

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as {
    cases: Array<{
      id: string;
      category: string;
      query: string;
      expectedBehavior: string;
    }>;
  };
  assert.ok(data.cases.length >= 20, 'chat evaluation must contain at least 20 cases');
  assert.ok(data.cases.every((item) => item.query.trim() && item.expectedBehavior.trim()));
  const categories = new Set(data.cases.map((item) => item.category));
  for (const category of [
    'recruiter',
    'collaboration',
    'peer',
    'cross-project',
    'insufficient-evidence',
    'prompt-injection',
    'off-topic',
    'access-error',
    'budget-error',
    'provider-error',
    'retrieval-error',
    'source-navigation',
  ]) {
    assert.ok(categories.has(category), `chat evaluation category is missing: ${category}`);
  }

  const runner = fs.readFileSync(runnerPath, 'utf8');
  assert.match(runner, /deterministic adversarial prompt\/provider/);
  assert.match(runner, /normalizeChatRequest/);
  assert.match(runner, /AdversarialDeterministicProvider/);
  assert.match(runner, /buildSystemInstructions/);
  assert.match(runner, /publicKnowledgeHref/);
  assert.match(runner, /raw prompts and answers are intentionally omitted/);
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['chat:eval'], 'node scripts/chat-eval.mjs');
});
