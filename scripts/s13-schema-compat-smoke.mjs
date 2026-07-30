import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postgresImage = 'pgvector/pgvector:pg16';
const allowedSchemas = new Set(['012', '013']);
const allowedFeatures = new Set(['off', 'on']);
const allowedProtocols = new Set(['responses', 'chat_completions']);
const optionNames = new Set([
  '--schema',
  '--feature',
  '--protocol',
  '--web-image',
  '--worker-image',
]);
let currentStage = 'SETUP';

class S13Error extends Error {
  constructor(code) {
    super(code);
    this.name = 'S13Error';
    this.code = code;
  }
}

function fail(code) {
  throw new S13Error(code);
}

function parseArguments(argv) {
  const values = new Map();
  for (const argument of argv) {
    const separator = argument.indexOf('=');
    if (separator <= 0) fail('S13_ARGUMENTS_INVALID');
    const name = argument.slice(0, separator);
    const value = argument.slice(separator + 1).trim();
    if (!optionNames.has(name) || values.has(name) || !value) fail('S13_ARGUMENTS_INVALID');
    values.set(name, value);
  }
  if (values.size !== optionNames.size) fail('S13_ARGUMENTS_INVALID');

  const schema = values.get('--schema');
  const feature = values.get('--feature');
  const protocol = values.get('--protocol');
  const webImage = values.get('--web-image');
  const workerImage = values.get('--worker-image');
  if (
    !allowedSchemas.has(schema)
    || !allowedFeatures.has(feature)
    || !allowedProtocols.has(protocol)
    || !validImageReference(webImage)
    || !validImageReference(workerImage)
  ) fail('S13_ARGUMENTS_INVALID');
  return { schema, feature, protocol, webImage, workerImage };
}

function validImageReference(value) {
  return typeof value === 'string'
    && value.length <= 512
    && !value.startsWith('-')
    && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

function ownedResourceNames(id) {
  const prefix = `revolution-s13-${id}`;
  return {
    prefix,
    network: `${prefix}-network`,
    db: `${prefix}-db`,
    mock: `${prefix}-mock`,
    web: `${prefix}-web`,
    worker: `${prefix}-worker`,
  };
}

function assertOwnedResource(name) {
  if (!/^revolution-s13-[0-9a-f]{12}-(?:network|db|mock|web|worker)$/u.test(name)) {
    fail('S13_CLEANUP_TARGET_INVALID');
  }
  return name;
}

function commandFailureReason(output) {
  if (/password authentication failed|authentication failed/iu.test(output)) return 'AUTH';
  if (/getaddrinfo|ENOTFOUND|EAI_AGAIN|name resolution/iu.test(output)) return 'DNS';
  if (/ECONNREFUSED|connection refused|could not connect/iu.test(output)) return 'CONNECTION';
  if (/permission denied|must be owner|not permitted/iu.test(output)) return 'PERMISSION';
  if (/ENOENT|no such file|cannot find/iu.test(output)) return 'FILE';
  if (/checksum/iu.test(output)) return 'CHECKSUM';
  if (/partial or incompatible|schema mismatch/iu.test(output)) return 'SCHEMA';
  if (/MORSE_[A-Z0-9_]+|DATABASE_[A-Z0-9_]+/u.test(output)) return 'CONFIG';
  return 'COMMAND';
}

async function command(executable, args, { allowFailure = false, env, timeoutMs = 120_000 } = {}) {
  const child = spawn(executable, args, {
    cwd: repoRoot,
    env: env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-32_000); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-32_000); });
  const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    if (!allowFailure && (result.code !== 0 || result.signal)) {
      fail(`S13_${currentStage}_${commandFailureReason(`${stdout}\n${stderr}`)}_FAILED`);
    }
    return { ...result, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

function docker(args, options) {
  return command('docker', args, options);
}

async function waitFor(check, attempts = 90) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(`S13_${currentStage}_TIMEOUT`);
}

async function copyMigrationPrefix(directory, schema) {
  const source = path.join(repoRoot, 'db', 'migrations');
  const entries = (await fs.readdir(source)).filter((name) => /^\d+[_-].+\.sql$/u.test(name));
  const selected = entries.filter((name) => BigInt(name.match(/^\d+/u)[0]) <= BigInt(schema));
  if (!selected.some((name) => name.startsWith(`${schema}_`))) fail('S13_MIGRATION_PREFIX_INVALID');
  await fs.mkdir(directory, { recursive: true });
  for (const name of selected) await fs.copyFile(path.join(source, name), path.join(directory, name));
}

