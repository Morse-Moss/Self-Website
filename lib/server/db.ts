import pg from 'pg';

import {
  createDatabaseClientConfig,
  createDatabasePoolConfig,
  type DatabasePoolConfigInput,
} from './database-config.ts';

export { createDatabaseClientConfig, createDatabasePoolConfig } from './database-config.ts';

const { Pool } = pg;
const globalForDatabase = globalThis as typeof globalThis & { morseDatabasePool?: pg.Pool };

interface CreateDatabasePoolInput extends DatabasePoolConfigInput {
  onIdleError?: (code: 'DATABASE_POOL_IDLE_ERROR') => void;
}

export function createDatabasePool(
  connectionString: string,
  input: CreateDatabasePoolInput,
): pg.Pool {
  const pool = new Pool(createDatabasePoolConfig(connectionString, input));
  const onIdleError = input.onIdleError ?? ((code: 'DATABASE_POOL_IDLE_ERROR') => {
    console.error(code);
  });
  pool.on('error', () => onIdleError('DATABASE_POOL_IDLE_ERROR'));
  return pool;
}

export function getPool(connectionString: string): pg.Pool {
  if (!globalForDatabase.morseDatabasePool) {
    globalForDatabase.morseDatabasePool = createDatabasePool(connectionString, {
      env: process.env,
      role: 'web',
    });
  }
  return globalForDatabase.morseDatabasePool;
}
