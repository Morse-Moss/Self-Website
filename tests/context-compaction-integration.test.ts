import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

import pg from 'pg';

import {
  completeHistorySummaryAttempt,
  findReusableHistoryCompaction,
  startHistorySummaryAttempt,
  terminateHistorySummaryAttempt,
  type CompactionReuseKey,
  type StartHistorySummaryAttemptInput,
} from '../lib/server/chat-history-compaction.ts';
import {
  createDisposablePostgresDatabase,
  withPostgresClient,
} from './postgres-test-utils.ts';

const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const migrationSourceDirectory = path.join(repoRoot, 'db', 'migrations');

function runMigrations(connectionString: string, migrationsDirectory?: string) {
  return new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve, reject) => {
    const env = { ...process.env, DATABASE_URL: connectionString };
    if (migrationsDirectory) env.MORSE_MIGRATIONS_DIR = migrationsDirectory;
    else delete env.MORSE_MIGRATIONS_DIR;
    const child = spawn(process.execPath, [migrationRunner], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr, stdout }));
  });
}

async function migrationsThrough012(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'revolution-dynamic-context-'));
  const entries = await fs.readdir(migrationSourceDirectory, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile()
      && /^\d{3}_.+\.sql$/u.test(entry.name)
      && entry.name.slice(0, 3) <= '012')
    .map((entry) => fs.copyFile(
      path.join(migrationSourceDirectory, entry.name),
      path.join(directory, entry.name),
    )));
  return directory;
}

function constraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && error.code === '23514';
}

async function insertCoreFixture(client: {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}) {
  const inviteId = randomUUID();
  const sessionId = randomUUID();
  const conversationId = randomUUID();
  const turnId = randomUUID();
  await client.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES ($1, $2, 'dynamic context fixture', true, now() + interval '30 days', 5, 1)`,
    [inviteId, randomUUID().replaceAll('-', '').repeat(2)],
  );
  await client.query(
    `INSERT INTO access_sessions
      (id, invite_code_id, token_hash, expires_at, message_count)
     VALUES ($1, $2, $3, now() + interval '30 days', 0)`,
    [sessionId, inviteId, randomUUID().replaceAll('-', '').repeat(2)],
  );
  await client.query(
    `INSERT INTO conversations
      (id, access_session_id, mode, workflow, audience_intent, expires_at)
     VALUES ($1, $2, 'general', 'chat', 'general', now() + interval '30 days')`,
    [conversationId, sessionId],
  );
  await client.query(
    `INSERT INTO interaction_turns
      (id, access_session_id, conversation_id, workflow, audience_intent,
       question, status, created_at, completed_at, delete_after,
       execution_pipeline)
     VALUES ($1, $2, $3, 'chat', 'general', 'dynamic context fixture',
       'completed', now(), now(), now() + interval '10 days', 'legacy_v1')`,
    [turnId, sessionId, conversationId],
  );
  return { conversationId, inviteId, sessionId, turnId };
}

async function insertV1ProviderConfiguration(client: {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}) {
  const connectionId = randomUUID();
  const modelId = randomUUID();
  const routeId = randomUUID();
  const takeoverId = randomUUID();
  const digests = {
    connection: 'a'.repeat(64),
    model: 'b'.repeat(64),
    route: 'c'.repeat(64),
    takeover: 'd'.repeat(64),
  };
  await client.query(
    `INSERT INTO ai_connections
      (id, series_id, version, display_name, base_url, api_key_ciphertext,
       api_key_iv, api_key_tag, key_version, config_digest)
     VALUES ($1, $2, 1, 'V1 connection', 'https://provider.example/v1',
       decode('aa', 'hex'), decode(repeat('01', 12), 'hex'),
       decode(repeat('02', 16), 'hex'), 1, $3)`,
    [connectionId, randomUUID(), digests.connection],
  );
  await client.query(
    `INSERT INTO ai_model_presets
      (id, series_id, version, connection_version_id, display_name, model_id,
       protocol, reasoning_effort, max_output_tokens, config_digest)
     VALUES ($1, $2, 1, $3, 'V1 model', 'gpt-v1', 'responses', 'high', 1200, $4)`,
    [modelId, randomUUID(), connectionId, digests.model],
  );
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO ai_route_revisions
        (id, revision_number, activation_kind, activated_at)
       VALUES ($1, 1, 'bootstrap', now())`,
      [routeId],
    );
    await client.query(
      `INSERT INTO ai_route_targets
        (route_revision_id, position, source_type, database_model_version_id,
         connection_display_name, model_display_name, model_id, protocol, config_digest)
       VALUES ($1, 0, 'database', $2, 'V1 connection', 'V1 model',
         'gpt-v1', 'responses', $3)`,
      [routeId, modelId, digests.route],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  await client.query(
    `INSERT INTO ai_environment_takeovers
      (id, request_id, environment_target_key, source_config_digest,
       initial_connection_version_id, initial_model_version_id)
     VALUES ($1, $2, 'primary', $3, $4, $5)`,
    [takeoverId, randomUUID(), digests.takeover, connectionId, modelId],
  );
  return { digests, modelId, routeId, takeoverId };
}

