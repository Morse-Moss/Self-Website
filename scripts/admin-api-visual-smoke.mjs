#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { hashAdminPassword } from '../lib/server/admin-auth.ts';
import { createDisposablePostgresDatabase } from '../tests/postgres-test-utils.ts';
import {
  cleanupOwnedBrowser,
  connectCdpTransport,
  removeOwnedProfileWithRetry,
  terminateOwnedProcessTree,
  terminateOwnedProfileProcesses,
  waitForOwnedDevToolsActivePort,
} from './lib/s9-cdp.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const targetUrl = new URL(`http://127.0.0.1:${process.env.ADMIN_API_VISUAL_PORT || 3012}`);
const mockUrl = new URL('http://127.0.0.1:18092');
const migrationScript = 'scripts/migrate-db.mjs';
const mockScript = 'scripts/mock-openai.mjs';
const buildIdPath = path.join(repoRoot, '.next', 'BUILD_ID');
const evidenceDirectory = path.join(repoRoot, 'docs', 'verify', 'admin-api');
const viewports = Object.freeze([
  Object.freeze({ key: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ key: 'mobile', width: 390, height: 844 }),
]);
const timeoutMs = 30_000;
const takeoverConnectionName = 'Synthetic environment gateway';
const takeoverModelName = 'Mock environment takeover';
const expectedChecks = [
  'discover-failure',
  'manual-model',
  'provider-test',
  'route-activate',
  'conflict',
  'delete-result',
  'desktop:endpoint-host',
  'desktop:route-six',
  'desktop:layer-overflow',
  'mobile:endpoint-host',
  'mobile:route-six',
  'mobile:layer-overflow',
  'mobile:form-overflow',
  'mobile:dialog-overflow',
  'takeover-save-no-provider',
  'takeover-latest-failure-retryable',
  'takeover-success-eligible',
  'takeover-replace-same-position',
  'provider-operation-budget-exact',
  'desktop:environment-overflow',
  'mobile:environment-overflow',
  'catalog-empty',
  ...viewports.flatMap((viewport) => [`${viewport.key}:overflow`, `${viewport.key}:control-height`]),
];
let activeStage = 'init';

class HarnessError extends Error {
  constructor(code) {
    super(code);
    this.name = 'HarnessError';
    this.code = code;
  }
}

function check(value, code) {
  if (!value) throw new HarnessError(code);
}

function markStage(stage) {
  activeStage = stage;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function spawnOwned(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    detached: process.platform !== 'win32',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout?.resume();
  let stderrTail = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-8_000);
  });
  child.stderrTail = () => stderrTail;
  child.on('error', () => undefined);
  return child;
}

async function terminateOwnedChild(child) {
  if (!child || child.exitCode !== null) return;
  terminateOwnedProcessTree(child, { platform: process.platform });
  const deadline = Date.now() + 10_000;
  while (child.exitCode === null && Date.now() < deadline) await delay(50);
  if (child.exitCode === null) throw new HarnessError('cleanup:child-still-running');
}

async function assertPortFree(url, code) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });
    if (response) throw new HarnessError(code);
  } catch (error) {
    if (error instanceof HarnessError) throw error;
  }
}

async function waitForPortFree(url, code) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await assertPortFree(url, code);
      return;
    } catch (error) {
      if (!(error instanceof HarnessError)) throw error;
    }
    await delay(100);
  }
  throw new HarnessError(code);
}

async function waitForHttp(url, child, code) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      if (process.env.ADMIN_API_VISUAL_DEBUG === 'true') {
        console.error(String(child.stderrTail?.() ?? '').replaceAll(/postgresql:\/\/[^\s]+/gu, '[redacted-database-url]'));
      }
      throw new HarnessError(`${code}:process-exited`);
    }
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return;
    } catch {
      // The bounded readiness loop owns retries.
    }
    await delay(100);
  }
  throw new HarnessError(code);
}

async function runNodeScript(relativePath, env) {
  const child = spawnOwned(process.execPath, [path.join(repoRoot, relativePath)], {
    env: { ...process.env, ...env },
  });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  if (code !== 0) throw new HarnessError(`setup:${path.basename(relativePath)}-failed`);
}

function startMock(apiKey, scenario = 'success') {
  return spawnOwned(process.execPath, [path.join(repoRoot, mockScript)], {
    env: {
      ...process.env,
      MORSE_MOCK_OPENAI_PORT: mockUrl.port,
      MORSE_MOCK_OPENAI_API_KEY: apiKey,
      MORSE_MOCK_OPENAI_SCENARIO: scenario,
    },
  });
}

