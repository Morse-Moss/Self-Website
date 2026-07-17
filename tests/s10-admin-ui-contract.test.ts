import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const adminDirectory = path.resolve('components/admin');
const consolePath = path.join(adminDirectory, 'AdminConsole.tsx');
const detailPath = path.join(adminDirectory, 'AdminTurnDetail.tsx');
const clientPath = path.join(adminDirectory, 'admin-client.ts');
const stylePath = path.join(adminDirectory, 'AdminConsole.module.css');
const layoutPath = path.resolve('app/admin/layout.tsx');
const pagePath = path.resolve('app/admin/page.tsx');
const publicHeaderPath = path.resolve('components/site/SiteHeader.tsx');

interface AdminClientModule {
  buildAdminQuery: (filters: {
    from: string;
    to: string;
    workflow: string;
    status: string;
    usedSearch: string;
    badcase: string;
    page: number;
    limit: number;
  }) => string;
  adminErrorMessage: (status: number, code?: string) => string;
  normalizeAdminFilters: (filters: {
    from: string;
    to: string;
    workflow: string;
    status: string;
    usedSearch: string;
    badcase: string;
    page: number;
    limit: number;
  }) => { from: string; to: string };
  exportFileName: (contentDisposition: string | null, format: 'json' | 'csv') => string;
}

