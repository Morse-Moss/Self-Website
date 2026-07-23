#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { hashAdminPassword } from '../lib/server/admin-auth.ts';
import {
  createDeterministicTestEmbedding,
  serializeVector,
} from '../lib/server/embedding.ts';
import { hashSecret } from '../lib/server/security.ts';
import {
  createDisposablePostgresDatabase,
  withPostgresClient,
} from '../tests/postgres-test-utils.ts';
import {
  cleanupOwnedBrowser,
  connectCdpTransport,
  dispatchPrimaryClick,
  removeOwnedProfileWithRetry,
  terminateOwnedProfileProcesses,
  terminateOwnedProcessTree,
  waitForOwnedDevToolsActivePort,
} from './lib/s9-cdp.mjs';

export const S10_VIEWPORTS = Object.freeze([
  Object.freeze({ key: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ key: 'mobile', width: 390, height: 844 }),
]);

export const S10_SCENARIOS = Object.freeze([
  'visitor-unlock',
  'starter-direct-send',
  'assistant-formatting',
  'social-chat',
  'recruitment-chat',
  'jd-match',
  'diagnosis',
  'phase-status',
  'serial-provider-failover',
  'switching-recovery',
  'explicit-provider-failure',
  'original-retry',
  'stop-compensation',
  'refresh-history',
  'source-navigation',
  'search-degradation',
  'visitor-session-expiry',
  'admin-login',
  'admin-list-detail',
  'admin-badcase',
  'admin-invite-management',
  'admin-invite-id-copy',
  'admin-export',
  'admin-session-expiry',
  'dual-width-overflow',
  'console-page-errors',
]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK_OPENAI_SCRIPT = 'scripts/mock-openai.mjs';
const MOCK_BOCHA_SCRIPT = 'scripts/mock-bocha.mjs';
const CONNECTION_TIMEOUT_MS = 8_000;
const INTERACTION_TIMEOUT_MS = 30_000;
const BUILD_TIMEOUT_MS = 120_000;
const APP_START_TIMEOUT_MS = 90_000;
const CHILD_OUTPUT_LIMIT = 16 * 1024;
const RECRUITER_STARTER_QUERY = '请介绍与岗位最相关的项目和能力证据。';
const SWITCHING_EVIDENCE_QUERY = '请说明数字摩斯如何保证回答证据可追溯。';
const STATIC_EVIDENCE_QUERY = '深度研究系统如何确保报告可信？';
const SEARCH_EVIDENCE_QUERY = '请查证 Next.js 当前版本的官方文档与 GitHub 资料。';
const STOP_EVIDENCE_QUERY = '一个正在运行的任务应该如何安全停止？';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const RUNTIME_COPY_ENTRIES = [
  'app',
  'components',
  'content',
  'db',
  'lib',
  'public',
  'next-env.d.ts',
  'next.config.mjs',
  'package.json',
  'tsconfig.json',
];

const SELECTORS = Object.freeze({
  chatRoot: '[data-testid="morse-chat"]',
  chatPanel: '[data-testid="morse-chat-panel"]',
  chatWorkspace: '[data-testid="morse-chat-workspace"]',
  chatTranscript: '[data-testid="morse-chat-transcript"]',
  chatPhase: '[data-testid="morse-chat-phase"]',
  chatWorkflow: '[data-workflow="chat"]',
  jdWorkflow: '[data-workflow="jd_match"]',
  diagnosisWorkflow: '[data-workflow="diagnosis"]',
  stoppedMessage: 'article[data-message-role="assistant"][data-stream-state="stopped"]',
  localSources: '[data-source-group="local"]',
  webSources: '[data-source-group="web"]',
  pendingState: '[data-testid="morse-chat-pending"]',
  adminLogin: '[data-testid="admin-login-form"]',
  adminConsole: '[data-testid="admin-console"]',
  adminList: '[data-testid="admin-turn-list"]',
  adminRow: '[data-testid="admin-turn-row"]',
  adminInviteLabel: '[data-testid="admin-turn-invite-label"]',
  adminDetail: '[data-testid="admin-turn-detail"]',
  adminDetailScroll: '[data-testid="admin-turn-detail-scroll"]',
  adminBadcase: '[data-testid="admin-badcase-form"]',
  adminInvitesOpen: '[data-testid="admin-invites-open"]',
  adminInviteDialog: '[data-testid="admin-invite-dialog"]',
  adminInviteForm: '[data-testid="admin-invite-form"]',
  adminInviteCode: '[data-testid="admin-invite-code"]',
  adminInviteList: '[data-testid="admin-invite-list"]',
  adminInviteCopy: '[data-testid="admin-invite-copy"]',
  adminInviteIdCopy: '[data-testid="admin-invite-id-copy"]',
  adminInviteDeactivate: '[data-testid="admin-invite-deactivate"]',
  adminInviteDeactivateConfirm: '[data-testid="admin-invite-deactivate-confirm"]',
  adminExportOpen: '[data-testid="admin-export-open"]',
  adminExport: '[data-testid="admin-export-form"]',
});

class HarnessError extends Error {
  constructor(code, cause) {
    super(code, cause ? { cause } : undefined);
    this.name = 'HarnessError';
    this.code = code;
  }
}

export async function cleanupS10Browser(browser, {
  cleanupBrowser = cleanupOwnedBrowser,
  cleanupTimeoutMs = 10_000,
  removeProfile = removeOwnedProfileWithRetry,
  terminateProfileProcesses = terminateOwnedProfileProcesses,
} = {}) {
  if (!browser) return;
  try {
    await withTimeout(
      cleanupBrowser(browser),
      cleanupTimeoutMs,
      'browser:cleanup-timeout',
    );
  } catch (error) {
    try {
      await terminateProfileProcesses(browser.profileDir);
      browser.browserProcess?.unref?.();
      await removeProfile(browser.profileDir);
    } catch (fallbackError) {
      browser.browserProcess?.unref?.();
      throw new HarnessError('browser:owned-cleanup-failed', fallbackError ?? error);
    }
  }
}

function uniqueSorted(values = []) {
  return [...new Set(values)].sort();
}

export function createS10Summary(input = {}) {
  const failures = uniqueSorted(input.failures);
  const consoleErrors = uniqueSorted(input.consoleErrors);
  const pageErrors = uniqueSorted(input.pageErrors);
  return {
    kind: 'S10_MOCK_E2E',
    evidence: 'loopback-mock',
    passed: failures.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0,
    checks: uniqueSorted(input.checks),
    failures,
    consoleErrors,
    pageErrors,
    screenshots: uniqueSorted(input.screenshots),
    viewports: S10_VIEWPORTS.map(({ width, height }) => `${width}x${height}`),
  };
}

export function createSafeChatRequestMetrics(input = {}) {
  return {
    chatRequestCount: input.chatRequestCount ?? 0,
    chatResponseStatuses: [...(input.chatResponseStatuses ?? [])],
    turnAttemptDistribution: [...(input.chatTurnRequestCounts?.values?.() ?? [])]
      .sort((left, right) => left - right),
  };
}

export function validateLoopbackHttpUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new HarnessError('target:http-required');
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new HarnessError('target:loopback-required');
  }
  if (url.username || url.password) throw new HarnessError('target:credentials-forbidden');
  return url;
}

function check(value, code) {
  if (!value) throw new HarnessError(code);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withTimeout(promise, timeoutMs, code) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new HarnessError(code)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === 'string') throw new HarnessError('port:allocation-failed');
  return address.port;
}

function appendBounded(current, chunk) {
  const next = `${current}${String(chunk)}`;
  return next.length <= CHILD_OUTPUT_LIMIT ? next : next.slice(-CHILD_OUTPUT_LIMIT);
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
  const output = { stderr: '', stdout: '' };
  child.stdout?.on('data', (chunk) => { output.stdout = appendBounded(output.stdout, chunk); });
  child.stderr?.on('data', (chunk) => { output.stderr = appendBounded(output.stderr, chunk); });
  child.on('error', () => {});
  return { child, output };
}

async function terminateOwnedChild(owned) {
  const child = owned?.child;
  if (!child || child.exitCode !== null) return;
  try {
    terminateOwnedProcessTree(child, { platform: process.platform });
  } catch (error) {
    if (child.exitCode === null) throw error;
  }
}

async function runNodeScript(relativePath, env) {
  const owned = spawnOwned(process.execPath, [path.join(repoRoot, relativePath)], {
    env: { ...process.env, ...env },
  });
  const exitCode = await new Promise((resolve) => owned.child.once('exit', resolve));
  if (exitCode !== 0) throw new HarnessError(`setup:${path.basename(relativePath)}-failed`);
  return owned.output.stdout;
}

async function waitForHttp(url, owned, timeoutMs, code) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (owned?.child.exitCode !== null) throw new HarnessError(`${code}:process-exited`);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return response;
    } catch {
      // The bounded retry loop owns readiness.
    }
    await delay(100);
  }
  throw new HarnessError(code);
}

function assertOwnedRuntimeDirectory(directory) {
  const resolved = path.resolve(directory);
  const runtimeBoundary = `${path.resolve(repoRoot, '.next')}${path.sep}`.toLowerCase();
  if (
    !resolved.toLowerCase().startsWith(runtimeBoundary)
    || !path.basename(resolved).startsWith('s10-runtime-')
  ) {
    throw new HarnessError('runtime:ownership-boundary');
  }
  return resolved;
}

function createRuntimeSnapshot() {
  const runtimeParent = path.join(repoRoot, '.next');
  mkdirSync(runtimeParent, { recursive: true });
  const runtimeDir = mkdtempSync(path.join(runtimeParent, 's10-runtime-'));
  for (const entry of RUNTIME_COPY_ENTRIES) {
    const source = path.join(repoRoot, entry);
    if (!existsSync(source)) continue;
    cpSync(source, path.join(runtimeDir, entry), { recursive: true });
  }
  const nodeModules = path.join(repoRoot, 'node_modules');
  check(existsSync(path.join(nodeModules, 'next', 'dist', 'bin', 'next')), 'setup:next-missing');
  symlinkSync(nodeModules, path.join(runtimeDir, 'node_modules'), 'junction');
  return runtimeDir;
}

function removeRuntimeSnapshot(runtimeDir) {
  if (!runtimeDir) return;
  const resolved = assertOwnedRuntimeDirectory(runtimeDir);
  const nodeModules = path.join(resolved, 'node_modules');
  if (existsSync(nodeModules) && lstatSync(nodeModules).isSymbolicLink()) rmSync(nodeModules, { force: true });
  rmSync(resolved, { force: true, recursive: true });
}

