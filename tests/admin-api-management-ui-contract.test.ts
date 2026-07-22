import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const files = {
  layout: path.resolve('app/admin/layout.tsx'),
  page: path.resolve('app/admin/api/page.tsx'),
  shell: path.resolve('components/admin/AdminShell.tsx'),
  shellStyles: path.resolve('components/admin/AdminShell.module.css'),
  console: path.resolve('components/admin/AdminApiConsole.tsx'),
  styles: path.resolve('components/admin/AdminApiConsole.module.css'),
  library: path.resolve('components/admin/AdminProviderLibrary.tsx'),
  routeEditor: path.resolve('components/admin/AdminRouteEditor.tsx'),
  form: path.resolve('components/admin/AdminProviderForm.tsx'),
  reauth: path.resolve('components/admin/AdminReauthDialog.tsx'),
  client: path.resolve('components/admin/admin-api-client.ts'),
} as const;

function read(filePath: string): string {
  assert.ok(fs.existsSync(filePath), `missing expected file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

test('admin routes share one private session shell with two navigation tabs', () => {
  const layout = read(files.layout);
  const shell = read(files.shell);
  const page = read(files.page);

  assert.match(layout, /import AdminShell from ['"]@\/components\/admin\/AdminShell['"]/u);
  assert.match(layout, /<AdminShell>\{children\}<\/AdminShell>/u);
  assert.match(page, /<AdminApiConsole\s*\/>/u);
  assert.match(shell, /href=['"]\/admin['"]/u);
  assert.match(shell, /href=['"]\/admin\/api['"]/u);
  assert.match(shell, /对话复盘/u);
  assert.match(shell, /API 配置/u);
  assert.match(shell, /\/api\/admin\/session/u);
  assert.match(shell, /method:\s*['"]DELETE['"]/u);
  assert.match(shell, /requireLogin/u);
  assert.doesNotMatch(shell, /localStorage|sessionStorage|document\.cookie/u);
});

test('API console exposes runtime truth before the catalog workbench', () => {
  const source = [read(files.console), read(files.client)].join('\n');

  assert.match(source, /\/api\/admin\/providers\/runtime/u);
  assert.match(source, /\/api\/admin\/providers\?/u);
  assert.match(source, /\/api\/admin\/providers\/events/u);
  for (const label of ['当前主线路', '活动版本', '备用线路', '最近激活', '编辑路由']) {
    assert.match(source, new RegExp(label, 'u'));
  }
  assert.match(source, /loading/u);
  assert.match(source, /empty/u);
  assert.match(source, /error/u);
  assert.match(source, /permission/u);
  assert.match(source, /AI_CONFIG_CONFLICT/u);
  assert.match(source, /刷新最新配置/u);
});

test('provider library keeps saved keys redacted and exposes explicit lifecycle operations', () => {
  const source = [read(files.library), read(files.form)].join('\n');

  assert.match(source, /includeDeleted/u);
  assert.match(source, /hasApiKey/u);
  assert.match(source, /['"]password['"]/u);
  assert.match(source, /autoComplete=['"]new-password['"]/u);
  assert.doesNotMatch(source, /connection\?\.apiKey|connection\.apiKey|model\.apiKey/u);
  for (const label of ['新增中转', '新增模型', '获取模型列表', '测试', '编辑', '删除']) {
    assert.match(source, new RegExp(label, 'u'));
  }
  assert.match(source, /responses/u);
  assert.match(source, /chat_completions/u);
  assert.match(source, /reuseKeyAcrossOrigin/u);
});

test('route editor supports one primary and five fallbacks without drag-only operation', () => {
  const source = read(files.routeEditor);

  assert.match(source, /draggable/u);
  assert.match(source, /onDragStart/u);
  assert.match(source, /onDrop/u);
  assert.match(source, /selected\.length\s*>=\s*6/u);
  for (const label of ['上移', '下移', '移除']) {
    assert.match(source, new RegExp(`aria-label=\\{?[^\\n]*${label}`, 'u'));
    assert.match(source, new RegExp(`title=\\{?[^\\n]*${label}`, 'u'));
  }
  assert.match(source, /主线路/u);
  assert.match(source, /备用 5/u);
  assert.match(source, /放弃更改/u);
  assert.match(source, /激活配置/u);
  assert.match(source, /配置差异/u);
});

test('dangerous and Provider network operations require password reauthentication', () => {
  const source = read(files.reauth);

  assert.match(source, /role=['"]dialog['"]/u);
  assert.match(source, /aria-modal=['"]true['"]/u);
  assert.match(source, /name=['"]adminPassword['"]/u);
  assert.match(source, /autoComplete=['"]current-password['"]/u);
  assert.match(source, /可能产生极少 API 费用/u);
  assert.match(source, /confirmationName/u);
  assert.match(source, /discover|test|activate|delete/u);
});

test('API workbench CSS is token-only, responsive, and resistant to dense data overflow', () => {
  const styles = [read(files.shellStyles), read(files.styles)].join('\n');

  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/iu);
  const letterSpacingValues = [...styles.matchAll(/letter-spacing:\s*([^;}]+)/giu)]
    .map((match) => match[1].trim());
  assert.ok(letterSpacingValues.every((value) => value === '0'));
  assert.match(styles, /min-height:\s*44px/u);
  assert.match(styles, /overflow-wrap:\s*anywhere/u);
  assert.match(styles, /grid-template-columns/u);
  assert.match(styles, /@media\s*\(max-width:\s*640px\)/u);
  assert.match(styles, /position:\s*fixed/u);
  assert.match(styles, /inset:\s*0/u);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/u);
  assert.match(styles, /transition:\s*none/u);
});

test('API client builds strict catalog queries and maps stable server errors', async () => {
  assert.ok(fs.existsSync(files.client), `missing expected file: ${files.client}`);
  const client = await import('../components/admin/admin-api-client.ts');

  assert.equal(client.buildProviderCatalogQuery(false), 'page=1&limit=100&includeDeleted=false');
  assert.equal(client.buildProviderCatalogQuery(true), 'page=1&limit=100&includeDeleted=true');
  assert.match(client.providerErrorMessage(409, 'AI_CONFIG_CONFLICT'), /其他管理页面/u);
  assert.match(client.providerErrorMessage(409, 'AI_CONFIG_TEST_REQUIRED'), /重新测试/u);
  assert.match(client.providerErrorMessage(409, 'AI_CONFIG_IN_USE'), /活动路由/u);
  assert.match(client.providerErrorMessage(429, 'AI_CONFIG_RATE_LIMITED'), /稍后/u);
  assert.match(client.providerErrorMessage(401, 'ADMIN_AUTH_REQUIRED'), /重新登录/u);
});

test('route activation reloads the canonical runtime read model after acknowledgement', () => {
  const client = read(files.client);
  const consoleSource = read(files.console);

  assert.match(client, /interface ProviderActivationResult/u);
  assert.match(client, /requestJson<ProviderActivationResult>\(['"]\/api\/admin\/providers\/routes\/activate['"]/u);
  assert.doesNotMatch(consoleSource, /setRuntime\(next\)/u);
  assert.match(consoleSource, /路由 v\$\{next\.activeRevision\} 已激活/u);
});

test('active snapshots use stable series identity and expose explicit previous-route rollback', () => {
  const consoleSource = read(files.console);
  const clientSource = read(files.client);

  assert.match(consoleSource, /target\.databaseModelSeriesId/u);
  assert.match(consoleSource, /data-testid="route-rollback"/u);
  assert.match(consoleSource, /rollbackRoute/u);
  assert.doesNotMatch(consoleSource, /connection\.displayName === target\.connectionDisplayName[\s\S]*model\.modelId === target\.modelId/u);
  assert.match(clientSource, /rollbackToPrevious:\s*true/u);
});