interface SummaryIdentity {
  attemptId: string;
  callIndex: number;
  conversationId: string;
  ownerPipeline: 'legacy_v1';
  scopeId: string | null;
  sourceTurnId: string;
  sourceTurnSha256: string;
  variantId: string;
}

function summaryIdentity(conversationId: string, callIndex = 0): SummaryIdentity {
  return {
    attemptId: randomUUID(),
    callIndex,
    conversationId,
    ownerPipeline: 'legacy_v1',
    scopeId: null,
    sourceTurnId: randomUUID(),
    sourceTurnSha256: 'e'.repeat(64),
    variantId: randomUUID(),
  };
}

async function insertStartedSummaryAttempt(
  client: { query(sql: string, values?: readonly unknown[]): Promise<unknown> },
  identity: SummaryIdentity,
  interactionTurnId: string,
  startedAtExpression = 'now()',
) {
  await client.query(
    `INSERT INTO chat_history_summary_attempts
      (id, conversation_id, interaction_turn_id, context_scope_id, owner_pipeline,
       call_index, generation_variant_id, generation_variant_revision,
       trigger_reason, summary_instruction_version, source_turn_ids,
       source_turn_sha256, target_config_digest_version, target_config_digest,
       target_model_id, target_protocol, target_context_window_tokens,
       target_max_output_tokens, target_reasoning_effort,
       summary_request_hmac_key_id, summary_request_hmac_sha256,
       status, started_at, delete_after)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,'numeric_preflight','task-history-summary-v1',
       ARRAY[$8]::uuid[],$9,1,$10,'gpt-v1','responses',128000,NULL,'high',
       'context-key-v1',$11,'started',${startedAtExpression},
       ${startedAtExpression} + interval '10 days')`,
    [
      identity.attemptId,
      identity.conversationId,
      interactionTurnId,
      identity.scopeId,
      identity.ownerPipeline,
      identity.callIndex,
      identity.variantId,
      identity.sourceTurnId,
      identity.sourceTurnSha256,
      'f'.repeat(64),
      '1'.repeat(64),
    ],
  );
}

async function completeSummaryAttempt(
  client: { query(sql: string, values?: readonly unknown[]): Promise<unknown> },
  attemptId: string,
) {
  await client.query(
    `UPDATE chat_history_summary_attempts
        SET status = 'completed', input_tokens = 100, output_tokens = 20,
            completed_at = started_at + interval '1 minute'
      WHERE id = $1`,
    [attemptId],
  );
}

