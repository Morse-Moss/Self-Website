#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function identity(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function timestampMs(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tokenValue(value) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function tokenOrZero(value) {
  return tokenValue(value) ?? 0;
}

function hasTokenValue(usage, keys) {
  return keys.some((key) => Object.hasOwn(usage, key) && tokenValue(usage[key]) !== null);
}

function emptyTokenTotals() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function addTokenTotals(target, usage) {
  for (const key of Object.keys(target)) target[key] += usage[key];
}

function parseClaudeUsage(usage) {
  if (!isObject(usage)) return null;
  const keys = [
    'input_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
    'output_tokens',
    'reasoning_output_tokens',
  ];
  if (!hasTokenValue(usage, keys)) return null;

  const uncachedInput = tokenOrZero(usage.input_tokens);
  const cacheCreation = tokenOrZero(usage.cache_creation_input_tokens);
  const cacheRead = tokenOrZero(usage.cache_read_input_tokens);
  const output = tokenOrZero(usage.output_tokens);

  return {
    inputTokens: uncachedInput + cacheCreation + cacheRead,
    outputTokens: output,
    cachedInputTokens: cacheRead,
    cacheCreationInputTokens: cacheCreation,
    reasoningOutputTokens: tokenOrZero(usage.reasoning_output_tokens),
    totalTokens: uncachedInput + cacheCreation + cacheRead + output,
  };
}

function parseCodexUsage(usage) {
  if (!isObject(usage)) return null;
  const keys = [
    'input_tokens',
    'cached_input_tokens',
    'output_tokens',
    'reasoning_output_tokens',
    'total_tokens',
  ];
  if (!hasTokenValue(usage, keys)) return null;

  const input = tokenOrZero(usage.input_tokens);
  const output = tokenOrZero(usage.output_tokens);
  const reportedTotal = tokenValue(usage.total_tokens);

  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: tokenOrZero(usage.cached_input_tokens),
    cacheCreationInputTokens: 0,
    reasoningOutputTokens: tokenOrZero(usage.reasoning_output_tokens),
    totalTokens: reportedTotal ?? input + output,
  };
}

export function parseClaudeRecord(record) {
  if (!isObject(record) || record.type !== 'assistant') return null;

  return {
    kind: 'activity',
    sessionIdentity: identity(record.sessionId),
    projectIdentity: identity(record.cwd),
    timestampMs: timestampMs(record.timestamp),
    usageExpected: true,
    usage: parseClaudeUsage(record.message?.usage),
  };
}

export function parseCodexRecord(record) {
  if (!isObject(record)) return null;

  if (record.type === 'session_meta' && isObject(record.payload)) {
    return {
      kind: 'session',
      sessionIdentity: identity(record.payload.id),
      projectIdentity: identity(record.payload.cwd),
      timestampMs: timestampMs(record.timestamp),
      usageExpected: false,
      usage: null,
    };
  }

  if (record.type !== 'event_msg' || record.payload?.type !== 'token_count') return null;

  return {
    kind: 'activity',
    sessionIdentity: null,
    projectIdentity: null,
    timestampMs: timestampMs(record.timestamp),
    usageExpected: true,
    usage: parseCodexUsage(record.payload?.info?.last_token_usage),
  };
}

export function normalizeProjectIdentity(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return path.resolve(value).replaceAll('\\', '/').toLowerCase();
}

export function withinDays(timestamp, nowMs, days) {
  return timestamp <= nowMs && nowMs - timestamp <= days * DAY_MS;
}

