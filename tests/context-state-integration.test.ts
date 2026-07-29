import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';

import pg from 'pg';

import type {
  ContextPacketManifest,
  ResolvedChatTurn,
} from '../lib/contracts/chat-context.ts';
import {
  captureLegacyContextBridge,
  insertCompletedContextTurn,
  loadAdjacentCompletedContextTurn,
  loadCapturedLegacyContextBridge,
  loadCanonicalAnswerHistory,
  loadContextTaskFrame,
  persistContextSuccessState,
  persistContextTerminalManifest,
  resolveLegacyContextBridge,
  upsertContextTaskFrame,
} from '../lib/server/conversation-context-state.ts';
import { encodeTurnMessage } from '../lib/server/turn-codec.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');

function resolvedProjectFit(): ResolvedChatTurn {
  return {
    semantic: {
      discourseAction: 'new_task',
      subject: 'morse',
      intent: 'project_fit',
      taskAction: 'create',
      referent: null,
      evidencePlan: ['ranked_project_fit'],
      confidence: 0.95,
      reasonCodes: ['recruitment_project_fit'],
    },
    legacyRoute: {
      routeKind: 'grounded',
      reasonCode: 'recruitment_project_fit',
      topicKind: 'project',
      topicRef: null,
      evidenceClass: 'mixed',
      inheritedFromTurnId: null,
      release: 'complete',
      requiresEmbedding: true,
      requiresSearch: false,
      deterministicReply: null,
    },
  };
}

function builtManifest(taskId: string): ContextPacketManifest {
  return {
    pipeline_version: 'context-packet-v22',
    semantic_intent: 'project_fit',
    discourse_action: 'new_task',
    task_action: 'create',
    task_id: taskId,
    task_state_version: 1,
    context_builder_version: 'context-packet-builder-v1',
    projection_policy_version: 'final-context-projection-v1',
    release_policy: 'complete',
    context_build_status: 'built',
    context_build_error_code: null,
    discourse_source_turn_ids: [],
    legacy_bridge_policy_version: null,
    legacy_bridge_source_turn_ids: [],
    legacy_bridge_status: 'not_eligible',
    included_layers: ['current_input', 'task_frame', 'approved_evidence'],
    excluded_layers: ['discourse_context', 'task_history'],
    projected_slot_kinds: ['role'],
    evicted_layers: [],
    projection_reason_codes: ['new_task_excludes_old_context'],
    eviction_reason_codes: [],
    token_estimate_by_layer: { current_input: 12 },
    evidence_ids: ['project:digital-morse'],
    retrieval_scores: [{ evidenceId: 'project:digital-morse', score: 0.9 }],
    degraded_reason: null,
    packet_hmac_key_id: '2026-07-v1',
    packet_hmac_sha256: 'c'.repeat(64),
  };
}

async function runMigrations(connectionString: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [migrationRunner], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(stderr || `Migration runner exited with ${code}.`)));
  });
}

