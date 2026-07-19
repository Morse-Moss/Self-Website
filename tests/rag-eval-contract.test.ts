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
      'project-content-agent-overview',
      'project-content-agent-experience',
      'project-content-agent-models',
      'project-content-agent-engineering',
      'project-content-agent-role',
      'project-content-agent-roadmap',
      'project-auto-operations',
      'project-auto-operations-overview',
      'project-auto-operations-workflow',
      'project-auto-operations-architecture',
      'project-auto-operations-engineering',
      'project-auto-operations-role',
      'project-auto-operations-roadmap',
      'project-deep-research',
      'project-digital-morse',
      'project-digital-morse-overview',
      'project-digital-morse-workflows',
      'project-digital-morse-knowledge',
      'project-digital-morse-reliability',
      'project-digital-morse-role',
      'project-digital-morse-roadmap',
      'faq-1',
      'faq-2',
      'faq-3',
      'faq-4',
    ]),
  );
  assert.ok(cases.every((item) => item.query.trim().length > 0));
  assert.equal(
    cases.find((item) => item.query === '数字摩斯解决什么问题，招聘方、潜在客户和同行能用它做什么？')
      ?.expectedDocumentId,
    'project-digital-morse-overview',
  );
  assert.ok(cases.some((item) => item.expectedDocumentId === 'project-auto-operations'));
  for (const expectedDocumentId of [
    'project-content-agent-overview',
    'project-content-agent-experience',
    'project-content-agent-models',
    'project-content-agent-engineering',
    'project-content-agent-role',
    'project-content-agent-roadmap',
    'project-auto-operations-overview',
    'project-auto-operations-workflow',
    'project-auto-operations-architecture',
    'project-auto-operations-engineering',
    'project-auto-operations-role',
    'project-auto-operations-roadmap',
    'project-digital-morse-overview',
    'project-digital-morse-workflows',
    'project-digital-morse-knowledge',
    'project-digital-morse-reliability',
    'project-digital-morse-role',
    'project-digital-morse-roadmap',
  ]) {
    assert.ok(cases.some((item) => item.expectedDocumentId === expectedDocumentId));
  }
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

test('RAG evaluator freezes negative calibration cases and enforces the local sufficiency threshold', () => {
  const negativePath = path.join(process.cwd(), 'content', 'rag-negative-eval.json');
  assert.ok(fs.existsSync(negativePath), 'negative RAG calibration set must exist');
  const cases = JSON.parse(fs.readFileSync(negativePath, 'utf8')) as Array<{ query: string }>;
  assert.equal(cases.length, 10);
  assert.ok(cases.every((item) => item.query.trim().length > 0));

  const source = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'rag-eval.mjs'),
    'utf8',
  );
  assert.match(source, /rag-negative-eval\.json/);
  assert.match(source, /LOCAL_EVIDENCE_MIN_SCORE/);
  assert.match(source, /minPositiveTopScore/);
  assert.match(source, /maxNegativeTopScore/);
  assert.match(source, /positiveThresholdPass/);
  assert.match(source, /negativeThresholdPass/);
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
      documentId?: string;
      expectedHref?: string;
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
  assert.deepEqual(
    data.cases
      .filter((item) => item.expectedBehavior === 'navigate')
      .map(({ documentId, expectedHref }) => ({ documentId, expectedHref })),
    [
      {
        documentId: 'project-deep-research',
        expectedHref: '/works#deep-research',
      },
      { documentId: 'faq-1', expectedHref: '/' },
    ],
  );

  const runner = fs.readFileSync(runnerPath, 'utf8');
  assert.match(runner, /deterministic adversarial prompt\/provider/);
  assert.match(runner, /normalizeChatRequest/);
  assert.match(runner, /AdversarialDeterministicProvider/);
  assert.match(runner, /buildSystemInstructions/);
  assert.match(runner, /publicKnowledgeHref/);
  assert.match(runner, /projectSlugs\.includes\(projectSlug\)/);
  assert.match(runner, /href === item\.expectedHref/);
  assert.match(runner, /raw prompts and answers are intentionally omitted/);
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['chat:eval'], 'node scripts/chat-eval.mjs');
});

test('chat evaluation source fixtures use exact S9 project Hash hrefs', () => {
  const runner = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'chat-eval.mjs'),
    'utf8',
  );

  assert.match(runner, /href:\s*['"]\/works#deep-research['"]/);
  assert.match(runner, /href:\s*['"]\/works#digital-morse['"]/);
  assert.doesNotMatch(runner, /href:\s*['"]\/works\//);
});