function assertOwnedDownloadDirectory(directory) {
  const resolved = path.resolve(directory);
  const tempBoundary = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase();
  if (
    !resolved.toLowerCase().startsWith(tempBoundary)
    || !path.basename(resolved).startsWith('revolution-s10-download-')
  ) {
    throw new HarnessError('download:ownership-boundary');
  }
  return resolved;
}

function removeDownloadDirectory(downloadDirectory) {
  const resolved = assertOwnedDownloadDirectory(downloadDirectory);
  rmSync(resolved, { force: true, recursive: true });
}

async function seedInvite(connectionString, inviteCode, inviteId) {
  await withPostgresClient(connectionString, (client) => client.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES ($1, $2, $3, true, now() + interval '72 hours', 4, 0)`,
    [inviteId, hashSecret(inviteCode), 's10-loopback-smoke'],
  ));
}

async function seedS10EvidenceFixtures(connectionString) {
  const fixtures = [
    ['s10-recruiter-starter-evidence', RECRUITER_STARTER_QUERY, 'project-deep-research', 'Deep Research', 'deep-research'],
    ['s10-switching-evidence', SWITCHING_EVIDENCE_QUERY, 'project-digital-morse', '数字摩斯', 'digital-morse'],
    ['s10-static-evidence', STATIC_EVIDENCE_QUERY, 'project-deep-research', 'Deep Research', 'deep-research'],
    ['s10-search-evidence', SEARCH_EVIDENCE_QUERY, 'project-deep-research', 'Deep Research', 'deep-research'],
  ];
  for (const [id, query, documentId, title, projectSlug] of fixtures) {
    await withPostgresClient(connectionString, (client) => client.query(
      `INSERT INTO knowledge_chunks
        (id, document_id, ordinal, content, embedding, metadata)
       SELECT $1, document.id,
              COALESCE((SELECT max(ordinal) + 1 FROM knowledge_chunks WHERE document_id = document.id), 0),
              $3, $4::vector, $5::jsonb
         FROM knowledge_documents AS document
        WHERE document.id = $2`,
      [
        id,
        documentId,
        query,
        serializeVector(createDeterministicTestEmbedding(query)),
        JSON.stringify({
          title,
          sourcePath: `content/site-content.json#projects.${projectSlug}`,
          href: `/works#${projectSlug}`,
          projectSlug,
        }),
      ],
    ));
  }
}

async function waitForDatabase(connectionString, predicate, code) {
  const deadline = Date.now() + INTERACTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await withPostgresClient(connectionString, predicate)) return;
    await delay(100);
  }
  throw new HarnessError(code);
}

export function createS10MockAnswer(input = {}) {
  if (/介绍与岗位最相关的项目和能力证据/u.test(input.currentUserContent ?? '')) {
    return `**事实依据：**\n\n- 深度研究 Agent 系统展示了 RAG 检索、证据组织和质量门能力，适合作为岗位相关的公开项目证据。${input.citations ?? ''}`;
  }
  if (/<diagnosis_fields>/u.test(input.currentUserContent ?? '')) {
    return '**需求初诊：**\n\n- 当前问题聚焦 PostgreSQL 与 pgvector 支撑的可追溯客服闭环；建议先验证路由、检索和失败恢复。';
  }
  if (/Agent/iu.test(input.currentUserContent ?? '')
    && /RAG/iu.test(input.currentUserContent ?? '')
    && /PostgreSQL/iu.test(input.currentUserContent ?? '')) {
    return '**岗位相关证据：**\n\n- 该岗位重点要求 Agent、RAG 与 PostgreSQL；当前没有可核验的直接证据，建议面谈核实。';
  }
  if (/RAG/iu.test(input.currentUserContent ?? '')
    && /PostgreSQL/iu.test(input.currentUserContent ?? '')) {
    return '**需求初诊：**\n\n- 当前问题聚焦 RAG 与 PostgreSQL 支撑的可追溯客服闭环；建议先验证路由、检索和失败恢复。';
  }
  if (input.noApprovedEvidence) {
    return '本轮联网搜索未返回可用来源，暂时无法核验最新信息。';
  }
  if (/深度研究/u.test(input.currentUserContent ?? '')) {
    return `**事实依据：**\n\n- 深度研究系统通过公开项目资料和可核验来源保持报告可信。${input.citations ?? ''}`;
  }
  return input.fallbackAnswer ?? '';
}

function createControllableOpenAiProxy(upstreamPort) {
  let heldResolve = null;
  let heldRelease = null;
  let heldPromise = null;
  let failAnswers = false;
  let remainingEmbeddingFailures = 0;
  const answerPlans = [];
  const observations = [];

  function emitGuardRejectedAnswer(response) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    response.write(`data: ${JSON.stringify({
      type: 'response.output_text.delta',
      delta: '仍需补充的信息：缺口清单。',
      item_id: 'guard_rejected',
      output_index: 0,
      sequence_number: 1,
      logprobs: [],
    })}\n\n`);
    response.end('data: [DONE]\n\n');
  }

  function emitValidAnswer(response, body) {
    let payload = {};
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      payload = {};
    }
    const instructions = typeof payload.instructions === 'string' ? payload.instructions : '';
    const inputMessages = Array.isArray(payload.input) ? payload.input : [];
    const currentUserMessage = [...inputMessages]
      .reverse()
      .find((message) => message && typeof message === 'object' && message.role === 'user');
    const currentUserContent = typeof currentUserMessage?.content === 'string'
      ? currentUserMessage.content
      : '';
    const social = /你好|认识一下/u.test(currentUserContent);
    const noApprovedEvidence = instructions.includes(
      '<approved_evidence>本轮没有可用的审核公开证据。</approved_evidence>',
    );
    const searchDegraded = /本轮联网搜索(?:失败|没有返回可用来源)/u.test(instructions);
    const webCitationIndex = /<web_search_result index="(\d+)">/u.exec(instructions)?.[1];
    const citations = webCitationIndex ? `[来源1][来源${webCitationIndex}]` : '[来源1]';
    const fallbackAnswer = social
      ? '你好，我是数字 Morse，很高兴认识你。'
      : noApprovedEvidence
        ? '本轮联网搜索未返回可用来源，暂时无法核验最新信息。'
        : `**事实依据：**\n\n- 数字摩斯以公开项目资料回答，并保留可核验来源。${citations}`;
    const answer = createS10MockAnswer({
      currentUserContent,
      citations,
      noApprovedEvidence: noApprovedEvidence || searchDegraded,
      fallbackAnswer,
    });
    observations.push({ path: 'internal:valid-answer-emitted', authorization: '' });
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    response.write(`data: ${JSON.stringify({
      type: 'response.output_text.delta',
      delta: answer,
      item_id: 'valid_answer',
      output_index: 0,
      sequence_number: 1,
      logprobs: [],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      type: 'response.completed',
      sequence_number: 2,
      response: { usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } },
    })}\n\n`);
    response.end('data: [DONE]\n\n');
  }

  function forward(body, request, response) {
    const upstream = http.request({
      hostname: '127.0.0.1',
      port: upstreamPort,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, 'content-length': Buffer.byteLength(body) },
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
      if (!response.destroyed) response.end('{"error":"mock_proxy_unavailable"}');
    });
    upstream.end(body);
  }

  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const pathName = request.url ?? '';
      const authorization = String(request.headers.authorization ?? '');
      observations.push({ path: pathName, authorization });

      if (pathName === '/v1/embeddings' && remainingEmbeddingFailures > 0) {
        remainingEmbeddingFailures -= 1;
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end('{"error":{"message":"temporary_embedding_unavailable"}}');
        return;
      }
      if (pathName !== '/v1/responses') {
        forward(body, request, response);
        return;
      }
      if (failAnswers) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end('{"error":{"message":"temporary_unavailable"}}');
        return;
      }
      const plan = answerPlans.shift();
      if (typeof plan === 'object' && plan?.type === 'delay') {
        observations.push({ path: 'internal:delay-scheduled', authorization: '' });
        setTimeout(() => {
          observations.push({
            path: response.destroyed
              ? 'internal:delay-response-destroyed'
              : 'internal:delay-response-open',
            authorization: '',
          });
          if (!response.destroyed) emitValidAnswer(response, body);
        }, plan.milliseconds);
        return;
      }
      if (plan === 'guard') {
        observations.push({ path: 'internal:plan-guard', authorization: '' });
        emitGuardRejectedAnswer(response);
        return;
      }
      if (plan === 'fail') {
        observations.push({ path: 'internal:plan-fail', authorization });
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end('{"error":{"message":"planned_provider_failure"}}');
        return;
      }
      if (plan === 'hold') {
        let released = false;
        heldRelease = () => {
          if (released) return;
          released = true;
          if (!response.destroyed) emitValidAnswer(response, body);
        };
        heldResolve?.();
        heldResolve = null;
        return;
      }
      emitValidAnswer(response, body);
    });
  });

  return {
    server,
    holdNextResponse() {
      if (heldResolve) throw new HarnessError('mock:hold-already-pending');
      answerPlans.push('hold');
      heldPromise = new Promise((resolve) => { heldResolve = resolve; });
      return heldPromise;
    },
    delayNextAnswer(milliseconds) {
      answerPlans.push({ type: 'delay', milliseconds });
    },
    failNextThenHoldFailover() {
      if (heldResolve) throw new HarnessError('mock:hold-already-pending');
      answerPlans.push('fail', 'hold');
      heldPromise = new Promise((resolve) => { heldResolve = resolve; });
      return heldPromise;
    },
    rejectNextAnswers(count = 2) {
      for (let index = 0; index < count; index += 1) answerPlans.push('guard');
    },
    rejectNextEmbeddings(count = 1) {
      remainingEmbeddingFailures += count;
    },
    setFailAnswers(value) {
      failAnswers = Boolean(value);
    },
    resetObservations() {
      observations.length = 0;
    },
    getObservations() {
      return observations.map((entry) => ({ ...entry }));
    },
    diagnostics() {
      return {
        paths: observations.reduce((counts, entry) => ({
          ...counts,
          [entry.path]: (counts[entry.path] ?? 0) + 1,
        }), {}),
        pendingPlans: answerPlans.map((plan) => typeof plan === 'string' ? plan : plan.type),
        failAnswers,
        remainingEmbeddingFailures,
      };
    },
    releaseHeldResponse() {
      heldRelease?.();
      heldRelease = null;
      heldPromise = null;
    },
  };
}

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function launchEdge() {
  const edgePath = process.env.S10_EDGE_PATH
    || process.env.S9_EDGE_PATH
    || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  check(existsSync(edgePath), 'browser:edge-missing');
  const profileDir = mkdtempSync(path.join(os.tmpdir(), 'revolution-s9-edge-'));
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
  ], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    windowsHide: true,
  });
  browserProcess.on('error', () => {});
  const endpoint = await waitForOwnedDevToolsActivePort({
    fsApi: { readFileSync, statSync },
    isProcessExited: () => browserProcess.exitCode !== null,
    profileDir,
    startedAtMs,
    timeoutMs: CONNECTION_TIMEOUT_MS,
  });
  return { browserProcess, profileDir, ...endpoint };
}

