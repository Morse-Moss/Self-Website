#!/usr/bin/env node

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import pg from 'pg';

import { projectSlugs } from '../lib/site-content.ts';

const targetUrl = new URL(process.argv[2] || 'http://127.0.0.1:3011');
const cdpBase = process.env.CDP_BASE || 'http://127.0.0.1:9222';
const inviteCode = process.env.MORSE_SMOKE_INVITE_CODE?.trim();
const expiredInviteCode = process.env.MORSE_SMOKE_EXPIRED_INVITE_CODE?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
const outDir = path.resolve(process.env.S8_EVIDENCE_DIR || 'docs/verify/s8');

if (!inviteCode) throw new Error('MORSE_SMOKE_INVITE_CODE is required.');
if (!expiredInviteCode) throw new Error('MORSE_SMOKE_EXPIRED_INVITE_CODE is required.');
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
fs.mkdirSync(outDir, { recursive: true });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const { Client } = pg;

async function openTab() {
  const response = await fetch(`${cdpBase}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`CDP new tab failed: ${response.status}`);
  const tab = await response.json();
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  return socket;
}

async function listTabs() {
  const response = await fetch(`${cdpBase}/json/list`);
  if (!response.ok) throw new Error(`CDP tab list failed: ${response.status}`);
  return response.json();
}

async function closeTabTarget(targetId) {
  const response = await fetch(`${cdpBase}/json/close/${encodeURIComponent(targetId)}`);
  if (!response.ok) throw new Error(`CDP tab close failed: ${response.status}`);
}

function createClient(socket) {
  let commandId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const expectedAccessErrors = [];
  const pageErrors = [];

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { reject, resolve } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push((message.params.args || [])
        .map((argument) => argument.value ?? argument.description ?? '')
        .join(' ')
        .slice(0, 300));
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const entry = message.params.entry;
      const text = String(entry.text || '').slice(0, 300);
      let isExpectedAccessError = false;
      try {
        const pathname = new URL(entry.url).pathname;
        isExpectedAccessError = entry.source === 'network'
          && text.includes('401')
          && ['/api/access', '/api/chat'].includes(pathname);
      } catch {
        // Missing or malformed log URLs remain ordinary console errors.
      }
      if (isExpectedAccessError) expectedAccessErrors.push(true);
      else consoleErrors.push(text);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params.exceptionDetails;
      pageErrors.push(String(detail?.exception?.description || detail?.text || 'exception').slice(0, 300));
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

  return { consoleErrors, evaluate, expectedAccessErrors, pageErrors, send };
}

async function waitFor(client, expression, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await client.evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function navigate(client, route) {
  await client.send('Page.navigate', { url: new URL(route, targetUrl).href });
  await waitFor(client, `document.readyState === 'complete'`, `${route} load`);
  await client.evaluate(`document.fonts?.ready.then(() => true) ?? true`);
  await sleep(150);
}

async function clickButton(client, text) {
  const clicked = await client.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(text)});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Button unavailable: ${text}`);
}

