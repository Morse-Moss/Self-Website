import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

interface EvalCase {
  id: string;
  category: string;
  query: string;
  expectedBehavior: string;
  workflow?: 'chat' | 'jd_match' | 'diagnosis';
  intent?: 'general' | 'recruiter' | 'collaboration' | 'peer';
  expectedHref?: string;
}

const dataPath = path.join(process.cwd(), 'content', 'chat-eval.json');
const runnerPath = path.join(process.cwd(), 'scripts', 'chat-eval.mjs');

function readDataset(): { version: number; cases: EvalCase[] } {
  return JSON.parse(fs.readFileSync(dataPath, 'utf8')) as {
    version: number;
    cases: EvalCase[];
  };
}

test('S10 deterministic chat evaluation covers the frozen product and safety matrix', () => {
  const dataset = readDataset();
  assert.ok(dataset.version >= 3, 'S10 evaluation schema must be version 3 or newer');
  assert.ok(dataset.cases.length >= 36, 'S10 evaluation must contain at least 36 cases');
  assert.equal(new Set(dataset.cases.map((item) => item.id)).size, dataset.cases.length);
  assert.ok(dataset.cases.every((item) => item.query.trim() && item.expectedBehavior.trim()));

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
  ]) {
    assert.ok(categories.has(category), `S10 evaluation category is missing: ${category}`);
  }

  const workflows = new Set(dataset.cases.map((item) => item.workflow).filter(Boolean));
  assert.deepEqual([...workflows].sort(), ['chat', 'diagnosis', 'jd_match']);

  const audiences = new Set(dataset.cases.map((item) => item.intent).filter(Boolean));
  for (const audience of ['recruiter', 'collaboration', 'peer']) {
    assert.ok(audiences.has(audience as EvalCase['intent']), `audience is missing: ${audience}`);
  }

  const requiredBehaviors = [
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
  ];
  const behaviors = new Set(dataset.cases.map((item) => item.expectedBehavior));
  for (const behavior of requiredBehaviors) {
    assert.ok(behaviors.has(behavior), `S10 evaluation behavior is missing: ${behavior}`);
  }
});

test('S10 evaluation runner is deterministic, offline, and passes every declared case', () => {
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
    cases: number;
    passed: boolean;
    byWorkflow: Record<string, { cases: number; passed: number }>;
  };

  assert.equal(result.evidence, 'deterministic adversarial prompt/provider');
  assert.ok(result.cases >= 36);
  assert.equal(result.passed, true);
  assert.deepEqual(Object.keys(result.byWorkflow).sort(), ['chat', 'diagnosis', 'jd_match', 'non-chat']);
  for (const summary of Object.values(result.byWorkflow)) {
    assert.ok(summary.cases > 0);
    assert.equal(summary.passed, summary.cases);
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
