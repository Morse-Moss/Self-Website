#!/usr/bin/env node

import { spawn } from 'node:child_process';
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
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertOwnedProfileBoundary,
  assertConsecutiveAnimationFramesQuiet,
  assertConsecutiveProjectScrollStable,
  cleanupOwnedBrowser,
  connectCdpTransport,
  countRunningAnimations,
  createCleanupCoordinator,
  createNetworkMonitor,
  createS9Summary,
  dispatchPrimaryClick,
  installSignalCleanup,
  publicS9CdpFailureCode,
  removeOwnedProfileWithRetry,
  terminateOwnedProfileProcesses,
  terminateOwnedProcessTree,
  waitForOwnedDevToolsActivePort,
} from './lib/s9-cdp.mjs';

const S9_WORKER_FLAG = '--s9-worker';
const WORKER_CLOSE_TIMEOUT_MS = 5_000;
const WORKER_MESSAGE_LIMIT_BYTES = 64 * 1024;
const WORKER_MESSAGE_TIMEOUT_MS = 180_000;
const WORKER_TERMINATE_TIMEOUT_MS = 15_000;
const screenshotFiles = {
  desktop: {
    capabilities: 'capability-matrix-desktop-1440.png',
    home: 's9-home-desktop-1440x900.png',
    works: 's9-works-desktop-1440x900.png',
  },
  mobile: {
    capabilities: 'capability-matrix-mobile-390.png',
    home: 's9-home-mobile-390x844.png',
    works: 's9-works-mobile-390x844.png',
  },
  'mobile-reduced': {
    capabilities: 'capability-matrix-mobile-390-reduced.png',
    home: 's9-home-mobile-390-reduced.png',
  },
};
const SAFE_SCREENSHOT_PREFIXES = [
  'docs/verify/s9',
  'docs/verify/capability-matrix',
];
const SAFE_SCREENSHOT_FILE_NAMES = new Set(
  Object.values(screenshotFiles).flatMap((files) => Object.values(files)),
);
const SAFE_SCREENSHOTS = new Set(SAFE_SCREENSHOT_PREFIXES.flatMap((prefix) => (
  [...SAFE_SCREENSHOT_FILE_NAMES].map((fileName) => `${prefix}/${fileName}`)
)));
const canonicalScreenshotPrefixByEvidenceDir = new Map([
  [
    path.resolve(fileURLToPath(new URL('../docs/verify/s9/', import.meta.url))),
    'docs/verify/s9',
  ],
  [
    path.resolve(fileURLToPath(new URL('../docs/verify/capability-matrix/', import.meta.url))),
    'docs/verify/capability-matrix',
  ],
]);
const SAFE_SLUGS = new Set([
  'content-agent',
  'auto-operations',
  'ai-leadgen',
  'deep-research',
  'digital-morse',
]);
const SAFE_HARNESS_ROUTES = new Set([
  '/',
  '/works',
  '/works#content-agent',
  '/works#auto-operations',
  '/works#ai-leadgen',
  '/works#not-a-project',
  ...[...SAFE_SLUGS].map((slug) => `/works/${slug}`),
]);
const SAFE_VIEWPORTS = new Set(['desktop', 'mobile', 'mobile-reduced']);

function emitS9Summary(consoleLike, summary) {
  consoleLike.log(JSON.stringify(summary, null, 2));
  if (summary.failures.length > 0) consoleLike.error('S9_VISUAL_SMOKE_FAILED');
}

function appendSummaryFailure(summary, code) {
  return createS9Summary({
    ...summary,
    failures: summary.failures.includes(code)
      ? summary.failures
      : [...summary.failures, code],
  });
}

function isSafeExternalOrigin(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
      && url.origin === value;
  } catch {
    return false;
  }
}

function isSafeHarnessRoute(value) {
  return typeof value === 'string' && SAFE_HARNESS_ROUTES.has(value);
}

function parseWorkerSummary(message) {
  if (!message || Array.isArray(message) || typeof message !== 'object') return null;
  let serialized;
  try {
    serialized = JSON.stringify(message);
  } catch {
    return null;
  }
  if (
    typeof serialized !== 'string'
    || Buffer.byteLength(serialized, 'utf8') > WORKER_MESSAGE_LIMIT_BYTES
  ) return null;

  const normalized = createS9Summary(message);
  if (serialized !== JSON.stringify(normalized)) return null;
  if (normalized.failures.some((code) => (
    code.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9:/.#_-]*$/.test(code)
  ))) return null;
  if (normalized.screenshots.some((fileName) => !SAFE_SCREENSHOTS.has(fileName))) return null;
  if (normalized.routeStatuses.some((entry) => (
    !isSafeHarnessRoute(entry.route)
    || !SAFE_VIEWPORTS.has(entry.viewport)
    || entry.statuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599)
  ))) return null;
  if (Object.keys(normalized.canvasPixelVariance).some((key) => !SAFE_VIEWPORTS.has(key))) {
    return null;
  }
  if (Object.entries(normalized.expandedSlugs).some(([viewport, slugs]) => (
    !SAFE_VIEWPORTS.has(viewport) || slugs.some((slug) => !SAFE_SLUGS.has(slug))
  ))) return null;
  if (normalized.horizontalOverflow.some((entry) => (
    !isSafeHarnessRoute(entry.route)
    || !SAFE_VIEWPORTS.has(entry.viewport)
    || entry.pixels < 0
  ))) return null;
  if (normalized.externalRuntimeRequests.some((origin) => !isSafeExternalOrigin(origin))) return null;
  return normalized;
}

export function sendS9WorkerSummary(processLike, summary) {
  const safeSummary = parseWorkerSummary(summary);
  if (!safeSummary || processLike?.connected !== true || typeof processLike.send !== 'function') {
    return Promise.reject(new Error('worker IPC unavailable'));
  }
  return new Promise((resolve, reject) => {
    try {
      processLike.send(safeSummary, (error) => {
        if (error) reject(new Error('worker IPC send failed'));
        else resolve();
      });
    } catch {
      reject(new Error('worker IPC send failed'));
    }
  });
}

function observeWorkerClose(worker) {
  let closed = false;
  let spawnFailed = false;
  const promise = new Promise((resolve) => {
    worker.once('error', () => { spawnFailed = true; });
    worker.once('close', (code, signal) => {
      closed = true;
      resolve({ code, signal, spawnFailed });
    });
  });
  return {
    get closed() {
      return closed;
    },
    promise,
  };
}

function observeWorkerIpc(worker, timeoutMs) {
  let invalid = false;
  let received = false;
  let settled = false;
  let resolveOutcome;
  const promise = new Promise((resolve) => { resolveOutcome = resolve; });
  const finish = (outcome) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    resolveOutcome(outcome);
  };
  const handleMessage = (message) => {
    if (received) {
      invalid = true;
      finish({ kind: 'invalid' });
      return;
    }
    received = true;
    const summary = parseWorkerSummary(message);
    if (!summary) {
      invalid = true;
      finish({ kind: 'invalid' });
      return;
    }
    finish({ kind: 'summary', summary });
  };
  const handlePrematureFailure = () => {
    if (!received) finish({ kind: 'failed' });
  };
  const dispose = () => {
    clearTimeout(timeout);
    worker.removeListener('message', handleMessage);
    worker.removeListener('error', handlePrematureFailure);
    worker.removeListener('close', handlePrematureFailure);
    worker.removeListener('disconnect', handlePrematureFailure);
  };
  const timeout = setTimeout(() => finish({ kind: 'failed' }), timeoutMs);
  worker.on('message', handleMessage);
  worker.once('error', handlePrematureFailure);
  worker.once('close', handlePrematureFailure);
  worker.once('disconnect', handlePrematureFailure);
  return {
    dispose,
    get invalid() {
      return invalid;
    },
    promise,
  };
}

async function waitForObservedClose(observer, timeoutMs = WORKER_CLOSE_TIMEOUT_MS) {
  if (observer.closed) return true;
  let timeout;
  const timedOut = new Promise((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
  });
  const closed = observer.promise.then(() => true);
  const result = await Promise.race([closed, timedOut]);
  clearTimeout(timeout);
  return result;
}