function bindMount(source, target, readOnly = true) {
  const resolved = path.resolve(source);
  if (resolved.includes(',')) fail('S13_MOUNT_PATH_INVALID');
  return `type=bind,src=${resolved},dst=${target}${readOnly ? ',readonly' : ''}`;
}

async function writeSecret(directory, name, value) {
  const target = path.join(directory, name);
  await fs.writeFile(target, `${value}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') {
    await fs.chown(target, 999, 999);
  }
}

async function waitForPostgres(container) {
  await waitFor(async () => {
    const result = await docker(
      ['exec', container, 'pg_isready', '--username=postgres', '--dbname=revolution'],
      { allowFailure: true, timeoutMs: 5_000 },
    );
    return result.code === 0;
  });
}

async function waitForDatabaseLogin(network, migrationPassword) {
  await waitFor(async () => {
    const result = await docker([
      'run', '--rm', '--network', network,
      '--env', `PGPASSWORD=${migrationPassword}`,
      postgresImage,
      'psql', '--host=db', '--username=migration', '--dbname=revolution',
      '--tuples-only', '--command=SELECT 1',
    ], { allowFailure: true, timeoutMs: 10_000 });
    return result.code === 0 && result.stdout.trim() === '1';
  });
}

async function migrate({ network, webImage, migrationUrl, migrationsDirectory }) {
  await docker([
    'run', '--rm', '--network', network,
    '--env', `DATABASE_URL=${migrationUrl}`,
    '--env', 'NODE_ENV=test',
    '--env', 'MORSE_DATABASE_SSL_MODE=disable',
    '--env', 'MORSE_MIGRATIONS_DIR=/s13-migrations',
    '--mount', bindMount(migrationsDirectory, '/s13-migrations'),
    webImage,
    'node', 'scripts/migrate-db.mjs',
  ]);
}

async function grantAndVerify({ network, adminPassword, workerPassword }) {
  await docker([
    'run', '--rm', '--network', network,
    '--env', `PGPASSWORD=${adminPassword}`,
    '--env', `S13_WORKER_PASSWORD=${workerPassword}`,
    '--mount', bindMount(path.join(repoRoot, 'deploy', 'postgres', 'grant-runtime.sql'), '/grant-runtime.sql'),
    '--mount', bindMount(path.join(repoRoot, 'deploy', 'postgres', 'verify-ai-config-runtime.sql'), '/verify-ai-config-runtime.sql'),
    postgresImage,
    'sh', '-eu', '-c',
    'psql --host=db --username=postgres --dbname=revolution --set=worker_password="$S13_WORKER_PASSWORD" --file=/grant-runtime.sql; psql --host=db --username=postgres --dbname=revolution --file=/verify-ai-config-runtime.sql',
  ]);
}

const seedSource = String.raw`
  import pg from 'pg';
  import { randomUUID, createHash } from 'node:crypto';
  import { createDeterministicTestEmbedding, serializeVector } from './lib/server/embedding.ts';
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const inviteCode = process.env.S13_INVITE_CODE;
  const question = process.env.S13_QUESTION;
  const documentId = 's13-schema-compat';
  try {
    await client.query(
      'INSERT INTO knowledge_documents (id,title,source_path,checksum) VALUES ($1,$2,$3,$4)',
      [documentId, 'S13 schema compatibility', 's13://schema-compat', 'a'.repeat(64)],
    );
    await client.query(
      'INSERT INTO knowledge_chunks (id,document_id,ordinal,content,embedding,metadata) VALUES ($1,$2,0,$3,$4,$5::jsonb)',
      ['s13-schema-compat-0', documentId, question,
       serializeVector(createDeterministicTestEmbedding(question)),
       JSON.stringify({ title: 'S13 schema compatibility', href: '/works' })],
    );
    await client.query(
      "INSERT INTO invite_codes (id,code_hash,label,active,expires_at,max_sessions,session_count) VALUES ($1,$2,'s13-schema-compat',true,now()+interval '1 hour',1,0)",
      [randomUUID(), createHash('sha256').update(inviteCode).digest('hex')],
    );
  } finally {
    await client.end();
  }
`;

async function seedDatabase({ network, webImage, migrationUrl, inviteCode, question }) {
  await docker([
    'run', '--rm', '--network', network,
    '--env', `DATABASE_URL=${migrationUrl}`,
    '--env', `S13_INVITE_CODE=${inviteCode}`,
    '--env', `S13_QUESTION=${question}`,
    webImage,
    'node', '--input-type=module', '-e', seedSource,
  ]);
}

const workerSource = String.raw`
  import { createDatabasePool } from './lib/server/db.ts';
  import { runWorker } from './scripts/worker.mjs';
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  const pool = createDatabasePool(process.env.DATABASE_URL_WORKER, {
    env: process.env,
    role: 'worker',
  });
  await runWorker({ pool, env: process.env, signal: controller.signal });
`;

async function startServices(input) {
  await docker([
    'run', '-d', '--name', input.names.worker, '--network', input.names.network,
    '--env', `DATABASE_URL_WORKER=${input.workerUrl}`,
    '--env', 'NODE_ENV=test',
    '--env', 'MORSE_DATABASE_SSL_MODE=disable',
    '--env', 'MORSE_ALERTS_ENABLED=false',
    '--env', 'MORSE_WORKER_HEARTBEAT_FILE=/tmp/s13-worker-heartbeat',
    input.workerImage,
    'node', '--input-type=module', '-e', workerSource,
  ]);

  const featureEnabled = input.feature === 'on';
  const contextDigestKey = Buffer.alloc(32, 13).toString('base64');
  const webEnvironment = [
    `DATABASE_URL=${input.runtimeUrl}`,
    'NODE_ENV=test',
    'MORSE_DATABASE_SSL_MODE=disable',
    'MORSE_LOCAL_RELEASE_SMOKE=true',
    'MORSE_PUBLIC_ORIGIN=http://127.0.0.1:3000',
    'MORSE_ADMIN_ALLOWED_ORIGIN=http://127.0.0.1:3000',
    'MORSE_ADMIN_PASSWORD_HASH=s13-local-only',
    'MORSE_INVITE_FINGERPRINT_SECRET=s13-invite-fingerprint-secret-32-bytes',
    'MORSE_INVITE_TRUSTED_PROXY_HOPS=0',
    'OPENAI_API_KEY=s13-mock-key',
    'OPENAI_BASE_URL=http://127.0.0.1:18090/v1',
    `OPENAI_CHAT_MODEL=${input.protocol === 'responses' ? 'gpt-mock-responses' : 'gpt-mock-chat'}`,
    `OPENAI_CHAT_PROTOCOL=${input.protocol}`,
    'OPENAI_REASONING_EFFORT=high',
    'OPENAI_EMBEDDING_API_KEY=s13-mock-key',
    'OPENAI_EMBEDDING_BASE_URL=http://127.0.0.1:18090/v1',
    'OPENAI_EMBEDDING_MODEL=s13-mock-embedding',
    'MORSE_CHAT_ENABLED=true',
    'MORSE_SEARCH_ENABLED=false',
    `MORSE_DYNAMIC_PROVIDER_CONTEXT_ENABLED=${featureEnabled}`,
    'MORSE_CHAT_CONTEXT_WINDOW_TOKENS=128000',
    'MORSE_MAX_OUTPUT_TOKENS=4096',
    `MORSE_CONTEXT_PACKET_DIGEST_KEY=${contextDigestKey}`,
    'MORSE_CONTEXT_PACKET_DIGEST_KEY_ID=s13-context-v1',
    'MORSE_PROVIDER_MOCK_ORIGIN=http://127.0.0.1:18090',
    'MORSE_MOCK_OPENAI_PORT=18090',
    'MORSE_MOCK_OPENAI_API_KEY=s13-mock-key',
  ];
  const args = [
    'run', '-d', '--name', input.names.web, '--network', input.names.network,
    '--network-alias', 'web',
  ];
  for (const value of webEnvironment) args.push('--env', value);
  args.push(
    input.webImage,
    'sh', '-eu', '-c',
    'node scripts/mock-openai.mjs & exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 3000',
  );
  await docker(args);
}

async function probeStatus(container, pathname) {
  const source = `const response=await fetch('http://127.0.0.1:3000${pathname}');console.log(response.status);`;
  const result = await docker(
    ['exec', container, 'node', '--input-type=module', '-e', source],
    { allowFailure: true, timeoutMs: 10_000 },
  );
  return result.code === 0 ? Number(result.stdout.trim().split(/\s+/u).at(-1)) : 0;
}

const chatProbeSource = String.raw`
  import { randomUUID } from 'node:crypto';
  const access = await fetch('http://127.0.0.1:3000/api/access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: process.env.S13_INVITE_CODE }),
  });
  if (access.status !== 200) throw new Error('S13_ACCESS_FAILED');
  const cookie = (access.headers.get('set-cookie') ?? '').split(';', 1)[0];
  if (!cookie) throw new Error('S13_ACCESS_COOKIE_MISSING');
  const message = (process.env.S13_QUESTION + ' ').repeat(900);
  const chat = await fetch('http://127.0.0.1:3000/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ workflow: 'chat', message, turnId: randomUUID() }),
  });
  const text = await chat.text();
  if (text.includes('CHAT_NOT_CONFIGURED')) throw new Error('S13_CHAT_NOT_CONFIGURED');
  if (text.includes('CHAT_DISABLED')) throw new Error('S13_CHAT_DISABLED');
  if (text.includes('ACCESS_REQUIRED')) throw new Error('S13_CHAT_ACCESS_REQUIRED');
  if (chat.status !== 200) throw new Error('S13_CHAT_STATUS_' + chat.status);
  if (!text.includes('data:')) throw new Error('S13_CHAT_STREAM_INVALID');
  console.log(JSON.stringify({ status: chat.status, bytes: text.length }));
