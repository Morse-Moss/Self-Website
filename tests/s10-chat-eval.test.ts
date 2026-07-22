import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

interface EvalCase {
  id: string;
  category: string;
  query: string;
  expectedBehavior: string;
  feedbackRegression?: string;
  workflow?: 'chat' | 'jd_match' | 'diagnosis';
  intent?: 'general' | 'recruiter' | 'collaboration' | 'peer';
}

interface ReviewCase {
  id: string;
  prompt: string;
  primaryDimension: string;
  expectedSignals: string[];
}

const dataPath = path.join(process.cwd(), 'content', 'chat-eval.json');
const reviewCasesPath = path.join(process.cwd(), 'content', 'chat-review-cases.json');
const runnerPath = path.join(process.cwd(), 'scripts', 'chat-eval.mjs');

function readDataset(): { version: number; cases: EvalCase[] } {
  return JSON.parse(fs.readFileSync(dataPath, 'utf8')) as {
    version: number;
    cases: EvalCase[];
  };
}

test('S10 deterministic evaluation freezes 72 cases and the three user regressions', () => {
  const dataset = readDataset();
  assert.ok(dataset.version >= 4, 'conversation v2 evaluation schema must be version 4 or newer');
  assert.equal(dataset.cases.length, 72);
  assert.equal(new Set(dataset.cases.map((item) => item.id)).size, 72);
  assert.ok(dataset.cases.every((item) => item.query.trim() && item.expectedBehavior.trim()));

  assert.deepEqual(
    dataset.cases
      .filter((item) => item.feedbackRegression)
      .map((item) => item.feedbackRegression)
      .sort(),
    ['Provider回答失败', '数字Morse像开发助手', '招聘措辞过直'].sort(),
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
    'explicit-unknown',
    'no-rag',
    'recovery',
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
    'explicit-unknown',
    'no-rag',
    'recovery',
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
    'validateExplicitUnknown',
    'validateSafetyRefusal',
    'validateRecovery',
  ]) {
    assert.match(source, new RegExp(`function ${validator}\\b`));
  }
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

test('S10 evaluation is offline, passes 72/72, and emits no prompt or answer text', () => {
  const output = execFileSync(process.execPath, [runnerPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
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
  assert.equal(result.total, 72);
  assert.equal(result.passed, 72);
  assert.equal(result.pass, true);
  assert.equal(result.cases.length, 72);
  for (const item of result.cases) {
    assert.deepEqual(Object.keys(item).sort(), ['category', 'id', 'pass']);
    assert.equal(item.pass, true);
  }
  assert.equal(/"(?:query|prompt|answer|instructions|messages)"\s*:/iu.test(output), false);
});

test('manual review input contains 20 synthetic cases balanced across five dimensions', () => {
  const dataset = JSON.parse(fs.readFileSync(reviewCasesPath, 'utf8')) as {
    version: number;
    dimensions: string[];
    cases: ReviewCase[];
  };
  assert.equal(dataset.version, 1);
  assert.deepEqual(dataset.dimensions, [
    'naturalCommunication',
    'identityConsistency',
    'evidenceRelevance',
    'recruitmentHelpfulness',
    'honestyPrivacy',
  ]);
  assert.equal(dataset.cases.length, 20);
  assert.equal(new Set(dataset.cases.map((item) => item.id)).size, 20);
  assert.ok(dataset.cases.every((item) => item.prompt.trim() && item.expectedSignals.length > 0));
  for (const dimension of dataset.dimensions) {
    assert.equal(
      dataset.cases.filter((item) => item.primaryDimension === dimension).length,
      4,
      `${dimension} must own four review cases`,
    );
  }
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
