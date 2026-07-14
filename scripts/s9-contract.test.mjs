import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

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
    assert.ok(harness.includes(marker), `missing bounded raw-CDP marker: ${marker}`);
  }

  assert.doesNotMatch(
    harness,
    /Network\.getResponseBody|Fetch\.getResponseBody|request\.postData|responseBody/,
  );
});

test('S9 harness stdout is one exact privacy-limited summary', () => {
  const harness = readHarness();
  const consoleLogs = harness.match(/console\.log\(/g) ?? [];

  assert.equal(consoleLogs.length, 1);
  assert.match(harness, /console\.log\(JSON\.stringify\(summary, null, 2\)\)/);
  assert.match(
    harness,
    /const summary = \{\s*failures,\s*screenshots,\s*routeStatuses,\s*canvasPixelVariance,\s*expandedSlugs,\s*horizontalOverflow,\s*consoleErrors,\s*pageErrors,\s*externalRuntimeRequests,\s*\};/,
  );
});

test('S9 launcher cleans its owned process and profile when readiness fails', () => {
  const harness = readHarness();

  assert.match(
    harness,
    /catch \(error\) \{\s*await stopBrowser\(browserState\);\s*throw error;\s*\}/,
  );
});
