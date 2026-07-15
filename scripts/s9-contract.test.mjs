import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = new URL('../', import.meta.url);
const harnessUrl = new URL('scripts/s9-visual-smoke.mjs', repoRoot);

function readUtf8(relativePath) {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8').replaceAll('\r\n', '\n');
}

function readHarness() {
  assert.ok(existsSync(harnessUrl), 'scripts/s9-visual-smoke.mjs must exist');
  return readFileSync(harnessUrl, 'utf8').replaceAll('\r\n', '\n');
}

test('S9 exposes the exact production visual gate command without browser dependencies', () => {
  const packageJson = JSON.parse(readUtf8('package.json'));

  assert.equal(
    packageJson.scripts['visual:s9'],
    'node scripts/s9-visual-smoke.mjs http://127.0.0.1:3010',
  );
  for (const dependency of ['playwright', 'puppeteer', 'lighthouse']) {
    assert.equal(packageJson.dependencies?.[dependency], undefined);
    assert.equal(packageJson.devDependencies?.[dependency], undefined);
  }
});

test('S9 raw-CDP harness contains the complete route, viewport, and event contract', () => {
  const harness = readHarness();

  for (const marker of [
    "'/'",
    "'/works'",
    'content-agent',
    'auto-operations',
    'deep-research',
    'digital-morse',
    '1440',
    '900',
    '390',
    '844',
    'prefers-reduced-motion',
    'morse-signal-canvas',
    'data-project-slug',
    'aria-expanded',
    'horizontalOverflow',
    'canvasPixelVariance',
    'Runtime.consoleAPICalled',
    'Runtime.exceptionThrown',
    'Network.responseReceived',
  ]) {
    assert.ok(harness.includes(marker), `missing S9 harness marker: ${marker}`);
  }
});

test('S9 harness owns a bounded Edge process and mocks access without sensitive payload reads', () => {
  const harness = readHarness();
  const lifecycleSource = `${harness}\n${readUtf8('scripts/lib/s9-cdp.mjs')}`;

  for (const marker of [
    'remote-debugging-port',
    'user-data-dir',
    'mkdtempSync',
    'spawn',
    'AbortSignal.timeout',
    'Fetch.requestPaused',
    'Fetch.fulfillRequest',
    'Emulation.setDeviceMetricsOverride',
    'Emulation.setEmulatedMedia',
    'Page.captureScreenshot',
    'Page.close',
    'Browser.close',
    'rmSync',
  ]) {
    assert.ok(lifecycleSource.includes(marker), `missing bounded raw-CDP marker: ${marker}`);
  }

  assert.doesNotMatch(
    harness,
    /Network\.getResponseBody|Fetch\.getResponseBody|request\.postData|responseBody/,
  );
});

