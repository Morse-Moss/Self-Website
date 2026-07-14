#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const targetUrl = new URL(process.argv[2] || 'http://127.0.0.1:3010');
const edgePath = process.env.S9_EDGE_PATH
  || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const evidenceDir = path.resolve(new URL('../docs/verify/s9/', import.meta.url).pathname.slice(1));
const publicContent = JSON.parse(readFileSync(
  new URL('../content/site-content.json', import.meta.url),
  'utf8',
));

const CONNECTION_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 15_000;
const INTERACTION_TIMEOUT_MS = 5_000;
const SCREENSHOT_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 2_000;
const CANVAS_SAMPLE_WIDTH = 160;
const CANVAS_SAMPLE_HEIGHT = 90;

const viewports = [
  { name: 'desktop', width: 1440, height: 900, reducedMotion: false },
  { name: 'mobile', width: 390, height: 844, reducedMotion: false },
  { name: 'mobile-reduced', width: 390, height: 844, reducedMotion: true },
];
const routes = ['/', '/works'];
const slugs = ['content-agent', 'auto-operations', 'deep-research', 'digital-morse'];
const screenshotFiles = {
  desktop: {
    home: 's9-home-desktop-1440x900.png',
    works: 's9-works-desktop-1440x900.png',
  },
  mobile: {
    home: 's9-home-mobile-390x844.png',
    works: 's9-works-mobile-390x844.png',
  },
  'mobile-reduced': {
    home: 's9-home-mobile-390-reduced.png',
  },
};

const failures = [];
const screenshotByName = new Map();
const routeStatuses = [];
const canvasPixelVariance = {};
const expandedSlugs = {};
const horizontalOverflow = [];
let consoleErrors = 0;
let pageErrors = 0;
const externalRuntimeRequestSet = new Set();

mkdirSync(evidenceDir, { recursive: true });

class HarnessError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function failureCode(error) {
  return error instanceof HarnessError ? error.code : 'unexpected';
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

function withTimeout(promise, timeoutMs, code) {
  let timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new HarnessError(code)), timeoutMs);
    }),
  ]);
}

async function reserveDebugPort() {
  const server = createServer();
  try {
    await withTimeout(
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      }),
      CONNECTION_TIMEOUT_MS,
      'browser:debug-port-timeout',
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new HarnessError('browser:debug-port-unavailable');
    }
    return address.port;
  } finally {
    if (server.listening) {
      await withTimeout(
        new Promise((resolve) => server.close(resolve)),
        CLOSE_TIMEOUT_MS,
        'browser:debug-port-close-timeout',
      );
    }
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS),
  });
  if (!response.ok) throw new HarnessError(`cdp:http-${response.status}`);
  return response.json();
}

async function launchBrowser() {
  if (!existsSync(edgePath)) throw new HarnessError('browser:edge-missing');

  const debugPort = await reserveDebugPort();
  const profilePrefix = path.join(os.tmpdir(), 'revolution-s9-edge-');
  const profileDir = mkdtempSync(profilePrefix);
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
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], {
    stdio: 'ignore',
    windowsHide: true,
  });
  browserProcess.on('error', () => {});

  const cdpBase = `http://127.0.0.1:${debugPort}`;
  const browserState = {
    browserProcess,
    browserWebSocketUrl: null,
    cdpBase,
    profileDir,
  };

  try {
    const deadline = Date.now() + CONNECTION_TIMEOUT_MS;
    let version;
    while (!version && Date.now() < deadline) {
      if (browserProcess.exitCode !== null) {
        throw new HarnessError('browser:early-exit');
      }
      try {
        version = await fetchJson(`${cdpBase}/json/version`);
      } catch {
        await delay(75);
      }
    }
    if (!version?.webSocketDebuggerUrl) {
      throw new HarnessError('browser:cdp-readiness-timeout');
    }
    browserState.browserWebSocketUrl = version.webSocketDebuggerUrl;
    return browserState;
  } catch (error) {
    await stopBrowser(browserState);
    throw error;
  }
}

async function connectSocket(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await withTimeout(
    new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new HarnessError('cdp:websocket-error'));
      socket.onclose = () => reject(new HarnessError('cdp:websocket-closed-before-open'));
    }),
    CONNECTION_TIMEOUT_MS,
    'cdp:websocket-timeout',
  );
  return socket;
}

