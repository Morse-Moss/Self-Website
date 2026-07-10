#!/usr/bin/env node
// S3 local visual smoke via the shared Edge CDP endpoint on 127.0.0.1:9222.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const targetUrl = process.argv[2] || 'http://127.0.0.1:3000';
const cdpBase = process.env.CDP_BASE || 'http://127.0.0.1:9222';
const outDir = path.join(os.tmpdir(), 'revolution-s3-smoke');
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openTab() {
  const res = await fetch(`${cdpBase}/json/new?about:blank`, { method: 'PUT' });
  if (!res.ok) throw new Error(`CDP new tab failed: ${res.status}`);
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return { tab, ws };
}

function createClient(ws) {
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  const pageErrors = [];

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(JSON.stringify(message.params.args?.map((arg) => arg.value ?? arg.description ?? '')).slice(0, 400));
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push(message.params.entry.text?.slice(0, 400));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push((message.params.exceptionDetails?.text ?? 'exception').slice(0, 400));
    }
  };

  const send = (method, params = {}) => new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });

  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return response.result?.result?.value;
  };

  const screenshot = async (fileName) => {
    const capture = await capturePng(fileName);
    return capture.filePath;
  };

  const capturePng = async (fileName) => {
    await send('Page.bringToFront');
    await sleep(300);
    const response = await send('Page.captureScreenshot', { format: 'png' });
    const filePath = path.join(outDir, fileName);
    const data = response.result.data;
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    return { filePath, data };
  };

  return { send, evaluate, screenshot, capturePng, consoleErrors, pageErrors };
}

async function inspectViewport(options) {
  const { ws } = await openTab();
  const client = createClient(ws);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: options.width,
    height: options.height,
    deviceScaleFactor: options.width <= 430 ? 3 : 1,
    mobile: options.width <= 430,
  });
  await client.send('Emulation.setTouchEmulationEnabled', {
    enabled: options.width <= 430,
    maxTouchPoints: options.width <= 430 ? 5 : 0,
  });
  await client.send('Emulation.setEmulatedMedia', {
    features: options.reducedMotion ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [],
  });

  await client.send('Page.navigate', { url: targetUrl });
  await sleep(900);
  await client.evaluate(`localStorage.removeItem('morse.resumeMode')`);
  await client.send('Page.reload', { ignoreCache: false });
  await sleep(options.reducedMotion ? 1800 : 3200);
  await client.evaluate(`window.scrollTo(0, 0)`);
  await sleep(500);

  const initial = JSON.parse(await client.evaluate(`JSON.stringify({
    title: document.title,
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    hasGallery: document.body.textContent.includes('系统展厅'),
    hasLedger: document.body.textContent.includes('杠杆账本'),
    hasRealStats: document.body.textContent.includes('真实统计'),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    coarse: matchMedia('(pointer: coarse)').matches,
    unrevealedCount: document.querySelectorAll('[data-reveal]:not([data-revealed])').length
  })`));

  const heroPath = await client.screenshot(`${options.name}-hero.png`);
  let reducedStill = null;
  let reducedStillPaths = null;
  if (options.reducedMotion) {
    await client.evaluate(`window.scrollTo(0, 0)`);
    await sleep(600);
    const stillA = await client.capturePng(`${options.name}-still-a.png`);
    await sleep(1400);
    const stillB = await client.capturePng(`${options.name}-still-b.png`);
    reducedStill = stillA.data === stillB.data;
    reducedStillPaths = { a: stillA.filePath, b: stillB.filePath };
  }

  await client.evaluate(`document.querySelector('#ledger')?.scrollIntoView({ block: 'start' })`);
  await sleep(options.reducedMotion ? 500 : 1200);
  const ledgerPath = await client.screenshot(`${options.name}-ledger.png`);

  await client.evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('简历模式'))?.click()`);
  await sleep(500);
  const resume = JSON.parse(await client.evaluate(`JSON.stringify({
    bodyClass: document.documentElement.classList.contains('resume-mode') || document.body.classList.contains('resume-mode'),
    storageValue: localStorage.getItem('morse.resumeMode'),
    standardHidden: getComputedStyle(document.querySelector('[data-standard-content]')).display === 'none',
    resumeVisible: getComputedStyle(document.querySelector('[data-resume-section]')).display !== 'none',
    printButton: document.body.innerText.includes('打印 / 存 PDF'),
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  })`));
  const resumePath = await client.screenshot(`${options.name}-resume.png`);

  try {
    await client.send('Page.close');
  } catch {
    ws.close();
  }

  return {
    name: options.name,
    initial,
    resume,
    reducedStill,
    consoleErrors: client.consoleErrors,
    pageErrors: client.pageErrors,
    screenshots: { heroPath, ledgerPath, resumePath, reducedStillPaths },
  };
}

const results = [];
results.push(await inspectViewport({ name: 'desktop-1440', width: 1440, height: 920 }));
results.push(await inspectViewport({ name: 'mobile-390', width: 390, height: 844 }));
results.push(await inspectViewport({ name: 'mobile-390-reduced', width: 390, height: 844, reducedMotion: true }));

const failures = [];
for (const result of results) {
  if (result.consoleErrors.length) failures.push(`${result.name}: console errors: ${result.consoleErrors.join(' | ')}`);
  if (result.pageErrors.length) failures.push(`${result.name}: page errors: ${result.pageErrors.join(' | ')}`);
  if (result.initial.horizontalOverflow > 1) failures.push(`${result.name}: horizontal overflow ${result.initial.horizontalOverflow}`);
  if (!result.initial.hasGallery) failures.push(`${result.name}: missing gallery text`);
  if (!result.initial.hasLedger) failures.push(`${result.name}: missing ledger text`);
  if (!result.initial.hasRealStats) failures.push(`${result.name}: missing real stats label`);
  if (result.initial.reducedMotion && result.initial.unrevealedCount !== 0) {
    failures.push(`${result.name}: reduced-motion left ${result.initial.unrevealedCount} unrevealed nodes`);
  }
  if (result.initial.reducedMotion && result.reducedStill !== true) {
    failures.push(`${result.name}: reduced-motion frames differ`);
  }
  if (!result.resume.bodyClass || result.resume.storageValue !== 'true') failures.push(`${result.name}: resume mode did not persist`);
  if (!result.resume.standardHidden || !result.resume.resumeVisible) failures.push(`${result.name}: resume display switch failed`);
  if (!result.resume.printButton) failures.push(`${result.name}: missing print button`);
  if (result.resume.horizontalOverflow > 1) failures.push(`${result.name}: resume horizontal overflow ${result.resume.horizontalOverflow}`);
}

console.log(JSON.stringify({ outDir, results, failures }, null, 2));
if (failures.length) process.exitCode = 1;