async function insertCompaction(
  client: { query(sql: string, values?: readonly unknown[]): Promise<unknown> },
  identity: SummaryIdentity,
  createdAtExpression = 'now()',
) {
  const compactionId = randomUUID();
  await client.query(
    `INSERT INTO conversation_history_compactions
      (id, conversation_id, context_scope_id, owner_pipeline, source_turn_ids,
       source_turn_sha256, summary_text, summary_attempt_id, trigger_reason,
       summary_instruction_version, target_config_digest_version,
       target_config_digest, target_model_id, target_protocol,
       target_context_window_tokens, target_max_output_tokens,
       target_reasoning_effort, generation_variant_id,
       generation_variant_revision, created_at, delete_after)
     VALUES ($1,$2,$3,$4,ARRAY[$5]::uuid[],$6,'private summary',$7,
       'numeric_preflight','task-history-summary-v1',1,$8,'gpt-v1','responses',
       128000,NULL,'high',$9,1,${createdAtExpression},
       ${createdAtExpression} + interval '10 days')`,
    [
      compactionId,
      identity.conversationId,
      identity.scopeId,
      identity.ownerPipeline,
      identity.sourceTurnId,
      identity.sourceTurnSha256,
      identity.attemptId,
      'f'.repeat(64),
      identity.variantId,
    ],
  );
  return compactionId;
}

