#!/usr/bin/env node
// S6-restored homepage plus retained works routes through a local Chromium CDP endpoint.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const targetUrl = new URL(process.argv[2] || 'http://127.0.0.1:3010');
const cdpBase = process.env.CDP_BASE || 'http://127.0.0.1:9222';
const outDir = path.resolve(
  process.env.S6_RESTORE_EVIDENCE_DIR || path.join(os.tmpdir(), 'revolution-s6-restore-smoke'),
);
const CONNECTION_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 1_000;

const routes = [
  '/',
  '/works',
  '/works/content-agent',
  '/works/auto-operations',
  '/works/deep-research',
  '/works/digital-morse',
];
const caseRoutes = routes.slice(2);
const expectedExternalHrefs = [
  'https://aitavix.com/',
  'https://github.com/Morse-Moss/Deep-research-sys',
  'https://github.com/Morse-Moss/Self-Website',
];
const screenshotNames = {
  desktop: new Map([
    ['/', 'home-desktop-1440x900.png'],
    ['/works', 'works-desktop-1440x900.png'],
    ['/works/auto-operations', 'auto-operations-desktop-1440x900.png'],
  ]),
  mobile: new Map([
    ['/', 'home-mobile-390x844.png'],
    ['/works', 'works-mobile-390x844.png'],
    ['/works/auto-operations', 'auto-operations-mobile-390x844.png'],
  ]),
  mid: new Map(),
};

fs.mkdirSync(outDir, { recursive: true });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function openTab() {
  const response = await fetch(`${cdpBase}/json/new?about:blank`, {
    method: 'PUT',
    signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`CDP new tab failed: ${response.status}`);
  }
  const tab = await response.json();
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.onopen = null;
      socket.onerror = null;
      socket.onclose = null;
      callback(value);
    };
    const timeout = setTimeout(() => {
      finish(reject, new Error('CDP WebSocket connection timed out'));
      socket.close();
    }, CONNECTION_TIMEOUT_MS);
    socket.onopen = () => finish(resolve);
    socket.onerror = () => finish(reject, new Error('CDP WebSocket connection failed'));
    socket.onclose = (event) => finish(
      reject,
      new Error(`CDP WebSocket closed before opening: ${event.code}`),
    );
  });
  return { socket, tab };
}

