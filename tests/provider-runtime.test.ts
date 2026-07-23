import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';

import pg from 'pg';

import { createConnectionWithModel } from '../lib/server/ai-config-store.ts';
import { createRuntimeConfigDigest } from '../lib/server/ai-config.ts';
import {
  ProviderRunError,
  type AiProvider,
  type AnswerEvent,
  type AnswerRequest,
  type ProviderAttempt,
} from '../lib/server/ai-provider.ts';
import { runChat, type ChatServiceConfig } from '../lib/server/chat-service.ts';
import { providerAttemptsMatch } from '../lib/server/interaction-log.ts';
import { resolveProviderRuntime } from '../lib/server/provider-runtime.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const key = Buffer.alloc(32, 29);
const runtimeNow = new Date('2026-07-21T04:00:00.000Z');

async function migrate(connectionString: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [migrationRunner], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `migration exited ${code}`));
    });
  });
}

const environmentConfig = {
  openaiApiKey: 'env-primary-key',
  openaiBaseUrl: 'https://primary.example/v1',
  openaiUserAgent: 'Morse-Test/1.0',
  openaiFallbacks: [
    { apiKey: 'env-fallback-key', baseUrl: 'https://fallback.example/v1' },
  ],
  chatModel: 'gpt-environment',
  chatProtocol: 'responses' as const,
  reasoningEffort: 'high' as const,
  maxOutputTokens: 600,
  tokenRates: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
  embeddingApiKey: 'embedding-key',
  embeddingBaseUrl: 'https://embedding.example/v1',
  embeddingModel: 'embedding-model',
  embeddingDimensions: 512,
  embeddingTimeoutMs: 8_000,
  providerFirstByteTimeoutMs: 20_000,
  providerTotalTimeoutMs: 90_000,
  providerConcurrency: 4,
};

const chatServiceConfig: ChatServiceConfig = {
  maxMessagesPerSession: 2,
  historyMessageLimit: 12,
  retrievalLimit: 3,
  interactionRetentionDays: 10,
  tokenRates: null,
  chatV2Enabled: false,
  chatV2CanaryPercent: 0,
  chatV2CanaryInviteIds: new Set<string>(),
  hedgedFailoverEnabled: false,
  chatSafeMode: false,
  providerTotalTimeoutMs: 90_000,
  providerProtocolEventTimeoutMs: 25_000,
  providerModelTextTimeoutMs: 40_000,
  providerStageTimeoutMs: 80_000,
  chatTurnTimeoutMs: 90_000,
  providerMaxAttempts: 3,
};

function providerAttempt(input: {
  attemptIndex: number;
  position: number;
  status: ProviderAttempt['status'];
  inputTokens: number;
  outputTokens: number;
  inputRate: string;
  outputRate: string;
}): ProviderAttempt {
  const startedAt = new Date(runtimeNow.getTime() + input.attemptIndex * 100);
  const completedAt = new Date(startedAt.getTime() + 50);
  return {
    attemptIndex: input.attemptIndex,
    completedAt,
    configDigest: String(input.position + 1).repeat(64),
    connectionDisplayName: `Connection ${input.position}`,
    connectionVersionId: null,
    costComplete: true,
    errorCode: input.status === 'failed'
      ? 'PROVIDER_UNAVAILABLE'
      : input.status === 'stopped' ? 'CHAT_STOPPED' : null,
    firstByteLatencyMs: input.status === 'completed' ? 10 : null,
    firstModelTextMs: null,
    firstProtocolEventMs: null,
    firstUserVisibleMs: null,
    generationMode: 'normal',
    inputUsdPerMillion: input.inputRate,
    knownCostUsd: (
      input.inputTokens * Number(input.inputRate)
      + input.outputTokens * Number(input.outputRate)
    ) / 1_000_000,
    launchKind: input.position === 0 ? 'primary' : 'failover',
    modelDisplayName: `Model ${input.position}`,
    modelId: `model-${input.position}`,
    modelVersionId: null,
    outputUsdPerMillion: input.outputRate,
    position: input.position,
    protocol: 'responses',
    routeRevisionId: null,
    sourceType: 'environment',
    startedAt,
    status: input.status,
    totalLatencyMs: 50,
    usage: { inputTokens: input.inputTokens, outputTokens: input.outputTokens },
    usageComplete: true,
  };
}

