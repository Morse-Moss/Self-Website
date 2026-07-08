// scripts/collect-stats.test.mjs
// TDD: 核心纯函数单测 + 临时 fixture 目录模拟会话文件(仅元数据操作,不读内容)。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  computeFirstDateStr,
  computeActiveDaysInWindow,
  scanClaudeProjectsMeta,
  buildClaudeCodeStats,
  scanCodexMeta,
  collectRepoStats,
  buildMethodology,
  assembleStats,
} from './collect-stats.mjs';

const DAY = 24 * 60 * 60 * 1000;

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------- computeFirstDateStr ----------

test('computeFirstDateStr: 空数组返回 null', () => {
  assert.equal(computeFirstDateStr([]), null);
});

test('computeFirstDateStr: 返回最早日期(YYYY-MM-DD)', () => {
  const d1 = new Date(2026, 0, 15, 10, 0, 0).getTime(); // 2026-01-15
  const d2 = new Date(2026, 2, 1, 8, 0, 0).getTime(); // 2026-03-01
  assert.equal(computeFirstDateStr([d2, d1]), '2026-01-15');
});

// ---------- computeActiveDaysInWindow ----------

test('computeActiveDaysInWindow: 窗口外的 mtime 被排除', () => {
  const now = new Date(2026, 6, 8).getTime(); // 2026-07-08
  const inWindow = now - 10 * DAY;
  const outWindow = now - 200 * DAY;
  assert.equal(computeActiveDaysInWindow([inWindow, outWindow], now, 90), 1);
});

test('computeActiveDaysInWindow: 同一天多次去重为 1 天', () => {
  const now = new Date(2026, 6, 8, 12, 0, 0).getTime();
  const sameDayA = new Date(2026, 6, 7, 1, 0, 0).getTime();
  const sameDayB = new Date(2026, 6, 7, 23, 0, 0).getTime();
  const otherDay = new Date(2026, 6, 6, 12, 0, 0).getTime();
  assert.equal(computeActiveDaysInWindow([sameDayA, sameDayB, otherDay], now, 90), 2);
});

test('computeActiveDaysInWindow: 空数组返回 0', () => {
  assert.equal(computeActiveDaysInWindow([], Date.now(), 90), 0);
});

// ---------- scanClaudeProjectsMeta ----------

test('scanClaudeProjectsMeta: 目录不存在返回 null', () => {
  const missing = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());
  assert.equal(scanClaudeProjectsMeta(missing), null);
});

test('scanClaudeProjectsMeta: 统计会话数与项目数(仅元数据)', () => {
  const root = mkTmpDir('cc-projects-');
  const p1 = path.join(root, 'project-a');
  const p2 = path.join(root, 'project-b');
  fs.mkdirSync(p1);
  fs.mkdirSync(p2);

  const f1 = path.join(p1, 'sess1.jsonl');
  const f2 = path.join(p1, 'sess2.jsonl');
  const f3 = path.join(p2, 'sess3.jsonl');
  fs.writeFileSync(f1, '');
  fs.writeFileSync(f2, '');
  fs.writeFileSync(f3, '');

  const t1 = new Date(2026, 0, 1).getTime() / 1000;
  const t2 = new Date(2026, 1, 1).getTime() / 1000;
  const t3 = new Date(2026, 2, 1).getTime() / 1000;
  fs.utimesSync(f1, t1, t1);
  fs.utimesSync(f2, t2, t2);
  fs.utimesSync(f3, t3, t3);

  // 不含 .jsonl 的目录应被忽略统计对象(既非会话也不计入项目)
  const emptyDir = path.join(root, 'empty-project');
  fs.mkdirSync(emptyDir);

  const meta = scanClaudeProjectsMeta(root);
  assert.equal(meta.sessionMtimes.length, 3);
  assert.equal(meta.projectCount, 2);

  fs.rmSync(root, { recursive: true, force: true });
});

test('buildClaudeCodeStats: 目录不存在时全部字段为 null', () => {
  const missing = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());
  const stats = buildClaudeCodeStats(missing, Date.now());
  assert.deepEqual(stats, {
    sessions: null,
    projects: null,
    firstSessionDate: null,
    activeDaysLast90: null,
  });
});

