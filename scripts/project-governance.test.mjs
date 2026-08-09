import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
  return fs.readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

test('agent entrypoints share the canonical engineering rules without a duplicate rule source', async () => {
  const [agents, claude, standards] = await Promise.all([
    read('AGENTS.md'),
    read('CLAUDE.md'),
    read('docs/engineering-standards.md'),
  ]);

  for (const entrypoint of [agents, claude]) {
    assert.match(entrypoint, /docs\/engineering-standards\.md/u);
  }
  assert.match(standards, /铁律/u);
  assert.match(standards, /绊线/u);
  assert.match(standards, /例外/u);
  await assert.rejects(fs.access(path.join(repositoryRoot, 'docs', 'ARCH_RULES.md')));
});

test('tripwire configuration blocks foreign-system changes and ratchets legacy hotspots', async () => {
  const config = JSON.parse(await read('.vibe-tripwire.json'));
  const denied = new Set(config.scope_guard?.deny_prefixes ?? []);
  for (const forbiddenPath of [
    'auto-job-agent',
    'boss-helper-main',
    'boss-helper-main.zip',
    'get_jobs',
    'get_jobs-git-incomplete',
    'get_jobs-main.zip',
    '.worktrees',
  ]) {
    assert.equal(denied.has(forbiddenPath), true, `missing denied scope: ${forbiddenPath}`);
  }
  assert.equal(config.scope_guard?.enabled, true);
  assert.equal(config.scope_guard?.check_all, false);
  assert.equal(config.legacy?.existing_over_limit, 'warn');
  assert.equal(config.legacy?.block_growth, true);
  assert.equal(config.waiver_file, 'docs/architecture-waivers.json');
  assert.deepEqual(JSON.parse(await read(config.waiver_file)), []);
});

test('foreign systems stay outside Git additions, compilation, lint, images, and release archives', async () => {
  const [gitignore, dockerignore, attributes, tsconfig, eslint] = await Promise.all([
    read('.gitignore'),
    read('.dockerignore'),
    read('.gitattributes'),
    read('tsconfig.json').then(JSON.parse),
    read('eslint.config.mjs'),
  ]);

  for (const prefix of ['auto-job-agent', 'boss-helper-main', 'get_jobs', 'get_jobs-git-incomplete']) {
    assert.match(gitignore, new RegExp(`/${prefix.replaceAll('-', '\\-')}/`));
    assert.match(dockerignore, new RegExp(`^${prefix}$`, 'm'));
    assert.match(attributes, new RegExp(`^/${prefix}/\\*\\* export-ignore$`, 'm'));
    assert.equal(tsconfig.exclude.includes(prefix), true, `tsconfig must exclude ${prefix}`);
    assert.match(eslint, new RegExp(`'${prefix}/\\*\\*'`));
  }
});

test('local and CI entrypoints execute the project governance checks', async () => {
  const [packageJson, hook, workflow, checker] = await Promise.all([
    read('package.json').then(JSON.parse),
    read('.githooks/pre-commit'),
    read('.github/workflows/architecture.yml'),
    read('tools/check_tripwire.mjs'),
  ]);

  assert.equal(packageJson.scripts['check:architecture'], 'node --test scripts/architecture-contract.test.mjs scripts/project-governance.test.mjs');
  assert.equal(packageJson.scripts['check:tripwire'], 'node tools/check_tripwire.mjs --all');
  assert.equal(packageJson.scripts['check:tripwire:changed'], 'node tools/check_tripwire.mjs --changed-from');
  assert.match(hook, /tools\/check_tripwire\.mjs" --staged/u);
  assert.match(hook, /未在 PATH 找到 node[\s\S]*exit 1/u);
  assert.match(hook, /git cat-file -e ":\.vibe-tripwire\.json"/u);
  assert.match(workflow, /npm ci/u);
  assert.match(workflow, /npm run check:architecture/u);
  assert.match(workflow, /npm run check:tripwire:changed/u);
  assert.match(checker, /cat-file/u);
});