async function openTab(browser, targetUrl, viewport) {
  const response = await fetch(`${browser.cdpBase}/json/new?about:blank`, {
    method: 'PUT',
    signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS),
  });
  check(response.ok, 'cdp:new-tab-failed');
  const tab = await response.json();
  check(typeof tab.webSocketDebuggerUrl === 'string', 'cdp:new-tab-socket-missing');

  const errors = { console: [], externalOrigins: new Set(), page: [] };
  const metrics = {
    chatRequestCount: 0,
    chatResponseStatuses: [],
    chatTurnRequestCounts: new Map(),
  };
  let transport;
  const expectedNetworkLog = (entry) => {
    try {
      const url = new URL(entry.url);
      if (url.origin !== targetUrl.origin) return false;
      if (url.pathname === '/api/admin/session' && String(entry.text).includes('401')) return true;
      if (url.pathname === '/api/chat' && /ERR_ABORTED|aborted/iu.test(String(entry.text))) return true;
    } catch {
      return false;
    }
    return false;
  };
  const onEvent = (message) => {
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.console.push((message.params.args ?? [])
        .map((argument) => argument.value ?? argument.description ?? '')
        .join(' ')
        .slice(0, 400));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params.exceptionDetails;
      errors.page.push(String(detail?.exception?.description ?? detail?.text ?? 'exception').slice(0, 400));
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const entry = message.params.entry;
      if (!expectedNetworkLog(entry)) errors.console.push(String(entry.text ?? 'log-error').slice(0, 400));
    }
    if (message.method === 'Network.requestWillBeSent') {
      try {
        const url = new URL(message.params.request.url);
        if (url.origin === targetUrl.origin && url.pathname === '/api/chat') {
          metrics.chatRequestCount += 1;
          const postData = message.params.request.postData;
          if (typeof postData === 'string') {
            const turnId = JSON.parse(postData)?.turnId;
            if (typeof turnId === 'string' && turnId.length > 0) {
              metrics.chatTurnRequestCounts.set(
                turnId,
                (metrics.chatTurnRequestCounts.get(turnId) ?? 0) + 1,
              );
            }
          }
        }
        if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.origin !== targetUrl.origin) {
          errors.externalOrigins.add(url.origin);
        }
      } catch {
        // Non-URL browser internals are outside the network contract.
      }
    }
    if (message.method === 'Network.responseReceived') {
      try {
        const url = new URL(message.params.response.url);
        if (url.origin === targetUrl.origin && url.pathname === '/api/chat') {
          metrics.chatResponseStatuses.push(message.params.response.status);
        }
      } catch {
        // Non-URL browser internals are outside the network contract.
      }
    }
  };

  transport = await connectCdpTransport(tab.webSocketDebuggerUrl, {
    commandTimeoutMs: INTERACTION_TIMEOUT_MS,
    connectTimeoutMs: CONNECTION_TIMEOUT_MS,
    onEvent,
  });
  const page = {
    errors,
    metrics,
    viewport,
    async send(method, params, timeoutMs) {
      return transport.send(method, params, timeoutMs);
    },
    dispose: transport.dispose,
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
    page.send('Log.enable'),
    page.send('Network.enable'),
  ]);
  const mobile = viewport.width < 640;
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile,
  });
  await page.send(
    'Emulation.setTouchEmulationEnabled',
    mobile ? { enabled: true, maxTouchPoints: 1 } : { enabled: false },
  );
  return page;
}

async function closeTab(page) {
  if (!page) return;
  try {
    await page.send('Page.close', {}, 2_000);
  } catch {
    // Closing a target can close its own transport before the reply arrives.
  } finally {
    page.dispose();
  }
}

async function waitFor(page, expression, code, timeoutMs = INTERACTION_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(expression)) return;
    await delay(50);
  }
  throw new HarnessError(code);
}

async function navigate(page, targetUrl, route) {
  const url = new URL(route, targetUrl);
  await page.send('Page.bringToFront');
  await page.send('Page.navigate', { url: url.href });
  await waitFor(page, `document.readyState === 'complete' && location.pathname === ${JSON.stringify(url.pathname)}`,
    `navigation:${url.pathname}`);
  await page.evaluate('document.fonts?.ready.then(() => true) ?? true');
}

async function reload(page) {
  await page.send('Page.reload', { ignoreCache: true });
  await waitFor(page, "document.readyState === 'complete'", 'navigation:reload');
}

async function click(page, selector) {
  await dispatchPrimaryClick(page, {
    pointerMode: page.viewport.width < 640 ? 'touch' : 'mouse',
    selector,
  });
}

async function setControlledValue(page, selector, value) {
  const changed = await page.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)
      && !(input instanceof HTMLSelectElement)) return false;
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : input instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  check(changed, `input:missing:${selector}`);
}

async function selectorExists(page, selector) {
  return page.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
}

async function openChat(page) {
  if (await selectorExists(page, SELECTORS.chatWorkspace) || await selectorExists(page, '#morse-invite-code')) return;
  const embedded = await selectorExists(page, `${SELECTORS.chatRoot}[data-variant="embedded"]`);
  if (!embedded) await click(page, `${SELECTORS.chatRoot} > button`);
  await waitFor(page, `Boolean(document.querySelector('#morse-invite-code')) || Boolean(document.querySelector(${JSON.stringify(SELECTORS.chatWorkspace)}))`,
    'chat:open');
}

async function unlockChat(page, inviteCode) {
  await openChat(page);
  await waitFor(page, "Boolean(document.querySelector('#morse-invite-code'))", 'chat:invite-input');
  await setControlledValue(page, '#morse-invite-code', inviteCode);
  await click(page, "#morse-invite-code + button, #morse-invite-code ~ button");
  await waitFor(page, `Boolean(document.querySelector(${JSON.stringify(SELECTORS.chatWorkspace)}))`, 'chat:unlock');
}

async function installPhaseProbe(page) {
  await page.evaluate(`(() => {
    window.__s10PhaseLog = [];
    window.__s10PhaseObserver?.disconnect();
    const record = () => {
      const value = document.querySelector(${JSON.stringify(SELECTORS.chatPhase)})?.getAttribute('data-phase');
      if (value && window.__s10PhaseLog.at(-1) !== value) window.__s10PhaseLog.push(value);
    };
    window.__s10PhaseObserver = new MutationObserver(record);
    window.__s10PhaseObserver.observe(document.body, { attributes: true, childList: true, subtree: true });
    record();
    return true;
  })()`);
}

async function submitChatValue(page, inputSelector, value) {
  const baseline = await page.evaluate(`document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)}).length`);
  await setControlledValue(page, inputSelector, value);
  await click(page, '[data-action="send"]');
  await waitFor(page, `document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)}).length > ${baseline}`,
    'chat:assistant-created');
  await waitFor(page, `(() => {
    const messages = document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)});
    return messages.length > ${baseline} && ['done', 'error', 'stopped'].includes(messages[messages.length - 1].getAttribute('data-stream-state'));
  })()`, 'chat:terminal-state');
  return page.evaluate(`(() => {
    const messages = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})];
    const last = messages.at(-1);
    return {
      state: last?.getAttribute('data-stream-state') ?? null,
      text: last?.querySelector('[data-testid="morse-chat-message-content"]')?.textContent ?? '',
      localSources: last?.querySelectorAll(${JSON.stringify(SELECTORS.localSources)}).length ?? 0,
      webSources: last?.querySelectorAll(${JSON.stringify(SELECTORS.webSources)}).length ?? 0,
    };
  })()`);
}

async function assertNoOverflow(page, label) {
  const geometry = await page.evaluate(`(() => {
    const documentElement = document.documentElement;
    const dialog = document.querySelector('[role="dialog"]')
      ?? document.querySelector(${JSON.stringify(SELECTORS.chatPanel)});
    const rect = dialog?.getBoundingClientRect();
    return {
      clientWidth: documentElement.clientWidth,
      scrollWidth: documentElement.scrollWidth,
      dialogLeft: rect?.left ?? 0,
      dialogRight: rect?.right ?? 0,
    };
  })()`);
  check(geometry.scrollWidth <= geometry.clientWidth + 1, `overflow:${label}`);
  check(geometry.dialogLeft >= -1 && geometry.dialogRight <= geometry.clientWidth + 1, `dialog-overflow:${label}`);
}

async function assertScrollableToBottom(page, selector, scrollableCode, bottomCode) {
  const geometry = await page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return null;
    element.scrollTop = element.scrollHeight;
    return { clientHeight: element.clientHeight, scrollHeight: element.scrollHeight };
  })()`);
  check(geometry && geometry.scrollHeight > geometry.clientHeight + 1, scrollableCode);
  await delay(50);
  const reachedBottom = await page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    return element instanceof HTMLElement
      && Math.ceil(element.scrollTop + element.clientHeight) >= element.scrollHeight - 1;
  })()`);
  check(reachedBottom, bottomCode);
  await page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return false;
    element.scrollTop = 0;
    return true;
  })()`);
}

async function capture(page, outputDirectory, fileName) {
  await page.send('Page.bringToFront');
  await page.evaluate('window.getSelection()?.removeAllRanges(); true');
  await delay(350);
  const result = await page.send('Page.captureScreenshot', { format: 'png' });
  const filePath = path.join(outputDirectory, fileName);
  writeFileSync(filePath, Buffer.from(result.data, 'base64'));
  return filePath;
}

async function centerInViewport(page, selector) {
  const centered = await page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return false;
    element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    return true;
  })()`);
  check(centered, 'evidence:target-missing');
  await delay(100);
}

