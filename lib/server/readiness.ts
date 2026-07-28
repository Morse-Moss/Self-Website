import { loadAdminConfig, loadInviteAbuseConfig, loadServerConfig } from './config.ts';
import { getPool } from './db.ts';
import {
  readMigrationManifest,
  type MigrationManifestEntry,
} from './migration-manifest.ts';
import { validateProductionRole } from './production-config.ts';
import { resolveProviderRuntime } from './provider-runtime.ts';
import { loadResumeConfig } from './resume-config.ts';

type Env = Record<string, string | undefined>;
interface QueryPool {
  query(sql: string): Promise<{ rows: unknown[] }>;
}

export type ReadinessErrorCode =
  | 'READINESS_RUNTIME_INVALID'
  | 'READINESS_DATABASE_UNAVAILABLE'
  | 'READINESS_MIGRATIONS_INCOMPLETE'
  | 'READINESS_KNOWLEDGE_EMPTY'
  | 'READINESS_AI_CONFIG_UNAVAILABLE'
  | 'READINESS_DYNAMIC_CONTEXT_UNAVAILABLE';

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

function schema012Manifest(expected: MigrationManifestEntry[]): MigrationManifestEntry[] {
  return expected.filter((entry) => BigInt(entry.version) <= 12n);
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
      loadResumeConfig(env);
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
  const dynamicProviderContextEnabled = env.MORSE_DYNAMIC_PROVIDER_CONTEXT_ENABLED?.trim() === 'true';
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
    const actualMigrations = migrations.rows as MigrationManifestEntry[];
    const current = manifestsMatch(actualMigrations, expectedMigrations);
    const schema012 = manifestsMatch(actualMigrations, schema012Manifest(expectedMigrations));
    if (dynamicProviderContextEnabled && !current) {
      if (schema012) throw new ReadinessError('READINESS_DYNAMIC_CONTEXT_UNAVAILABLE');
      throw new ReadinessError('READINESS_MIGRATIONS_INCOMPLETE');
    }
    if (!dynamicProviderContextEnabled && !current && !schema012) {
      throw new ReadinessError('READINESS_MIGRATIONS_INCOMPLETE');
    }
    const knowledge = await pool.query(
      'SELECT EXISTS (SELECT 1 FROM knowledge_chunks LIMIT 1) AS present',
    );
    if ((knowledge.rows[0] as { present?: unknown } | undefined)?.present !== true) {
      throw new ReadinessError('READINESS_KNOWLEDGE_EMPTY');
    }
    const runtimeState = await pool.query(
      `SELECT id, active_route_revision_id
         FROM ai_runtime_state
        WHERE id = true`,
    );
    if (
      runtimeState.rows.length !== 1
      || (runtimeState.rows[0] as { id?: unknown }).id !== true
    ) {
      throw new ReadinessError('READINESS_AI_CONFIG_UNAVAILABLE');
    }
    try {
      const configuration = await pool.query(
        `SELECT
           (SELECT count(*) FROM ai_connections) >= 0 AS connections_readable,
           (SELECT count(*) FROM ai_model_presets) >= 0 AS models_readable,
           (SELECT count(*) FROM ai_route_revisions) >= 0 AS routes_readable,
           (SELECT count(*) FROM ai_environment_takeovers) >= 0 AS takeovers_readable,
           (SELECT count(*) FROM ai_route_targets) >= 0 AS targets_readable`,
      );
      const row = configuration.rows[0] as Record<string, unknown> | undefined;
      if (!row || Object.values(row).some((value) => value !== true)) {
        throw new ReadinessError('READINESS_AI_CONFIG_UNAVAILABLE');
      }
    } catch (error) {
      if (error instanceof ReadinessError) throw error;
      throw new ReadinessError('READINESS_AI_CONFIG_UNAVAILABLE');
    }
    if (dynamicProviderContextEnabled) {
      try {
        const dynamicContext = await pool.query(
          `SELECT
             to_regclass('public.conversation_history_compactions') IS NOT NULL
             AND to_regclass('public.chat_history_summary_attempts') IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'ai_model_presets'
                  AND column_name = 'context_window_tokens'
             )
             AND EXISTS (
               SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'ai_route_targets'
                  AND column_name = 'config_digest_version'
             )
             AND has_table_privilege(current_user, 'conversation_history_compactions', 'SELECT')
             AND has_table_privilege(current_user, 'conversation_history_compactions', 'INSERT')
             AND NOT has_table_privilege(current_user, 'conversation_history_compactions', 'UPDATE')
             AND NOT has_table_privilege(current_user, 'conversation_history_compactions', 'DELETE')
             AS dynamic_context_ready`,
        );
        const ready = dynamicContext.rows[0] as { dynamic_context_ready?: unknown } | undefined;
        if (ready?.dynamic_context_ready !== true) {
          throw new ReadinessError('READINESS_DYNAMIC_CONTEXT_UNAVAILABLE');
        }
      } catch (error) {
        if (error instanceof ReadinessError) throw error;
        throw new ReadinessError('READINESS_DYNAMIC_CONTEXT_UNAVAILABLE');
      }
    }
    try {
      await resolveProviderRuntime(
        pool as Parameters<typeof resolveProviderRuntime>[0],
        loadServerConfig(env),
        { env },
      );
    } catch {
      throw new ReadinessError('READINESS_AI_CONFIG_UNAVAILABLE');
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