async function launchEdge() {
  const edgePath = process.env.ADMIN_API_EDGE_PATH
    || process.env.S9_EDGE_PATH
    || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  check(existsSync(edgePath), 'browser:edge-missing');
  const profileDir = mkdtempSync(path.join(os.tmpdir(), 'revolution-s9-edge-admin-api-'));
  const startedAtMs = Date.now();
  const browserProcess = spawn(edgePath, [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { detached: process.platform !== 'win32', stdio: 'ignore', windowsHide: true });
  browserProcess.on('error', () => undefined);
  const endpoint = await waitForOwnedDevToolsActivePort({
    fsApi: { readFileSync, statSync },
    isProcessExited: () => browserProcess.exitCode !== null,
    profileDir,
    startedAtMs,
    timeoutMs: 10_000,
  });
  return { browserProcess, profileDir, ...endpoint };
}

async function cleanupBrowser(browser) {
  if (!browser) return;
  try {
    await cleanupOwnedBrowser(browser);
  } catch (initialError) {
    try {
      await terminateOwnedProfileProcesses(browser.profileDir);
      browser.browserProcess?.unref?.();
      await removeOwnedProfileWithRetry(browser.profileDir);
    } catch (fallbackError) {
      if (process.env.ADMIN_API_VISUAL_DEBUG === 'true') {
        console.error(`browser-cleanup:${initialError?.code ?? initialError?.message ?? 'unknown'}:${fallbackError?.code ?? fallbackError?.message ?? 'unknown'}`);
      }
      throw fallbackError;
    }
  }
}

async function openPage(browser) {
  const response = await fetch(`${browser.cdpBase}/json/new?about:blank`, {
    method: 'PUT',
    signal: AbortSignal.timeout(10_000),
  });
  check(response.ok, 'cdp:new-tab-failed');
  const tab = await response.json();
  const errors = { console: [], page: [], external: new Set() };
  let expectedFailedModelTest = false;
  const expectedLogError = (entry) => {
    let url;
    try {
      url = new URL(entry.url);
    } catch {
      return false;
    }
    const text = String(entry.text ?? '');
    if (url.origin !== targetUrl.origin) return false;
    if (url.pathname === '/api/admin/session' && text.includes('401 (Unauthorized)')) return true;
    if (/^\/api\/admin\/providers\/[0-9a-f-]{36}\/discover$/u.test(url.pathname)
      && text.includes('400 (Bad Request)')) return true;
    if (expectedFailedModelTest
      && /^\/api\/admin\/providers\/models\/[0-9a-f-]{36}\/test$/u.test(url.pathname)
      && text.includes('400 (Bad Request)')) return true;
    return url.pathname === '/api/admin/providers/routes/activate' && text.includes('409 (Conflict)');
  };
  const transport = await connectCdpTransport(tab.webSocketDebuggerUrl, {
    commandTimeoutMs: timeoutMs,
    connectTimeoutMs: 10_000,
    onEvent(message) {
      if (message.method === 'Runtime.exceptionThrown') errors.page.push('page-error');
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        const text = message.params.args?.map((item) => item.value ?? item.description ?? '').join(' ') ?? '';
        errors.console.push({ kind: 'console', text: text.slice(0, 500) });
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        if (!expectedLogError(message.params.entry)) {
          errors.console.push({
            kind: 'log',
            text: String(message.params.entry.text ?? '').slice(0, 500),
            url: message.params.entry.url ?? '',
          });
        }
      }
      if (message.method === 'Network.requestWillBeSent') {
        try {
          const url = new URL(message.params.request.url);
          if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.origin !== targetUrl.origin) {
            errors.external.add(url.origin);
          }
        } catch {
          // Browser-internal URLs are outside the network contract.
        }
      }
    },
  });
  const page = {
    errors,
    dispose: transport.dispose,
    send(method, params = {}) { return transport.send(method, params); },
    setExpectedFailedModelTest(value) { expectedFailedModelTest = value; },
    async evaluate(expression) {
      const result = await transport.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails || result.result?.subtype === 'error') {
        throw new HarnessError('cdp:evaluate-failed');
      }
      return result.result?.value;
    },
  };
  await Promise.all([
    page.send('Page.enable'),
    page.send('Runtime.enable'),
    page.send('Network.enable'),
    page.send('Log.enable'),
    page.send('DOM.enable'),
  ]);
  return page;
}

async function setViewport(page, viewport) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.key === 'mobile',
  });
  await page.send('Emulation.setTouchEmulationEnabled', viewport.key === 'mobile'
    ? { enabled: true, maxTouchPoints: 1 }
    : { enabled: false });
}

async function waitFor(page, expression, code, waitMs = timeoutMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(`Boolean(${expression})`)) return;
    await delay(75);
  }
  if (process.env.ADMIN_API_VISUAL_DEBUG === 'true') {
    const snapshot = await page.evaluate(`({
      path: location.pathname,
      text: document.body.innerText.slice(-3000),
    })`);
    console.error(JSON.stringify(snapshot, null, 2));
  }
  throw new HarnessError(code);
}

async function navigate(page, pathname) {
  await page.send('Page.navigate', { url: new URL(pathname, targetUrl).href });
  await waitFor(page, 'document.readyState === "complete"', `navigate:${pathname}`);
}

async function setValue(page, selector, value) {
  const changed = await page.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return false;
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  check(changed, `input:${selector}`);
}