test('migration 013 upgrades active v1 configuration byte-for-byte and is repeatable', async () => {
  const database = await createDisposablePostgresDatabase();
  const through012 = await migrationsThrough012();
  try {
    const initial = await runMigrations(database.connectionString, through012);
    assert.equal(initial.code, 0, initial.stderr);
    const seeded = await withPostgresClient(database.connectionString, insertV1ProviderConfiguration);
    await withPostgresClient(database.connectionString, async (client) => {
      const absent = await client.query<{ compactions: string | null; version_columns: number }>(
        `SELECT to_regclass('public.conversation_history_compactions')::text AS compactions,
                (SELECT count(*)::integer FROM information_schema.columns
                  WHERE table_schema = 'public'
                    AND column_name IN ('config_digest_version','context_window_tokens')) AS version_columns`,
      );
      assert.deepEqual(absent.rows, [{ compactions: null, version_columns: 0 }]);
    });

    const upgraded = await runMigrations(database.connectionString);
    assert.equal(upgraded.code, 0, upgraded.stderr);
    assert.match(upgraded.stdout, /Migration 013 applied/u);
    await withPostgresClient(database.connectionString, async (client) => {
      const registry = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      );
      assert.equal(registry.rows.at(-1)?.version, '013');
      const preserved = await client.query<{
        model_digest: string;
        model_digest_version: number;
        route_digest: string;
        route_digest_version: number;
        takeover_digest: string;
        takeover_digest_version: number;
      }>(
        `SELECT model.config_digest AS model_digest,
                model.config_digest_version::integer AS model_digest_version,
                target.config_digest AS route_digest,
                target.config_digest_version::integer AS route_digest_version,
                takeover.source_config_digest AS takeover_digest,
                takeover.source_config_digest_version::integer AS takeover_digest_version
           FROM ai_model_presets AS model
           JOIN ai_route_targets AS target ON target.database_model_version_id = model.id
           JOIN ai_environment_takeovers AS takeover
             ON takeover.initial_model_version_id = model.id
          WHERE model.id = $1 AND target.route_revision_id = $2 AND takeover.id = $3`,
        [seeded.modelId, seeded.routeId, seeded.takeoverId],
      );
      assert.deepEqual(preserved.rows, [{
        model_digest: seeded.digests.model,
        model_digest_version: 1,
        route_digest: seeded.digests.route,
        route_digest_version: 1,
        takeover_digest: seeded.digests.takeover,
        takeover_digest_version: 1,
      }]);
      const nullableOutput = await client.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'ai_model_presets'
            AND column_name = 'max_output_tokens'`,
      );
      assert.deepEqual(nullableOutput.rows, [{ is_nullable: 'YES' }]);

      for (const statement of [
        `UPDATE ai_model_presets SET context_window_tokens = 128000 WHERE id = $1`,
        `UPDATE ai_model_presets SET max_output_tokens = NULL WHERE id = $1`,
        `UPDATE ai_model_presets SET config_digest_version = 2 WHERE id = $1`,
      ]) {
        await assert.rejects(client.query(statement, [seeded.modelId]), constraintViolation);
      }
      await assert.rejects(
        client.query(
          `UPDATE ai_environment_takeovers
              SET source_config_digest_version = 2 WHERE id = $1`,
          [seeded.takeoverId],
        ),
        constraintViolation,
      );
    });

    const repeated = await runMigrations(database.connectionString);
    assert.equal(repeated.code, 0, repeated.stderr);
    assert.doesNotMatch(repeated.stdout, /Migration 013 applied/u);
    assert.match(repeated.stdout, /current through 013/u);
  } finally {
    await fs.rm(through012, { recursive: true, force: true });
    await database.dispose();
  }
});

test('migration 013 permits one overflow retry without expanding route positions', async () => {
  const database = await createDisposablePostgresDatabase();
  try {
    const migrated = await runMigrations(database.connectionString);
    assert.equal(migrated.code, 0, migrated.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      const fixture = await insertCoreFixture(client);
      await client.query(
        `INSERT INTO interaction_provider_attempts
          (interaction_turn_id, attempt_index, source_type, connection_display_name,
           model_display_name, model_id, protocol, config_digest, status,
           launch_kind, completed_at)
         VALUES ($1,6,'environment','Environment','Environment model','gpt-v1',
           'responses',$2,'completed','overflow_retry',now())`,
        [fixture.turnId, '2'.repeat(64)],
      );
      await client.query(
        `INSERT INTO usage_events
          (provider, model, input_tokens, output_tokens, estimated_cost_usd,
           interaction_turn_id, provider_attempt_index, cost_complete)
         VALUES ('openai-compatible','gpt-v1',10,5,NULL,$1,6,false)`,
        [fixture.turnId],
      );
      await assert.rejects(
        client.query(
          `INSERT INTO interaction_provider_attempts
            (interaction_turn_id, attempt_index, source_type, connection_display_name,
             model_display_name, model_id, protocol, config_digest, status, completed_at)
           VALUES ($1,7,'environment','Environment','Environment model','gpt-v1',
             'responses',$2,'completed',now())`,
          [fixture.turnId, '3'.repeat(64)],
        ),
        constraintViolation,
      );

      await client.query(
        `INSERT INTO chat_provider_attempts
          (interaction_turn_id, execution_id, attempt_no, provider_alias,
           launch_kind, status, start_delay_ms, started_at, completed_at, delete_after)
         VALUES ($1,$2,7,'primary','overflow_retry','completed',0,now(),now(),
           now() + interval '10 days')`,
        [fixture.turnId, randomUUID()],
      );
      await assert.rejects(
        client.query(
          `INSERT INTO chat_provider_attempts
            (interaction_turn_id, execution_id, attempt_no, provider_alias,
             launch_kind, status, start_delay_ms, started_at, completed_at, delete_after)
           VALUES ($1,$2,8,'primary','overflow_retry','completed',0,now(),now(),
             now() + interval '10 days')`,
          [fixture.turnId, randomUUID()],
        ),
        constraintViolation,
      );

      const routeId = randomUUID();
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO ai_route_revisions
            (id, revision_number, activation_kind, activated_at)
           VALUES ($1,99,'activate',now())`,
          [routeId],
        );
        for (let position = 0; position <= 5; position += 1) {
          await client.query(
            `INSERT INTO ai_route_targets
              (route_revision_id, position, source_type, environment_target_key,
               connection_display_name, model_display_name, model_id, protocol,
               config_digest)
             VALUES ($1,$2,'environment','primary','Environment','Model',
               'gpt-v1','responses',$3)`,
            [routeId, position, position.toString(16).padStart(64, '0')],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      await assert.rejects(
        client.query(
          `INSERT INTO ai_route_targets
            (route_revision_id, position, source_type, environment_target_key,
             connection_display_name, model_display_name, model_id, protocol,
             config_digest)
           VALUES ($1,6,'environment','primary','Environment','Model',
             'gpt-v1','responses',$2)`,
          [routeId, '9'.repeat(64)],
        ),
        constraintViolation,
      );

      const legacyTurnId = randomUUID();
      const user = await client.query<{ id: string }>(
        `INSERT INTO conversation_messages (conversation_id, role, content)
         VALUES ($1,'user',$2) RETURNING id::text`,
        [fixture.conversationId, `morse-turn-v1:${JSON.stringify({ turnId: legacyTurnId, content: 'user' })}`],
      );
      const assistant = await client.query<{ id: string }>(
        `INSERT INTO conversation_messages (conversation_id, role, content)
         VALUES ($1,'assistant',$2) RETURNING id::text`,
        [fixture.conversationId, `morse-turn-v1:${JSON.stringify({ turnId: legacyTurnId, content: 'assistant' })}`],
      );
      await client.query(
        `INSERT INTO conversation_context_legacy_bridge_turns
          (conversation_id, ordinal, legacy_turn_id, user_message_id,
           assistant_message_id, captured_at)
         VALUES ($1,6,$2,$3,$4,now())`,
        [fixture.conversationId, legacyTurnId, user.rows[0].id, assistant.rows[0].id],
      );
    });
  } finally {
    await database.dispose();
  }
});

