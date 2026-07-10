// scripts/site-content.test.mjs
// S3 contract tests: gallery placeholders, real stats mapping, resume mode constants.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const contentPath = path.join(repoRoot, 'content', 's3-content.json');
const statsPath = path.join(repoRoot, 'content', 'stats.json');
const layoutPath = path.join(repoRoot, 'app', 'layout.tsx');
const packagePath = path.join(repoRoot, 'package.json');
const visualSmokePath = path.join(repoRoot, 'scripts', 's3-visual-smoke.mjs');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getByPath(value, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), value);
}

test('S3 gallery keeps four scoped cards with explicit placeholder labels', () => {
  const content = readJson(contentPath);
  const cards = content.gallery.cards;

  assert.deepEqual(
    cards.map((card) => card.id),
    ['content-agent', 'operations-pipeline', 'deep-research', 'incubator'],
  );

  for (const card of cards) {
    assert.equal(card.sampleLabel, '示例数据');
    assert.ok(card.problem.length > 0);
    assert.ok(card.solution.length > 0);
    assert.ok(card.humanAiSplit.length > 0);
    assert.ok(card.status.length > 0);
  }

  const deepResearch = cards.find((card) => card.id === 'deep-research');
  assert.match(deepResearch.cta.label, /试驾间回放/);
  assert.match(deepResearch.cta.label, /筹备中/);
});

test('S3 ledger maps real visible metrics to stats.json instead of hard-coded numbers', () => {
  const content = readJson(contentPath);
  const stats = readJson(statsPath);

  assert.deepEqual(
    content.ledger.metrics.map((metric) => metric.sourcePath),
    ['claudeCode.sessions', 'claudeCode.projects', 'claudeCode.activeDaysLast90'],
  );

  for (const metric of content.ledger.metrics) {
    const value = getByPath(stats, metric.sourcePath);
    assert.equal(typeof value, 'number');
    assert.equal(metric.dataLabel, '真实统计');
    assert.ok(metric.methodologyLabel.length > 0);
  }

  for (const item of content.ledger.sampleItems) {
    assert.equal(item.sampleLabel, '示例数据');
  }
});

test('S3 resume mode exposes stable persistence and print contract labels', () => {
  const content = readJson(contentPath);

  assert.equal(content.resumeMode.storageKey, 'morse.resumeMode');
  assert.equal(content.resumeMode.bodyClass, 'resume-mode');
  assert.equal(content.resumeMode.toggleLabel, '简历模式');
  assert.match(content.resumeMode.printLabel, /打印/);
});

test('S3 resume mode has a pre-hydration body-class guard', () => {
  const layout = fs.readFileSync(layoutPath, 'utf8');

  assert.match(layout, /suppressHydrationWarning/);
  assert.match(layout, /next\/script/);
  assert.match(layout, /strategy="beforeInteractive"/);
  assert.match(layout, /s3Content\.resumeMode\.storageKey/);
  assert.match(layout, /s3Content\.resumeMode\.bodyClass/);
  assert.match(layout, /localStorage\.getItem/);
  assert.match(layout, /document\.documentElement\.classList\.add/);
});

test('S3 visual smoke is repeatable and proves reduced-motion stillness', () => {
  const pkg = readJson(packagePath);
  const smoke = fs.readFileSync(visualSmokePath, 'utf8');

  assert.equal(pkg.scripts['visual:s3'], 'node scripts/s3-visual-smoke.mjs http://localhost:3000');
  assert.match(smoke, /Page\.close/);
  assert.match(smoke, /reducedStill/);
  assert.match(smoke, /-still-a\.png/);
  assert.match(smoke, /-still-b\.png/);
});
