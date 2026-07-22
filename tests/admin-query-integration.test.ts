import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';

import pg from 'pg';

import {
  getAdminTurn,
  listAdminTurns,
  normalizeAdminTurnFilters,
  updateAdminBadcase,
} from '../lib/server/admin-query.ts';
import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Pool } = pg;
const repoRoot = path.resolve('.');
const migrationRunner = path.join(repoRoot, 'scripts', 'migrate-db.mjs');
const now = new Date('2035-03-08T12:00:00.000Z');

let database: Awaited<ReturnType<typeof createDisposablePostgresDatabase>>;
let pool: InstanceType<typeof Pool>;
let chatTurnId = '';
let jdTurnId = '';
let diagnosisTurnId = '';
const trackedInviteId = randomUUID();
const trackedSessionId = randomUUID();
const trackedInviteLabel = '星河科技招聘';

async function runMigrations(connectionString: string): Promise<void> {
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [migrationRunner], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
}

async function seedTurn(input: {
  id?: string;
  workflow: 'chat' | 'jd_match' | 'diagnosis';
  status: 'completed' | 'failed' | 'stopped';
  question: string;
  answer?: string | null;
  usedSearch?: boolean;
  badcase?: boolean;
  accessSessionId?: string;
  inviteLabel?: string | null;
  createdAt: Date;
  deleteAfter: Date;
}): Promise<string> {
  const id = input.id ?? randomUUID();
  await pool.query(
    `INSERT INTO interaction_turns
      (id, access_session_id, conversation_id, workflow, audience_intent,
       question, answer, status, error_code, knowledge_sources,
       input_tokens, output_tokens, estimated_cost_usd, provider, model,
       latency_ms, used_search, badcase, created_at, completed_at, delete_after,
       invite_label)
     VALUES ($1, $2, $3, $4, 'general', $5, $6, $7, $8, $9::jsonb,
             $10, $11, $12, 'openai', 'configured-model', 120,
             $13, $14, $15, $15, $16, $17)`,
    [
      id,
      input.accessSessionId ?? randomUUID(),
      randomUUID(),
      input.workflow,
      input.question,
      input.answer ?? null,
      input.status,
      input.status === 'failed' ? 'PROVIDER_UNAVAILABLE' : null,
      JSON.stringify([{
        id: 'local-1',
        title: '公开证据',
        href: '/works/deep-research',
        kind: 'local',
        domain: null,
        score: 0.8,
      }]),
      input.status === 'completed' ? 100 : null,
      input.status === 'completed' ? 20 : null,
      input.status === 'completed' ? 0.00014 : null,
      input.usedSearch ?? false,
      input.badcase ?? false,
      input.createdAt,
      input.deleteAfter,
      input.inviteLabel ?? null,
    ],
  );
  return id;
}

before(async () => {
  database = await createDisposablePostgresDatabase();
  await runMigrations(database.connectionString);
  pool = new Pool({ connectionString: database.connectionString });

  await pool.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count, created_at)
     VALUES ($1, $2, $3, true, $4, 1, 1, $5)`,
    [
      trackedInviteId,
      'a'.repeat(64),
      trackedInviteLabel,
      new Date(now.getTime() + 24 * 60 * 60 * 1000),
      now,
    ],
  );
  await pool.query(
    `INSERT INTO access_sessions
      (id, invite_code_id, token_hash, expires_at, created_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [
      trackedSessionId,
      trackedInviteId,
      'b'.repeat(64),
      new Date(now.getTime() + 12 * 60 * 60 * 1000),
      now,
    ],
  );

  chatTurnId = await seedTurn({
    workflow: 'chat',
    status: 'completed',
    question: '介绍深度研究系统',
    answer: '基于公开证据回答。',
    accessSessionId: trackedSessionId,
    inviteLabel: trackedInviteLabel,
    createdAt: new Date(now.getTime() - 30 * 60 * 1000),
    deleteAfter: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  });
  jdTurnId = await seedTurn({
    workflow: 'jd_match',
    status: 'failed',
    question: 'Agent 工程师 JD',
    usedSearch: true,
    badcase: true,
    createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    deleteAfter: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  });
  diagnosisTurnId = await seedTurn({
    workflow: 'diagnosis',
    status: 'completed',
    question: '问题：需要整理需求',
    answer: '初诊完成。',
    createdAt: new Date(now.getTime() - 90 * 60 * 1000),
    deleteAfter: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  });
  await seedTurn({
    workflow: 'chat',
    status: 'completed',
    question: '十天外的原文',
    answer: '不得出现在管理查询。',
    createdAt: new Date(now.getTime() - 11 * 24 * 60 * 60 * 1000),
    deleteAfter: new Date(now.getTime() - 1),
  });
  await seedTurn({
    workflow: 'chat',
    status: 'completed',
    question: '未来记录',
    answer: '不得提前出现。',
    createdAt: new Date(now.getTime() + 60 * 60 * 1000),
    deleteAfter: new Date(now.getTime() + 11 * 24 * 60 * 60 * 1000),
  });

  await pool.query(
    `INSERT INTO interaction_searches
      (id, interaction_turn_id, query, route_reason, status, results,
       error_code, created_at, delete_after)
     VALUES ($1, $2, 'OpenAI latest API', 'recency', 'failed', '[]'::jsonb,
             'SEARCH_FAILED', $3, $4)`,
    [
      randomUUID(),
      jdTurnId,
      new Date(now.getTime() - 59 * 60 * 1000),
      new Date(now.getTime() + 24 * 60 * 60 * 1000),
    ],
  );
  await pool.query(
    `INSERT INTO diagnoses
      (id, interaction_turn_id, access_session_id, conversation_id,
       fields, summary, status, notification_status,
       created_at, completed_at, delete_after)
     SELECT $1, turn.id, turn.access_session_id, turn.conversation_id,
            $2::jsonb, '问题：需要整理需求', 'handoff_pending', 'pending',
            turn.created_at, turn.completed_at, turn.delete_after
       FROM interaction_turns AS turn
      WHERE turn.id = $3`,
    [
      randomUUID(),
      JSON.stringify({
        problem: '需要整理需求',
        goal: '形成方案',
        currentState: '已有草稿',
        constraints: '仅使用公开资料',
        expectedTimeline: '排期待确认',
      }),
      diagnosisTurnId,
    ],
  );
});

