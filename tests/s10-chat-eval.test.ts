import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

interface EvalCase {
  id: string;
  category: string;
  query?: string;
  expectedBehavior: string;
  turns?: Array<{ query: string }>;
  feedbackRegression?: string;
  workflow?: 'chat' | 'jd_match' | 'diagnosis';
  intent?: 'general' | 'recruiter' | 'collaboration' | 'peer';
  expectedRoute?: string;
  expectedEvidence?: string;
  expectedAnswerFragments?: string[];
  expectedSourceSlugs?: string[];
  expectedDependencies?: {
    chat: number;
    embedding: number;
    rag: number;
    search: number;
  };
}

interface ReviewCase {
  id: string;
  category: string;
  prompt: string;
  route: string;
  evidence: string;
  expectedDependencies: {
    chat: number;
    embedding: number;
    rag: number;
    search: number;
  };
  zeroTolerance?: boolean;
  expectedSignals: string[];
}

const dataPath = path.join(process.cwd(), 'content', 'chat-eval.json');
const reviewCasesPath = path.join(process.cwd(), 'content', 'chat-review-cases.json');
const runnerPath = path.join(process.cwd(), 'scripts', 'chat-eval.mjs');
const EXPECTED_DATASET_VERSION = 9;
const EXPECTED_CASE_COUNT = 112;

function hasValidEvalInput(item: EvalCase): boolean {
  if (item.expectedBehavior === 'multi-turn-route') {
    return Array.isArray(item.turns)
      && item.turns.length > 0
      && item.turns.every((turn) => turn.query.trim().length > 0);
  }
  return typeof item.query === 'string' && item.query.trim().length > 0;
}

function readDataset(): { version: number; cases: EvalCase[] } {
  return JSON.parse(fs.readFileSync(dataPath, 'utf8')) as {
    version: number;
    cases: EvalCase[];
  };
}

test(`S10 deterministic evaluation freezes ${EXPECTED_CASE_COUNT} cases around the current routing contract`, () => {
  const dataset = readDataset();
  assert.equal(dataset.version, EXPECTED_DATASET_VERSION);
  assert.equal(dataset.cases.length, EXPECTED_CASE_COUNT);
  assert.equal(new Set(dataset.cases.map((item) => item.id)).size, EXPECTED_CASE_COUNT);
  assert.ok(dataset.cases.every((item) => hasValidEvalInput(item) && item.expectedBehavior.trim()));
  assert.equal(
    dataset.cases.filter((item) => item.expectedBehavior === 'qa-runtime').length,
    15,
  );

  assert.deepEqual(
    dataset.cases
      .filter((item) => item.feedbackRegression)
      .map((item) => item.feedbackRegression)
      .sort(),
    [
      '回答答非所问',
      '个人分支丢失原问题能力主题',
      '公开多 Agent 经历被错误判为不可用',
      '完整技术问题被误澄清',
      '实现追问开放式检索或丢失能力主题',
      '明确公开项目被个人事实路由截获',
      '明确公开项目被个人事实路由截获',
      '普通对话追问丢失上下文',
      '回复像固定RAG模板',
      '未提供JD仍生成匹配',
      '未知系统借用相似项目证据',
      '能力续问丢失主题',
      '自然身份问法被误澄清',
      '澄清选项无法完成',
      '重复固定澄清',
      '省略追问丢失项目上下文',
      '项目集合问题被旧多 Agent 话题覆盖',
    ].sort(),
  );

  const categories = new Set(dataset.cases.map((item) => item.category));
  for (const category of [
    'recruiter',
    'collaboration',
    'peer',
    'cross-project',
    'insufficient-evidence',
    'prompt-injection',
    'malicious-url',
    'search-routing',
    'search-degradation',
    'workflow-boundary',
    'auth-error',
    'stable-error',
    'diagnosis-notification',
    'source-navigation',
    'social',
    'identity',
    'recruitment-positive',
    'route-policy',
    'multi-turn',
  ]) {
    assert.ok(categories.has(category), `conversation v2 category is missing: ${category}`);
  }

  const workflows = new Set(dataset.cases.map((item) => item.workflow).filter(Boolean));
  assert.deepEqual([...workflows].sort(), ['chat', 'diagnosis', 'jd_match']);

  const behaviors = new Set(dataset.cases.map((item) => item.expectedBehavior));
  for (const behavior of [
    'grounded',
    'refuse',
    'error',
    'navigate',
    'route-search',
    'degrade-search',
    'reject-url',
    'reject-request',
    'dedupe-notification',
    'source-contract',
    'social',
    'identity',
    'recruitment',
    'route-policy',
    'multi-turn-route',
  ]) {
    assert.ok(behaviors.has(behavior), `evaluation behavior is missing: ${behavior}`);
  }
});

