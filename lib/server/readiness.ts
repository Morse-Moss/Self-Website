import { loadAdminConfig, loadInviteAbuseConfig, loadServerConfig } from './config.ts';
import { getPool } from './db.ts';
import {
  readMigrationManifest,
  type MigrationManifestEntry,
} from './migration-manifest.ts';
import { validateProductionRole } from './production-config.ts';

type Env = Record<string, string | undefined>;
interface QueryPool {
  query(sql: string): Promise<{ rows: unknown[] }>;
}

export type ReadinessErrorCode =
  | 'READINESS_RUNTIME_INVALID'
  | 'READINESS_DATABASE_UNAVAILABLE'
  | 'READINESS_MIGRATIONS_INCOMPLETE'
  | 'READINESS_KNOWLEDGE_EMPTY';

export class ReadinessError extends Error {
  readonly code: ReadinessErrorCode;

  constructor(code: ReadinessErrorCode) {
    super(code);
    this.name = 'ReadinessError';
    this.code = code;
  }
}

function manifestsMatch(
  actual: MigrationManifestEntry[],
  expected: MigrationManifestEntry[],
): boolean {
  return actual.length === expected.length && actual.every((entry, index) => (
    entry.version === expected[index].version
    && entry.checksum === expected[index].checksum
  ));
}

function validateRuntime(env: Env): void {
  try {
    let localRelease = false;
    try {
      const origin = new URL(env.MORSE_PUBLIC_ORIGIN?.trim() ?? '');
      localRelease = env.MORSE_LOCAL_RELEASE_SMOKE?.trim() === 'true'
        && origin.protocol === 'http:'
        && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(origin.hostname)
        && origin.pathname === '/'
        && !origin.username
        && !origin.password
        && !origin.search
        && !origin.hash;
    } catch {
      localRelease = false;
    }
    if (env.NODE_ENV === 'production' && !localRelease) {
      validateProductionRole('web', env);
    } else {
      loadServerConfig(env);
      loadAdminConfig(env);
      loadInviteAbuseConfig(env);
    }
  } catch {
    throw new ReadinessError('READINESS_RUNTIME_INVALID');
  }
}

export interface ReadinessInput {
  env?: Env;
  expectedMigrations?: MigrationManifestEntry[];
  pool?: QueryPool;
}

export async function assertApplicationReady(input: ReadinessInput = {}): Promise<void> {
  const env = input.env ?? process.env;
  validateRuntime(env);
  let expectedMigrations: MigrationManifestEntry[];
  try {
    expectedMigrations = input.expectedMigrations ?? await readMigrationManifest();
  } catch {
    throw new ReadinessError('READINESS_MIGRATIONS_INCOMPLETE');
  }
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) throw new ReadinessError('READINESS_RUNTIME_INVALID');
  const pool = input.pool ?? getPool(connectionString) as unknown as QueryPool;
  try {
    const migrations = await pool.query(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    if (!manifestsMatch(migrations.rows as MigrationManifestEntry[], expectedMigrations)) {
      throw new ReadinessError('READINESS_MIGRATIONS_INCOMPLETE');
    }
    const knowledge = await pool.query(
      'SELECT EXISTS (SELECT 1 FROM knowledge_chunks LIMIT 1) AS present',
    );
    if ((knowledge.rows[0] as { present?: unknown } | undefined)?.present !== true) {
      throw new ReadinessError('READINESS_KNOWLEDGE_EMPTY');
    }
  } catch (error) {
    if (error instanceof ReadinessError) throw error;
    throw new ReadinessError('READINESS_DATABASE_UNAVAILABLE');
  }
}

export async function readinessResponse(): Promise<Response> {
  try {
    await assertApplicationReady();
    return Response.json({ ok: true }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json({ ok: false }, {
      headers: { 'Cache-Control': 'no-store' },
      status: 503,
    });
  }
}
