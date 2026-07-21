import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const composePath = path.resolve('compose.production.yaml');
const envPath = path.resolve('.env.example');
const privilegePath = path.resolve('deploy/postgres/verify-ai-config-runtime.sql');

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
    'ai_route_targets', 'ai_runtime_state', 'ai_config_events',
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