test('buildClaudeCodeStats: 正常场景返回聚合数字', () => {
  const root = mkTmpDir('cc-projects-2-');
  const p1 = path.join(root, 'project-a');
  fs.mkdirSync(p1);
  const f1 = path.join(p1, 'sess1.jsonl');
  fs.writeFileSync(f1, '');
  const now = Date.now();
  const recent = now - 5 * DAY;
  fs.utimesSync(f1, recent / 1000, recent / 1000);

  const stats = buildClaudeCodeStats(root, now);
  assert.equal(stats.sessions, 1);
  assert.equal(stats.projects, 1);
  assert.equal(stats.activeDaysLast90, 1);
  assert.match(stats.firstSessionDate, /^\d{4}-\d{2}-\d{2}$/);

  fs.rmSync(root, { recursive: true, force: true });
});

// ---------- scanCodexMeta ----------

test('scanCodexMeta: archived_sessions 目录不存在 -> 0 且 available 取决于 history.jsonl', () => {
  const missingArchived = path.join(os.tmpdir(), 'no-archived-' + Date.now());
  const missingHistory = path.join(os.tmpdir(), 'no-history-' + Date.now() + '.jsonl');
  const meta = scanCodexMeta(missingArchived, missingHistory);
  assert.equal(meta.archivedSessions, 0);
  assert.equal(meta.available, false);
});

test('scanCodexMeta: archived_sessions 不存在但 history.jsonl 存在 -> archivedSessions=0 且 available=true', () => {
  const missingArchived = path.join(os.tmpdir(), 'no-archived-' + Date.now());
  const historyDir = mkTmpDir('codex-history-');
  const historyPath = path.join(historyDir, 'history.jsonl');
  fs.writeFileSync(historyPath, '');

  const meta = scanCodexMeta(missingArchived, historyPath);
  assert.equal(meta.archivedSessions, 0);
  assert.equal(meta.available, true);

  fs.rmSync(historyDir, { recursive: true, force: true });
});

test('scanCodexMeta: archived_sessions 存在时统计条目数', () => {
  const root = mkTmpDir('codex-archived-');
  fs.writeFileSync(path.join(root, 'a.json'), '');
  fs.writeFileSync(path.join(root, 'b.json'), '');
  const missingHistory = path.join(os.tmpdir(), 'no-history-' + Date.now() + '.jsonl');

  const meta = scanCodexMeta(root, missingHistory);
  assert.equal(meta.archivedSessions, 2);
  assert.equal(meta.available, true);

  fs.rmSync(root, { recursive: true, force: true });
});

// ---------- collectRepoStats(依赖注入 execFn) ----------

test('collectRepoStats: 通过注入的 execFn 解析 commit 数与首次提交日期', () => {
  const fakeExec = (cmd) => {
    if (cmd.includes('rev-list')) return '42\n';
    if (cmd.includes('log --reverse')) return '2025-01-01\n2025-02-01\n';
    throw new Error('unexpected cmd: ' + cmd);
  };
  const result = collectRepoStats('/fake/repo', fakeExec);
  assert.equal(result.commits, 42);
  assert.equal(result.firstCommitDate, '2025-01-01');
});

test('collectRepoStats: execFn 抛错时字段为 null(不编数)', () => {
  const fakeExec = () => {
    throw new Error('not a git repo');
  };
  const result = collectRepoStats('/fake/repo', fakeExec);
  assert.equal(result.commits, null);
  assert.equal(result.firstCommitDate, null);
});

// ---------- buildMethodology / assembleStats ----------

test('buildMethodology: 返回非空说明字符串', () => {
  const m = buildMethodology();
  assert.equal(typeof m, 'string');
  assert.ok(m.length > 0);
});

test('assembleStats: 组装出契约要求的字段结构,不泄漏路径/文件名', () => {
  const claudeCode = { sessions: 10, projects: 3, firstSessionDate: '2026-01-01', activeDaysLast90: 5 };
  const codex = { archivedSessions: 2, available: true };
  const thisRepo = { commits: 42, firstCommitDate: '2025-01-01' };

  const result = assembleStats({ claudeCode, codex, thisRepo, generatedAt: '2026-07-08T00:00:00.000Z' });

  assert.equal(result.generatedAt, '2026-07-08T00:00:00.000Z');
  assert.equal(typeof result.methodology, 'string');
  assert.deepEqual(result.claudeCode, claudeCode);
  assert.deepEqual(result.codex, codex);
  assert.deepEqual(result.thisRepo, thisRepo);

  const serialized = JSON.stringify(result);
  // 结构性隐私自查: 序列化结果不应包含本机用户名、home 路径或常见路径分隔符
  assert.ok(!serialized.includes(os.userInfo().username));
  assert.ok(!serialized.includes(os.homedir()));
  assert.ok(!serialized.includes('C:\\'));
  assert.ok(!serialized.includes('/Users/'));
});