async function runVisitorScenarios({
  page,
  targetUrl,
  browserTransport,
  inviteCode,
  connectionString,
  openAiProxy,
  checks,
  chatV2EvidenceDirectory,
  screenshots,
}) {
  await navigate(page, targetUrl, '/');
  await unlockChat(page, inviteCode);
  checks.add('visitor-unlock');
  await installPhaseProbe(page);

  const starterBaseline = await page.evaluate(
    `document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)}).length`,
  );
  const starterUrl = await page.evaluate('location.href');
  const heldStarter = openAiProxy.holdNextResponse();
  await click(page, '[data-starter-intent="recruiter"]');
  await withTimeout(heldStarter, INTERACTION_TIMEOUT_MS, 'starter:request-not-held');
  await waitFor(page, `(() => {
    const transcript = document.querySelector(${JSON.stringify(SELECTORS.chatTranscript)});
    const assistants = transcript?.querySelectorAll('article[data-message-role="assistant"]') ?? [];
    const pending = assistants[assistants.length - 1];
    return assistants.length > ${starterBaseline}
      && pending?.getAttribute('data-stream-state') === 'pending'
      && Boolean(pending.querySelector(${JSON.stringify(SELECTORS.pendingState)}))
      && Boolean(pending.querySelector('[role="progressbar"]'))
      && Boolean(pending.querySelector('[data-action="stop"]'))
      && !pending.querySelector('[aria-label="回答来源"]')
      && !transcript?.querySelector('[data-starter-intent]');
  })()`, 'starter:pending-state');
  check(await page.evaluate('location.href') === starterUrl, 'starter:navigation');
  check(await page.evaluate("document.querySelector('#morse-message')?.value === ''"), 'starter:draft-cleared');
  openAiProxy.releaseHeldResponse();
  await waitFor(page, `(() => {
    const assistants = document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)});
    return assistants.length > ${starterBaseline}
      && ['done', 'error', 'stopped'].includes(assistants[assistants.length - 1].getAttribute('data-stream-state'));
  })()`, 'starter:terminal');
  const starterTerminal = await page.evaluate(`(() => {
    const assistants = document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)});
    const assistant = assistants[assistants.length - 1];
    return {
      state: assistant?.getAttribute('data-stream-state') ?? 'missing',
      text: assistant?.textContent?.trim().slice(0, 240) ?? 'empty',
      hasNamedProject: assistant?.textContent?.includes('深度研究') ?? false,
      hasCapabilityEvidence: /RAG|质量门/u.test(assistant?.textContent ?? ''),
    };
  })()`);
  check(starterTerminal.state === 'done', `starter:${starterTerminal.state}:${starterTerminal.text}`);
  check(starterTerminal.hasNamedProject && starterTerminal.hasCapabilityEvidence, 'starter:substantive-answer');
  const starterFormat = await page.evaluate(`(() => {
    const assistants = document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)});
    const answer = assistants[assistants.length - 1];
    return {
      rawMarkers: answer?.textContent?.includes('**') ?? true,
      section: answer?.querySelector('[data-testid="morse-chat-message-content"] h3')?.textContent ?? '',
      listItems: answer?.querySelectorAll('[data-testid="morse-chat-message-content"] li').length ?? 0,
      citation: answer?.querySelector('[data-citation-index="1"]')?.textContent ?? '',
      citationCount: new Set(Array.from(answer?.querySelectorAll('[data-citation-index]') ?? [])
        .map((node) => node.getAttribute('data-citation-index'))
        .filter(Boolean)).size,
      sourceItems: answer?.querySelectorAll('[aria-label="回答来源"] li').length ?? 0,
    };
  })()`);
  check(!starterFormat.rawMarkers && starterFormat.section === '事实依据：', 'format:markdown');
  check(starterFormat.listItems === 1, 'format:list');
  check(starterFormat.citation.includes('依据：'), 'format:named-citation');
  check(
    starterFormat.sourceItems === starterFormat.citationCount,
    'source:only-cited',
  );
  checks.add('starter-direct-send');
  checks.add('assistant-formatting');
  checks.add('recruitment-chat');
  screenshots.push(await capture(
    page,
    chatV2EvidenceDirectory,
    'chat-v2-recruitment-desktop-1440x900.png',
  ));

  openAiProxy.resetObservations();
  const social = await submitChatValue(page, '#morse-message', '你好，很高兴认识你。');
  const socialObservations = openAiProxy.getObservations();
  check(social.state === 'done', 'social:answer');
  check(
    socialObservations.some((entry) => entry.path === '/v1/responses')
      && !socialObservations.some((entry) => entry.path === '/v1/embeddings'),
    'social:no-embedding',
  );
  checks.add('social-chat');

  openAiProxy.resetObservations();
  const switchingBaseline = await page.evaluate(`(() => ({
    users: document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="user"]`)}).length,
    assistants: document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)}).length
  }))()`);
  const heldFailover = openAiProxy.failNextThenHoldFailover();
  await setControlledValue(page, '#morse-message', SWITCHING_EVIDENCE_QUERY);
  await click(page, '[data-action="send"]');
  await Promise.all([
    withTimeout(heldFailover, INTERACTION_TIMEOUT_MS, 'switching:failover-not-held'),
    waitFor(
      page,
      `document.querySelector(${JSON.stringify(SELECTORS.chatPhase)})?.getAttribute('data-phase') === 'switching'`,
      'switching:visible',
    ),
  ]);
  check(await page.evaluate(`(() => {
    const assistant = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})].at(-1);
    return Boolean(assistant?.querySelector(${JSON.stringify(SELECTORS.pendingState)}))
      && !assistant?.querySelector('[data-testid="morse-chat-message-content"]')?.textContent;
  })()`), 'switching:pending-in-place');
  await centerInViewport(page, SELECTORS.chatPanel);
  screenshots.push(await capture(
    page,
    chatV2EvidenceDirectory,
    'chat-v2-switching-desktop-1440x900.png',
  ));
  openAiProxy.releaseHeldResponse();
  await waitFor(page, `(() => {
    const assistants = document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)});
    return assistants.length === ${switchingBaseline.assistants + 1}
      && assistants[assistants.length - 1]?.getAttribute('data-stream-state') === 'done';
  })()`, 'switching:recovered');
  const switchingCounts = await page.evaluate(`(() => ({
    users: document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="user"]`)}).length,
    assistants: document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)}).length
  }))()`);
  check(
    switchingCounts.users === switchingBaseline.users + 1
      && switchingCounts.assistants === switchingBaseline.assistants + 1,
    'switching:same-assistant',
  );
  const failoverObservations = openAiProxy.getObservations();
  check(
    failoverObservations.some((entry) => entry.authorization === 'Bearer mock-primary-key')
      && failoverObservations.some((entry) => entry.authorization === 'Bearer mock-fallback-key')
      && failoverObservations.some((entry) => entry.path === 'internal:plan-fail'),
    'failover:primary-then-backup',
  );
  checks.add('serial-provider-failover');
  checks.add('switching-recovery');

  openAiProxy.rejectNextEmbeddings(1);
  await setControlledValue(page, '#morse-message', STATIC_EVIDENCE_QUERY);
  await click(page, '[data-action="send"]');
  await waitFor(page, `(() => {
    const assistants = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})];
    return assistants.at(-1)?.getAttribute('data-stream-state') === 'error'
      && Boolean(assistants.at(-1)?.querySelector('button'));
  })()`, 'retry:recoverable-error');
  const retryCounts = await page.evaluate(`(() => ({
    users: document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="user"]`)}).length,
    assistants: document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)}).length
  }))()`);
  await waitFor(page, `(() => {
    const assistant = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})].at(-1);
    const button = assistant?.querySelector('button');
    return button instanceof HTMLButtonElement && !button.disabled;
  })()`, 'retry:enabled');
  await click(page, `${SELECTORS.chatTranscript} article[data-message-role="assistant"]:last-of-type button:not(:disabled)`);
  await waitFor(page, `(() => {
    const assistants = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})];
    return assistants.at(-1)?.getAttribute('data-stream-state') === 'done';
  })()`, 'retry:recovered');
  const recoveredCounts = await page.evaluate(`(() => ({
    users: document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="user"]`)}).length,
    assistants: document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)}).length
  }))()`);
  check(recoveredCounts.assistants === retryCounts.assistants, 'retry:same-assistant');
  check(recoveredCounts.users === retryCounts.users, 'retry:same-user');
  checks.add('original-retry');

  const chatResult = await submitChatValue(page, '#morse-message', '数字 Morse 是谁？');
  check(chatResult.state === 'done' && chatResult.localSources > 0, 'chat:local-answer');

  const beforeRefresh = await page.evaluate(`(() => ({
    messages: document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article`)}).length,
    answer: [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"] [data-testid="morse-chat-message-content"]`)})].at(-1)?.textContent ?? ''
  }))()`);
  await reload(page);
  await openChat(page);
  await waitFor(page, `document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article`)}).length >= ${beforeRefresh.messages}`,
    'chat:history-restored');
  const restoredAnswer = await page.evaluate(`([...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"] [data-testid="morse-chat-message-content"]`)})].at(-1)?.textContent ?? '')`);
  check(Boolean(beforeRefresh.answer) && restoredAnswer === beforeRefresh.answer, 'chat:history-mismatch');
  checks.add('refresh-history');
  await installPhaseProbe(page);

  openAiProxy.setFailAnswers(true);
  let providerFailure;
  try {
    providerFailure = await submitChatValue(page, '#morse-message', '你是谁？介绍一下自己。');
  } finally {
    openAiProxy.setFailAnswers(false);
  }
  check(providerFailure.state === 'error', 'provider-failure:error');
  check(!await page.evaluate("Boolean(document.querySelector('[data-degraded]'))"), 'provider-failure:no-degraded-result');
  checks.add('explicit-provider-failure');

  const searchDegraded = await submitChatValue(page, '#morse-message', '请核验 OpenAI API 当前最新官方文档。');
  check(searchDegraded.state === 'done' && searchDegraded.webSources === 0, 'search:degradation-ui');
  await waitForDatabase(connectionString, async (client) => {
    const result = await client.query("SELECT 1 FROM interaction_searches WHERE status = 'failed' LIMIT 1");
    return result.rowCount === 1;
  }, 'search:degradation-not-persisted');
  checks.add('search-degradation');

  const staticEvidence = await submitChatValue(page, '#morse-message', STATIC_EVIDENCE_QUERY);
  check(
    staticEvidence.state === 'done' && staticEvidence.localSources > 0,
    'source:static-answer',
  );
  check(await page.evaluate(`(() => {
    const assistant = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})].at(-1);
    assistant?.setAttribute('data-s10-source-contract', 'local');
    return Boolean(assistant);
  })()`), 'source:static-marker');

  const searched = await submitChatValue(page, '#morse-message', SEARCH_EVIDENCE_QUERY);
  check(
    searched.state === 'done' && searched.localSources === 0 && searched.webSources > 0,
    'search:sources-missing',
  );
  check(await page.evaluate(`(() => {
    const assistant = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})].at(-1);
    assistant?.setAttribute('data-s10-source-contract', 'web');
    return Boolean(assistant);
  })()`), 'source:web-marker');
  const sourceContract = await page.evaluate(`(() => {
    const assistants = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})];
    const localAssistant = assistants.find((assistant) => assistant.getAttribute('data-s10-source-contract') === 'local');
    const webAssistant = assistants.find((assistant) => assistant.getAttribute('data-s10-source-contract') === 'web');
    const local = localAssistant?.querySelector(${JSON.stringify(`${SELECTORS.localSources} a[href^="/works#"]`)});
    const inlineLocal = localAssistant?.querySelector('[data-testid="morse-chat-message-content"] a[data-citation-index][href^="/works#"]');
    const web = webAssistant?.querySelector(${JSON.stringify(`${SELECTORS.webSources} a`)});
    return {
      inlineLocalHref: inlineLocal?.getAttribute('href') ?? '',
      inlineLocalTarget: inlineLocal?.getAttribute('target') ?? '',
      inlineLocalRel: inlineLocal?.getAttribute('rel') ?? '',
      localHref: local?.getAttribute('href') ?? '',
      localTarget: local?.getAttribute('target') ?? '',
      localRel: local?.getAttribute('rel') ?? '',
      webHref: web?.getAttribute('href') ?? '',
      webTarget: web?.getAttribute('target') ?? '',
      webRel: web?.getAttribute('rel') ?? '',
    };
  })()`);
  check(sourceContract.inlineLocalHref.startsWith('/works#'), 'source:inline-local-href');
  check(
    sourceContract.inlineLocalTarget === '_blank' && sourceContract.inlineLocalRel.includes('noopener'),
    'source:inline-local-isolation',
  );
  check(sourceContract.localHref.startsWith('/works#'), 'source:local-href');
  check(sourceContract.localTarget === '_blank' && sourceContract.localRel.includes('noopener'), 'source:local-isolation');
  check(sourceContract.webHref.startsWith('https://'), 'source:web-https');
  check(sourceContract.webTarget === '_blank' && sourceContract.webRel.includes('noopener'), 'source:web-isolation');
  const sourceNavigationSelector = `${SELECTORS.chatTranscript} article[data-message-role="assistant"][data-s10-source-contract="local"] ${SELECTORS.localSources} a[href^="/works#"]`;
  check(await page.evaluate(`(() => {
    const source = document.querySelector(${JSON.stringify(sourceNavigationSelector)});
    if (!source) return false;
    source.scrollIntoView({ block: 'center', behavior: 'auto' });
    return true;
  })()`), 'source:navigation-scroll-target');
  const beforeSourceClick = await page.evaluate(`(() => {
    const transcript = document.querySelector(${JSON.stringify(SELECTORS.chatTranscript)});
    return {
      url: location.href,
      messages: transcript?.querySelectorAll('article').length ?? 0,
      scrollTop: transcript?.scrollTop ?? 0,
    };
  })()`);
  const targetsBeforeSourceClick = await browserTransport.send('Target.getTargets');
  const existingTargetIds = new Set(
    (targetsBeforeSourceClick.targetInfos ?? []).map((target) => target.targetId),
  );
  const expectedSourceUrl = new URL(sourceContract.inlineLocalHref, targetUrl).href;
  await click(page, sourceNavigationSelector);
  const openedSourceTarget = await withTimeout((async () => {
    while (true) {
      const { targetInfos = [] } = await browserTransport.send('Target.getTargets');
      const target = targetInfos.find((candidate) => (
        candidate.type === 'page'
          && candidate.url === expectedSourceUrl
          && !existingTargetIds.has(candidate.targetId)
      ));
      if (target) return target;
      await delay(50);
    }
  })(), INTERACTION_TIMEOUT_MS, 'source:new-tab');
  const afterSourceClick = await page.evaluate(`(() => {
    const transcript = document.querySelector(${JSON.stringify(SELECTORS.chatTranscript)});
    return {
      url: location.href,
      messages: transcript?.querySelectorAll('article').length ?? 0,
      scrollTop: transcript?.scrollTop ?? 0,
    };
  })()`);
  check(afterSourceClick.url === beforeSourceClick.url, 'source:original-url');
  check(afterSourceClick.messages === beforeSourceClick.messages, 'source:original-messages');
  check(afterSourceClick.scrollTop === beforeSourceClick.scrollTop, 'source:original-scroll');
  const closedSourceTarget = await browserTransport.send('Target.closeTarget', {
    targetId: openedSourceTarget.targetId,
  });
  check(closedSourceTarget.success !== false, 'source:new-tab-close');
  checks.add('source-navigation');

  const responsePhases = await page.evaluate('window.__s10PhaseLog ?? []');
  for (const phase of ['routing', 'knowledge', 'web', 'answering']) {
    check(responsePhases.includes(phase), `phase:missing:${phase}`);
  }
  await navigate(page, targetUrl, '/');
  await openChat(page);
  await waitFor(page, `Boolean(document.querySelector(${JSON.stringify(SELECTORS.chatWorkspace)}))`, 'chat:reopen');
  await installPhaseProbe(page);
  await click(page, SELECTORS.jdWorkflow);
  await waitFor(page, "Boolean(document.querySelector('#morse-jd'))", 'chat:jd-workflow');
  const jdResult = await submitChatValue(page, '#morse-jd', '招聘 Agent 系统工程师，要求 TypeScript、Python、RAG、PostgreSQL 与可验证交付经验。');
  check(jdResult.state === 'done', 'chat:jd-answer');
  checks.add('jd-match');

  await click(page, SELECTORS.diagnosisWorkflow);
  await waitFor(page, "Boolean(document.querySelector('[data-testid=\"morse-diagnosis-intake\"]'))", 'chat:diagnosis-workflow');
  const diagnosisFields = {
    problem: '现有客服无法基于作品集知识实时回答。',
    goal: '完成可追溯的智能客服文字闭环。',
    currentState: '已有 Next.js、PostgreSQL 与 pgvector。',
    constraints: '仅公开审核知识，外部服务失败必须降级。',
    expectedTimeline: '先完成本地闭环再部署。',
  };
  for (const [field, value] of Object.entries(diagnosisFields)) {
    await setControlledValue(page, `textarea[name="${field}"]`, value);
  }
  await click(page, '[data-action="send"]');
  await waitFor(page, `Boolean(document.querySelector(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"][data-stream-state="done"]`)}))`,
    'chat:diagnosis-answer');
  await waitFor(page, `${JSON.stringify('handoff')} === document.querySelector(${JSON.stringify(SELECTORS.chatPhase)})?.getAttribute('data-phase')`,
    'chat:diagnosis-handoff');
  checks.add('diagnosis');

  await click(page, SELECTORS.chatWorkflow);
  await waitFor(page, "Boolean(document.querySelector('#morse-message'))", 'chat:return-workflow');
  const held = openAiProxy.holdNextResponse();
  await setControlledValue(page, '#morse-message', STOP_EVIDENCE_QUERY);
  await click(page, '[data-action="send"]');
  await withTimeout(held, INTERACTION_TIMEOUT_MS, 'stop:provider-not-held');
  await waitFor(page, "Boolean(document.querySelector('[data-action=\"stop\"]'))", 'stop:button');
  await click(page, '[data-action="stop"]');
  await waitFor(page, `Boolean(document.querySelector(${JSON.stringify(SELECTORS.stoppedMessage)}))`, 'stop:ui-state');
  await waitForDatabase(connectionString, async (client) => {
    const result = await client.query(
      "SELECT 1 FROM interaction_turns WHERE question = $1 AND status = 'stopped' LIMIT 1",
      [STOP_EVIDENCE_QUERY],
    );
    return result.rowCount === 1;
  }, 'stop:database-compensation');
  openAiProxy.releaseHeldResponse();
  checks.add('stop-compensation');

  check(await withPostgresClient(connectionString, async (client) => {
    const result = await client.query("SELECT 1 FROM diagnoses WHERE status = 'handoff_pending' LIMIT 1");
    return result.rowCount === 1;
  }), 'phase:handoff-not-persisted');
  checks.add('phase-status');
  await assertNoOverflow(page, 'visitor-desktop');
}