test('migration 013 enforces private append-only compactions, cleanup ordering and privacy purge', async () => {
  const database = await createDisposablePostgresDatabase();
  try {
    const migrated = await runMigrations(database.connectionString);
    assert.equal(migrated.code, 0, migrated.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      const fixture = await insertCoreFixture(client);
      const current = summaryIdentity(fixture.conversationId);
      await assert.rejects(
        client.query(
          `INSERT INTO chat_history_summary_attempts
            (id, conversation_id, interaction_turn_id, owner_pipeline, call_index,
             generation_variant_id, generation_variant_revision, trigger_reason,
             summary_instruction_version, source_turn_ids, source_turn_sha256,
             target_config_digest_version, target_config_digest, target_model_id,
             target_protocol, target_context_window_tokens,
             summary_request_hmac_key_id, summary_request_hmac_sha256,
             status, started_at, completed_at, delete_after)
           VALUES ($1,$2,$3,'legacy_v1',0,$4,1,'numeric_preflight',
             'task-history-summary-v1',ARRAY[$5]::uuid[],$6,1,$7,'gpt-v1',
             'responses',128000,'context-key-v1',$8,'completed',now(),now(),
             now() + interval '10 days')`,
          [
            current.attemptId,
            fixture.conversationId,
            fixture.turnId,
            current.variantId,
            current.sourceTurnId,
            current.sourceTurnSha256,
            'f'.repeat(64),
            '1'.repeat(64),
          ],
        ),
        constraintViolation,
      );

      await insertStartedSummaryAttempt(client, current, fixture.turnId);
      await assert.rejects(insertCompaction(client, current), constraintViolation);
      await completeSummaryAttempt(client, current.attemptId);
      const currentCompactionId = await insertCompaction(client, current);
      await assert.rejects(
        client.query(
          `UPDATE conversation_history_compactions
              SET summary_text = 'rewritten' WHERE id = $1`,
          [currentCompactionId],
        ),
        constraintViolation,
      );
      await assert.rejects(
        client.query('DELETE FROM conversation_history_compactions WHERE id = $1', [currentCompactionId]),
        constraintViolation,
      );
      await assert.rejects(
        client.query(
          `UPDATE chat_history_summary_attempts
              SET output_tokens = output_tokens + 1 WHERE id = $1`,
          [current.attemptId],
        ),
        constraintViolation,
      );

      const laterArtifact = summaryIdentity(fixture.conversationId, 1);
      await insertStartedSummaryAttempt(
        client,
        laterArtifact,
        fixture.turnId,
        "now() - interval '11 days'",
      );
      await completeSummaryAttempt(client, laterArtifact.attemptId);
      await insertCompaction(client, laterArtifact, "now() - interval '9 days'");

      const expired = summaryIdentity(fixture.conversationId, 2);
      await insertStartedSummaryAttempt(
        client,
        expired,
        fixture.turnId,
        "now() - interval '12 days'",
      );
      await completeSummaryAttempt(client, expired.attemptId);
      await insertCompaction(client, expired, "now() - interval '11 days'");

      const cleanup = await client.query<{
        deleted_attempts: string;
        deleted_compactions: string;
      }>('SELECT deleted_compactions::text, deleted_attempts::text FROM cleanup_expired_chat_history_compactions()');
      assert.deepEqual(cleanup.rows, [{ deleted_attempts: '1', deleted_compactions: '1' }]);
      const retained = await client.query<{ attempts: number; compactions: number }>(
        `SELECT
          (SELECT count(*)::integer FROM chat_history_summary_attempts
            WHERE id = $1) AS attempts,
          (SELECT count(*)::integer FROM conversation_history_compactions
            WHERE summary_attempt_id = $1) AS compactions`,
        [laterArtifact.attemptId],
      );
      assert.deepEqual(retained.rows, [{ attempts: 1, compactions: 1 }]);

      const functionAcl = await client.query<{ public_execute: boolean }>(
        `SELECT has_function_privilege('public',
          'public.purge_chat_session_for_privacy(uuid)', 'EXECUTE') AS public_execute`,
      );
      assert.deepEqual(functionAcl.rows, [{ public_execute: false }]);
      const purged = await client.query<{
        deleted_access_sessions: string;
        deleted_interaction_turns: string;
      }>(
        `SELECT deleted_access_sessions::text, deleted_interaction_turns::text
           FROM purge_chat_session_for_privacy($1)`,
        [fixture.sessionId],
      );
      assert.deepEqual(purged.rows, [{
        deleted_access_sessions: '1',
        deleted_interaction_turns: '1',
      }]);
      const privateRows = await client.query<{ attempts: number; compactions: number }>(
        `SELECT
          (SELECT count(*)::integer FROM chat_history_summary_attempts) AS attempts,
          (SELECT count(*)::integer FROM conversation_history_compactions) AS compactions`,
      );
      assert.deepEqual(privateRows.rows, [{ attempts: 0, compactions: 0 }]);
    });
  } finally {
    await database.dispose();
  }
});

