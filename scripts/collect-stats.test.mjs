import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as collector from './collect-stats.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.parse('2026-07-15T12:00:00.000Z');

const claudeRecord = {
  type: 'assistant',
  sessionId: 'cc-1',
  timestamp: '2026-07-10T10:00:00.000Z',
  cwd: 'C:\\private\\alpha',
  message: {
    usage: {
      input_tokens: 100,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 40,
      output_tokens: 30,
    },
  },
};

const codexRecord = {
  timestamp: '2026-07-11T10:00:00.000Z',
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      last_token_usage: {
        input_tokens: 200,
        cached_input_tokens: 50,
        output_tokens: 60,
        reasoning_output_tokens: 10,
        total_tokens: 260,
      },
    },
  },
};

function feature(name) {
  assert.equal(typeof collector[name], 'function', `${name} must be exported`);
  return collector[name];
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'revolution-stats-'));
}

function writeJsonl(filePath, records, malformedLine = false) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = records.map((record) => JSON.stringify(record));
  if (malformedLine) lines.splice(1, 0, '{malformed-json');
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function expectedTotals(overrides = {}) {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    ...overrides,
  };
}

test('parseClaudeRecord maps assistant usage without retaining raw content', () => {
  const parseClaudeRecord = feature('parseClaudeRecord');
  const parsed = parseClaudeRecord({
    ...claudeRecord,
    message: {
      ...claudeRecord.message,
      content: 'SUPER-SECRET-RAW-CONTENT',
    },
  });

  assert.deepEqual(parsed, {
    kind: 'activity',
    sessionIdentity: 'cc-1',
    projectIdentity: 'C:\\private\\alpha',
    timestampMs: Date.parse('2026-07-10T10:00:00.000Z'),
    usageExpected: true,
    usage: expectedTotals({
      inputTokens: 160,
      outputTokens: 30,
      cachedInputTokens: 40,
      cacheCreationInputTokens: 20,
      totalTokens: 190,
    }),
  });
  assert.doesNotMatch(JSON.stringify(parsed), /SUPER-SECRET-RAW-CONTENT/);
});

test('parseCodexRecord maps session metadata and last usage only', () => {
  const parseCodexRecord = feature('parseCodexRecord');
  const metadata = parseCodexRecord({
    timestamp: '2026-07-11T09:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: 'codex-1',
      cwd: 'C:\\private\\alpha',
      instructions: 'SUPER-SECRET-RAW-CONTENT',
    },
  });
  const usage = parseCodexRecord({
    ...codexRecord,
    payload: {
      ...codexRecord.payload,
      info: {
        ...codexRecord.payload.info,
        total_token_usage: {
          input_tokens: 999999,
          output_tokens: 999999,
          total_tokens: 1999998,
        },
      },
    },
  });

  assert.deepEqual(metadata, {
    kind: 'session',
    sessionIdentity: 'codex-1',
    projectIdentity: 'C:\\private\\alpha',
    timestampMs: Date.parse('2026-07-11T09:00:00.000Z'),
    usageExpected: false,
    usage: null,
  });
  assert.deepEqual(usage, {
    kind: 'activity',
    sessionIdentity: null,
    projectIdentity: null,
    timestampMs: Date.parse('2026-07-11T10:00:00.000Z'),
    usageExpected: true,
    usage: expectedTotals({
      inputTokens: 200,
      outputTokens: 60,
      cachedInputTokens: 50,
      reasoningOutputTokens: 10,
      totalTokens: 260,
    }),
  });
  assert.doesNotMatch(JSON.stringify(metadata), /SUPER-SECRET-RAW-CONTENT/);
});

test('Codex cumulative usage is never used when last usage is missing', () => {
  const parseCodexRecord = feature('parseCodexRecord');
  const parsed = parseCodexRecord({
    timestamp: '2026-07-12T10:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 500,
          output_tokens: 100,
          total_tokens: 600,
        },
      },
    },
  });

  assert.equal(parsed.usageExpected, true);
  assert.equal(parsed.usage, null);
});