export async function runS9Supervisor({
  argv = process.argv,
  dependencies = {},
  processLike = process,
} = {}) {
  const {
    consoleLike = console,
    makeProfile = mkdtempSync,
    platform = process.platform,
    removeProfile = removeOwnedProfileWithRetry,
    spawnWorker = spawn,
    tempRoot = os.tmpdir(),
    terminateProfileProcesses = terminateOwnedProfileProcesses,
    terminateWorker = terminateOwnedProcessTree,
    workerCloseTimeoutMs = WORKER_CLOSE_TIMEOUT_MS,
    workerMessageTimeoutMs = WORKER_MESSAGE_TIMEOUT_MS,
    workerTerminateTimeoutMs = WORKER_TERMINATE_TIMEOUT_MS,
  } = dependencies;
  let summary = createS9Summary();
  let profileDir = null;
  let profileOwned = false;
  let worker = null;
  let closeObserver = null;
  let ipcObserver = null;
  let receivedSignal = null;
  let resolveSignal;
  const signalPromise = new Promise((resolve) => { resolveSignal = resolve; });
  const handleSignal = (signal, exitCode) => {
    if (receivedSignal) return;
    receivedSignal = { exitCode, signal };
    resolveSignal({ kind: 'signal' });
  };
  const handleSigint = () => handleSignal('SIGINT', 130);
  const handleSigterm = () => handleSignal('SIGTERM', 143);
  processLike.on('SIGINT', handleSigint);
  processLike.on('SIGTERM', handleSigterm);

  try {
    const target = argv[2] || 'http://127.0.0.1:3010';
    profileDir = makeProfile(path.join(tempRoot, 'revolution-s9-edge-'));
    assertOwnedProfileBoundary(profileDir, { tempRoot });
    profileOwned = true;
    worker = spawnWorker(process.execPath, [
      fileURLToPath(import.meta.url),
      S9_WORKER_FLAG,
      target,
      profileDir,
    ], {
      detached: platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    });
    closeObserver = observeWorkerClose(worker);
    ipcObserver = observeWorkerIpc(worker, workerMessageTimeoutMs);
    const outcome = await Promise.race([ipcObserver.promise, signalPromise]);
    if (outcome.kind === 'signal') {
      summary = appendSummaryFailure(summary, 'browser:worker-interrupted');
    } else if (outcome.kind === 'summary') {
      summary = outcome.summary;
    } else if (outcome.kind === 'invalid') {
      summary = appendSummaryFailure(summary, 'browser:worker-output-invalid');
    } else {
      summary = appendSummaryFailure(summary, 'browser:worker-process-failed');
    }
  } catch (error) {
    const safeCode = publicS9CdpFailureCode(error);
    summary = appendSummaryFailure(
      summary,
      safeCode === 'browser:profile-boundary'
        ? safeCode
        : 'browser:worker-process-failed',
    );
  } finally {
    processLike.removeListener('SIGINT', handleSigint);
    processLike.removeListener('SIGTERM', handleSigterm);
    let profileProcessCleanupSucceeded = platform !== 'win32';
    if (profileOwned && platform === 'win32') {
      try {
        await terminateProfileProcesses(profileDir, { platform });
        profileProcessCleanupSucceeded = true;
        try {
          worker?.disconnect?.();
        } catch {
          // The profile-scoped zero-process result remains authoritative.
        }
        try {
          worker?.unref?.();
        } catch {
          // Releasing the local ChildProcess handle is best effort only.
        }
      } catch {
        summary = appendSummaryFailure(summary, 'browser:owned-cleanup-failed');
      }
    } else if (worker && closeObserver && !closeObserver.closed) {
      try {
        await terminateWorker(worker, {
          platform,
          timeoutMs: workerTerminateTimeoutMs,
        });
      } catch {
        summary = appendSummaryFailure(summary, 'browser:owned-cleanup-failed');
      }
    }
    if (
      worker
      && closeObserver
      && !closeObserver.closed
      && platform !== 'win32'
      && !await waitForObservedClose(closeObserver, workerCloseTimeoutMs)
    ) {
      summary = appendSummaryFailure(summary, 'browser:owned-cleanup-failed');
    }
    if (ipcObserver?.invalid) {
      summary = appendSummaryFailure(createS9Summary(), 'browser:worker-output-invalid');
    }
    ipcObserver?.dispose();
    if (
      profileOwned
      && profileProcessCleanupSucceeded
      && (platform === 'win32' || !closeObserver || closeObserver.closed)
    ) {
      try {
        await removeProfile(profileDir);
      } catch {
        summary = appendSummaryFailure(summary, 'browser:owned-cleanup-failed');
      }
    }
  }

  emitS9Summary(consoleLike, summary);
  if (receivedSignal) processLike.exit(receivedSignal.exitCode);
  else processLike.exitCode = summary.failures.length > 0 ? 1 : 0;
  return summary;
}

function isDirectExecution(metaUrl, argvPath) {
  return typeof argvPath === 'string'
    && pathToFileURL(path.resolve(argvPath)).href === metaUrl;
}

export async function main({
  argv = process.argv,
  dependencies = {},
  env = process.env,
  processLike = process,
  supervisedProfileDir = null,
} = {}) {
let targetUrl;
let edgePath;
let evidenceDir;
let publicContent;

const CONNECTION_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 15_000;
const INTERACTION_TIMEOUT_MS = 5_000;
const SCREENSHOT_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 2_000;
const CANVAS_SAMPLE_WIDTH = 160;
const CANVAS_SAMPLE_HEIGHT = 90;
const {
  cleanupBrowserOptions = {},
  consoleLike = console,
  edgeExists = existsSync,
  makeProfile = mkdtempSync,
  spawnBrowser = spawn,
  waitForEndpoint = waitForOwnedDevToolsActivePort,
} = dependencies;

const viewports = [
  { name: 'desktop', width: 1440, height: 900, reducedMotion: false },
  { name: 'mobile', width: 390, height: 844, reducedMotion: false },
  { name: 'mobile-reduced', width: 390, height: 844, reducedMotion: true },
];
const routes = ['/', '/works'];
const slugs = [
  'content-agent',
  'auto-operations',
  'ai-leadgen',
  'deep-research',
  'digital-morse',
];
const failures = [];
const screenshotByName = new Map();
const routeStatuses = [];
const canvasPixelVariance = {};
const expandedSlugs = {};
const horizontalOverflow = [];
let consoleErrors = 0;
let pageErrors = 0;
const externalRuntimeRequestSet = new Set();

function recordScreenshot(fileName) {
  const summaryPrefix = canonicalScreenshotPrefixByEvidenceDir.get(evidenceDir);
  if (!summaryPrefix) return;
  const summaryPath = `${summaryPrefix}/${fileName}`;
  if (SAFE_SCREENSHOTS.has(summaryPath)) screenshotByName.set(fileName, summaryPath);
}

class HarnessError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function failureCode(error) {
  if (error instanceof HarnessError) return error.code;
  return publicS9CdpFailureCode(error) ?? 'unexpected';
}

function addFailure(code) {
  if (!failures.includes(code)) failures.push(code);
}

function check(value, code) {
  if (!value) addFailure(code);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS),
  });
  if (!response.ok) throw new HarnessError(`cdp:http-${response.status}`);
  return response.json();
}

async function launchBrowser({ onOwnedBrowser }) {
  if (!edgeExists(edgePath)) throw new HarnessError('browser:edge-missing');

  const profilePrefix = path.join(os.tmpdir(), 'revolution-s9-edge-');
  const profileDir = supervisedProfileDir ?? makeProfile(profilePrefix);
  const startedAtMs = Date.now();
  const browserProcess = spawnBrowser(edgePath, [
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
  ], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    windowsHide: true,
  });
  browserProcess.on('error', () => {});

  const browserState = {
    browserProcess,
    browserWebSocketUrl: null,
    cdpBase: null,
    profileDir,
  };
  onOwnedBrowser(browserState);

  const endpoint = await waitForEndpoint({
    fsApi: { readFileSync, statSync },
    isProcessExited: () => browserProcess.exitCode !== null,
    profileDir,
    startedAtMs,
    timeoutMs: CONNECTION_TIMEOUT_MS,
  });
  browserState.browserWebSocketUrl = endpoint.browserWebSocketUrl;
  browserState.cdpBase = endpoint.cdpBase;
  return browserState;
}

