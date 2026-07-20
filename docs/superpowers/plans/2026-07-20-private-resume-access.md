# Private Resume Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在公开作品集保留简洁的“简历模式”入口，同时用独立邀请码、服务端 Session 和 AES-256-GCM 私有存储保护唯一一份当前 PDF，确保简历内容不进入公开页面、Git、RAG、Provider、日志或验收截图。

**Architecture:** 聊天权限与简历权限完全分离；简历功能建立独立的数据库表、Cookie、API 和服务端授权域。Web 进程只在鉴权成功后从工作区外的私有目录读取并解密当前 PDF；管理员通过现有后台完成密码复验后上传、换版、创建邀请码和撤销 Session，Worker 只清理数据库保留期与无引用密文。

**Tech Stack:** Next.js App Router、React 19、TypeScript、PostgreSQL 16、Node.js `crypto` AES-256-GCM、CSS Modules、Node test runner、Docker Compose、Playwright/CDP 视觉冒烟

---

## StagePacket

```yaml
stage: private-resume-access
outcome: authorized visitors can view the current encrypted PDF while public and chat surfaces cannot obtain resume data
controls:
  execution: STAGED
  risk: CRITICAL
  delivery: DEPLOYED
state: CONTRACT
preset: null
scope:
  owned:
    - db/migrations/003_private_resume.sql
    - lib/server/resume-*.ts
    - app/api/resume/**
    - app/api/admin/resume/**
    - components/ResumeMode.tsx
    - components/ResumeMode.module.css
    - components/site/SiteHeader.tsx
    - components/site/ResumeSheet.tsx
    - components/admin/AdminResumePanel.tsx
    - components/admin/AdminResumePanel.module.css
    - components/admin/AdminConsole.tsx
    - components/admin/admin-client.ts
    - app/(portfolio)/layout.tsx
    - app/globals.css
    - lib/server/config.ts
    - lib/server/production-config.ts
    - lib/server/readiness.ts
    - scripts/cleanup-expired.mjs
    - scripts/worker.mjs
    - deploy/caddy/Caddyfile
    - compose.production.yaml
    - .env.example
    - tests and scripts named in this plan
  forbidden:
    - real resume PDF or extracted resume text
    - production secrets, invite plaintext, session tokens, private paths in logs
    - E:/Wiki
    - E:/demo2
    - E:/小红书
    - E:/多agent
  unrelated_or_unknown:
    - untracked AGENTS.md
    - untracked docs/research files
    - untracked docs/verify screenshots from other threads
dod:
  - one invite can be redeemed once within seven days and creates one 72-hour resume session
  - revocation invalidates the next status and file request
  - only authenticated requests can decrypt and receive the current PDF
  - ciphertext tampering, wrong keys, missing files, and invalid PDFs fail closed
  - upload replacement never leaves plaintext on disk and preserves one recoverable current ciphertext
  - chat and public knowledge paths cannot read or transmit resume bytes or private metadata
  - admin upload, invite creation, and revocation require admin session, same origin, and password reauthentication
  - audit data expires after 30 days and no endpoint claims to detect browser print or save actions
  - public and admin flows pass 1440 and 390 browser checks with zero console errors
  - production rollout is observed without logging or screenshotting real resume content
approvals:
  - local implementation and local commits are allowed by project rules
  - push, production secret changes, migration execution, upload of the real PDF, invite creation, and deployment require explicit execution-stage authorization
verification:
  focused:
    - node --env-file-if-exists=.env.local --test tests/resume-*.test.ts
    - node --env-file-if-exists=.env.local --test tests/resume-*-integration.test.ts
  stage_exit:
    - npm test
    - npm run build
    - npm run release:smoke
  real_observation:
    - synthetic PDF only for screenshots and API smoke
    - production response status, headers, ciphertext metadata, and authorization result only
review:
  shape: split
  correction_budget: 3
knowledge_impact:
  - README.md
  - deployment runbook
  - private-resume design status
non_goals:
  - PDF text extraction, OCR, HTML resume generation, RAG ingestion, watermarking, DOCX storage, print/save telemetry, multi-resume variants
```

## File Map

- `db/migrations/003_private_resume.sql`: four private-resume tables, constraints, indexes, one-current-document invariant.
- `lib/server/resume-config.ts`: disabled/enabled configuration, secret validation, size and retention constants.
- `lib/server/resume-crypto.ts`: versioned binary AES-256-GCM envelope.
- `lib/server/resume-storage.ts`: ciphertext-only writes, atomic rename, current-document replacement and orphan cleanup.
- `lib/server/resume-access.ts`: invitation redemption, resume Session authentication/revocation, audit events and independent abuse scope.
- `lib/server/resume-admin.ts`: admin read model, invitation creation/deactivation and document replacement orchestration.
- `lib/server/resume-http.ts`: request metadata, stable public errors, Cookie options and security headers.
- `app/api/resume/access/route.ts`: visitor authorization status, redemption and logout.
- `app/api/resume/file/route.ts`: authenticated PDF response only.
- `app/api/admin/resume/route.ts`: admin dashboard read and PDF upload/replace.
- `app/api/admin/resume/invites/route.ts`: one-time invitation creation.
- `app/api/admin/resume/invites/[inviteId]/route.ts`: invitation and associated Session revocation.
- `components/ResumeMode.tsx`: locked, verifying, authorized, unavailable and expired visitor states.
- `components/ResumeMode.module.css`: tokenized dialog/viewer styling at 1440 and 390.
- `components/admin/AdminResumePanel.tsx`: current PDF, invite list and audit workflow.
- `components/admin/AdminResumePanel.module.css`: dense task-panel layout, mobile stacking and long-value containment.
- `scripts/cleanup-expired.mjs`: 30-day audit retention, expired resume Session cleanup and expired invite deactivation.
- `scripts/cleanup-resume-storage.mjs`: remove only unreferenced ciphertext older than a safety window.
- `tests/fixtures/synthetic-resume.ts`: generated fictitious PDF bytes used only in tests.
- `scripts/private-resume-visual-smoke.mjs`: synthetic local browser acceptance without durable PDF screenshots.

## Interface Registry

The implementation keeps these names and ownership boundaries stable across tasks:

```ts
// lib/server/resume-config.ts
export type EnabledResumeConfig = Extract<ResumeConfig, { enabled: true }>;
export function loadResumeConfig(env?: Record<string, string | undefined>): ResumeConfig;

// lib/server/resume-crypto.ts
export class ResumeCryptoError extends Error { readonly code: string }
export function encryptResumePdf(plaintext: Buffer, key: Buffer, keyVersion: number): Buffer;
export function decryptResumePdf(envelope: Buffer, key: Buffer, expectedKeyVersion: number): Buffer;

// lib/server/resume-storage.ts
export interface ResumeDocumentRow {
  id: string;
  storageName: string;
  cipherSha256: string;
  plaintextBytes: number;
  ciphertextBytes: number;
  envelopeVersion: 1;
  keyVersion: number;
  uploadedAt: Date;
}
export function writeResumeCiphertext(input: WriteResumeCiphertextInput): Promise<StoredResume>;
export function readResumePdf(input: ReadResumePdfInput): Promise<Buffer>;
export function removeResumeCiphertext(storageDir: string, storageName: string): Promise<void>;
export function getCurrentResumeDocument(pool: Pool): Promise<ResumeDocumentRow | null>;

// lib/server/resume-access.ts
export interface ResumeRequestContext {
  ip: string;
  userAgent: string;
  deviceInfo: Record<string, string>;
  fingerprintHash: string;
}
export function redeemResumeInviteProtected(
  pool: Pool, code: string, context: ResumeRequestContext, policy: ResumeRedeemPolicy,
): Promise<RedeemedResumeSession>;
export function authenticateResumeSession(
  pool: Pool, token: string, now?: Date,
): Promise<AuthenticatedResumeSession | null>;
export function revokeResumeSession(pool: Pool, token: string, context: ResumeRequestContext): Promise<void>;
export function disableResumeInvite(
  pool: Pool, inviteId: string, adminSessionId: string, now?: Date,
): Promise<boolean>;
export function recordResumeFileReturned(
  pool: Pool, session: AuthenticatedResumeSession, context: ResumeRequestContext,
): Promise<void>;

// lib/server/resume-admin.ts
export function getAdminResumeDashboard(pool: Pool, now?: Date): Promise<AdminResumeDashboard>;
export function createResumeInvite(input: CreateResumeInviteInput): Promise<CreatedResumeInvite>;
export function replaceCurrentResume(input: ReplaceCurrentResumeInput): Promise<AdminResumeDocument>;

// lib/server/resume-http.ts
export const RESUME_NO_STORE_HEADERS: Readonly<Record<string, string>>;
export function resumeCookieOptions(expiresAt: Date): CookieOptions;
export function expiredResumeCookieOptions(): CookieOptions;
export function resumeRequestContext(
  request: NextRequest, config: EnabledResumeConfig,
): ResumeRequestContext;
export function disabledResumeState(): ResumeAccessPayload;
export function unauthorizedResumeState(documentAvailable: boolean): ResumeAccessPayload;
export function resumeUnavailable(): NextResponse;

// scripts/cleanup-resume-storage.mjs
export function cleanupResumeStorage(input: {
  pool: Pool;
  storageDir: string;
  now: Date;
  minimumAgeMs: number;
}): Promise<{ deletedCiphertexts: number; deletedTemporaryFiles: number }>;
```