async function click(page, selector) {
  const clicked = await page.evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLElement) || target.getClientRects().length === 0) return false;
    target.click();
    return true;
  })()`);
  check(clicked, `click:${selector}`);
}

async function clickText(page, selector, text) {
  const clicked = await page.evaluate(`(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((item) => item instanceof HTMLElement && item.getClientRects().length > 0
        && item.textContent?.trim().includes(${JSON.stringify(text)}));
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  })()`);
  check(clicked, `click-text:${text}`);
}

async function reauthenticate(page, password) {
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-reauth-dialog"]\')', 'reauth:open');
  await setValue(page, 'input[name="adminPassword"]', password);
  await click(page, '[data-testid="admin-reauth-confirm"]');
}

async function login(page, password) {
  await navigate(page, '/admin/api');
  await waitFor(
    page,
    'document.querySelector(\'[data-testid="admin-login-form"]\') || document.querySelector(\'[data-testid="admin-api-console"]\')',
    'admin:boot',
  );
  if (await page.evaluate('Boolean(document.querySelector(\'[data-testid="admin-login-form"]\'))')) {
    await setValue(page, '[data-testid="admin-login-form"] input[name="password"]', password);
    await click(page, '[data-testid="admin-login-form"] button[type="submit"]');
  }
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')', 'admin:login');
}

async function selectConnection(page, displayName) {
  await waitFor(
    page,
    `[...document.querySelectorAll('[aria-label="中转列表"] button')].some((item) => item.textContent?.includes(${JSON.stringify(displayName)}))`,
    `connection:${displayName}:available`,
  );
  await clickText(page, '[aria-label="中转列表"] button', displayName);
  await waitFor(
    page,
    `document.querySelector('article[data-mobile-open] h2')?.textContent?.trim() === ${JSON.stringify(displayName)}`,
    `connection:${displayName}:selected`,
  );
}

async function prepareTakeoverForm(page) {
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')?.getAttribute(\'aria-busy\') === \'false\'', 'takeover:catalog-settled');
  await clickText(page, '[data-testid="environment-provider-primary"] button', '编辑');
  await waitFor(page, 'document.querySelector(\'input[name="connectionName"]\')', 'takeover:connection-step');
  await setValue(page, 'input[name="connectionName"]', takeoverConnectionName);
  const keyIsBlank = await page.evaluate('document.querySelector(\'input[name="apiKey"]\')?.value === \'\'');
  check(keyIsBlank, 'takeover:key-prefill-forbidden');
  await clickText(page, 'form button[type="submit"]', '下一步');
  await waitFor(page, 'document.querySelector(\'input[name="modelDisplayName"]\')', 'takeover:model-step');
  await setValue(page, 'input[name="modelDisplayName"]', takeoverModelName);
  await setValue(page, 'select', 'high');
  await setValue(page, 'input[name="maxOutputTokens"]', '1200');
}

async function savePreparedTakeover(page, password) {
  await clickText(page, 'form button[type="submit"]', '保存并复验密码');
  await reauthenticate(page, password);
  await waitFor(page, 'document.body.textContent?.includes(\'环境 Provider 已接管为数据库草稿\')', 'takeover:saved');
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')?.getAttribute(\'aria-busy\') === \'false\'', 'takeover:refreshed');
}

async function assertTakeoverSavedWithoutProvider(page, checks) {
  const events = await page.evaluate(`(async () => {
    const response = await fetch('/api/admin/providers/events?page=1&limit=100', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    return response.ok ? response.json() : null;
  })()`);
  check(events?.items?.some((event) => event.eventType === 'environment_takeover_created'), 'takeover:event-missing');
  check(
    events.items.every((event) => !['provider_test', 'environment_test'].includes(event.eventType)),
    'takeover-save-no-provider',
  );
  checks.add('takeover-save-no-provider');
}

async function assertProviderOperationBudget(page, checks) {
  const operations = await page.evaluate(`(async () => {
    const response = await fetch('/api/admin/providers/events?page=1&limit=100', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const events = await response.json();
    return events.items.filter((event) => [
      'provider_discover',
      'provider_test',
      'environment_test',
      'provider_operation_denied',
    ].includes(event.eventType)).reverse();
  })()`);
  const expected = [
    { eventType: 'provider_discover', resultCode: 'AI_CONFIG_TEST_FAILED', status: 'failed' },
    { eventType: 'provider_test', resultCode: 'AI_CONFIG_TEST_SUCCEEDED', status: 'succeeded' },
    { eventType: 'provider_test', resultCode: 'AI_CONFIG_TEST_FAILED', status: 'failed' },
  ];
  check(
    Array.isArray(operations) && operations.length === 3
      && operations.every((operation, index) => (
        operation.eventType === expected[index].eventType
        && operation.resultCode === expected[index].resultCode
        && operation.status === expected[index].status
      )),
    'provider-operation-budget-exact',
  );
  checks.add('provider-operation-budget-exact');
}

async function readProviderModel(page, displayName) {
  return page.evaluate(`(async () => {
    const response = await fetch('/api/admin/providers?page=1&limit=100&includeDeleted=false', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const catalog = await response.json();
    return catalog.items.flatMap((connection) => connection.models)
      .find((model) => model.displayName === ${JSON.stringify(displayName)}) ?? null;
  })()`);
}

async function waitForProviderModelState(page, displayName, expectedStatus, code) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const model = await readProviderModel(page, displayName);
    if (model?.testState?.latestTest?.status === expectedStatus) return model;
    await delay(75);
  }
  throw new HarnessError(code);
}

async function testTakeoverSuccess(page, password, checks) {
  await selectConnection(page, takeoverConnectionName);
  await clickModelAction(page, takeoverModelName, 'provider-model-test');
  await reauthenticate(page, password);
  await waitFor(page, 'document.body.textContent?.includes(\'测试通过，延迟\')', 'takeover:test-success');
  const model = await waitForProviderModelState(page, takeoverModelName, 'succeeded', 'takeover:success-state');
  check(model.testState.eligibility === 'eligible', 'takeover-success-eligible');
  checks.add('provider-test');
  checks.add('takeover-success-eligible');
}

async function testTakeoverFailure(page, password, checks) {
  await selectConnection(page, takeoverConnectionName);
  page.setExpectedFailedModelTest(true);
  try {
    await clickModelAction(page, takeoverModelName, 'provider-model-test');
    await reauthenticate(page, password);
    await waitFor(
      page,
      'document.querySelector(\'[data-testid="admin-reauth-dialog"] [role="alert"]\')?.textContent?.includes(\'中转测试未通过\')',
      'takeover:test-failure',
    );
    await delay(150);
  } finally {
    page.setExpectedFailedModelTest(false);
  }
  const model = await waitForProviderModelState(page, takeoverModelName, 'failed', 'takeover:failed-state');
  check(
    model.testState.eligibility === 'eligible' && model.testState.latestTest?.status === 'failed',
    'takeover:failed-state-invalid',
  );
  await clickText(page, '[data-testid="admin-reauth-dialog"] button', '取消');
  await navigate(page, '/admin/api');
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')?.getAttribute(\'aria-busy\') === \'false\'', 'takeover:failure-refresh');
  await selectConnection(page, takeoverConnectionName);
  const retryable = await page.evaluate(`(() => {
    const row = [...document.querySelectorAll('article')]
      .find((item) => item.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(takeoverModelName)});
    const button = row?.querySelector('[data-testid="provider-model-test"]');
    return button instanceof HTMLButtonElement && button.textContent?.trim() === '再次测试' && !button.disabled;
  })()`);
  check(retryable, 'takeover-latest-failure-retryable');
  checks.add('takeover-latest-failure-retryable');
}

async function readEffectiveRouteSnapshot(page) {
  return page.evaluate(`(async () => {
    const response = await fetch('/api/admin/providers/runtime', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const runtime = await response.json();
    const identities = runtime.targets.length > 0
      ? runtime.targets.map((target) => target.sourceType === 'database'
        ? 'database:' + target.databaseModelSeriesId + ':' + target.databaseModelVersionId
        : 'environment:' + target.environmentTargetKey)
      : runtime.environmentTargets.map((target) => 'environment:' + target.environmentTargetKey);
    return {
      activeRevision: runtime.activeRevision,
      identities,
      positions: runtime.targets.length > 0
        ? runtime.targets.map((target) => target.position)
        : runtime.environmentTargets.map((_target, index) => index),
      takeoverModelSeriesId: runtime.environmentTargets
        .find((target) => target.environmentTargetKey === 'primary')?.takeover?.modelSeriesId ?? null,
    };
  })()`);
}

async function replaceEnvironmentPrimary(page, password, checks) {
  const before = await readEffectiveRouteSnapshot(page);
  check(before?.takeoverModelSeriesId, 'takeover:replacement-model-missing');
  const replacedIndex = before.identities.indexOf('environment:primary');
  check(replacedIndex >= 0, 'takeover:primary-not-effective');
  await page.evaluate('document.querySelector(\'[data-testid="environment-provider-primary"]\')?.scrollIntoView({ block: \'center\' })');
  await clickText(page, '[data-testid="environment-provider-primary"] button', '替换并激活');
  await reauthenticate(page, password);
  await waitFor(page, '!document.querySelector(\'[data-testid="admin-reauth-dialog"]\')', 'takeover:replace-complete');
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')?.getAttribute(\'aria-busy\') === \'false\'', 'takeover:replace-refresh');
  const after = await readEffectiveRouteSnapshot(page);
  check(after?.activeRevision === before.activeRevision + 1, 'takeover:replace-revision');
  check(after.identities.length === before.identities.length, 'takeover:replace-length');
  check(
    after.identities[replacedIndex]?.startsWith(`database:${before.takeoverModelSeriesId}:`)
      && after.positions[replacedIndex] === replacedIndex,
    'takeover:replace-position',
  );
  check(
    before.identities.every((identity, index) => index === replacedIndex || after.identities[index] === identity),
    'takeover:replace-order',
  );
  checks.add('route-activate');
  checks.add('takeover-replace-same-position');
}

async function assertEnvironmentLayout(page, viewportKey, checks) {
  await page.evaluate('document.querySelector(\'[data-testid="environment-provider-primary"]\')?.closest(\'section\')?.scrollIntoView({ block: \'start\' })');
  await delay(150);
  const geometry = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-testid^="environment-provider-"]')]
      .filter((item) => item instanceof HTMLElement && item.getClientRects().length > 0);
    const buttons = rows.flatMap((row) => [...row.querySelectorAll('button')]);
    return {
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rowCount: rows.length,
      rowOverflow: rows.reduce((maximum, row) => Math.max(maximum, row.scrollWidth - row.clientWidth), 0),
      controlsInsideViewport: buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1;
      }),
    };
  })()`);
  check(
    geometry.rowCount === 3 && geometry.documentOverflow <= 1
      && geometry.rowOverflow <= 1 && geometry.controlsInsideViewport,
    `${viewportKey}:environment-overflow`,
  );
  checks.add(`${viewportKey}:environment-overflow`);
}

async function createProviderThroughUi(page, password, providerKey) {
  await click(page, '[data-testid="provider-create"]');
  await waitFor(page, 'document.querySelector(\'input[name="connectionName"]\')', 'create:connection-step');
  await setValue(page, 'input[name="connectionName"]', 'Synthetic gateway');
  await setValue(page, 'input[name="baseUrl"]', `${mockUrl.origin}/v1`);
  await setValue(page, 'input[name="apiKey"]', providerKey);
  await clickText(page, 'form button[type="submit"]', '下一步');
  await waitFor(page, 'document.querySelector(\'input[name="modelDisplayName"]\')', 'create:model-step');
  await setValue(page, 'input[name="modelDisplayName"]', 'Mock responses');
  await setValue(page, 'input[name="modelId"]', 'gpt-mock-responses-manual-entry-with-a-long-but-bounded-id');
  await setValue(page, 'input[name="maxOutputTokens"]', '256');
  await clickText(page, 'form button[type="submit"]', '保存并复验密码');
  await reauthenticate(page, password);
  await waitFor(page, '[...document.querySelectorAll(\'button\')].some((item) => item.textContent?.includes(\'Synthetic gateway\'))', 'create:complete');
}

async function addModelThroughUi(page, password, displayName, modelId) {
  const previousCount = await page.evaluate('document.querySelectorAll(\'[data-testid="provider-model-test"]\').length');
  await clickText(page, 'button', '新增模型');
  await waitFor(page, 'document.querySelector(\'input[name="modelDisplayName"]\')', `model:${displayName}:form`);
  await setValue(page, 'input[name="modelDisplayName"]', displayName);
  await setValue(page, 'input[name="modelId"]', modelId);
  await setValue(page, 'input[name="maxOutputTokens"]', '384');
  await clickText(page, 'form button[type="submit"]', '保存并复验密码');
  await reauthenticate(page, password);
  await waitFor(
    page,
    `document.querySelectorAll('[data-testid="provider-model-test"]').length === ${previousCount + 1}`,
    `model:${displayName}:saved`,
  );
}

async function discoverFailure(page, password) {
  await click(page, '[data-testid="provider-discover"]');
  await reauthenticate(page, password);
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-reauth-dialog"] [role="alert"]\')', 'discover:failure');
  await clickText(page, '[data-testid="admin-reauth-dialog"] button', '取消');
}

async function clickModelAction(page, displayName, testId) {
  const clicked = await page.evaluate(`(() => {
    const action = [...document.querySelectorAll(${JSON.stringify(`[data-testid="${testId}"]`)})]
      .find((button) => button.closest('article')?.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(displayName)});
    if (!(action instanceof HTMLElement) || action.getClientRects().length === 0) return false;
    action.click();
    return true;
  })()`);
  check(clicked, `model:${displayName}:${testId}`);
}

async function assertLayerLayout(page, selector, code) {
  const geometry = await page.evaluate(`(() => {
    const layer = document.querySelector(${JSON.stringify(selector)});
    if (!(layer instanceof HTMLElement) || layer.getClientRects().length === 0) return null;
    const rect = layer.getBoundingClientRect();
    return {
      horizontalOverflow: layer.scrollWidth - layer.clientWidth,
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
    };
  })()`);
  check(geometry, `${code}:missing`);
  check(geometry.horizontalOverflow <= 1 && geometry.left >= -1 && geometry.right <= geometry.viewportWidth + 1, code);
}

async function composeSixTargetDraft(page, viewportKey, checks) {
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')?.getAttribute(\'aria-busy\') === \'false\'', `${viewportKey}:catalog-settled`);
  await click(page, '[data-testid="route-editor-open"]');
  await waitFor(page, 'document.querySelector(\'[data-testid^="route-candidate-"]\')', `${viewportKey}:route-candidates`);
  let selectedTargetCount = await page.evaluate('document.querySelectorAll(\'ol li [aria-label^="移除"]\').length');
  for (let index = selectedTargetCount; index < 6; index += 1) {
    const before = selectedTargetCount;
    await click(page, '[data-testid^="route-candidate-"]');
    await waitFor(
      page,
      `document.querySelectorAll('ol li [aria-label^="移除"]').length === ${before + 1}`,
      `${viewportKey}:route-add-${index + 1}`,
    );
    selectedTargetCount = before + 1;
  }
  check(selectedTargetCount === 6, `${viewportKey}:route-six`);
  checks.add(`${viewportKey}:route-six`);
  await assertLayerLayout(page, '[role="dialog"]', `${viewportKey}:layer-overflow`);
  checks.add(`${viewportKey}:layer-overflow`);
}