async function openTab(cdpBase) {
  const tab = await fetchJson(`${cdpBase}/json/new?about:blank`, { method: 'PUT' });
  if (!tab.webSocketDebuggerUrl) throw new HarnessError('cdp:new-tab-missing-socket');
  const cdpUrl = new URL(cdpBase);
  const socketUrl = new URL(tab.webSocketDebuggerUrl);
  if (
    socketUrl.hostname !== cdpUrl.hostname
    || socketUrl.port !== cdpUrl.port
    || !/^\/devtools\/page\/[A-Za-z0-9._-]+$/.test(socketUrl.pathname)
  ) {
    throw new HarnessError('cdp:new-tab-unowned-socket');
  }
  return tab.webSocketDebuggerUrl;
}

async function createPageClient(webSocketUrl) {
  let transport;
  const runtime = {
    consoleErrors: 0,
    pageErrors: 0,
  };
  const networkMonitor = createNetworkMonitor({ targetOrigin: targetUrl.origin });

  async function handleAccessMock(params) {
    let requestUrl;
    try {
      requestUrl = new URL(params.request.url);
    } catch {
      await transport.send('Fetch.continueRequest', { requestId: params.requestId });
      return;
    }

    if (requestUrl.origin === targetUrl.origin && requestUrl.pathname === '/api/access') {
      const body = Buffer.from(JSON.stringify({
        authorized: false,
        expiresAt: null,
        remainingMessages: 0,
      })).toString('base64');
      await transport.send('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'content-type', value: 'application/json; charset=utf-8' },
          { name: 'cache-control', value: 'no-store' },
        ],
        body,
      });
      return;
    }

    await transport.send('Fetch.continueRequest', { requestId: params.requestId });
  }

  function handleEvent(message) {
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      runtime.consoleErrors += 1;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      runtime.pageErrors += 1;
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const entry = message.params.entry;
      if (entry.source === 'network') networkMonitor.handle(message.method, message.params);
      else runtime.consoleErrors += 1;
    }
    if ([
      'Network.requestWillBeSent',
      'Network.responseReceived',
      'Network.loadingFailed',
      'Network.webSocketCreated',
    ].includes(message.method)) {
      networkMonitor.handle(message.method, message.params);
    }
    if (message.method === 'Fetch.requestPaused') {
      void handleAccessMock(message.params).catch(() => {
        runtime.pageErrors += 1;
      });
    }
  }

  transport = await connectCdpTransport(webSocketUrl, {
    commandTimeoutMs: COMMAND_TIMEOUT_MS,
    connectTimeoutMs: CONNECTION_TIMEOUT_MS,
    onEvent: handleEvent,
  });

  async function evaluate(expression, timeoutMs = COMMAND_TIMEOUT_MS) {
    const result = await transport.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, timeoutMs);
    if (result.exceptionDetails || result.result?.subtype === 'error') {
      throw new HarnessError('cdp:evaluate-exception');
    }
    return result.result?.value;
  }

  return {
    beginNavigation: networkMonitor.beginNavigation,
    endNavigation: networkMonitor.endNavigation,
    dispose: transport.dispose,
    evaluate,
    networkMonitor,
    runtime,
    send: transport.send,
  };
}

async function closeTab(client) {
  try {
    await client.send('Page.close', {}, CLOSE_TIMEOUT_MS);
  } catch {
    // Page.close can close its own target transport before responding.
  } finally {
    client.dispose();
  }
}

async function waitFor(client, expression, code, timeoutMs = INTERACTION_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return;
    await delay(50);
  }
  throw new HarnessError(code);
}

async function clickSelector(client, viewport, selector) {
  try {
    await dispatchPrimaryClick(client, {
      pointerMode: viewport.width < 640 ? 'touch' : 'mouse',
      selector,
    });
    return true;
  } catch (error) {
    if (error?.code === 'POINTER_TARGET_UNAVAILABLE') return false;
    throw error;
  }
}

async function cancelActivePageScroll(client) {
  await client.evaluate(`new Promise((resolve) => {
    window.scrollTo({ top: window.scrollY, behavior: 'auto' });
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  })`);
}

async function waitForPointerTargetStable(client, selector, code) {
  const stable = await client.evaluate(`new Promise((resolve) => {
    let frames = 0;
    let previous = null;
    let quietFrames = 0;
    const sample = () => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!(target instanceof HTMLElement)) {
        resolve(false);
        return;
      }
      const rect = target.getBoundingClientRect();
      const current = {
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        scrollY: window.scrollY,
        top: rect.top,
      };
      const unchanged = previous
        && Math.abs(current.bottom - previous.bottom) < 0.5
        && Math.abs(current.left - previous.left) < 0.5
        && Math.abs(current.right - previous.right) < 0.5
        && Math.abs(current.scrollY - previous.scrollY) < 0.5
        && Math.abs(current.top - previous.top) < 0.5;
      quietFrames = unchanged ? quietFrames + 1 : 0;
      previous = current;
      frames += 1;
      if (quietFrames >= 3 || frames >= 120) {
        resolve(quietFrames >= 3);
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })`);
  if (!stable) throw new HarnessError(code);
}

function expectedLocation(route) {
  const url = new URL(route, targetUrl);
  return { hash: url.hash, pathname: url.pathname };
}

async function navigate(client, viewportName, route, expected = expectedLocation(route)) {
  client.beginNavigation(route);
  await client.send('Page.navigate', { url: new URL(route, targetUrl).href }, NAVIGATION_TIMEOUT_MS);
  await waitFor(
    client,
    `document.readyState === 'complete'
      && location.pathname === ${JSON.stringify(expected.pathname)}
      && location.hash === ${JSON.stringify(expected.hash)}`,
    `${viewportName}:${route}:navigation-timeout`,
    NAVIGATION_TIMEOUT_MS,
  );
  await client.evaluate('document.fonts?.ready.then(() => true) ?? true');
  await delay(120);
  const statuses = client.endNavigation();
  routeStatuses.push({ viewport: viewportName, route, statuses });
  return statuses;
}

async function recordHorizontalOverflow(client, viewportName, route) {
  const pixels = await client.evaluate(
    'Math.max(0, document.documentElement.scrollWidth - window.innerWidth)',
  );
  horizontalOverflow.push({ viewport: viewportName, route, pixels });
  check(pixels <= 1, `${viewportName}:${route}:horizontal-overflow`);
}

async function captureScreenshot(client, viewportName, kind) {
  const fileName = screenshotFiles[viewportName]?.[kind];
  if (!fileName) return;

  await client.send('Page.bringToFront');
  await delay(80);
  const result = await client.send('Page.captureScreenshot', {
    captureBeyondViewport: false,
    format: 'png',
    fromSurface: true,
  }, SCREENSHOT_TIMEOUT_MS);
  const filePath = path.join(evidenceDir, fileName);
  writeFileSync(filePath, Buffer.from(result.data, 'base64'));
  recordScreenshot(fileName);
}