### Task 1: Add the isolated database domain

**Files:**
- Create: `db/migrations/003_private_resume.sql`
- Modify: `tests/schema.test.ts`
- Modify: `tests/migration-integration.test.ts`
- Create: `tests/resume-schema-integration.test.ts`

- [ ] **Step 1: Write the failing schema and concurrency tests**

Add assertions that migration `003` exists, all four table names are present, `resume_sessions.invite_id` is unique, and only one current document is allowed. Add an integration test that begins two concurrent transactions against the same invite row and proves the second transaction cannot create another Session after the first commits.

```ts
test('one resume invite can own at most one session', async () => {
  const inviteId = randomUUID();
  await pool.query(
    `INSERT INTO resume_invites
      (id, code_hash, trusted_person_note, expires_at, created_by_admin_session)
     VALUES ($1, $2, 'Synthetic Person', now() + interval '7 days', $3)`,
    [inviteId, 'a'.repeat(64), adminSessionId],
  );
  await pool.query(
    `INSERT INTO resume_sessions
      (id, invite_id, token_hash, expires_at, source_ip, user_agent, device_info)
     VALUES ($1, $2, $3, now() + interval '72 hours', '127.0.0.1', 'synthetic-test', '{}'::jsonb)`,
    [randomUUID(), inviteId, 'b'.repeat(64)],
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO resume_sessions
        (id, invite_id, token_hash, expires_at, source_ip, user_agent, device_info)
       VALUES ($1, $2, $3, now() + interval '72 hours', '127.0.0.1', 'synthetic-test', '{}'::jsonb)`,
      [randomUUID(), inviteId, 'c'.repeat(64)],
    ),
    /resume_sessions_invite_id_key/,
  );
});
```

- [ ] **Step 2: Run the focused tests and confirm the expected failure**

Run: `node --env-file-if-exists=.env.local --test tests/schema.test.ts tests/migration-integration.test.ts tests/resume-schema-integration.test.ts`

Expected: FAIL because `003_private_resume.sql` and the resume tables do not exist.

- [ ] **Step 3: Add the migration with database-enforced invariants**

Create the four tables with these exact status fields and constraints:

```sql
CREATE TABLE resume_documents (
  id uuid PRIMARY KEY,
  storage_name text NOT NULL UNIQUE CHECK (storage_name ~ '^[0-9a-f-]+\.morsepdf$'),
  cipher_sha256 char(64) NOT NULL CHECK (cipher_sha256 ~ '^[0-9a-f]{64}$'),
  plaintext_bytes bigint NOT NULL CHECK (plaintext_bytes > 0),
  ciphertext_bytes bigint NOT NULL CHECK (ciphertext_bytes > plaintext_bytes),
  envelope_version smallint NOT NULL CHECK (envelope_version = 1),
  key_version integer NOT NULL CHECK (key_version > 0),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by_admin_session uuid NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX resume_documents_one_current_idx
  ON resume_documents(is_current) WHERE is_current = true;

CREATE TABLE resume_invites (
  id uuid PRIMARY KEY,
  code_hash char(64) NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  trusted_person_note varchar(200) NOT NULL CHECK (length(trim(trusted_person_note)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  disabled_at timestamptz,
  created_by_admin_session uuid NOT NULL,
  disabled_by_admin_session uuid,
  CHECK (expires_at > created_at),
  CHECK (redeemed_at IS NULL OR redeemed_at >= created_at),
  CHECK (disabled_at IS NULL OR disabled_at >= created_at)
);

CREATE INDEX resume_invites_state_idx
  ON resume_invites(disabled_at, redeemed_at, expires_at DESC);

CREATE TABLE resume_sessions (
  id uuid PRIMARY KEY,
  invite_id uuid NOT NULL UNIQUE REFERENCES resume_invites(id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  source_ip inet NOT NULL,
  user_agent text NOT NULL CHECK (length(user_agent) <= 1024),
  device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX resume_sessions_expiry_idx ON resume_sessions(expires_at);

CREATE TABLE resume_access_events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN (
    'invite_created', 'redeem_succeeded', 'redeem_failed', 'file_returned',
    'session_logged_out', 'invite_disabled', 'expired_cleanup',
    'document_uploaded', 'document_replaced', 'key_rotated', 'storage_recovery'
  )),
  result_code text NOT NULL CHECK (length(result_code) BETWEEN 1 AND 80),
  invite_id uuid REFERENCES resume_invites(id) ON DELETE SET NULL,
  session_id uuid REFERENCES resume_sessions(id) ON DELETE SET NULL,
  source_ip inet,
  user_agent text CHECK (length(user_agent) <= 1024),
  device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz NOT NULL,
  CHECK (delete_after > created_at)
);

CREATE INDEX resume_access_events_recent_idx ON resume_access_events(created_at DESC);
CREATE INDEX resume_access_events_retention_idx ON resume_access_events(delete_after);
```

- [ ] **Step 4: Run migration and schema tests**

Run: `node --env-file-if-exists=.env.local --test tests/schema.test.ts tests/migration-integration.test.ts tests/resume-schema-integration.test.ts`

Expected: PASS; a fresh database applies migrations `001`, `002`, and `003` exactly once, concurrent duplicate Session creation is rejected, and the partial unique index rejects two current documents.

- [ ] **Step 5: Commit the database slice**

```powershell
git add -- db/migrations/003_private_resume.sql tests/schema.test.ts tests/migration-integration.test.ts tests/resume-schema-integration.test.ts
git commit -m "feat: add private resume database domain"
```

### Task 2: Add fail-closed resume configuration

**Files:**
- Create: `lib/server/resume-config.ts`
- Modify: `lib/server/production-config.ts`
- Modify: `lib/server/readiness.ts`
- Modify: `.env.example`
- Create: `tests/resume-config.test.ts`
- Modify: `tests/production-config.test.ts`
- Modify: `tests/readiness.test.ts`

- [ ] **Step 1: Write failing configuration tests**

```ts
test('enabled resume access requires an exact 32-byte base64 key', () => {
  const base = {
    DATABASE_URL: 'postgresql://resume-test@127.0.0.1:5432/resume_test',
    MORSE_PUBLIC_ORIGIN: 'http://127.0.0.1:3010',
    MORSE_RESUME_ENABLED: 'true',
    MORSE_RESUME_STORAGE_DIR: '/opt/revolution/shared/private/resume',
    MORSE_RESUME_KEY_VERSION: '1',
    MORSE_RESUME_FINGERPRINT_SECRET: 'r'.repeat(32),
  };
  assert.throws(() => loadResumeConfig({ ...base, MORSE_RESUME_ENCRYPTION_KEY: 'bad' }),
    /RESUME_ENCRYPTION_KEY_INVALID/);
  const config = loadResumeConfig({
    ...base,
    MORSE_RESUME_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  });
  assert.equal(config.enabled, true);
  assert.equal(config.sessionHours, 72);
  assert.equal(config.inviteDays, 7);
  assert.equal(config.auditRetentionDays, 30);
  assert.equal(config.maxPdfBytes, 10 * 1024 * 1024);
});
```

- [ ] **Step 2: Confirm configuration tests fail**

Run: `node --env-file-if-exists=.env.local --test tests/resume-config.test.ts tests/production-config.test.ts tests/readiness.test.ts`

Expected: FAIL because `loadResumeConfig` and production resume validation do not exist.

- [ ] **Step 3: Implement a discriminated, fail-closed loader**

```ts
export type ResumeConfig =
  | { enabled: false; cookieName: string }
  | {
      enabled: true;
      databaseUrl: string;
      publicOrigin: string;
      cookieName: string;
      inviteDays: 7;
      sessionHours: 72;
      auditRetentionDays: 30;
      maxPdfBytes: number;
      storageDir: string;
      encryptionKey: Buffer;
      keyVersion: number;
      fingerprintSecret: string;
      trustedProxyHops: number;
    };

export function loadResumeConfig(env: Record<string, string | undefined> = process.env): ResumeConfig {
  const cookieName = env.MORSE_RESUME_COOKIE?.trim() || 'morse_resume_access';
  if (env.MORSE_RESUME_ENABLED?.trim() !== 'true') return { enabled: false, cookieName };
  const databaseUrl = env.DATABASE_URL?.trim() ?? '';
  const publicOrigin = env.MORSE_PUBLIC_ORIGIN?.trim() ?? '';
  const encryptionKey = readResumeEncryptionKey(env);
  const storageDir = env.MORSE_RESUME_STORAGE_DIR?.trim() ?? '';
  const keyVersion = Number(env.MORSE_RESUME_KEY_VERSION);
  const fingerprintSecret = env.MORSE_RESUME_FINGERPRINT_SECRET?.trim() ?? '';
  const trustedProxyHops = Number(env.MORSE_RESUME_TRUSTED_PROXY_HOPS ?? 0);
  if (!databaseUrl) throw new Error('RESUME_DATABASE_URL_INVALID');
  if (!isExactResumeOrigin(publicOrigin)) throw new Error('RESUME_PUBLIC_ORIGIN_INVALID');
  if (encryptionKey.length !== 32) throw new Error('RESUME_ENCRYPTION_KEY_INVALID');
  if (!path.isAbsolute(storageDir)) throw new Error('RESUME_STORAGE_DIR_INVALID');
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) throw new Error('RESUME_KEY_VERSION_INVALID');
  if (fingerprintSecret.length < 32) throw new Error('RESUME_FINGERPRINT_SECRET_INVALID');
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0) {
    throw new Error('RESUME_PROXY_HOPS_INVALID');
  }
  return {
    enabled: true,
    databaseUrl,
    publicOrigin,
    cookieName,
    inviteDays: 7,
    sessionHours: 72,
    auditRetentionDays: 30,
    maxPdfBytes: 10 * 1024 * 1024,
    storageDir,
    encryptionKey,
    keyVersion,
    fingerprintSecret,
    trustedProxyHops,
  };
}
```

Use these exact private helpers. Direct Base64 is accepted only for local/test execution. Production requires `MORSE_RESUME_ENCRYPTION_KEY_FILE`, reads one Base64 value from the mounted secret file, and rejects simultaneous file/direct values. Errors never include the file path or value.

```ts
function isExactResumeOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === value && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function readResumeEncryptionKey(env: Record<string, string | undefined>): Buffer {
  const direct = env.MORSE_RESUME_ENCRYPTION_KEY?.trim() ?? '';
  const fileName = env.MORSE_RESUME_ENCRYPTION_KEY_FILE?.trim() ?? '';
  if (direct && fileName) throw new Error('RESUME_ENCRYPTION_KEY_INVALID');
  if (env.NODE_ENV === 'production' && (!fileName || direct)) {
    throw new Error('RESUME_ENCRYPTION_KEY_INVALID');
  }
  let encoded = direct;
  if (fileName) {
    try {
      encoded = readFileSync(fileName, 'utf8').trim();
    } catch {
      throw new Error('RESUME_ENCRYPTION_KEY_INVALID');
    }
  }
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(encoded)) {
    throw new Error('RESUME_ENCRYPTION_KEY_INVALID');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('RESUME_ENCRYPTION_KEY_INVALID');
  }
  return key;
}
```

Production web validation must call this loader and return only stable error codes. Readiness returns `READINESS_RUNTIME_INVALID` when resume access is enabled but the key, storage path, fingerprint secret, or key version is invalid. Disabled mode must start without any resume secret.

- [ ] **Step 4: Document server-only environment names**

Add these names with blank secret values to `.env.example`:

```dotenv
MORSE_RESUME_ENABLED=false
MORSE_RESUME_COOKIE=morse_resume_access
MORSE_RESUME_STORAGE_DIR=/opt/revolution/shared/private/resume
MORSE_RESUME_ENCRYPTION_KEY=
MORSE_RESUME_ENCRYPTION_KEY_FILE=
MORSE_RESUME_KEY_VERSION=1
MORSE_RESUME_FINGERPRINT_SECRET=
MORSE_RESUME_TRUSTED_PROXY_HOPS=0
```

Do not introduce any `NEXT_PUBLIC_MORSE_RESUME_*` variable.
Production validation requires `MORSE_RESUME_TRUSTED_PROXY_HOPS=1` for the single Caddy hop so audit rows contain the trusted client address; local mode may use `0` and records `0.0.0.0` instead of trusting unconfigured forwarding headers.

- [ ] **Step 5: Run configuration tests and commit**

Run: `node --env-file-if-exists=.env.local --test tests/resume-config.test.ts tests/production-config.test.ts tests/readiness.test.ts`

Expected: PASS for disabled mode and a valid synthetic key; PASS for fail-closed invalid key, path, version and fingerprint cases.

```powershell
git add -- lib/server/resume-config.ts lib/server/production-config.ts lib/server/readiness.ts .env.example tests/resume-config.test.ts tests/production-config.test.ts tests/readiness.test.ts
git commit -m "feat: validate private resume configuration"
```

### Task 3: Encrypt and store PDF bytes without plaintext files

**Files:**
- Create: `lib/server/resume-crypto.ts`
- Create: `lib/server/resume-storage.ts`
- Create: `scripts/rotate-resume-key.mjs`
- Create: `tests/fixtures/synthetic-resume.ts`
- Create: `tests/resume-crypto.test.ts`
- Create: `tests/resume-storage.test.ts`
- Create: `tests/resume-key-rotation.test.ts`

- [ ] **Step 1: Create a fictitious in-memory PDF fixture and failing crypto tests**

```ts
export function syntheticResumePdf(label = 'SYNTHETIC RESUME - NO PERSONAL DATA'): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${label}) Tj ET`;
  return Buffer.from(
    `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n` +
    `2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n` +
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n` +
    `4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj\n%%EOF\n`,
    'ascii',
  );
}
```

Test round-trip, wrong key, modified nonce, modified tag, modified ciphertext, truncated envelope, unsupported versions, successful key rotation, failed new-cipher verification and failed database switch. The test storage directory must be under `tmp/resume-tests/<random-id>` and removed in test teardown.

- [ ] **Step 2: Confirm the crypto tests fail**

Run: `node --env-file-if-exists=.env.local --test tests/resume-crypto.test.ts tests/resume-storage.test.ts tests/resume-key-rotation.test.ts`

Expected: FAIL because the crypto and storage modules do not exist.

- [ ] **Step 3: Implement the fixed binary envelope**

Use this exact layout: eight-byte ASCII magic `MORSEPDF`, one-byte envelope version, four-byte unsigned key version, 12-byte nonce, 16-byte GCM tag, then ciphertext. Authenticate the 13-byte header as AAD.

```ts
const MAGIC = Buffer.from('MORSEPDF', 'ascii');
const ENVELOPE_VERSION = 1;
const HEADER_BYTES = 13;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function encryptResumePdf(plaintext: Buffer, key: Buffer, keyVersion: number): Buffer {
  if (key.length !== 32) throw new ResumeCryptoError('RESUME_KEY_INVALID');
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw new ResumeCryptoError('RESUME_KEY_VERSION_INVALID');
  }
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header.writeUInt8(ENVELOPE_VERSION, 8);
  header.writeUInt32BE(keyVersion, 9);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([header, nonce, cipher.getAuthTag(), ciphertext]);
}