async function closeLayer(page) {
  await clickText(page, '[role="dialog"] button', '← 返回');
  await waitFor(page, '!document.querySelector(\'[role="dialog"]\')', 'layer:closed');
}

async function causeConflict(page, password) {
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')?.getAttribute(\'aria-busy\') === \'false\'', 'conflict:catalog-settled');
  await click(page, '[data-testid="route-editor-open"]');
  await waitFor(page, 'document.querySelector(\'[aria-label^="下移"]:not(:disabled)\')', 'conflict:draft');
  await click(page, '[aria-label^="下移"]:not(:disabled)');
  const status = await page.evaluate(`(async () => {
    const runtime = await fetch('/api/admin/providers/runtime', { cache: 'no-store', credentials: 'same-origin' }).then((response) => response.json());
    const response = await fetch('/api/admin/providers/routes/activate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedActiveRevision: runtime.activeRevision,
        targets: [{ source: 'environment', environmentTargetKey: 'fallback-1' }],
        password: ${JSON.stringify(password)},
      }),
    });
    return response.status;
  })()`);
  check(status === 200, `conflict:concurrent-status-${status}`);
  await click(page, '[data-testid="route-activate"]');
  await reauthenticate(page, password);
  await waitFor(page, 'document.querySelector(\'[data-error-code="AI_CONFIG_CONFLICT"]\')', 'conflict:visible');
  await clickText(page, '[data-testid="admin-reauth-dialog"] button', '取消');
  await clickText(page, 'button', '← 返回');
  await clickText(page, '[data-error-code="AI_CONFIG_CONFLICT"] button', '刷新最新配置');
  await waitFor(page, '!document.querySelector(\'[data-error-code="AI_CONFIG_CONFLICT"]\')', 'conflict:refreshed');
}