`;

async function runChatProbe(container, inviteCode, question) {
  const result = await docker([
    'exec',
    '--env', `S13_INVITE_CODE=${inviteCode}`,
    '--env', `S13_QUESTION=${question}`,
    container,
    'node', '--input-type=module', '-e', chatProbeSource,
  ], { allowFailure: true, timeoutMs: 120_000 });
  if (result.code === 0 && !result.signal) return;
  const output = `${result.stdout}\n${result.stderr}`;
  for (const code of [
    'S13_ACCESS_FAILED',
    'S13_ACCESS_COOKIE_MISSING',
    'S13_CHAT_FAILED',
    'S13_CHAT_STATUS_400',
    'S13_CHAT_STATUS_401',
    'S13_CHAT_STATUS_429',
    'S13_CHAT_STATUS_500',
    'S13_CHAT_STATUS_503',
    'S13_CHAT_STREAM_INVALID',
    'S13_CHAT_NOT_CONFIGURED',
    'S13_CHAT_DISABLED',
    'S13_CHAT_ACCESS_REQUIRED',
  ]) {
    if (output.includes(code)) fail(code);
  }
  fail('S13_CHAT_PROBE_FAILED');
}

async function removeOwnedResources(names, tempDirectory) {
  for (const container of [names.web, names.worker, names.mock, names.db]) {
    await docker(['rm', '--force', assertOwnedResource(container)], {
      allowFailure: true,
      timeoutMs: 30_000,
    });
  }
  await docker(['network', 'rm', assertOwnedResource(names.network)], {
    allowFailure: true,
    timeoutMs: 30_000,
  });
  const resolvedTemp = path.resolve(tempDirectory);
  const expectedPrefix = path.resolve(os.tmpdir(), 'revolution-s13-');
  if (!resolvedTemp.startsWith(expectedPrefix)) fail('S13_CLEANUP_TARGET_INVALID');
  await fs.rm(resolvedTemp, { force: true, recursive: true });
}

export async function runSchemaCompatibilitySmoke(options) {
  const id = randomUUID().replaceAll('-', '').slice(0, 12);
  const names = ownedResourceNames(id);
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'revolution-s13-'));
  const migrationsDirectory = path.join(tempDirectory, 'migrations');
  const secretsDirectory = path.join(tempDirectory, 'secrets');
  const adminPassword = randomBytes(24).toString('hex');
  const runtimePassword = randomBytes(24).toString('hex');
  const workerPassword = randomBytes(24).toString('hex');
  const migrationPassword = randomBytes(24).toString('hex');
  const ingestPassword = randomBytes(24).toString('hex');
  const backupPassword = randomBytes(24).toString('hex');
  const inviteCode = `s13-${randomBytes(18).toString('base64url')}`;
  const question = 'How does the evidence system preserve traceability?';
  const url = (user, password) => `postgresql://${user}:${password}@db:5432/revolution`;

  try {
    currentStage = 'MIGRATION_PREFIX';
    await copyMigrationPrefix(migrationsDirectory, options.schema);
    await fs.mkdir(secretsDirectory, { recursive: true });
    await Promise.all([
      writeSecret(secretsDirectory, 'db_runtime_password', runtimePassword),
      writeSecret(secretsDirectory, 'db_worker_password', workerPassword),
      writeSecret(secretsDirectory, 'db_migration_password', migrationPassword),
      writeSecret(secretsDirectory, 'db_ingest_password', ingestPassword),
      writeSecret(secretsDirectory, 'db_backup_password', backupPassword),
    ]);

    currentStage = 'IMAGE_INSPECT';
    for (const image of [postgresImage, options.webImage, options.workerImage]) {
      await docker(['image', 'inspect', image]);
    }
    currentStage = 'NETWORK_CREATE';
    await docker(['network', 'create', '--internal', names.network]);
    currentStage = 'DATABASE_START';
    await docker([
      'run', '-d', '--name', names.db, '--network', names.network, '--network-alias', 'db',
      '--env', 'POSTGRES_DB=revolution',
      '--env', 'POSTGRES_USER=postgres',
      '--env', `POSTGRES_PASSWORD=${adminPassword}`,
      '--env', 'MORSE_DB_RUNTIME_PASSWORD_FILE=/run/secrets/db_runtime_password',
      '--env', 'MORSE_DB_WORKER_PASSWORD_FILE=/run/secrets/db_worker_password',
      '--env', 'MORSE_DB_MIGRATION_PASSWORD_FILE=/run/secrets/db_migration_password',
      '--env', 'MORSE_DB_INGEST_PASSWORD_FILE=/run/secrets/db_ingest_password',
      '--env', 'MORSE_DB_BACKUP_PASSWORD_FILE=/run/secrets/db_backup_password',
      '--mount', bindMount(secretsDirectory, '/run/secrets'),
      '--mount', bindMount(path.join(repoRoot, 'deploy', 'postgres', 'init', '01-roles.sh'), '/docker-entrypoint-initdb.d/01-roles.sh'),
      postgresImage,
    ]);
    currentStage = 'DATABASE_READY';
    await waitForPostgres(names.db);
    currentStage = 'DATABASE_LOGIN';
    await waitForDatabaseLogin(names.network, migrationPassword);

    const migrationUrl = url('migration', migrationPassword);
    const runtimeUrl = url('runtime', runtimePassword);
    const workerUrl = url('worker', workerPassword);
    currentStage = 'MIGRATION';
    await migrate({
      network: names.network,
      webImage: options.webImage,
      migrationUrl,
      migrationsDirectory,
    });
    currentStage = 'GRANTS_VERIFY';
    await grantAndVerify({ network: names.network, adminPassword, workerPassword });
    currentStage = 'SEED';
    await seedDatabase({
      network: names.network,
      webImage: options.webImage,
      migrationUrl,
      inviteCode,
      question,
    });
    currentStage = 'SERVICES_START';
    await startServices({
      ...options,
      names,
      runtimeUrl,
      workerUrl,
    });

    currentStage = 'LIVE';
    await waitFor(async () => await probeStatus(names.web, '/api/health/live') === 200);
    const readinessStatus = options.schema === '012' && options.feature === 'on' ? 503 : 200;
    currentStage = 'READY';
    await waitFor(async () => await probeStatus(names.web, '/api/health/ready') === readinessStatus);
    currentStage = 'WORKER';
    await waitFor(async () => {
      const heartbeat = await docker(
        ['exec', names.worker, 'test', '-s', '/tmp/s13-worker-heartbeat'],
        { allowFailure: true, timeoutMs: 5_000 },
      );
      return heartbeat.code === 0;
    });
    if (readinessStatus === 200) {
      currentStage = 'CHAT';
      await runChatProbe(names.web, inviteCode, question);
    }

    return {
      externalCalls: 0,
      feature: options.feature,
      isolatedNetwork: true,
      protocol: options.protocol,
      readinessStatus,
      schema: options.schema,
      webImage: options.webImage,
      workerImage: options.workerImage,
    };
  } finally {
    await removeOwnedResources(names, tempDirectory);
  }
}

export async function main({ argv = process.argv.slice(2), logger = console } = {}) {
  const result = await runSchemaCompatibilitySmoke(parseArguments(argv));
  logger.log(JSON.stringify(result));
  return result;
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof S13Error ? error.code : 'S13_SMOKE_FAILED');
    process.exitCode = 1;
  });
}
