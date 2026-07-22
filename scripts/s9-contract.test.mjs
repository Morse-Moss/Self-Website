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

test('S9 closeout remains recorded after the task center advances beyond S9', () => {
  const readme = readUtf8('README.md');
  const blueprint = readUtf8('docs/portfolio-blueprint.md');
  const runState = readUtf8('docs/task-center/run-state.md');
  const closeout = readUtf8('docs/verify/s9/s9-closeout.md');

  assert.equal(runState.match(/^## current_pointer$/gm)?.length, 1);
  const currentPointer = runState.match(
    /^## current_pointer\n\*\*([^*\n]+)\*\*$/m,
  )?.[1];
  assert.ok(currentPointer);
  assert.doesNotMatch(currentPointer, /^S9(?:\b|[- ])/);
  assert.ok(runState.includes('## S9 Morse portfolio closeout evidence(2026-07-15)'));
  assert.ok(readme.includes('S9 Morse 作品集重设计已完成并进入 `origin/master`'));
  assert.ok(blueprint.includes('## 14. S9 Morse 作品集重设计(2026-07-14)'));
  assert.ok(blueprint.includes('merge commit `1fb7e28`'));
  assert.ok(closeout.includes('`MAINLINE PASS · PUSHED · NOT DEPLOYED`'));
  assert.ok(closeout.includes('merge commit `1fb7e28`'));
  assert.ok(closeout.includes('远端 `master` 已包含 `1fb7e28`'));
  assert.ok(closeout.includes('未调用 Provider、未写数据库、未部署'));
  assert.ok(!closeout.includes('未 push、未 merge'));
});

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
    'ai-leadgen',
    'deep-research',
    'digital-morse',
    '1440',
    '900',
    '390',
    '844',
    'prefers-reduced-motion',
    'warp-tunnel-canvas',
    'data-capability-section',
    'data-capability-matrix',
    'data-capability-card',
    'capabilityCardCount',
    'capabilityLayoutValid',
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

test('S9 gallery count follows the canonical slug list', () => {
  const harness = readHarness();

  assert.match(harness, /buttons\.length === \$\{slugs\.length\}/);
  assert.match(
    harness,
    /document\.querySelectorAll\("\[data-project-slug\]"\)\.length === \$\{slugs\.length\}/,
  );
  assert.match(harness, /state\.cardCount === slugs\.length/);
  assert.doesNotMatch(harness, /=== 4/);
});

test('S9 gallery collapse checks ignore unrelated global disclosure buttons', () => {
  const harness = readHarness();
  const collapseStart = harness.indexOf('async function assertAllCollapsed');
  const collapseEnd = harness.indexOf('async function verifyExternalClickIsolation', collapseStart);

  assert.notEqual(collapseStart, -1, 'assertAllCollapsed must exist');
  assert.notEqual(collapseEnd, -1, 'assertAllCollapsed must end before external-link checks');
  const collapseCheck = harness.slice(collapseStart, collapseEnd);

  assert.match(
    collapseCheck,
    /document\.querySelectorAll\('\[data-project-slug\] button\[aria-expanded\]'\)/,
  );
  assert.doesNotMatch(
    collapseCheck,
    /document\.querySelectorAll\('button\[aria-expanded\]'\)/,
  );
});

test('S9 home hero fills the first viewport before the featured band begins', () => {
  const heroStyles = readUtf8('app/styles/hero.module.css');
  const harness = readHarness();
  const inspectHomeStart = harness.indexOf('async function inspectHome(client, viewport)');
  const inspectHomeEnd = harness.indexOf('async function inspectWorksShell', inspectHomeStart);

  assert.notEqual(inspectHomeStart, -1, 'inspectHome must exist');
  assert.notEqual(inspectHomeEnd, -1, 'inspectHome must end before inspectWorksShell');
  const inspectHome = harness.slice(inspectHomeStart, inspectHomeEnd);

  assert.match(
    heroStyles,
    /\.hero\s*\{[\s\S]*?min-height: calc\(100svh - var\(--topbar-h\)\);/,
  );
  assert.doesNotMatch(heroStyles, /min\(680px/);
  assert.doesNotMatch(
    heroStyles,
    /min-height:\s*calc\(100svh - var\(--topbar-h\) - var\(--space-9\)\)/,
  );
  assert.doesNotMatch(heroStyles, /align-items:\s*flex-start;/);
  assert.match(
    inspectHome,
    /nextBandBelowFold: Boolean\(featuredRect && featuredRect\.top >= innerHeight - 1\)/,
  );
  assert.match(
    inspectHome,
    /check\(state\.nextBandBelowFold, `\$\{viewportName\}:home:next-band-entered-first-viewport`\)/,
  );
  assert.doesNotMatch(inspectHome, /nextBandVisible|next-band-not-visible/);
});

test('S9 capability geometry validates both desktop rows and prevents vertical overlap', () => {
  const harness = readHarness();
  const inspectHomeStart = harness.indexOf('async function inspectHome(client, viewport)');
  const inspectHomeEnd = harness.indexOf('async function inspectWorksShell', inspectHomeStart);

  assert.notEqual(inspectHomeStart, -1, 'inspectHome must exist');
  assert.notEqual(inspectHomeEnd, -1, 'inspectHome must end before inspectWorksShell');
  const inspectHome = harness.slice(inspectHomeStart, inspectHomeEnd);

  for (const geometryContract of [
    /Math\.abs\(capabilityCardRects\[2\]\.top - capabilityCardRects\[3\]\.top\) <= capabilityTolerance/,
    /Math\.abs\(capabilityCardRects\[0\]\.left - capabilityCardRects\[2\]\.left\) <= capabilityTolerance/,
    /Math\.abs\(capabilityCardRects\[1\]\.right - capabilityCardRects\[3\]\.right\) <= capabilityTolerance/,
    /capabilityCardRects\[2\]\.right < capabilityCardRects\[3\]\.left/,
    /secondRowTop >= firstRowBottom - capabilityTolerance/,
    /capabilityCardRects\[4\]\.top >= secondRowBottom - capabilityTolerance/,
    /Math\.abs\(capabilityCardRects\[4\]\.left - capabilityMatrixRect\.left\) <= capabilityTolerance/,
    /Math\.abs\(capabilityCardRects\[4\]\.right - capabilityMatrixRect\.right\) <= capabilityTolerance/,
    /Math\.abs\(rect\.left - capabilityMatrixRect\.left\) <= capabilityTolerance/,
    /Math\.abs\(rect\.right - capabilityMatrixRect\.right\) <= capabilityTolerance/,
    /rect\.top >= capabilityCardRects\[index - 1\]\.bottom - capabilityTolerance/,
  ]) {
    assert.match(inspectHome, geometryContract);
  }
});

test('S9 screenshot evidence maps actual canonical directories through one recorder', () => {
  const harness = readHarness();
  const captureStart = harness.indexOf('async function captureScreenshot');
  const sampleStart = harness.indexOf('async function sampleCanvas', captureStart);
  const inspectHomeStart = harness.indexOf('async function inspectHome(client, viewport)');
  const inspectHomeEnd = harness.indexOf('async function inspectWorksShell', inspectHomeStart);

  assert.notEqual(captureStart, -1, 'captureScreenshot must exist');
  assert.notEqual(sampleStart, -1, 'capture helpers must end before sampleCanvas');
  const captureHelpers = harness.slice(captureStart, sampleStart);
  const inspectHome = harness.slice(inspectHomeStart, inspectHomeEnd);

  for (const mapping of [
    /capabilities: 'capability-matrix-desktop-1440\.png'/,
    /capabilities: 'capability-matrix-mobile-390\.png'/,
    /capabilities: 'capability-matrix-mobile-390-reduced\.png'/,
  ]) {
    assert.match(harness, mapping);
  }
  assert.match(
    inspectHome,
    /await captureElementScreenshot\(\s*client,\s*viewportName,\s*'capabilities',\s*'\[data-capability-section\]',\s*\);\s*const canvas = await sampleCanvas\(client\);/,
  );
  assert.match(harness, /const canonicalScreenshotPrefixByEvidenceDir = new Map\(/);
  assert.match(harness, /'docs\/verify\/s9'/);
  assert.match(harness, /'docs\/verify\/capability-matrix'/);
  assert.match(
    harness,
    /const SAFE_SCREENSHOT_FILE_NAMES = new Set\(\s*Object\.values\(screenshotFiles\)\.flatMap\(\(files\) => Object\.values\(files\)\),\s*\);/,
  );
  assert.match(
    harness,
    /const SAFE_SCREENSHOTS = new Set\(SAFE_SCREENSHOT_PREFIXES\.flatMap\(\(prefix\) => \(\s*\[\.\.\.SAFE_SCREENSHOT_FILE_NAMES\]\.map\(\(fileName\) => `\$\{prefix\}\/\$\{fileName\}`\)\s*\)\)\);/,
  );
  assert.match(harness, /function recordScreenshot\(fileName\)/);
  assert.match(harness, /canonicalScreenshotPrefixByEvidenceDir\.get\(evidenceDir\)/);
  assert.match(harness, /if \(!summaryPrefix\) return;/);
  assert.equal(
    captureHelpers.match(/recordScreenshot\(fileName\);/g)?.length,
    2,
    'both screenshot capture helpers must use the shared recorder',
  );
  assert.doesNotMatch(captureHelpers, /screenshotByName\.set/);
  assert.doesNotMatch(captureHelpers, /docs\/verify\/(?:s9|capability-matrix)\/\$\{fileName\}/);
});

test('S9 samples Canvas pixels from two bounded 160x90 CDP screenshot clips', () => {
  const harness = readHarness();
  const sampleStart = harness.indexOf('async function sampleCanvas(client)');
  const sampleEnd = harness.indexOf('async function inspectHome(client, viewport)', sampleStart);

  assert.notEqual(sampleStart, -1, 'sampleCanvas must exist');
  assert.notEqual(sampleEnd, -1, 'sampleCanvas must end before inspectHome');
  const sampleCanvas = harness.slice(sampleStart, sampleEnd);

  assert.match(harness, /const CANVAS_SAMPLE_WIDTH = 160;/);
  assert.match(harness, /const CANVAS_SAMPLE_HEIGHT = 90;/);
  assert.match(sampleCanvas, /canvas\.getBoundingClientRect\(\)/);
  assert.match(sampleCanvas, /Math\.min\(window\.innerWidth, rect\.right\)/);
  assert.match(sampleCanvas, /Math\.min\(window\.innerHeight, rect\.bottom\)/);
  assert.match(
    sampleCanvas,
    /visibleRight - visibleLeft < sampleWidth\s*\|\| visibleBottom - visibleTop < sampleHeight\s*\) return null;/,
  );
  assert.match(sampleCanvas, /x: window\.scrollX \+ visibleLeft,\s*y: window\.scrollY \+ visibleTop,/);
  assert.match(
    sampleCanvas,
    /client\.send\('Page\.captureScreenshot', \{\s*captureBeyondViewport: false,\s*clip: \{\s*x: sample\.x,\s*y: sample\.y,\s*width: CANVAS_SAMPLE_WIDTH,\s*height: CANVAS_SAMPLE_HEIGHT,\s*scale: 1,\s*\},\s*format: 'png',\s*fromSurface: true,\s*\}/,
    'sampleCanvas must capture the bounded 160x90 clip through CDP',
  );
  assert.match(
    sampleCanvas,
    /const firstScreenshot = await captureFrame\(\);\s*await delay\(360\);\s*const secondScreenshot = await captureFrame\(\);/,
  );
  assert.match(sampleCanvas, /`data:image\/png;base64,\$\{firstScreenshot\.data\}`/);
  assert.match(sampleCanvas, /`data:image\/png;base64,\$\{secondScreenshot\.data\}`/);
  assert.match(sampleCanvas, /await image\.decode\(\)/);
  assert.match(sampleCanvas, /context\.drawImage\(image, 0, 0, sampleWidth, sampleHeight\)/);
  assert.match(sampleCanvas, /context\.getImageData\(0, 0, sampleWidth, sampleHeight\)\.data/);
  assert.match(sampleCanvas, /const first = await decodePng\([^;]+firstDataUrl[^;]+\);/);
  assert.match(sampleCanvas, /const second = await decodePng\([^;]+secondDataUrl[^;]+\);/);
  assert.match(sampleCanvas, /const variance = first\.reduce\(/);
  assert.match(sampleCanvas, /Math\.abs\(value - second\[index\]\)/);
  assert.doesNotMatch(sampleCanvas, /drawImage\(canvas,/);
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

test('S9 supervisor stdout is one exact privacy-limited summary', () => {
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

test('S9 direct execution uses one IPC worker protocol and keeps cleanup in the supervisor lifetime', () => {
  const harness = readHarness();
  const helpers = readUtf8('scripts/lib/s9-cdp.mjs');

  assert.match(harness, /export async function runS9Supervisor/);
  assert.match(harness, /export async function runS9Worker/);
  assert.match(harness, /export function sendS9WorkerSummary/);
  assert.match(harness, /--s9-worker/);
  assert.match(harness, /stdio: \['ignore', 'ignore', 'ignore', 'ipc'\]/);
  assert.match(harness, /worker\.on\('message', handleMessage\)/);
  assert.match(harness, /processLike\.send\(safeSummary/);
  assert.match(harness, /terminateProfileProcesses\(profileDir, \{ platform \}\)/);
  assert.match(harness, /if \(supervisedProfileDir !== null\) return/);
  assert.match(harness, /await runS9Supervisor/);
  assert.doesNotMatch(
    harness,
    /if \(isDirectExecution\(import\.meta\.url, process\.argv\[1\]\)\) \{\s*await main\(\);\s*\}/,
  );
  assert.doesNotMatch(harness, /worker\.(?:stdout|stderr)|collectBoundedStream|JSON\.parse\(stdout\)/);
  for (const marker of [
    'terminateOwnedProfileProcesses',
    'S9_OWNED_PROFILE',
    'Get-CimInstance Win32_Process',
    '[StringComparison]::OrdinalIgnoreCase',
    "Buffer.from(script, 'utf16le')",
  ]) {
    assert.ok(helpers.includes(marker), `missing profile-scoped cleanup marker: ${marker}`);
  }
});

test('S9 supervisor shares one exact harness route allowlist across summary fields', () => {
  const harness = readHarness();

  assert.match(harness, /function isSafeHarnessRoute/);
  assert.match(harness, /isSafeHarnessRoute\(entry\.route\)/);
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

test('S9 owned profile cleanup uses bounded transient-lock retry', () => {
  const helpers = readUtf8('scripts/lib/s9-cdp.mjs');

  assert.match(helpers, /removeProfile = removeOwnedProfileWithRetry/);
  assert.match(helpers, /OWNED_PROFILE_CLEANUP_FAILED/);
  assert.match(helpers, /EPERM/);
  assert.match(helpers, /EBUSY/);
  assert.match(helpers, /ENOTEMPTY/);
});

test('S9 harness delegates network accounting without a broad navigation-abort exemption', () => {
  const harness = readHarness();
  const helpers = readUtf8('scripts/lib/s9-cdp.mjs');

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
  assert.doesNotMatch(harness, /S9_DEBUG_NETWORK|S9_NETWORK_DEBUG|S9_DEBUG_FAST_NAV|onDiagnostic/);
  assert.doesNotMatch(helpers, /onDiagnostic|documentUrl/);
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

test('S9 project clicks wait for the application final scroll before geometry acceptance', () => {
  const harness = readHarness();

  assert.match(harness, /installFinalProjectScrollProbe/);
  assert.match(harness, /__s9ProjectScrollProbe/);
  assert.match(harness, /article\.scrollIntoView = function scrollIntoView/);
  assert.match(harness, /probe\.calls \+= 1/);
  assert.match(harness, /await waitForFinalProjectScroll/);
  assert.match(harness, /finally \{\s*await removeFinalProjectScrollProbe/);
  assert.match(harness, /assertConsecutiveProjectScrollStable/);
  assert.match(harness, /Math\.max\(0, document\.documentElement\.scrollHeight/);
  assert.doesNotMatch(harness, /Math\.abs\(article\.getBoundingClientRect\(\)\.top - margin\) <= 12/);
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
