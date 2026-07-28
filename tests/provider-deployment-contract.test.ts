import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const composePath = path.resolve('compose.production.yaml');
const envPath = path.resolve('.env.example');
const privilegePath = path.resolve('deploy/postgres/verify-ai-config-runtime.sql');

test('dynamic-context rollout migrates every active provider target to v2 before deleting legacy limits', () => {
  for (const runbook of ['docs/runbooks/production.md', 'docs/runbooks/tencent-lighthouse.md']) {
    const source = fs.readFileSync(path.resolve(runbook), 'utf8');
    const v2Gate = source.indexOf('config_digest_version = 2');
    const legacyLimit = runbook.endsWith('production.md')
      ? 'MORSE_MAX_OUTPUT_TOKENS'
      : '输出固定上限变量';
    const legacyRemoval = source.indexOf(legacyLimit, v2Gate);
    assert.ok(v2Gate >= 0, `${runbook} must require the active V2 route gate`);
    assert.ok(legacyRemoval > v2Gate, `${runbook} must gate legacy limit removal behind V2 activation`);
  }
});

test('provider configuration master key is declared empty and mounted only into web', () => {
  const compose = fs.readFileSync(composePath, 'utf8');
  const environment = fs.readFileSync(envPath, 'utf8');

  assert.match(environment, /^MORSE_PROVIDER_CONFIG_KEY=$/mu);
  assert.match(environment, /^MORSE_PROVIDER_CONFIG_KEY_FILE=$/mu);
  assert.match(environment, /^MORSE_PROVIDER_CONFIG_KEY_VERSION=1$/mu);
  assert.match(compose, /provider_config_key:\s*\n\s+file: \.\/deploy\/secrets\/provider_config_key/u);

  const web = compose.match(/\n  web:[\s\S]*?\n  worker:/u)?.[0] ?? '';
  const worker = compose.match(/\n  worker:[\s\S]*?\n  grants:/u)?.[0] ?? '';
  const migration = compose.match(/\n  migration:[\s\S]*?\n  ingest:/u)?.[0] ?? '';
  const ingest = compose.match(/\n  ingest:[\s\S]*?\n  web:/u)?.[0] ?? '';
  assert.match(web, /MORSE_PROVIDER_CONFIG_KEY_FILE: \/run\/secrets\/provider_config_key/u);
  assert.match(web, /\n\s+secrets:[\s\S]*?- provider_config_key/u);
  for (const service of [worker, migration, ingest]) {
    assert.doesNotMatch(service, /provider_config_key/u);
  }
});

test('runtime privilege verification covers every provider configuration table and sequence', () => {
  assert.equal(fs.existsSync(privilegePath), true);
  const sql = fs.readFileSync(privilegePath, 'utf8');
  for (const table of ['ai_connections', 'ai_model_presets', 'ai_route_revisions',
    'ai_route_targets', 'ai_runtime_state', 'ai_config_events', 'ai_environment_takeovers',
    'interaction_provider_attempts']) assert.match(sql, new RegExp(`\\b${table}\\b`, 'u'));
  assert.match(sql, /ai_config_events_id_seq/u);
  assert.match(sql, /has_table_privilege/u);
  assert.match(sql, /has_sequence_privilege/u);
  assert.match(sql, /forbidden_privileges/u);
  assert.match(sql, /ai_runtime_state[^;]*INSERT|INSERT[^;]*ai_runtime_state/isu);
  assert.match(sql, /ai_config_events[^;]*UPDATE|UPDATE[^;]*ai_config_events/isu);
  assert.match(sql, /ai_route_revisions[^;]*UPDATE|UPDATE[^;]*ai_route_revisions/isu);
});

test('grant script narrows provider tables after broad migration defaults', () => {
  const sql = fs.readFileSync(path.resolve('deploy/postgres/grant-runtime.sql'), 'utf8');
  const roles = fs.readFileSync(path.resolve('deploy/postgres/init/01-roles.sh'), 'utf8');
  assert.match(sql, /REVOKE ALL[\s\S]*ai_config_events[\s\S]*FROM runtime/iu);
  assert.match(sql, /GRANT SELECT, INSERT, DELETE[\s\S]*ai_config_events[\s\S]*TO runtime/iu);
  assert.doesNotMatch(sql, /GRANT[^;]*UPDATE[^;]*ai_config_events/iu);
  assert.doesNotMatch(sql, /GRANT[^;]*(?:UPDATE|DELETE)[^;]*ai_route_revisions/iu);
  assert.doesNotMatch(
    roles,
    /ALTER DEFAULT PRIVILEGES[\s\S]*GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO runtime/iu,
  );
  assert.match(
    sql,
    /ALTER DEFAULT PRIVILEGES FOR ROLE migration[\s\S]*REVOKE ALL PRIVILEGES ON TABLES FROM runtime/iu,
  );
});

