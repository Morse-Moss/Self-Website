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
      'project-ai-leadgen',
      'project-ai-leadgen-overview',
      'project-ai-leadgen-acquisition',
      'project-ai-leadgen-scoring',
      'project-ai-leadgen-collaboration',
      'project-ai-leadgen-outreach',
      'project-ai-leadgen-role',
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
  const expectedByQuery = new Map(
    cases.map((item) => [item.query, item.expectedDocumentId]),
  );
  assert.equal(
    expectedByQuery.get('自动运营 Agent 系统如何保持发布受控？'),
    'project-auto-operations-workflow',
  );
  assert.equal(
    expectedByQuery.get('自动运营 Agent 系统整体具备哪些数据发现、内容资产、AI 生产、任务编排和受控发布能力？'),
    'project-auto-operations',
  );
  assert.ok(
    cases.every((item) => !item.query.includes('草稿工坊')),
    'RAG gold queries must use the current public auto-operations vocabulary',
  );
  assert.equal(
    cases.find((item) => item.query === '数字摩斯解决什么问题，招聘方、潜在客户和同行能用它做什么？')
      ?.expectedDocumentId,
    'project-digital-morse-overview',
  );
  assert.ok(cases.some((item) => item.expectedDocumentId === 'project-auto-operations'));
  assert.equal(
    expectedByQuery.get('AI 外贸获客系统如何从获取线索推进到邮件触达和回信跟进？'),
    'project-ai-leadgen-overview',
  );
  assert.equal(
    expectedByQuery.get('AI 外贸获客系统会自动写开发信并自动回复客户吗？'),
    'project-ai-leadgen-outreach',
  );
  assert.equal(
    expectedByQuery.get('AI 外贸获客系统已经接入 Apify、Apollo、WhatsApp 或 Google Maps 自动采集了吗？'),
    'project-ai-leadgen-acquisition',
  );
  assert.equal(
    expectedByQuery.get('AI 外贸获客系统已经生产部署并取得规模化获客成果了吗？'),
    'project-ai-leadgen-role',
  );
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
    'project-ai-leadgen-overview',
    'project-ai-leadgen-acquisition',
    'project-ai-leadgen-scoring',
    'project-ai-leadgen-collaboration',
    'project-ai-leadgen-outreach',
    'project-ai-leadgen-role',
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
  const productionBoundary = data.cases.find(
    (item) => item.id === 'ai-leadgen-production-boundary',
  ) as (typeof data.cases)[number] & {
    sourceScenario?: string;
    requiredAnswerFragments?: string[];
    forbiddenAnswerFragments?: string[];
  };
  assert.ok(productionBoundary);
  assert.equal(productionBoundary.sourceScenario, 'ai-leadgen');
  assert.deepEqual(productionBoundary.requiredAnswerFragments, [
    '当前为本地 MVP',
    '尚未生产部署',
    '尚未取得规模化获客成果',
  ]);
  assert.deepEqual(productionBoundary.forbiddenAnswerFragments, [
    '已经生产部署',
    '已取得规模化获客成果',
    '实现规模化获客',
  ]);
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