async function runMobileVisitor({
  page,
  targetUrl,
  connectionString,
  inviteId,
  outputDirectory,
  checks,
  openAiProxy,
  chatV2EvidenceDirectory,
  screenshots,
}) {
  await navigate(page, targetUrl, '/');
  await openChat(page);
  await waitFor(page, `Boolean(document.querySelector(${JSON.stringify(SELECTORS.chatWorkspace)}))`, 'mobile:authorized-chat');
  await assertNoOverflow(page, 'visitor-mobile');
  const panel = await page.evaluate(`(() => {
    const rect = document.querySelector(${JSON.stringify(SELECTORS.chatPanel)})?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  })()`);
  check(panel.width > 300 && panel.width <= 390 && panel.height > 500 && panel.height <= 844, 'mobile:chat-panel');

  await click(page, SELECTORS.jdWorkflow);
  await waitFor(page, "Boolean(document.querySelector('#morse-jd'))", 'mobile:jd-reset');
  await click(page, SELECTORS.chatWorkflow);
  await waitFor(page, "Boolean(document.querySelector('#morse-message'))", 'mobile:chat-reset');
  await click(page, '[data-starter-intent="recruiter"]');
  await waitFor(page, `(() => {
    const assistants = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})];
    return assistants.at(-1)?.getAttribute('data-stream-state') === 'done';
  })()`, 'mobile:recruitment-answer');
  check(await page.evaluate(`document.querySelector(${JSON.stringify(SELECTORS.chatTranscript)})?.textContent?.includes('请介绍与岗位最相关的项目和能力证据。')`), 'recruitment:answer');
  screenshots.push(await capture(
    page,
    chatV2EvidenceDirectory,
    'chat-v2-recruitment-mobile-390x844.png',
  ));

  openAiProxy.resetObservations();
  const social = await submitChatValue(page, '#morse-message', '你好，我们先简单认识一下。');
  const socialObservations = openAiProxy.getObservations();
  check(social.state === 'done', 'mobile:social-answer');
  check(!socialObservations.some((entry) => entry.path === '/v1/embeddings'), 'social:no-embedding-mobile');

  await click(page, SELECTORS.jdWorkflow);
  await waitFor(page, "Boolean(document.querySelector('#morse-jd'))", 'mobile:jd-workflow');
  const jdResult = await submitChatValue(page, '#morse-jd', '招聘 Agent 工程师，要求 RAG、PostgreSQL 和可靠性交付经验。');
  check(jdResult.state === 'done', 'mobile:jd-answer');
  await click(page, SELECTORS.chatWorkflow);
  await waitFor(page, "Boolean(document.querySelector('#morse-message'))", 'mobile:return-chat');

  await installPhaseProbe(page);
  const heldFailover = openAiProxy.failNextThenHoldFailover();
  await setControlledValue(page, '#morse-message', STATIC_EVIDENCE_QUERY);
  await click(page, '[data-action="send"]');
  await Promise.all([
    withTimeout(heldFailover, INTERACTION_TIMEOUT_MS, 'mobile:switching-failover-not-held'),
    waitFor(
      page,
      `window.__s10PhaseLog.includes('switching')`,
      'mobile:switching-visible',
    ),
  ]);
  openAiProxy.releaseHeldResponse();
  await waitFor(page, `(() => {
    const assistants = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})];
    return assistants.at(-1)?.getAttribute('data-stream-state') === 'done';
  })()`, 'mobile:switching-recovered');

  openAiProxy.rejectNextEmbeddings(1);
  await setControlledValue(page, '#morse-message', STATIC_EVIDENCE_QUERY);
  await click(page, '[data-action="send"]');
  await waitFor(page, `(() => {
    const assistants = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})];
    return assistants.at(-1)?.getAttribute('data-stream-state') === 'error';
  })()`, 'mobile:retry-error');
  const retryCounts = await page.evaluate(`(() => ({
    users: document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="user"]`)}).length,
    assistants: document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)}).length
  }))()`);
  await waitFor(page, `(() => {
    const assistant = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})].at(-1);
    const button = assistant?.querySelector('button');
    return button instanceof HTMLButtonElement && !button.disabled;
  })()`, 'mobile:retry-enabled');
  await click(page, `${SELECTORS.chatTranscript} article[data-message-role="assistant"]:last-of-type button:not(:disabled)`);
  await waitFor(page, `(() => {
    const assistants = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})];
    return assistants.at(-1)?.getAttribute('data-stream-state') === 'done';
  })()`, 'mobile:retry-recovered');
  const recoveredCounts = await page.evaluate(`(() => ({
    users: document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="user"]`)}).length,
    assistants: document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)}).length
  }))()`);
  check(recoveredCounts.assistants === retryCounts.assistants, 'mobile:retry-same-assistant');
  check(recoveredCounts.users === retryCounts.users, 'mobile:retry-same-user');

  const heldPending = openAiProxy.holdNextResponse();
  await setControlledValue(page, '#morse-message', '请说明数字摩斯如何处理这个问题。');
  await click(page, '[data-action="send"]');
  await withTimeout(heldPending, INTERACTION_TIMEOUT_MS, 'mobile:pending-not-held');
  await waitFor(
    page,
    `Boolean(document.querySelector(${JSON.stringify(SELECTORS.pendingState)}))`,
    'mobile:pending-visible',
  );
  check(await selectorExists(page, `${SELECTORS.pendingState} [role="progressbar"]`), 'mobile:pending-progress');
  check(await selectorExists(page, `${SELECTORS.pendingState} [data-action="stop"]`), 'mobile:pending-stop');
  await assertNoOverflow(page, 'visitor-mobile-pending');
  screenshots.push(await capture(
    page,
    chatV2EvidenceDirectory,
    'chat-v2-pending-mobile-390x844.png',
  ));
  await click(page, `${SELECTORS.pendingState} [data-action="stop"]`);
  await waitFor(page, `Boolean(document.querySelector(${JSON.stringify(SELECTORS.stoppedMessage)}))`, 'mobile:pending-stopped');
  openAiProxy.releaseHeldResponse();
  check(!await page.evaluate(`document.body.textContent?.includes(${JSON.stringify(inviteId)})`), 'visitor:no-rollout-id');

  const screenshot = await capture(page, outputDirectory, 's10-chat-mobile-390x844.png');
  await withPostgresClient(connectionString, (client) => client.query(
    "UPDATE access_sessions SET expires_at = now() - interval '1 second' WHERE invite_code_id = $1",
    [inviteId],
  ));
  await reload(page);
  await openChat(page);
  await waitFor(page, "Boolean(document.querySelector('#morse-invite-code'))", 'session:visitor-expiry');
  checks.add('visitor-session-expiry');
  return screenshot;
}