async function captureElementScreenshot(client, viewportName, kind, selector) {
  const fileName = screenshotFiles[viewportName]?.[kind];
  if (!fileName) return;

  const clip = await client.evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLElement)) return null;
    const rect = target.getBoundingClientRect();
    return {
      x: window.scrollX + rect.left,
      y: window.scrollY + rect.top,
      width: rect.width,
      height: rect.height,
    };
  })()`);
  if (!clip) {
    throw new HarnessError(`${viewportName}:home:capability-screenshot-target`);
  }
  const result = await client.send('Page.captureScreenshot', {
    captureBeyondViewport: true,
    clip: { ...clip, scale: 1 },
    format: 'png',
    fromSurface: true,
  }, SCREENSHOT_TIMEOUT_MS);
  const filePath = path.join(evidenceDir, fileName);
  writeFileSync(filePath, Buffer.from(result.data, 'base64'));
  recordScreenshot(fileName);
}

async function sampleCanvas(client) {
  const sample = await client.evaluate(`(() => {
    const canvas = document.querySelector('[data-testid="warp-tunnel-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const sampleWidth = ${CANVAS_SAMPLE_WIDTH};
    const sampleHeight = ${CANVAS_SAMPLE_HEIGHT};
    const rect = canvas.getBoundingClientRect();
    const visibleLeft = Math.max(0, rect.left);
    const visibleTop = Math.max(0, rect.top);
    const visibleRight = Math.min(window.innerWidth, rect.right);
    const visibleBottom = Math.min(window.innerHeight, rect.bottom);
    if (
      visibleRight - visibleLeft < sampleWidth
      || visibleBottom - visibleTop < sampleHeight
    ) return null;
    return {
      x: window.scrollX + visibleLeft,
      y: window.scrollY + visibleTop,
    };
  })()`, COMMAND_TIMEOUT_MS);
  if (!sample) return null;

  const captureFrame = () => client.send('Page.captureScreenshot', {
    captureBeyondViewport: false,
    clip: {
      x: sample.x,
      y: sample.y,
      width: CANVAS_SAMPLE_WIDTH,
      height: CANVAS_SAMPLE_HEIGHT,
      scale: 1,
    },
    format: 'png',
    fromSurface: true,
  }, SCREENSHOT_TIMEOUT_MS);
  const firstScreenshot = await captureFrame();
  await delay(360);
  const secondScreenshot = await captureFrame();
  const firstDataUrl = `data:image/png;base64,${firstScreenshot.data}`;
  const secondDataUrl = `data:image/png;base64,${secondScreenshot.data}`;

  return client.evaluate(`(async () => {
    const canvas = document.querySelector('[data-testid="warp-tunnel-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const sampleWidth = ${CANVAS_SAMPLE_WIDTH};
    const sampleHeight = ${CANVAS_SAMPLE_HEIGHT};
    const scratch = document.createElement('canvas');
    scratch.width = sampleWidth;
    scratch.height = sampleHeight;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    const decodePng = async (dataUrl) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      context.clearRect(0, 0, sampleWidth, sampleHeight);
      context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
      const rgba = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
      const pixels = new Float64Array(sampleWidth * sampleHeight);
      for (let rgbaIndex = 0, pixelIndex = 0; rgbaIndex < rgba.length; rgbaIndex += 4, pixelIndex += 1) {
        const luminance = (rgba[rgbaIndex] + rgba[rgbaIndex + 1] + rgba[rgbaIndex + 2]) / 3;
        pixels[pixelIndex] = luminance * (rgba[rgbaIndex + 3] / 255);
      }
      return pixels;
    };

    const first = await decodePng(${JSON.stringify(firstDataUrl)});
    const second = await decodePng(${JSON.stringify(secondDataUrl)});
    const mean = first.reduce((total, value) => total + value, 0) / first.length;
    const variance = first.reduce((total, value) => total + ((value - mean) ** 2), 0) / first.length;
    const frameDifference = first.reduce(
      (total, value, index) => total + Math.abs(value - second[index]),
      0,
    ) / first.length;

    return {
      frameDifference,
      pointerEvents: getComputedStyle(canvas).pointerEvents,
      animationStates: document.getAnimations()
        .map((animation) => ({ playState: animation.playState })),
      sampleHeight,
      sampleWidth,
      variance,
    };
  })()`, COMMAND_TIMEOUT_MS);
}

async function inspectHome(client, viewport) {
  const viewportName = viewport.name;
  await navigate(client, viewportName, '/');
  await waitFor(
    client,
    'Boolean(document.querySelector("#morse-invite-code"))',
    `${viewportName}:home:locked-access-timeout`,
  );
  await waitFor(
    client,
    'Boolean(document.querySelector(\'[data-testid="warp-tunnel-canvas"]\'))',
    `${viewportName}:home:canvas-timeout`,
  );
  await recordHorizontalOverflow(client, viewportName, '/');

  const state = await client.evaluate(`(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const overlaps = (first, second) => first.left < second.right
      && first.right > second.left
      && first.top < second.bottom
      && first.bottom > second.top;
    const header = document.querySelector('header');
    const main = document.querySelector('main');
    const chat = document.querySelector('[data-testid="morse-chat"]');
    const canvas = document.querySelector('[data-testid="warp-tunnel-canvas"]');
    const h1 = document.querySelector('#home-title');
    const identity = h1?.parentElement;
    const featured = document.querySelector('#featured-title')?.closest('section');
    const capability = document.querySelector('#capabilities-title');
    const facts = document.querySelector('#facts-title');
    const capabilityMatrix = document.querySelector('[data-capability-matrix]');
    const capabilityCards = Array.from(document.querySelectorAll('[data-capability-card]'));
    const capabilityMatrixRect = capabilityMatrix?.getBoundingClientRect();
    const capabilityCardRects = capabilityCards.map((card) => card.getBoundingClientRect());
    const capabilityTolerance = 2;
    const firstRowBottom = capabilityCardRects.length === 5
      ? Math.max(capabilityCardRects[0].bottom, capabilityCardRects[1].bottom)
      : 0;
    const secondRowTop = capabilityCardRects.length === 5
      ? Math.min(capabilityCardRects[2].top, capabilityCardRects[3].top)
      : 0;
    const secondRowBottom = capabilityCardRects.length === 5
      ? Math.max(capabilityCardRects[2].bottom, capabilityCardRects[3].bottom)
      : 0;
    const desktopCapabilityLayout = Boolean(
      capabilityMatrixRect
      && capabilityCardRects.length === 5
      && Math.abs(capabilityCardRects[0].top - capabilityCardRects[1].top) <= capabilityTolerance
      && Math.abs(capabilityCardRects[2].top - capabilityCardRects[3].top) <= capabilityTolerance
      && Math.abs(capabilityCardRects[0].left - capabilityCardRects[2].left) <= capabilityTolerance
      && Math.abs(capabilityCardRects[1].right - capabilityCardRects[3].right) <= capabilityTolerance
      && capabilityCardRects[0].right < capabilityCardRects[1].left
      && capabilityCardRects[2].right < capabilityCardRects[3].left
      && secondRowTop >= firstRowBottom - capabilityTolerance
      && capabilityCardRects[4].top >= secondRowBottom - capabilityTolerance
      && Math.abs(capabilityCardRects[4].left - capabilityMatrixRect.left) <= capabilityTolerance
      && Math.abs(capabilityCardRects[4].right - capabilityMatrixRect.right) <= capabilityTolerance
    );
    const mobileCapabilityLayout = Boolean(
      capabilityMatrixRect
      && capabilityCardRects.length === 5
      && capabilityCardRects.every((rect) => (
        Math.abs(rect.left - capabilityMatrixRect.left) <= capabilityTolerance
        && Math.abs(rect.right - capabilityMatrixRect.right) <= capabilityTolerance
      ))
      && capabilityCardRects.every((rect, index) => (
        index === 0
        || rect.top >= capabilityCardRects[index - 1].bottom - capabilityTolerance
      ))
    );
    const roleVisible = Array.from(document.querySelectorAll('p')).some(
      (element) => element.textContent?.trim() === ${JSON.stringify(publicContent.profile.role)}
        && visible(element),
    );
    const headerRect = header?.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();
    const chatRect = chat?.getBoundingClientRect();
    const identityRect = identity?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    const featuredRect = featured?.getBoundingClientRect();
    const horizontalNodes = Array.from(document.querySelectorAll(
      'main h1, main h2, main h3, main p, main a, main button, header a, header button, [data-testid="morse-chat"] input, [data-testid="morse-chat"] textarea'
    )).filter(visible);
    const viewportNodes = Array.from(document.querySelectorAll(
      'header a, header button, [data-testid="morse-chat"], [data-testid="morse-chat"] input, [data-testid="morse-chat"] button'
    )).filter(visible);
    return {
      canvasExists: canvas instanceof HTMLCanvasElement,
      canvasPointerNone: canvas ? getComputedStyle(canvas).pointerEvents === 'none' : false,
      canvasSized: Boolean(canvasRect && canvasRect.width >= innerWidth && canvasRect.height >= innerHeight),
      capabilityCardCount: capabilityCardRects.length,
      capabilityLayoutValid: innerWidth > 760 ? desktopCapabilityLayout : mobileCapabilityLayout,
      capabilityVisible: visible(capability),
      chatCount: document.querySelectorAll('[data-testid="morse-chat"]').length,
      chatEmbedded: chat?.getAttribute('data-variant') === 'embedded',
      factsVisible: visible(facts),
      featuredCount: featured?.querySelectorAll(':scope article').length ?? 0,
      h1Morse: h1?.textContent?.trim() === 'Morse' && visible(h1),
      headerFixed: header ? getComputedStyle(header).position === 'fixed' : false,
      identityChatOverlap: Boolean(identityRect && chatRect && overlaps(identityRect, chatRect)),
      mainClearsHeader: Boolean(headerRect && mainRect && mainRect.top >= headerRect.bottom - 1),
      nextBandBelowFold: Boolean(featuredRect && featuredRect.top >= innerHeight - 1),
      roleVisible,
      textOverflowCount: horizontalNodes.filter((element) => element.scrollWidth - element.clientWidth > 1).length,
      viewportOverflowCount: viewportNodes.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > innerWidth + 1;
      }).length,
    };
  })()`);

  check(state.canvasExists, `${viewportName}:home:canvas-missing`);
  check(state.canvasPointerNone, `${viewportName}:home:canvas-pointer-events`);
  check(state.canvasSized, `${viewportName}:home:canvas-size`);
  check(state.h1Morse, `${viewportName}:home:identity`);
  check(state.roleVisible, `${viewportName}:home:role`);
  check(state.chatCount === 1 && state.chatEmbedded, `${viewportName}:home:embedded-chat-count`);
  check(state.featuredCount === 2, `${viewportName}:home:featured-count`);
  check(state.capabilityVisible, `${viewportName}:home:capability-matrix`);
  check(state.capabilityCardCount === 5, `${viewportName}:home:capability-card-count`);
  check(state.capabilityLayoutValid, `${viewportName}:home:capability-layout`);
  check(state.factsVisible, `${viewportName}:home:development-facts`);
  check(state.nextBandBelowFold, `${viewportName}:home:next-band-entered-first-viewport`);
  check(state.headerFixed && state.mainClearsHeader, `${viewportName}:home:fixed-header-overlap`);
  check(!state.identityChatOverlap, `${viewportName}:home:identity-chat-overlap`);
  check(state.textOverflowCount === 0, `${viewportName}:home:text-overflow`);
  check(state.viewportOverflowCount === 0, `${viewportName}:home:control-overflow`);

  for (const [trigger, selector] of [
    ['header', 'header button'],
    ['hero', '#home-title ~ div button'],
  ]) {
    if (trigger === 'hero') await cancelActivePageScroll(client);
    const clicked = await clickSelector(client, viewport, selector);
    check(clicked, `${viewportName}:home:${trigger}-chat-trigger-missing`);
    if (clicked) {
      await waitFor(
        client,
        'document.activeElement?.id === "morse-invite-code"',
        `${viewportName}:home:${trigger}-chat-focus-timeout`,
      );
    }
  }

  const revealState = await client.evaluate(`(async () => {
    const nodes = Array.from(document.querySelectorAll('[data-reveal]'));
    for (const node of nodes) {
      node.scrollIntoView({ behavior: 'auto', block: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 45));
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const revealed = nodes.filter((node) => node.getAttribute('data-revealed') === 'true').length;
    window.scrollTo({ top: 0, behavior: 'auto' });
    return { count: nodes.length, revealed };
  })()`);
  check(
    revealState.count > 0 && revealState.revealed === revealState.count,
    `${viewportName}:home:scroll-reveal`,
  );
  await delay(120);
  await captureElementScreenshot(
    client,
    viewportName,
    'capabilities',
    '[data-capability-section]',
  );

  const canvas = await sampleCanvas(client);
  if (!canvas) {
    addFailure(`${viewportName}:home:canvas-sample-missing`);
  } else {
    canvas.runningAnimations = countRunningAnimations(canvas.animationStates);
    canvasPixelVariance[viewportName] = {
      frameDifference: Number(canvas.frameDifference.toFixed(6)),
      sampleHeight: canvas.sampleHeight,
      sampleWidth: canvas.sampleWidth,
      variance: Number(canvas.variance.toFixed(6)),
    };
    check(canvas.sampleWidth === 160 && canvas.sampleHeight === 90, `${viewportName}:home:canvas-sample-size`);
    check(canvas.variance > 0, `${viewportName}:home:canvas-blank`);
    if (viewport.reducedMotion) {
      check(canvas.frameDifference === 0, `${viewportName}:home:canvas-not-static`);
      check(canvas.runningAnimations === 0, `${viewportName}:home:active-animation`);
    } else {
      check(canvas.frameDifference > 0, `${viewportName}:home:canvas-not-moving`);
    }
  }

  await captureScreenshot(client, viewportName, 'home');

  const contextLossHandled = await client.evaluate(`(() => {
    const canvas = document.querySelector('[data-testid="warp-tunnel-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    const event = new Event('webglcontextlost', { cancelable: true });
    const dispatched = canvas.dispatchEvent(event);
    return dispatched === false && event.defaultPrevented;
  })()`);
  check(contextLossHandled, `${viewportName}:home:context-loss-not-handled`);
  if (contextLossHandled) {
    await waitFor(
      client,
      'Boolean(document.querySelector(\'[data-testid="morse-signal-canvas"]\'))',
      `${viewportName}:home:canvas-fallback-timeout`,
    );
  }
}

async function inspectWorksShell(client, viewportName, route) {
  await recordHorizontalOverflow(client, viewportName, route);
  const state = await client.evaluate(`(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const nodes = Array.from(document.querySelectorAll(
      'main h1, main h2, main h3, main p, main a, main button, header a, header button, [data-testid="morse-chat"] button'
    )).filter(visible);
    return {
      cardCount: document.querySelectorAll('[data-project-slug]').length,
      chatCount: document.querySelectorAll('[data-testid="morse-chat"]').length,
      textOverflowCount: nodes.filter((element) => element.scrollWidth - element.clientWidth > 1).length,
      viewportOverflowCount: nodes.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > innerWidth + 1;
      }).length,
    };
  })()`);
  check(state.cardCount === slugs.length, `${viewportName}:${route}:card-count`);
  check(state.chatCount === 1, `${viewportName}:${route}:chat-count`);
  check(state.textOverflowCount === 0, `${viewportName}:${route}:text-overflow`);
  check(state.viewportOverflowCount === 0, `${viewportName}:${route}:control-overflow`);
}

async function clickSlug(client, viewport, slug, { waitForApplicationScroll = true } = {}) {
  const selector = `[data-project-slug="${slug}"] button[aria-expanded]`;
  await waitForPointerTargetStable(
    client,
    selector,
    `works:${slug}:pointer-target-stability-timeout`,
  );
  if (!waitForApplicationScroll) {
    const clicked = await clickSelector(client, viewport, selector);
    if (!clicked) throw new HarnessError(`works:${slug}:toggle-missing`);
    return;
  }

  await installFinalProjectScrollProbe(client, slug);
  try {
    const clicked = await clickSelector(
      client,
      viewport,
      selector,
    );
    if (!clicked) throw new HarnessError(`works:${slug}:toggle-missing`);
    await waitForFinalProjectScroll(client, slug);
  } finally {
    await removeFinalProjectScrollProbe(client);
  }
}

async function installFinalProjectScrollProbe(client, slug) {
  const installed = await client.evaluate(`(() => {
    const article = document.querySelector('[data-project-slug="${slug}"]');
    if (!(article instanceof HTMLElement) || globalThis.__s9ProjectScrollProbe) return false;
    const probe = {
      article,
      calls: 0,
      hadOwnMethod: Object.hasOwn(article, 'scrollIntoView'),
      original: article.scrollIntoView,
    };
    article.scrollIntoView = function scrollIntoView(options) {
      probe.calls += 1;
      return probe.original.call(this, options);
    };
    globalThis.__s9ProjectScrollProbe = probe;
    return true;
  })()`);
  if (!installed) throw new HarnessError(`works:${slug}:final-scroll-probe-unavailable`);
}

async function waitForFinalProjectScroll(client, slug) {
  await waitFor(
    client,
    '(globalThis.__s9ProjectScrollProbe?.calls ?? 0) > 0',
    `works:${slug}:final-scroll-timeout`,
  );
}

async function removeFinalProjectScrollProbe(client) {
  await client.evaluate(`(() => {
    const probe = globalThis.__s9ProjectScrollProbe;
    if (!probe) return;
    if (probe.hadOwnMethod) probe.article.scrollIntoView = probe.original;
    else delete probe.article.scrollIntoView;
    delete globalThis.__s9ProjectScrollProbe;
  })()`);
}

async function sampleProjectScrollGeometry(client, slug) {
  return client.evaluate(`(() => {
    const article = document.querySelector('[data-project-slug="${slug}"]');
    if (!(article instanceof HTMLElement)) return null;
    const rect = article.getBoundingClientRect();
    const root = document.documentElement;
    return {
      articleBottom: rect.bottom,
      articleTop: rect.top,
      clientHeight: root.clientHeight,
      maxScrollY: Math.max(0, document.documentElement.scrollHeight - root.clientHeight),
      scrollHeight: root.scrollHeight,
      scrollMarginTop: Number.parseFloat(getComputedStyle(article).scrollMarginTop) || 0,
      scrollY: window.scrollY,
      viewportHeight: window.innerHeight,
    };
  })()`);
}

async function waitForExpanded(client, viewportName, slug, requireAligned = true) {
  await waitFor(client, `(() => {
    const article = document.querySelector('[data-project-slug="${slug}"]');
    const expandedButtons = document.querySelectorAll('button[aria-expanded="true"]');
    const expandedArticles = document.querySelectorAll('[data-project-slug][data-expanded="true"]');
    const details = article?.querySelector('[data-project-details][data-open="true"]');
    if (!(article instanceof HTMLElement) || expandedButtons.length !== 1
      || expandedArticles.length !== 1 || !details) return false;
    return location.hash === '#${slug}'
      && getComputedStyle(article).gridColumnStart === '1';
  })()`, `${viewportName}:works:${slug}:presence-timeout`, INTERACTION_TIMEOUT_MS);

  if (requireAligned) {
    try {
      await assertConsecutiveProjectScrollStable({
        maxFrames: 120,
        quietFrames: 4,
        requestFrame: () => client.evaluate(
          'new Promise((resolve) => requestAnimationFrame(() => resolve(true)))',
        ),
        sample: () => sampleProjectScrollGeometry(client, slug),
      });
    } catch (error) {
      if (error?.code !== 'PROJECT_SCROLL_STABILITY_TIMEOUT') throw error;
      throw new HarnessError(`${viewportName}:works:${slug}:scroll-stability-timeout`);
    }
  }

  return client.evaluate(`(() => {
    const article = document.querySelector('[data-project-slug="${slug}"]');
    return {
      expandedCount: document.querySelectorAll('button[aria-expanded="true"]').length,
      gridColumnStart: getComputedStyle(article).gridColumnStart,
      hashMatches: location.hash === '#${slug}',
      scrollAligned: ${requireAligned ? 'true' : 'null'},
    };
  })()`);
}

async function waitForStaleDetailsRemoved(client, viewportName, activeSlug, label) {
  await waitFor(client, `Array.from(document.querySelectorAll('[data-project-details]')).every(
    (details) => details.closest('[data-project-slug]')?.getAttribute('data-project-slug')
      === ${JSON.stringify(activeSlug)}
  )`, `${viewportName}:works:${label}:stale-details-timeout`);
}

async function assertAllCollapsed(client, viewportName, label) {
  await waitFor(client, `(() => {
    const buttons = Array.from(document.querySelectorAll('button[aria-expanded]'));
    return buttons.length === ${slugs.length}
      && buttons.every((button) => button.getAttribute('aria-expanded') === 'false')
      && document.querySelectorAll('[data-project-slug][data-expanded="true"]').length === 0;
  })()`, `${viewportName}:${label}:collapsed-timeout`);
  const state = await client.evaluate(`({
    expandedButtons: document.querySelectorAll('button[aria-expanded="true"]').length,
    expandedArticles: document.querySelectorAll('[data-project-slug][data-expanded="true"]').length,
    hash: location.hash,
  })`);
  check(state.expandedButtons === 0, `${viewportName}:${label}:expanded-button`);
  check(state.expandedArticles === 0, `${viewportName}:${label}:expanded-article`);
  return state;
}

async function verifyExternalClickIsolation(client, viewport) {
  const viewportName = viewport.name;
  await clickSlug(client, viewport, 'deep-research');
  await waitForExpanded(client, viewportName, 'deep-research');
  const guardInstalled = await client.evaluate(`(() => {
    const article = document.querySelector('[data-project-slug="deep-research"]');
    const link = article?.querySelector('a[href^="https://"]');
    if (!(link instanceof HTMLAnchorElement)) return false;
    const state = { before: location.href, intercepted: false };
    const preventExternalNavigation = (event) => {
      if (event.target instanceof Element && event.target.closest('a[href^="https://"]') === link) {
        state.intercepted = true;
        event.preventDefault();
      }
    };
    document.addEventListener('click', preventExternalNavigation, true);
    globalThis.__s9ExternalClickGuard = { preventExternalNavigation, state };
    return true;
  })()`);
  check(guardInstalled, `${viewportName}:works:external-click-missing`);
  if (!guardInstalled) return;

  let state;
  try {
    await waitForPointerTargetStable(
      client,
      '[data-project-slug="deep-research"] a[href^="https://"]',
      `${viewportName}:works:external-pointer-stability-timeout`,
    );
    const clicked = await clickSelector(
      client,
      viewport,
      '[data-project-slug="deep-research"] a[href^="https://"]',
    );
    check(clicked, `${viewportName}:works:external-hit-target`);
  } finally {
    state = await client.evaluate(`(() => {
      const guard = globalThis.__s9ExternalClickGuard;
      if (!guard) return null;
      document.removeEventListener('click', guard.preventExternalNavigation, true);
      delete globalThis.__s9ExternalClickGuard;
      const article = document.querySelector('[data-project-slug="deep-research"]');
      const expandedCount = document.querySelectorAll('button[aria-expanded="true"]').length;
      const locationUnchanged = location.href === guard.state.before;
      const clicked = guard.state.intercepted;
      const targetExpanded = article?.getAttribute('data-expanded') === 'true';
      return { clicked, expandedCount, locationUnchanged, targetExpanded };
    })()`);
  }
  if (!state) {
    addFailure(`${viewportName}:works:external-guard-state`);
    return;
  }
  check(state.clicked, `${viewportName}:works:external-click-missing`);
  check(state.locationUnchanged, `${viewportName}:works:external-navigation`);
  check(
    state.expandedCount === 1 && state.targetExpanded,
    `${viewportName}:works:external-click-toggled-card`,
  );
  await clickSlug(client, viewport, 'deep-research', { waitForApplicationScroll: false });
  await assertAllCollapsed(client, viewportName, 'works:external-click-cleanup');
}

async function verifyKeyboard(client, viewportName) {
  const focused = await client.evaluate(`(() => {
    const button = document.querySelector('[data-project-slug="content-agent"] button[aria-expanded]');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.focus();
    return document.activeElement === button;
  })()`);
  check(focused, `${viewportName}:works:keyboard-focus`);
  if (!focused) return;

  await client.send('Input.dispatchKeyEvent', {
    code: 'Enter',
    key: 'Enter',
    nativeVirtualKeyCode: 13,
    text: '\r',
    type: 'keyDown',
    unmodifiedText: '\r',
    windowsVirtualKeyCode: 13,
  });
  await client.send('Input.dispatchKeyEvent', {
    code: 'Enter',
    key: 'Enter',
    nativeVirtualKeyCode: 13,
    type: 'keyUp',
    windowsVirtualKeyCode: 13,
  });
  await waitFor(
    client,
    `document.querySelector(
      '[data-project-slug="content-agent"] button[aria-expanded="true"]'
    ) !== null`,
    `${viewportName}:works:keyboard-enter-timeout`,
    1_500,
  );
  await waitForExpanded(client, viewportName, 'content-agent');

  await client.send('Input.dispatchKeyEvent', {
    code: 'Space',
    key: ' ',
    nativeVirtualKeyCode: 32,
    text: ' ',
    type: 'keyDown',
    windowsVirtualKeyCode: 32,
  });
  await client.send('Input.dispatchKeyEvent', {
    code: 'Space',
    key: ' ',
    nativeVirtualKeyCode: 32,
    type: 'keyUp',
    windowsVirtualKeyCode: 32,
  });
  await assertAllCollapsed(client, viewportName, 'works:keyboard-space');
}

async function installScrollObserver(client) {
  await client.evaluate(`(() => {
    if (globalThis.__s9OriginalScrollIntoView) return;
    globalThis.__s9OriginalScrollIntoView = Element.prototype.scrollIntoView;
    globalThis.__s9ScrollCalls = [];
    globalThis.__s9WheelEvents = 0;
    globalThis.__s9WheelListener = () => { globalThis.__s9WheelEvents += 1; };
    window.addEventListener('wheel', globalThis.__s9WheelListener, { capture: true, passive: true });
    Element.prototype.scrollIntoView = function scrollIntoView(options) {
      globalThis.__s9ScrollCalls.push(options?.behavior ?? null);
      return globalThis.__s9OriginalScrollIntoView.call(this, options);
    };
  })()`);
}

async function removeScrollObserver(client) {
  await client.evaluate(`(() => {
    if (globalThis.__s9OriginalScrollIntoView) {
      Element.prototype.scrollIntoView = globalThis.__s9OriginalScrollIntoView;
    }
    if (globalThis.__s9WheelListener) {
      window.removeEventListener('wheel', globalThis.__s9WheelListener, true);
    }
    delete globalThis.__s9OriginalScrollIntoView;
    delete globalThis.__s9ScrollCalls;
    delete globalThis.__s9WheelEvents;
    delete globalThis.__s9WheelListener;
  })()`);
}

async function verifyTransitionSequences(client, viewport) {
  const viewportName = viewport.name;
  await navigate(client, viewportName, '/works');
  await assertAllCollapsed(client, viewportName, 'works:a-b-initial');
  await clickSlug(client, viewport, 'content-agent');
  await waitForExpanded(client, viewportName, 'content-agent');
  await clickSlug(client, viewport, 'auto-operations');
  await waitForExpanded(client, viewportName, 'auto-operations');
  await waitForStaleDetailsRemoved(client, viewportName, 'auto-operations', 'a-b');

  await navigate(client, viewportName, '/works');
  await assertAllCollapsed(client, viewportName, 'works:a-b-c-initial');
  await clickSlug(client, viewport, 'content-agent', { waitForApplicationScroll: false });
  await waitFor(
    client,
    `(() => {
      const active = document.querySelector(
        '[data-project-slug="content-agent"] button[aria-expanded="true"]'
      ) !== null;
      const details = document.querySelector(
        '[data-project-slug="content-agent"] [data-project-details]'
      ) !== null;
      return active && details;
    })()`,
    `${viewportName}:works:a-b-c-a-timeout`,
  );
  await clickSlug(client, viewport, 'auto-operations', { waitForApplicationScroll: false });
  await waitFor(
    client,
    `(() => {
      const active = document.querySelector(
        '[data-project-slug="auto-operations"] button[aria-expanded="true"]'
      ) !== null;
      const targetDetails = document.querySelector(
        '[data-project-slug="auto-operations"] [data-project-details]'
      ) !== null;
      return active && targetDetails;
    })()`,
    `${viewportName}:works:a-b-c-b-timeout`,
  );
  await clickSlug(client, viewport, 'deep-research');
  await waitForExpanded(client, viewportName, 'deep-research');
  await waitForStaleDetailsRemoved(client, viewportName, 'deep-research', 'a-b-c');

  if (!viewport.reducedMotion) {
    await navigate(client, viewportName, '/works');
    await clickSlug(client, viewport, 'content-agent');
    await waitForExpanded(client, viewportName, 'content-agent');
    await installScrollObserver(client);
    try {
      await clickSlug(client, viewport, 'auto-operations', { waitForApplicationScroll: false });
      await waitFor(client, `(() => {
        const targetExpanded = document.querySelector(
          '[data-project-slug="auto-operations"] button[aria-expanded="true"]'
        ) !== null;
        const staleDetails = document.querySelector(
          '[data-project-slug="content-agent"] [data-project-details]'
        ) !== null;
        return targetExpanded && staleDetails;
      })()`, `${viewportName}:works:wheel-pending-transition-timeout`);
      const callCountBeforeWheel = await client.evaluate(
        'globalThis.__s9ScrollCalls?.length ?? -1',
      );
      await client.send('Input.dispatchMouseEvent', {
        deltaX: 0,
        deltaY: 240,
        type: 'mouseWheel',
        x: Math.floor(viewport.width / 2),
        y: Math.floor(viewport.height / 2),
      });
      await waitFor(
        client,
        '(globalThis.__s9WheelEvents ?? 0) > 0',
        `${viewportName}:works:wheel-not-received-timeout`,
      );
      await waitForStaleDetailsRemoved(client, viewportName, 'auto-operations', 'wheel');
      let quietFrames = true;
      try {
        await assertConsecutiveAnimationFramesQuiet({
          expectedValue: callCountBeforeWheel,
          maxFrames: 8,
          quietFrames: 4,
          requestFrame: () => client.evaluate(
            'new Promise((resolve) => requestAnimationFrame(() => resolve(true)))',
          ),
          sample: () => client.evaluate('globalThis.__s9ScrollCalls?.length ?? -1'),
        });
      } catch (error) {
        if (error?.code !== 'ANIMATION_FRAME_ACTIVITY') throw error;
        quietFrames = false;
      }
      const wheelState = await client.evaluate(`({
        callCount: globalThis.__s9ScrollCalls?.length ?? -1,
        expandedCount: document.querySelectorAll('button[aria-expanded="true"]').length,
        targetExpanded: document.querySelector(
          '[data-project-slug="auto-operations"] button[aria-expanded="true"]'
        ) !== null,
        wheelEvents: globalThis.__s9WheelEvents ?? 0,
      })`);
      check(wheelState.wheelEvents > 0, `${viewportName}:works:wheel-not-received`);
      check(
        quietFrames && wheelState.callCount === callCountBeforeWheel,
        `${viewportName}:works:wheel-did-not-cancel-final-scroll`,
      );
      check(
        wheelState.expandedCount === 1 && wheelState.targetExpanded,
        `${viewportName}:works:wheel-corrupted-expansion`,
      );
    } finally {
      await removeScrollObserver(client);
    }
  }

  if (viewport.reducedMotion) {
    await navigate(client, viewportName, '/works');
    await installScrollObserver(client);
    try {
      await clickSlug(client, viewport, 'content-agent');
      await waitForExpanded(client, viewportName, 'content-agent');
      const reducedScroll = await client.evaluate(
        'globalThis.__s9ScrollCalls?.at(-1) ?? null',
      );
      check(reducedScroll === 'auto', `${viewportName}:works:reduced-scroll-not-auto`);
    } finally {
      await removeScrollObserver(client);
    }
  }
}

async function verifyBackForward(client, viewportName) {
  await navigate(client, viewportName, '/works#content-agent');
  await waitForExpanded(client, viewportName, 'content-agent');
  await navigate(client, viewportName, '/works#auto-operations');
  await waitForExpanded(client, viewportName, 'auto-operations');

  await client.evaluate('history.back()');
  await waitForExpanded(client, viewportName, 'content-agent');
  await client.evaluate('history.forward()');
  await waitForExpanded(client, viewportName, 'auto-operations');
}

async function inspectWorks(client, viewport) {
  const viewportName = viewport.name;
  expandedSlugs[viewportName] = [];

  const statuses = await navigate(client, viewportName, '/works');
  check(statuses.at(-1) === 200, `${viewportName}:works:document-status`);
  await waitFor(
    client,
    `document.querySelectorAll("[data-project-slug]").length === ${slugs.length}`,
    `${viewportName}:works:gallery-timeout`,
  );
  const directState = await assertAllCollapsed(client, viewportName, 'works:direct-nohash');
  check(directState.hash === '', `${viewportName}:works:direct-hash`);
  await inspectWorksShell(client, viewportName, '/works');

  const privacy = await client.evaluate(`(() => {
    const inspect = (slug) => {
      const article = document.querySelector('[data-project-slug="' + slug + '"]');
      return {
        actions: article?.querySelectorAll('a[href]').length ?? -1,
        images: article?.querySelectorAll('img').length ?? -1,
      };
    };
    return {
      contentAgent: inspect('content-agent'),
      autoOperations: inspect('auto-operations'),
    };
  })()`);
  check(
    privacy.contentAgent.images === 1,
    `${viewportName}:works:contentAgent:approved-image`,
  );
  check(
    privacy.contentAgent.actions === 0,
    `${viewportName}:works:contentAgent:internal-action`,
  );
  check(
    privacy.autoOperations.images === 1,
    `${viewportName}:works:autoOperations:approved-image`,
  );
  check(
    privacy.autoOperations.actions === 0,
    `${viewportName}:works:autoOperations:internal-action`,
  );

  await verifyExternalClickIsolation(client, viewport);
  await verifyKeyboard(client, viewportName);

  await navigate(client, viewportName, '/works');
  for (const slug of slugs) {
    await clickSlug(client, viewport, slug);
    const state = await waitForExpanded(client, viewportName, slug);
    check(state.expandedCount === 1, `${viewportName}:works:${slug}:logical-expanded-count`);
    check(state.hashMatches, `${viewportName}:works:${slug}:hash`);
    check(state.gridColumnStart === '1', `${viewportName}:works:${slug}:grid-column`);
    check(state.scrollAligned, `${viewportName}:works:${slug}:scroll-alignment`);
    expandedSlugs[viewportName].push(slug);
  }

  await verifyTransitionSequences(client, viewport);

  await navigate(client, viewportName, '/works#not-a-project');
  const invalidState = await assertAllCollapsed(client, viewportName, 'works:invalid-hash');
  check(invalidState.hash === '#not-a-project', `${viewportName}:works:invalid-hash-mutated`);
  await inspectWorksShell(client, viewportName, '/works#not-a-project');

  await verifyBackForward(client, viewportName);

  for (const slug of slugs) {
    const legacyRoute = `/works/${slug}`;
    const legacyStatuses = await navigate(client, viewportName, legacyRoute, {
      pathname: '/works',
      hash: `#${slug}`,
    });
    await waitForExpanded(client, viewportName, slug, false);
    check(legacyStatuses.includes(307), `${viewportName}:${legacyRoute}:redirect-status`);
    check(legacyStatuses.at(-1) === 200, `${viewportName}:${legacyRoute}:final-status`);
    await inspectWorksShell(client, viewportName, legacyRoute);
  }

  if (screenshotFiles[viewportName]?.works) {
    await navigate(client, viewportName, '/works');
    await clickSlug(client, viewport, 'content-agent');
    await waitForExpanded(client, viewportName, 'content-agent');
    await captureScreenshot(client, viewportName, 'works');
  }
}

