import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (relativePath) => fs.readFileSync(path.resolve(relativePath), 'utf8');

test('Docker build context excludes local secrets, state, evidence and generated output', () => {
  const source = read('.dockerignore');
  for (const pattern of [
    '.env*',
    '.git',
    'node_modules',
    '.next',
    '.worktrees',
    'AGENTS.md',
    'docs',
    'docs/verify',
    'tests',
    'prototype',
    'content/drafts',
    '*.log',
    'output',
    'tmp',
  ]) {
    assert.match(source, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`, 'm'));
  }
});

test('application image uses Node 24, drops root and defaults to the web role', () => {
  const source = read('Dockerfile');
  assert.match(source, /^FROM node:24-alpine AS dependencies$/m);
  assert.match(source, /^RUN npm ci$/m);
  assert.match(source, /^USER nextjs$/m);
  assert.match(source, /^CMD \["node", "scripts\/run-production\.mjs", "web"\]$/m);
  assert.doesNotMatch(source, /COPY\s+\.env|ARG\s+.*(?:KEY|SECRET|TOKEN|PASSWORD)/i);
});

test('production roles, health routes and release checks have explicit commands', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['production:web'], 'node scripts/run-production.mjs web');
  assert.equal(pkg.scripts['production:worker'], 'node scripts/run-production.mjs worker');
  assert.equal(pkg.scripts['production:migrate'], 'node scripts/run-production.mjs migration');
  assert.equal(pkg.scripts['production:ingest'], 'node scripts/run-production.mjs ingest');
  assert.equal(pkg.scripts['release:smoke'], 'node scripts/release-smoke.mjs');
  for (const file of [
    'app/api/health/live/route.ts',
    'app/api/health/ready/route.ts',
    'scripts/run-production.mjs',
    'scripts/worker.mjs',
    'scripts/release-smoke.mjs',
    'docs/runbooks/production.md',
  ]) {
    assert.ok(fs.existsSync(path.resolve(file)), `missing ${file}`);
  }
  const worker = read('scripts/worker.mjs');
  assert.match(worker, /process\.once\('SIGINT'/);
  assert.match(worker, /process\.once\('SIGTERM'/);
  assert.match(worker, /WORKER_ITERATION_FAILED/);
  for (const script of [
    'scripts/migrate-db.mjs',
    'scripts/ingest-knowledge.mjs',
    'scripts/create-invite.mjs',
  ]) {
    assert.match(read(script), /createDatabaseClientConfig/);
  }
});

test('Next production responses use the frozen baseline headers without an unverified CSP', () => {
  const source = read('next.config.mjs');
  assert.match(source, /poweredByHeader:\s*false/);
  for (const header of [
    'X-Content-Type-Options',
    'Referrer-Policy',
    'X-Frame-Options',
    'Permissions-Policy',
    'Strict-Transport-Security',
  ]) {
    assert.match(source, new RegExp(header));
  }
  assert.doesNotMatch(source, /Content-Security-Policy/);
});

test('production environment contract exposes controls but no committed credentials', () => {
  const source = read('.env.example');
  for (const name of [
    'MORSE_PUBLIC_ORIGIN',
    'MORSE_LOCAL_RELEASE_SMOKE',
    'MORSE_DATABASE_SSL_MODE',
    'MORSE_DATABASE_SSL_CA',
    'MORSE_DATABASE_POOL_MAX',
    'MORSE_DATABASE_CONNECT_TIMEOUT_MS',
    'MORSE_DATABASE_IDLE_TIMEOUT_MS',
    'MORSE_DATABASE_STATEMENT_TIMEOUT_MS',
    'MORSE_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS',
    'MORSE_ALERTS_ENABLED',
    'MORSE_WORKER_POLL_MS',
    'MORSE_WORKER_BACKOFF_MAX_MS',
    'MORSE_CLEANUP_INTERVAL_MS',
  ]) {
    assert.match(source, new RegExp(`^${name}=`, 'm'));
  }
  assert.doesNotMatch(source, /sk-[A-Za-z0-9_-]{16,}/);
  assert.doesNotMatch(source, /^FEISHU_WEBHOOK_URL=https?:\/\/.+/m);
});

test('production launcher rejects invalid worker settings before announcing readiness', () => {
  const result = spawnSync(process.execPath, ['scripts/run-production.mjs', 'worker'], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://runtime@db.internal/revolution',
      MORSE_DATABASE_SSL_MODE: 'require',
      MORSE_ALERTS_ENABLED: 'false',
      MORSE_ALERT_DISPATCH_LIMIT: '0',
    },
    timeout: 5_000,
  });

  assert.equal(result.status, 1, result.error?.message);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'PRODUCTION_WORKER_CONFIG_INVALID');
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /PRODUCTION_ROLE_READY/);
});
