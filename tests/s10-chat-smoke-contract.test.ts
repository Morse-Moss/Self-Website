import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  S10_SCENARIOS,
  S10_VIEWPORTS,
  cleanupS10Browser,
  createS10Summary,
  validateLoopbackHttpUrl,
} from '../scripts/s10-chat-smoke.mjs';

const repoRoot = new URL('../', import.meta.url);
const harnessUrl = new URL('scripts/s10-chat-smoke.mjs', repoRoot);
const legacyHarnessUrl = new URL('scripts/s8-chat-smoke.mjs', repoRoot);
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
    'admin-invite-management',
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
    'admin-invites-open',
    'admin-invite-dialog',
    'admin-invite-form',
    'admin-invite-code',
    'admin-invite-list',
    'admin-invite-copy',
    'admin-invite-deactivate',
    'admin-invite-deactivate-confirm',
    'admin-export-form',
  ]) {
    assert.ok(source.includes(selector), `missing stable selector: ${selector}`);
  }
  assert.ok(
    source.includes('document.querySelector(${JSON.stringify(SELECTORS.chatPanel)})?.getBoundingClientRect()'),
    'mobile panel geometry must use the shared chat panel selector',
  );
});

test('S10 proves the one-time invite lifecycle and mobile dialog geometry', () => {
  const source = readFileSync(harnessUrl, 'utf8');
  const adminStart = source.indexOf('async function runAdminScenarios');
  const collectStart = source.indexOf('function collectBrowserErrors');
  const adminSource = source.slice(adminStart, collectStart);

  assert.ok(adminStart >= 0 && collectStart > adminStart);
  assert.doesNotMatch(adminSource, /nextUnusedAdminTotp|generateTotp|totpSecret/u);
  assert.match(adminSource, /input\[name="exportPassword"\]/u);
  assert.match(adminSource, /adminPassword/u);
  assert.match(adminSource, /hashSecret\(createdInviteCode\)/u);
  assert.match(adminSource, /Browser\.grantPermissions/u);
  assert.match(adminSource, /admin:invite-copy/u);
  assert.match(adminSource, /admin:invite-hash-only/u);
  assert.match(adminSource, /admin:invite-deactivated/u);
  assert.match(adminSource, /admin:invite-one-time/u);
  assert.match(adminSource, /s10-admin-invites-desktop-1440x900\.png/u);
  assert.match(adminSource, /s10-admin-invites-mobile-390x844\.png/u);
  assert.match(adminSource, /admin:mobile-invite-fullscreen/u);
  assert.ok(
    adminSource.indexOf('s10-admin-invites-mobile-390x844.png')
      < adminSource.indexOf('UPDATE admin_sessions'),
    'mobile invite evidence must be captured before admin session expiry',
  );
});

test('source navigation keeps the active chat while project evidence opens separately', () => {
  const source = readFileSync(harnessUrl, 'utf8');
  const visitorStart = source.indexOf('async function runVisitorScenarios');
  const mobileStart = source.indexOf('async function runMobileVisitor');
  const visitorSource = source.slice(visitorStart, mobileStart);

  assert.ok(visitorStart >= 0 && mobileStart > visitorStart);
  assert.match(visitorSource, /localStaticCount/u);
  assert.match(visitorSource, /inlineLocalHref/u);
  assert.match(visitorSource, /inlineStaticCount/u);
  assert.match(visitorSource, /data-citation-index/u);
  assert.match(visitorSource, /data-citation-static/u);
  assert.match(visitorSource, /localTarget === '_blank'/u);
  assert.match(visitorSource, /localRel\.includes\('noopener'\)/u);
  assert.match(visitorSource, /beforeSourceClick/u);
  assert.match(visitorSource, /afterSourceClick/u);
  assert.match(visitorSource, /source:original-url/u);
  assert.match(visitorSource, /source:original-messages/u);
  assert.match(visitorSource, /source:original-scroll/u);
  assert.match(visitorSource, /Target\.getTargets/u);
  assert.match(visitorSource, /Target\.closeTarget/u);
  assert.match(visitorSource, /source:new-tab/u);
  assert.doesNotMatch(visitorSource, /location\.pathname === ['"]\/works['"]/u);

  const scrollTarget = visitorSource.indexOf("source.scrollIntoView({ block: 'center', behavior: 'auto' })");
  const beforeClick = visitorSource.indexOf('const beforeSourceClick');
  const click = visitorSource.indexOf('await click(page, inlineSourceSelector)');
  assert.ok(scrollTarget >= 0 && scrollTarget < beforeClick && beforeClick < click);
});

test('historical S8 smoke follows the current non-disruptive source contract', () => {
  const source = readFileSync(legacyHarnessUrl, 'utf8');

  assert.match(source, /data-source-static/u);
  assert.match(source, /sourceTarget !== '_blank'/u);
  assert.match(source, /originalLocation/u);
  assert.match(source, /originalMessageCount/u);
  assert.match(source, /\/json\/list/u);
  assert.match(source, /\/json\/close\//u);
  assert.match(source, /finally[\s\S]*openedSourceTarget[\s\S]*closeTabTarget/u);
  assert.doesNotMatch(source, /Timed out waiting for source navigation/u);
  assert.doesNotMatch(source, /location\.pathname === \$\{JSON\.stringify\(sourcePathname\)\}/u);
});

test('S10 browser cleanup falls back to the owned profile and releases stale child handles', async () => {
  const calls: string[] = [];
  const browserProcess = {
    unref() {
      calls.push('unref');
    },
  };

  await cleanupS10Browser({
    browserProcess,
    profileDir: 'C:/Temp/revolution-s9-edge-owned',
  }, {
    cleanupBrowser: async () => {
      calls.push('primary');
      throw new Error('primary cleanup failed');
    },
    removeProfile: async () => {
      calls.push('remove');
    },
    terminateProfileProcesses: () => {
      calls.push('profile');
    },
  });

  assert.deepEqual(calls, ['primary', 'profile', 'unref', 'remove']);
});

test('S10 browser cleanup exposes a stable failure after every owned fallback fails', async () => {
  let unrefs = 0;

  await assert.rejects(
    cleanupS10Browser({
      browserProcess: { unref: () => { unrefs += 1; } },
      profileDir: 'C:/Temp/revolution-s9-edge-owned',
    }, {
      cleanupBrowser: async () => {
        throw new Error('primary cleanup failed');
      },
      removeProfile: async () => {},
      terminateProfileProcesses: () => {
        throw new Error('profile cleanup failed');
      },
    }),
    (error: unknown) => (
      error instanceof Error
      && 'code' in error
      && error.code === 'browser:owned-cleanup-failed'
    ),
  );

  assert.equal(unrefs, 1);
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