after(async () => {
  await pool?.end();
  await database?.dispose();
});

test('normalizeAdminTurnFilters rejects unknown values and bounds pagination', () => {
  const defaults = {
    workflow: null,
    status: null,
    usedSearch: null,
    badcase: null,
    from: null,
    to: null,
    page: 1,
    limit: 20,
  };
  assert.deepEqual(normalizeAdminTurnFilters({}), defaults);
  assert.deepEqual(normalizeAdminTurnFilters({
    workflow: '',
    status: '',
    usedSearch: '',
    badcase: '',
    from: '',
    to: '',
    page: '',
    limit: '',
  }), defaults);
  assert.throws(() => normalizeAdminTurnFilters({ workflow: 'other' }), /workflow/i);
  assert.throws(() => normalizeAdminTurnFilters({ status: 'unknown' }), /status/i);
  assert.throws(() => normalizeAdminTurnFilters({ usedSearch: 'yes' }), /usedSearch/i);
  assert.throws(() => normalizeAdminTurnFilters({ page: 0 }), /page/i);
  assert.throws(() => normalizeAdminTurnFilters({ limit: 101 }), /limit/i);
  assert.throws(
    () => normalizeAdminTurnFilters({ from: '2035-03-09', to: '2035-03-08' }),
    /from.*to/i,
  );
});

test('listAdminTurns enforces the live ten-day boundary, filters, and stable pagination', async () => {
  const all = await listAdminTurns(pool, { now, page: 1, limit: 2 });
  assert.equal(all.total, 3);
  assert.equal(all.page, 1);
  assert.equal(all.limit, 2);
  assert.deepEqual(all.items.map((item) => item.id), [chatTurnId, jdTurnId]);
  assert.equal(all.items[0].inviteLabel, trackedInviteLabel);
  assert.equal(all.items[1].inviteLabel, null);
  assert.equal(all.items.some((item) => item.question.includes('十天外')), false);
  assert.equal(all.items.some((item) => item.question.includes('未来')), false);

  const secondPage = await listAdminTurns(pool, { now, page: 2, limit: 2 });
  assert.deepEqual(secondPage.items.map((item) => item.id), [diagnosisTurnId]);

  const filtered = await listAdminTurns(pool, {
    now,
    workflow: 'jd_match',
    status: 'failed',
    usedSearch: true,
    badcase: true,
  });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].id, jdTurnId);
  assert.equal(filtered.items[0].errorCode, 'PROVIDER_UNAVAILABLE');
  assert.equal(filtered.items[0].answer, null);
});

test('getAdminTurn returns raw analysis detail with joined search and diagnosis state', async () => {
  const jd = await getAdminTurn(pool, jdTurnId, now);
  assert.equal(jd?.question, 'Agent 工程师 JD');
  assert.equal(jd?.search?.query, 'OpenAI latest API');
  assert.equal(jd?.search?.status, 'failed');
  assert.equal(jd?.search?.errorCode, 'SEARCH_FAILED');
  assert.deepEqual(jd?.search?.results, []);
  assert.equal(jd?.diagnosis, null);

  const attributed = await getAdminTurn(pool, chatTurnId, now);
  assert.equal(attributed?.inviteLabel, trackedInviteLabel);

  const diagnosis = await getAdminTurn(pool, diagnosisTurnId, now);
  assert.equal(diagnosis?.diagnosis?.status, 'handoff_pending');
  assert.equal(diagnosis?.diagnosis?.fields.problem, '需要整理需求');
  assert.equal(diagnosis?.search, null);
  assert.equal(await getAdminTurn(pool, randomUUID(), now), null);
});

test('invite attribution survives deletion of the visitor session', async () => {
  await pool.query('DELETE FROM access_sessions WHERE id = $1', [trackedSessionId]);

  const list = await listAdminTurns(pool, { now, page: 1, limit: 20 });
  const attributed = list.items.find((item) => item.id === chatTurnId);
  assert.equal(attributed?.inviteLabel, trackedInviteLabel);
  assert.equal((await getAdminTurn(pool, chatTurnId, now))?.inviteLabel, trackedInviteLabel);
});

test('updateAdminBadcase validates notes and updates only a live turn', async () => {
  assert.throws(
    () => updateAdminBadcase({ pool, turnId: chatTurnId, badcase: true, note: '注'.repeat(2_001), now }),
    /2,000/,
  );
  const updated = await updateAdminBadcase({
    pool,
    turnId: chatTurnId,
    badcase: true,
    note: '  引用不足，需要补充证据。  ',
    now,
  });
  assert.equal(updated?.badcase, true);
  assert.equal(updated?.adminNote, '引用不足，需要补充证据。');

  const cleared = await updateAdminBadcase({
    pool,
    turnId: chatTurnId,
    badcase: false,
    note: '',
    now,
  });
  assert.equal(cleared?.badcase, false);
  assert.equal(cleared?.adminNote, null);
  assert.equal(await updateAdminBadcase({
    pool,
    turnId: randomUUID(),
    badcase: true,
    note: null,
    now,
  }), null);
});