async function runViewport(browser, viewport) {
  let client;
  try {
    const pageWebSocketUrl = await openTab(browser.cdpBase);
    client = await createPageClient(pageWebSocketUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Network.enable');
    await client.send('Fetch.enable', {
      patterns: [{ requestStage: 'Request', urlPattern: '*://*/api/access*' }],
    });
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    await client.send('Storage.clearDataForOrigin', {
      origin: targetUrl.origin,
      storageTypes: 'cookies,local_storage,session_storage',
    });
    await client.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height: viewport.height,
      mobile: viewport.width < 640,
      screenHeight: viewport.height,
      screenWidth: viewport.width,
      width: viewport.width,
    });
    await client.send(
      'Emulation.setTouchEmulationEnabled',
      viewport.width < 640
        ? { enabled: true, maxTouchPoints: 5 }
        : { enabled: false },
    );
    await client.send('Emulation.setScrollbarsHidden', { hidden: true });
    await client.send('Emulation.setEmulatedMedia', {
      features: [{
        name: 'prefers-reduced-motion',
        value: viewport.reducedMotion ? 'reduce' : 'no-preference',
      }],
    });

    await inspectHome(client, viewport);
    await inspectWorks(client, viewport);
  } catch (error) {
    addFailure(`${viewport.name}:infrastructure:${failureCode(error)}`);
  } finally {
    if (client) {
      consoleErrors += client.runtime.consoleErrors;
      pageErrors += client.runtime.pageErrors;
      const networkSnapshot = client.networkMonitor.snapshot();
      for (const origin of networkSnapshot.externalOrigins) {
        externalRuntimeRequestSet.add(origin);
      }
      for (const failure of networkSnapshot.failures) {
        addFailure(`${viewport.name}:${failure}`);
      }
      for (const failure of networkSnapshot.httpFailures) {
        addFailure(`${viewport.name}:${failure.route}:http-${failure.status}-${failure.type}`);
      }
    }
    if (client) await closeTab(client);
  }
}

