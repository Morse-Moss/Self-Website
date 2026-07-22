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
const targetUrl = new URL('http://127.0.0.1:3012');
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
const expectedChecks = [
  'discover-failure',
  'manual-model',
  'provider-test',
  'route-activate',
  'conflict',
  'delete-result',
  'desktop:route-six',
  'desktop:layer-overflow',
  'mobile:route-six',
  'mobile:layer-overflow',
  'mobile:form-overflow',
  'mobile:dialog-overflow',
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

function startMock(apiKey) {
  return spawnOwned(process.execPath, [path.join(repoRoot, mockScript)], {
    env: {
      ...process.env,
      MORSE_MOCK_OPENAI_PORT: mockUrl.port,
      MORSE_MOCK_OPENAI_API_KEY: apiKey,
      MORSE_MOCK_OPENAI_SCENARIO: 'success',
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

async function testProviderThroughUi(page, password) {
  await clickModelAction(page, 'Mock responses', 'provider-model-test');
  await reauthenticate(page, password);
  await waitFor(page, 'document.body.textContent?.includes(\'测试通过，延迟\')', 'test:complete');
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
  for (let index = 0; index < 6; index += 1) {
    const before = await page.evaluate('document.querySelectorAll(\'[data-testid^="route-candidate-"]\').length');
    await click(page, '[data-testid^="route-candidate-"]');
    await waitFor(
      page,
      `document.querySelectorAll('[data-testid^="route-candidate-"]').length === ${before - 1}`,
      `${viewportKey}:route-add-${index + 1}`,
    );
  }
  const selectedTargetCount = await page.evaluate('document.querySelectorAll(\'ol li [aria-label^="移除"]\').length');
  check(selectedTargetCount === 6, `${viewportKey}:route-six`);
  checks.add(`${viewportKey}:route-six`);
  await assertLayerLayout(page, '[role="dialog"]', `${viewportKey}:layer-overflow`);
  checks.add(`${viewportKey}:layer-overflow`);
}

async function clickRouteCandidateText(page, text) {
  const clicked = await page.evaluate(`(() => {
    const candidate = [...document.querySelectorAll('[data-testid^="route-candidate-"]')]
      .find((button) => button.closest('li')?.textContent?.includes(${JSON.stringify(text)}));
    if (!(candidate instanceof HTMLElement) || candidate.getClientRects().length === 0) return false;
    candidate.click();
    return true;
  })()`);
  check(clicked, `route:candidate:${text}`);
}

async function closeLayer(page) {
  await clickText(page, '[role="dialog"] button', '← 返回');
  await waitFor(page, '!document.querySelector(\'[role="dialog"]\')', 'layer:closed');
}

async function activateRouteThroughUi(page, password) {
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')?.getAttribute(\'aria-busy\') === \'false\'', 'route:catalog-settled');
  await click(page, '[data-testid="route-editor-open"]');
  await waitFor(page, 'document.querySelector(\'[data-testid^="route-candidate-database:"]\')', 'route:candidates');
  await clickRouteCandidateText(page, 'Mock responses');
  await waitFor(page, '![...document.querySelectorAll(\'[data-testid^="route-candidate-database:"]\')].some((button) => button.closest(\'li\')?.textContent?.includes(\'Mock responses\'))', 'route:database-added');
  await click(page, '[data-testid="route-candidate-environment:fallback-1"]');
  await waitFor(page, '!document.querySelector(\'[data-testid="route-candidate-environment:fallback-1"]\')', 'route:fallback-1-added');
  await click(page, '[data-testid="route-candidate-environment:fallback-2"]');
  await waitFor(page, '!document.querySelector(\'[data-testid="route-candidate-environment:fallback-2"]\')', 'route:fallback-2-added');
  await click(page, '[data-testid="route-activate"]');
  await reauthenticate(page, password);
  await waitFor(page, 'document.body.textContent?.includes(\'路由 v1 已激活\')', 'route:activated');
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

async function deleteModelThroughUi(page, password) {
  await clickModelAction(page, 'Mock responses', 'provider-model-delete');
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-reauth-dialog"]\')', 'delete:reauth');
  await setValue(page, 'input[name="confirmationName"]', 'Mock responses');
  await setValue(page, 'input[name="adminPassword"]', password);
  await click(page, '[data-testid="admin-reauth-confirm"]');
  await waitFor(page, 'document.body.textContent?.includes(\'历史元数据保留\')', 'delete:result');
}

async function deleteUnreferencedModelThroughUi(page, password, displayName) {
  await clickModelAction(page, displayName, 'provider-model-delete');
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-reauth-dialog"]\')', `delete:${displayName}:reauth`);
  await setValue(page, 'input[name="confirmationName"]', displayName);
  await setValue(page, 'input[name="adminPassword"]', password);
  await click(page, '[data-testid="admin-reauth-confirm"]');
  await waitFor(page, '!document.querySelector(\'[data-testid="admin-reauth-dialog"]\')', `delete:${displayName}:complete`);
}

async function deleteConnectionThroughUi(page, password) {
  await clickText(page, 'button', '删除中转');
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-reauth-dialog"]\')', 'delete:connection:reauth');
  await setValue(page, 'input[name="confirmationName"]', 'Synthetic gateway');
  await setValue(page, 'input[name="adminPassword"]', password);
  await click(page, '[data-testid="admin-reauth-confirm"]');
  await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')?.getAttribute(\'data-empty\') === \'true\'', 'catalog-empty');
}

async function assertLayout(page, viewport, checks) {
  const geometry = await page.evaluate(`(() => {
    const controls = [...document.querySelectorAll('button, a[href], input:not([type="checkbox"]):not([type="radio"]), select')]
      .filter((item) => item instanceof HTMLElement && item.getClientRects().length > 0 && getComputedStyle(item).opacity !== '0')
      .map((item) => item.getBoundingClientRect().height);
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      minimumControlHeight: controls.length ? Math.min(...controls) : 0,
    };
  })()`);
  check(geometry.overflow <= 1, `${viewport.key}:overflow`);
  check(geometry.minimumControlHeight >= 43.5, `${viewport.key}:control-height`);
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
      OPENAI_API_KEY: 'synthetic-environment-primary',
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

    markStage('desktop:create');
    await createProviderThroughUi(page, adminPassword, providerKey);
    checks.add('manual-model');
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
    markStage('desktop:test');
    await testProviderThroughUi(page, adminPassword);
    checks.add('provider-test');
    await assertLayout(page, viewports[0], checks);
    markStage('desktop:route-six');
    await composeSixTargetDraft(page, 'desktop', checks);
    screenshots.push(await capture(page, 'admin-api-desktop-1440x900.png'));
    await closeLayer(page);

    markStage('mobile:route-six');
    await setViewport(page, viewports[1]);
    await navigate(page, '/admin/api');
    await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')', 'mobile:ready');
    await assertLayout(page, viewports[1], checks);
    await composeSixTargetDraft(page, 'mobile', checks);
    screenshots.push(await capture(page, 'admin-api-mobile-390x844.png'));
    await closeLayer(page);

    markStage('mobile:form-overflow');
    await clickText(page, '[aria-label="中转列表"] button', 'Synthetic gateway');
    await waitFor(page, 'document.querySelector(\'article[data-mobile-open="true"]\')', 'mobile:inspector');
    await clickText(page, 'button', '新增模型');
    await waitFor(page, 'document.querySelector(\'input[name="modelDisplayName"]\')', 'mobile:form-open');
    await assertLayerLayout(page, '.formLayer, [role="dialog"]', 'mobile:form-overflow');
    checks.add('mobile:form-overflow');
    await closeLayer(page);

    markStage('mobile:dialog-overflow');
    await clickModelAction(page, 'Mock responses', 'provider-model-test');
    await waitFor(page, 'document.querySelector(\'[data-testid="admin-reauth-dialog"]\')', 'mobile:dialog-open');
    await assertLayerLayout(page, '[data-testid="admin-reauth-dialog"]', 'mobile:dialog-overflow');
    checks.add('mobile:dialog-overflow');
    await clickText(page, '[data-testid="admin-reauth-dialog"] button', '取消');

    markStage('desktop:activate');
    await setViewport(page, viewports[0]);
    await navigate(page, '/admin/api');
    await waitFor(page, 'document.querySelector(\'[data-testid="admin-api-console"]\')', 'desktop:return');
    await activateRouteThroughUi(page, adminPassword);
    checks.add('route-activate');

    markStage('desktop:conflict');
    await causeConflict(page, adminPassword);
    checks.add('conflict');
    markStage('desktop:delete');
    await deleteModelThroughUi(page, adminPassword);
    checks.add('delete-result');
    await deleteUnreferencedModelThroughUi(page, adminPassword, 'Mock compact');
    await deleteUnreferencedModelThroughUi(page, adminPassword, 'Mock durable');
    await deleteConnectionThroughUi(page, adminPassword);
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