export function decryptResumePdf(envelope: Buffer, key: Buffer, expectedKeyVersion: number): Buffer {
  const minimum = HEADER_BYTES + NONCE_BYTES + TAG_BYTES + 1;
  if (envelope.length < minimum || !envelope.subarray(0, 8).equals(MAGIC)) {
    throw new ResumeCryptoError('RESUME_ENVELOPE_INVALID');
  }
  const version = envelope.readUInt8(8);
  const keyVersion = envelope.readUInt32BE(9);
  if (version !== ENVELOPE_VERSION || keyVersion !== expectedKeyVersion) {
    throw new ResumeCryptoError('RESUME_ENVELOPE_UNSUPPORTED');
  }
  try {
    const nonceStart = HEADER_BYTES;
    const tagStart = nonceStart + NONCE_BYTES;
    const bodyStart = tagStart + TAG_BYTES;
    const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(nonceStart, tagStart));
    decipher.setAAD(envelope.subarray(0, HEADER_BYTES));
    decipher.setAuthTag(envelope.subarray(tagStart, bodyStart));
    return Buffer.concat([decipher.update(envelope.subarray(bodyStart)), decipher.final()]);
  } catch {
    throw new ResumeCryptoError('RESUME_INTEGRITY_FAILED');
  }
}
```

- [ ] **Step 4: Implement ciphertext-only, same-filesystem storage**

`writeResumeCiphertext()` must create the private directory with mode `0700`, write only encrypted bytes to a random `.tmp` file with mode `0600`, `fsync`, close, and rename to `<uuid>.morsepdf`. It returns storage name, SHA-256, plaintext bytes, ciphertext bytes, envelope version and key version. On failure it removes the temporary ciphertext; it never writes the plaintext Buffer.

```ts
export async function writeResumeCiphertext(input: WriteResumeCiphertextInput): Promise<StoredResume> {
  await mkdir(input.storageDir, { recursive: true, mode: 0o700 });
  const envelope = encryptResumePdf(input.pdf, input.key, input.keyVersion);
  const id = randomUUID();
  const storageName = `${id}.morsepdf`;
  const temporaryPath = join(input.storageDir, `${storageName}.tmp`);
  const finalPath = join(input.storageDir, storageName);
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(envelope);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, finalPath);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return {
    id,
    storageName,
    cipherSha256: createHash('sha256').update(envelope).digest('hex'),
    plaintextBytes: input.pdf.length,
    ciphertextBytes: envelope.length,
    envelopeVersion: 1,
    keyVersion: input.keyVersion,
  };
}
```

`readResumePdf()` must reject path separators, verify ciphertext SHA-256 before decrypting, then verify `%PDF-` after authenticated decryption. No plaintext fallback path is permitted.

- [ ] **Step 5: Implement an offline, verify-before-switch key rotation**

`scripts/rotate-resume-key.mjs` accepts only `MORSE_RESUME_OLD_KEY_FILE`, `MORSE_RESUME_NEW_KEY_FILE`, `MORSE_RESUME_OLD_KEY_VERSION` and `MORSE_RESUME_NEW_KEY_VERSION`. It refuses missing files and non-advancing versions, disables logging of input values, reads and decrypts the current ciphertext into memory, writes a new ciphertext with the new key, reads it back with the new key, then locks and updates the current document metadata in one database transaction. Only after commit does it remove the old ciphertext. On failure it keeps the old row/file current and removes the new orphan.

```ts
export async function rotateCurrentResumeKey(input: RotateResumeKeyInput): Promise<void> {
  if (input.newKeyVersion <= input.oldKeyVersion) {
    throw new Error('RESUME_KEY_VERSION_NOT_ADVANCING');
  }
  const current = await getCurrentResumeDocument(input.pool);
  if (!current || current.keyVersion !== input.oldKeyVersion) {
    throw new Error('RESUME_CURRENT_KEY_VERSION_MISMATCH');
  }
  const plaintext = await readResumePdf({
    document: current,
    storageDir: input.storageDir,
    key: input.oldKey,
    expectedKeyVersion: input.oldKeyVersion,
  });
  const stored = await writeResumeCiphertext({
    storageDir: input.storageDir,
    pdf: plaintext,
    key: input.newKey,
    keyVersion: input.newKeyVersion,
  });
  try {
    await readResumePdf({
      document: stored,
      storageDir: input.storageDir,
      key: input.newKey,
      expectedKeyVersion: input.newKeyVersion,
    });
    await switchCurrentResumeCiphertext(input.pool, current, stored, input.now);
  } catch {
    await removeResumeCiphertext(input.storageDir, stored.storageName).catch(() => undefined);
    throw new Error('RESUME_KEY_ROTATION_FAILED');
  }
  await removeResumeCiphertext(input.storageDir, current.storageName).catch(() => undefined);
}
```

`switchCurrentResumeCiphertext()` owns the explicit `BEGIN`/`COMMIT`/`ROLLBACK`, row lock, current-ID recheck, metadata update and `key_rotated` audit event. `rotateCurrentResumeKey()` catches a failed verification or switch, removes `stored.storageName`, and exits with `RESUME_KEY_ROTATION_FAILED` without changing the old row.

- [ ] **Step 6: Run crypto/storage/rotation tests and inspect the temp directory**

Run: `node --env-file-if-exists=.env.local --test tests/resume-crypto.test.ts tests/resume-storage.test.ts tests/resume-key-rotation.test.ts`

Expected: PASS; test asserts no file under the private directory starts with `%PDF-`, and every corruption case throws a stable resume error without internal path text.

- [ ] **Step 7: Commit the encryption slice**

```powershell
git add -- lib/server/resume-crypto.ts lib/server/resume-storage.ts scripts/rotate-resume-key.mjs tests/fixtures/synthetic-resume.ts tests/resume-crypto.test.ts tests/resume-storage.test.ts tests/resume-key-rotation.test.ts
git commit -m "feat: encrypt private resume documents"
```

### Task 4: Implement independent resume invitation and Session authorization

**Files:**
- Create: `lib/server/resume-access.ts`
- Create: `tests/resume-access.test.ts`
- Create: `tests/resume-access-integration.test.ts`
- Modify: `tests/invite-abuse-integration.test.ts`

- [ ] **Step 1: Write failing access-domain tests**

Cover exactly these cases: valid redeem, seven-day expiry, already redeemed, disabled invite, concurrent double redeem, 72-hour expiry, logout, immediate admin revocation, stable unauthorized result, independent `resume_invite_redeem` abuse scope, and an invite note never appearing in a public error.

```ts
test('revoking a redeemed invite invalidates the next authentication', async () => {
  const redeemed = await redeemResumeInviteProtected(pool, code, requestContext, policy);
  assert.ok(await authenticateResumeSession(pool, redeemed.token, now));
  await disableResumeInvite(pool, inviteId, adminSessionId, new Date(now.getTime() + 1_000));
  assert.equal(
    await authenticateResumeSession(pool, redeemed.token, new Date(now.getTime() + 2_000)),
    null,
  );
});
```

- [ ] **Step 2: Confirm the access tests fail**

Run: `node --env-file-if-exists=.env.local --test tests/resume-access.test.ts tests/resume-access-integration.test.ts tests/invite-abuse-integration.test.ts`

Expected: FAIL because the resume authorization service does not exist.

- [ ] **Step 3: Implement transactional one-time redemption**

```ts
export async function redeemResumeInviteProtected(
  pool: Pool,
  code: string,
  context: ResumeRequestContext,
  policy: ResumeRedeemPolicy,
): Promise<RedeemedResumeSession> {
  const now = policy.now ?? new Date();
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    await lockResumeSource(client, context.fingerprintHash);
    if (await isResumeSourceLocked(client, context.fingerprintHash, now)) {
      await recordResumeRedeemFailure(client, context, now, 'UNAVAILABLE', policy.auditRetentionDays);
      await client.query('COMMIT');
      committed = true;
      throw new ResumeAccessError('RESUME_INVITE_UNAVAILABLE');
    }
    const result = await client.query<ResumeInviteRow>(
      `SELECT id, expires_at, redeemed_at, disabled_at
         FROM resume_invites
        WHERE code_hash = $1
        FOR UPDATE`,
      [hashSecret(code.trim())],
    );
    const invite = result.rows[0];
    if (!invite || invite.disabled_at || invite.redeemed_at || invite.expires_at <= now) {
      await registerResumeFailure(client, context, now, policy);
      await client.query('COMMIT');
      committed = true;
      throw new ResumeAccessError('RESUME_INVITE_UNAVAILABLE');
    }
    const token = randomBytes(32).toString('base64url');
    const sessionId = randomUUID();
    const expiresAt = new Date(now.getTime() + policy.sessionHours * 3_600_000);
    await client.query('UPDATE resume_invites SET redeemed_at = $2 WHERE id = $1', [invite.id, now]);
    await client.query(
      `INSERT INTO resume_sessions
        (id, invite_id, token_hash, expires_at, source_ip, user_agent, device_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [sessionId, invite.id, hashSecret(token), expiresAt, context.ip, context.userAgent,
        JSON.stringify(context.deviceInfo)],
    );
    await insertResumeEvent(client, {
      eventType: 'redeem_succeeded', resultCode: 'OK', inviteId: invite.id, sessionId,
      context, now, auditRetentionDays: policy.auditRetentionDays,
    });
    await client.query('COMMIT');
    committed = true;
    return { sessionId, token, expiresAt };
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
```

Implement transaction state with an explicit `committed` boolean, matching `lib/server/access.ts`; do not infer transaction state from error contents. `authenticateResumeSession()` must join `resume_sessions` to `resume_invites` and require both `revoked_at IS NULL` and `disabled_at IS NULL` on every call.

- [ ] **Step 4: Run access-domain tests and commit**

Run: `node --env-file-if-exists=.env.local --test tests/resume-access.test.ts tests/resume-access-integration.test.ts tests/invite-abuse-integration.test.ts`

Expected: PASS; the existing chat invitation tests remain unchanged and use only `invite_redeem`, while resume tests use only `resume_invite_redeem`.

```powershell
git add -- lib/server/resume-access.ts tests/resume-access.test.ts tests/resume-access-integration.test.ts tests/invite-abuse-integration.test.ts
git commit -m "feat: add isolated resume access sessions"
```

### Task 5: Expose visitor authorization and PDF routes

**Files:**
- Create: `lib/server/resume-http.ts`
- Create: `app/api/resume/access/route.ts`
- Create: `app/api/resume/file/route.ts`
- Create: `tests/resume-api-contract.test.ts`
- Modify: `tests/routes-contract.test.ts`

- [ ] **Step 1: Write failing route contract tests**

```ts
test('authorized PDF response is private, inline, and never cacheable', async () => {
  const response = await fileRoute.GET(request('/api/resume/file', { cookie: resumeCookie }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-disposition'), 'inline; filename="Morse-Resume.pdf"');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), syntheticResumePdf());
});
```

Also assert that no Cookie, chat invitation, query parameter, Referer, or guessed storage name can access the file without a valid resume Session. `GET /api/resume/access` returns only `{ enabled, authorized, documentAvailable, expiresAt }`.

- [ ] **Step 2: Confirm route tests fail**

Run: `node --env-file-if-exists=.env.local --test tests/resume-api-contract.test.ts tests/routes-contract.test.ts`

Expected: FAIL because `/api/resume/*` routes do not exist.

- [ ] **Step 3: Implement shared request and response policy**

```ts
export const RESUME_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
} as const;

export function resumeCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    expires: expiresAt,
  };
}

export function resumeRequestContext(request: NextRequest, config: EnabledResumeConfig) {
  const ip = trustedInviteSource(
    request.headers.get('x-forwarded-for'),
    config.trustedProxyHops,
  );
  const deviceInfo = {
    brand: request.headers.get('sec-ch-ua')?.slice(0, 512) ?? '',
    mobile: request.headers.get('sec-ch-ua-mobile')?.slice(0, 16) ?? '',
    platform: request.headers.get('sec-ch-ua-platform')?.slice(0, 128) ?? '',
  };
  return {
    ip: isIP(ip) ? ip : '0.0.0.0',
    userAgent: request.headers.get('user-agent')?.slice(0, 1024) ?? '',
    deviceInfo,
    fingerprintHash: hashResumeSourceFingerprint(config.fingerprintSecret, ip),
  };
}
```

No stable public response may contain filesystem paths, crypto codes, invite notes, database IDs, Provider configuration or secrets.

- [ ] **Step 4: Implement access and file routes**

`POST /api/resume/access` requires the exact public Origin, validates a code of at most 128 characters, redeems it, and sets `morse_resume_access`. `GET` authenticates the Cookie and separately checks whether a current document exists. `DELETE` requires the public Origin, revokes only the current resume Session, logs logout and expires the resume Cookie.

```ts
export async function GET(request: NextRequest) {
  const config = loadResumeConfig();
  if (!config.enabled) return NextResponse.json(disabledResumeState(), { headers: RESUME_NO_STORE_HEADERS });
  const token = request.cookies.get(config.cookieName)?.value ?? '';
  const pool = getPool(config.databaseUrl);
  const session = await authenticateResumeSession(pool, token);
  if (!session) return NextResponse.json(unauthorizedResumeState(true), { headers: RESUME_NO_STORE_HEADERS });
  const document = await getCurrentResumeDocument(pool);
  if (!document) return resumeUnavailable();
  try {
    const pdf = await readResumePdf({ document, storageDir: config.storageDir,
      key: config.encryptionKey, expectedKeyVersion: config.keyVersion });
    await recordResumeFileReturned(pool, session, resumeRequestContext(request, config));
    return new NextResponse(pdf, {
      headers: {
        ...RESUME_NO_STORE_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': 'inline; filename="Morse-Resume.pdf"',
      },
    });
  } catch {
    return resumeUnavailable();
  }
}
```

The code above belongs in `app/api/resume/file/route.ts`; access-state `GET` must never decrypt the PDF.

- [ ] **Step 5: Run route tests and commit**

Run: `node --env-file-if-exists=.env.local --test tests/resume-api-contract.test.ts tests/routes-contract.test.ts`

Expected: PASS; failed routes return only stable 401/403/404/503 payloads and every response is `no-store`.

```powershell
git add -- lib/server/resume-http.ts app/api/resume/access/route.ts app/api/resume/file/route.ts tests/resume-api-contract.test.ts tests/routes-contract.test.ts
git commit -m "feat: serve authorized private resumes"
```

### Task 6: Add admin upload, invitation and revocation APIs

**Files:**
- Create: `lib/server/resume-admin.ts`
- Create: `app/api/admin/resume/route.ts`
- Create: `app/api/admin/resume/invites/route.ts`
- Create: `app/api/admin/resume/invites/[inviteId]/route.ts`
- Create: `tests/resume-admin-integration.test.ts`
- Create: `tests/resume-admin-api-contract.test.ts`
- Modify: `tests/admin-api-contract.test.ts`

- [ ] **Step 1: Write failing admin tests**

Cover missing admin Cookie, wrong Origin, missing password, wrong password, request too large, wrong extension, wrong MIME, missing `%PDF-`, successful first upload, successful replacement, forced database rollback, forced old-file deletion failure, one-time plaintext invite response, list response without code hashes, and immediate invite/Session revocation.

```ts
test('upload rejects declared PDF content without a PDF header', async () => {
  const form = new FormData();
  form.set('password', password);
  form.set('file', new File([Buffer.from('not a pdf')], 'resume.pdf', { type: 'application/pdf' }));
  const response = await resumeAdminRoute.POST(adminRequest('/api/admin/resume', {
    method: 'POST', origin: allowedOrigin, cookie: adminCookie, body: form,
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: 'INVALID_RESUME_PDF' });
});
```

- [ ] **Step 2: Confirm admin tests fail**

Run: `node --env-file-if-exists=.env.local --test tests/resume-admin-integration.test.ts tests/resume-admin-api-contract.test.ts tests/admin-api-contract.test.ts`

Expected: FAIL because resume admin services and routes do not exist.

- [ ] **Step 3: Implement safe replacement orchestration**

The replacement order is: validate in memory, write and verify a uniquely named ciphertext, begin database transaction, lock the current-document set, mark old metadata non-current, insert new current metadata, log upload/replace, commit, then remove old ciphertext. A database failure removes the new orphan; an old-file deletion failure leaves a harmless non-current ciphertext for Worker cleanup. At no point is the old current ciphertext removed before the new current row commits.

```ts
export async function replaceCurrentResume(input: ReplaceCurrentResumeInput): Promise<AdminResumeDocument> {
  validateFinalPdf(input.fileName, input.mimeType, input.pdf, input.maxPdfBytes);
  const stored = await writeResumeCiphertext({
    storageDir: input.storageDir, pdf: input.pdf, key: input.key, keyVersion: input.keyVersion,
  });
  const client = await input.pool.connect();
  let committed = false;
  let oldStorageName: string | null = null;
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('resume:current-document', 0))");
    const current = await client.query<{ id: string; storage_name: string }>(
      'SELECT id, storage_name FROM resume_documents WHERE is_current = true FOR UPDATE',
    );
    oldStorageName = current.rows[0]?.storage_name ?? null;
    await client.query('UPDATE resume_documents SET is_current = false WHERE is_current = true');
    await client.query(
      `INSERT INTO resume_documents
        (id, storage_name, cipher_sha256, plaintext_bytes, ciphertext_bytes,
         envelope_version, key_version, uploaded_by_admin_session, is_current)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
      [stored.id, stored.storageName, stored.cipherSha256, stored.plaintextBytes,
        stored.ciphertextBytes, stored.envelopeVersion, stored.keyVersion, input.adminSessionId],
    );
    if (current.rows[0]) {
      await client.query('DELETE FROM resume_documents WHERE id = $1', [current.rows[0].id]);
    }
    await insertAdminResumeEvent(client, current.rows[0] ? 'document_replaced' : 'document_uploaded', input);
    await client.query('COMMIT');
    committed = true;
  } finally {
    if (!committed) {
      await client.query('ROLLBACK').catch(() => undefined);
      await removeResumeCiphertext(input.storageDir, stored.storageName).catch(() => undefined);
    }
    client.release();
  }
  if (oldStorageName) {
    await removeResumeCiphertext(input.storageDir, oldStorageName).catch(() => undefined);
  }
  return toAdminResumeDocument(stored);
}
```

- [ ] **Step 4: Implement protected admin routes**

All POST/DELETE operations run `requireAdmin()`, `hasAdminOrigin()`, then `reauthenticateAdminPassword()`. Upload checks `Content-Length` before `request.formData()` and checks `File.size` after parsing. The dashboard `GET` returns current ciphertext metadata, invite status and at most 100 recent 30-day events; it never returns code hashes, token hashes, encryption configuration or PDF bytes.

Invitation creation uses `randomBytes(18).toString('base64url')`, stores only `hashSecret(code)`, sets `expires_at = now + 7 days`, logs `invite_created`, and returns plaintext once:

```ts
return NextResponse.json({
  ok: true,
  invite: {
    id: created.id,
    code: created.code,
    trustedPersonNote: created.trustedPersonNote,
    expiresAt: created.expiresAt.toISOString(),
  },
}, { headers: { 'Cache-Control': 'no-store' } });
```

- [ ] **Step 5: Run admin tests and commit**

Run: `node --env-file-if-exists=.env.local --test tests/resume-admin-integration.test.ts tests/resume-admin-api-contract.test.ts tests/admin-api-contract.test.ts`

Expected: PASS; every write is password-confirmed and same-origin, invite plaintext appears once only, replacement rollback retains the prior current document, and old-file cleanup failure does not break the new current document.

```powershell
git add -- lib/server/resume-admin.ts app/api/admin/resume/route.ts app/api/admin/resume/invites/route.ts 'app/api/admin/resume/invites/[inviteId]/route.ts' tests/resume-admin-integration.test.ts tests/resume-admin-api-contract.test.ts tests/admin-api-contract.test.ts
git commit -m "feat: manage private resumes in admin APIs"
```

### Task 7: Add the concise admin resume workbench

**Focused method:** Load `morse-design` in Fast redesign mode before implementation. Preserve the existing admin visual language; do not add marketing copy, nested cards, decorative gradients or a second navigation system.

**Files:**
- Create: `components/admin/AdminResumePanel.tsx`
- Create: `components/admin/AdminResumePanel.module.css`
- Modify: `components/admin/AdminConsole.tsx`
- Modify: `components/admin/admin-client.ts`
- Create: `tests/resume-admin-ui-contract.test.ts`
- Modify: `tests/s10-admin-ui-contract.test.ts`

- [ ] **Step 1: Write failing UI contract tests**

Assert one toolbar action labeled `简历管理`, one dialog/panel with three sections (`当前 PDF`, `访问码`, `近 30 天记录`), password fields for every write action, one-time code display, and no field or copy containing `加密密钥`, `Key`, `模型节点`, `Provider`, `打印次数` or `下载次数`.

- [ ] **Step 2: Confirm UI contract tests fail**

Run: `node --env-file-if-exists=.env.local --test tests/resume-admin-ui-contract.test.ts tests/s10-admin-ui-contract.test.ts`

Expected: FAIL because `AdminResumePanel` does not exist.

- [ ] **Step 3: Implement the admin client types and task panel**

```ts
export interface AdminResumeDashboard {
  document: null | {
    id: string;
    plaintextBytes: number;
    cipherSha256: string;
    uploadedAt: string;
  };
  invites: Array<{
    id: string;
    trustedPersonNote: string;
    createdAt: string;
    expiresAt: string;
    redeemedAt: string | null;
    disabledAt: string | null;
    sessionExpiresAt: string | null;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    resultCode: string;
    ip: string | null;
    userAgent: string | null;
    deviceInfo: Record<string, string>;
    createdAt: string;
  }>;
}
```

`AdminResumePanel` loads only while open. Default focus is the current-document section. Upload uses one file input, current-password input and `上传新版本` command. Invitation creation uses a required familiar-person note, current-password input and `生成访问码`; the returned code is held only in React state and cleared when the panel closes. Revocation shows the note and asks for the current password before `停用访问码`.

```tsx
<button type="button" className={styles.toolbarButton} onClick={() => setResumeOpen(true)}>
  简历管理