test('S10 validators are scenario-specific instead of forcing gaps and next steps globally', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  assert.equal(source.includes("answer.includes('下一步')"), false);
  assert.equal(source.includes('/不足|无法|不会|边界/'), false);
  for (const validator of [
    'validateSocial',
    'validateIdentity',
    'validateGrounded',
    'validateRecruitment',
    'validateSafetyRefusal',
    'validateRouteReliability',
  ]) {
    assert.match(source, new RegExp(`function ${validator}\\b`));
  }
});

test('deterministic evaluation has no automatic safe or degraded answer path', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  assert.doesNotMatch(source, /buildSafeChatAnswer|safeAnswer\s*:|degraded\s*===\s*true/u);
  assert.match(source, /expectedDependencies/u);
});

test('all answer-quality cases execute the production v2 route and evidence chain', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  assert.doesNotMatch(source, /routeLegacyChatTurn|\.\/chat-behavior\.ts/u);

  const routedExecutionSource = source.slice(
    source.indexOf('async function executeRoutedCase'),
    source.indexOf('function evaluateError'),
  );
  assert.match(routedExecutionSource, /routeChatTurn\s*\(/u);
  assert.match(routedExecutionSource, /resolveChatEvidence\s*\(/u);
  assert.match(source, /validateRouteReliability\s*\(/u);

  const qualityBehaviors = new Set([
    'grounded',
    'refuse',
    'social',
    'identity',
    'recruitment',
    'explicit-unknown',
  ]);
  const qualityCases = readDataset().cases.filter((item) => qualityBehaviors.has(item.expectedBehavior));
  assert.ok(qualityCases.length > 0);
  assert.ok(qualityCases.every((item) => (
    item.expectedRoute
    && item.expectedEvidence
    && item.expectedDependencies
    && Object.values(item.expectedDependencies).every(Number.isInteger)
  )));
});

test('route evaluation derives provider execution from the safety boundary instead of expected call counts', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  assert.doesNotMatch(source, /if \(item\.expectedDependencies\.chat > 0\)/u);
  assert.match(source, /route\.safetyBoundary === null/u);

  const dataset = readDataset();
  const comparison = dataset.cases.find((item) => item.id === 'cross-project-research-portfolio') as
    | (EvalCase & { expectedAnswerFragments?: string[] })
    | undefined;
  assert.deepEqual(comparison?.expectedAnswerFragments, ['深度研究', '数字摩斯']);

  const contentOperations = dataset.cases.find((item) => item.id === 'cross-project-content-ops');
  assert.deepEqual(contentOperations?.expectedAnswerFragments, ['内容创作', '自动运营']);
  assert.deepEqual(contentOperations?.expectedSourceSlugs, ['content-agent', 'auto-operations']);
  assert.match(source, /expectedSourceSlugs/u);
});

test('deterministic provider derives behavior only from real instructions and messages', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  const providerSource = source.slice(
    source.indexOf('class AdversarialDeterministicProvider'),
    source.indexOf('function sourcesFor'),
  );
  assert.doesNotMatch(providerSource, /evalItem|expectedBehavior/u);
  assert.match(providerSource, /request\.instructions/u);
  assert.match(providerSource, /request\.messages/u);
});

test('removing identity or recruitment instructions makes the matching cases fail', () => {
  for (const [mutation, category] of [
    ['drop-identity-instructions', 'identity'],
    ['drop-recruitment-instructions', 'recruitment-positive'],
  ]) {
    const run = spawnSync(process.execPath, [runnerPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        MORSE_CHAT_EVAL_MUTATION: mutation,
      },
      timeout: 20_000,
    });
    assert.equal(run.status, 1, `${mutation} must make the evaluation fail`);
    const result = JSON.parse(run.stdout) as {
      cases: Array<{ category: string; pass: boolean }>;
    };
    const categoryCases = result.cases.filter((item) => item.category === category);
    assert.ok(categoryCases.length > 0);
    assert.ok(categoryCases.some((item) => !item.pass), `${category} cases must detect ${mutation}`);
  }
});

