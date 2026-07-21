#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { hashAdminPassword } from '../lib/server/admin-auth.ts';
import { hashSecret } from '../lib/server/security.ts';
import {
  createDisposablePostgresDatabase,
  withPostgresClient,
} from '../tests/postgres-test-utils.ts';
import { syntheticResumePdf } from '../tests/fixtures/synthetic-resume.ts';
import {
  cleanupOwnedBrowser,
  connectCdpTransport,
  dispatchPrimaryClick,
  removeOwnedProfileWithRetry,
  terminateOwnedProcessTree,
  terminateOwnedProfileProcesses,
  waitForOwnedDevToolsActivePort,
} from './lib/s9-cdp.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetUrl = validateLoopbackUrl(process.argv[2] || 'http://127.0.0.1:3010');
const viewports = Object.freeze([
  Object.freeze({ key: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ key: 'mobile', width: 390, height: 844 }),
]);
const scenarioNames = Object.freeze([
  'locked-entry',
  'invalid-code',
  'valid-redemption',
  'authorized-pdf-link',
  'logout',
  'expired-session',
  'revoked-session',
  'no-document',
  'admin-upload',
  'admin-invite-create',
  'admin-invite-revoke',
  'overflow',
  'control-height',
]);
const timeoutMs = 30_000;
let activeStage = 'init';

function markStage(value) {
  activeStage = value;
}

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

function validateLoopbackUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
    throw new HarnessError('target:loopback-http-required');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new HarnessError('target:origin-required');
  }
  return url;
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
  child.stderr?.resume();
  child.on('error', () => undefined);
  return child;
}

async function terminateOwnedChild(child) {
  if (!child || child.exitCode !== null) return;
  terminateOwnedProcessTree(child, { platform: process.platform });
}

async function runNodeScript(relativePath, env) {
  const child = spawnOwned(process.execPath, [path.join(repoRoot, relativePath)], {
    env: { ...process.env, ...env },
  });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  if (code !== 0) throw new HarnessError(`setup:${path.basename(relativePath)}-failed`);
}

async function runReleaseSmoke(env) {
  const npmCli = process.env.npm_execpath
    || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const command = process.platform === 'win32' ? process.execPath : 'npm';
  const args = process.platform === 'win32'
    ? [npmCli, 'run', 'release:smoke']
    : ['run', 'release:smoke'];
  check(process.platform !== 'win32' || existsSync(npmCli), 'setup:npm-cli-missing');
  const child = spawnOwned(command, args, {
    env: { ...process.env, ...env },
  });
  let stdout = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    stdout += chunk;
  });
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  }).catch(() => null);
  check(exit === 0, 'setup:release-smoke-failed');
  const result = stdout.trim().split(/\r?\n/u).at(-1);
  check(result === '{"ok":true}', 'setup:release-smoke-contract');
}

async function waitForHttp(url, child, code) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new HarnessError(`${code}:process-exited`);
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

async function launchEdge() {
  const edgePath = process.env.PRIVATE_RESUME_EDGE_PATH
    || process.env.S10_EDGE_PATH
    || process.env.S9_EDGE_PATH
    || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  check(existsSync(edgePath), 'browser:edge-missing');
  const profileDir = mkdtempSync(path.join(os.tmpdir(), 'revolution-private-resume-edge-'));
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
  } catch {
    await terminateOwnedProfileProcesses(browser.profileDir);
    browser.browserProcess?.unref?.();
    await removeOwnedProfileWithRetry(browser.profileDir);
  }
}