function dateString(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function unavailableActivity() {
  return {
    sessions: null,
    projects: null,
    coverageStart: null,
    coverageEnd: null,
    allTime: null,
    last30Days: null,
    recordsWithoutUsage: 0,
  };
}

export function aggregateToolActivity(records, nowMs, { sourceAvailable = true } = {}) {
  if (!sourceAvailable) {
    return {
      activity: unavailableActivity(),
      sessionIdentities: null,
      projectIdentities: null,
      activeDaysLast90: null,
    };
  }

  const sessionIdentities = new Set();
  const projectIdentities = new Set();
  const activeDaysLast90 = new Set();
  const allTime = emptyTokenTotals();
  const last30Days = emptyTokenTotals();
  let minTimestamp = Number.POSITIVE_INFINITY;
  let maxTimestamp = Number.NEGATIVE_INFINITY;
  let allTimeUsageRecords = 0;
  let recentUsageRecords = 0;
  let recordsWithoutUsage = 0;
  let missingSessionIdentity = false;
  let missingProjectIdentity = false;

  for (const record of records) {
    if (!record) continue;

    if (record.sessionIdentity) sessionIdentities.add(record.sessionIdentity);
    else if (record.kind === 'session' || record.usageExpected) missingSessionIdentity = true;

    const projectIdentity = normalizeProjectIdentity(record.projectIdentity);
    if (projectIdentity) projectIdentities.add(projectIdentity);
    else if (record.kind === 'session' || record.usageExpected) missingProjectIdentity = true;

    if (Number.isFinite(record.timestampMs)) {
      minTimestamp = Math.min(minTimestamp, record.timestampMs);
      maxTimestamp = Math.max(maxTimestamp, record.timestampMs);
      if (withinDays(record.timestampMs, nowMs, 90)) {
        activeDaysLast90.add(dateString(record.timestampMs));
      }
    }

    if (record.usageExpected && record.usage === null) recordsWithoutUsage += 1;
    if (record.usage === null) continue;

    addTokenTotals(allTime, record.usage);
    allTimeUsageRecords += 1;
    if (Number.isFinite(record.timestampMs) && withinDays(record.timestampMs, nowMs, 30)) {
      addTokenTotals(last30Days, record.usage);
      recentUsageRecords += 1;
    }
  }

  const coverageStart = Number.isFinite(minTimestamp) ? dateString(minTimestamp) : null;
  const coverageEnd = Number.isFinite(maxTimestamp) ? dateString(maxTimestamp) : null;

  return {
    activity: {
      sessions: missingSessionIdentity ? null : sessionIdentities.size,
      projects: missingProjectIdentity ? null : projectIdentities.size,
      coverageStart,
      coverageEnd,
      allTime: allTimeUsageRecords > 0 ? allTime : null,
      last30Days: recentUsageRecords > 0 ? last30Days : null,
      recordsWithoutUsage,
    },
    sessionIdentities: missingSessionIdentity ? null : sessionIdentities,
    projectIdentities: missingProjectIdentity ? null : projectIdentities,
    activeDaysLast90,
  };
}

export function mergeActivityTotals(...aggregates) {
  const sessions = aggregates.every(({ activity }) => activity.sessions !== null)
    ? aggregates.reduce((sum, { activity }) => sum + activity.sessions, 0)
    : null;

  let projects = null;
  if (aggregates.every(({ projectIdentities }) => projectIdentities instanceof Set)) {
    const identities = new Set();
    for (const aggregate of aggregates) {
      for (const projectIdentity of aggregate.projectIdentities) identities.add(projectIdentity);
    }
    projects = identities.size;
  }

  let activeDaysLast90 = null;
  if (aggregates.every(({ activeDaysLast90: days }) => days instanceof Set)) {
    const days = new Set();
    for (const aggregate of aggregates) {
      for (const day of aggregate.activeDaysLast90) days.add(day);
    }
    activeDaysLast90 = days.size;
  }

  return { sessions, projects, activeDaysLast90 };
}

function listJsonlFiles(root) {
  if (!fs.existsSync(root)) return null;

  const files = [];
  const pending = [root];
  try {
    while (pending.length > 0) {
      const directory = pending.pop();
      const entries = fs.readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) pending.push(entryPath);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(entryPath);
      }
    }
  } catch {
    return [];
  }
  return files.sort();
}

async function readJsonl(filePath, onRecord) {
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        onRecord(JSON.parse(line));
      } catch {
        // A malformed record does not invalidate other verifiable records.
      }
    }
  } catch {
    // An unreadable file contributes no data and does not expose its contents.
  } finally {
    lines.close();
  }
}

async function scanClaudeRecords(root) {
  const files = listJsonlFiles(root);
  if (files === null) return { sourceAvailable: false, records: [] };

  const records = [];
  for (const filePath of files) {
    await readJsonl(filePath, (record) => {
      const parsed = parseClaudeRecord(record);
      if (parsed) records.push(parsed);
    });
  }
  return { sourceAvailable: true, records };
}

