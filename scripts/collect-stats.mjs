#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;
const dateFormatters = new Map();

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

export function dateKey(timestamp, timeZone = 'Asia/Shanghai') {
  if (!Number.isFinite(timestamp)) return null;
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
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

function createActivityAccumulator(nowMs, sourceAvailable = true) {
  return {
    sourceAvailable,
    nowMs,
    sessionIdentities: new Set(),
    projectIdentities: new Set(),
    activeDaysLast90: new Set(),
    allTime: emptyTokenTotals(),
    last30Days: emptyTokenTotals(),
    minTimestamp: Number.POSITIVE_INFINITY,
    maxTimestamp: Number.NEGATIVE_INFINITY,
    usageMinTimestamp: Number.POSITIVE_INFINITY,
    usageMaxTimestamp: Number.NEGATIVE_INFINITY,
    usageTimestampRecords: 0,
    allTimeUsageRecords: 0,
    recentUsageRecords: 0,
    recordsWithoutUsage: 0,
    missingSessionIdentity: false,
    missingProjectIdentity: false,
  };
}

function addActivityRecord(accumulator, record, { trackIdentity = true } = {}) {
  if (!record) return false;
  if (Number.isFinite(record.timestampMs) && record.timestampMs > accumulator.nowMs) return false;

  if (trackIdentity) {
    if (record.sessionIdentity) accumulator.sessionIdentities.add(record.sessionIdentity);
    else if (record.kind === 'session' || record.usageExpected) {
      accumulator.missingSessionIdentity = true;
    }

    const projectIdentity = normalizeProjectIdentity(record.projectIdentity);
    if (projectIdentity) accumulator.projectIdentities.add(projectIdentity);
    else if (record.kind === 'session' || record.usageExpected) {
      accumulator.missingProjectIdentity = true;
    }
  }

  if (Number.isFinite(record.timestampMs)) {
    accumulator.minTimestamp = Math.min(accumulator.minTimestamp, record.timestampMs);
    accumulator.maxTimestamp = Math.max(accumulator.maxTimestamp, record.timestampMs);
    if (withinDays(record.timestampMs, accumulator.nowMs, 90)) {
      accumulator.activeDaysLast90.add(dateKey(record.timestampMs));
    }
  }

  if (record.usageExpected && record.usage === null) accumulator.recordsWithoutUsage += 1;
  if (record.usage === null) return true;

  addTokenTotals(accumulator.allTime, record.usage);
  accumulator.allTimeUsageRecords += 1;
  if (Number.isFinite(record.timestampMs)) {
    accumulator.usageMinTimestamp = Math.min(accumulator.usageMinTimestamp, record.timestampMs);
    accumulator.usageMaxTimestamp = Math.max(accumulator.usageMaxTimestamp, record.timestampMs);
    accumulator.usageTimestampRecords += 1;
    if (withinDays(record.timestampMs, accumulator.nowMs, 30)) {
      addTokenTotals(accumulator.last30Days, record.usage);
      accumulator.recentUsageRecords += 1;
    }
  }
  return true;
}

function mergeActivityAccumulator(target, source) {
  for (const sessionIdentity of source.sessionIdentities) {
    target.sessionIdentities.add(sessionIdentity);
  }
  for (const projectIdentity of source.projectIdentities) {
    target.projectIdentities.add(projectIdentity);
  }
  for (const day of source.activeDaysLast90) target.activeDaysLast90.add(day);
  addTokenTotals(target.allTime, source.allTime);
  addTokenTotals(target.last30Days, source.last30Days);
  target.minTimestamp = Math.min(target.minTimestamp, source.minTimestamp);
  target.maxTimestamp = Math.max(target.maxTimestamp, source.maxTimestamp);
  target.usageMinTimestamp = Math.min(target.usageMinTimestamp, source.usageMinTimestamp);
  target.usageMaxTimestamp = Math.max(target.usageMaxTimestamp, source.usageMaxTimestamp);
  target.usageTimestampRecords += source.usageTimestampRecords;
  target.allTimeUsageRecords += source.allTimeUsageRecords;
  target.recentUsageRecords += source.recentUsageRecords;
  target.recordsWithoutUsage += source.recordsWithoutUsage;
  target.missingSessionIdentity ||= source.missingSessionIdentity;
  target.missingProjectIdentity ||= source.missingProjectIdentity;
}

function finalizeActivityAccumulator(accumulator) {
  if (!accumulator.sourceAvailable) {
    return {
      activity: unavailableActivity(),
      sessionIdentities: null,
      projectIdentities: null,
      activeDaysLast90: null,
    };
  }

  const coverageStart = Number.isFinite(accumulator.minTimestamp)
    ? dateKey(accumulator.minTimestamp)
    : null;
  const coverageEnd = Number.isFinite(accumulator.maxTimestamp)
    ? dateKey(accumulator.maxTimestamp)
    : null;
  return {
    activity: {
      sessions: accumulator.missingSessionIdentity ? null : accumulator.sessionIdentities.size,
      projects: accumulator.missingProjectIdentity ? null : accumulator.projectIdentities.size,
      coverageStart,
      coverageEnd,
      allTime: accumulator.allTimeUsageRecords > 0 ? accumulator.allTime : null,
      last30Days: accumulator.recentUsageRecords > 0 ? accumulator.last30Days : null,
      recordsWithoutUsage: accumulator.recordsWithoutUsage,
    },
    sessionIdentities: accumulator.missingSessionIdentity ? null : accumulator.sessionIdentities,
    projectIdentities: accumulator.missingProjectIdentity ? null : accumulator.projectIdentities,
    activeDaysLast90: accumulator.activeDaysLast90,
  };
}

export function aggregateToolActivity(records, nowMs, { sourceAvailable = true } = {}) {
  const accumulator = createActivityAccumulator(nowMs, sourceAvailable);
  for (const record of records) addActivityRecord(accumulator, record);
  return finalizeActivityAccumulator(accumulator);
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

async function scanClaudeActivity(root, nowMs) {
  const files = listJsonlFiles(root);
  const accumulator = createActivityAccumulator(nowMs, files !== null);
  let parsedRecords = 0;

  for (const filePath of files ?? []) {
    await readJsonl(filePath, (record) => {
      const parsed = parseClaudeRecord(record);
      if (!parsed) return;
      parsedRecords += 1;
      addActivityRecord(accumulator, parsed);
    });
  }
  return {
    aggregate: finalizeActivityAccumulator(accumulator),
    scanSummary: {
      tool: 'claudeCode',
      parsedRecords,
      retainedEventRecords: 0,
      retainedSessionSummaries: 0,
    },
  };
}

async function readCodexSession(filePath, nowMs) {
  let metadata = null;
  let parsedRecords = 0;
  const accumulator = createActivityAccumulator(nowMs);
  await readJsonl(filePath, (record) => {
    const parsed = parseCodexRecord(record);
    if (!parsed) return;
    parsedRecords += 1;
    if (parsed.kind === 'session') {
      if (Number.isFinite(parsed.timestampMs) && parsed.timestampMs > nowMs) return;
      if (parsed.sessionIdentity && metadata === null) metadata = parsed;
      return;
    }
    addActivityRecord(accumulator, parsed, { trackIdentity: false });
  });
  if (metadata === null) return { parsedRecords, summary: null };

  addActivityRecord(accumulator, metadata);
  return {
    parsedRecords,
    summary: {
      sessionIdentity: metadata.sessionIdentity,
      metadataCompleteness:
        1 + Number(metadata.projectIdentity !== null) + Number(Number.isFinite(metadata.timestampMs)),
      accumulator,
    },
  };
}

function isMoreComplete(candidate, existing) {
  if (candidate.metadataCompleteness !== existing.metadataCompleteness) {
    return candidate.metadataCompleteness > existing.metadataCompleteness;
  }

  const candidateState = candidate.accumulator;
  const existingState = existing.accumulator;
  if (candidateState.allTimeUsageRecords !== existingState.allTimeUsageRecords) {
    return candidateState.allTimeUsageRecords > existingState.allTimeUsageRecords;
  }
  if (candidateState.usageTimestampRecords !== existingState.usageTimestampRecords) {
    return candidateState.usageTimestampRecords > existingState.usageTimestampRecords;
  }

  const candidateSpan = Number.isFinite(candidateState.usageMinTimestamp)
    ? candidateState.usageMaxTimestamp - candidateState.usageMinTimestamp
    : Number.NEGATIVE_INFINITY;
  const existingSpan = Number.isFinite(existingState.usageMinTimestamp)
    ? existingState.usageMaxTimestamp - existingState.usageMinTimestamp
    : Number.NEGATIVE_INFINITY;
  if (candidateSpan !== existingSpan) return candidateSpan > existingSpan;
  if (candidateState.usageMinTimestamp !== existingState.usageMinTimestamp) {
    return candidateState.usageMinTimestamp < existingState.usageMinTimestamp;
  }
  if (candidateState.usageMaxTimestamp !== existingState.usageMaxTimestamp) {
    return candidateState.usageMaxTimestamp > existingState.usageMaxTimestamp;
  }
  return false;
}

async function scanCodexActivity(sessionsRoot, archivedSessionsRoot, nowMs) {
  const activeFiles = listJsonlFiles(sessionsRoot);
  const archivedFiles = listJsonlFiles(archivedSessionsRoot);
  const sourceAvailable = activeFiles !== null || archivedFiles !== null;
  const sessions = new Map();
  let parsedRecords = 0;
  for (const files of [activeFiles ?? [], archivedFiles ?? []]) {
    for (const filePath of files) {
      const { parsedRecords: fileRecords, summary: candidate } = await readCodexSession(
        filePath,
        nowMs,
      );
      parsedRecords += fileRecords;
      if (!candidate) continue;
      const existing = sessions.get(candidate.sessionIdentity);
      if (!existing || isMoreComplete(candidate, existing)) {
        sessions.set(candidate.sessionIdentity, candidate);
      }
    }
  }

  const accumulator = createActivityAccumulator(nowMs, sourceAvailable);
  for (const { accumulator: sessionAccumulator } of sessions.values()) {
    mergeActivityAccumulator(accumulator, sessionAccumulator);
  }
  return {
    aggregate: finalizeActivityAccumulator(accumulator),
    scanSummary: {
      tool: 'codex',
      parsedRecords,
      retainedEventRecords: 0,
      retainedSessionSummaries: sessions.size,
    },
  };
}

export function buildMethodology() {
  return (
    '会话数按各工具的稳定标识去重，Codex 活动与归档中的同一会话只保留一份；' +
    'Claude Code 累计每条 assistant message usage，输入量包含普通输入、缓存创建与缓存读取；' +
    'Codex 仅累计每次 token_count 的 last_token_usage；' +
    '项目覆盖按两个工具的归一化集合合并，coverage 与活跃自然日统一使用 Asia/Shanghai；' +
    '最近 30 天与近 90 天窗口按经过时长计算并包含边界；' +
    '缺失 usage 只计入缺口，不估算 Token。输出仅含聚合数字、日期与方法说明。'
  );
}

export function formatCliError() {
  return 'STATS_COLLECTION_FAILED';
}

export async function collectDevelopmentStats({
  claudeProjectsRoot,
  codexSessionsRoot,
  codexArchivedSessionsRoot,
  nowMs = Date.now(),
  onScanSummary,
}) {
  const claudeSource = await scanClaudeActivity(claudeProjectsRoot, nowMs);
  if (typeof onScanSummary === 'function') onScanSummary(claudeSource.scanSummary);
  const codexSource = await scanCodexActivity(
    codexSessionsRoot,
    codexArchivedSessionsRoot,
    nowMs,
  );
  if (typeof onScanSummary === 'function') onScanSummary(codexSource.scanSummary);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    methodology: buildMethodology(),
    totals: mergeActivityTotals(claudeSource.aggregate, codexSource.aggregate),
    claudeCode: claudeSource.aggregate.activity,
    codex: codexSource.aggregate.activity,
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
  main().catch(() => {
    console.error(formatCliError());
    process.exitCode = 1;
  });
}