test(`S10 evaluation is offline, passes ${EXPECTED_CASE_COUNT}/${EXPECTED_CASE_COUNT}, and emits no prompt or answer text`, () => {
  const output = execFileSync(process.execPath, [runnerPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
    },
    timeout: 20_000,
  });
  const result = JSON.parse(output) as {
    evidence: string;
    externalCalls: number;
    total: number;
    passed: number;
    pass: boolean;
    cases: Array<Record<string, unknown>>;
  };

  assert.equal(result.evidence, 'deterministic adversarial prompt/provider');
  assert.equal(result.externalCalls, 0);
  assert.equal(result.total, EXPECTED_CASE_COUNT);
  assert.equal(result.passed, EXPECTED_CASE_COUNT);
  assert.equal(result.pass, true);
  assert.equal(result.cases.length, EXPECTED_CASE_COUNT);
  for (const item of result.cases) {
    assert.deepEqual(Object.keys(item).sort(), ['category', 'id', 'pass']);
    assert.equal(item.pass, true);
  }
  assert.equal(/"(?:query|prompt|answer|instructions|messages)"\s*:/iu.test(output), false);
});

test('real review manifest has the frozen 20-case category composition', () => {
  const dataset = JSON.parse(fs.readFileSync(reviewCasesPath, 'utf8')) as {
    version: number;
    dimensions: string[];
    cases: ReviewCase[];
  };
  assert.equal(dataset.version, 2);
  assert.deepEqual(dataset.dimensions, [
    'naturalCommunication',
    'identityConsistency',
    'evidenceRelevance',
    'recruitmentHelpfulness',
    'honestyPrivacy',
  ]);
  assert.equal(dataset.cases.length, 20);
  assert.equal(new Set(dataset.cases.map((item) => item.id)).size, 20);
  assert.ok(dataset.cases.every((item) => (
    item.prompt.trim()
    && item.route.trim()
    && item.evidence.trim()
    && item.expectedSignals.length > 0
    && Object.values(item.expectedDependencies).every(Number.isInteger)
  )));
  const composition = Object.fromEntries([...new Set(dataset.cases.map((item) => item.category))]
    .sort()
    .map((category) => [
      category,
      dataset.cases.filter((item) => item.category === category).length,
    ]));
  assert.deepEqual(composition, {
    capability_evidence: 3,
    conversation: 6,
    general_advice: 3,
    identity_project: 3,
    recruitment_jd: 2,
    technical_contrast: 3,
  });
});

test('zero-tolerance review cases cover wrong RAG, fabricated facts and missing JD', () => {
  const dataset = JSON.parse(fs.readFileSync(reviewCasesPath, 'utf8')) as {
    cases: ReviewCase[];
  };
  for (const id of ['conversation-no-rag', 'kubernetes-no-direct', 'jd-intake-provider']) {
    assert.equal(dataset.cases.find((item) => item.id === id)?.zeroTolerance, true);
  }
  const jd = dataset.cases.find((item) => item.id === 'jd-complete');
  assert.equal(jd?.route, 'jd');
  assert.equal(jd?.expectedDependencies.chat, 1);
  assert.equal(jd?.expectedDependencies.embedding, 1);
});

test('S10 source contract retains the exact S9 project Hash destinations', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  for (const slug of [
    'content-agent',
    'auto-operations',
    'deep-research',
    'digital-morse',
  ]) {
    assert.match(source, new RegExp(`/works#${slug}`));
  }
  assert.doesNotMatch(source, /href:\s*['"]\/works\//);
});

test('S10 workflow cases exercise the production JD and diagnosis prompt boundaries', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  assert.match(source, /buildJdMatchPrompt/);
  assert.match(source, /buildDiagnosisPrompt/);
  assert.match(source, /normalized\.workflow === 'jd_match'/);
  assert.match(source, /normalized\.workflow === 'diagnosis'/);
});