</button>
<AdminResumePanel
  open={resumeOpen}
  onClose={() => setResumeOpen(false)}
  onUnauthorized={requireLogin}
/>
```

- [ ] **Step 4: Implement responsive states**

Desktop uses one compact panel with a section switcher and a full-width content region. At 390px, actions stack, tables become labeled rows, long hashes use `overflow-wrap: anywhere`, and the primary action remains at least 44px high. Include loading, no-document, no-invite, no-event, expired admin Session, request error, upload success and revoke success states.

- [ ] **Step 5: Run UI tests and commit**

Run: `node --env-file-if-exists=.env.local --test tests/resume-admin-ui-contract.test.ts tests/s10-admin-ui-contract.test.ts`

Expected: PASS with the existing admin tests unchanged except for the new `简历管理` entry.

```powershell
git add -- components/admin/AdminResumePanel.tsx components/admin/AdminResumePanel.module.css components/admin/AdminConsole.tsx components/admin/admin-client.ts tests/resume-admin-ui-contract.test.ts tests/s10-admin-ui-contract.test.ts
git commit -m "feat: add private resume admin workbench"
```

### Task 8: Replace the public localStorage resume sheet with server authorization

**Focused method:** Continue `morse-design` in Fast redesign mode. The public flow is a small access surface inside the approved black-gold portfolio, not a new landing page.

**Files:**
- Modify: `components/ResumeMode.tsx`
- Modify: `components/ResumeMode.module.css`
- Modify: `components/site/SiteHeader.tsx`
- Delete: `components/site/ResumeSheet.tsx`
- Modify: `app/(portfolio)/layout.tsx`
- Modify: `app/globals.css`
- Modify: `components/site/SiteShell.module.css`
- Modify: `content/site-content.json`
- Modify: `lib/site-content.ts`
- Modify: `tests/site-shell-contract.test.ts`
- Create: `tests/resume-ui-contract.test.ts`

- [ ] **Step 1: Rewrite the old contract tests to fail on public resume embedding**

The new tests must reject `ResumeSheet`, `resume-mode-boot`, `localStorage`, `data-resume-section`, profile/project mapping inside the resume component, DOM class authorization, embedded PDF frames and print telemetry. They must require `GET /api/resume/access`, an invitation form, a same-origin `/api/resume/file` link with `target="_blank"`, `退出简历模式`, and `简历暂不可用`.

- [ ] **Step 2: Confirm the new UI contract fails against the old implementation**

Run: `node --env-file-if-exists=.env.local --test tests/site-shell-contract.test.ts tests/resume-ui-contract.test.ts`

Expected: FAIL because the current layout embeds `ResumeSheet` and `ResumeMode.tsx` trusts `localStorage`.

- [ ] **Step 3: Implement a server-backed state machine**

```ts
type ResumeAccessState =
  | { kind: 'closed' }
  | { kind: 'checking' }
  | { kind: 'locked'; message: string }
  | { kind: 'authorized'; expiresAt: string }
  | { kind: 'unavailable'; message: string };