function createCommandClient(socket) {
  let commandId = 0;
  const pending = new Map();

  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message.id || !pending.has(message.id)) return;

    const command = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) command.reject(new HarnessError(`cdp:${command.method}-failed`));
    else command.resolve(message.result ?? {});
  };
  socket.onclose = () => {
    for (const command of pending.values()) {
      command.reject(new HarnessError(`cdp:${command.method}-closed`));
    }
    pending.clear();
  };

  function send(method, params = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) {
        reject(new HarnessError(`cdp:${method}-not-open`));
        return;
      }
      const id = ++commandId;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new HarnessError(`cdp:${method}-timeout`));
      }, timeoutMs);
      pending.set(id, {
        method,
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  return { send };
}

async function stopBrowser(browser) {
  if (!browser) return;

  if (browser.browserWebSocketUrl) {
    try {
      const socket = await connectSocket(browser.browserWebSocketUrl);
      const client = createCommandClient(socket);
      try {
        await client.send('Browser.close', {}, CLOSE_TIMEOUT_MS);
      } catch {
        // Browser.close often closes its own transport before acknowledging.
      } finally {
        if (socket.readyState < WebSocket.CLOSING) socket.close();
      }
    } catch {
      // The owned browser may already have exited after its last page closed.
    }
  }

  try {
    await withTimeout(
      browser.browserProcess.exitCode === null
        ? new Promise((resolve) => browser.browserProcess.once('exit', resolve))
        : Promise.resolve(),
      CLOSE_TIMEOUT_MS,
      'browser:graceful-close-timeout',
    );
  } catch {
    browser.browserProcess.kill();
    try {
      await withTimeout(
        browser.browserProcess.exitCode === null
          ? new Promise((resolve) => browser.browserProcess.once('exit', resolve))
          : Promise.resolve(),
        CLOSE_TIMEOUT_MS,
        'browser:forced-close-timeout',
      );
    } catch {
      addFailure('browser:owned-process-close-failed');
    }
  }

  const resolvedProfile = path.resolve(browser.profileDir);
  const resolvedTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (
    resolvedProfile.startsWith(resolvedTemp)
    && path.basename(resolvedProfile).startsWith('revolution-s9-edge-')
  ) {
    try {
      rmSync(resolvedProfile, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 });
    } catch {
      addFailure('browser:temp-profile-cleanup-failed');
    }
  } else {
    addFailure('browser:temp-profile-boundary-failed');
  }
}

async function openTab(cdpBase) {
  const tab = await fetchJson(`${cdpBase}/json/new?about:blank`, { method: 'PUT' });
  if (!tab.webSocketDebuggerUrl) throw new HarnessError('cdp:new-tab-missing-socket');
  return { socket: await connectSocket(tab.webSocketDebuggerUrl), tab };
}