let browser;
let cleanupCoordinator;
let removeSignalHandlers = () => {};
try {
  targetUrl = new URL(argv[2] || 'http://127.0.0.1:3010');
  edgePath = env.S9_EDGE_PATH
    || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  evidenceDir = path.resolve(
    env.S9_EVIDENCE_DIR
      || new URL('../docs/verify/s9/', import.meta.url).pathname.slice(1),
  );
  publicContent = JSON.parse(readFileSync(
    new URL('../content/site-content.json', import.meta.url),
    'utf8',
  ));
  mkdirSync(evidenceDir, { recursive: true });

  cleanupCoordinator = createCleanupCoordinator(async () => {
    if (supervisedProfileDir !== null) return;
    try {
      await cleanupOwnedBrowser(browser, {
        ...cleanupBrowserOptions,
        closeTimeoutMs: CLOSE_TIMEOUT_MS,
      });
    } catch {
      addFailure('browser:owned-cleanup-failed');
    }
  });
  removeSignalHandlers = installSignalCleanup({
    coordinator: cleanupCoordinator,
    exit: (code) => processLike.exit(code),
    processLike,
  });
  browser = await launchBrowser({
    onOwnedBrowser(browserState) {
      browser = browserState;
    },
  });
  for (const viewport of viewports) {
    await runViewport(browser, viewport);
  }
} catch (error) {
  addFailure(`harness:infrastructure:${failureCode(error)}`);
} finally {
  if (cleanupCoordinator) await cleanupCoordinator.run('normal');
  removeSignalHandlers();
}