async function setControlledValue(client, selector, value) {
  const changed = await client.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Input unavailable: ${selector}`);
}

async function capture(client, fileName) {
  const response = await client.send('Page.captureScreenshot', { format: 'png' });
  const filePath = path.join(outDir, fileName);
  fs.writeFileSync(filePath, Buffer.from(response.result.data, 'base64'));
  return filePath;
}

async function submitInvite(client, code) {
  await setControlledValue(client, '#morse-invite-code', code);
  const submitted = await client.evaluate(`(() => {
    const form = document.querySelector('#morse-invite-code')?.closest('form');
    if (!form) return false;
    form.requestSubmit();
    return true;
  })()`);
  if (!submitted) throw new Error('Invite form unavailable.');
}

async function unlock(client, openDialog = true) {
  if (openDialog) await clickButton(client, '对话');
  await waitFor(client, `Boolean(document.querySelector('#morse-invite-code'))`, 'invite input');
  await submitInvite(client, inviteCode);
  await waitFor(
    client,
    `Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === '招人的')`,
    'authorized chat',
  );
}

async function rejectExpiredInvite(client) {
  await clickButton(client, '对话');
  await waitFor(client, `Boolean(document.querySelector('#morse-invite-code'))`, 'invite input');
  await submitInvite(client, expiredInviteCode);
  await waitFor(
    client,
    `Boolean(Array.from(document.querySelectorAll('[role="alert"]'))
      .find((node) => node.textContent?.includes('无效或已过期')))`,
    'expired invite rejection',
  );
  return true;
}

async function expireLatestSessionForInvite() {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const codeHash = createHash('sha256').update(inviteCode, 'utf8').digest('hex');
    const result = await client.query(
      `UPDATE access_sessions
          SET expires_at = now() - interval '1 second'
        WHERE id = (
          SELECT session.id
            FROM access_sessions AS session
            JOIN invite_codes AS invite ON invite.id = session.invite_code_id
           WHERE invite.code_hash = $1
           ORDER BY session.created_at DESC
           LIMIT 1
        )`,
      [codeHash],
    );
    if (result.rowCount !== 1) throw new Error('Smoke access session was not found.');
  } finally {
    await client.end();
  }
}

async function inspectStarter(client, label) {
  await clickButton(client, label);
  await sleep(50);
  return client.evaluate(`(() => {
    const draft = document.querySelector('#morse-message')?.value || '';
    const interviewer = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === '面试官模式');
    return { draftLength: draft.length, interviewer: interviewer?.getAttribute('aria-pressed') === 'true' };
  })()`);
}

async function submitDraft(client) {
  const submitted = await client.evaluate(`(() => {
    const form = document.querySelector('#morse-message')?.closest('form');
    if (!form) return false;
    form.requestSubmit();
    return true;
  })()`);
  if (!submitted) throw new Error('Message form unavailable.');
}

async function inspectConversation(client) {
  return client.evaluate(`(() => {
    const articles = Array.from(document.querySelectorAll('article'));
    const userMessages = articles.filter((article) =>
      article.querySelector('span')?.textContent?.trim() === '你').length;
    const sourceGroup = document.querySelector('[aria-label="回答来源"]');
    const source = sourceGroup?.querySelector('[data-source-group="local"] a[href^="/works#"]');
    const assistant = document.querySelector('article[data-stream-state="done"]');
    const quota = document.querySelector('[data-testid="morse-quota"]');
    const panel = document.querySelector('[role="dialog"]');
    const rect = panel?.getBoundingClientRect();
    return {
      userMessages,
      hasAnswer: Boolean(assistant?.querySelector('p')?.textContent
        ?.includes('深度研究系统把证据链作为报告出厂闸门')),
      streamDone: Boolean(assistant),
      quotaPresent: Boolean(quota),
      remainingMessages: quota ? Number.parseInt(quota.textContent || '', 10) : -1,
      sourceHref: source ? new URL(source.href, location.href).href : null,
      sourceTarget: source?.getAttribute('target') ?? '',
      sourceRel: source?.getAttribute('rel') ?? '',
      sourceCount: sourceGroup?.querySelectorAll('li').length ?? 0,
      staticSourceCount: sourceGroup?.querySelectorAll('[data-source-static="true"]').length ?? 0,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      panelWidth: rect?.width || 0,
      panelHeight: rect?.height || 0
    };
  })()`);
}

async function runViewport({ expectRetry, height, key, starter, width }) {
  const socket = await openTab();
  const client = createClient(socket);
  let openedSourceTarget = null;
  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Network.enable');
    await client.send('Storage.clearDataForOrigin', {
      origin: targetUrl.origin,
      storageTypes: 'cookies,local_storage',
    });
    await client.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 640,
    });
    await client.send('Emulation.setTouchEmulationEnabled', {
      enabled: width < 640,
      maxTouchPoints: width < 640 ? 5 : 1,
    });
    await navigate(client, '/');
    const expiredInviteRejected = await rejectExpiredInvite(client);
    await unlock(client, false);
    await expireLatestSessionForInvite();
    await inspectStarter(client, '同行交流');
    await submitDraft(client);
    await waitFor(client, `Boolean(document.querySelector('#morse-invite-code'))`, 'expired session lock');
    const expiredSessionLocked = true;
    await unlock(client, false);
    const quotaBefore = await client.evaluate(`(() => {
      const quota = document.querySelector('[data-testid="morse-quota"]');
      return quota ? Number.parseInt(quota.textContent || '', 10) : -1;
    })()`);

    const starters = {
      recruiter: await inspectStarter(client, '招人的'),
      collaboration: await inspectStarter(client, '找人做事的'),
      peer: await inspectStarter(client, '同行交流'),
    };
    await inspectStarter(client, starter);
    await submitDraft(client);

    let retryVisible = false;
    if (expectRetry) {
      await waitFor(
        client,
        `Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === '重试本次问题')`,
        'recoverable error',
      );
      retryVisible = true;
      await clickButton(client, '重试本次问题');
    }

    await waitFor(
      client,
      `Boolean(document.querySelector('article[data-stream-state="done"]'))
        && Boolean(document.querySelector('[aria-label="回答来源"] li'))
        && !document.querySelector('#morse-message')?.disabled
        && !Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === '重试本次问题')`,
      'completed streamed answer and source',
    );
    const conversation = await inspectConversation(client);
    const screenshot = await capture(client, `s8-chat-${key}.png`);
    const sourceUrl = conversation.sourceHref ? new URL(conversation.sourceHref) : null;
    if (!sourceUrl && conversation.staticSourceCount === 0) {
      throw new Error('Public source evidence is missing.');
    }
    if (sourceUrl) {
      if (sourceUrl.pathname !== '/works') throw new Error('Project source path is missing.');
      const sourceSlug = sourceUrl.hash.slice(1);
      if (!projectSlugs.includes(sourceSlug) || sourceUrl.hash !== `#${sourceSlug}`) {
        throw new Error('Project source Hash is invalid.');
      }
      if (conversation.sourceTarget !== '_blank' || !conversation.sourceRel.includes('noopener')) {
        throw new Error('Project source must open in an isolated tab.');
      }
    }
    const originalLocation = await client.evaluate('location.href');
    const originalMessageCount = await client.evaluate(
      'document.querySelectorAll(\'[data-testid="morse-chat-transcript"] article\').length',
    );
    if (sourceUrl) {
      const existingTargetIds = new Set((await listTabs()).map((target) => target.id));
      const sourceClicked = await client.evaluate(`(() => {
        const source = document.querySelector('[aria-label="回答来源"] [data-source-group="local"] a[href^="/works#"]');
        if (!source) return false;
        source.click();
        return true;
      })()`);
      if (!sourceClicked) throw new Error('Project source link is not clickable.');
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const targets = await listTabs();
        openedSourceTarget = targets.find((target) => (
          target.type === 'page'
            && target.url === sourceUrl.href
            && !existingTargetIds.has(target.id)
        )) ?? null;
        if (openedSourceTarget) break;
        await sleep(100);
      }
      if (!openedSourceTarget) throw new Error('Project source tab was not opened.');
    }
    const activeSourceState = await client.evaluate(`({
      mode: ${JSON.stringify(sourceUrl ? 'new-tab' : 'static')},
      href: location.href,
      messages: document.querySelectorAll('[data-testid="morse-chat-transcript"] article').length,
    })`);
    const sourceNavigation = {
      ...activeSourceState,
      openedUrl: openedSourceTarget?.url ?? null,
    };
    if (sourceNavigation.href !== originalLocation) throw new Error('Source replaced the active chat page.');
    if (sourceNavigation.messages !== originalMessageCount) throw new Error('Source changed the active chat transcript.');
    if (openedSourceTarget) {
      await closeTabTarget(openedSourceTarget.id);
      openedSourceTarget = null;
    }

    await navigate(client, '/');
    await clickButton(client, '对话');
    await waitFor(
      client,
      `Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === '退出会话')`,
      'restored authorized session',
    );
    await clickButton(client, '退出会话');
    await waitFor(client, `Boolean(document.querySelector('#morse-invite-code'))`, 'logout lock screen');

    return {
      consoleErrorCount: client.consoleErrors.length,
      conversation,
      expectedAccessErrorCount: client.expectedAccessErrors.length,
      expiredInviteRejected,
      expiredSessionLocked,
      logoutLocked: true,
      pageErrorCount: client.pageErrors.length,
      quotaBefore,
      retryVisible,
      screenshot,
      sourceNavigation,
      starters,
    };
  } finally {
    if (openedSourceTarget) {
      await closeTabTarget(openedSourceTarget.id).catch(() => undefined);
    }
    try {
      await Promise.race([
        client.send('Page.close'),
        sleep(500),
      ]);
    } catch {
      // The target can close before acknowledging Page.close.
    } finally {
      socket.close();
    }
  }
}