function createPageClient(socket) {
  let commandId = 0;
  let currentRoute = 'about:blank';
  let navigationInProgress = false;
  let navigationStatuses = [];
  const pending = new Map();
  const runtime = {
    consoleErrors: 0,
    pageErrors: 0,
    externalRuntimeRequests: new Set(),
    httpFailures: [],
  };

  function rejectPending(code) {
    for (const command of pending.values()) {
      command.reject(new HarnessError(`${code}:${command.method}`));
    }
    pending.clear();
  }

  function statusFromResponse(response, type) {
    if (!response?.url) return;
    let responseUrl;
    try {
      responseUrl = new URL(response.url);
    } catch {
      return;
    }
    if (responseUrl.origin !== targetUrl.origin) return;

    const status = Math.round(response.status || 0);
    if (type === 'Document' && status > 0) navigationStatuses.push(status);
    if (status >= 400) runtime.httpFailures.push({ route: currentRoute, status, type });
  }

  async function handleAccessMock(params) {
    let requestUrl;
    try {
      requestUrl = new URL(params.request.url);
    } catch {
      await send('Fetch.continueRequest', { requestId: params.requestId });
      return;
    }

    if (requestUrl.origin === targetUrl.origin && requestUrl.pathname === '/api/access') {
      const body = Buffer.from(JSON.stringify({
        authorized: false,
        expiresAt: null,
        remainingMessages: 0,
      })).toString('base64');
      await send('Fetch.fulfillRequest', {
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

    await send('Fetch.continueRequest', { requestId: params.requestId });
  }

  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      runtime.pageErrors += 1;
      return;
    }

    if (message.id && pending.has(message.id)) {
      const command = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) command.reject(new HarnessError(`cdp:${command.method}-failed`));
      else command.resolve(message.result ?? {});
      return;
    }

    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      runtime.consoleErrors += 1;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      runtime.pageErrors += 1;
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const entry = message.params.entry;
      const exactNavigationAbort = navigationInProgress
        && entry.source === 'network'
        && entry.text === 'Failed to load resource: net::ERR_ABORTED';
      if (!exactNavigationAbort) runtime.consoleErrors += 1;
    }
    if (message.method === 'Network.requestWillBeSent') {
      const requestUrl = message.params.request?.url;
      if (message.params.redirectResponse) {
        statusFromResponse(message.params.redirectResponse, message.params.type);
      }
      if (!requestUrl || requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) return;
      try {
        const requestOrigin = new URL(requestUrl).origin;
        if (requestOrigin !== targetUrl.origin) {
          runtime.externalRuntimeRequests.add(requestOrigin);
        }
      } catch {
        // Browser-internal schemes do not represent page runtime requests.
      }
    }
    if (message.method === 'Network.responseReceived') {
      statusFromResponse(message.params.response, message.params.type);
    }
    if (message.method === 'Fetch.requestPaused') {
      void handleAccessMock(message.params).catch(() => {
        runtime.pageErrors += 1;
      });
    }
  };
  socket.onclose = () => rejectPending('cdp:socket-closed');
  socket.onerror = () => rejectPending('cdp:socket-error');

  function send(method, params = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) {
        reject(new HarnessError(`cdp:${method}-not-open`));
        return;
      }
      const id = ++commandId;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new HarnessError(`cdp:${method}-timeout`));
      }, timeoutMs);
      pending.set(id, {
        method,
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression, timeoutMs = COMMAND_TIMEOUT_MS) {
    const result = await send('Runtime.evaluate', {
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
    beginNavigation(route) {
      currentRoute = route;
      navigationInProgress = true;
      navigationStatuses = [];
    },
    endNavigation() {
      navigationInProgress = false;
      return [...navigationStatuses];
    },
    evaluate,
    runtime,
    send,
  };
}

async function closeTab(client, socket) {
  try {
    await client.send('Page.close', {}, CLOSE_TIMEOUT_MS);
  } catch {
    // Page.close can close its own target transport before responding.
  } finally {
    if (socket.readyState < WebSocket.CLOSING) socket.close();
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
  screenshotByName.set(fileName, `docs/verify/s9/${fileName}`);
}

async function sampleCanvas(client) {
  return client.evaluate(`(async () => {
    const canvas = document.querySelector('[data-testid="morse-signal-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const sampleWidth = ${CANVAS_SAMPLE_WIDTH};
    const sampleHeight = ${CANVAS_SAMPLE_HEIGHT};
    const scratch = document.createElement('canvas');
    scratch.width = sampleWidth;
    scratch.height = sampleHeight;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    const readPixels = () => {
      context.clearRect(0, 0, sampleWidth, sampleHeight);
      context.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);
      const rgba = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
      const pixels = new Float64Array(sampleWidth * sampleHeight);
      for (let rgbaIndex = 0, pixelIndex = 0; rgbaIndex < rgba.length; rgbaIndex += 4, pixelIndex += 1) {
        const luminance = (rgba[rgbaIndex] + rgba[rgbaIndex + 1] + rgba[rgbaIndex + 2]) / 3;
        pixels[pixelIndex] = luminance * (rgba[rgbaIndex + 3] / 255);
      }
      return pixels;
    };

    const first = readPixels();
    await new Promise((resolve) => setTimeout(resolve, 360));
    const second = readPixels();
    const mean = first.reduce((total, value) => total + value, 0) / first.length;
    const variance = first.reduce((total, value) => total + ((value - mean) ** 2), 0) / first.length;
    const frameDifference = first.reduce(
      (total, value, index) => total + Math.abs(value - second[index]),
      0,
    ) / first.length;

    return {
      frameDifference,
      pointerEvents: getComputedStyle(canvas).pointerEvents,
      runningInfiniteAnimations: document.getAnimations()
        .filter((animation) => animation.playState === 'running')
        .filter((animation) => animation.effect?.getTiming().iterations === Infinity)
        .length,
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
    const canvas = document.querySelector('[data-testid="morse-signal-canvas"]');
    const h1 = document.querySelector('#home-title');
    const identity = h1?.parentElement;
    const featured = document.querySelector('#featured-title')?.closest('section');
    const capability = document.querySelector('#capabilities-title');
    const facts = document.querySelector('#facts-title');
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
      capabilityVisible: visible(capability),
      chatCount: document.querySelectorAll('[data-testid="morse-chat"]').length,
      chatEmbedded: chat?.getAttribute('data-variant') === 'embedded',
      factsVisible: visible(facts),
      featuredCount: featured?.querySelectorAll(':scope article').length ?? 0,
      h1Morse: h1?.textContent?.trim() === 'Morse' && visible(h1),
      headerFixed: header ? getComputedStyle(header).position === 'fixed' : false,
      identityChatOverlap: Boolean(identityRect && chatRect && overlaps(identityRect, chatRect)),
      mainClearsHeader: Boolean(headerRect && mainRect && mainRect.top >= headerRect.bottom - 1),
      nextBandVisible: Boolean(featuredRect && featuredRect.top < innerHeight && featuredRect.bottom > 0),
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
  check(state.factsVisible, `${viewportName}:home:development-facts`);
  check(state.nextBandVisible, `${viewportName}:home:next-band-not-visible`);
  check(state.headerFixed && state.mainClearsHeader, `${viewportName}:home:fixed-header-overlap`);
  check(!state.identityChatOverlap, `${viewportName}:home:identity-chat-overlap`);
  check(state.textOverflowCount === 0, `${viewportName}:home:text-overflow`);
  check(state.viewportOverflowCount === 0, `${viewportName}:home:control-overflow`);

  for (const trigger of ['header', 'hero']) {
    const clicked = await client.evaluate(`(() => {
      const button = ${trigger === 'header'
        ? "document.querySelector('header button')"
        : "document.querySelector('#home-title')?.parentElement?.querySelector('button')"};
      if (!(button instanceof HTMLButtonElement)) return false;
      document.querySelector('#morse-invite-code')?.blur();
      button.click();
      return true;
    })()`);
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

  const canvas = await sampleCanvas(client);
  if (!canvas) {
    addFailure(`${viewportName}:home:canvas-sample-missing`);
  } else {
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
      check(canvas.runningInfiniteAnimations === 0, `${viewportName}:home:infinite-animation`);
    } else {
      check(canvas.frameDifference > 0, `${viewportName}:home:canvas-not-moving`);
    }
  }

  await captureScreenshot(client, viewportName, 'home');
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
  check(state.cardCount === 4, `${viewportName}:${route}:card-count`);
  check(state.chatCount === 1, `${viewportName}:${route}:chat-count`);
  check(state.textOverflowCount === 0, `${viewportName}:${route}:text-overflow`);
  check(state.viewportOverflowCount === 0, `${viewportName}:${route}:control-overflow`);
}

async function clickSlug(client, slug) {
  const clicked = await client.evaluate(`(() => {
    const button = document.querySelector(
      '[data-project-slug="${slug}"] button[aria-expanded]'
    );
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new HarnessError(`works:${slug}:toggle-missing`);
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
    await waitFor(client, `(() => {
      const article = document.querySelector('[data-project-slug="${slug}"]');
      if (!(article instanceof HTMLElement)) return false;
      const margin = Number.parseFloat(getComputedStyle(article).scrollMarginTop) || 0;
      return Math.abs(article.getBoundingClientRect().top - margin) <= 12;
    })()`, `${viewportName}:works:${slug}:scroll-margin-timeout`, INTERACTION_TIMEOUT_MS);
  }

  return client.evaluate(`(() => {
    const article = document.querySelector('[data-project-slug="${slug}"]');
    const margin = Number.parseFloat(getComputedStyle(article).scrollMarginTop) || 0;
    return {
      expandedCount: document.querySelectorAll('button[aria-expanded="true"]').length,
      gridColumnStart: getComputedStyle(article).gridColumnStart,
      hashMatches: location.hash === '#${slug}',
      topDelta: Math.abs(article.getBoundingClientRect().top - margin),
    };
  })()`);
}

async function assertAllCollapsed(client, viewportName, label) {
  await waitFor(client, `(() => {
    const buttons = Array.from(document.querySelectorAll('button[aria-expanded]'));
    return buttons.length === 4
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

async function verifyExternalClickIsolation(client, viewportName) {
  const state = await client.evaluate(`(() => {
    const article = document.querySelector('[data-project-slug="deep-research"]');
    const link = article?.querySelector('a[href^="https://"]');
    if (!(link instanceof HTMLAnchorElement)) return { clicked: false };
    const before = location.href;
    let intercepted = false;
    const preventExternalNavigation = (event) => {
      if (event.target instanceof Element && event.target.closest('a[href^="https://"]')) {
        intercepted = true;
        event.preventDefault();
      }
    };
    document.addEventListener('click', preventExternalNavigation, true);
    link.click();
    document.removeEventListener('click', preventExternalNavigation, true);
    return {
      clicked: intercepted,
      expandedCount: document.querySelectorAll('button[aria-expanded="true"]').length,
      locationUnchanged: location.href === before,
    };
  })()`);
  check(state.clicked, `${viewportName}:works:external-click-missing`);
  check(state.locationUnchanged, `${viewportName}:works:external-navigation`);
  check(state.expandedCount === 0, `${viewportName}:works:external-click-toggled-card`);
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
  await clickSlug(client, 'content-agent');
  await waitForExpanded(client, viewportName, 'content-agent');
  await clickSlug(client, 'auto-operations');
  await waitForExpanded(client, viewportName, 'auto-operations');

  await navigate(client, viewportName, '/works');
  await assertAllCollapsed(client, viewportName, 'works:a-b-c-initial');
  await clickSlug(client, 'content-agent');
  await waitFor(
    client,
    'document.querySelectorAll("button[aria-expanded=true]").length === 1',
    `${viewportName}:works:a-b-c-a-timeout`,
  );
  await delay(35);
  await clickSlug(client, 'auto-operations');
  await delay(35);
  await clickSlug(client, 'deep-research');
  await waitForExpanded(client, viewportName, 'deep-research');

  if (!viewport.reducedMotion) {
    await navigate(client, viewportName, '/works');
    await clickSlug(client, 'content-agent');
    await waitForExpanded(client, viewportName, 'content-agent');
    await installScrollObserver(client);
    try {
      await clickSlug(client, 'auto-operations');
      await delay(35);
      await client.send('Input.dispatchMouseEvent', {
        deltaX: 0,
        deltaY: 240,
        type: 'mouseWheel',
        x: Math.floor(viewport.width / 2),
        y: Math.floor(viewport.height / 2),
      });
      await delay(700);
      const wheelState = await client.evaluate(`({
        callCount: globalThis.__s9ScrollCalls?.length ?? -1,
        expandedCount: document.querySelectorAll('button[aria-expanded="true"]').length,
        targetExpanded: document.querySelector(
          '[data-project-slug="auto-operations"] button[aria-expanded="true"]'
        ) !== null,
        wheelEvents: globalThis.__s9WheelEvents ?? 0,
      })`);
      check(wheelState.wheelEvents > 0, `${viewportName}:works:wheel-not-received`);
      check(wheelState.callCount === 0, `${viewportName}:works:wheel-did-not-cancel-final-scroll`);
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
      await clickSlug(client, 'content-agent');
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
    'document.querySelectorAll("[data-project-slug]").length === 4',
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
  for (const [label, state] of Object.entries(privacy)) {
    check(state.images === 0, `${viewportName}:works:${label}:internal-image`);
    check(state.actions === 0, `${viewportName}:works:${label}:internal-action`);
  }

  await verifyExternalClickIsolation(client, viewportName);
  await verifyKeyboard(client, viewportName);

  await navigate(client, viewportName, '/works');
  for (const slug of slugs) {
    await clickSlug(client, slug);
    const state = await waitForExpanded(client, viewportName, slug);
    check(state.expandedCount === 1, `${viewportName}:works:${slug}:logical-expanded-count`);
    check(state.hashMatches, `${viewportName}:works:${slug}:hash`);
    check(state.gridColumnStart === '1', `${viewportName}:works:${slug}:grid-column`);
    check(state.topDelta <= 12, `${viewportName}:works:${slug}:scroll-margin`);
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
    await clickSlug(client, 'deep-research');
    await waitForExpanded(client, viewportName, 'deep-research');
    await captureScreenshot(client, viewportName, 'works');
  }
}

async function runViewport(browser, viewport) {
  let socket;
  let client;
  try {
    ({ socket } = await openTab(browser.cdpBase));
    client = createPageClient(socket);
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
      for (const origin of client.runtime.externalRuntimeRequests) {
        externalRuntimeRequestSet.add(origin);
      }
      for (const failure of client.runtime.httpFailures) {
        addFailure(`${viewport.name}:${failure.route}:http-${failure.status}-${failure.type}`);
      }
    }
    if (client && socket) await closeTab(client, socket);
    else if (socket?.readyState < WebSocket.CLOSING) socket.close();
  }
}

let browser;
try {
  browser = await launchBrowser();
  for (const viewport of viewports) {
    await runViewport(browser, viewport);
  }
} catch (error) {
  addFailure(`harness:infrastructure:${failureCode(error)}`);
} finally {
  await stopBrowser(browser);
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
];
const screenshots = screenshotOrder.flatMap((fileName) => (
  screenshotByName.has(fileName) ? [screenshotByName.get(fileName)] : []
));

const summary = {
  failures,
  screenshots,
  routeStatuses,
  canvasPixelVariance,
  expandedSlugs,
  horizontalOverflow,
  consoleErrors,
  pageErrors,
  externalRuntimeRequests,
};
console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) process.exitCode = 1;
