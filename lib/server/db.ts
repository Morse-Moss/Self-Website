import pg from 'pg';

const { Pool } = pg;
const globalForDatabase = globalThis as typeof globalThis & { morseDatabasePool?: pg.Pool };

export function getPool(connectionString: string): pg.Pool {
  if (!globalForDatabase.morseDatabasePool) {
    globalForDatabase.morseDatabasePool = new Pool({ connectionString, max: 10 });
  }
  return globalForDatabase.morseDatabasePool;
}