async function deleteModelThroughUi(page, password, displayName) {
  await clickModelAction(page, displayName, 'provider-model-delete');
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-reauth-dialog"]\')', 'delete:reauth');
  await setValue(page, 'input[name="confirmationName"]', displayName);
  await setValue(page, 'input[name="adminPassword"]', password);
  await waitFor(page, '!document.querySelector(\'[data-testid="admin-reauth-confirm"]\')?.disabled', `delete:${displayName}:enabled`);
  await click(page, '[data-testid="admin-reauth-confirm"]');
  await waitFor(page, '!document.querySelector(\'[data-testid="admin-reauth-dialog"]\')', `delete:${displayName}:result`);
}

async function deleteUnreferencedModelThroughUi(page, password, displayName) {
  await clickModelAction(page, displayName, 'provider-model-delete');
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-reauth-dialog"]\')', `delete:${displayName}:reauth`);
  await setValue(page, 'input[name="confirmationName"]', displayName);
  await setValue(page, 'input[name="adminPassword"]', password);
  await waitFor(page, '!document.querySelector(\'[data-testid="admin-reauth-confirm"]\')?.disabled', `delete:${displayName}:enabled`);
  await click(page, '[data-testid="admin-reauth-confirm"]');
  await waitFor(page, '!document.querySelector(\'[data-testid="admin-reauth-dialog"]\')', `delete:${displayName}:complete`);
}