async function openTab(browser, viewport) {
  const response = await fetch(`${browser.cdpBase}/json/new?about:blank`, {
    method: 'PUT',
    signal: AbortSignal.timeout(10_000),
  });
  check(response.ok, 'cdp:new-tab-failed');
  const tab = await response.json();
  const errors = { console: [], page: [], external: new Set() };
  const expectedError = (entry) => {
    try {
      const url = new URL(entry.url);
      return url.origin === targetUrl.origin
        && ['/api/admin/session', '/api/resume/access', '/api/resume/file'].includes(url.pathname)
        && String(entry.text).includes('401');
    } catch {
      return false;
    }
  };
  const transport = await connectCdpTransport(tab.webSocketDebuggerUrl, {
    commandTimeoutMs: timeoutMs,
    connectTimeoutMs: 10_000,
    onEvent(message) {
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        errors.console.push('console-error');
      }
      if (message.method === 'Runtime.exceptionThrown') errors.page.push('page-error');
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        if (!expectedError(message.params.entry)) errors.console.push('log-error');
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
    viewport,
    errors,
    dispose: transport.dispose,
    send(method, params, commandTimeout) {
      return transport.send(method, params, commandTimeout);
    },
    async evaluate(expression, returnByValue = true) {
      const result = await transport.send('Runtime.evaluate', {
        expression,
        returnByValue,
        awaitPromise: true,
      });
      if (result.exceptionDetails || result.result?.subtype === 'error') {
        throw new HarnessError('cdp:evaluate-failed');
      }
      return returnByValue ? result.result?.value : result.result;
    },
  };
  await Promise.all([
    page.send('Page.enable'),
    page.send('Runtime.enable'),
    page.send('Log.enable'),
    page.send('Network.enable'),
    page.send('DOM.enable'),
  ]);
  const mobile = viewport.width < 640;
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile,
  });
  await page.send('Emulation.setTouchEmulationEnabled', mobile
    ? { enabled: true, maxTouchPoints: 1 }
    : { enabled: false });
  await page.send('Network.clearBrowserCookies');
  return page;
}

async function closeTab(page) {
  if (!page) return;
  try {
    await page.send('Page.close', {}, 2_000);
  } catch {
    // The page transport can close before Page.close replies.
  } finally {
    page.dispose();
  }
}

async function waitFor(page, expression, code, maximum = timeoutMs) {
  const deadline = Date.now() + maximum;
  while (Date.now() < deadline) {
    if (await page.evaluate(expression)) return;
    await delay(50);
  }
  throw new HarnessError(code);
}

async function navigate(page, route) {
  const url = new URL(route, targetUrl);
  await page.send('Page.bringToFront');
  await page.send('Page.navigate', { url: url.href });
  await waitFor(
    page,
    `document.readyState === 'complete' && location.pathname === ${JSON.stringify(url.pathname)}`,
    `navigation:${url.pathname}`,
  );
  await page.evaluate('document.fonts?.ready.then(() => true) ?? true');
}

async function click(page, selector) {
  await dispatchPrimaryClick(page, {
    pointerMode: page.viewport.width < 640 ? 'touch' : 'mouse',
    selector,
  });
}

async function clickExpression(page, expression, code) {
  const clicked = await page.evaluate(`(() => { const element = ${expression}; if (!(element instanceof HTMLElement)) return false; element.click(); return true; })()`);
  check(clicked, code);
}

async function setValue(page, selector, value) {
  const changed = await page.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) return false;
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  check(changed, `input:missing:${selector}`);
  await delay(50);
}

async function setFile(page, selector, filePath) {
  const result = await page.evaluate(`document.querySelector(${JSON.stringify(selector)})`, false);
  check(result?.objectId, 'input:file-missing');
  await page.send('DOM.setFileInputFiles', { files: [filePath], objectId: result.objectId });
}

async function capture(page, directory, name) {
  await page.send('Page.bringToFront');
  await delay(250);
  const result = await page.send('Page.captureScreenshot', { format: 'png' });
  const output = path.join(directory, name);
  writeFileSync(output, Buffer.from(result.data, 'base64'));
  return path.basename(output);
}