const desktop = await runViewport({
  key: 'desktop-1440x900',
  width: 1440,
  height: 900,
  starter: '招人的',
  expectRetry: true,
});
const mobile = await runViewport({
  key: 'mobile-390x844',
  width: 390,
  height: 844,
  starter: '同行交流',
  expectRetry: false,
});

const failures = [];
for (const [key, result] of Object.entries({ desktop, mobile })) {
  if (result.consoleErrorCount) failures.push(`${key}: consoleErrors`);
  if (result.expectedAccessErrorCount !== 2) failures.push(`${key}: expected access errors`);
  if (result.pageErrorCount) failures.push(`${key}: pageErrors`);
  if (!result.expiredInviteRejected) failures.push(`${key}: expired invite`);
  if (!result.expiredSessionLocked) failures.push(`${key}: expired session`);
  if (!result.logoutLocked) failures.push(`${key}: logout`);
  if (result.conversation.userMessages !== 1) failures.push(`${key}: duplicate user message`);
  if (!result.conversation.streamDone || !result.conversation.hasAnswer) {
    failures.push(`${key}: completed answer missing`);
  }
  if (!result.conversation.quotaPresent) failures.push(`${key}: quota missing`);
  if (result.quotaBefore - result.conversation.remainingMessages !== 1) {
    failures.push(`${key}: quota did not decrement exactly once`);
  }
  if (result.conversation.sourceCount < 1) failures.push(`${key}: source missing`);
  if (result.conversation.scrollWidth - result.conversation.clientWidth > 1) {
    failures.push(`${key}: horizontal overflow`);
  }
  if (!result.starters.recruiter.interviewer || result.starters.recruiter.draftLength < 1) {
    failures.push(`${key}: recruiter intent`);
  }
  if (result.starters.collaboration.interviewer || result.starters.collaboration.draftLength < 1) {
    failures.push(`${key}: collaboration intent`);
  }
  if (result.starters.peer.interviewer || result.starters.peer.draftLength < 1) {
    failures.push(`${key}: peer intent`);
  }
}
if (!desktop.retryVisible) failures.push('desktop: retry missing');
if (mobile.retryVisible) failures.push('mobile: unexpected retry');
if (mobile.conversation.panelWidth !== 390 || mobile.conversation.panelHeight !== 844) {
  failures.push('mobile: panel is not full-screen');
}

console.log(JSON.stringify({ desktop, mobile, failures }, null, 2));
if (failures.length) process.exitCode = 1;