test('aggregateToolActivity computes all-time and recent coverage totals', () => {
  const parseClaudeRecord = feature('parseClaudeRecord');
  const aggregateToolActivity = feature('aggregateToolActivity');
  const records = [
    parseClaudeRecord(claudeRecord),
    parseClaudeRecord({
      type: 'assistant',
      sessionId: 'cc-2',
      timestamp: '2026-05-01T08:00:00.000Z',
      cwd: 'C:\\PRIVATE\\ALPHA',
      message: {
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 5,
          output_tokens: 2,
        },
      },
    }),
    parseClaudeRecord({
      type: 'assistant',
      sessionId: 'cc-1',
      timestamp: '2026-07-12T08:00:00.000Z',
      cwd: 'C:/private/alpha',
      message: { content: 'usage is missing' },
    }),
  ];

  const aggregate = aggregateToolActivity(records, NOW_MS);

  assert.deepEqual(aggregate.activity, {
    sessions: 2,
    projects: 1,
    coverageStart: '2026-05-01',
    coverageEnd: '2026-07-12',
    allTime: expectedTotals({
      inputTokens: 175,
      outputTokens: 32,
      cachedInputTokens: 45,
      cacheCreationInputTokens: 20,
      totalTokens: 207,
    }),
    last30Days: expectedTotals({
      inputTokens: 160,
      outputTokens: 30,
      cachedInputTokens: 40,
      cacheCreationInputTokens: 20,
      totalTokens: 190,
    }),
    recordsWithoutUsage: 1,
  });
});

test('aggregateToolActivity handles large histories without argument spreading', () => {
  const aggregateToolActivity = feature('aggregateToolActivity');
  const record = {
    kind: 'activity',
    sessionIdentity: 'large-session',
    projectIdentity: 'C:\\private\\large',
    timestampMs: Date.parse('2026-07-10T10:00:00.000Z'),
    usageExpected: false,
    usage: null,
  };

  const aggregate = aggregateToolActivity(
    Array.from({ length: 150_000 }, () => record),
    NOW_MS,
  );

  assert.equal(aggregate.activity.coverageStart, '2026-07-10');
  assert.equal(aggregate.activity.coverageEnd, '2026-07-10');
});

test('mergeActivityTotals unions normalized projects and active days across tools', () => {
  const parseClaudeRecord = feature('parseClaudeRecord');
  const aggregateToolActivity = feature('aggregateToolActivity');
  const mergeActivityTotals = feature('mergeActivityTotals');
  const first = aggregateToolActivity([
    parseClaudeRecord(claudeRecord),
  ], NOW_MS);
  const second = aggregateToolActivity([
    parseClaudeRecord({
      ...claudeRecord,
      sessionId: 'other-tool-session',
      cwd: 'c:/PRIVATE/alpha',
    }),
  ], NOW_MS);

  assert.deepEqual(mergeActivityTotals(first, second), {
    sessions: 2,
    projects: 1,
    activeDaysLast90: 1,
  });
});

test('normalization and day windows are deterministic and inclusive', () => {
  const normalizeProjectIdentity = feature('normalizeProjectIdentity');
  const withinDays = feature('withinDays');

  assert.equal(
    normalizeProjectIdentity('C:\\Private\\Alpha'),
    normalizeProjectIdentity('c:/private/alpha'),
  );
  assert.equal(normalizeProjectIdentity('  '), null);
  assert.equal(withinDays(NOW_MS - 30 * DAY_MS, NOW_MS, 30), true);
  assert.equal(withinDays(NOW_MS - 30 * DAY_MS - 1, NOW_MS, 30), false);
  assert.equal(withinDays(NOW_MS + 1, NOW_MS, 30), false);
});

test('methodology distinguishes session deduplication from per-message usage', () => {
  const buildMethodology = feature('buildMethodology');
  const methodology = buildMethodology();

  assert.match(methodology, /会话数按各工具的稳定标识去重/);
  assert.match(methodology, /Claude Code 累计每条 assistant message usage/);
  assert.match(methodology, /Codex 活动与归档中的同一会话只保留一份/);
});

