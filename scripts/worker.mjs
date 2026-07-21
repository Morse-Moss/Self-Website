import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createDatabasePool } from '../lib/server/db.ts';
import { FeishuAlertProvider } from '../lib/server/feishu-alert-provider.ts';
import { validateProductionRole } from '../lib/server/production-config.ts';
import { loadWorkerConfig } from '../lib/server/worker-config.ts';
import { cleanupExpired as cleanupExpiredOperation } from './cleanup-expired.mjs';
import { cleanupResumeStorage as cleanupResumeStorageOperation } from './cleanup-resume-storage.mjs';
import { dispatchAvailableAlerts } from './dispatch-alerts.mjs';

export { loadWorkerConfig } from '../lib/server/worker-config.ts';

export function infrastructureBackoffMs(failureCount, baseMs, maximumMs) {
  const exponent = Math.max(0, Math.min(30, failureCount - 1));
  return Math.min(baseMs * (2 ** exponent), maximumMs);
}

function abortableSleep(milliseconds, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * @param {{
 *   pool: any,
 *   env?: Record<string, string|undefined>,
 *   signal: AbortSignal,
 *   cleanupExpired?: (input: any) => Promise<any>,
 *   cleanupResumeStorage?: (input: any) => Promise<any>,
 *   dispatchAlerts?: (input: any) => Promise<any>,
 *   sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>,
 *   clock?: () => number,
 *   logger?: Pick<Console, 'log'|'error'>,
 * }} input
 */
export async function runWorker({
  pool,
  env = process.env,
  signal,
  cleanupExpired = cleanupExpiredOperation,
  cleanupResumeStorage = cleanupResumeStorageOperation,
  dispatchAlerts,
  sleep = abortableSleep,
  clock = () => Date.now(),
  logger = console,
}) {
  if (!pool) throw new Error('WORKER_POOL_REQUIRED');
  if (!signal) throw new Error('WORKER_SIGNAL_REQUIRED');
  const config = loadWorkerConfig(env);
  let consecutiveFailures = 0;
  let nextCleanupAt = 0;
  logger.log('WORKER_STARTED');
  try {
    while (!signal.aborted) {
      try {
        const iterationNow = clock();
        if (iterationNow >= nextCleanupAt) {
          await cleanupExpired({ pool, now: new Date(iterationNow) });
          const storageDir = env.MORSE_RESUME_STORAGE_DIR?.trim();
          if (storageDir) await cleanupResumeStorage({
            pool,
            storageDir,
            now: new Date(iterationNow),
          });
          nextCleanupAt = iterationNow + config.cleanupIntervalMs;
        }
        if (config.alertsEnabled) {
          if (!dispatchAlerts) throw new Error('WORKER_DISPATCH_REQUIRED');
          await dispatchAlerts({ pool });
        }
        consecutiveFailures = 0;
        await sleep(config.pollMs, signal);
      } catch {
        if (signal.aborted) break;
        consecutiveFailures += 1;
        logger.error('WORKER_ITERATION_FAILED');
        await sleep(infrastructureBackoffMs(
          consecutiveFailures,
          config.pollMs,
          config.infrastructureBackoffMaxMs,
        ), signal);
      }
    }
  } finally {
    await pool.end();
    logger.log('WORKER_STOPPED');
  }
}

/**
 * @param {{
 *   env?: Record<string, string|undefined>,
 *   logger?: Pick<Console, 'log'|'error'>,
 *   fetcher?: typeof fetch,
 * }} [input]
 */
export async function main({ env = process.env, logger = console, fetcher = fetch } = {}) {
  const preflight = validateProductionRole('worker', env);
  const workerConfig = loadWorkerConfig(env);
  const pool = createDatabasePool(env.DATABASE_URL, { env, role: 'worker' });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    let dispatchAlerts;
    if (preflight.alertsEnabled) {
      const provider = new FeishuAlertProvider({
        webhookUrl: workerConfig.webhookUrl ?? '',
        timeoutMs: 5_000,
      }, fetcher);
      dispatchAlerts = ({ pool: workerPool }) => dispatchAvailableAlerts({
        pool: workerPool,
        provider,
        limit: workerConfig.dispatchLimit,
        maxDeliveryAttempts: workerConfig.maxDeliveryAttempts,
      });
    }
    await runWorker({
      pool,
      env,
      signal: controller.signal,
      dispatchAlerts,
      logger,
    });
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

const filename = fileURLToPath(import.meta.url);
const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === filename;
if (isMain) {
  main().catch(() => {
    console.error('WORKER_FAILED');
    process.exitCode = 1;
  });
}