async function readResumeAccess(signal?: AbortSignal): Promise<ResumeAccessState> {
  const response = await fetch('/api/resume/access', {
    cache: 'no-store', credentials: 'same-origin', signal,
  });
  if (!response.ok) return { kind: 'unavailable', message: '简历暂不可用，请稍后再试。' };
  const payload = await response.json() as ResumeAccessPayload;
  if (!payload.enabled || !payload.documentAvailable) {
    return { kind: 'unavailable', message: '简历暂不可用。' };
  }
  return payload.authorized && payload.expiresAt
    ? { kind: 'authorized', expiresAt: payload.expiresAt }
    : { kind: 'locked', message: '' };
}
```

Clicking `简历模式` opens the dialog and checks status. Locked state shows only a short label, one invitation-code input, `查看简历`, and `关闭`. Authorized state shows `打开 PDF` as a same-origin link to `/api/resume/file` with `target="_blank"` and `rel="noreferrer"`, plus `退出简历模式`. The browser's top-level PDF viewer provides view, print and save behavior while preserving the site's global anti-framing headers. The component never fetches or retains PDF bytes in JavaScript state.

- [ ] **Step 4: Remove the public structured resume path**

Delete the layout boot script and `ResumeSheet` render:

```tsx
export default function PortfolioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AmbientBackground />
      <ScrollEffects />
      <div className={shellStyles.standardContent} data-standard-content>
        <SiteHeader site={siteContent.site} />
        {children}
        <SiteFooter footer={siteContent.site.footer} />
      </div>
    </>
  );
}
```

Remove `storageKey`, `bodyClass` and `printLabel` from the public content schema. Keep only the label required by the header. Remove global `html.resume-mode` rules that hide public content or expose a separate resume section. Do not add any real resume field to `site-content.json`.

- [ ] **Step 5: Run UI contracts and commit**

Run: `node --env-file-if-exists=.env.local --test tests/site-shell-contract.test.ts tests/resume-ui-contract.test.ts tests/site-content.test.ts scripts/site-content.test.mjs`

Expected: PASS; public source no longer embeds a structured resume, and the only content-driven value is the non-sensitive `简历模式` label.

```powershell
git add -- components/ResumeMode.tsx components/ResumeMode.module.css components/site/SiteHeader.tsx app/'(portfolio)'/layout.tsx app/globals.css components/site/SiteShell.module.css content/site-content.json lib/site-content.ts tests/site-shell-contract.test.ts tests/resume-ui-contract.test.ts tests/site-content.test.ts scripts/site-content.test.mjs
git rm -- components/site/ResumeSheet.tsx
git commit -m "feat: gate resume mode behind server access"
```

### Task 9: Enforce retention and production private storage boundaries

**Files:**
- Modify: `scripts/cleanup-expired.mjs`
- Create: `scripts/cleanup-resume-storage.mjs`
- Modify: `scripts/worker.mjs`
- Modify: `tests/retention-integration.test.ts`
- Modify: `tests/operations-scripts.test.ts`
- Modify: `tests/worker.test.ts`
- Modify: `compose.production.yaml`
- Modify: `deploy/caddy/Caddyfile`
- Create: `tests/resume-deployment-contract.test.ts`

- [ ] **Step 1: Write failing retention and deployment tests**

Assert that expired resume Sessions are removed, expired unused invites are disabled, events older than 30 days are deleted, current ciphertext is never deleted, referenced non-current ciphertext is retained until its row is gone, and an orphan younger than 24 hours is retained. Assert that only `web` and `worker` mount the private volume, the volume is absent from `edge`, `embedding`, `ingest` and `migration`, no encryption key is provided to Worker, and Caddy permits at most 11 MiB only for `POST /api/admin/resume` while retaining the existing 2 MiB limit for every other request.

- [ ] **Step 2: Confirm tests fail**

Run: `node --env-file-if-exists=.env.local --test tests/retention-integration.test.ts tests/operations-scripts.test.ts tests/worker.test.ts tests/resume-deployment-contract.test.ts`

Expected: FAIL because resume retention and private volume contracts are absent.

- [ ] **Step 3: Extend the idempotent database cleanup transaction**

Add these statements after chat access cleanup and before commit:

```js
const resumeSessions = await client.query(
  `DELETE FROM resume_sessions
    WHERE expires_at <= $1::timestamptz OR revoked_at <= $1::timestamptz`,
  [cleanupNow],
);
const resumeInvites = await client.query(
  `UPDATE resume_invites
      SET disabled_at = COALESCE(disabled_at, $1::timestamptz)
    WHERE expires_at <= $1::timestamptz
      AND redeemed_at IS NULL
      AND disabled_at IS NULL`,
  [cleanupNow],
);
const resumeEvents = await client.query(
  'DELETE FROM resume_access_events WHERE delete_after <= $1::timestamptz',
  [cleanupNow],
);
```

Before deleting expired Sessions or disabling expired invites, insert one `expired_cleanup` event per affected row with `delete_after = cleanupNow + interval '30 days'`. Do not copy token hashes into the events.

Return only counts. Do not return IP, User-Agent, device info, invite notes, token hashes, paths or event bodies in Worker logs.

- [ ] **Step 4: Implement orphan ciphertext cleanup with a safety window**

`cleanupResumeStorage({ pool, storageDir, now, minimumAgeMs: 86_400_000 })` lists only names matching `/^[0-9a-f-]+\.morsepdf$/`, loads all referenced `storage_name` values from `resume_documents`, and removes an unreferenced file only when its `mtime` is older than 24 hours. It ignores `.tmp` files younger than 24 hours and removes older `.tmp` files. It returns counts only.

- [ ] **Step 5: Add the private named volume and least secret distribution**

Add `revolution_private_resume:/opt/revolution/shared/private/resume` to `web` as read-write because admin upload runs in Web. Add the same volume to `worker` for orphan deletion, but do not call `loadResumeConfig()` from Worker. Store the Base64 key in `deploy/secrets/resume_encryption_key`, mount that Docker Secret only into Web, and set `MORSE_RESUME_ENCRYPTION_KEY_FILE=/run/secrets/resume_encryption_key` only on Web. Keep `MORSE_RESUME_ENCRYPTION_KEY` empty in `.env.production`; Worker, Edge, Embedding, Ingest and Migration must not receive the key file.

```yaml
services:
  web:
    secrets:
      - resume_encryption_key
    environment:
      MORSE_RESUME_ENCRYPTION_KEY_FILE: /run/secrets/resume_encryption_key
    volumes:
      - revolution_private_resume:/opt/revolution/shared/private/resume
  worker:
    volumes:
      - revolution_private_resume:/opt/revolution/shared/private/resume