async function runAdminScenarios({
  desktopPage,
  mobilePage,
  browserTransport,
  targetUrl,
  connectionString,
  adminPassword,
  outputDirectory,
  downloadDirectory,
  checks,
}) {
  await navigate(desktopPage, targetUrl, '/admin');
  await waitFor(desktopPage, `Boolean(document.querySelector(${JSON.stringify(SELECTORS.adminLogin)}))`, 'admin:login-form');
  check(!await selectorExists(desktopPage, '[name="totpCode"]'), 'admin:login-password-only');
  await assertNoOverflow(desktopPage, 'admin-login-desktop');
  const loginDesktopScreenshot = await capture(
    desktopPage,
    outputDirectory,
    's10-admin-login-desktop-1440x900.png',
  );
  await setControlledValue(desktopPage, '[name="password"]', adminPassword);
  await click(desktopPage, `${SELECTORS.adminLogin} button[type="submit"]`);
  await waitFor(desktopPage, `Boolean(document.querySelector(${JSON.stringify(SELECTORS.adminConsole)}))`, 'admin:login');
  checks.add('admin-login');
  await waitFor(desktopPage, `document.querySelectorAll(${JSON.stringify(SELECTORS.adminRow)}).length >= 5`, 'admin:list');
  await waitFor(
    desktopPage,
    `document.querySelector(${JSON.stringify(SELECTORS.adminInviteLabel)})?.textContent?.includes('s10-loopback-smoke')`,
    'admin:invite-label-list',
  );
  await click(desktopPage, SELECTORS.adminRow);
  await waitFor(desktopPage, `Boolean(document.querySelector(${JSON.stringify(`${SELECTORS.adminDetail} ${SELECTORS.adminBadcase}`)}))`, 'admin:detail');
  await waitFor(
    desktopPage,
    `document.querySelector(${JSON.stringify(SELECTORS.adminDetail)})?.textContent?.includes('s10-loopback-smoke')`,
    'admin:invite-label-detail',
  );
  await assertScrollableToBottom(
    desktopPage,
    SELECTORS.adminDetailScroll,
    'admin:detail-scrollable-desktop',
    'admin:detail-scroll-bottom-desktop',
  );

  const badcaseCheckbox = `${SELECTORS.adminBadcase} input[name="badcase"]`;
  if (!await desktopPage.evaluate(`document.querySelector(${JSON.stringify(badcaseCheckbox)})?.checked === true`)) {
    await click(desktopPage, badcaseCheckbox);
  }
  await setControlledValue(desktopPage, `${SELECTORS.adminBadcase} textarea[name="adminNote"]`, 'S10 loopback smoke: stopped turn reviewed.');
  await click(desktopPage, `${SELECTORS.adminBadcase} button[type="submit"]`);
  await waitFor(desktopPage, `Boolean(document.querySelector(${JSON.stringify(`${SELECTORS.adminBadcase} [role="status"]`)}))`, 'admin:badcase-saved');
  checks.add('admin-badcase');

  await click(desktopPage, SELECTORS.adminInvitesOpen);
  await waitFor(
    desktopPage,
    `Boolean(document.querySelector(${JSON.stringify(SELECTORS.adminInviteDialog)}))`,
    'admin:invite-dialog',
  );
  check(!await selectorExists(desktopPage, '[name="inviteTotpCode"]'), 'admin:invite-password-session-only');
  const inviteLabel = `S10 HR invite ${Date.now()}`;
  await setControlledValue(desktopPage, `${SELECTORS.adminInviteForm} input[name="inviteLabel"]`, inviteLabel);
  await setControlledValue(desktopPage, `${SELECTORS.adminInviteForm} input[name="durationHours"]`, '48');
  await setControlledValue(desktopPage, `${SELECTORS.adminInviteForm} input[name="maxSessions"]`, '2');
  await click(desktopPage, `${SELECTORS.adminInviteForm} button[type="submit"]`);
  await waitFor(
    desktopPage,
    `Boolean(document.querySelector(${JSON.stringify(SELECTORS.adminInviteCode)}))`,
    'admin:invite-created',
  );
  const createdInviteCode = await desktopPage.evaluate(
    `document.querySelector(${JSON.stringify(SELECTORS.adminInviteCode)})?.value ?? ''`,
  );
  check(/^morse_[A-Za-z0-9_-]{32}$/u.test(createdInviteCode), 'admin:invite-format');
  check(Buffer.from(createdInviteCode.slice('morse_'.length), 'base64url').length === 24, 'admin:invite-entropy');

  await browserTransport.send('Browser.grantPermissions', {
    origin: targetUrl.origin,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  });
  await click(desktopPage, SELECTORS.adminInviteCopy);
  await waitFor(
    desktopPage,
    `document.querySelector(${JSON.stringify(SELECTORS.adminInviteCopy)})?.textContent?.includes('已复制')`,
    'admin:invite-copy',
  );

  const createdInviteRow = await withPostgresClient(connectionString, (client) => client.query(
    `SELECT id, code_hash, row_to_json(invite_codes)::text AS row_text
       FROM invite_codes
      WHERE label = $1`,
    [inviteLabel],
  ));
  check(createdInviteRow.rowCount === 1, 'admin:invite-row');
  const createdInvite = createdInviteRow.rows[0];
  check(createdInvite.code_hash === hashSecret(createdInviteCode), 'admin:invite-hash-only');
  check(!createdInvite.row_text.includes(createdInviteCode), 'admin:invite-plaintext-storage');

  await assertNoOverflow(desktopPage, 'admin-invite-desktop');
  const inviteDesktopScreenshot = await capture(
    desktopPage,
    outputDirectory,
    's10-admin-invites-desktop-1440x900.png',
  );

  const inviteRowSelector = `${SELECTORS.adminInviteList} [data-invite-id="${createdInvite.id}"]`;
  const inviteIdCopySelector = `${inviteRowSelector} ${SELECTORS.adminInviteIdCopy}`;
  await click(desktopPage, inviteIdCopySelector);
  await waitFor(
    desktopPage,
    `document.querySelector(${JSON.stringify(inviteIdCopySelector)})?.textContent?.includes('已复制')`,
    'admin:invite-id-copy',
  );
  const copiedInviteId = await desktopPage.evaluate('navigator.clipboard.readText()');
  check(copiedInviteId === createdInvite.id, 'admin:invite-id-clipboard');
  checks.add('admin-invite-id-copy');
  await click(desktopPage, `${inviteRowSelector} ${SELECTORS.adminInviteDeactivate}`);
  await click(desktopPage, `${inviteRowSelector} ${SELECTORS.adminInviteDeactivateConfirm}`);
  await waitFor(
    desktopPage,
    `Boolean(document.querySelector(${JSON.stringify(`${inviteRowSelector} [data-status="inactive"]`)}))`,
    'admin:invite-deactivated',
  );
  const deactivatedInvite = await withPostgresClient(connectionString, (client) => client.query(
    'SELECT active FROM invite_codes WHERE id = $1',
    [createdInvite.id],
  ));
  check(deactivatedInvite.rows[0]?.active === false, 'admin:invite-deactivated');

  await click(desktopPage, '[aria-label="关闭邀请码管理"]');
  await waitFor(
    desktopPage,
    `!document.querySelector(${JSON.stringify(SELECTORS.adminInviteDialog)})`,
    'admin:invite-closed',
  );
  await click(desktopPage, SELECTORS.adminInvitesOpen);
  await waitFor(
    desktopPage,
    `Boolean(document.querySelector(${JSON.stringify(SELECTORS.adminInviteDialog)}))`,
    'admin:invite-reopen',
  );
  await delay(100);
  check(!await selectorExists(desktopPage, SELECTORS.adminInviteCode), 'admin:invite-one-time');
  checks.add('admin-invite-management');
  await click(desktopPage, '[aria-label="关闭邀请码管理"]');

  await browserTransport.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDirectory,
    eventsEnabled: true,
  });
  await click(desktopPage, SELECTORS.adminExportOpen);
  await waitFor(desktopPage, `Boolean(document.querySelector(${JSON.stringify(SELECTORS.adminExport)}))`, 'admin:export-dialog');
  const exportText = await desktopPage.evaluate(
    `document.querySelector(${JSON.stringify(SELECTORS.adminExport)})?.textContent ?? ''`,
  );
  check(!/验证码|TOTP/u.test(exportText), 'admin:export-password-only-copy');
  check(
    await selectorExists(desktopPage, `${SELECTORS.adminExport} input[name="exportPassword"]`),
    'admin:export-password-input',
  );
  await assertNoOverflow(desktopPage, 'admin-export-desktop');
  const exportDesktopScreenshot = await capture(
    desktopPage,
    outputDirectory,
    's10-admin-export-desktop-1440x900.png',
  );
  const csvOption = `${SELECTORS.adminExport} label:has(input[name="exportFormat"][value="csv"])`;
  await click(desktopPage, csvOption);
  await setControlledValue(
    desktopPage,
    `${SELECTORS.adminExport} input[name="exportPassword"]`,
    adminPassword,
  );
  await click(desktopPage, `${SELECTORS.adminExport} button[type="submit"]`);
  const exportPath = await withTimeout((async () => {
    while (true) {
      const file = readdirSync(downloadDirectory).find((name) => /^morse-interactions-\d{4}-\d{2}-\d{2}\.csv$/u.test(name));
      if (file) return path.join(downloadDirectory, file);
      await delay(100);
    }
  })(), INTERACTION_TIMEOUT_MS, 'admin:export-download');
  const exportBytes = readFileSync(exportPath);
  check(exportBytes.length > 3 && exportBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'admin:export-bom');
  checks.add('admin-export');
  await assertNoOverflow(desktopPage, 'admin-desktop');
  const desktopScreenshot = await capture(
    desktopPage,
    outputDirectory,
    's10-admin-desktop-1440x900.png',
  );

  await navigate(mobilePage, targetUrl, '/admin');
  await waitFor(mobilePage, `Boolean(document.querySelector(${JSON.stringify(SELECTORS.adminConsole)}))`, 'admin:mobile-console');
  await waitFor(mobilePage, `Boolean(document.querySelector(${JSON.stringify(SELECTORS.adminRow)}))`, 'admin:mobile-list');
  await click(mobilePage, SELECTORS.adminRow);
  await waitFor(mobilePage, `document.querySelector(${JSON.stringify(SELECTORS.adminDetail)})?.getAttribute('data-mobile-open') === 'true'`,
    'admin:mobile-detail');
  const mobileDetail = await mobilePage.evaluate(`(() => {
    const rect = document.querySelector(${JSON.stringify(SELECTORS.adminDetail)})?.getBoundingClientRect();
    return { left: rect?.left ?? -1, top: rect?.top ?? -1, width: rect?.width ?? 0, height: rect?.height ?? 0 };
  })()`);
  check(mobileDetail.left <= 1 && mobileDetail.top <= 1, 'admin:mobile-detail-origin');
  check(mobileDetail.width >= 388 && mobileDetail.height >= 842, 'admin:mobile-detail-fullscreen');
  await waitFor(
    mobilePage,
    `document.querySelector(${JSON.stringify(SELECTORS.adminDetail)})?.textContent?.includes('s10-loopback-smoke')`,
    'admin:invite-label-detail-mobile',
  );
  await assertScrollableToBottom(
    mobilePage,
    SELECTORS.adminDetailScroll,
    'admin:detail-scrollable-mobile',
    'admin:detail-scroll-bottom-mobile',
  );
  await assertNoOverflow(mobilePage, 'admin-mobile');
  const mobileScreenshot = await capture(
    mobilePage,
    outputDirectory,
    's10-admin-mobile-390x844.png',
  );
  await click(mobilePage, '[data-testid="admin-detail-back"]');
  await waitFor(mobilePage, `document.querySelector(${JSON.stringify(SELECTORS.adminDetail)})?.getAttribute('data-mobile-open') === 'false'`,
    'admin:mobile-back');
  checks.add('admin-list-detail');

  await click(mobilePage, SELECTORS.adminInvitesOpen);
  await waitFor(
    mobilePage,
    `Boolean(document.querySelector(${JSON.stringify(SELECTORS.adminInviteDialog)}))`,
    'admin:mobile-invite-dialog',
  );
  const mobileInviteGeometry = await mobilePage.evaluate(`(() => {
    const rect = document.querySelector(${JSON.stringify(SELECTORS.adminInviteDialog)})?.getBoundingClientRect();
    return { left: rect?.left ?? -1, top: rect?.top ?? -1, width: rect?.width ?? 0, height: rect?.height ?? 0 };
  })()`);
  check(
    mobileInviteGeometry.left <= 1
      && mobileInviteGeometry.top <= 1
      && mobileInviteGeometry.width >= 388
      && mobileInviteGeometry.height >= 842,
    'admin:mobile-invite-fullscreen',
  );
  await assertNoOverflow(mobilePage, 'admin-invite-mobile');
  const inviteMobileScreenshot = await capture(
    mobilePage,
    outputDirectory,
    's10-admin-invites-mobile-390x844.png',
  );
  await click(mobilePage, '[aria-label="关闭邀请码管理"]');

  await withPostgresClient(connectionString, (client) => client.query(
    "UPDATE admin_sessions SET expires_at = now() - interval '1 second'",
  ));
  await reload(mobilePage);
  await waitFor(mobilePage, `Boolean(document.querySelector(${JSON.stringify(SELECTORS.adminLogin)}))`, 'admin:session-expiry');
  check(!await selectorExists(mobilePage, '[name="totpCode"]'), 'admin:mobile-login-password-only');
  await assertNoOverflow(mobilePage, 'admin-login-mobile');
  const loginMobileScreenshot = await capture(
    mobilePage,
    outputDirectory,
    's10-admin-login-mobile-390x844.png',
  );
  checks.add('admin-session-expiry');
  return {
    loginDesktopScreenshot,
    exportDesktopScreenshot,
    loginMobileScreenshot,
    desktopScreenshot,
    mobileScreenshot,
    inviteDesktopScreenshot,
    inviteMobileScreenshot,
  };
}