class TelemetryProvider implements AiProvider {
  readonly attempts = [
    providerAttempt({
      attemptIndex: 0,
      position: 0,
      status: 'failed',
      inputTokens: 10,
      outputTokens: 2,
      inputRate: '1',
      outputRate: '2',
    }),
    providerAttempt({
      attemptIndex: 1,
      position: 1,
      status: 'completed',
      inputTokens: 20,
      outputTokens: 4,
      inputRate: '3',
      outputRate: '6',
    }),
  ];

  async embed(inputs: string[]): Promise<number[][]> {
    const vector = [1, ...Array.from({ length: 1_535 }, () => 0)];
    return inputs.map(() => vector);
  }

  async *streamAnswer(_request: AnswerRequest): AsyncIterable<AnswerEvent> {
    yield { type: 'attempt', attempt: this.attempts[0] };
    yield { type: 'delta', text: 'Routed answer [source 1]' };
    yield { type: 'attempt', attempt: this.attempts[1] };
    yield {
      type: 'done',
      attempts: this.attempts,
      costComplete: true,
      knownCostUsd: 0.000098,
      usage: { inputTokens: 30, outputTokens: 6 },
      usageComplete: true,
      winner: { ...this.attempts[1], attemptIndex: 1 },
    };
  }
}

class FailedTelemetryProvider extends TelemetryProvider {
  override async *streamAnswer(_request: AnswerRequest): AsyncIterable<AnswerEvent> {
    const attempt = this.attempts[0];
    yield { type: 'attempt', attempt };
    throw new ProviderRunError('PROVIDER_TOTAL_TIMEOUT', [{
      ...attempt,
      errorCode: 'PROVIDER_TOTAL_TIMEOUT',
    }]);
  }
}

class StoppedTelemetryProvider extends TelemetryProvider {
  readonly stoppedAttempt = providerAttempt({
    attemptIndex: 0,
    position: 0,
    status: 'stopped',
    inputTokens: 5,
    outputTokens: 1,
    inputRate: '1',
    outputRate: '2',
  });

  override async *streamAnswer(
    _request: AnswerRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AnswerEvent> {
    yield { type: 'delta', text: 'Partial routed answer' };
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve();
      else signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    yield { type: 'attempt', attempt: this.stoppedAttempt };
    throw signal?.reason;
  }
}

class PartiallyObservedStoppedProvider extends TelemetryProvider {
  readonly completedAttempt = providerAttempt({
    attemptIndex: 0,
    position: 0,
    status: 'completed',
    inputTokens: 5,
    outputTokens: 1,
    inputRate: '1',
    outputRate: '2',
  });

