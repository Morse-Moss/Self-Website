import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('S10 has one active blueprint override and a nine-stage task center', () => {
  const blueprint = read('docs/portfolio-blueprint.md');
  const design = read('docs/superpowers/specs/2026-07-15-s10-smart-customer-service-design.md');
  const plan = read('docs/superpowers/plans/2026-07-15-s10-smart-customer-service.md');
  const taskCenter = read('docs/task-center/s10-smart-customer-service.md');
  const runState = read('docs/task-center/run-state.md');

  const headings = blueprint.match(/^## 15\. S10 数字摩斯智能客服\(2026-07-15\)$/gm) ?? [];
  assert.equal(headings.length, 1);
  const activeS10 = blueprint.slice(blueprint.indexOf(headings[0]));
  assert.match(activeS10, /后决策覆盖/);
  assert.match(activeS10, /取消月预算硬熔断/);
  assert.doesNotMatch(activeS10, /月预算硬熔断机制保留/);
  assert.match(activeS10, /不抓任意网页正文/);
  const runPointer = runState.match(/^\*\*([^*]+)\*\*$/m)?.[1];
  const stagePointer = taskCenter.match(/^\*\*((?:S10-CS-[0-8][^*]+)|S10 (?:LOCAL_READY|REAL_PROVIDER_VERIFIED \/ MAINLINE_ABSORPTION|MAINLINE_LOCAL_READY|MAINLINE_PROVIDER_READY))\*\*$/m)?.[1];
  assert.ok(runPointer);
  if (runPointer.startsWith('S10')) assert.equal(runPointer, stagePointer);
  else assert.match(runPointer, /^S11-/);
  assert.match(runState, /not applicable to S10/);
  assert.match(runState, /forbids push\/deploy/);
  assert.equal((taskCenter.match(/^\| `S10-CS-[0-8]/gm) ?? []).length, 9);

  for (const document of [design, plan, taskCenter]) {
    assert.match(document, /schema_migrations/);
    assert.match(document, /bootstrap/i);
    assert.match(document, /001-only/);
    assert.match(document, /checksum/);
  }
});

test('S10 freezes separate access and retention lifetimes', () => {
  const design = read('docs/superpowers/specs/2026-07-15-s10-smart-customer-service-design.md');
  const taskCenter = read('docs/task-center/s10-smart-customer-service.md');

  assert.match(design, /72h 访客邀请码[\s\S]*12h HttpOnly access cookie\/session/);
  assert.match(design, /运行态与分析态必须物理分离/);
  assert.match(design, /不使用级联外键/);
  assert.match(design, /10 天后删除原文/);
  assert.match(taskCenter, /邀请码最长 72 小时；access\/session 上下文 12 小时/);
});

test('S10 freezes Provider, search, admin and alert safety boundaries', () => {
  const blueprint = read('docs/portfolio-blueprint.md');
  const design = read('docs/superpowers/specs/2026-07-15-s10-smart-customer-service-design.md');
  const plan = read('docs/superpowers/plans/2026-07-15-s10-smart-customer-service.md');
  const taskCenter = read('docs/task-center/s10-smart-customer-service.md');

  assert.match(design, /responses.*chat_completions/);
  assert.match(design, /usage 缺失时数据库记 `NULL`/);
  assert.match(design, /AbortSignal/);
  assert.match(design, /不抓取搜索结果页/);
  assert.match(design, /模型只引用服务端分配的 citation id/);
  assert.match(design, /访客与管理员认证完全分离/);
  assert.match(design, /拒绝同一 counter 重放/);
  assert.match(design, /CSV 对公式前缀/);
  assert.match(design, /service-down:<incidentId>/);
  assert.match(design, /未来同一 fingerprint 再故障必须创建新 incident id/);
  assert.match(blueprint, /稳定事件 key[^。]*不重复入队/);
  assert.match(blueprint, /至少一次/);
  assert.match(design, /非幂等 webhook[^。]*物理恰好一次/);
  assert.doesNotMatch(blueprint, /重试不得重复通知/);
  assert.match(plan, /Invite lockout and admin lockout/);
  assert.match(plan, /ordinary chat, JD and routine quota/);
  assert.match(taskCenter, /两轮故障\/恢复/);
});

test('S10 freezes stop, history, limits and zero-skip acceptance', () => {
  const design = read('docs/superpowers/specs/2026-07-15-s10-smart-customer-service-design.md');
  const taskCenter = read('docs/task-center/s10-smart-customer-service.md');

  assert.match(design, /停止或完成前失败不扣消息额度/);
  assert.match(design, /12 小时历史恢复/);
  assert.match(design, /每 Session 最多五次博查/);
  assert.match(design, /Chat 与 Search 各有 kill switch/);
  assert.match(design, /全局 Provider 与 Search 并发有独立上限/);
  assert.match(design, /disposable pgvector[\s\S]*零 skip/);
  assert.match(design, /1440x900 与 390x844/);
  assert.match(taskCenter, /Provider 并发 4、Search 并发 2/);
});

test('S10 environment contract has controls but no committed secret', () => {
  const example = read('.env.example');

  for (const name of [
    'OPENAI_CHAT_PROTOCOL',
    'MORSE_INTERACTION_RETENTION_DAYS',
    'MORSE_MAX_SEARCHES_PER_SESSION',
    'MORSE_CHAT_ENABLED',
    'MORSE_SEARCH_ENABLED',
    'BOCHA_API_KEY',
    'MORSE_ADMIN_PASSWORD_HASH',
    'MORSE_ADMIN_TOTP_SECRET',
    'MORSE_ADMIN_ALLOWED_ORIGIN',
    'MORSE_ADMIN_MAX_FAILED_ATTEMPTS',
    'MORSE_INVITE_FINGERPRINT_SECRET',
    'MORSE_INVITE_MAX_FAILED_ATTEMPTS',
    'MORSE_INVITE_ATTEMPT_WINDOW_SECONDS',
    'MORSE_INVITE_LOCK_SECONDS',
    'MORSE_INVITE_TRUSTED_PROXY_HOPS',
    'MORSE_OFFICIAL_GITHUB_OWNERS',
    'FEISHU_WEBHOOK_URL',
  ]) {
    assert.match(example, new RegExp(`^${name}=`, 'm'));
  }

  assert.doesNotMatch(example, /^MORSE_MONTHLY_BUDGET_USD=/m);
  assert.match(example, /^MORSE_PUBLIC_ORIGIN=/m);
  assert.doesNotMatch(example, /^MORSE_ADMIN_MAX_ATTEMPTS=/m);
  assert.doesNotMatch(example, /^MORSE_INVITE_MAX_ATTEMPTS=/m);
  assert.doesNotMatch(example, /^MORSE_INVITE_WINDOW_MINUTES=/m);
  assert.doesNotMatch(example, /^MORSE_OFFICIAL_SOURCE_DOMAINS=.*github\.com/m);
  assert.doesNotMatch(example, /sk-[A-Za-z0-9_-]{16,}/);
  assert.doesNotMatch(example, /FEISHU_WEBHOOK_URL=https?:\/\/.+/);
});

test('S10 production runtime snapshot carries the migration manifest for readiness', () => {
  const smoke = read('scripts/s10-chat-smoke.mjs');
  assert.match(smoke, /const RUNTIME_COPY_ENTRIES = \[[\s\S]*['"]db['"]/);
});
