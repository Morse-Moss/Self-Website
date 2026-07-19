import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = new URL('../', import.meta.url);
const s9SpecPath =
  'docs/superpowers/specs/2026-07-14-aiking-inspired-portfolio-redesign-design.md';

function readUtf8(relativePath) {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

function assertIncludesAll(source, expected, label) {
  for (const value of expected) {
    assert.ok(source.includes(value), `${label} must include: ${value}`);
  }
}

test('historical S6 restoration retains its multi-width browser evidence gate', () => {
  const packageJson = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8'));
  const harnessPath = new URL('scripts/s6-restoration-smoke.mjs', repoRoot);

  assert.equal(
    packageJson.scripts['visual:s6-restore'],
    'node scripts/s6-restoration-smoke.mjs http://127.0.0.1:3010',
  );
  assert.ok(existsSync(harnessPath), 'missing S6 restoration browser harness');

  const harness = readFileSync(harnessPath, 'utf8');
  for (const value of [
    "'/'",
    "'/works'",
    "'/works/content-agent'",
    "'/works/auto-operations'",
    "'/works/deep-research'",
    "'/works/digital-morse'",
    '1440',
    '900',
    '390',
    '844',
    '600',
    '数字生命摩斯',
    '系统展厅',
    '杠杆账本',
    '高频问题',
    'home-desktop-1440x900.png',
    'home-mobile-390x844.png',
    'home-mobile-390-reduced.png',
    'S6_RESTORE_EVIDENCE_DIR',
    'nextSectionHint',
    'headingRect.bottom <= window.innerHeight',
    "revealStyle.visibility !== 'hidden'",
    'Number.parseFloat(revealStyle.opacity) >= 0.99',
    'Page.captureScreenshot',
    'Runtime.consoleAPICalled',
    'Runtime.exceptionThrown',
    'Network.responseReceived',
    'documentStatus',
    'chatOverlapCount',
    'CDP WebSocket connection timed out',
    'CDP command timed out',
    'infrastructureFailure',
    'prefers-reduced-motion',
    'document.getAnimations',
    'horizontalOverflow',
    '问数字摩斯',
    '关闭对话',
    'Page.close',
  ]) {
    assert.ok(harness.includes(value), `S6 restoration harness must include: ${value}`);
  }
});

test('S9 supersedes historical S6 live-page requirements', () => {
  const blueprint = readUtf8('docs/portfolio-blueprint.md');
  const specification = readUtf8(s9SpecPath);
  const currentHarness = readUtf8('scripts/s9-visual-smoke.mjs');
  const currentContract = `${blueprint}\n${specification}\n${currentHarness}`;

  assertIncludesAll(
    currentContract,
    [
      '## 14. S9 Morse 作品集重设计(2026-07-14)',
      'Morse',
      '/works#content-agent',
      '企业内部脱敏案例',
      '旧 `/works/[slug]` 地址重定向到 `/works#slug`',
      '首页不再保留完整项目展厅、职业经历或静态 FAQ',
      '删除企业内部项目的公开入口、生产截图和可识别部署信息',
      '访问系统按钮',
    ],
    'S9 current public contract',
  );
  assert.doesNotMatch(
    currentHarness,
    /['"]\/works\/(?:content-agent|auto-operations|deep-research|digital-morse)['"]/,
    'S9 current browser gate must use /works#slug instead of legacy detail routes',
  );
});
