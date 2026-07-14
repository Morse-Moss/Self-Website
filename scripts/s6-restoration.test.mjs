import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = new URL('../', import.meta.url);

test('S6 restoration has a repeatable multi-width browser acceptance gate', () => {
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