async function assertLayout(page, rootSelector, prefix, checks) {
  const geometry = await page.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)});
    if (!(root instanceof HTMLElement)) return null;
    const controls = [...root.querySelectorAll('button, input, a[href]')]
      .filter((item) => item instanceof HTMLElement && item.getClientRects().length > 0)
      .map((item) => item.getBoundingClientRect().height);
    const rect = root.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      left: rect.left,
      right: rect.right,
      minimumControlHeight: controls.length ? Math.min(...controls) : 0,
    };
  })()`);
  check(geometry, `${prefix}:root-missing`);
  check(geometry.overflow <= 1 && geometry.left >= -1 && geometry.right <= page.viewport.width + 1, `${prefix}:overflow`);
  check(geometry.minimumControlHeight >= 43.5, `${prefix}:control-height`);
  checks.add(`${page.viewport.key}:overflow`);
  checks.add(`${page.viewport.key}:control-height`);
}

async function seedResumeInvite(connectionString, note) {
  const id = randomUUID();
  const code = randomBytes(18).toString('base64url');
  await withPostgresClient(connectionString, (client) => client.query(
    `INSERT INTO resume_invites
      (id, code_hash, trusted_person_note, created_at, expires_at, created_by_admin_session)
     VALUES ($1, $2, $3, now(), now() + interval '7 days', $4)`,
    [id, hashSecret(code), note, randomUUID()],
  ));
  return { id, code };
}

async function resetCurrentResume(connectionString) {
  await withPostgresClient(connectionString, (client) => client.query(
    'UPDATE resume_documents SET is_current = false WHERE is_current = true',
  ));
}

async function expireSessionForCode(connectionString, code) {
  await withPostgresClient(connectionString, (client) => client.query(
    `UPDATE resume_sessions AS session
        SET created_at = now() - interval '2 hours',
            last_seen_at = now() - interval '2 hours',
            expires_at = now() - interval '1 hour'
       FROM resume_invites AS invite
      WHERE session.invite_id = invite.id AND invite.code_hash = $1`,
    [hashSecret(code)],
  ));
}

async function openResume(page) {
  await click(page, '[data-testid="resume-access-open"]');
  await waitFor(page, 'Boolean(document.querySelector(\'[role="dialog"]\'))', 'resume:dialog-open');
}

async function waitLocked(page) {
  await waitFor(page, 'Boolean(document.querySelector(\'[data-testid="resume-access-code"]\'))', 'resume:locked');
}

async function submitResumeCode(page, code) {
  await setValue(page, '[data-testid="resume-access-code"]', code);
  await clickExpression(
    page,
    `document.querySelector('[data-testid="resume-access-code"]')?.closest('form')?.querySelector('button[type="submit"]')`,
    'resume:submit-button',
  );
}

async function waitNoDocument(page) {
  await waitFor(page, `(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return Boolean(dialog) && !dialog.querySelector('[data-testid="resume-access-code"]')
      && !dialog.querySelector('a[href="/api/resume/file"]');
  })()`, 'resume:no-document');
}

async function waitReady(page) {
  await waitFor(page, 'Boolean(document.querySelector(\'a[href="/api/resume/file"]\'))', 'resume:ready');
}

async function logoutResume(page) {
  await clickExpression(
    page,
    `[...document.querySelectorAll('[role="dialog"] button:not([aria-label])')].at(-1)`,
    'resume:logout-button',
  );
  await waitLocked(page);
}

async function closeResumeDialog(page) {
  await click(page, '[role="dialog"] button[aria-label]');
  await waitFor(page, '!document.querySelector(\'[role="dialog"]\')', 'resume:dialog-close');
}

async function fileResponseContract(page, expectedStatus = 200) {
  const result = await page.evaluate(`fetch('/api/resume/file', { credentials: 'same-origin', cache: 'no-store' }).then(async (response) => {
    const value = {
      status: response.status,
      contentType: response.headers.get('content-type'),
      cacheControl: response.headers.get('cache-control'),
      nosniff: response.headers.get('x-content-type-options'),
      disposition: response.headers.get('content-disposition'),
    };
    await response.body?.cancel();
    return value;
  })`);
  check(result.status === expectedStatus, `resume:file-status-${expectedStatus}`);
  if (expectedStatus === 200) {
    check(result.contentType === 'application/pdf', 'resume:file-content-type');
    check(result.cacheControl?.includes('no-store'), 'resume:file-cache');
    check(result.nosniff === 'nosniff', 'resume:file-nosniff');
    check(result.disposition?.startsWith('inline;'), 'resume:file-disposition');
  }
  return result;
}

async function adminLogin(page, password) {
  await navigate(page, '/admin');
  await waitFor(page, `Boolean(document.querySelector('[data-testid="admin-login-form"]')) || Boolean(document.querySelector('[data-testid="admin-console"]'))`, 'admin:boot');
  if (await page.evaluate('Boolean(document.querySelector(\'[data-testid="admin-login-form"]\'))')) {
    await setValue(page, '[data-testid="admin-login-form"] input[name="password"]', password);
    await click(page, '[data-testid="admin-login-form"] button[type="submit"]');
    await waitFor(page, 'Boolean(document.querySelector(\'[data-testid="admin-console"]\'))', 'admin:login');
  }
}

async function openAdminResume(page) {
  await click(page, '[data-testid="admin-resume-open"]');
  await waitFor(page, 'Boolean(document.querySelector(\'#resume-panel-title\'))', 'admin:resume-open');
  await waitFor(page, `Boolean(document.querySelector('[role="dialog"] input[type="file"]'))`, 'admin:resume-loaded');
}

async function uploadResume(page, pdfPath, password) {
  await setFile(page, '[role="dialog"] input[type="file"]', pdfPath);
  await setValue(page, '[role="dialog"] form input[type="password"]', password);
  await click(page, '[role="dialog"] form button[type="submit"]');
  await waitFor(page, 'Boolean(document.querySelector(\'[role="dialog"] dl\'))', 'admin:upload');
}

async function openInviteSection(page) {
  await clickExpression(page, `document.querySelectorAll('[role="dialog"] nav button')[1]`, 'admin:invite-tab');
  await waitFor(page, `Boolean(document.querySelector('[role="dialog"] form input:not([type="password"]):not([readonly])'))`, 'admin:invite-form');
}

async function createAdminInvite(page, note, password) {
  await openInviteSection(page);
  await setValue(page, '[role="dialog"] form input:not([type="password"]):not([readonly])', note);
  await setValue(page, '[role="dialog"] form input[type="password"]', password);
  await click(page, '[role="dialog"] form button[type="submit"]');
  await waitFor(page, `Boolean(document.querySelector('[role="dialog"] input[readonly]'))`, 'admin:invite-created');
  const code = await page.evaluate(`document.querySelector('[role="dialog"] input[readonly]')?.value ?? ''`);
  check(/^[A-Za-z0-9_-]{24}$/u.test(code), 'admin:invite-code-invalid');
  return code;
}

async function closeAdminResume(page) {
  await click(page, '[role="dialog"] header button');
  await waitFor(page, '!document.querySelector(\'#resume-panel-title\')', 'admin:resume-close');
}

async function revokeAdminInvite(page, note, password) {
  await openInviteSection(page);
  const noteValue = JSON.stringify(note);
  await clickExpression(
    page,
    `[...document.querySelectorAll('[role="dialog"] li')].find((item) => item.querySelector('strong')?.textContent === ${noteValue})?.querySelector('button')`,
    'admin:revoke-open',
  );
  await waitFor(page, `Boolean([...document.querySelectorAll('[role="dialog"] li')].find((item) => item.querySelector('strong')?.textContent === ${noteValue})?.querySelector('input[type="password"]'))`, 'admin:revoke-password');
  const passwordSelector = `[role="dialog"] li input[type="password"]`;
  await setValue(page, passwordSelector, password);
  await clickExpression(
    page,
    `[...document.querySelectorAll('[role="dialog"] li')].find((item) => item.querySelector('strong')?.textContent === ${noteValue})?.querySelector('input[type="password"]')?.parentElement?.querySelector('button')`,
    'admin:revoke-confirm',
  );
  await waitFor(page, `(() => {
    const item = [...document.querySelectorAll('[role="dialog"] li')].find((candidate) => candidate.querySelector('strong')?.textContent === ${noteValue});
    return Boolean(item) && !item.querySelector('button') && !item.querySelector('input[type="password"]');
  })()`, 'admin:revoked');
}

async function runViewport({ page, viewport, connectionString, adminPassword, pdfPath, outputDirectory, checks, fileResponses }) {
  const prefix = viewport.key;
  markStage(`${prefix}:reset`);
  await resetCurrentResume(connectionString);

  markStage(`${prefix}:no-document`);
  await navigate(page, '/');
  await openResume(page);
  await waitNoDocument(page);
  await assertLayout(page, '[role="dialog"]', `${prefix}:no-document`, checks);
  checks.add(`${prefix}:no-document`);
  await closeResumeDialog(page);

  markStage(`${prefix}:admin-upload`);
  await adminLogin(page, adminPassword);
  await openAdminResume(page);
  await assertLayout(page, '[role="dialog"]', `${prefix}:admin-document`, checks);
  await uploadResume(page, pdfPath, adminPassword);
  checks.add(`${prefix}:admin-upload`);
  const activeNote = `${prefix}-active`;
  const activeCode = await createAdminInvite(page, activeNote, adminPassword);
  checks.add(`${prefix}:admin-invite-create`);
  await closeAdminResume(page);

  markStage(`${prefix}:locked:navigate`);
  await navigate(page, '/');
  markStage(`${prefix}:locked:open`);
  await openResume(page);
  await waitLocked(page);
  markStage(`${prefix}:locked:layout`);
  await assertLayout(page, '[role="dialog"]', `${prefix}:locked`, checks);
  checks.add(`${prefix}:locked-entry`);
  markStage(`${prefix}:locked:capture`);
  const screenshot = await capture(page, outputDirectory, `private-resume-${prefix}-locked.png`);
  markStage(`${prefix}:locked:invalid`);
  await submitResumeCode(page, 'INVALID_SYNTHETIC_CODE');
  await waitFor(page, 'Boolean(document.querySelector(\'[role="alert"]\'))', 'resume:invalid-code');
  checks.add(`${prefix}:invalid-code`);
  markStage(`${prefix}:locked:valid`);
  await submitResumeCode(page, activeCode);
  await waitReady(page);
  checks.add(`${prefix}:valid-redemption`);
  markStage(`${prefix}:ready:layout`);
  await assertLayout(page, '[role="dialog"]', `${prefix}:ready`, checks);
  markStage(`${prefix}:ready:file`);
  fileResponses.push({ viewport: prefix, ...await fileResponseContract(page, 200) });
  checks.add(`${prefix}:authorized-pdf-link`);

  markStage(`${prefix}:expire`);
  await expireSessionForCode(connectionString, activeCode);
  await navigate(page, '/');
  await openResume(page);
  await waitLocked(page);
  checks.add(`${prefix}:expired-session`);

  markStage(`${prefix}:logout`);
  const logoutInvite = await seedResumeInvite(connectionString, `${prefix}-logout`);
  await submitResumeCode(page, logoutInvite.code);
  await waitReady(page);
  await logoutResume(page);
  checks.add(`${prefix}:logout`);

  markStage(`${prefix}:revoke`);
  const revokeNote = `${prefix}-revoke`;
  await adminLogin(page, adminPassword);
  await openAdminResume(page);
  const revokeCode = await createAdminInvite(page, revokeNote, adminPassword);
  await closeAdminResume(page);
  await navigate(page, '/');
  await openResume(page);
  await waitLocked(page);
  await submitResumeCode(page, revokeCode);
  await waitReady(page);

  await adminLogin(page, adminPassword);
  await openAdminResume(page);
  await revokeAdminInvite(page, revokeNote, adminPassword);
  checks.add(`${prefix}:admin-invite-revoke`);
  await closeAdminResume(page);
  await navigate(page, '/');
  await openResume(page);
  await waitLocked(page);
  await fileResponseContract(page, 401);
  checks.add(`${prefix}:revoked-session`);

  return screenshot;
}

function expectedChecks() {
  return [
    'release:smoke',
    ...viewports.flatMap((viewport) => scenarioNames.map((scenario) => `${viewport.key}:${scenario}`)),
  ];
}

function summary({ checks = [], failures = [], screenshots = [], fileResponses = [], errorCounts = {} }) {
  const uniqueChecks = [...new Set(checks)].sort();
  const missing = expectedChecks().filter((item) => !uniqueChecks.includes(item));
  const allFailures = [...new Set([...failures, ...missing.map((item) => `missing:${item}`)])].sort();
  return {
    kind: 'PRIVATE_RESUME_LOCAL_E2E',
    evidence: 'loopback-synthetic',
    passed: allFailures.length === 0
      && (errorCounts.consoleErrors ?? 0) === 0
      && (errorCounts.pageErrors ?? 0) === 0
      && (errorCounts.externalOrigins ?? 0) === 0,
    checks: uniqueChecks,
    failures: allFailures,
    consoleErrors: errorCounts.consoleErrors ?? 0,
    pageErrors: errorCounts.pageErrors ?? 0,
    externalOrigins: errorCounts.externalOrigins ?? 0,
    screenshots: [...new Set(screenshots)].sort(),
    viewports: viewports.map(({ width, height }) => `${width}x${height}`),
    fileResponses,
  };
}

export async function runPrivateResumeVisualSmoke() {
  const checks = new Set();
  const screenshots = [];
  const fileResponses = [];
  const pages = [];
  let database;
  let app;
  let browser;
  let tempDirectory;
  const outputDirectory = process.env.PRIVATE_RESUME_EVIDENCE_DIR
    ? path.resolve(process.env.PRIVATE_RESUME_EVIDENCE_DIR)
    : mkdtempSync(path.join(os.tmpdir(), 'revolution-private-resume-evidence-'));
  mkdirSync(outputDirectory, { recursive: true });

  try {
    markStage('setup:build-check');
    check(existsSync(path.join(repoRoot, '.next', 'BUILD_ID')), 'setup:production-build-required');
    try {
      const response = await fetch(targetUrl, { signal: AbortSignal.timeout(500) });
      if (response) throw new HarnessError('target:port-in-use');
    } catch (error) {
      if (error instanceof HarnessError) throw error;
    }

    markStage('setup:database');
    database = await createDisposablePostgresDatabase();
    await runNodeScript('scripts/migrate-db.mjs', { DATABASE_URL: database.connectionString, NODE_ENV: 'test' });
    await runNodeScript('scripts/ingest-knowledge.mjs', {
      DATABASE_URL: database.connectionString,
      MORSE_ALLOW_TEST_EMBEDDINGS: 'true',
      NODE_ENV: 'test',
    });
    markStage('setup:runtime-files');
    tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'revolution-private-resume-runtime-'));
    const storageDirectory = path.join(tempDirectory, 'storage');
    mkdirSync(storageDirectory, { recursive: true });
    const keyPath = path.join(tempDirectory, 'resume-key');
    const pdfPath = path.join(tempDirectory, 'synthetic-resume.pdf');
    writeFileSync(keyPath, randomBytes(32).toString('base64'));
    writeFileSync(pdfPath, syntheticResumePdf());
    const adminPassword = `Synthetic-${randomBytes(18).toString('base64url')}`;
    const adminPasswordHash = await hashAdminPassword(adminPassword);
    const nextCli = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
    const appEnv = {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_ENV: 'production',
      PORT: targetUrl.port,
      DATABASE_URL: database.connectionString,
      MORSE_DATABASE_SSL_MODE: 'disable',
      MORSE_LOCAL_RELEASE_SMOKE: 'true',
      MORSE_PUBLIC_ORIGIN: targetUrl.origin,
      MORSE_ADMIN_ALLOWED_ORIGIN: targetUrl.origin,
      MORSE_ADMIN_PASSWORD_HASH: adminPasswordHash,
      MORSE_ADMIN_SESSION_MINUTES: '30',
      MORSE_ADMIN_MAX_FAILED_ATTEMPTS: '5',
      MORSE_ADMIN_LOCK_MINUTES: '15',
      MORSE_INVITE_FINGERPRINT_SECRET: randomBytes(32).toString('hex'),
      MORSE_CHAT_ENABLED: 'false',
      MORSE_SEARCH_ENABLED: 'false',
      OPENAI_API_KEY: 'synthetic-disabled-provider',
      OPENAI_BASE_URL: 'https://provider.invalid/v1',
      OPENAI_CHAT_MODEL: 'synthetic-disabled-model',
      OPENAI_CHAT_PROTOCOL: 'responses',
      OPENAI_EMBEDDING_API_KEY: 'synthetic-disabled-embedding',
      OPENAI_EMBEDDING_BASE_URL: 'https://embedding.invalid/v1',
      OPENAI_EMBEDDING_MODEL: 'synthetic-disabled-embedding',
      MORSE_RESUME_ENABLED: 'true',
      MORSE_RESUME_STORAGE_DIR: storageDirectory,
      MORSE_RESUME_ENCRYPTION_KEY_FILE: keyPath,
      MORSE_RESUME_KEY_VERSION: '1',
      MORSE_RESUME_FINGERPRINT_SECRET: randomBytes(32).toString('hex'),
      MORSE_RESUME_TRUSTED_PROXY_HOPS: '0',
    };
    markStage('setup:app-start');
    app = spawnOwned(process.execPath, [nextCli, 'start', '--hostname', '127.0.0.1', '--port', targetUrl.port], {
      env: appEnv,
    });
    await waitForHttp(targetUrl, app, 'app:start');
    markStage('setup:release-smoke');
    await runReleaseSmoke({
      ...appEnv,
      MORSE_RELEASE_BASE_URL: targetUrl.origin,
    });
    checks.add('release:smoke');
    markStage('setup:resume-preflight');
    const resumePreflight = await fetch(new URL('/api/resume/access', targetUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    check(resumePreflight.status === 401, `app:resume-access-status-${resumePreflight.status}`);
    const resumeState = await resumePreflight.json();
    check(resumeState?.enabled === true, 'app:resume-access-disabled');
    check(resumeState?.authorized === false, 'app:resume-access-preauthorized');
    markStage('setup:browser');
    browser = await launchEdge();

    for (const viewport of viewports) {
      markStage(`${viewport.key}:open-tab`);
      const page = await openTab(browser, viewport);
      pages.push(page);
      screenshots.push(await runViewport({
        page,
        viewport,
        connectionString: database.connectionString,
        adminPassword,
        pdfPath,
        outputDirectory,
        checks,
        fileResponses,
      }));
    }

    const errorCounts = pages.reduce((totals, page) => ({
      consoleErrors: totals.consoleErrors + page.errors.console.length,
      pageErrors: totals.pageErrors + page.errors.page.length,
      externalOrigins: totals.externalOrigins + page.errors.external.size,
    }), { consoleErrors: 0, pageErrors: 0, externalOrigins: 0 });
    return summary({ checks: [...checks], screenshots, fileResponses, errorCounts });
  } finally {
    for (const page of pages.reverse()) await closeTab(page).catch(() => undefined);
    await cleanupBrowser(browser).catch(() => undefined);
    await terminateOwnedChild(app).catch(() => undefined);
    if (database) await database.dispose().catch(() => undefined);
    if (tempDirectory) rmSync(tempDirectory, { force: true, recursive: true });
  }
}

const direct = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direct) {
  runPrivateResumeVisualSmoke().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  }).catch((error) => {
    const code = error instanceof HarnessError ? error.code : `harness:unexpected:${activeStage}`;
    console.error(JSON.stringify(summary({ failures: [code] }), null, 2));
    process.exitCode = 1;
  });
}
