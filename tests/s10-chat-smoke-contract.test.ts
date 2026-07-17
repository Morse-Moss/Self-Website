import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  S10_SCENARIOS,
  S10_VIEWPORTS,
  createS10Summary,
  validateLoopbackHttpUrl,
} from '../scripts/s10-chat-smoke.mjs';

const repoRoot = new URL('../', import.meta.url);
const harnessUrl = new URL('scripts/s10-chat-smoke.mjs', repoRoot);
const packageJson = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8')) as {
  scripts: Record<string, string>;
};

test('S10 exposes one repeatable mock E2E command', () => {
  assert.ok(existsSync(harnessUrl));
  assert.equal(packageJson.scripts['visual:s10'], 'node scripts/s10-chat-smoke.mjs');
});

test('S10 locks the required desktop and mobile acceptance viewports', () => {
  assert.deepEqual(S10_VIEWPORTS, [
    { key: 'desktop', width: 1440, height: 900 },
    { key: 'mobile', width: 390, height: 844 },
  ]);
});

test('S10 scenario registry covers the complete visitor and admin contract', () => {
  assert.deepEqual(S10_SCENARIOS, [
    'visitor-unlock',
    'starter-direct-send',
    'assistant-formatting',
    'chat',
    'jd-match',
    'diagnosis',
    'phase-status',
    'stop-compensation',
    'refresh-history',
    'source-navigation',
    'search-degradation',
    'visitor-session-expiry',
    'admin-login',
    'admin-list-detail',
    'admin-badcase',
    'admin-export',
    'admin-session-expiry',
    'dual-width-overflow',
    'console-page-errors',
  ]);
});

test('S10 refuses non-loopback and non-http targets', () => {
  assert.equal(validateLoopbackHttpUrl('http://127.0.0.1:3012').origin, 'http://127.0.0.1:3012');
  assert.equal(validateLoopbackHttpUrl('http://localhost:3012').hostname, 'localhost');
  assert.throws(() => validateLoopbackHttpUrl('https://example.com'), /loopback/u);
  assert.throws(() => validateLoopbackHttpUrl('file:///tmp/site'), /http/u);
});

test('S10 summary is deterministic and does not carry credentials', () => {
  assert.deepEqual(createS10Summary({
    checks: ['chat', 'chat', 'admin'],
    consoleErrors: ['console:error'],
    failures: ['overflow:mobile', 'overflow:mobile'],
    pageErrors: [],
    screenshots: ['mobile.png', 'desktop.png'],
  }), {
    kind: 'S10_MOCK_E2E',
    evidence: 'loopback-mock',
    passed: false,
    checks: ['admin', 'chat'],
    failures: ['overflow:mobile'],
    consoleErrors: ['console:error'],
    pageErrors: [],
    screenshots: ['desktop.png', 'mobile.png'],
    viewports: ['1440x900', '390x844'],
  });
});

test('S10 harness reuses bounded project infrastructure and never loads local secrets', () => {
  const source = readFileSync(harnessUrl, 'utf8');
  for (const marker of [
    "from './lib/s9-cdp.mjs'",
    'waitForOwnedDevToolsActivePort',
    'connectCdpTransport',
    'dispatchPrimaryClick',
    'cleanupOwnedBrowser',
    'scripts/mock-openai.mjs',
    'scripts/mock-bocha.mjs',
    'createDisposablePostgresDatabase',
    'MORSE_ALLOW_TEST_EMBEDDINGS',
    'NEXT_TELEMETRY_DISABLED',
  ]) {
    assert.ok(source.includes(marker), `missing bounded infrastructure marker: ${marker}`);
  }
  assert.doesNotMatch(source, /\.env\.local/u);
  assert.doesNotMatch(source, /api\.openai\.com|api\.bochaai\.com|FEISHU_WEBHOOK_URL\s*:/u);
  assert.doesNotMatch(source, /S10_DEBUG_CHILD_OUTPUT|CHAT_STATE|CDP_METHOD/u);
});