async function insertFixture(pool: InstanceType<typeof Pool>) {
  const inviteId = randomUUID();
  const sessionId = randomUUID();
  const conversationId = randomUUID();
  await pool.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES ($1, $2, 'context state fixture', true, now() + interval '30 days', 3, 1)`,
    [inviteId, randomUUID().replaceAll('-', '').repeat(2)],
  );
  await pool.query(
    `INSERT INTO access_sessions
      (id, invite_code_id, token_hash, expires_at, message_count)
     VALUES ($1, $2, $3, now() + interval '30 days', 0)`,
    [sessionId, inviteId, randomUUID().replaceAll('-', '').repeat(2)],
  );
  await pool.query(
    `INSERT INTO conversations
      (id, access_session_id, mode, workflow, audience_intent, expires_at,
       context_pipeline_assignment)
     VALUES ($1, $2, 'general', 'chat', 'recruiter', now() + interval '30 days',
             'context_packet_v22')`,
    [conversationId, sessionId],
  );
  return { conversationId, sessionId };
}

async function insertMessagePair(
  pool: InstanceType<typeof Pool>,
  conversationId: string,
  turnId: string,
  userText: string,
  assistantText: string,
) {
  const user = await pool.query<{ id: string }>(
    `INSERT INTO conversation_messages (conversation_id, role, content)
     VALUES ($1, 'user', $2) RETURNING id::text`,
    [conversationId, encodeTurnMessage(turnId, userText)],
  );
  const assistant = await pool.query<{ id: string }>(
    `INSERT INTO conversation_messages (conversation_id, role, content)
     VALUES ($1, 'assistant', $2) RETURNING id::text`,
    [conversationId, encodeTurnMessage(turnId, assistantText)],
  );
  return { userMessageId: user.rows[0].id, assistantMessageId: assistant.rows[0].id };
}

test('context Task Frame persists slot references and rejects stale optimistic versions', async () => {
  const database = await createDisposablePostgresDatabase();
  const pool = new Pool({ connectionString: database.connectionString });
  try {
    await runMigrations(database.connectionString);
    const fixture = await insertFixture(pool);
    const turnId = randomUUID();
    const message = '星河科技，招聘 Agent 平台后端工程师';
    const pair = await insertMessagePair(pool, fixture.conversationId, turnId, message, '收到');
    const taskId = randomUUID();
    const companyText = '星河科技';
    const roleText = 'Agent 平台后端工程师';
    const companyStart = message.indexOf(companyText);
    const roleStart = message.indexOf(roleText);
    const now = new Date('2026-07-27T12:00:00.000Z');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      assert.equal(await upsertContextTaskFrame(client, {
        conversationId: fixture.conversationId,
        taskId,
        taskKind: 'recruitment_evaluation',
        subjectKind: 'morse',
        subjectRef: 'recruitment',
        evidenceFocus: { topicKind: 'none', topicRef: null },
        status: 'active',
        closedReason: null,
        waitingFor: [],
        taskStartedMessageId: pair.userMessageId,
        lastSuccessfulMessageId: pair.assistantMessageId,
        updatedByMessageId: pair.userMessageId,
        expectedVersion: 0,
        slots: [
          {
            slot: 'company',
            sourceMessageId: pair.userMessageId,
            startUtf16: companyStart,
            endUtf16: companyStart + companyText.length,
            contentSha256: createHash('sha256').update(companyText).digest('hex'),
            extractorVersion: 'recruitment-slots-v1',
            ordinal: 0,
          },
          {
            slot: 'role',
            sourceMessageId: pair.userMessageId,
            startUtf16: roleStart,
            endUtf16: roleStart + roleText.length,
            contentSha256: createHash('sha256').update(roleText).digest('hex'),
            extractorVersion: 'recruitment-slots-v1',
            ordinal: 0,
          },
        ],
        now,
      }), 1);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const stored = await loadContextTaskFrame(pool, fixture.conversationId);
    assert.equal(stored?.taskId, taskId);
    assert.equal(stored?.version, 1);
    assert.deepEqual(stored?.slots.map((slot) => [slot.slot, slot.text]), [
      ['company', companyText],
      ['role', roleText],
    ]);

    const staleClient = await pool.connect();
    try {
      await staleClient.query('BEGIN');
      assert.equal(await upsertContextTaskFrame(staleClient, {
        ...stored!,
        expectedVersion: 0,
        lastSuccessfulMessageId: pair.assistantMessageId,
        updatedByMessageId: pair.userMessageId,
        slots: stored!.slots,
        now: new Date(now.getTime() + 1_000),
      }), 0);
      await staleClient.query('ROLLBACK');
    } finally {
      staleClient.release();
    }
  } finally {
    await pool.end();
    await database.dispose();
  }
});

test('completed context history remains authoritative after interaction retention cleanup', async () => {
  const database = await createDisposablePostgresDatabase();
  const pool = new Pool({ connectionString: database.connectionString });
  try {
    await runMigrations(database.connectionString);
    const fixture = await insertFixture(pool);
    const taskScope = randomUUID();
    const firstTurn = randomUUID();
    const secondTurn = randomUUID();
    const firstPair = await insertMessagePair(
      pool,
      fixture.conversationId,
      firstTurn,
      '我们在招 Agent 平台后端工程师',
      '我会按公开项目证据分析。',
    );
    const secondPair = await insertMessagePair(
      pool,
      fixture.conversationId,
      secondTurn,
      '还要求做 RAG 评测',
      '这会影响相关项目排序。',
    );
    const old = new Date('2026-07-01T00:00:00.000Z');
    await pool.query(
      `INSERT INTO interaction_turns
        (id, access_session_id, conversation_id, workflow, audience_intent,
         question, answer, status, created_at, completed_at, delete_after,
         execution_pipeline, semantic_intent, discourse_action, task_action,
         context_scope_id, context_manifest)
       VALUES
        ($1, $3, $4, 'chat', 'recruiter', 'first', 'answer', 'completed',
         $5, $5, $6, 'context_packet_v22', 'project_fit', 'new_task', 'create',
         $7, '{}'::jsonb),
        ($2, $3, $4, 'chat', 'recruiter', 'second', 'answer', 'completed',
         $5 + interval '1 minute', $5 + interval '1 minute', $6,
         'context_packet_v22', 'project_fit', 'follow_up', 'continue',
         $7, '{}'::jsonb)`,
      [
        firstTurn,
        secondTurn,
        fixture.sessionId,
        fixture.conversationId,
        old,
        new Date('2026-07-11T00:00:00.000Z'),
        taskScope,
      ],
    );
    const client = await pool.connect();
    try {
      await insertCompletedContextTurn(client, {
        conversationId: fixture.conversationId,
        turnId: firstTurn,
        contextScopeId: taskScope,
        ...firstPair,
        completedAt: old,
      });
      await insertCompletedContextTurn(client, {
        conversationId: fixture.conversationId,
        turnId: secondTurn,
        contextScopeId: taskScope,
        ...secondPair,
        completedAt: new Date(old.getTime() + 60_000),
      });
    } finally {
      client.release();
    }

    await pool.query('DELETE FROM interaction_turns WHERE delete_after < $1', [new Date('2026-07-20T00:00:00.000Z')]);
    const adjacent = await loadAdjacentCompletedContextTurn(
      pool,
      fixture.conversationId,
      (BigInt(secondPair.assistantMessageId) + 1n).toString(),
    );
    assert.equal(adjacent?.turnId, secondTurn);
    assert.equal(adjacent?.user.text, '还要求做 RAG 评测');
    assert.equal(adjacent?.assistant.text, '这会影响相关项目排序。');

    const history = await loadCanonicalAnswerHistory(pool, {
      conversationId: fixture.conversationId,
      ownerPipeline: 'context_packet_v22',
      contextScopeId: taskScope,
      includeConversation: false,
    });
    assert.deepEqual(history.map((turn) => turn.turnId), [firstTurn, secondTurn]);
    assert.equal(history.every((turn) => turn.contextScopeId === taskScope), true);
  } finally {
    await pool.end();
    await database.dispose();
  }
});

test('legacy bridge captures every valid completed pair and survives analytics cleanup', async () => {
  const database = await createDisposablePostgresDatabase();
  const pool = new Pool({ connectionString: database.connectionString });
  try {
    await runMigrations(database.connectionString);
    const fixture = await insertFixture(pool);
    const turnIds: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const turnId = randomUUID();
      turnIds.push(turnId);
      await insertMessagePair(
        pool,
        fixture.conversationId,
        turnId,
        `legacy user ${index}`,
        `legacy assistant ${index}`,
      );
      await pool.query(
        `INSERT INTO interaction_turns
          (id, access_session_id, conversation_id, workflow, audience_intent,
           question, answer, status, created_at, completed_at, delete_after)
         VALUES ($1,$2,$3,'chat','recruiter',$4,$5,'completed',
                 $6,$6,$7)`,
        [
          turnId,
          fixture.sessionId,
          fixture.conversationId,
          `legacy user ${index}`,
          `legacy assistant ${index}`,
          new Date(`2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
          new Date('2026-07-15T00:00:00.000Z'),
        ],
      );
    }
    const currentTurnId = randomUUID();
    const current = await pool.query<{ id: string }>(
      `INSERT INTO conversation_messages (conversation_id, role, content)
       VALUES ($1, 'user', $2) RETURNING id::text`,
      [fixture.conversationId, encodeTurnMessage(currentTurnId, '你有什么相关项目经验？')],
    );
    const client = await pool.connect();
    let captured;
    try {
      await client.query('BEGIN');
      captured = await captureLegacyContextBridge(client, {
        conversationId: fixture.conversationId,
        beforeMessageId: current.rows[0].id,
        capturedAt: new Date('2026-07-27T12:00:00.000Z'),
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    assert.deepEqual(captured.map((turn) => turn.turnId), [...turnIds].reverse());

    const stored = await pool.query<{ has_body: boolean; ordinal: number; status: string }>(
      `SELECT ordinal, status,
              to_jsonb(bridge)::text ~ '(user_text|assistant_text|content)' AS has_body
         FROM conversation_context_legacy_bridge_turns AS bridge
        WHERE conversation_id = $1 ORDER BY ordinal`,
      [fixture.conversationId],
    );
    assert.equal(stored.rowCount, 7);
    assert.equal(stored.rows.every((row) => row.status === 'captured' && !row.has_body), true);

    await pool.query('DELETE FROM interaction_turns WHERE conversation_id = $1', [fixture.conversationId]);
    const afterCleanup = await loadCapturedLegacyContextBridge(pool, fixture.conversationId);
    assert.deepEqual(afterCleanup.map((turn) => turn.turnId), [...turnIds].reverse());

    await resolveLegacyContextBridge(pool, {
      conversationId: fixture.conversationId,
      status: 'consumed',
      resolvedByTurnId: currentTurnId,
      resolvedAt: new Date('2026-07-27T12:01:00.000Z'),
    });
    assert.deepEqual(await loadCapturedLegacyContextBridge(pool, fixture.conversationId), []);
  } finally {
    await pool.end();
    await database.dispose();
  }
});