async function readCodexSession(filePath) {
  let metadata = null;
  const activity = [];
  await readJsonl(filePath, (record) => {
    const parsed = parseCodexRecord(record);
    if (!parsed) return;
    if (parsed.kind === 'session' && parsed.sessionIdentity && metadata === null) metadata = parsed;
    else if (parsed.kind === 'activity') activity.push(parsed);
  });
  if (metadata === null) return null;

  const records = [metadata];
  for (const record of activity) {
    records.push({
      ...record,
      sessionIdentity: metadata.sessionIdentity,
      projectIdentity: metadata.projectIdentity,
    });
  }
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    if (Number.isFinite(record.timestampMs)) {
      latestTimestamp = Math.max(latestTimestamp, record.timestampMs);
    }
  }
  return {
    sessionIdentity: metadata.sessionIdentity,
    records,
    activityRecords: activity.length,
    latestTimestamp,
  };
}

function isMoreComplete(candidate, existing) {
  if (candidate.activityRecords !== existing.activityRecords) {
    return candidate.activityRecords > existing.activityRecords;
  }
  return candidate.latestTimestamp > existing.latestTimestamp;
}

async function scanCodexRecords(sessionsRoot, archivedSessionsRoot) {
  const activeFiles = listJsonlFiles(sessionsRoot);
  const archivedFiles = listJsonlFiles(archivedSessionsRoot);
  const sourceAvailable = activeFiles !== null || archivedFiles !== null;
  if (!sourceAvailable) return { sourceAvailable: false, records: [] };

  const sessions = new Map();
  for (const filePath of [...(activeFiles ?? []), ...(archivedFiles ?? [])]) {
    const candidate = await readCodexSession(filePath);
    if (!candidate) continue;
    const existing = sessions.get(candidate.sessionIdentity);
    if (!existing || isMoreComplete(candidate, existing)) {
      sessions.set(candidate.sessionIdentity, candidate);
    }
  }

  return {
    sourceAvailable: true,
    records: [...sessions.values()].flatMap(({ records }) => records),
  };
}

export function buildMethodology() {
  return (
    '会话数按各工具的稳定标识去重，Codex 活动与归档中的同一会话只保留一份；' +
    'Claude Code 累计每条 assistant message usage，输入量包含普通输入、缓存创建与缓存读取；' +
    'Codex 仅累计每次 token_count 的 last_token_usage；' +
    '项目覆盖与近 90 天活跃日按两个工具的归一化集合合并，最近 30 天含边界；' +
    '缺失 usage 只计入缺口，不估算 Token。输出仅含聚合数字、日期与方法说明。'
  );
}

export async function collectDevelopmentStats({
  claudeProjectsRoot,
  codexSessionsRoot,
  codexArchivedSessionsRoot,
  nowMs = Date.now(),
}) {
  const [claudeSource, codexSource] = await Promise.all([
    scanClaudeRecords(claudeProjectsRoot),
    scanCodexRecords(codexSessionsRoot, codexArchivedSessionsRoot),
  ]);
  const claudeAggregate = aggregateToolActivity(claudeSource.records, nowMs, {
    sourceAvailable: claudeSource.sourceAvailable,
  });
  const codexAggregate = aggregateToolActivity(codexSource.records, nowMs, {
    sourceAvailable: codexSource.sourceAvailable,
  });

  return {
    generatedAt: new Date(nowMs).toISOString(),
    methodology: buildMethodology(),
    totals: mergeActivityTotals(claudeAggregate, codexAggregate),
    claudeCode: claudeAggregate.activity,
    codex: codexAggregate.activity,
  };
}

const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
const claudeProjectsRoot = path.join(home, '.claude', 'projects');
const codexSessionsRoot = path.join(home, '.codex', 'sessions');
const codexArchivedSessionsRoot = path.join(home, '.codex', 'archived_sessions');
const filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(filename), '..');
const outputPath = path.join(repoRoot, 'content', 'stats.json');

async function main() {
  const stats = await collectDevelopmentStats({
    claudeProjectsRoot,
    codexSessionsRoot,
    codexArchivedSessionsRoot,
  });
  fs.writeFileSync(outputPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
  console.log('Aggregate development statistics updated.');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === filename;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
