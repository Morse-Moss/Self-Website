import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = new URL('../', import.meta.url);
const s9SpecPath =
  'docs/superpowers/specs/2026-07-14-aiking-inspired-portfolio-redesign-design.md';

function readUtf8(relativePath) {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8').replaceAll(
    '\r\n',
    '\n',
  );
}

function assertIncludesAll(source, expected, label) {
  for (const value of expected) {
    assert.ok(source.includes(value), `${label} must include: ${value}`);
  }
}

test('historical S7 blueprint retains the multipage public experience record', () => {
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

test('historical S7 stage contract retains its closed-stage governance record', () => {
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

test('historical S7 contract retains its source and safety record', () => {
  const blueprint = readUtf8('docs/portfolio-blueprint.md');
  const contract = readUtf8('docs/task-center/s7-multipage-portfolio.md');
  const combined = `${blueprint}\n${contract}`;

  assertIncludesAll(
    combined,
    [
      '`content/site-content.json`',
      '`content/s3-content.json`',
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

test('S9 supersedes historical S7 live-page requirements', () => {
  const blueprint = readUtf8('docs/portfolio-blueprint.md');
  const specification = readUtf8(s9SpecPath);
  const currentHarness = readUtf8('scripts/s9-visual-smoke.mjs');
  const currentContract = `${blueprint}\n${specification}\n${currentHarness}`;

  assertIncludesAll(
    currentContract,
    [
      '## 14. S9 Morse 作品集重设计(2026-07-14)',
      'Morse',
      '/works#content-agent',
      '本节是当前作品集前端与公开内容的最高优先级需求',
      '内容创作 Agent 系统和自动运营 Agent 系统均为企业内部脱敏案例',
      '旧 `/works/[slug]` 地址重定向到 `/works#slug`',
      '首页不再保留完整四项目展厅、职业经历或静态 FAQ',
      '删除企业内部项目的公开入口、生产截图和可识别部署信息',
      '访问系统按钮',
    ],
    'S9 current public contract',
  );
  assert.doesNotMatch(
    currentHarness,
    /['"]\/works\/(?:content-agent|auto-operations|deep-research|digital-morse)['"]/,
    'S9 current browser gate must use /works#slug instead of legacy detail routes',
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

test('historical S7 retains its repeatable multipage visual evidence command', () => {
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