async function deleteConnectionThroughUi(page, password, displayName, expectCatalogEmpty = false) {
  await clickText(page, 'button', '删除中转');
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-reauth-dialog"]\')', 'delete:connection:reauth');
  await setValue(page, 'input[name="confirmationName"]', displayName);
  await setValue(page, 'input[name="adminPassword"]', password);
  await waitFor(page, '!document.querySelector(\'[data-testid="admin-reauth-confirm"]\')?.disabled', `delete:${displayName}:connection-enabled`);
  await click(page, '[data-testid="admin-reauth-confirm"]');
  await waitFor(
    page,
    expectCatalogEmpty
      ? 'document.querySelector(\'[data-testid="admin-api-console"]\')?.getAttribute(\'data-empty\') === \'true\''
      : `![...document.querySelectorAll('[aria-label="中转列表"] button')].some((item) => item.textContent?.includes(${JSON.stringify(displayName)}))`,
    expectCatalogEmpty ? 'catalog-empty' : `delete:${displayName}:connection`,
  );
}

async function assertLayout(page, viewport, checks) {
  const geometry = await page.evaluate(`(() => {
    const controls = [...document.querySelectorAll('button, a[href], input:not([type="checkbox"]):not([type="radio"]), select')]
      .filter((item) => item instanceof HTMLElement && item.getClientRects().length > 0 && getComputedStyle(item).opacity !== '0')
      .map((item) => item.getBoundingClientRect().height);
    return {
      activeEndpointHost: document.querySelector('[data-testid="active-endpoint-host"]')?.textContent?.trim() ?? '',
      routeEndpointHosts: [...document.querySelectorAll('[data-testid="route-endpoint-host"]')]
        .map((item) => item.textContent?.trim() ?? ''),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      minimumControlHeight: controls.length ? Math.min(...controls) : 0,
    };
  })()`);
  check(
    geometry.activeEndpointHost === mockUrl.host
      && geometry.routeEndpointHosts.length >= 3
      && geometry.routeEndpointHosts.every((host) => host === mockUrl.host),
    `${viewport.key}:endpoint-host`,
  );
  check(geometry.overflow <= 1, `${viewport.key}:overflow`);
  check(geometry.minimumControlHeight >= 43.5, `${viewport.key}:control-height`);
  checks.add(`${viewport.key}:endpoint-host`);
  checks.add(`${viewport.key}:overflow`);
  checks.add(`${viewport.key}:control-height`);
}

async function capture(page, filename) {
  await page.send('Page.bringToFront');
  await delay(200);
  const result = await page.send('Page.captureScreenshot', { format: 'png' });
  const output = path.join(evidenceDirectory, filename);
  writeFileSync(output, Buffer.from(result.data, 'base64'));
  return path.relative(repoRoot, output).replaceAll('\\', '/');
}

function summary({ checks = [], failures = [], screenshots = [], errors = {} }) {
  const uniqueChecks = [...new Set(checks)].sort();
  const missing = expectedChecks.filter((item) => !uniqueChecks.includes(item));
  const allFailures = [...new Set([...failures, ...missing.map((item) => `missing:${item}`)])].sort();
  const consoleErrors = errors.console?.length ?? 0;
  const pageErrors = errors.page?.length ?? 0;
  const externalOrigins = errors.external?.size ?? 0;
  return {
    kind: 'ADMIN_API_LOCAL_E2E',
    evidence: 'loopback-synthetic',
    passed: allFailures.length === 0 && consoleErrors === 0 && pageErrors === 0 && externalOrigins === 0,
    checks: uniqueChecks,
    failures: allFailures,
    consoleErrors,
    pageErrors,
    externalOrigins,
    screenshots,
    viewports: ['1440x900', '390x844'],
  };
}