test('S9 reduced-motion gate rejects every active animation including finite durations', () => {
  const harness = readHarness();
  const helpers = readUtf8('scripts/lib/s9-cdp.mjs');

  assert.match(harness, /animationStates: document\.getAnimations\(\)/);
  assert.match(harness, /canvas\.runningAnimations = countRunningAnimations\(canvas\.animationStates\)/);
  assert.match(helpers, /animation\?\.playState === 'running'/);
  assert.match(harness, /check\(canvas\.runningAnimations === 0/);
  assert.doesNotMatch(harness, /runningInfiniteAnimations|iterations === Infinity/);
});

test('S9 harness stdout is one exact privacy-limited summary', () => {
  const harness = readHarness();
  const consoleLogs = harness.match(/consoleLike\.log\(/g) ?? [];

  assert.equal(consoleLogs.length, 1);
  assert.match(harness, /consoleLike\.log\(JSON\.stringify\(summary, null, 2\)\)/);
  assert.match(
    harness,
    /const summary = createS9Summary\(\{\s*failures,\s*screenshots,\s*routeStatuses,\s*canvasPixelVariance,\s*expandedSlugs,\s*horizontalOverflow,\s*consoleErrors,\s*pageErrors,\s*externalRuntimeRequests,\s*\}\);/,
  );
  assert.match(harness, /export async function main/);
  assert.match(harness, /if \(isDirectExecution\(import\.meta\.url, process\.argv\[1\]\)\)/);
});

test('S9 launcher cleans its owned process and profile when readiness fails', () => {
  const harness = readHarness();

  assert.match(harness, /onOwnedBrowser\(browserState\)/);
  assert.match(harness, /cleanupCoordinator\.run\('normal'\)/);
});

test('S9 browser discovery is owned by its exclusive profile without a released port race', () => {
  const harness = readHarness();

  assert.match(harness, /--remote-debugging-port=0/);
  assert.match(harness, /waitForOwnedDevToolsActivePort/);
  assert.doesNotMatch(harness, /createServer|reserveDebugPort|\/json\/version/);
});

test('S9 harness uses one tested transport and reentrant cleanup coordinator', () => {
  const harness = readHarness();

  for (const marker of [
    'connectCdpTransport',
    'cleanupOwnedBrowser',
    'createCleanupCoordinator',
    'installSignalCleanup',
  ]) {
    assert.ok(harness.includes(marker), `missing lifecycle helper: ${marker}`);
  }
  assert.doesNotMatch(harness, /function connectSocket|function createCommandClient/);
});

test('S9 harness delegates network accounting without a broad navigation-abort exemption', () => {
  const harness = readHarness();

  for (const marker of [
    'createNetworkMonitor',
    'Network.requestWillBeSent',
    'Network.responseReceived',
    'Network.loadingFailed',
    'Network.webSocketCreated',
    'networkMonitor.handle',
    'networkMonitor.snapshot',
  ]) {
    assert.ok(harness.includes(marker), `missing network monitor integration: ${marker}`);
  }
  assert.doesNotMatch(
    harness,
    /navigationInProgress|exactNavigationAbort|Failed to load resource: net::ERR_ABORTED/,
  );
});

test('S9 primary actions use verified CDP mouse and touch input', () => {
  const harness = readHarness();
  const inputSource = readUtf8('scripts/lib/s9-cdp.mjs');

  assert.match(harness, /dispatchPrimaryClick/);
  assert.match(harness, /cancelActivePageScroll/);
  assert.match(harness, /preventExternalNavigation/);
  assert.doesNotMatch(harness, /\.click\(\)/);
  for (const marker of [
    "type: 'mouseMoved'",
    "type: 'mousePressed'",
    "type: 'mouseReleased'",
    "type: 'touchStart'",
    "type: 'touchEnd'",
    'scrollIntoView',
    'elementFromPoint',
  ]) {
    assert.ok(inputSource.includes(marker), `missing verified input marker: ${marker}`);
  }
});

test('S9 transition checks wait for stale presence and bounded quiet frames', () => {
  const harness = readHarness();

  assert.match(harness, /assertConsecutiveAnimationFramesQuiet/);
  assert.match(harness, /waitForPointerTargetStable/);
  assert.match(harness, /Math\.abs\(current\.top - previous\.top\) < 0\.5/);
  assert.match(harness, /quietFrames >= 3/);
  assert.doesNotMatch(harness, /cardsAnimating/);
  assert.match(harness, /waitForStaleDetailsRemoved/);
  assert.match(harness, /\[data-project-details\]/);
  assert.match(harness, /a-b-c-b-timeout/);
  assert.doesNotMatch(harness, /delay\(35\)/);
  assert.doesNotMatch(harness, /delay\(700\)/);
});

test('S9 harness import is side-effect free', () => {
  const imported = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `await import(${JSON.stringify(harnessUrl.href)})`],
    {
      cwd: fileURLToPath(repoRoot),
      encoding: 'utf8',
      env: { ...process.env, S9_EDGE_PATH: 'Z:\\missing-edge.exe' },
      timeout: 30_000,
    },
  );

  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, '');
  assert.equal(imported.stderr, '');
});

test('S9 preflight failure emits one exact summary and one safe stderr code', () => {
  const failed = spawnSync(
    process.execPath,
    [fileURLToPath(harnessUrl), 'not-a-valid-url'],
    {
      cwd: fileURLToPath(repoRoot),
      encoding: 'utf8',
      env: { ...process.env, S9_EDGE_PATH: 'Z:\\missing-edge.exe' },
      timeout: 30_000,
    },
  );

  assert.equal(failed.status, 1);
  assert.equal(failed.stderr, 'S9_VISUAL_SMOKE_FAILED\n');
  const summary = JSON.parse(failed.stdout);
  assert.deepEqual(Object.keys(summary), [
    'failures',
    'screenshots',
    'routeStatuses',
    'canvasPixelVariance',
    'expandedSlugs',
    'horizontalOverflow',
    'consoleErrors',
    'pageErrors',
    'externalRuntimeRequests',
  ]);
  assert.deepEqual(summary.failures, ['harness:infrastructure:unexpected']);
  assert.doesNotMatch(failed.stdout + failed.stderr, /not-a-valid-url|missing-edge|Revolution|session|prompt/);
});