function createClient(socket) {
  let commandId = 0;
  let currentRoute = 'about:blank';
  const pending = new Map();
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const externalRequests = [];
  const documentStatuses = new Map();

  const rejectPending = (error) => {
    for (const command of pending.values()) command.reject(error);
    pending.clear();
  };

  socket.onclose = (event) => {
    rejectPending(new Error(`CDP WebSocket closed: ${event.code}`));
  };
  socket.onerror = () => {
    rejectPending(new Error('CDP WebSocket failed'));
  };

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { reject, resolve } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message);
      return;
    }

    if (message.method === 'Runtime.consoleAPICalled') {
      const rendered = (message.params.args || [])
        .map((argument) => argument.value ?? argument.description ?? '')
        .join(' ')
        .slice(0, 500);
      if (message.params.type === 'error') consoleErrors.push(`${currentRoute}: ${rendered}`);
      if (message.params.type === 'warning') consoleWarnings.push(`${currentRoute}: ${rendered}`);
    }
    if (message.method === 'Log.entryAdded') {
      const rendered = `${currentRoute}: ${message.params.entry.text || ''}`.slice(0, 500);
      if (message.params.entry.level === 'error') consoleErrors.push(rendered);
      if (message.params.entry.level === 'warning') consoleWarnings.push(rendered);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params.exceptionDetails;
      pageErrors.push(`${currentRoute}: ${detail?.exception?.description || detail?.text || 'exception'}`.slice(0, 500));
    }
    if (message.method === 'Network.requestWillBeSent') {
      const requestUrl = message.params.request?.url;
      if (!requestUrl || requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) return;
      const requestOrigin = new URL(requestUrl).origin;
      if (requestOrigin !== targetUrl.origin) externalRequests.push(`${currentRoute}: ${requestUrl}`);
    }
    if (message.method === 'Network.responseReceived' && message.params.type === 'Document') {
      const responseUrl = message.params.response?.url;
      if (responseUrl && new URL(responseUrl).origin === targetUrl.origin) {
        documentStatuses.set(currentRoute, message.params.response.status);
      }
    }
  };

  const send = (method, params = {}, timeoutMs = COMMAND_TIMEOUT_MS) => new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error(`CDP WebSocket is not open for ${method}`));
      return;
    }
    const id = ++commandId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP command timed out: ${method}`));
    }, timeoutMs);
    pending.set(id, {
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
      resolve: (message) => {
        clearTimeout(timeout);
        resolve(message);
      },
    });
    try {
      socket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      pending.delete(id);
      clearTimeout(timeout);
      reject(error);
    }
  });

  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const result = response.result?.result;
    if (result?.subtype === 'error') throw new Error(result.description || 'Runtime.evaluate failed');
    return result?.value;
  };

  const navigate = async (route) => {
    currentRoute = route;
    documentStatuses.delete(route);
    await send('Page.navigate', { url: new URL(route, targetUrl).href });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await evaluate('document.readyState')) {
        const readyState = await evaluate('document.readyState');
        if (readyState === 'complete') break;
      }
      await sleep(100);
    }
    await evaluate(`document.fonts?.ready.then(() => true) ?? true`);
    await sleep(250);
    await evaluate('window.scrollTo(0, 0)');
  };

  const captureFrame = async () => {
    await send('Page.bringToFront');
    await sleep(150);
    const response = await send('Page.captureScreenshot', { format: 'png' });
    return response.result.data;
  };

  const capturePng = async (fileName) => {
    const data = await captureFrame();
    const filePath = path.join(outDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    return { data, filePath };
  };

  return {
    capturePng,
    captureFrame,
    consoleErrors,
    consoleWarnings,
    documentStatuses,
    evaluate,
    externalRequests,
    navigate,
    pageErrors,
    send,
  };
}

async function closeTab(client, socket) {
  try {
    await client.send('Page.close', {}, CLOSE_TIMEOUT_MS);
  } catch {
    // The page socket can close before Chromium acknowledges Page.close.
  } finally {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
}

async function inspectRoute(client, route, screenshotName) {
  await client.navigate(route);
  const state = JSON.parse(await client.evaluate(`JSON.stringify((() => {
    const targetOrigin = ${JSON.stringify(targetUrl.origin)};
    const images = Array.from(document.images).map((image) => ({
      alt: image.alt,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight
    }));
    const externalLinks = Array.from(document.querySelectorAll('a[href]'))
      .filter((link) => new URL(link.href, location.href).origin !== targetOrigin)
      .map((link) => ({ href: link.href, target: link.target, rel: link.rel }));
    const resumeToggle = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === '简历模式');
    const resumeRect = resumeToggle?.getBoundingClientRect();
    const resumeHit = resumeRect
      ? document.elementFromPoint(
        resumeRect.left + resumeRect.width / 2,
        resumeRect.top + resumeRect.height / 2
      )
      : null;
    const chatRoot = document.querySelector('[data-testid="morse-chat"]');
    const chatLauncher = chatRoot?.querySelector('button');
    const chatRect = chatLauncher?.getBoundingClientRect();
    const overlaps = (first, second) => (
      first.left < second.right
      && first.right > second.left
      && first.top < second.bottom
      && first.bottom > second.top
    );
    const chatOverlapTargets = chatRect
      ? Array.from(document.querySelectorAll('h1, h2, h3, p, a, button, img, dt, dd'))
        .filter((element) => !chatRoot?.contains(element))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const inViewport = rect.width > 0
            && rect.height > 0
            && rect.bottom > 0
            && rect.right > 0
            && rect.top < innerHeight
            && rect.left < innerWidth;
          const visible = typeof element.checkVisibility === 'function'
            ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : getComputedStyle(element).visibility !== 'hidden';
          return inViewport && visible && overlaps(chatRect, rect);
        })
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          text: (element.getAttribute('alt') || element.textContent || '').trim().slice(0, 80),
        }))
      : [];
    return {
      path: location.pathname,
      title: document.title,
      hasHeader: Boolean(document.querySelector('header')),
      hasFooter: Boolean(document.querySelector('[data-site-footer]')),
      hasResumeToggle: Boolean(resumeToggle),
      resumeToggleHit: Boolean(resumeToggle && resumeHit?.closest('button') === resumeToggle),
      chatCount: document.querySelectorAll('[data-testid="morse-chat"]').length,
      chatOverlapCount: chatOverlapTargets.length,
      chatOverlapTargets,
      homeSignals: ['数字生命摩斯', '系统展厅', '杠杆账本', '高频问题']
        .every((label) => document.body.textContent?.includes(label)),
      nextSectionHint: location.pathname !== '/' || (() => {
        const systemsHeading = document.querySelector('#systems h2');
        if (!systemsHeading) return false;
        const revealNode = systemsHeading.closest('[data-reveal]');
        const revealStyle = getComputedStyle(revealNode || systemsHeading);
        const headingRect = systemsHeading.getBoundingClientRect();
        return Boolean(
          headingRect.bottom <= window.innerHeight
          && revealStyle.visibility !== 'hidden'
          && Number.parseFloat(revealStyle.opacity) >= 0.99,
        );
      })(),
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      caseLinks: Array.from(document.querySelectorAll('a[href^="/works/"]'))
        .map((link) => new URL(link.href, location.href).pathname),
      externalLinks,
      images,
      placeholderCount: Array.from(document.querySelectorAll('[role="img"]'))
        .filter((element) => element.textContent?.includes('截图待补')).length,
      bodyHasPlaceholder: document.body.textContent?.includes('截图待补') || false
    };
  })())`));
  state.documentStatus = client.documentStatuses.get(route) ?? null;

  const screenshot = screenshotName ? await client.capturePng(screenshotName) : null;
  return { route, screenshot: screenshot?.filePath || null, state };
}

async function verifyChatInteraction(client) {
  await client.navigate('/');
  const opened = await client.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.trim() === '问数字摩斯');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await sleep(100);
  const dialogVisible = await client.evaluate(`Boolean(document.querySelector('[role="dialog"]'))`);
  const closed = await client.evaluate(`(() => {
    const button = document.querySelector('button[aria-label="关闭对话"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await sleep(100);
  const launcherReady = await client.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const launcher = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === '对话');
    return !dialog && Boolean(launcher) && !launcher.disabled;
  })()`);
  return { opened, dialogVisible, closed, launcherReady };
}

async function runViewport({ height, key, mobile, width }) {
  const { socket } = await openTab();
  const client = createClient(socket);
  const results = [];
  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Network.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    await client.send(
      'Emulation.setTouchEmulationEnabled',
      mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
    );

    for (const route of routes) {
      results.push(await inspectRoute(client, route, screenshotNames[key].get(route)));
    }
    const chat = key === 'desktop' ? await verifyChatInteraction(client) : null;
    return {
      chat,
      consoleErrors: client.consoleErrors,
      consoleWarnings: client.consoleWarnings,
      externalRequests: client.externalRequests,
      key,
      pageErrors: client.pageErrors,
      results,
    };
  } finally {
    await closeTab(client, socket);
  }
}

async function runReducedMotion() {
  const { socket } = await openTab();
  const client = createClient(socket);
  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await client.send('Emulation.setScrollbarsHidden', { hidden: true });
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await client.navigate('/');
    const state = JSON.parse(await client.evaluate(`JSON.stringify({
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      runningInfiniteAnimations: document.getAnimations()
        .filter((animation) => animation.playState === 'running')
        .filter((animation) => animation.effect?.getTiming().iterations === Infinity)
        .length
    })`));
    const stillA = await client.capturePng('home-mobile-390-reduced.png');
    await sleep(1400);
    const stillB = await client.captureFrame();
    const byteIdenticalAfter1400ms = stillA.data === stillB;
    return {
      consoleErrors: client.consoleErrors,
      consoleWarnings: client.consoleWarnings,
      pageErrors: client.pageErrors,
      screenshot: stillA.filePath,
      state: { ...state, byteIdenticalAfter1400ms },
    };
  } finally {
    await closeTab(client, socket);
  }
}

function collectFailures(desktop, mid, mobile, reduced) {
  const failures = [];
  const expectedCaseSet = [...caseRoutes].sort();
  for (const viewport of [desktop, mid, mobile]) {
    failures.push(...viewport.consoleErrors.map((error) => `${viewport.key}: console error: ${error}`));
    failures.push(...viewport.consoleWarnings.map((warning) => `${viewport.key}: console warning: ${warning}`));
    failures.push(...viewport.pageErrors.map((error) => `${viewport.key}: page error: ${error}`));
    failures.push(...viewport.externalRequests.map((request) => `${viewport.key}: external runtime request: ${request}`));

    for (const result of viewport.results) {
      const { route, state } = result;
      if (state.documentStatus !== 200) {
        failures.push(`${viewport.key} ${route}: document status is ${state.documentStatus}`);
      }
      if (state.path !== route) failures.push(`${viewport.key} ${route}: pathname is ${state.path}`);
      if (!state.title) failures.push(`${viewport.key} ${route}: missing title`);
      if (route === '/' && !state.homeSignals) {
        failures.push(`${viewport.key} ${route}: missing restored S6 homepage signals`);
      }
      if (route === '/' && !state.nextSectionHint) {
        failures.push(`${viewport.key} ${route}: next section heading is not fully visible in the first viewport`);
      }
      if (!state.hasHeader || !state.hasFooter || !state.hasResumeToggle || state.chatCount !== 1) {
        failures.push(`${viewport.key} ${route}: missing global shell or unique chat`);
      }
      if (!state.resumeToggleHit) {
        failures.push(`${viewport.key} ${route}: resume toggle is visually obstructed`);
      }
      if (state.chatOverlapCount > 0) {
        failures.push(
          `${viewport.key} ${route}: chat launcher overlaps ${JSON.stringify(state.chatOverlapTargets)}`,
        );
      }
      if (state.horizontalOverflow > 1) {
        failures.push(`${viewport.key} ${route}: horizontal overflow ${state.horizontalOverflow}`);
      }
      if (state.images.some((image) => !image.complete || image.naturalWidth === 0)) {
        failures.push(`${viewport.key} ${route}: an image did not load`);
      }
      for (const link of state.externalLinks) {
        if (!expectedExternalHrefs.includes(link.href)) {
          failures.push(`${viewport.key} ${route}: unexpected external CTA ${link.href}`);
        }
        if (link.target !== '_blank' || !link.rel.split(/\s+/).includes('noreferrer')) {
          failures.push(`${viewport.key} ${route}: unsafe external CTA attributes ${link.href}`);
        }
      }
      if (route === '/' || route === '/works') {
        const actualCaseSet = [...new Set(state.caseLinks)].sort();
        if (JSON.stringify(actualCaseSet) !== JSON.stringify(expectedCaseSet)) {
          failures.push(`${viewport.key} ${route}: case links ${actualCaseSet.join(', ')}`);
        }
      } else if (state.caseLinks.length) {
        failures.push(`${viewport.key} ${route}: case page links to itself`);
      }
      if (route === '/works/auto-operations') {
        const image = state.images.find((candidate) => candidate.alt.includes('自动运营'));
        if (!image?.complete || image.naturalWidth !== 510 || image.naturalHeight !== 580) {
          failures.push(`${viewport.key} ${route}: approved image is not loaded at 510x580`);
        }
      } else if (caseRoutes.includes(route) && !state.bodyHasPlaceholder) {
        failures.push(`${viewport.key} ${route}: missing honest screenshot placeholder`);
      }
    }
  }

  if (!desktop.chat?.opened || !desktop.chat.dialogVisible || !desktop.chat.closed || !desktop.chat.launcherReady) {
    failures.push('desktop /: chat open/close interaction failed');
  }
  failures.push(...reduced.consoleErrors.map((error) => `reduced: console error: ${error}`));
  failures.push(...reduced.consoleWarnings.map((warning) => `reduced: console warning: ${warning}`));
  failures.push(...reduced.pageErrors.map((error) => `reduced: page error: ${error}`));
  if (!reduced.state.reducedMotion) failures.push('reduced: media query did not match');
  if (reduced.state.runningInfiniteAnimations !== 0) failures.push('reduced: running infinite animation found');
  if (reduced.state.horizontalOverflow > 1) failures.push('reduced: horizontal overflow');
  if (!reduced.state.byteIdenticalAfter1400ms) failures.push('reduced: frames differ after 1400ms');
  return failures;
}

try {
  const desktop = await runViewport({ key: 'desktop', width: 1440, height: 900, mobile: false });
  const mid = await runViewport({ key: 'mid', width: 600, height: 900, mobile: true });
  const mobile = await runViewport({ key: 'mobile', width: 390, height: 844, mobile: true });
  const reduced = await runReducedMotion();
  const failures = collectFailures(desktop, mid, mobile, reduced);

  console.log(JSON.stringify({ outDir, desktop, mid, mobile, reduced, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} catch (error) {
  const infrastructureFailure = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ outDir, infrastructureFailure }, null, 2));
  process.exitCode = 1;
}
