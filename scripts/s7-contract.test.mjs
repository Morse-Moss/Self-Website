import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = new URL('../', import.meta.url);

function readUtf8(relativePath) {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

function assertIncludesAll(source, expected, label) {
  for (const value of expected) {
    assert.ok(source.includes(value), `${label} must include: ${value}`);
  }
}

test('blueprint defines the S7 multipage public experience', () => {
  const blueprint = readUtf8('docs/portfolio-blueprint.md');

  assertIncludesAll(
    blueprint,
    [
      '## 11. S7 多页作品集垂直切片(2026-07-13)',
      'Header',
      'Footer',
      '简历入口',
      '数字摩斯',
      '`/`',
      '`/works`',
      '`/works/content-agent`',
      '`/works/auto-operations`',
      '`/works/deep-research`',
      '`/works/digital-morse`',
      'H1“数字生命摩斯”',
      'Agent 系统开发者',
      '真实系统图',
      '露出下一段',
      '内容创作 Agent 系统',
      '自动运营 Agent 系统',
      '深度研究 Agent 系统',
      '数字摩斯',
      '问题',
      '我的角色',
      '关键判断',
      '真实结构',
      '验证证据',
      '当前边界',
    ],
    'S7 blueprint',
  );
});

test('stage contract contains the complete closed-stage governance sections', () => {
  const contract = readUtf8('docs/task-center/s7-multipage-portfolio.md');

  assertIncludesAll(
    contract,
    [
      '## Outcome',
      '## Definition of Done',
      '## Allowed Scope',
      '## Forbidden Scope',
      '## Non-goals',
      '## Verification',
      '## Review',
      '## Approvals',
      '## Current Result',
      '## Current Result\n\nPASS',
      '90 total / 84 pass / 6 PostgreSQL SKIP / 0 fail',
      'Independent review:PASS',
    ],
    'S7 stage contract',
  );
});

test('blueprint and stage contract pin exact sources, CTAs, and safety boundaries', () => {
  const blueprint = readUtf8('docs/portfolio-blueprint.md');
  const contract = readUtf8('docs/task-center/s7-multipage-portfolio.md');
  const combined = `${blueprint}\n${contract}`;

  assertIncludesAll(
    combined,
    [
      '`content/site-content.json`',
      '`content/s3-content.json`',
      'https://aitavix.com',
      'https://github.com/Morse-Moss/Deep-research-sys',
      'https://github.com/Morse-Moss/Self-Website',
      '`public/works/auto-operations/`',
      '裁剪',
      '脱敏',
      '内容创作 Agent 系统',
      '站内案例',
      '不删除旧文件',
      '不执行知识库重摄取',
      '零新增依赖',
      '不调用 Provider',
      '不修改数据库 schema',
      '不部署',
      '不 push',
    ],
    'S7 source and safety contract',
  );
});

test('run-state retains S7 and M3 closeout evidence after pointer advancement', () => {
  const runState = readUtf8('docs/task-center/run-state.md');

  assertIncludesAll(
    runState,
    [
      '## S7 multipage closeout evidence(2026-07-13)',
      '## S7 multipage scope amendment(2026-07-13)',
      'docs/task-center/s7-multipage-portfolio.md',
      '## M3-RAG local closeout evidence(2026-07-13)',
      '`d1ebd88`',
    ],
    'Task Center run-state',
  );
});

test('S7 has a repeatable multipage visual acceptance command', () => {
  const packageJson = JSON.parse(readUtf8('package.json'));
  const harness = readUtf8('scripts/s7-visual-smoke.mjs');

  assert.equal(
    packageJson.scripts['visual:s3'],
    'node scripts/s3-visual-smoke.mjs http://localhost:3000',
  );
  assert.equal(
    packageJson.scripts['visual:s7'],
    'node scripts/s7-visual-smoke.mjs http://127.0.0.1:3010',
  );

  assertIncludesAll(
    harness,
    [
      "'/'",
      "'/works'",
      "'/works/content-agent'",
      "'/works/auto-operations'",
      "'/works/deep-research'",
      "'/works/digital-morse'",
      'Page.captureScreenshot',
      'Runtime.consoleAPICalled',
      'Runtime.exceptionThrown',
      'prefers-reduced-motion',
      'document.getAnimations',
      'Emulation.setScrollbarsHidden',
      'naturalWidth',
      'horizontalOverflow',
      'Page.close',
    ],
    'S7 visual harness',
  );
  assert.doesNotMatch(harness, /maxTouchPoints:\s*mobile\s*\?\s*5\s*:\s*0/);
});