  override async *streamAnswer(
    request: AnswerRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AnswerEvent> {
    const execution = request.execution;
    if (!execution) throw new Error('v2 execution hooks are required');
    await execution.onAttempt({
      type: 'started',
      attemptNo: 1,
      providerAlias: 'primary',
      launchKind: 'primary',
      startedAt: runtimeNow,
      startDelayMs: 0,
    });
    await execution.onAttempt({
      type: 'completed',
      attemptNo: 1,
      providerAlias: 'primary',
      durationMs: 50,
      winner: false,
      errorCode: null,
      usage: { inputTokens: 5, outputTokens: 1 },
    });
    yield { type: 'attempt', attempt: this.completedAttempt };
    await execution.onAttempt({
      type: 'started',
      attemptNo: 2,
      providerAlias: 'fallback-1',
      launchKind: 'failover',
      startedAt: new Date(runtimeNow.getTime() + 100),
      startDelayMs: 100,
    });
    yield { type: 'delta', text: 'Partial routed answer' };
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve();
      else signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    await execution.onAttempt({
      type: 'aborted',
      attemptNo: 2,
      providerAlias: 'fallback-1',
      durationMs: 25,
      winner: false,
      errorCode: null,
      usage: null,
    });
    throw signal?.reason;
  }
}

test('runtime resolver preserves environment routing when no database route is active', async () => {
  const database = await createDisposablePostgresDatabase();
  await migrate(database.connectionString);
  const pool = new Pool({ connectionString: database.connectionString });
  try {
    const runtime = await resolveProviderRuntime(pool, environmentConfig, { env: {} });
    assert.equal(runtime.routeRevisionId, null);
    assert.deepEqual(runtime.targets.map((target) => ({
      position: target.position,
      sourceType: target.sourceType,
      modelId: target.modelId,
      connectionDisplayName: target.connectionDisplayName,
    })), [
      {
        position: 0,
        sourceType: 'environment',
        modelId: 'gpt-environment',
        connectionDisplayName: 'Environment primary',
      },
      {
        position: 1,
        sourceType: 'environment',
        modelId: 'gpt-environment',
        connectionDisplayName: 'Environment fallback 1',
      },
    ]);
  } finally {
    await pool.end();
    await database.dispose();
  }
});

test('runtime resolver freezes one active database route and fails closed on digest corruption', async () => {
  const database = await createDisposablePostgresDatabase();
  await migrate(database.connectionString);
  const pool = new Pool({ connectionString: database.connectionString });
  try {
    const client = await pool.connect();
    let modelVersionId = '';
    try {
      await client.query('BEGIN');
      const created = await createConnectionWithModel(client, {
        connection: {
          apiKey: 'database-secret',
          baseUrl: 'https://database.example/v1',
          displayName: 'Database connection',
          userAgent: 'Morse-Database/1.0',
        },
        model: {
          displayName: 'Database model',
          inputUsdPerMillion: '3',
          maxOutputTokens: 1_024,
          modelId: 'gpt-database',
          outputUsdPerMillion: '6',
          protocol: 'chat_completions',
          reasoningEffort: 'medium',
        },
      }, { key, keyVersion: 1 });
      modelVersionId = created.modelVersionId;
      const model = await client.query<{ config_digest: string }>(
        'SELECT config_digest FROM ai_model_presets WHERE id = $1',
        [modelVersionId],
      );
      const route = await client.query<{ id: string }>(
        `INSERT INTO ai_route_revisions
          (id, revision_number, activation_kind, activated_at, actor_admin_session_id)
         VALUES ($1, 1, 'activate', now(), $2) RETURNING id::text`,
        [randomUUID(), '10000000-0000-4000-8000-000000000001'],
      );
      await client.query(
        `INSERT INTO ai_route_targets
          (route_revision_id, position, source_type, database_model_version_id,
           connection_display_name, model_display_name, model_id, protocol, config_digest,
           input_usd_per_million, output_usd_per_million)
         VALUES ($1, 0, 'database', $2, 'Database connection', 'Database model',
                 'gpt-database', 'chat_completions', $3, 3, 6)`,
        [route.rows[0].id, modelVersionId, model.rows[0].config_digest],
      );
      await client.query(
        `UPDATE ai_runtime_state
            SET active_route_revision_id = $1, lock_version = lock_version + 1, updated_at = now()
          WHERE id = true`,
        [route.rows[0].id],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const env = {
      NODE_ENV: 'test',
      MORSE_PROVIDER_CONFIG_KEY: key.toString('base64'),
      MORSE_PROVIDER_CONFIG_KEY_VERSION: '1',
    };
    const runtime = await resolveProviderRuntime(pool, environmentConfig, { env });
    assert.notEqual(runtime.routeRevisionId, null);
    assert.deepEqual(runtime.targets.map((target) => ({
      connectionVersionId: target.connectionVersionId,
      modelVersionId: target.modelVersionId,
      modelId: target.modelId,
      protocol: target.protocol,
      inputUsdPerMillion: target.inputUsdPerMillion,
      outputUsdPerMillion: target.outputUsdPerMillion,
    })), [{
      connectionVersionId: runtime.targets[0].connectionVersionId,
      modelVersionId,
      modelId: 'gpt-database',
      protocol: 'chat_completions',
      inputUsdPerMillion: '3.000000',
      outputUsdPerMillion: '6.000000',
    }]);

    const connectionVersionId = runtime.targets[0].connectionVersionId;
    assert.ok(connectionVersionId);
    const insecureDigest = createRuntimeConfigDigest({
      apiKey: 'database-secret',
      baseUrl: 'http://public.example/v1',
      maxOutputTokens: 1_024,
      modelId: 'gpt-database',
      protocol: 'chat_completions',
      reasoningEffort: 'medium',
      userAgent: 'Morse-Database/1.0',
    }, key);
    await pool.query('ALTER TABLE ai_connections DISABLE TRIGGER ai_connections_immutable_update');
    await pool.query('ALTER TABLE ai_model_presets DISABLE TRIGGER ai_model_presets_immutable_update');
    await pool.query('ALTER TABLE ai_route_targets DISABLE TRIGGER ai_route_targets_immutable_update');
    await pool.query(
      'UPDATE ai_connections SET base_url = $2 WHERE id = $1',
      [connectionVersionId, 'http://public.example/v1'],
    );
    await pool.query(
      'UPDATE ai_model_presets SET config_digest = $2 WHERE id = $1',
      [modelVersionId, insecureDigest],
    );
    await pool.query(
      'UPDATE ai_route_targets SET config_digest = $2 WHERE route_revision_id = $1',
      [runtime.routeRevisionId, insecureDigest],
    );
    await pool.query('ALTER TABLE ai_connections ENABLE TRIGGER ai_connections_immutable_update');
    await pool.query('ALTER TABLE ai_model_presets ENABLE TRIGGER ai_model_presets_immutable_update');
    await pool.query('ALTER TABLE ai_route_targets ENABLE TRIGGER ai_route_targets_immutable_update');
    await assert.rejects(
      resolveProviderRuntime(pool, environmentConfig, { env }),
      (error: unknown) => (error as { code?: string }).code === 'AI_CONFIG_UNAVAILABLE',
    );
    await pool.query('ALTER TABLE ai_connections DISABLE TRIGGER ai_connections_immutable_update');
    await pool.query('ALTER TABLE ai_model_presets DISABLE TRIGGER ai_model_presets_immutable_update');
    await pool.query('ALTER TABLE ai_route_targets DISABLE TRIGGER ai_route_targets_immutable_update');
    await pool.query(
      'UPDATE ai_connections SET base_url = $2 WHERE id = $1',
      [connectionVersionId, 'https://database.example/v1'],
    );
    await pool.query(
      'UPDATE ai_model_presets SET config_digest = $2 WHERE id = $1',
      [modelVersionId, runtime.targets[0].configDigest],
    );
    await pool.query(
      'UPDATE ai_route_targets SET config_digest = $2 WHERE route_revision_id = $1',
      [runtime.routeRevisionId, runtime.targets[0].configDigest],
    );
    await pool.query('ALTER TABLE ai_connections ENABLE TRIGGER ai_connections_immutable_update');
    await pool.query('ALTER TABLE ai_model_presets ENABLE TRIGGER ai_model_presets_immutable_update');
    await pool.query('ALTER TABLE ai_route_targets ENABLE TRIGGER ai_route_targets_immutable_update');

    await pool.query('ALTER TABLE ai_connections DISABLE TRIGGER ai_connections_immutable_update');
    await pool.query(
      'UPDATE ai_connections SET base_url = $2 WHERE id = $1',
      [connectionVersionId, 'https://tampered.example/v1'],
    );
    await pool.query('ALTER TABLE ai_connections ENABLE TRIGGER ai_connections_immutable_update');
    await assert.rejects(
      resolveProviderRuntime(pool, environmentConfig, { env }),
      (error: unknown) => (error as { code?: string }).code === 'AI_CONFIG_UNAVAILABLE',
    );
    await pool.query('ALTER TABLE ai_connections DISABLE TRIGGER ai_connections_immutable_update');
    await pool.query(
      'UPDATE ai_connections SET base_url = $2 WHERE id = $1',
      [connectionVersionId, 'https://database.example/v1'],
    );
    await pool.query('ALTER TABLE ai_connections ENABLE TRIGGER ai_connections_immutable_update');

    await pool.query(
      'UPDATE ai_connections SET archived_at = now(), deleted_at = now() WHERE id = $1',
      [connectionVersionId],
    );
    await assert.rejects(
      resolveProviderRuntime(pool, environmentConfig, { env }),
      (error: unknown) => (error as { code?: string }).code === 'AI_CONFIG_UNAVAILABLE',
    );
    await pool.query('ALTER TABLE ai_connections DISABLE TRIGGER ai_connections_immutable_update');
    await pool.query(
      'UPDATE ai_connections SET archived_at = NULL, deleted_at = NULL WHERE id = $1',
      [connectionVersionId],
    );
    await pool.query('ALTER TABLE ai_connections ENABLE TRIGGER ai_connections_immutable_update');

    await pool.query(
      `UPDATE ai_route_targets
          SET config_digest = $2
        WHERE route_revision_id = $1`,
      [runtime.routeRevisionId, 'f'.repeat(64)],
    ).catch(() => undefined);
    await pool.query('ALTER TABLE ai_route_targets DISABLE TRIGGER ai_route_targets_immutable_update');
    await pool.query(
      'UPDATE ai_route_targets SET config_digest = $2 WHERE route_revision_id = $1',
      [runtime.routeRevisionId, 'f'.repeat(64)],
    );
    await pool.query('ALTER TABLE ai_route_targets ENABLE TRIGGER ai_route_targets_immutable_update');
    await assert.rejects(
      resolveProviderRuntime(pool, environmentConfig, { env }),
      (error: unknown) => (error as { code?: string }).code === 'AI_CONFIG_UNAVAILABLE',
    );
  } finally {
    await pool.end();
    await database.dispose();
  }
});

test('runChat persists routed attempts and per-attempt usage idempotently in one terminal transaction', async () => {
  const database = await createDisposablePostgresDatabase();
  await migrate(database.connectionString);
  const pool = new Pool({ connectionString: database.connectionString });
  const accessSessionId = randomUUID();
  const inviteId = randomUUID();
  const turnId = randomUUID();
  try {
    const vector = `[${[1, ...Array.from({ length: 1_535 }, () => 0)].join(',')}]`;
    await pool.query(
      `INSERT INTO knowledge_documents (id, title, source_path, checksum)
       VALUES ('runtime-doc', 'Runtime document', 'runtime.md', $1)`,
      ['a'.repeat(64)],
    );
    await pool.query(
      `INSERT INTO knowledge_chunks (id, document_id, ordinal, content, embedding, metadata)
       VALUES ('runtime-chunk', 'runtime-doc', 0, 'Runtime routing evidence.', $1::vector,
               '{"title":"Runtime document","sourcePath":"runtime.md","href":"/works/content-agent"}'::jsonb)`,
      [vector],
    );
    await pool.query(
      `INSERT INTO invite_codes
        (id, code_hash, label, active, expires_at, max_sessions, session_count)
       VALUES ($1, $2, 'runtime', true, $3, 1, 1)`,
      [inviteId, 'b'.repeat(64), new Date('2026-07-22T04:00:00.000Z')],
    );
    await pool.query(
      `INSERT INTO access_sessions
        (id, invite_code_id, token_hash, expires_at, message_count, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, 0, $5, $5)`,
      [
        accessSessionId,
        inviteId,
        'c'.repeat(64),
        new Date('2026-07-22T04:00:00.000Z'),
        runtimeNow,
      ],
    );
    const provider = new TelemetryProvider();
    const input = {
      pool,
      provider,
      accessSessionId,
      request: {
        message: 'Explain runtime routing.',
        mode: 'general' as const,
        audienceIntent: 'general',
        conversationId: null,
        turnId,
      },
      config: {
        ...chatServiceConfig,
        tokenRates: { inputUsdPerMillion: 99, outputUsdPerMillion: 99 },
      },
      now: runtimeNow,
    };
    for await (const _event of runChat(input)) {
      // Consume the first request.
    }
    for await (const _event of runChat(input)) {
      // Same turn is an idempotent replay and must not call Provider again.
    }

    const interaction = await pool.query<{
      provider: string;
      model: string;
      target_position: number;
      input_tokens: number;
      output_tokens: number;
      known_cost_usd: string;
      estimated_cost_usd: string;
      usage_complete: boolean;
      cost_complete: boolean;
    }>(
      `SELECT provider, model, target_position, input_tokens, output_tokens,
              known_cost_usd::text, estimated_cost_usd::text,
              usage_complete, cost_complete
         FROM interaction_turns WHERE id = $1`,
      [turnId],
    );
    assert.deepEqual(interaction.rows, [{
      provider: 'Connection 1',
      model: 'model-1',
      target_position: 1,
      input_tokens: 30,
      output_tokens: 6,
      known_cost_usd: '0.000098',
      estimated_cost_usd: '0.000098',
      usage_complete: true,
      cost_complete: true,
    }]);
    const attempts = await pool.query<{
      attempt_index: number;
      status: string;
      known_cost_usd: string;
    }>(
      `SELECT attempt_index, status, known_cost_usd::text
         FROM interaction_provider_attempts
        WHERE interaction_turn_id = $1 ORDER BY attempt_index`,
      [turnId],
    );
    assert.deepEqual(attempts.rows, [
      { attempt_index: 0, status: 'failed', known_cost_usd: '0.000014' },
      { attempt_index: 1, status: 'completed', known_cost_usd: '0.000084' },
    ]);
    const usage = await pool.query<{ provider_attempt_index: number; cost: string }>(
      `SELECT provider_attempt_index, estimated_cost_usd::text AS cost
         FROM usage_events WHERE interaction_turn_id = $1
        ORDER BY provider_attempt_index`,
      [turnId],
    );
    assert.deepEqual(usage.rows, [
      { provider_attempt_index: 0, cost: '0.000014' },
      { provider_attempt_index: 1, cost: '0.000084' },
    ]);
    assert.equal(await providerAttemptsMatch(pool, turnId, provider.attempts), true);
    assert.equal(await providerAttemptsMatch(pool, turnId, [
      provider.attempts[0],
      { ...provider.attempts[1], configDigest: '9'.repeat(64) },
    ]), false);
  } finally {
    await pool.end();
    await database.dispose();
  }
});

test('runChat persists failed and stopped provider attempts before terminal compensation', async () => {
  const database = await createDisposablePostgresDatabase();
  await migrate(database.connectionString);
  const pool = new Pool({ connectionString: database.connectionString });
  const failedTurnId = randomUUID();
  const stoppedTurnId = randomUUID();
  try {
    const vector = `[${[1, ...Array.from({ length: 1_535 }, () => 0)].join(',')}]`;
    await pool.query(
      `INSERT INTO knowledge_documents (id, title, source_path, checksum)
       VALUES ('terminal-doc', 'Terminal document', 'terminal.md', $1)`,
      ['d'.repeat(64)],
    );
    await pool.query(
      `INSERT INTO knowledge_chunks (id, document_id, ordinal, content, embedding, metadata)
       VALUES ('terminal-chunk', 'terminal-doc', 0, 'Terminal routing evidence.', $1::vector,
               '{"title":"Terminal document","sourcePath":"terminal.md","href":"/works/content-agent"}'::jsonb)`,
      [vector],
    );
    const createSession = async (suffix: string): Promise<string> => {
      const inviteId = randomUUID();
      const sessionId = randomUUID();
      await pool.query(
        `INSERT INTO invite_codes
          (id, code_hash, label, active, expires_at, max_sessions, session_count)
         VALUES ($1, $2, $3, true, $4, 1, 1)`,
        [
          inviteId,
          suffix.repeat(64).slice(0, 64),
          suffix,
          new Date('2026-07-22T04:00:00.000Z'),
        ],
      );
      await pool.query(
        `INSERT INTO access_sessions
          (id, invite_code_id, token_hash, expires_at, message_count, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, 0, $5, $5)`,
        [
          sessionId,
          inviteId,
          suffix.toUpperCase().repeat(64).slice(0, 64),
          new Date('2026-07-22T04:00:00.000Z'),
          runtimeNow,
        ],
      );
      return sessionId;
    };
    const failedSessionId = await createSession('e');
    const stoppedSessionId = await createSession('f');
    const chatConfig = {
      ...chatServiceConfig,
      tokenRates: null,
    };

    await assert.rejects(async () => {
      for await (const _event of runChat({
        pool,
        provider: new FailedTelemetryProvider(),
        accessSessionId: failedSessionId,
        request: {
          message: 'Fail after one provider attempt.',
          mode: 'general',
          audienceIntent: 'general',
          conversationId: null,
          turnId: failedTurnId,
        },
        config: chatConfig,
        now: runtimeNow,
      })) {
        // Consume until the terminal provider error.
      }
    });

    const controller = new AbortController();
    const stoppedIterator = runChat({
      pool,
      provider: new StoppedTelemetryProvider(),
      accessSessionId: stoppedSessionId,
      request: {
        message: 'Stop after partial provider output.',
        mode: 'general',
        audienceIntent: 'general',
        conversationId: null,
        turnId: stoppedTurnId,
      },
      config: chatConfig,
      now: runtimeNow,
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    while (true) {
      const next = await stoppedIterator.next();
      if (next.done) throw new Error('expected partial output');
      if (next.value.type === 'delta') break;
    }
    controller.abort(new DOMException('Stopped', 'AbortError'));
    await assert.rejects(async () => {
      while (!(await stoppedIterator.next()).done) {
        // Drain through terminal compensation.
      }
    }, (error: unknown) => (error as { name?: string }).name === 'AbortError');

    const terminal = await pool.query<{
      error_code: string;
      id: string;
      status: string;
      attempt_status: string;
      usage_complete: boolean;
      known_cost_usd: string;
      model: string | null;
      provider: string | null;
    }>(
      `SELECT turn.id::text, turn.status, turn.error_code, turn.provider, turn.model,
              attempt.status AS attempt_status,
              attempt.usage_complete,
              attempt.known_cost_usd::text
         FROM interaction_turns turn
         JOIN interaction_provider_attempts attempt
           ON attempt.interaction_turn_id = turn.id
        WHERE turn.id = ANY($1::uuid[])
        ORDER BY turn.id`,
      [[failedTurnId, stoppedTurnId]],
    );
    const terminalDiagnostics = await pool.query(
      `SELECT turn.id::text, turn.status, turn.error_code,
              attempt.attempt_index, attempt.status AS attempt_status
         FROM interaction_turns turn
         LEFT JOIN interaction_provider_attempts attempt
           ON attempt.interaction_turn_id = turn.id
        WHERE turn.id = ANY($1::uuid[])
        ORDER BY turn.id, attempt.attempt_index`,
      [[failedTurnId, stoppedTurnId]],
    );
    assert.equal(terminal.rowCount, 2, JSON.stringify(terminalDiagnostics.rows));
    assert.deepEqual(new Set(terminal.rows.map((row) => row.status)), new Set(['failed', 'stopped']));
    assert.deepEqual(new Set(terminal.rows.map((row) => row.attempt_status)), new Set(['failed', 'stopped']));
    assert.deepEqual(
      new Set(terminal.rows.map((row) => row.error_code)),
      new Set(['PROVIDER_TOTAL_TIMEOUT', 'CHAT_STOPPED']),
    );
    assert.ok(terminal.rows.every((row) => row.usage_complete));
    assert.ok(terminal.rows.every((row) => row.provider === null && row.model === null));
    assert.deepEqual(
      terminal.rows.map((row) => row.known_cost_usd).sort(),
      ['0.000007', '0.000014'],
    );
  } finally {
    await pool.end();
    await database.dispose();
  }
});

test('v2 stopped compensation keeps completeness false when an active attempt has no usage', async () => {
  const database = await createDisposablePostgresDatabase();
  await migrate(database.connectionString);
  const pool = new Pool({ connectionString: database.connectionString });
  const turnId = randomUUID();
  try {
    const vector = `[${[1, ...Array.from({ length: 1_535 }, () => 0)].join(',')}]`;
    await pool.query(
      `INSERT INTO knowledge_documents (id, title, source_path, checksum)
       VALUES ('partial-stop-doc', 'Partial stop document', 'partial-stop.md', $1)`,
      ['e'.repeat(64)],
    );
    await pool.query(
      `INSERT INTO knowledge_chunks (id, document_id, ordinal, content, embedding, metadata)
       VALUES ('partial-stop-chunk', 'partial-stop-doc', 0, 'Partial stop evidence.', $1::vector,
               '{"title":"Partial stop document","sourcePath":"partial-stop.md","href":"/works/content-agent"}'::jsonb)`,
      [vector],
    );
    const inviteId = randomUUID();
    const sessionId = randomUUID();
    await pool.query(
      `INSERT INTO invite_codes
        (id, code_hash, label, active, expires_at, max_sessions, session_count)
       VALUES ($1, $2, 'partial-stop', true, $3, 1, 1)`,
      [inviteId, 'a'.repeat(64), new Date('2026-07-22T08:00:00.000Z')],
    );
    await pool.query(
      `INSERT INTO access_sessions
        (id, invite_code_id, token_hash, expires_at, message_count, created_at, last_seen_at,
         chat_behavior_version)
       VALUES ($1, $2, $3, $4, 0, $5, $5, 'v2')`,
      [
        sessionId,
        inviteId,
        'b'.repeat(64),
        new Date('2026-07-22T08:00:00.000Z'),
        runtimeNow,
      ],
    );

    const controller = new AbortController();
    const iterator = runChat({
      pool,
      provider: new PartiallyObservedStoppedProvider(),
      accessSessionId: sessionId,
      request: {
        message: '你好，聊聊职场沟通。',
        mode: 'general',
        audienceIntent: 'general',
        conversationId: null,
        turnId,
      },
      config: {
        ...chatServiceConfig,
        tokenRates: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
        chatV2Enabled: true,
        chatV2CanaryPercent: 100,
      },
      now: runtimeNow,
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    while (true) {
      const next = await iterator.next();
      if (next.done) throw new Error('expected partial output');
      if (next.value.type === 'delta') break;
    }
    controller.abort(new DOMException('Stopped', 'AbortError'));
    await assert.rejects(async () => {
      while (!(await iterator.next()).done) {
        // Drain through terminal compensation.
      }
    }, (error: unknown) => (error as { name?: string }).name === 'AbortError');

    const attempts = await pool.query<{
      status: string;
      input_tokens: number | null;
      output_tokens: number | null;
    }>(
      `SELECT status, input_tokens, output_tokens
         FROM chat_provider_attempts
        WHERE interaction_turn_id = $1
        ORDER BY attempt_no`,
      [turnId],
    );
    assert.deepEqual(attempts.rows, [
      { status: 'completed', input_tokens: 5, output_tokens: 1 },
      { status: 'aborted', input_tokens: null, output_tokens: null },
    ]);
    const interaction = await pool.query<{
      status: string;
      input_tokens: number;
      output_tokens: number;
      known_cost_usd: string;
      estimated_cost_usd: string | null;
      usage_complete: boolean;
      cost_complete: boolean;
    }>(
      `SELECT status, input_tokens, output_tokens, known_cost_usd::text,
              estimated_cost_usd::text, usage_complete, cost_complete
         FROM interaction_turns
        WHERE id = $1`,
      [turnId],
    );
    assert.deepEqual(interaction.rows, [{
      status: 'stopped',
      input_tokens: 5,
      output_tokens: 1,
      known_cost_usd: '0.000007',
      estimated_cost_usd: null,
      usage_complete: false,
      cost_complete: false,
    }]);
  } finally {
    await pool.end();
    await database.dispose();
  }
});
