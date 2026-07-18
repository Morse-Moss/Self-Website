import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { validateProductionRole } from '../lib/server/production-config.ts';
import { main as runWorker } from './worker.mjs';

const supportedRoles = new Set(['web', 'worker', 'migration', 'ingest']);

function webArguments(env) {
  const port = Number(env.PORT?.trim() || '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PRODUCTION_PORT_INVALID');
  }
  return [
    path.resolve('node_modules', 'next', 'dist', 'bin', 'next'),
    'start',
    '--hostname',
    '0.0.0.0',
    '--port',
    String(port),
  ];
}

function childArguments(role, env) {
  if (role === 'web') return webArguments(env);
  if (role === 'migration') return [path.resolve('scripts', 'migrate-db.mjs')];
  if (role === 'ingest') return [path.resolve('scripts', 'ingest-knowledge.mjs')];
  throw new Error('PRODUCTION_ROLE_INVALID');
}

async function runChild(role, env) {
  const child = spawn(process.execPath, childArguments(role, env), {
    env,
    stdio: 'inherit',
  });
  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  const onSigint = () => forwardSignal('SIGINT');
  const onSigterm = () => forwardSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  try {
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    if (exit.signal) process.kill(process.pid, exit.signal);
    if (exit.code !== 0) throw new Error('PRODUCTION_CHILD_FAILED');
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }
}

export async function main({
  role = process.argv[2],
  env = process.env,
  logger = console,
} = {}) {
  if (!supportedRoles.has(role)) throw new Error('PRODUCTION_ROLE_INVALID');
  validateProductionRole(role, env);
  logger.log(`PRODUCTION_ROLE_READY:${role}`);
  if (role === 'worker') {
    await runWorker({ env, logger });
    return;
  }
  await runChild(role, env);
}

const filename = fileURLToPath(import.meta.url);
const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === filename;
if (isMain) {
  main().catch((error) => {
    const code = typeof error?.code === 'string'
      ? error.code
      : /^[A-Z0-9_:-]+$/u.test(error?.message ?? '')
        ? error.message
        : 'PRODUCTION_START_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