if (consoleErrors > 0) addFailure('runtime:console-errors');
if (pageErrors > 0) addFailure('runtime:page-errors');
const externalRuntimeRequests = [...externalRuntimeRequestSet].sort();
if (externalRuntimeRequests.length > 0) addFailure('runtime:external-requests');

const screenshotOrder = [
  's9-home-desktop-1440x900.png',
  's9-home-mobile-390x844.png',
  's9-home-mobile-390-reduced.png',
  's9-works-desktop-1440x900.png',
  's9-works-mobile-390x844.png',
  'capability-matrix-desktop-1440.png',
  'capability-matrix-mobile-390.png',
  'capability-matrix-mobile-390-reduced.png',
];
const screenshots = screenshotOrder.flatMap((fileName) => (
  screenshotByName.has(fileName) ? [screenshotByName.get(fileName)] : []
));

const summary = createS9Summary({
  failures,
  screenshots,
  routeStatuses,
  canvasPixelVariance,
  expandedSlugs,
  horizontalOverflow,
  consoleErrors,
  pageErrors,
  externalRuntimeRequests,
});
emitS9Summary(consoleLike, summary);
if (failures.length > 0) {
  processLike.exitCode = 1;
}
return summary;
}

export async function runS9Worker({
  argv = process.argv,
  dependencies = {},
  env = process.env,
  processLike = process,
} = {}) {
  const supervisedProfileDir = argv[4];
  let summary;
  try {
    assertOwnedProfileBoundary(supervisedProfileDir);
    summary = await main({
      argv: [argv[0], argv[1], argv[3]],
      dependencies: {
        ...dependencies,
        consoleLike: { error() {}, log() {} },
      },
      env,
      processLike,
      supervisedProfileDir,
    });
  } catch (error) {
    summary = createS9Summary({
      failures: [publicS9CdpFailureCode(error) ?? 'browser:worker-process-failed'],
    });
  }

  let transportExitCode = 0;
  try {
    processLike.channel?.ref?.();
    await sendS9WorkerSummary(processLike, summary);
  } catch {
    transportExitCode = 1;
  }
  try {
    processLike.disconnect?.();
  } catch {
    // The supervisor owns final failure reporting.
  }
  processLike.exit(transportExitCode);
  return summary;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  if (process.argv[2] === S9_WORKER_FLAG) {
    await runS9Worker();
  } else {
    await runS9Supervisor();
  }
}
