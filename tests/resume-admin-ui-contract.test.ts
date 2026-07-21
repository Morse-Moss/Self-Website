import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const panelPath = path.resolve('components/admin/AdminResumePanel.tsx');
const stylePath = path.resolve('components/admin/AdminResumePanel.module.css');
const consolePath = path.resolve('components/admin/AdminConsole.tsx');
const clientPath = path.resolve('components/admin/admin-client.ts');

test('admin console exposes one concise resume management entry', () => {
  const source = fs.readFileSync(consolePath, 'utf8');
  assert.equal((source.match(/简历管理/gu) ?? []).length, 1);
  assert.match(source, /import AdminResumePanel/);
  assert.match(source, /<AdminResumePanel/);
});

test('resume workbench has current PDF, access code, and 30-day record sections', () => {
  assert.ok(fs.existsSync(panelPath));
  const source = fs.readFileSync(panelPath, 'utf8');
  for (const label of ['当前 PDF', '访问码', '近 30 天记录']) assert.match(source, new RegExp(label, 'u'));
  assert.match(source, /fetch\(['"]\/api\/admin\/resume['"]/u);
  assert.match(source, /fetch\(['"]\/api\/admin\/resume\/invites['"]/u);
  assert.match(source, /type=['"]password['"]/u);
  assert.match(source, /上传新版本/u);
  assert.match(source, /生成访问码/u);
  assert.match(source, /停用访问码/u);
  assert.match(source, /setCreatedCode\(null\)/u);
  assert.match(source, /onUnauthorizedRef\.current/u);
  assert.match(source, /event\.key === ['"]Escape['"]/u);
  assert.match(source, /querySelectorAll<HTMLElement>/u);
  assert.match(source, /previousFocusRef\.current\?\.focus\(\)/u);
  assert.match(source, /event\.target !== event\.currentTarget/u);
  assert.match(source, /event\.preventDefault\(\)/u);
  assert.doesNotMatch(source, /加密密钥|\bKey\b|模型节点|Provider|打印次数|下载次数/u);
});

test('resume workbench is responsive and long hashes cannot widen the panel', () => {
  const styles = fs.readFileSync(stylePath, 'utf8');
  assert.match(styles, /@media\s*\(max-width:\s*640px\)/u);
  assert.match(styles, /overflow-wrap:\s*anywhere/u);
  assert.match(styles, /min-height:\s*44px/u);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|rgb\(|hsl\(/iu);
  const client = fs.readFileSync(clientPath, 'utf8');
  assert.match(client, /interface AdminResumeDashboard/u);
});
