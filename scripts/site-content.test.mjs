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
const s3SectionsPath = path.join(repoRoot, 'components', 'S3Sections.tsx');
const packagePath = path.join(repoRoot, 'package.json');
const visualSmokePath = path.join(repoRoot, 'scripts', 's3-visual-smoke.mjs');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getByPath(value, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), value);
}

test('S3 gallery keeps four scoped cards with explicit evidence states', () => {
  const content = readJson(contentPath);
  const cards = content.gallery.cards;

  assert.deepEqual(
    cards.map((card) => card.id),
    ['content-agent', 'operations-pipeline', 'deep-research', 'incubator'],
  );

  assert.deepEqual(
    cards.map((card) => card.sampleLabel),
    ['待补证据', '待补证据', '筹备中', '示例数据'],
  );

  for (const card of cards) {
    assert.ok(card.problem.length > 0);
    assert.ok(card.solution.length > 0);
    assert.ok(card.humanAiSplit.length > 0);
    assert.ok(card.status.length > 0);
  }

  const deepResearch = cards.find((card) => card.id === 'deep-research');
  assert.match(deepResearch.cta.label, /试驾间回放/);
  assert.match(deepResearch.cta.label, /筹备中/);

  const operationsPipeline = cards.find((card) => card.id === 'operations-pipeline');
  assert.match(operationsPipeline.status, /小红书端准备上线/);
  assert.doesNotMatch(operationsPipeline.status, /功能闭环已验证/);
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

  assert.deepEqual(
    content.ledger.sampleItems.map((item) => item.sampleLabel),
    ['待补证据', '示例数据'],
  );
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

test('S5 live content excludes draft-only markers and unsafe source wording', () => {
  const content = readJson(contentPath);
  const serialized = JSON.stringify(content);

  const forbidden = [
    /草稿/,
    /待摩斯终审/,
    /未经确认不得上线/,
    /\[待摩斯补充/,
    /TODO/i,
    /信息来源:E:\\/,
    /E:\\Wiki/,
    /E:\\demo2/,
    /E:\\小红书/,
    /E:\\多agent/,
    /XHS_ALL_IN_ONE/,
    /批量自动化操作平台/,
    /客户信息/,
    /内部界面/,
    /源码/,
  ];

  for (const pattern of forbidden) {
    assert.doesNotMatch(serialized, pattern);
  }
});

test('S5 missing facts are explicit content gaps, not fake public claims', () => {
  const content = readJson(contentPath);

  assert.equal(content.contentGaps.title, '内容缺口台账');
  assert.deepEqual(
    content.contentGaps.items.map((item) => item.label),
    ['身份与联系方式', '量化效果', '系统关系口径', '口播与数字人素材'],
  );

  const allowedStatusLabels = new Set(['待摩斯补齐', '待补证据', '待人工定稿', '待素材']);
  for (const item of content.contentGaps.items) {
    assert.ok(allowedStatusLabels.has(item.status));
    assert.ok(item.body.length > 0);
  }

  for (const link of content.contact.links) {
    if (link.href === '#') {
      assert.equal(link.sampleLabel, '示例数据');
    } else {
      assert.ok(!link.sampleLabel);
    }
  }
});

test('S5 safe sections are data-driven and rendered by the S3 section component', () => {
  const content = readJson(contentPath);
  const component = fs.readFileSync(s3SectionsPath, 'utf8');

  assert.ok(content.about.title.length > 0);
  assert.ok(content.about.points.length >= 3);
  assert.ok(content.faq.items.length >= 4);

  for (const item of content.faq.items) {
    assert.ok(item.question.length > 0);
    assert.ok(item.answer.length > 0);
  }

  assert.match(component, /content\.about\.points\.map/);
  assert.match(component, /content\.faq\.items\.map/);
  assert.match(component, /content\.contentGaps\.items\.map/);
  assert.match(component, /link\.href === '#'/);
  assert.match(component, /没有证据链的数字,我会明确标注状态/);
});
