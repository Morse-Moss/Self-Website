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
import { pathToFileURL } from 'node:url';

import {
  assertConsecutiveAnimationFramesQuiet,
  cleanupOwnedBrowser,
  connectCdpTransport,
  countRunningAnimations,
  createCleanupCoordinator,
  createNetworkMonitor,
  createS9Summary,
  dispatchPrimaryClick,
  installSignalCleanup,
  publicS9CdpFailureCode,
  waitForOwnedDevToolsActivePort,
} from './lib/s9-cdp.mjs';

function isDirectExecution(metaUrl, argvPath) {
  return typeof argvPath === 'string'
    && pathToFileURL(path.resolve(argvPath)).href === metaUrl;
}

export async function main({
  argv = process.argv,
  dependencies = {},
  env = process.env,
  processLike = process,
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
  const profileDir = makeProfile(profilePrefix);
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

async function clickSlug(client, viewport, slug) {
  const selector = `[data-project-slug="${slug}"] button[aria-expanded]`;
  await waitForPointerTargetStable(
    client,
    selector,
    `works:${slug}:pointer-target-stability-timeout`,
  );
  const clicked = await clickSelector(
    client,
    viewport,
    selector,
  );
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

async function waitForStaleDetailsRemoved(client, viewportName, activeSlug, label) {
  await waitFor(client, `Array.from(document.querySelectorAll('[data-project-details]')).every(
    (details) => details.closest('[data-project-slug]')?.getAttribute('data-project-slug')
      === ${JSON.stringify(activeSlug)}
  )`, `${viewportName}:works:${label}:stale-details-timeout`);
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

async function verifyExternalClickIsolation(client, viewport) {
  const viewportName = viewport.name;
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
      const targetCollapsed = article?.getAttribute('data-expanded') === 'false';
      return { clicked, expandedCount, locationUnchanged, targetCollapsed };
    })()`);
  }
  if (!state) {
    addFailure(`${viewportName}:works:external-guard-state`);
    return;
  }
  check(state.clicked, `${viewportName}:works:external-click-missing`);
  check(state.locationUnchanged, `${viewportName}:works:external-navigation`);
  check(
    state.expandedCount === 0 && state.targetCollapsed,
    `${viewportName}:works:external-click-toggled-card`,
  );
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
  await clickSlug(client, viewport, 'content-agent');
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
  await clickSlug(client, viewport, 'auto-operations');
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
      await clickSlug(client, viewport, 'auto-operations');
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

  await verifyExternalClickIsolation(client, viewport);
  await verifyKeyboard(client, viewportName);

  await navigate(client, viewportName, '/works');
  for (const slug of slugs) {
    await clickSlug(client, viewport, slug);
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
    await clickSlug(client, viewport, 'deep-research');
    await waitForExpanded(client, viewportName, 'deep-research');
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
  evidenceDir = path.resolve(new URL('../docs/verify/s9/', import.meta.url).pathname.slice(1));
  publicContent = JSON.parse(readFileSync(
    new URL('../content/site-content.json', import.meta.url),
    'utf8',
  ));
  mkdirSync(evidenceDir, { recursive: true });

  cleanupCoordinator = createCleanupCoordinator(async () => {
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
consoleLike.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) {
  consoleLike.error('S9_VISUAL_SMOKE_FAILED');
  processLike.exitCode = 1;
}
return summary;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  await main();
}