secrets:
  resume_encryption_key:
    file: ./deploy/secrets/resume_encryption_key
```

Add the named volume declaration:

```yaml
volumes:
  revolution_pgdata:
  revolution_embedding_models:
  revolution_private_resume:
  revolution_caddy_data:
  revolution_caddy_config:
```

The database runtime role already receives default DML grants; add an explicit verification query to the deployment contract instead of broadening role privileges.

- [ ] **Step 6: Add an edge request-size exception for the upload route**

Keep the existing 2 MiB default and isolate the 11 MiB multipart allowance to the exact admin upload method/path:

```caddyfile
@resumeUpload {
  method POST
  path /api/admin/resume
}

handle @resumeUpload {
  request_body {
    max_size 11MB
  }
  reverse_proxy web:3000 {
    flush_interval -1
  }
}

handle {
  request_body {
    max_size 2MB
  }
  reverse_proxy web:3000 {
    flush_interval -1
  }
}
```

Retain the existing redirects, compression and JSON access log. The access log records request metadata and status only; it must not log multipart bodies or headers containing passwords.

- [ ] **Step 7: Run retention/deployment tests and commit**

Run: `node --env-file-if-exists=.env.local --test tests/retention-integration.test.ts tests/operations-scripts.test.ts tests/worker.test.ts tests/resume-deployment-contract.test.ts`

Expected: PASS; repeat cleanup produces zero additional changes and never removes the current ciphertext.

```powershell
git add -- scripts/cleanup-expired.mjs scripts/cleanup-resume-storage.mjs scripts/worker.mjs tests/retention-integration.test.ts tests/operations-scripts.test.ts tests/worker.test.ts compose.production.yaml deploy/caddy/Caddyfile tests/resume-deployment-contract.test.ts
git commit -m "feat: retain private resume data safely"
```

### Task 10: Prove RAG, build and Provider isolation

**Files:**
- Create: `tests/resume-isolation.test.ts`
- Modify: `tests/public-knowledge.test.ts`
- Modify: `tests/chat-service-integration.test.ts`
- Modify: `tests/chat-contract.test.ts`
- Modify: `scripts/architecture-contract.test.mjs`
- Modify: `.dockerignore`

- [ ] **Step 1: Write failure-first leakage tests**

Use a synthetic marker `SYNTHETIC_PRIVATE_RESUME_MARKER_7F42` only in an in-memory PDF. Test public HTML/RSC responses, `.next/static`, `.next/server`, public knowledge extraction, generated knowledge rows, Provider requests, chat history, application log captures and error bodies. Test three requests: chat Cookie only, resume Cookie only, and both Cookies.

```ts
test('chat provider input is identical with or without a resume cookie', async () => {
  const withoutResume = await captureProviderRequest({ cookie: chatCookie });
  const withResume = await captureProviderRequest({
    cookie: `${chatCookie}; morse_resume_access=${resumeToken}`,
  });
  assert.deepEqual(withResume, withoutResume);
  assert.doesNotMatch(JSON.stringify(withResume), /SYNTHETIC_PRIVATE_RESUME_MARKER_7F42/);
  assert.doesNotMatch(JSON.stringify(withResume), /resume_documents|private[\\/]resume|trustedPersonNote/i);
});
```

- [ ] **Step 2: Run isolation tests before adding guards**

Run: `node --env-file-if-exists=.env.local --test tests/resume-isolation.test.ts tests/public-knowledge.test.ts tests/chat-service-integration.test.ts tests/chat-contract.test.ts scripts/architecture-contract.test.mjs`

Expected: the new test initially FAILS on explicit source/build isolation assertions until the allowlists are updated; existing chat behavior must not change.

- [ ] **Step 3: Add architectural allowlists, not resume parsing**

The resume modules may be imported only by `/api/resume/*`, `/api/admin/resume/*`, cleanup scripts and resume tests. `lib/server/chat-service.ts`, `lib/server/rag.ts`, `lib/server/knowledge.ts`, `lib/server/public-knowledge.ts`, `lib/server/embedding.ts`, Provider adapters and ingestion scripts must not import any `resume-*` module or query any `resume_*` table.

Extend `.dockerignore` with local private-resume directory names even though production uses a volume:

```dockerignore
private
private-resume
*.morsepdf
```

- [ ] **Step 4: Run the isolation suite and a production build scan**

Run: `node --env-file-if-exists=.env.local --test tests/resume-isolation.test.ts tests/public-knowledge.test.ts tests/chat-service-integration.test.ts tests/chat-contract.test.ts scripts/architecture-contract.test.mjs`

Run: `npm run build`

Run: `rg -n -S "SYNTHETIC_PRIVATE_RESUME_MARKER_7F42|%PDF-|morse_resume_access|resume_documents" .next/static public content`

Expected: tests and build PASS; scan returns no synthetic marker, PDF bytes, private Cookie name or resume table name in browser-delivered static assets. Server route code may contain the Cookie and table names, so `.next/server` is checked for the synthetic marker only.

- [ ] **Step 5: Commit the isolation slice**

```powershell
git add -- tests/resume-isolation.test.ts tests/public-knowledge.test.ts tests/chat-service-integration.test.ts tests/chat-contract.test.ts scripts/architecture-contract.test.mjs .dockerignore
git commit -m "test: prove private resume isolation"
```

### Task 11: Complete local browser acceptance, split review and deployment gate

**Files:**
- Create: `scripts/private-resume-visual-smoke.mjs`
- Create: `docs/verify/private-resume/private-resume-closeout.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-20-private-resume-access-design.md`

- [ ] **Step 1: Add a synthetic local browser smoke**

The script creates a synthetic invite and synthetic PDF in the temporary test environment, then validates at 1440x900 and 390x844: locked entry, invalid code, valid redemption, authorized PDF link, logout, expired Session, revoked Session, no-document state, admin upload, invite creation and revoke. It records screenshots only before the PDF link is opened; file acceptance records response headers and status, never PDF pixels.

Run: `node scripts/private-resume-visual-smoke.mjs http://127.0.0.1:3010`

Expected: PASS with `console_errors=0`, `page_errors=0`, no unexpected external request, no horizontal overflow and all controls at least 44px high.

- [ ] **Step 2: Run the complete local exit verification once**

Run: `npm test`

Expected: PASS with no skipped resume security or integration tests.

Run: `npm run build`

Expected: PASS.

Run: `npm run release:smoke`

Expected: PASS against a fresh local production-mode stack using only synthetic data.

- [ ] **Step 3: Perform the CRITICAL split review**

Compliance review checks every confirmed product rule and security invariant in `docs/superpowers/specs/2026-07-20-private-resume-access-design.md`. Quality/safety review checks transaction rollback, filesystem recovery, request limits, error uniformity, retention, Cookie/origin behavior, mobile states and test realism. Both reviewers return PASS or blocker IDs; all blocker IDs must close within the three-correction budget before proceeding.

- [ ] **Step 4: Reconcile documentation without private data**

Update README with environment variable names, disabled-by-default behavior, synthetic local verification and the fact that real PDF upload is an administrator-only production operation. Mark the design spec `已实施，待生产观察` only after local verification passes. `docs/verify/private-resume/private-resume-closeout.md` records commit IDs, commands, pass counts, response-header assertions and open external gates; it must not contain screenshots of the PDF, invite plaintext, IP, User-Agent, device data, storage names or secrets.

- [ ] **Step 5: Commit the locally ready milestone through closeout**

Run the `closeout` skill with the StagePacket and fresh VerificationReceipt. Stage only files named by this plan, leave all unrelated untracked files untouched, invoke `neat-freak`, and require `KNOWLEDGE_RECONCILED` as `updated` or `checked-no-change`.

```powershell
git add -- scripts/private-resume-visual-smoke.mjs docs/verify/private-resume/private-resume-closeout.md README.md docs/superpowers/specs/2026-07-20-private-resume-access-design.md
git commit -m "docs: close private resume local milestone"
```

- [ ] **Step 6: Stop at the external authorization gate**

Before push or production changes, present: branch and HEAD, exact commits, test/build/smoke receipt, review verdict, migration `003` checksum, required secret names, rollback path and the explicit list of actions requiring authorization. Do not include secret values.

- [ ] **Step 7: After explicit authorization, deploy in recoverable order**

1. Back up PostgreSQL and verify the backup artifact outside the application container.
2. Create the private named volume and set production resume secrets without echoing them.
3. Pull the reviewed commit, build images, run migration `003`, and verify `schema_migrations` checksum.
4. Start Web and Worker with `MORSE_RESUME_ENABLED=false`; verify health/readiness.
5. Enable the feature and restart only Web/Worker; verify the locked public entry with no PDF uploaded.
6. Upload the real final PDF through the administrator UI without screenshots or body logging.
7. Create one real invitation only when separately authorized; verify one redemption or use a synthetic invitation for smoke.
8. Observe only status codes, security headers, ciphertext SHA-256/size, database authorization state and health logs.

Expected reached state after deployment but before the last observation: `DEPLOYED_UNOBSERVED`.

- [ ] **Step 8: Observe production and close**

Verify: unauthorized file request is 401, locked entry is visible, authorized synthetic or explicitly approved real request is 200 with `application/pdf`, `no-store`, `nosniff` and inline disposition, revocation makes the next file request 401, Worker retention run reports counts only, and chat Provider capture contains no resume marker or metadata.

Record deployed revision and environment, then mark `OBSERVED`. Run `closeout` and `neat-freak` once more if deployment changed runbooks or configuration documentation; final state must be `KNOWLEDGE_RECONCILED` before `CLOSE`.

## Rollback Contract

- Set `MORSE_RESUME_ENABLED=false` and restart Web to close the entry without deleting data.
- Roll back application containers to the prior reviewed image; migration `003` is additive and remains applied.
- Do not drop resume tables during incident rollback.
- If the new ciphertext is unreadable, keep the feature disabled and re-upload the final PDF with the correct key; never restore a plaintext server copy.
- If the encryption key is lost, report the encrypted file as unrecoverable and require an administrator re-upload. Do not attempt key recovery from logs, database, browser or build artifacts.
- If revocation or isolation tests fail, keep resume access disabled even when the rest of the portfolio remains healthy.
