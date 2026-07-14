#!/usr/bin/env node
// S7 multipage production acceptance through a local Chromium CDP endpoint.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const targetUrl = new URL(process.argv[2] || 'http://127.0.0.1:3010');
const cdpBase = process.env.CDP_BASE || 'http://127.0.0.1:9222';
const outDir = path.resolve(
  process.env.S7_EVIDENCE_DIR || path.join(os.tmpdir(), 'revolution-s7-smoke'),
);

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
    ['/', 's7-home-desktop-1440.png'],
    ['/works', 's7-works-desktop-1440.png'],
    ['/works/auto-operations', 's7-auto-operations-desktop-1440.png'],
  ]),
  mobile: new Map([
    ['/', 's7-home-mobile-390.png'],
    ['/works', 's7-works-mobile-390.png'],
    ['/works/auto-operations', 's7-auto-operations-mobile-390.png'],
  ]),
};

fs.mkdirSync(outDir, { recursive: true });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function openTab() {
  const response = await fetch(`${cdpBase}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) {
    throw new Error(`CDP new tab failed: ${response.status}`);
  }
  const tab = await response.json();
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
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
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { reject, resolve });
    socket.send(JSON.stringify({ id, method, params }));
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
    evaluate,
    externalRequests,
    navigate,
    pageErrors,
    send,
  };
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
    return {
      path: location.pathname,
      title: document.title,
      hasHeader: Boolean(document.querySelector('header')),
      hasFooter: Boolean(document.querySelector('[data-site-footer]')),
      hasResumeToggle: Boolean(resumeToggle),
      resumeToggleHit: Boolean(resumeToggle && resumeHit?.closest('button') === resumeToggle),
      chatCount: document.querySelectorAll('[data-testid="morse-chat"]').length,
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
    try {
      await client.send('Page.close');
    } catch {
      socket.close();
    }
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
    const stillA = await client.capturePng('s7-home-mobile-390-reduced.png');
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
    try {
      await client.send('Page.close');
    } catch {
      socket.close();
    }
  }
}

function collectFailures(desktop, mobile, reduced) {
  const failures = [];
  const expectedCaseSet = [...caseRoutes].sort();
  for (const viewport of [desktop, mobile]) {
    failures.push(...viewport.consoleErrors.map((error) => `${viewport.key}: console error: ${error}`));
    failures.push(...viewport.consoleWarnings.map((warning) => `${viewport.key}: console warning: ${warning}`));
    failures.push(...viewport.pageErrors.map((error) => `${viewport.key}: page error: ${error}`));
    failures.push(...viewport.externalRequests.map((request) => `${viewport.key}: external runtime request: ${request}`));

    for (const result of viewport.results) {
      const { route, state } = result;
      if (state.path !== route) failures.push(`${viewport.key} ${route}: pathname is ${state.path}`);
      if (!state.title) failures.push(`${viewport.key} ${route}: missing title`);
      if (!state.hasHeader || !state.hasFooter || !state.hasResumeToggle || state.chatCount !== 1) {
        failures.push(`${viewport.key} ${route}: missing global shell or unique chat`);
      }
      if (!state.resumeToggleHit) {
        failures.push(`${viewport.key} ${route}: resume toggle is visually obstructed`);
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

const desktop = await runViewport({ key: 'desktop', width: 1440, height: 900, mobile: false });
const mobile = await runViewport({ key: 'mobile', width: 390, height: 844, mobile: true });
const reduced = await runReducedMotion();
const failures = collectFailures(desktop, mobile, reduced);

console.log(JSON.stringify({ outDir, desktop, mobile, reduced, failures }, null, 2));
if (failures.length) process.exitCode = 1;