test('collectDevelopmentStats deduplicates Codex archives and skips malformed lines', async (t) => {
  const collectDevelopmentStats = feature('collectDevelopmentStats');
  const root = makeTempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const claudeRoot = path.join(root, 'claude-projects');
  const codexActiveRoot = path.join(root, 'codex-sessions');
  const codexArchiveRoot = path.join(root, 'codex-archives');
  const sharedProject = path.join(root, 'shared-project');
  const claudeProject = path.join(root, 'claude-only');
  const codexProject = path.join(root, 'codex-only');

  writeJsonl(path.join(claudeRoot, 'one', 'recent.jsonl'), [
    { ...claudeRecord, cwd: sharedProject.toUpperCase() },
    {
      type: 'assistant',
      sessionId: 'cc-1',
      timestamp: '2026-07-12T08:00:00.000Z',
      cwd: sharedProject,
      message: { content: 'SUPER-SECRET-RAW-CONTENT' },
      user: 'private-user',
    },
  ], true);
  writeJsonl(path.join(claudeRoot, 'two', 'older.jsonl'), [{
    type: 'assistant',
    sessionId: 'cc-2',
    timestamp: '2026-05-01T08:00:00.000Z',
    cwd: claudeProject,
    message: {
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 5,
        output_tokens: 2,
      },
    },
  }]);

  const sharedCodexSession = [
    {
      timestamp: '2026-07-11T09:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'codex-1',
        cwd: sharedProject.replaceAll('\\', '/').toLowerCase(),
      },
    },
    codexRecord,
  ];
  writeJsonl(
    path.join(codexActiveRoot, '2026', '07', '11', 'active.jsonl'),
    sharedCodexSession,
    true,
  );
  writeJsonl(
    path.join(codexArchiveRoot, 'duplicate.jsonl'),
    sharedCodexSession,
  );
  writeJsonl(path.join(codexArchiveRoot, 'older.jsonl'), [
    {
      timestamp: '2026-05-02T09:00:00.000Z',
      type: 'session_meta',
      payload: { id: 'codex-2', cwd: codexProject },
    },
    {
      timestamp: '2026-05-02T10:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 20,
            output_tokens: 5,
            total_tokens: 25,
          },
        },
      },
    },
    {
      timestamp: '2026-07-13T10:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 220,
            output_tokens: 65,
            total_tokens: 285,
          },
        },
      },
    },
  ]);

  const result = await collectDevelopmentStats({
    claudeProjectsRoot: claudeRoot,
    codexSessionsRoot: codexActiveRoot,
    codexArchivedSessionsRoot: codexArchiveRoot,
    nowMs: NOW_MS,
  });

  assert.deepEqual(result.totals, {
    sessions: 4,
    projects: 3,
    activeDaysLast90: 6,
  });
  assert.deepEqual(result.claudeCode, {
    sessions: 2,
    projects: 2,
    coverageStart: '2026-05-01',
    coverageEnd: '2026-07-12',
    allTime: expectedTotals({
      inputTokens: 175,
      outputTokens: 32,
      cachedInputTokens: 45,
      cacheCreationInputTokens: 20,
      totalTokens: 207,
    }),
    last30Days: expectedTotals({
      inputTokens: 160,
      outputTokens: 30,
      cachedInputTokens: 40,
      cacheCreationInputTokens: 20,
      totalTokens: 190,
    }),
    recordsWithoutUsage: 1,
  });
  assert.deepEqual(result.codex, {
    sessions: 2,
    projects: 2,
    coverageStart: '2026-05-02',
    coverageEnd: '2026-07-13',
    allTime: expectedTotals({
      inputTokens: 220,
      outputTokens: 65,
      cachedInputTokens: 50,
      reasoningOutputTokens: 10,
      totalTokens: 285,
    }),
    last30Days: expectedTotals({
      inputTokens: 200,
      outputTokens: 60,
      cachedInputTokens: 50,
      reasoningOutputTokens: 10,
      totalTokens: 260,
    }),
    recordsWithoutUsage: 1,
  });

  assert.deepEqual(Object.keys(result), [
    'generatedAt',
    'methodology',
    'totals',
    'claudeCode',
    'codex',
  ]);
  const serialized = JSON.stringify(result);
  for (const sensitive of [
    'C:\\private\\alpha',
    'cc-1',
    'codex-1',
    'private-user',
    'SUPER-SECRET-RAW-CONTENT',
    os.userInfo().username,
    os.homedir(),
    'cwd',
    'sessionId',
    'prompt',
    'response',
    '/Users/',
  ]) {
    assert.equal(serialized.includes(sensitive), false, `serialized output leaked ${sensitive}`);
  }
  assert.doesNotMatch(serialized, /[A-Za-z]:[\\/]/);
});

test('missing log roots produce null coverage instead of invented totals', async () => {
  const collectDevelopmentStats = feature('collectDevelopmentStats');
  const root = path.join(os.tmpdir(), `missing-stats-${Date.now()}`);
  const result = await collectDevelopmentStats({
    claudeProjectsRoot: path.join(root, 'claude'),
    codexSessionsRoot: path.join(root, 'codex-active'),
    codexArchivedSessionsRoot: path.join(root, 'codex-archive'),
    nowMs: NOW_MS,
  });

  const unavailable = {
    sessions: null,
    projects: null,
    coverageStart: null,
    coverageEnd: null,
    allTime: null,
    last30Days: null,
    recordsWithoutUsage: 0,
  };
  assert.deepEqual(result.totals, {
    sessions: null,
    projects: null,
    activeDaysLast90: null,
  });
  assert.deepEqual(result.claudeCode, unavailable);
  assert.deepEqual(result.codex, unavailable);
});
