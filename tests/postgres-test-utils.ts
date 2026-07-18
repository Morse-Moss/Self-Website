import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import pg from 'pg';

const { Client } = pg;

const configuredAdminConnectionString = process.env.MORSE_TEST_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? 'postgresql://revolution@127.0.0.1:55432/revolution';

export function validateLoopbackPostgresUrl(connectionString: string): URL {
  const url = new URL(connectionString);
  const hostname = url.hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
    throw new Error(`PostgreSQL test databases require a loopback host; received ${hostname}.`);
  }
  return url;
}

const adminConnectionString = validateLoopbackPostgresUrl(
  configuredAdminConnectionString,
).toString();

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseUrl(databaseName: string): string {
  const url = new URL(adminConnectionString);
  url.pathname = `/${databaseName}`;
  return validateLoopbackPostgresUrl(url.toString()).toString();
}

export interface DisposablePostgresDatabase {
  connectionString: string;
  name: string;
  dispose(): Promise<void>;
}

export async function createDisposablePostgresDatabase(): Promise<DisposablePostgresDatabase> {
  const name = `revolution_s10_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ connectionString: adminConnectionString });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } finally {
    await admin.end();
  }

  let disposed = false;
  return {
    connectionString: databaseUrl(name),
    name,
    async dispose() {
      if (disposed) return;
      if (!/^revolution_s10_[0-9a-f]{32}$/.test(name)) {
        throw new Error(`Refusing to drop an unowned test database: ${name}`);
      }
      const cleanup = new Client({ connectionString: adminConnectionString });
      await cleanup.connect();
      try {
        const drainDeadline = Date.now() + 5_000;
        while (Date.now() < drainDeadline) {
          const sessions = await cleanup.query<{ count: number }>(
            `SELECT count(*)::integer AS count
               FROM pg_stat_activity
              WHERE datname = $1 AND backend_type = 'client backend'`,
            [name],
          );
          if (sessions.rows[0].count === 0) break;
          await delay(25);
        }
        await cleanup.query(`DROP DATABASE ${quoteIdentifier(name)} WITH (FORCE)`);
        disposed = true;
      } finally {
        await cleanup.end();
      }
    },
  };
}

export async function withPostgresClient<T>(
  connectionString: string,
  run: (client: InstanceType<typeof Client>) => Promise<T>,
): Promise<T> {
  const safeConnectionString = validateLoopbackPostgresUrl(connectionString).toString();
  const client = new Client({ connectionString: safeConnectionString });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}