test('history compaction store commits artifacts independently and reuses only exact identities', async () => {
  const database = await createDisposablePostgresDatabase();
  const pool = new pg.Pool({ connectionString: database.connectionString });
  try {
    const migrated = await runMigrations(database.connectionString);
    assert.equal(migrated.code, 0, migrated.stderr);
    const fixture = await withPostgresClient(database.connectionString, insertCoreFixture);
    const sourceTurnIds = [randomUUID(), randomUUID()];
    const target = {
      configDigestVersion: 2 as const,
      configDigest: 'a'.repeat(64),
      modelId: 'gpt-dynamic',
      protocol: 'responses' as const,
      contextWindowTokens: 128_000,
      maxOutputTokens: null,
      reasoningEffort: 'high' as const,
    };
    const baseAttempt: StartHistorySummaryAttemptInput = {
      conversationId: fixture.conversationId,
      interactionTurnId: fixture.turnId,
      contextScopeId: null,
      ownerPipeline: 'legacy_v1',
      callIndex: 0,
      generationVariantId: randomUUID(),
      generationVariantRevision: 1,
      previousCompactionId: null,
      triggerReason: 'numeric_preflight',
      summaryInstructionVersion: 'task-history-summary-v1',
      sourceTurnIds,
      sourceTurnSha256: '1'.repeat(64),
      target,
      summaryRequestHmacKeyId: 'context-key-v2',
      summaryRequestHmacSha256: '2'.repeat(64),
      startedAt: new Date('2026-07-28T01:00:00.000Z'),
    };

    const attemptId = await startHistorySummaryAttempt(pool, baseAttempt);
    const artifact = await completeHistorySummaryAttempt(pool, {
      summaryAttemptId: attemptId,
      summaryText: 'private durable summary',
      inputTokens: 120,
      outputTokens: 18,
      completedAt: new Date('2026-07-28T01:01:00.000Z'),
    });
    assert.equal(artifact.summaryAttemptId, attemptId);
    assert.equal(artifact.summaryText, 'private durable summary');
    assert.deepEqual(artifact.sourceTurnIds, sourceTurnIds);
    assert.deepEqual(artifact.target, target);

    const reuseKey: CompactionReuseKey = {
      conversationId: fixture.conversationId,
      contextScopeId: null,
      ownerPipeline: 'legacy_v1',
      sourceTurnIds,
      sourceTurnSha256: '1'.repeat(64),
      target,
      summaryInstructionVersion: 'task-history-summary-v1',
    };
    assert.equal((await findReusableHistoryCompaction(pool, reuseKey))?.id, artifact.id);

    const mismatches: CompactionReuseKey[] = [
      { ...reuseKey, sourceTurnIds: [...sourceTurnIds].reverse() },
      { ...reuseKey, sourceTurnSha256: '3'.repeat(64) },
      { ...reuseKey, summaryInstructionVersion: 'task-history-summary-v2' },
      { ...reuseKey, target: { ...target, configDigestVersion: 1 } },
      { ...reuseKey, target: { ...target, configDigest: '4'.repeat(64) } },
      { ...reuseKey, target: { ...target, modelId: 'gpt-other' } },
      { ...reuseKey, target: { ...target, protocol: 'chat_completions' } },
      { ...reuseKey, target: { ...target, contextWindowTokens: 64_000 } },
      { ...reuseKey, target: { ...target, maxOutputTokens: 2_000 } },
      { ...reuseKey, target: { ...target, reasoningEffort: 'medium' } },
    ];
    for (const mismatch of mismatches) {
      assert.equal(await findReusableHistoryCompaction(pool, mismatch), null);
    }

    await withPostgresClient(database.connectionString, async (client) => {
      await client.query('BEGIN');
      await client.query(
        'UPDATE interaction_turns SET status = $2 WHERE id = $1',
        [fixture.turnId, 'failed'],
      );
      await client.query('ROLLBACK');
    });
    assert.equal((await findReusableHistoryCompaction(pool, reuseKey))?.id, artifact.id);

    for (const [index, status] of (['failed', 'cancelled'] as const).entries()) {
      const terminalAttemptId = await startHistorySummaryAttempt(pool, {
        ...baseAttempt,
        callIndex: index + 1,
        generationVariantRevision: index + 2,
        generationVariantId: randomUUID(),
        sourceTurnIds: [randomUUID()],
        sourceTurnSha256: String(index + 5).repeat(64),
        startedAt: new Date(`2026-07-28T01:0${index + 2}:00.000Z`),
      });
      await terminateHistorySummaryAttempt(pool, {
        summaryAttemptId: terminalAttemptId,
        status,
        errorCode: status === 'failed' ? 'UPSTREAM_FAILED' : 'CANCELLED',
        inputTokens: null,
        outputTokens: null,
        completedAt: new Date(`2026-07-28T01:1${index}:00.000Z`),
      });
    }

    const terminalRows = await pool.query<{
      artifact_count: number;
      call_index: number;
      status: string;
    }>(
      `SELECT attempt.call_index,
              attempt.status,
              count(artifact.id)::integer AS artifact_count
         FROM chat_history_summary_attempts AS attempt
         LEFT JOIN conversation_history_compactions AS artifact
           ON artifact.summary_attempt_id = attempt.id
        WHERE attempt.interaction_turn_id = $1
        GROUP BY attempt.call_index, attempt.status
        ORDER BY attempt.call_index`,
      [fixture.turnId],
    );
    assert.deepEqual(terminalRows.rows, [
      { artifact_count: 1, call_index: 0, status: 'completed' },
      { artifact_count: 0, call_index: 1, status: 'failed' },
      { artifact_count: 0, call_index: 2, status: 'cancelled' },
    ]);
  } finally {
    await pool.end();
    await database.dispose();
  }
});