function read(filePath: string): string {
  assert.ok(fs.existsSync(filePath), `missing expected file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function adminSource(): string {
  assert.ok(fs.existsSync(adminDirectory), 'missing components/admin');
  return fs.readdirSync(adminDirectory)
    .filter((name) => /\.(?:ts|tsx)$/u.test(name))
    .sort()
    .map((name) => read(path.join(adminDirectory, name)))
    .join('\n');
}

test('admin uses a private route shell and is absent from public navigation', () => {
  const layout = read(layoutPath);
  const page = read(pagePath);
  const publicHeader = read(publicHeaderPath);

  assert.match(page, /import AdminConsole from ['"]@\/components\/admin\/AdminConsole['"]/);
  assert.match(page, /<AdminConsole\s*\/>/);
  assert.match(layout, /children:\s*React\.ReactNode/);
  assert.match(layout, /data-admin-shell/);
  assert.doesNotMatch(layout, /SiteHeader|SiteFooter|ResumeSheet|MorseSignalCanvas|MorseChat/);
  assert.doesNotMatch(publicHeader, /href=[{'"]+\/admin|>\s*管理后台\s*</u);
});

test('admin login, session check, and logout stay on the isolated admin session API', () => {
  const source = adminSource();

  assert.match(source, /fetch\(['"]\/api\/admin\/session['"],\s*\{\s*cache:\s*['"]no-store['"]/s);
  assert.match(source, /name=['"]password['"]/);
  assert.match(source, /name=['"]totpCode['"]/);
  assert.match(source, /autoComplete=['"]current-password['"]/);
  assert.match(source, /autoComplete=['"]one-time-code['"]/);
  assert.match(source, /method:\s*['"]POST['"]/);
  assert.match(source, /JSON\.stringify\(\{\s*password,\s*totpCode\s*\}\)/s);
  assert.match(source, /method:\s*['"]DELETE['"]/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
});

test('admin filters map time, workflow, status, search, badcase, and pagination to the API', () => {
  const source = adminSource();
  const client = read(clientPath);

  for (const name of ['from', 'to', 'workflow', 'status', 'usedSearch', 'badcase']) {
    assert.match(source, new RegExp(`name=['"]${name}['"]`));
    assert.match(client, new RegExp(`params\\.set\\(['"]${name}['"]`));
  }
  assert.match(client, /params\.set\(['"]page['"],\s*String\(filters\.page\)\)/);
  assert.match(client, /params\.set\(['"]limit['"],\s*String\(filters\.limit\)\)/);
  assert.match(source, /\/api\/admin\/turns\?\$\{buildAdminQuery\(filters\)\}/);
  assert.match(source, /上一页/);
  assert.match(source, /下一页/);
  assert.match(source, /共 \{list\.total\} 条/);
});

test('admin provides an inspectable list-detail workflow and full-screen mobile detail', () => {
  const source = adminSource();
  const styles = read(stylePath);

  assert.match(source, /aria-label=['"]对话记录['"]/);
  assert.match(source, /aria-current=\{selected\s*\?\s*['"]true['"]\s*:\s*undefined\}/);
  assert.match(source, /fetch\(`\/api\/admin\/turns\/\$\{(?:turnId|selectedId)\}`/);
  assert.match(source, /setMobileDetailOpen\(true\)/);
  assert.match(source, /setMobileDetailOpen\(false\)/);
  assert.match(source, /返回列表/);
  assert.match(styles, /grid-template-columns:\s*minmax\([^;]+\)\s+minmax\([^;]+\)/);
  assert.match(styles, /@media\s*\(max-width:\s*640px\)/);
  assert.match(styles, /\.detailPanel\[data-mobile-open=['"]true['"]\][\s\S]*position:\s*fixed/);
  assert.match(styles, /\.detailPanel\[data-mobile-open=['"]true['"]\][\s\S]*inset:\s*0/);
});

test('badcase editing persists a bounded note through PATCH', () => {
  const source = adminSource();

  assert.match(source, /name=['"]badcase['"]/);
  assert.match(source, /name=['"]adminNote['"]/);
  assert.match(source, /maxLength=\{2_000\}/);
  assert.match(source, /method:\s*['"]PATCH['"]/);
  assert.match(source, /JSON\.stringify\(\{\s*badcase,\s*note:\s*adminNote\s*\}\)/s);
  assert.match(source, /保存标记/);
});

test('badcase saved feedback survives the parent detail reflection', () => {
  const source = read(detailPath);

  assert.match(source, /setSaved\(true\);\s*onSaved\(updated\.badcase, updated\.adminNote\)/s);
  assert.match(source, /useEffect\(\(\) => \{\s*setSaved\(false\);\s*\}, \[detail\?\.id\]\);/s);
  assert.doesNotMatch(
    source,
    /setSaved\(false\);\s*\}, \[detail\?\.id, detail\?\.badcase, detail\?\.adminNote\]\);/s,
  );
});

test('export dialog requires a fresh TOTP and downloads JSON or CSV without server files', () => {
  const source = adminSource();

  assert.match(source, /role=['"]dialog['"]/);
  assert.match(source, /aria-modal=['"]true['"]/);
  assert.match(source, /value=['"]json['"]/);
  assert.match(source, /value=['"]csv['"]/);
  assert.match(source, /freshTotp/);
  assert.match(source, /fetch\(['"]\/api\/admin\/export['"]/);
  assert.match(source, /JSON\.stringify\(\{\s*format,\s*totpCode:\s*freshTotp,\s*filters:/s);
  assert.match(source, /response\.blob\(\)/);
  assert.match(source, /URL\.createObjectURL/);
  assert.match(source, /URL\.revokeObjectURL/);
  assert.match(source, /download\s*=/);
  assert.match(source, /const exportingRef = useRef\(false\)/);
  assert.match(source, /exportingRef\.current = exporting/);
  assert.doesNotMatch(source, /\}, \[exporting, onClose, open\]\);/);
});

test('admin covers checking, loading, empty, unauthorized, and recoverable error states', () => {
  const source = adminSource();

  assert.match(source, /type AuthState = ['"]checking['"] \| ['"]signed_out['"] \| ['"]authorized['"] \| ['"]unavailable['"]/);
  assert.match(source, /role=['"]status['"]/);
  assert.match(source, /role=['"]alert['"]/);
  assert.match(source, /正在确认管理权限/);
  assert.match(source, /正在加载对话记录/);
  assert.match(source, /没有符合当前筛选条件的记录/);
  assert.match(source, /管理会话已过期/);
  assert.match(source, /重新加载/);
  assert.match(source, /loading=\{listLoading \|\| list === null\}/);
  assert.match(source, /loading=\{detailLoading \|\| Boolean\(selectedId && !detail && !detailError\)\}/);
});

test('admin is tokenized, responsive, and keeps every interactive control at least 44px', () => {
  const source = adminSource();
  const styles = read(stylePath);

  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/iu);
  assert.doesNotMatch(styles, /letter-spacing:\s*-[^;]+/iu);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /min-width:\s*0/);
  assert.match(styles, /max-width:\s*100%/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|https?:\/\/(?:fonts|cdn)\./iu);
  assert.match(source, /rel=['"]noopener noreferrer['"]/);
});

test('admin client serializes only active filters and stable pagination', async () => {
  const client = await import('../components/admin/admin-client.ts') as AdminClientModule;
  const query = client.buildAdminQuery({
    from: '2026-07-10T00:00',
    to: '',
    workflow: 'diagnosis',
    status: '',
    usedSearch: 'true',
    badcase: 'false',
    page: 3,
    limit: 20,
  });
  const params = new URLSearchParams(query);

  assert.equal(params.get('from'), new Date('2026-07-10T00:00').toISOString());
  assert.equal(params.has('to'), false);
  assert.equal(params.get('workflow'), 'diagnosis');
  assert.equal(params.has('status'), false);
  assert.equal(params.get('usedSearch'), 'true');
  assert.equal(params.get('badcase'), 'false');
  assert.equal(params.get('page'), '3');
  assert.equal(params.get('limit'), '20');
});

test('admin client keeps errors actionable and download names local', async () => {
  const client = await import('../components/admin/admin-client.ts') as AdminClientModule;

  assert.equal(client.adminErrorMessage(401, 'ADMIN_AUTH_REQUIRED'), '管理会话已过期，请重新登录。');
  assert.equal(client.adminErrorMessage(401, 'ADMIN_AUTH_FAILED'), '密码或动态验证码无效，也可能已触发临时锁定。');
  assert.equal(client.adminErrorMessage(401, 'ADMIN_TOTP_REQUIRED'), '动态验证码无效、已使用或已过期，请输入新的验证码。');
  assert.equal(client.adminErrorMessage(503, 'ADMIN_UNAVAILABLE'), '管理服务暂时不可用，请稍后重试。');
  assert.equal(
    client.exportFileName('attachment; filename="morse-interactions-2026-07-16.csv"', 'csv'),
    'morse-interactions-2026-07-16.csv',
  );
  assert.match(client.exportFileName('attachment; filename="../unsafe.exe"', 'json'), /^morse-interactions-\d{4}-\d{2}-\d{2}\.json$/u);
});

test('export reuses the same browser-time normalization as list filters', async () => {
  const source = adminSource();
  const client = await import('../components/admin/admin-client.ts') as AdminClientModule;
  const filters = {
    from: '2026-07-10T00:00',
    to: '2026-07-11T08:30',
    workflow: '',
    status: '',
    usedSearch: '',
    badcase: '',
    page: 2,
    limit: 20,
  };

  const normalized = client.normalizeAdminFilters(filters);
  assert.equal(normalized.from, new Date(filters.from).toISOString());
  assert.equal(normalized.to, new Date(filters.to).toISOString());
  assert.match(source, /const exportFilters = \{ \.\.\.normalizeAdminFilters\(filters\), page: 1 \}/);
});

test('admin exposes stable selectors for the Mock browser acceptance path', () => {
  const source = adminSource();

  for (const selector of [
    'admin-console',
    'admin-login-form',
    'admin-filter-form',
    'admin-turn-list',
    'admin-turn-row',
    'admin-turn-detail',
    'admin-detail-back',
    'admin-badcase-form',
    'admin-export-open',
    'admin-export-dialog',
    'admin-export-form',
    'admin-logout',
  ]) {
    assert.match(source, new RegExp(`data-testid=["']${selector}["']`), selector);
  }
  assert.match(source, /data-turn-id=\{turn\.id\}/);
});
