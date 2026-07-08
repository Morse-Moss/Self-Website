#!/usr/bin/env node
// scripts/collect-stats.mjs
//
// Stage 4 数据管线:从本机工作记录提取聚合统计,产出 content/stats.json。
//
// 隐私铁律:本脚本只允许对会话/记录文件做元数据操作(fs.readdir / fs.stat 系列,
// 判断文件名、数量、mtime),严禁读取任何会话/记录文件的内容(0 字节读取)。
//
// 统计口径(与 content/stats.json 的 methodology 字段保持一致):
// 1. claudeCode: 扫描 <home>/.claude/projects/ 下的项目目录,
//    每个子目录视为一个"项目",目录内的 *.jsonl 文件视为一次"会话"。
//    - sessions        = 所有项目目录下 *.jsonl 文件总数
//    - projects        = 至少包含 1 个 *.jsonl 文件的项目目录数
//    - firstSessionDate= 所有会话文件 mtime 中最早一天(本地时区 YYYY-MM-DD)
//    - activeDaysLast90= 近 90 天内(相对脚本运行时刻)有会话 mtime 的自然天数,按天去重
//    若 projects 根目录不存在,以上四个字段全部为 null。
// 2. codex: 检查 <home>/.codex/archived_sessions/ 与
//    <home>/.codex/history.jsonl 的存在性。
//    - archivedSessions = archived_sessions 目录下条目数;目录不存在则为 0
//    - available        = archived_sessions 或 history.jsonl 任一存在则为 true
// 3. thisRepo: 通过只读 git 查询获取本仓库 commit 总数与首次提交日期
//    (`git rev-list --count HEAD` / `git log --reverse --format=%ad --date=short`)。
//    若仓库不存在提交记录或命令执行失败,两个字段均为 null,不编造数据。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 纯函数:日期/去重计算(不涉及任何 IO)
// ---------------------------------------------------------------------------

/**
 * 将 epoch ms 转为本地时区 YYYY-MM-DD 字符串。
 */