test('S10 runtime snapshot builds and starts production without a junction file watcher', () => {
  const source = readFileSync(harnessUrl, 'utf8');

  assert.match(source, /const runtimeParent = path\.join\(repoRoot, '\.next'\)/u);
  assert.match(source, /mkdtempSync\(path\.join\(runtimeParent, 's10-runtime-'\)\)/u);
  assert.match(source, /\[nextCli, 'build', '--webpack'\]/u);
  assert.match(source, /\[nextCli, 'start', '--hostname'/u);
  assert.doesNotMatch(source, /\[nextCli, 'dev'/u);
});

test('S10 desktop touch emulation never sends an invalid zero touch-point count', () => {
  const source = readFileSync(harnessUrl, 'utf8');

  assert.match(
    source,
    /mobile\s*\?\s*\{ enabled: true, maxTouchPoints: 1 \}\s*:\s*\{ enabled: false \}/u,
  );
  assert.doesNotMatch(source, /maxTouchPoints:\s*viewport\.width < 640 \? 1 : 0/u);
});

test('S10 waits through embedded chat loading instead of clicking an absent launcher', () => {
  const source = readFileSync(harnessUrl, 'utf8');

  assert.match(source, /const embedded = await selectorExists\(page, `\$\{SELECTORS\.chatRoot\}\[data-variant="embedded"\]`\)/u);
  assert.match(source, /if \(!embedded\) await click\(page, `\$\{SELECTORS\.chatRoot\} > button`\)/u);
});

test('S10 harness uses stable UI observability for every required workflow', () => {
  const source = readFileSync(harnessUrl, 'utf8');
  for (const selector of [
    'morse-chat-panel',
    'morse-chat-workspace',
    'data-workflow="chat"',
    'data-workflow="jd_match"',
    'data-workflow="diagnosis"',
    'morse-chat-phase',
    'data-stream-state="stopped"',
    'data-source-group="local"',
    'data-source-group="web"',
    'admin-login-form',
    'admin-turn-list',
    'admin-turn-detail',
    'admin-badcase-form',
    'admin-export-form',
  ]) {
    assert.ok(source.includes(selector), `missing stable selector: ${selector}`);
  }
  assert.ok(
    source.includes('document.querySelector(${JSON.stringify(SELECTORS.chatPanel)})?.getBoundingClientRect()'),
    'mobile panel geometry must use the shared chat panel selector',
  );
});

test('S10 export acceptance clicks the visible format option instead of the hidden radio', () => {
  const source = readFileSync(harnessUrl, 'utf8');

  assert.match(
    source,
    /const csvOption = `\$\{SELECTORS\.adminExport\} label:has\(input\[name="exportFormat"\]\[value="csv"\]\)`/u,
  );
  assert.doesNotMatch(
    source,
    /const csvRadio = `\$\{SELECTORS\.adminExport\} input\[name="exportFormat"\]\[value="csv"\]`/u,
  );
});

test('S10 keeps private admin exports in an owned disposable download directory', () => {
  const source = readFileSync(harnessUrl, 'utf8');

  assert.match(
    source,
    /mkdtempSync\(path\.join\(os\.tmpdir\(\), ['"]revolution-s10-download-['"]\)\)/u,
  );
  assert.match(source, /downloadPath:\s*downloadDirectory/u);
  assert.doesNotMatch(source, /downloadPath:\s*outputDirectory/u);
  assert.match(source, /path\.basename\(resolved\)\.startsWith\(['"]revolution-s10-download-['"]\)/u);
  assert.match(source, /if \(downloadDirectory\) removeDownloadDirectory\(downloadDirectory\)/u);
});

test('S10 foregrounds each tab and clears automation selection before durable screenshots', () => {
  const source = readFileSync(harnessUrl, 'utf8');
  const captureStart = source.indexOf('async function capture');
  const visitorStart = source.indexOf('async function runVisitorScenarios');
  const captureSource = source.slice(captureStart, visitorStart);

  assert.ok(captureStart >= 0 && visitorStart > captureStart);
  assert.match(captureSource, /await page\.send\(['"]Page\.bringToFront['"]\)/u);
  assert.match(
    captureSource,
    /window\.getSelection\(\)\?\.removeAllRanges\(\); true/u,
  );
  assert.match(captureSource, /await delay\(350\)/u);
  assert.doesNotMatch(captureSource, /requestAnimationFrame/u);
  assert.ok(captureSource.indexOf('Page.bringToFront') < captureSource.indexOf('Page.captureScreenshot'));
});

test('S10 navigation reclaims the foreground after another tab is captured', () => {
  const source = readFileSync(harnessUrl, 'utf8');
  const navigateStart = source.indexOf('async function navigate');
  const reloadStart = source.indexOf('async function reload');
  const navigateSource = source.slice(navigateStart, reloadStart);

  assert.ok(navigateStart >= 0 && reloadStart > navigateStart);
  assert.match(navigateSource, /await page\.send\(['"]Page\.bringToFront['"]\)/u);
  assert.ok(navigateSource.indexOf('Page.bringToFront') < navigateSource.indexOf('Page.navigate'));
});

test('S10 captures authorized mobile evidence before expiring either session', () => {
  const source = readFileSync(harnessUrl, 'utf8');
  const visitorStart = source.indexOf('async function runVisitorScenarios');
  const mobileStart = source.indexOf('async function runMobileVisitor');
  const adminStart = source.indexOf('async function runAdminScenarios');
  const collectStart = source.indexOf('function collectBrowserErrors');

  assert.ok(visitorStart >= 0 && visitorStart < mobileStart);
  assert.ok(mobileStart < adminStart && adminStart < collectStart);

  const visitorSource = source.slice(visitorStart, mobileStart);
  const mobileSource = source.slice(mobileStart, adminStart);
  const adminSource = source.slice(adminStart, collectStart);

  assert.doesNotMatch(visitorSource, /UPDATE access_sessions/);
  const mobileAuthorized = mobileSource.indexOf("'mobile:authorized-chat'");
  const mobileCapture = mobileSource.indexOf("'s10-chat-mobile-390x844.png'");
  const mobileExpiry = mobileSource.indexOf('UPDATE access_sessions');
  const mobileReload = mobileSource.indexOf('await reload(page)');
  assert.ok(
    mobileAuthorized >= 0
      && mobileAuthorized < mobileCapture
      && mobileCapture < mobileExpiry
      && mobileExpiry < mobileReload,
    'mobile visitor screenshot must prove the authorized UI before the expiry reload',
  );

  const adminMobileOpen = adminSource.indexOf("'admin:mobile-detail'");
  const adminMobileCapture = adminSource.indexOf("'s10-admin-mobile-390x844.png'");
  const adminMobileBack = adminSource.indexOf("'[data-testid=\"admin-detail-back\"]'");
  const adminExpiry = adminSource.indexOf('UPDATE admin_sessions');
  assert.ok(
    adminMobileOpen >= 0
      && adminMobileOpen < adminMobileCapture
      && adminMobileCapture < adminMobileBack
      && adminMobileBack < adminExpiry,
    'mobile admin screenshot must prove the full-screen detail before session expiry',
  );
});

test('S10 keeps the mock provider held until stop compensation is durable', () => {
  const source = readFileSync(harnessUrl, 'utf8');
  const visitorStart = source.indexOf('async function runVisitorScenarios');
  const mobileStart = source.indexOf('async function runMobileVisitor');
  const visitorSource = source.slice(visitorStart, mobileStart);
  const stopHold = visitorSource.indexOf('const held = openAiProxy.holdNextResponse()');
  const stoppedUi = visitorSource.indexOf("'stop:ui-state'");
  const durableStop = visitorSource.indexOf("'stop:database-compensation'");
  const releaseProvider = visitorSource.indexOf('openAiProxy.releaseHeldResponse()', stopHold);

  assert.ok(
    stopHold >= 0
      && stopHold < stoppedUi
      && stoppedUi < durableStop
      && durableStop < releaseProvider,
    'provider response must remain held until the stopped turn is durable',
  );
});