export async function runAdminApiVisualSmoke() {
  const checks = new Set();
  const screenshots = [];
  let runFailure = null;
  let database;
  let app;
  let mock;
  let browser;
  let page;
  try {
    markStage('setup:production-build');
    check(existsSync(buildIdPath), 'setup:production-build-missing');
    markStage('setup:ports');
    await assertPortFree(targetUrl, 'setup:app-port-in-use');
    await assertPortFree(mockUrl, 'setup:mock-port-in-use');
    mkdirSync(evidenceDirectory, { recursive: true });

    markStage('setup:database');
    database = await createDisposablePostgresDatabase();
    await runNodeScript(migrationScript, { DATABASE_URL: database.connectionString, NODE_ENV: 'test' });

    const adminPassword = `Synthetic-${randomBytes(18).toString('base64url')}`;
    const providerKey = `Provider-${randomBytes(18).toString('base64url')}`;
    const appEnv = {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_ENV: 'test',
      PORT: targetUrl.port,
      DATABASE_URL: database.connectionString,
      MORSE_DATABASE_SSL_MODE: 'disable',
      MORSE_PUBLIC_ORIGIN: targetUrl.origin,
      MORSE_ADMIN_ALLOWED_ORIGIN: targetUrl.origin,
      MORSE_ADMIN_PASSWORD_HASH: await hashAdminPassword(adminPassword),
      MORSE_ADMIN_SESSION_MINUTES: '30',
      MORSE_ADMIN_MAX_FAILED_ATTEMPTS: '5',
      MORSE_ADMIN_LOCK_MINUTES: '15',
      MORSE_PROVIDER_CONFIG_KEY: randomBytes(32).toString('base64'),
      MORSE_PROVIDER_CONFIG_KEY_VERSION: '1',
      MORSE_LOCAL_RELEASE_SMOKE: 'true',
      MORSE_PROVIDER_MOCK_ORIGIN: mockUrl.origin,
      MORSE_CHAT_ENABLED: 'false',
      MORSE_SEARCH_ENABLED: 'false',
      OPENAI_API_KEY: providerKey,
      OPENAI_BASE_URL: `${mockUrl.origin}/v1`,
      OPENAI_FALLBACK_1_API_KEY: 'synthetic-environment-fallback-1',
      OPENAI_FALLBACK_1_BASE_URL: `${mockUrl.origin}/v1`,
      OPENAI_FALLBACK_2_API_KEY: 'synthetic-environment-fallback-2',
      OPENAI_FALLBACK_2_BASE_URL: `${mockUrl.origin}/v1`,
      OPENAI_CHAT_MODEL: 'gpt-mock-responses',
      OPENAI_CHAT_PROTOCOL: 'responses',
      OPENAI_EMBEDDING_API_KEY: 'synthetic-disabled-embedding',
      OPENAI_EMBEDDING_BASE_URL: `${mockUrl.origin}/v1`,
      OPENAI_EMBEDDING_MODEL: 'synthetic-disabled-embedding',
    };

    markStage('setup:mock');
    mock = startMock(providerKey);
    await waitForHttp(new URL('/v1/models', mockUrl), mock, 'setup:mock-ready');
    markStage('setup:app');
    const nextCli = require.resolve('next/dist/bin/next');
    app = spawnOwned(process.execPath, [nextCli, 'start', '--hostname', '127.0.0.1', '--port', targetUrl.port], { env: appEnv });
    await waitForHttp(new URL('/api/health/live', targetUrl), app, 'setup:app-ready');

    markStage('setup:browser');
    browser = await launchEdge();
    page = await openPage(browser);
    await setViewport(page, viewports[0]);
    await login(page, adminPassword);

    markStage('desktop:takeover-form');
    await prepareTakeoverForm(page);
    await assertLayerLayout(page, '.formLayer, [role="dialog"]', 'desktop:takeover-form-overflow');
    screenshots.push(await capture(page, 'admin-api-takeover-form-desktop-1440x900.png'));
    await closeLayer(page);

    markStage('mobile:takeover-form');
    await setViewport(page, viewports[1]);
    await navigate(page, '/admin/api');
    await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')', 'mobile:takeover-ready');
    await prepareTakeoverForm(page);
    await assertLayerLayout(page, '.formLayer, [role="dialog"]', 'mobile:form-overflow');
    checks.add('mobile:form-overflow');
    screenshots.push(await capture(page, 'admin-api-takeover-form-mobile-390x844.png'));
    await savePreparedTakeover(page, adminPassword);
    await assertTakeoverSavedWithoutProvider(page, checks);

    markStage('desktop:create');
    await setViewport(page, viewports[0]);
    await navigate(page, '/admin/api');
    await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')', 'desktop:create-ready');
    await createProviderThroughUi(page, adminPassword, providerKey);
    checks.add('manual-model');
    await selectConnection(page, 'Synthetic gateway');
    markStage('desktop:discover-failure');
    await terminateOwnedChild(mock);
    mock = null;
    await discoverFailure(page, adminPassword);
    checks.add('discover-failure');
    mock = startMock(providerKey);
    await waitForHttp(new URL('/v1/models', mockUrl), mock, 'setup:mock-restart');
    markStage('desktop:manual-models');
    await addModelThroughUi(page, adminPassword, 'Mock compact', 'gpt-mock-compact-manual-fallback');
    await addModelThroughUi(page, adminPassword, 'Mock durable', 'gpt-mock-durable-manual-fallback');

    markStage('desktop:takeover-test-success');
    await testTakeoverSuccess(page, adminPassword, checks);
    await terminateOwnedChild(mock);
    mock = null;
    await waitForPortFree(mockUrl, 'takeover:mock-success-still-running');
    mock = startMock(providerKey, 'auth_failure');
    await waitForHttp(new URL('/v1/models', mockUrl), mock, 'takeover:failure-mock-ready');
    markStage('desktop:takeover-test-failure');
    await testTakeoverFailure(page, adminPassword, checks);

    markStage('desktop:environment-evidence');
    await setViewport(page, viewports[0]);
    await navigate(page, '/admin/api');
    await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')?.getAttribute(\'aria-busy\') === \'false\'', 'desktop:environment-ready');
    await assertEnvironmentLayout(page, 'desktop', checks);
    screenshots.push(await capture(page, 'admin-api-environment-desktop-1440x900.png'));

    markStage('mobile:environment-evidence');
    await setViewport(page, viewports[1]);
    await navigate(page, '/admin/api');
    await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')?.getAttribute(\'aria-busy\') === \'false\'', 'mobile:environment-ready');
    await assertEnvironmentLayout(page, 'mobile', checks);
    screenshots.push(await capture(page, 'admin-api-environment-mobile-390x844.png'));

    markStage('desktop:route-six');
    await setViewport(page, viewports[0]);
    await navigate(page, '/admin/api');
    await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')?.getAttribute(\'aria-busy\') === \'false\'', 'desktop:route-ready');
    await assertLayout(page, viewports[0], checks);
    screenshots.push(await capture(page, 'admin-api-runtime-desktop-1440x900.png'));
    await composeSixTargetDraft(page, 'desktop', checks);
    screenshots.push(await capture(page, 'admin-api-desktop-1440x900.png'));
    await closeLayer(page);

    markStage('mobile:route-six');
    await setViewport(page, viewports[1]);
    await navigate(page, '/admin/api');
    await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')', 'mobile:ready');
    await assertLayout(page, viewports[1], checks);
    screenshots.push(await capture(page, 'admin-api-runtime-mobile-390x844.png'));
    await composeSixTargetDraft(page, 'mobile', checks);
    screenshots.push(await capture(page, 'admin-api-mobile-390x844.png'));
    await closeLayer(page);

    markStage('mobile:dialog-overflow');
    await selectConnection(page, 'Synthetic gateway');
    await clickModelAction(page, 'Mock responses', 'provider-model-test');
    await waitFor(page, 'document.querySelector(\'[data-testid="admin-reauth-dialog"]\')', 'mobile:dialog-open');
    await assertLayerLayout(page, '[data-testid="admin-reauth-dialog"]', 'mobile:dialog-overflow');
    checks.add('mobile:dialog-overflow');
    await clickText(page, '[data-testid="admin-reauth-dialog"] button', '取消');

    markStage('desktop:replace-environment');
    await setViewport(page, viewports[0]);
    await navigate(page, '/admin/api');
    await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')', 'desktop:return');
    await replaceEnvironmentPrimary(page, adminPassword, checks);

    markStage('desktop:conflict');
    await causeConflict(page, adminPassword);
    checks.add('conflict');
    await assertProviderOperationBudget(page, checks);
    markStage('desktop:delete');
    await selectConnection(page, 'Synthetic gateway');
    await deleteModelThroughUi(page, adminPassword, 'Mock responses');
    checks.add('delete-result');
    await deleteUnreferencedModelThroughUi(page, adminPassword, 'Mock compact');
    await deleteUnreferencedModelThroughUi(page, adminPassword, 'Mock durable');
    await deleteConnectionThroughUi(page, adminPassword, 'Synthetic gateway');
    await selectConnection(page, takeoverConnectionName);
    await deleteModelThroughUi(page, adminPassword, takeoverModelName);
    await deleteConnectionThroughUi(page, adminPassword, takeoverConnectionName, true);
    checks.add('catalog-empty');

    if (process.env.ADMIN_API_VISUAL_DEBUG === 'true' && page.errors.console.length > 0) {
      console.error(JSON.stringify(page.errors.console, null, 2));
    }
    return summary({ checks: [...checks], screenshots, errors: page.errors });
  } catch (error) {
    if (process.env.ADMIN_API_VISUAL_DEBUG === 'true') {
      console.error(String(app?.stderrTail?.() ?? '').replaceAll(/postgresql:\/\/[^\s]+/gu, '[redacted-database-url]'));
    }
    runFailure = error;
  } finally {
    const cleanupFailures = [];
    try {
      await cleanupBrowser(browser);
    } catch {
      cleanupFailures.push('cleanup:browser-failed');
    }
    try {
      await Promise.resolve(page?.dispose?.());
    } catch {
      cleanupFailures.push('cleanup:page-failed');
    }
    try {
      await terminateOwnedChild(app);
    } catch (error) {
      cleanupFailures.push(error instanceof HarnessError ? error.code : 'cleanup:app-failed');
    }
    try {
      await terminateOwnedChild(mock);
    } catch (error) {
      cleanupFailures.push(error instanceof HarnessError ? error.code : 'cleanup:mock-failed');
    }
    try {
      if (database) await database.dispose();
    } catch {
      cleanupFailures.push('cleanup:database-failed');
    }
    try {
      await waitForPortFree(targetUrl, 'cleanup:app-port-still-in-use');
    } catch (error) {
      cleanupFailures.push(error instanceof HarnessError ? error.code : 'cleanup:app-port-check-failed');
    }
    try {
      await waitForPortFree(mockUrl, 'cleanup:mock-port-still-in-use');
    } catch (error) {
      cleanupFailures.push(error instanceof HarnessError ? error.code : 'cleanup:mock-port-check-failed');
    }
    if (cleanupFailures.length > 0) {
      const primaryCode = runFailure instanceof HarnessError
        ? runFailure.code
        : runFailure ? `harness:unexpected:${activeStage}` : null;
      throw new HarnessError([...new Set([primaryCode, ...cleanupFailures].filter(Boolean))].join(','));
    }
  }
  if (runFailure) throw runFailure;
}

const direct = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direct) {
  runAdminApiVisualSmoke().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  }).catch((error) => {
    if (process.env.ADMIN_API_VISUAL_DEBUG === 'true') {
      console.error(String(error?.stack ?? error).replaceAll(/postgresql:\/\/[^\s]+/gu, '[redacted-database-url]'));
    }
    const code = error instanceof HarnessError ? error.code : `harness:unexpected:${activeStage}`;
    console.error(JSON.stringify(summary({ failures: [code] }), null, 2));
    process.exitCode = 1;
  });
}