test('runtime can create and release environment takeovers but cannot delete history', () => {
  const grants = fs.readFileSync(path.resolve('deploy/postgres/grant-runtime.sql'), 'utf8');
  const verification = fs.readFileSync(privilegePath, 'utf8');

  assert.match(
    grants,
    /REVOKE ALL PRIVILEGES ON TABLE[\s\S]*\bai_environment_takeovers\b[\s\S]*FROM runtime/iu,
  );
  assert.match(
    grants,
    /GRANT SELECT, INSERT, UPDATE\s+ON TABLE ai_environment_takeovers\s+TO runtime/iu,
  );
  assert.doesNotMatch(
    grants,
    /GRANT[^;]*DELETE[^;]*ON TABLE[^;]*\bai_environment_takeovers\b/iu,
  );

  for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) {
    assert.match(
      verification,
      new RegExp(`\\('runtime', 'ai_environment_takeovers', '${privilege}'\\)`, 'u'),
    );
  }
  assert.match(verification, /\('runtime', 'ai_environment_takeovers', 'DELETE'\)/u);
});

test('production topology gives the worker a distinct database principal and secret', () => {
  const compose = fs.readFileSync(composePath, 'utf8');
  const environment = fs.readFileSync(envPath, 'utf8');
  const roles = fs.readFileSync(path.resolve('deploy/postgres/init/01-roles.sh'), 'utf8');
  const web = compose.match(/\n  web:[\s\S]*?\n  worker:/u)?.[0] ?? '';
  const worker = compose.match(/\n  worker:[\s\S]*?\n  grants:/u)?.[0] ?? '';
  const db = compose.match(/\n  db:[\s\S]*?\n  resume-storage-init:/u)?.[0] ?? '';

  assert.match(environment, /^DATABASE_URL_WORKER=postgresql:\/\/worker@127\.0\.0\.1:55432\/revolution$/mu);
  assert.match(web, /DATABASE_URL: \$\{DATABASE_URL_RUNTIME\}/u);
  assert.match(worker, /DATABASE_URL_WORKER: \$\{DATABASE_URL_WORKER\}/u);
  assert.doesNotMatch(worker, /DATABASE_URL_RUNTIME|db_runtime_password/u);
  assert.match(db, /MORSE_DB_WORKER_PASSWORD_FILE: \/run\/secrets\/db_worker_password/u);
  assert.match(db, /- db_worker_password/u);
  assert.match(compose, /^  db_worker_password:\r?\n    file: \.\/deploy\/secrets\/db_worker_password$/mu);

  assert.match(roles, /worker_password=.*db_worker_password/u);
  assert.match(roles, /CREATE ROLE worker LOGIN/u);
  assert.match(roles, /ALTER ROLE worker PASSWORD :'worker_password' NOSUPERUSER/u);
  assert.match(roles, /GRANT CONNECT ON DATABASE revolution TO[^;]*\bworker\b/u);
});

test('schema-aware grants enforce the exact runtime and worker compaction boundary', () => {
  const grants = fs.readFileSync(path.resolve('deploy/postgres/grant-runtime.sql'), 'utf8');
  const verification = fs.readFileSync(privilegePath, 'utf8');
  const compose = fs.readFileSync(composePath, 'utf8');
  const grantsService = compose.match(/\n  grants:[\s\S]*?\n  edge:/u)?.[0] ?? '';

  assert.match(grants, /to_regclass\('public\.conversation_history_compactions'\)/u);
  assert.match(grants, /to_regclass\('public\.chat_history_summary_attempts'\)/u);
  assert.match(grants, /REVOKE ALL ON public\.conversation_history_compactions, public\.chat_history_summary_attempts FROM runtime, worker/u);
  assert.match(grants, /GRANT SELECT, INSERT ON public\.conversation_history_compactions TO runtime/u);
  assert.match(grants, /GRANT SELECT, INSERT, UPDATE ON public\.chat_history_summary_attempts TO runtime/u);
  assert.match(grants, /GRANT SELECT \(interaction_turn_id, delete_after\) ON public\.chat_history_summary_attempts TO worker/u);
  assert.match(grants, /GRANT SELECT \(conversation_id, delete_after\) ON public\.conversation_history_compactions TO worker/u);
  assert.match(grants, /GRANT EXECUTE ON FUNCTION public\.cleanup_expired_chat_history_compactions\(\) TO worker/u);
  assert.match(grants, /GRANT SELECT \(id, access_session_id\) ON TABLE conversations TO worker/u);
  assert.match(grants, /REVOKE ALL ON FUNCTION public\.purge_chat_session_for_privacy\(uuid\) FROM PUBLIC, runtime, worker/u);
  assert.doesNotMatch(
    grants,
    /GRANT[^;]*\b(?:INSERT|UPDATE|DELETE)\b[^;]*chat_history[^;]*TO worker/iu,
  );

  for (const token of [
    'conversation_history_compactions',
    'chat_history_summary_attempts',
    'cleanup_expired_chat_history_compactions',
    'purge_chat_session_for_privacy',
    'procedure.proowner',
    'migration.rolsuper',
  ]) assert.match(verification, new RegExp(token.replace('.', '\\.'), 'u'));
  assert.match(grantsService, /db_worker_password/u);
  assert.match(grantsService, /verify-ai-config-runtime\.sql/u);
  assert.match(grantsService, /grant-runtime\.sql[\s\S]*verify-ai-config-runtime\.sql/u);
});
