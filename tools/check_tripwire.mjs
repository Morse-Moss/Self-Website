#!/usr/bin/env node
// Vibe architecture tripwire. Git index content is authoritative in staged mode.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const MAX_BUFFER = 64 * 1024 * 1024;

function commandOutput(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", options.allowFailure ? "ignore" : "pipe"],
    });
  } catch (error) {
    if (options.allowFailure) return null;
    throw error;
  }
}

let repositoryRoot;
try {
  repositoryRoot = commandOutput("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() }).trim();
} catch {
  console.error("[vibe] Git repository not found; refusing to skip architecture checks.");
  process.exit(1);
}

function gitOutput(args, allowFailure = false) {
  return commandOutput("git", args, { cwd: repositoryRoot, allowFailure });
}

const changedFromIndex = process.argv.indexOf("--changed-from");
const changedFrom = changedFromIndex >= 0 ? process.argv[changedFromIndex + 1] : null;
if (changedFromIndex >= 0 && (!changedFrom || changedFrom.startsWith("--"))) {
  console.error("[vibe] --changed-from requires a Git commit or ref.");
  process.exit(1);
}
if (changedFrom && gitOutput(["rev-parse", "--verify", `${changedFrom}^{commit}`], true) === null) {
  console.error(`[vibe] Cannot resolve --changed-from ref: ${changedFrom}`);
  process.exit(1);
}
const mode = changedFrom ? "changed" : process.argv.includes("--staged") ? "staged" : "all";

function readSnapshotFile(relativePath) {
  if (mode === "staged") return gitOutput(["cat-file", "blob", `:${relativePath}`], true);
  if (mode === "changed") return gitOutput(["cat-file", "blob", `HEAD:${relativePath}`], true);
  const absolutePath = path.join(repositoryRoot, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : null;
}

const defaultConfig = {
  line_limits: [
    { glob: "**/api/**/*.py", max: 200 },
    { glob: "**/routes/**/*.py", max: 200 },
    { glob: "**/services/**/*.py", max: 500 },
    { glob: "**/tests/**/*.py", max: 600 },
    { glob: "**/*.py", max: 500 },
    { glob: "**/*.{ts,tsx,js,jsx,vue}", max: 400 },
  ],
  root_guard: {
    enabled: true,
    block_ext: [".py", ".ts", ".tsx", ".js", ".jsx"],
    allow: [
      "setup.py", "conftest.py", "main.py", "manage.py", "app.py",
      "vite.config.ts", "vite.config.js", "next.config.js", "tailwind.config.js",
    ],
  },
  scope_guard: {
    enabled: false,
    deny_prefixes: [],
    check_all: false,
  },
  legacy: {
    existing_over_limit: "warn",
    block_growth: true,
  },
  exclude_dirs: [
    ".git", ".venv", "venv", "env", "node_modules", "__pycache__",
    "dist", "build", ".next", ".nuxt", "vibe-starter", "migrations",
  ],
  waiver_file: "docs/architecture-waivers.json",
};

function readConfig() {
  const configSource = readSnapshotFile(".vibe-tripwire.json");
  if (configSource === null) return defaultConfig;
  const projectConfig = JSON.parse(configSource);
  return {
    ...defaultConfig,
    ...projectConfig,
    root_guard: { ...defaultConfig.root_guard, ...projectConfig.root_guard },
    scope_guard: { ...defaultConfig.scope_guard, ...projectConfig.scope_guard },
    legacy: { ...defaultConfig.legacy, ...projectConfig.legacy },
  };
}

let config;
try {
  config = readConfig();
} catch (error) {
  console.error(`[vibe] Invalid .vibe-tripwire.json: ${error.message}`);
  process.exit(1);
}

function expandBraces(pattern) {
  const match = pattern.match(/\{([^{}]*)\}/);
  if (!match) return [pattern];
  return match[1].split(",").flatMap((option) => (
    expandBraces(pattern.slice(0, match.index) + option + pattern.slice(match.index + match[0].length))
  ));
}

function globToRegExp(glob) {
  let expression = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*") {
      if (glob[index + 1] === "*") {
        expression += ".*";
        index += 1;
        if (glob[index + 1] === "/") index += 1;
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else if ("\\^$+.()|[]{}".includes(character)) {
      expression += `\\${character}`;
    } else {
      expression += character;
    }
  }
  return new RegExp(`^${expression}$`);
}

function matchesGlob(filePath, glob) {
  return expandBraces(glob).some((pattern) => globToRegExp(pattern).test(filePath));
}

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function parseNullList(output) {
  return output ? output.split("\0").map(normalizePath).filter(Boolean) : [];
}

function listFiles() {
  if (mode === "staged") {
    return parseNullList(gitOutput([
      "diff", "--cached", "--name-only", "--diff-filter=ACMR", "--find-renames", "-z",
    ]));
  }
  if (mode === "changed") {
    return parseNullList(gitOutput([
      "diff", "--name-only", "--diff-filter=ACMR", "--find-renames", "-z", `${changedFrom}...HEAD`,
    ]));
  }
  return parseNullList(gitOutput(["ls-files", "-z"]));
}

function listAddedFiles() {
  if (mode === "staged") {
    return new Set(parseNullList(gitOutput([
      "diff", "--cached", "--name-only", "--diff-filter=A", "-z",
    ])));
  }
  if (mode === "changed") {
    return new Set(parseNullList(gitOutput([
      "diff", "--name-only", "--diff-filter=A", "-z", `${changedFrom}...HEAD`,
    ])));
  }
  return new Set();
}

function readGitBlob(specifier) {
  return gitOutput(["cat-file", "blob", specifier], true);
}

function readCurrentContent(relativePath) {
  if (mode === "staged") return readGitBlob(`:${relativePath}`);
  if (mode === "changed") return readGitBlob(`HEAD:${relativePath}`);
  try {
    return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
  } catch {
    return null;
  }
}

function readHeadContent(relativePath) {
  return readGitBlob(`${changedFrom ?? "HEAD"}:${relativePath}`);
}

function countLines(content) {
  if (content === null || content === "") return content === "" ? 0 : null;
  let count = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") count += 1;
  }
  return content.endsWith("\n") ? count : count + 1;
}

function isExcluded(relativePath) {
  const excluded = new Set(config.exclude_dirs ?? []);
  return relativePath.split("/").some((segment) => excluded.has(segment));
}

function isDeniedScope(relativePath) {
  return (config.scope_guard.deny_prefixes ?? []).some((configuredPrefix) => {
    const prefix = normalizePath(configuredPrefix).replace(/^\/+|\/+$/gu, "");
    return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
  });
}

function loadWaivers() {
  if (!config.waiver_file) return [];
  const waiverSource = readSnapshotFile(config.waiver_file);
  if (waiverSource === null) return [];
  const parsed = JSON.parse(waiverSource);
  if (!Array.isArray(parsed)) throw new Error("waiver registry must be a JSON array");
  return parsed.map((waiver, index) => {
    const requiredText = ["id", "rule", "reason", "owner", "expires"];
    for (const field of requiredText) {
      if (typeof waiver[field] !== "string" || waiver[field].trim() === "") {
        throw new Error(`waiver ${index + 1} is missing ${field}`);
      }
    }
    if (!Array.isArray(waiver.paths) || waiver.paths.length === 0 || waiver.paths.some((item) => typeof item !== "string")) {
      throw new Error(`waiver ${waiver.id} must declare paths`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(waiver.expires)) {
      throw new Error(`waiver ${waiver.id} has an invalid expires date`);
    }
    return { ...waiver, paths: waiver.paths.map(normalizePath) };
  });
}

let waivers;
try {
  waivers = loadWaivers();
} catch (error) {
  console.error(`[vibe] Invalid waiver registry: ${error.message}`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const expiredWaivers = waivers.filter((waiver) => waiver.expires < today);
const activeWaivers = waivers.filter((waiver) => waiver.expires >= today);

const files = listFiles().filter((file) => !isExcluded(file));
const addedFiles = listAddedFiles();
const violations = [];

for (const relativePath of files) {
  const currentContent = readCurrentContent(relativePath);
  if (currentContent === null) continue;

  const rule = (config.line_limits ?? []).find((candidate) => matchesGlob(relativePath, candidate.glob));
  if (rule) {
    const currentLines = countLines(currentContent);
    if (currentLines > rule.max) {
      const headLines = countLines(readHeadContent(relativePath));
      const wasAlreadyOver = headLines !== null && headLines > rule.max;
      let severity = rule.severity === "warn" ? "warn" : "block";
      let reason = "limit";
      if (wasAlreadyOver && config.legacy.existing_over_limit === "warn") severity = "warn";
      if (wasAlreadyOver && config.legacy.block_growth && currentLines > headLines) {
        severity = "block";
        reason = "ratchet";
      }
      violations.push({
        rule: "line_limit",
        relativePath,
        severity,
        reason,
        currentLines,
        headLines,
        max: rule.max,
        glob: rule.glob,
      });
    }
  }

  if (config.root_guard.enabled && addedFiles.has(relativePath) && !relativePath.includes("/")) {
    const extension = path.posix.extname(relativePath);
    if ((config.root_guard.block_ext ?? []).includes(extension) && !(config.root_guard.allow ?? []).includes(relativePath)) {
      violations.push({ rule: "root_guard", relativePath, severity: "block" });
    }
  }

  const scopeGuardApplies = config.scope_guard.enabled && (mode !== "all" || config.scope_guard.check_all);
  if (scopeGuardApplies && isDeniedScope(relativePath)) {
    violations.push({ rule: "scope_guard", relativePath, severity: "block" });
  }
}

function matchingWaiver(violation) {
  if (violation.rule === "scope_guard") return null;
  return activeWaivers.find((waiver) => (
    waiver.rule === violation.rule && waiver.paths.includes(violation.relativePath)
  )) ?? null;
}

const warnings = [];
const blockers = [];
const waived = [];
for (const violation of violations) {
  const waiver = matchingWaiver(violation);
  if (waiver) {
    waived.push({ violation, waiver });
  } else if (violation.severity === "warn") {
    warnings.push(violation);
  } else {
    blockers.push(violation);
  }
}

function describeViolation(violation) {
  if (violation.rule === "line_limit") {
    if (violation.reason === "ratchet") {
      return `${violation.relativePath}  ratchet ${violation.headLines} -> ${violation.currentLines} lines (limit ${violation.max})`;
    }
    return `${violation.relativePath}  ${violation.currentLines} lines (limit ${violation.max}, ${violation.glob})`;
  }
  if (violation.rule === "root_guard") return `${violation.relativePath}  root guard`;
  return `${violation.relativePath}  scope guard`;
}

const legacyOverrideNames = new Set(["VIBE_ALLOW_BLOAT", config.override_env].filter(Boolean));
const usedOverride = [...legacyOverrideNames].find((name) => process.env[name] !== undefined);
if (usedOverride) {
  console.log(`[vibe] environment override is no longer supported (${usedOverride}); use a versioned, expiring waiver.`);
}

if (warnings.length) {
  console.log(`\n[vibe] warning: ${warnings.length} legacy architecture tripwire(s)`);
  warnings.forEach((violation) => console.log(`  ${describeViolation(violation)}`));
}

if (waived.length) {
  console.log(`\n[vibe] ${waived.length} versioned waiver(s) applied`);
  waived.forEach(({ violation, waiver }) => {
    console.log(`  ${waiver.id}: ${violation.rule} ${violation.relativePath} (expires ${waiver.expires})`);
  });
}

if (expiredWaivers.length) {
  console.log(`\n[vibe] expired architecture waiver(s)`);
  expiredWaivers.forEach((waiver) => console.log(`  expired waiver ${waiver.id} (${waiver.expires})`));
}

if (blockers.length) {
  console.log(`\n[vibe] blocked by ${blockers.length} architecture violation(s)`);
  blockers.forEach((violation) => console.log(`  ${describeViolation(violation)}`));
}

if (expiredWaivers.length || blockers.length) {
  console.log("\n[vibe] Fix the boundary or add a narrow waiver in the configured waiver registry.");
  process.exit(1);
}

console.log(`[vibe] architecture tripwire passed (${files.length} files, ${mode} mode)`);