test('legacy bridge stops at an invalid nearest pair instead of skipping into older context', async () => {
  const database = await createDisposablePostgresDatabase();
  const pool = new Pool({ connectionString: database.connectionString });
  try {
    await runMigrations(database.connectionString);
    const fixture = await insertFixture(pool);
    const completedTurn = randomUUID();
    await insertMessagePair(pool, fixture.conversationId, completedTurn, 'old user', 'old assistant');
    await pool.query(
      `INSERT INTO interaction_turns
        (id, access_session_id, conversation_id, workflow, audience_intent,
         question, answer, status, created_at, completed_at, delete_after)
       VALUES ($1,$2,$3,'chat','recruiter','old user','old assistant','completed',
               now() - interval '2 minutes', now() - interval '2 minutes',
               now() + interval '10 days')`,
      [completedTurn, fixture.sessionId, fixture.conversationId],
    );
    const failedTurn = randomUUID();
    await insertMessagePair(pool, fixture.conversationId, failedTurn, 'failed user', 'failed assistant');
    await pool.query(
      `INSERT INTO interaction_turns
        (id, access_session_id, conversation_id, workflow, audience_intent,
         question, answer, status, error_code, created_at, completed_at, delete_after)
       VALUES ($1,$2,$3,'chat','recruiter','failed user','failed assistant','failed',
               'PROVIDER_UNAVAILABLE', now() - interval '1 minute',
               now() - interval '1 minute', now() + interval '10 days')`,
      [failedTurn, fixture.sessionId, fixture.conversationId],
    );
    const current = await pool.query<{ id: string }>(
      `INSERT INTO conversation_messages (conversation_id, role, content)
       VALUES ($1, 'user', $2) RETURNING id::text`,
      [fixture.conversationId, encodeTurnMessage(randomUUID(), 'current')],
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(
        captureLegacyContextBridge(client, {
          conversationId: fixture.conversationId,
          beforeMessageId: current.rows[0].id,
          capturedAt: new Date(),
        }),
        /LEGACY_BRIDGE_INVALID/,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const stored = await pool.query(
      `SELECT 1 FROM conversation_context_legacy_bridge_turns WHERE conversation_id = $1`,
      [fixture.conversationId],
    );
    assert.equal(stored.rowCount, 0);
  } finally {
    await pool.end();
    await database.dispose();
  }
});

test('context success state is atomic while terminal failure persists only a redacted manifest', async () => {
  const database = await createDisposablePostgresDatabase();
  const pool = new Pool({ connectionString: database.connectionString });
  try {
    await runMigrations(database.connectionString);
    const fixture = await insertFixture(pool);
    const turnId = randomUUID();
    const taskId = randomUUID();
    const question = 'Agent 平台后端工程师需要哪些相关项目？';
    const pair = await insertMessagePair(
      pool,
      fixture.conversationId,
      turnId,
      question,
      '数字 Morse 与该岗位直接相关。',
    );
    const now = new Date('2026-07-27T13:00:00.000Z');
    await pool.query(
      `INSERT INTO interaction_turns
        (id, access_session_id, conversation_id, workflow, audience_intent,
         question, status, created_at, delete_after)
       VALUES ($1,$2,$3,'chat','recruiter',$4,'running',$5,$6)`,
      [turnId, fixture.sessionId, fixture.conversationId, question, now,
        new Date(now.getTime() + 10 * 24 * 60 * 60 * 1_000)],
    );
    const roleStart = question.indexOf('Agent 平台后端工程师');
    const roleText = 'Agent 平台后端工程师';
    const baseFrame = {
      conversationId: fixture.conversationId,
      taskId,
      taskKind: 'recruitment_evaluation' as const,
      subjectKind: 'morse' as const,
      subjectRef: 'recruitment',
      evidenceFocus: { topicKind: 'project' as const, topicRef: null },
      status: 'active' as const,
      closedReason: null,
      waitingFor: [],
      taskStartedMessageId: pair.userMessageId,
      lastSuccessfulMessageId: pair.assistantMessageId,
      updatedByMessageId: pair.userMessageId,
      expectedVersion: 0,
      now,
    };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(
        persistContextSuccessState(client, {
          interactionTurnId: turnId,
          conversationId: fixture.conversationId,
          contextScopeId: taskId,
          userMessageId: pair.userMessageId,
          assistantMessageId: pair.assistantMessageId,
          resolved: resolvedProjectFit(),
          frame: {
            ...baseFrame,
            slots: [{
              slot: 'role',
              sourceMessageId: pair.userMessageId,
              startUtf16: roleStart,
              endUtf16: roleStart + roleText.length,
              contentSha256: '0'.repeat(64),
              extractorVersion: 'recruitment-slots-v1',
              ordinal: 0,
            }],
          },
          manifest: builtManifest(taskId),
          completedAt: now,
        }),
        /CONTEXT_SLOT_SOURCE_HASH_MISMATCH/,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const rolledBack = await pool.query<{
      context_manifest: unknown;
      completed_count: number;
      frame_count: number;
    }>(
      `SELECT turn.context_manifest,
              (SELECT count(*)::integer FROM conversation_context_completed_turns
                WHERE conversation_id = $2) AS completed_count,
              (SELECT count(*)::integer FROM conversation_context_task_state
                WHERE conversation_id = $2) AS frame_count
         FROM interaction_turns AS turn WHERE turn.id = $1`,
      [turnId, fixture.conversationId],
    );
    assert.deepEqual(rolledBack.rows[0], {
      context_manifest: null,
      completed_count: 0,
      frame_count: 0,
    });

    const successClient = await pool.connect();
    try {
      await successClient.query('BEGIN');
      await persistContextSuccessState(successClient, {
        interactionTurnId: turnId,
        conversationId: fixture.conversationId,
        contextScopeId: taskId,
        userMessageId: pair.userMessageId,
        assistantMessageId: pair.assistantMessageId,
        resolved: resolvedProjectFit(),
        frame: {
          ...baseFrame,
          slots: [{
            slot: 'role',
            sourceMessageId: pair.userMessageId,
            startUtf16: roleStart,
            endUtf16: roleStart + roleText.length,
            contentSha256: createHash('sha256').update(roleText).digest('hex'),
            extractorVersion: 'recruitment-slots-v1',
            ordinal: 0,
          }],
        },
        manifest: builtManifest(taskId),
        completedAt: now,
      });
      await successClient.query('COMMIT');
    } finally {
      successClient.release();
    }
    const completed = await pool.query<{ context_manifest: ContextPacketManifest }>(
      `SELECT context_manifest FROM interaction_turns WHERE id = $1`,
      [turnId],
    );
    assert.equal(completed.rows[0].context_manifest.semantic_intent, 'project_fit');
    assert.equal((await loadCanonicalAnswerHistory(pool, {
      conversationId: fixture.conversationId,
      ownerPipeline: 'context_packet_v22',
      contextScopeId: taskId,
      includeConversation: false,
    })).length, 1);
    assert.equal((await loadContextTaskFrame(pool, fixture.conversationId))?.taskId, taskId);

    const failureTurnId = randomUUID();
    await pool.query(
      `INSERT INTO interaction_turns
        (id, access_session_id, conversation_id, workflow, audience_intent,
         question, status, created_at, delete_after)
       VALUES ($1,$2,$3,'chat','recruiter','failed context','running',$4,$5)`,
      [failureTurnId, fixture.sessionId, fixture.conversationId, now,
        new Date(now.getTime() + 10 * 24 * 60 * 60 * 1_000)],
    );
    const failedManifest = {
      ...builtManifest(randomUUID()),
      context_build_status: 'failed' as const,
      context_build_error_code: 'CONTEXT_SLOT_SOURCE_MISSING',
      packet_hmac_key_id: null,
      packet_hmac_sha256: null,
      evidence_ids: [],
      retrieval_scores: [],
    };
    await persistContextTerminalManifest(pool, {
      interactionTurnId: failureTurnId,
      conversationId: fixture.conversationId,
      contextScopeId: null,
      resolved: null,
      manifest: failedManifest,
    });
    const failure = await pool.query<{ context_manifest: ContextPacketManifest }>(
      `SELECT context_manifest FROM interaction_turns WHERE id = $1`,
      [failureTurnId],
    );
    assert.equal(failure.rows[0].context_manifest.context_build_status, 'failed');
    assert.equal((await loadContextTaskFrame(pool, fixture.conversationId))?.taskId, taskId);
  } finally {
    await pool.end();
    await database.dispose();
  }
});