function toLocalDateStr(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 给定一组 mtime(epoch ms),返回最早一天的日期字符串;空数组返回 null。
 */
export function computeFirstDateStr(mtimesMs) {
  if (!mtimesMs || mtimesMs.length === 0) return null;
  const min = Math.min(...mtimesMs);
  return toLocalDateStr(min);
}

/**
 * 给定一组 mtime(epoch ms)、当前时刻 nowMs、窗口天数 windowDays,
 * 返回窗口内(含边界)、按自然日去重后的活跃天数。
 */
export function computeActiveDaysInWindow(mtimesMs, nowMs, windowDays = 90) {
  if (!mtimesMs || mtimesMs.length === 0) return 0;
  const windowMs = windowDays * DAY_MS;
  const days = new Set();
  for (const ms of mtimesMs) {
    if (ms > nowMs) continue; // 忽略未来时间戳(异常数据保护)
    if (nowMs - ms > windowMs) continue;
    days.add(toLocalDateStr(ms));
  }
  return days.size;
}

// ---------------------------------------------------------------------------
// 元数据扫描(仅 fs.readdir / fs.stat,不读取文件内容)
// ---------------------------------------------------------------------------

/**
 * 扫描 Claude Code 项目根目录,返回原始元数据:
 *   { sessionMtimes: number[], projectCount: number }
 * 根目录不存在时返回 null。
 */
export function scanClaudeProjectsMeta(projectsRoot) {
  if (!fs.existsSync(projectsRoot)) return null;

  const entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  const sessionMtimes = [];
  let projectCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(projectsRoot, entry.name);
    let files;
    try {
      files = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const jsonlFiles = files.filter((f) => f.isFile() && f.name.endsWith('.jsonl'));
    if (jsonlFiles.length === 0) continue; // 空项目目录不计入项目数

    projectCount += 1;
    for (const f of jsonlFiles) {
      const filePath = path.join(projectDir, f.name);
      try {
        const st = fs.statSync(filePath);
        sessionMtimes.push(st.mtimeMs);
      } catch {
        // 忽略读取失败的单个文件(不影响整体统计)
      }
    }
  }

  return { sessionMtimes, projectCount };
}

/**
 * 组装 claudeCode 统计字段。根目录不存在时全部字段为 null。
 */
export function buildClaudeCodeStats(projectsRoot, nowMs) {
  const meta = scanClaudeProjectsMeta(projectsRoot);
  if (meta === null) {
    return {
      sessions: null,
      projects: null,
      firstSessionDate: null,
      activeDaysLast90: null,
    };
  }
  return {
    sessions: meta.sessionMtimes.length,
    projects: meta.projectCount,
    firstSessionDate: computeFirstDateStr(meta.sessionMtimes),
    activeDaysLast90: computeActiveDaysInWindow(meta.sessionMtimes, nowMs, 90),
  };
}

/**
 * 检查 Codex 会话档案存在性与条目数。
 *   archivedSessions: archived_sessions 目录下条目数(目录不存在则 0)
 *   available: archived_sessions 或 history.jsonl 任一存在
 */
export function scanCodexMeta(archivedSessionsDir, historyJsonlPath) {
  const archivedExists = fs.existsSync(archivedSessionsDir);
  const historyExists = fs.existsSync(historyJsonlPath);

  let archivedSessions = 0;
  if (archivedExists) {
    try {
      archivedSessions = fs.readdirSync(archivedSessionsDir).length;
    } catch {
      archivedSessions = 0;
    }
  }

  return {
    archivedSessions,
    available: archivedExists || historyExists,
  };
}

// ---------------------------------------------------------------------------
// 本仓库 git 统计(只读查询,execFn 可注入以便测试)
// ---------------------------------------------------------------------------

/**
 * 通过只读 git 命令获取本仓库 commit 总数与首次提交日期。
 * execFn 默认使用 node:child_process 的 execSync,签名 (cmd) => string。
 * 任一命令失败(如非 git 仓库、无提交)则两字段均为 null,不编造数据。
 */
export function collectRepoStats(repoDir, execFn = (cmd) => execSync(cmd, { cwd: repoDir }).toString()) {
  try {
    const countOut = execFn('git rev-list --count HEAD');
    const commits = parseInt(String(countOut).trim(), 10);
    if (!Number.isFinite(commits)) throw new Error('invalid commit count');

    const logOut = execFn('git log --reverse --format=%ad --date=short');
    const dates = String(logOut).trim().split('\n').filter(Boolean);
    const firstCommitDate = dates.length > 0 ? dates[0] : null;

    return { commits, firstCommitDate };
  } catch {
    return { commits: null, firstCommitDate: null };
  }
}

// ---------------------------------------------------------------------------
// methodology 说明 + 最终 JSON 组装
// ---------------------------------------------------------------------------

export function buildMethodology() {
  return (
    'claudeCode: 扫描本机 Claude Code 会话目录,按项目子目录统计 *.jsonl 会话文件数量与 mtime' +
    '(sessions=会话文件总数,projects=含至少1个会话的项目目录数,firstSessionDate=最早会话mtime所在日期,' +
    'activeDaysLast90=近90天内有会话mtime的去重天数;目录不存在则全部为null)。' +
    'codex: 检查 Codex 会话档案目录与历史文件的存在性(archivedSessions=归档目录下条目数,' +
    '目录不存在则为0;available=归档目录或历史文件任一存在)。' +
    'thisRepo: 通过只读 git 查询统计本仓库 commit 总数与首次提交日期;' +
    '仓库无提交或查询失败则两字段均为 null。所有字段均为聚合数字,不解析任何会话内容。'
  );
}

/**
 * 组装最终 stats.json 对象。
 */
export function assembleStats({ claudeCode, codex, thisRepo, generatedAt }) {
  return {
    generatedAt,
    methodology: buildMethodology(),
    claudeCode,
    codex,
    thisRepo,
  };
}

// ---------------------------------------------------------------------------
// 入口:实际数据源路径 + 写入 content/stats.json
// ---------------------------------------------------------------------------

const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir();
const CLAUDE_PROJECTS_ROOT = path.join(HOME, '.claude', 'projects');
const CODEX_ARCHIVED_SESSIONS_DIR = path.join(HOME, '.codex', 'archived_sessions');
const CODEX_HISTORY_JSONL = path.join(HOME, '.codex', 'history.jsonl');

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'content', 'stats.json');

function main() {
  const now = Date.now();

  const claudeCode = buildClaudeCodeStats(CLAUDE_PROJECTS_ROOT, now);
  const codex = scanCodexMeta(CODEX_ARCHIVED_SESSIONS_DIR, CODEX_HISTORY_JSONL);
  const thisRepo = collectRepoStats(REPO_ROOT);

  const stats = assembleStats({
    claudeCode,
    codex,
    thisRepo,
    generatedAt: new Date(now).toISOString(),
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(stats, null, 2) + '\n', 'utf8');
  console.log(`stats written to ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
  console.log(JSON.stringify(stats, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  main();
}