function collectBrowserErrors(pages) {
  const consoleErrors = [];
  const pageErrors = [];
  const externalOrigins = [];
  for (const page of pages) {
    consoleErrors.push(...page.errors.console);
    pageErrors.push(...page.errors.page);
    externalOrigins.push(...page.errors.externalOrigins);
  }
  return {
    consoleErrors: uniqueSorted(consoleErrors.filter(Boolean)),
    pageErrors: uniqueSorted(pageErrors.filter(Boolean)),
    externalOrigins: uniqueSorted(externalOrigins),
  };
}

export async function runS10MockE2E() {
  const checks = new Set();
  const screenshots = [];
  const pages = [];
  const ownedChildren = [];
  let database;
  let runtimeDir;
  let browser;
  let browserTransport;
  let openAiProxy;
  let outputDirectory;
  let chatV2EvidenceDirectory;
  let downloadDirectory;

  try {
    const [appPort, openAiPort, proxyPort, bochaPort] = await Promise.all([
      freePort(), freePort(), freePort(), freePort(),
    ]);
    const targetUrl = validateLoopbackHttpUrl(`http://127.0.0.1:${appPort}`);
    outputDirectory = process.env.S10_EVIDENCE_DIR
      ? path.resolve(process.env.S10_EVIDENCE_DIR)
      : mkdtempSync(path.join(os.tmpdir(), 'revolution-s10-evidence-'));
    mkdirSync(outputDirectory, { recursive: true });
    chatV2EvidenceDirectory = process.env.S10_CHAT_V2_EVIDENCE_DIR
      ? path.resolve(process.env.S10_CHAT_V2_EVIDENCE_DIR)
      : path.join(repoRoot, 'docs', 'verify', 'chat-v2');
    mkdirSync(chatV2EvidenceDirectory, { recursive: true });
    downloadDirectory = mkdtempSync(path.join(os.tmpdir(), 'revolution-s10-download-'));

    try {
      database = await createDisposablePostgresDatabase();
    } catch (error) {
      throw new HarnessError('prerequisite:loopback-pgvector', error);
    }
    const setupEnv = {
      DATABASE_URL: database.connectionString,
      MORSE_ALLOW_TEST_EMBEDDINGS: 'true',
      NODE_ENV: 'test',
    };
    await runNodeScript('scripts/migrate-db.mjs', setupEnv);
    await runNodeScript('scripts/ingest-knowledge.mjs', setupEnv);
    await seedS10EvidenceFixtures(database.connectionString);

    const inviteCode = `s10-${randomBytes(12).toString('hex')}`;
    const inviteId = randomUUID();
    const adminPassword = `S10-${randomBytes(18).toString('base64url')}`;
    await seedInvite(database.connectionString, inviteCode, inviteId);
    const adminPasswordHash = await hashAdminPassword(adminPassword);

    const mockOpenAi = spawnOwned(process.execPath, [path.join(repoRoot, MOCK_OPENAI_SCRIPT)], {
      env: { ...process.env, MORSE_MOCK_OPENAI_PORT: String(openAiPort) },
    });
    const mockBocha = spawnOwned(process.execPath, [path.join(repoRoot, MOCK_BOCHA_SCRIPT)], {
      env: {
        ...process.env,
        MORSE_MOCK_BOCHA_PORT: String(bochaPort),
        MORSE_MOCK_BOCHA_KEY: 'mock-bocha-key',
        MORSE_MOCK_BOCHA_FAIL_QUERY: 'OpenAI API 当前最新官方文档',
      },
    });
    ownedChildren.push(mockOpenAi, mockBocha);
    await Promise.all([
      waitForHttp(`http://127.0.0.1:${openAiPort}/ready`, mockOpenAi, CONNECTION_TIMEOUT_MS, 'mock:openai-start'),
      waitForHttp(`http://127.0.0.1:${bochaPort}/ready`, mockBocha, CONNECTION_TIMEOUT_MS, 'mock:bocha-start'),
    ]);

    openAiProxy = createControllableOpenAiProxy(openAiPort);
    await listen(openAiProxy.server, proxyPort);
    runtimeDir = createRuntimeSnapshot();
    const nextCli = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
    const appEnv = {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_ENV: 'test',
      DATABASE_URL: database.connectionString,
      MORSE_PUBLIC_ORIGIN: targetUrl.origin,
      MORSE_LOCAL_RELEASE_SMOKE: 'true',
      MORSE_PROVIDER_MOCK_ORIGIN: `http://127.0.0.1:${proxyPort}`,
      MORSE_DATABASE_SSL_MODE: 'disable',
      OPENAI_API_KEY: 'mock-primary-key',
      OPENAI_BASE_URL: `http://127.0.0.1:${proxyPort}/v1`,
      OPENAI_FALLBACK_1_API_KEY: 'mock-fallback-key',
      OPENAI_FALLBACK_1_BASE_URL: `http://127.0.0.1:${proxyPort}/v1`,
      OPENAI_CHAT_MODEL: 'mock-gpt',
      OPENAI_CHAT_PROTOCOL: 'responses',
      OPENAI_EMBEDDING_API_KEY: 'mock-embedding-key',
      OPENAI_EMBEDDING_BASE_URL: `http://127.0.0.1:${proxyPort}/v1`,
      OPENAI_EMBEDDING_MODEL: 'mock-embedding',
      MORSE_ALLOW_TEST_EMBEDDINGS: 'true',
      MORSE_CHAT_ENABLED: 'true',
      MORSE_CHAT_V2_ENABLED: 'true',
      MORSE_CHAT_V2_CANARY_PERCENT: '100',
      MORSE_CHAT_HEDGED_FAILOVER_ENABLED: 'false',
      MORSE_SEARCH_ENABLED: 'true',
      MORSE_SEARCH_PROVIDER: 'bocha',
      BOCHA_API_KEY: 'mock-bocha-key',
      BOCHA_BASE_URL: `http://127.0.0.1:${bochaPort}/v1`,
      MORSE_INPUT_USD_PER_MILLION: '0.01',
      MORSE_OUTPUT_USD_PER_MILLION: '0.02',
      MORSE_PROVIDER_FIRST_BYTE_TIMEOUT_MS: '10000',
      MORSE_PROVIDER_TOTAL_TIMEOUT_MS: '30000',
      MORSE_SEARCH_TIMEOUT_MS: '5000',
      MORSE_SSE_HEARTBEAT_MS: '1000',
      MORSE_ADMIN_PASSWORD_HASH: adminPasswordHash,
      MORSE_ADMIN_ALLOWED_ORIGIN: targetUrl.origin,
      MORSE_INVITE_FINGERPRINT_SECRET: randomBytes(32).toString('hex'),
    };
    const build = spawnOwned(process.execPath, [nextCli, 'build', '--webpack'], {
      cwd: runtimeDir,
      env: { ...appEnv, NODE_ENV: 'production' },
    });
    ownedChildren.push(build);
    const buildExitCode = await withTimeout(
      new Promise((resolve) => build.child.once('exit', resolve)),
      BUILD_TIMEOUT_MS,
      'app:build-timeout',
    );
    if (buildExitCode !== 0) {
      throw new HarnessError('app:build-failed');
    }

    const app = spawnOwned(process.execPath, [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(appPort)], {
      cwd: runtimeDir,
      env: appEnv,
    });
    ownedChildren.push(app);
    await waitForHttp(new URL('/api/health', targetUrl), app, APP_START_TIMEOUT_MS, 'app:start');

    browser = await launchEdge();
    browserTransport = await connectCdpTransport(browser.browserWebSocketUrl, {
      commandTimeoutMs: INTERACTION_TIMEOUT_MS,
      connectTimeoutMs: CONNECTION_TIMEOUT_MS,
    });
    const visitorDesktop = await openTab(browser, targetUrl, S10_VIEWPORTS[0]);
    pages.push(visitorDesktop);
    await runVisitorScenarios({
      page: visitorDesktop,
      targetUrl,
      browserTransport,
      inviteCode,
      connectionString: database.connectionString,
      openAiProxy,
      checks,
      chatV2EvidenceDirectory,
      screenshots,
    });
    screenshots.push(await capture(visitorDesktop, outputDirectory, 's10-chat-desktop-1440x900.png'));

    const visitorMobile = await openTab(browser, targetUrl, S10_VIEWPORTS[1]);
    pages.push(visitorMobile);
    screenshots.push(await runMobileVisitor({
      page: visitorMobile,
      targetUrl,
      connectionString: database.connectionString,
      inviteId,
      outputDirectory,
      checks,
      openAiProxy,
      chatV2EvidenceDirectory,
      screenshots,
    }));

    const adminDesktop = await openTab(browser, targetUrl, S10_VIEWPORTS[0]);
    const adminMobile = await openTab(browser, targetUrl, S10_VIEWPORTS[1]);
    pages.push(adminDesktop, adminMobile);
    const adminScreenshots = await runAdminScenarios({
      desktopPage: adminDesktop,
      mobilePage: adminMobile,
      browserTransport,
      targetUrl,
      connectionString: database.connectionString,
      adminPassword,
      outputDirectory,
      downloadDirectory,
      checks,
    });
    screenshots.push(
      adminScreenshots.loginDesktopScreenshot,
      adminScreenshots.exportDesktopScreenshot,
      adminScreenshots.loginMobileScreenshot,
      adminScreenshots.desktopScreenshot,
      adminScreenshots.mobileScreenshot,
      adminScreenshots.inviteDesktopScreenshot,
      adminScreenshots.inviteMobileScreenshot,
    );
    checks.add('dual-width-overflow');

    const browserErrors = collectBrowserErrors(pages);
    check(browserErrors.externalOrigins.length === 0, 'browser:external-request');
    check(browserErrors.consoleErrors.length === 0, 'browser:console-error');
    check(browserErrors.pageErrors.length === 0, 'browser:page-error');
    checks.add('console-page-errors');

    return createS10Summary({
      checks: [...checks],
      screenshots: screenshots.map((filePath) => path.basename(filePath)),
      failures: S10_SCENARIOS.filter((scenario) => !checks.has(scenario)).map((scenario) => `missing:${scenario}`),
      consoleErrors: browserErrors.consoleErrors,
      pageErrors: browserErrors.pageErrors,
    });
  } catch (error) {
    const pageStates = await Promise.all(pages.map(async (page) => {
      try {
        const state = await page.evaluate(`(() => {
          const assistants = [...document.querySelectorAll(${JSON.stringify(`${SELECTORS.chatTranscript} article[data-message-role="assistant"]`)})];
          const assistant = assistants.at(-1);
          return {
            path: location.pathname,
            phase: document.querySelector(${JSON.stringify(SELECTORS.chatPhase)})?.getAttribute('data-phase') ?? null,
            assistantCount: assistants.length,
            assistantState: assistant?.getAttribute('data-stream-state') ?? null,
            assistantHasText: Boolean(assistant?.querySelector('[data-testid="morse-chat-message-content"]')?.textContent),
          };
        })()`);
        return { ...state, ...createSafeChatRequestMetrics(page.metrics) };
      } catch {
        return { unavailable: true };
      }
    }));
    let interactionStates = [];
    if (database?.connectionString) {
      try {
        interactionStates = await withPostgresClient(database.connectionString, async (client) => {
          const result = await client.query(
            `SELECT turn.status, turn.error_code, turn.route_kind, turn.topic_ref,
                    jsonb_array_length(turn.knowledge_sources) AS source_count,
                    (SELECT count(*)::integer
                       FROM chat_provider_attempts AS attempt
                      WHERE attempt.interaction_turn_id = turn.id) AS attempt_count
               FROM interaction_turns AS turn
              ORDER BY created_at DESC
              LIMIT 5`,
          );
          return result.rows;
        });
      } catch {
        interactionStates = [{ unavailable: true }];
      }
    }
    console.error(JSON.stringify({
      kind: 'S10_SAFE_DIAGNOSTICS',
      error: {
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      },
      proxy: openAiProxy?.diagnostics?.() ?? null,
      pageStates,
      interactionStates,
    }));
    throw error;
  } finally {
    let browserCleanupError = null;
    openAiProxy?.releaseHeldResponse();
    for (const page of pages.reverse()) await closeTab(page).catch(() => undefined);
    browserTransport?.dispose();
    if (browser) {
      try {
        await cleanupS10Browser(browser);
      } catch (error) {
        browserCleanupError = error;
      }
    }
    await closeServer(openAiProxy?.server).catch(() => undefined);
    for (const child of ownedChildren.reverse()) await terminateOwnedChild(child).catch(() => undefined);
    if (database) await database.dispose().catch(() => undefined);
    if (runtimeDir) removeRuntimeSnapshot(runtimeDir);
    if (downloadDirectory) removeDownloadDirectory(downloadDirectory);
    if (browserCleanupError) throw browserCleanupError;
  }
}

function isDirectExecution() {
  return Boolean(process.argv[1])
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isDirectExecution()) {
  runS10MockE2E().then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.passed) process.exitCode = 1;
  }).catch((error) => {
    const code = error instanceof HarnessError ? error.code : 'harness:unexpected';
    console.error(JSON.stringify(createS10Summary({ failures: [code] }), null, 2));
    process.exitCode = 1;
  });
}
