import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const scriptPath = path.resolve('scripts/admin-api-visual-smoke.mjs');
const packagePath = path.resolve('package.json');

test('admin API visual smoke owns a disposable loopback-only environment', () => {
  assert.ok(fs.existsSync(scriptPath), `missing expected file: ${scriptPath}`);
  const source = fs.readFileSync(scriptPath, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string> };

  assert.equal(manifest.scripts?.['visual:admin-api'], 'node scripts/admin-api-visual-smoke.mjs');
  assert.match(source, /createDisposablePostgresDatabase/u);
  assert.match(source, /scripts\/migrate-db\.mjs/u);
  assert.match(source, /scripts\/mock-openai\.mjs/u);
  assert.match(source, /MORSE_LOCAL_RELEASE_SMOKE/u);
  assert.match(source, /MORSE_PROVIDER_MOCK_ORIGIN/u);
  assert.match(source, /MORSE_PROVIDER_CONFIG_KEY/u);
  assert.match(source, /127\.0\.0\.1/u);
  assert.match(source, /3012/u);
  assert.doesNotMatch(source, /\.env\.production|OPENAI_API_KEY\s*\?\?|process\.env\.OPENAI_API_KEY/u);
});

test('admin API visual evidence uses a production build with the controlled test runtime', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');

  assert.match(source, /\.next['"], ['"]BUILD_ID/u);
  assert.match(source, /\[nextCli, 'start'/u);
  assert.match(source, /NODE_ENV: 'test'/u);
  assert.doesNotMatch(source, /\[nextCli, 'dev'/u);
  assert.doesNotMatch(source, /eval\(\) is not supported/u);
});

test('admin API visual smoke covers both breakpoints, errors, and cleanup', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');

  for (const viewport of ['1440', '900', '390', '844']) assert.match(source, new RegExp(viewport, 'u'));
  for (const scenario of ['discover-failure', 'manual-model', 'provider-test', 'route-activate', 'conflict', 'delete-result']) {
    assert.match(source, new RegExp(scenario, 'u'));
  }
  assert.match(source, /admin-api-desktop-1440x900\.png/u);
  assert.match(source, /admin-api-mobile-390x844\.png/u);
  assert.match(source, /admin-api-runtime-desktop-1440x900\.png/u);
  assert.match(source, /admin-api-runtime-mobile-390x844\.png/u);
  assert.match(source, /consoleErrors/u);
  assert.match(source, /externalOrigins/u);
  assert.match(source, /finally/u);
  assert.match(source, /terminateOwnedChild/u);
  assert.match(source, /database\.dispose/u);
});

test('admin API visual smoke renders six-target layers and fails closed on cleanup', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');

  for (const scenario of [
    'desktop:endpoint-host',
    'desktop:route-six',
    'desktop:layer-overflow',
    'mobile:endpoint-host',
    'mobile:route-six',
    'mobile:layer-overflow',
    'mobile:form-overflow',
    'mobile:dialog-overflow',
    'catalog-empty',
  ]) {
    assert.match(source, new RegExp(scenario, 'u'));
  }
  assert.match(source, /selectedTargetCount === 6/u);
  assert.match(source, /cleanupFailures/u);
  assert.match(source, /cleanup:child-still-running/u);
  assert.match(source, /cleanup:app-port-still-in-use/u);
  assert.match(source, /cleanup:mock-port-still-in-use/u);
  assert.doesNotMatch(source, /terminateOwnedChild\([^)]*\)\.catch\(\(\) => undefined\)/u);
});

test('admin API visual smoke proves mock-only Environment takeover across both widths', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');

  for (const scenario of [
    'takeover-save-no-provider',
    'takeover-latest-failure-retryable',
    'takeover-success-eligible',
    'takeover-replace-same-position',
    'provider-operation-budget-exact',
    'desktop:environment-overflow',
    'mobile:environment-overflow',
  ]) {
    assert.match(source, new RegExp(scenario, 'u'));
  }
  for (const screenshot of [
    'admin-api-environment-desktop-1440x900.png',
    'admin-api-takeover-form-desktop-1440x900.png',
    'admin-api-environment-mobile-390x844.png',
    'admin-api-takeover-form-mobile-390x844.png',
  ]) {
    assert.match(source, new RegExp(screenshot.replaceAll('.', '\\.'), 'u'));
  }
  assert.match(source, /OPENAI_API_KEY:\s*providerKey/u);
  assert.match(source, /MORSE_MOCK_OPENAI_SCENARIO/u);
  assert.match(source, /auth_failure/u);
  assert.match(source, /latestTest\?\.status === ['"]failed['"]/u);
  assert.match(source, /再次测试/u);
  assert.match(source, /expectedFailedModelTest/u);
  assert.match(source, /operations\.length === 3/u);
  assert.match(source, /provider_discover[\s\S]+failed[\s\S]+provider_test[\s\S]+succeeded[\s\S]+provider_test[\s\S]+failed/u);
});
