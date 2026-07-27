# Editable Environment Provider Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` as the focused execution method inside the active Morse lifecycle. Execute every checkbox in order and preserve the StagePacket boundaries below.

**Goal:** Let an administrator explicitly take over any Environment Chat Provider into the encrypted database configuration, then edit, test, replace, activate, roll back, and delete it without exposing secrets or changing the live route during draft save.

**Architecture:** Add one immutable takeover relation that points at the initial connection/model versions and uses a client request UUID for commit-acknowledgement replay. A focused server module owns environment resolution and the atomic takeover transaction; existing version, test, route, rollback, and deletion services remain authoritative. Test eligibility becomes a server-computed read model, while the admin UI reuses the current two-step Provider form and keeps a taken-over Environment target visible only when it is still part of the effective live route.

**Tech Stack:** Next.js App Router, React 19, TypeScript 6, PostgreSQL 16, Node test runner, CSS Modules, controlled Mock OpenAI, headless Edge/CDP.

---

## StagePacket

```yaml
stage: editable-environment-provider-takeover
outcome: administrator can take over both configured Environment Providers into editable database Providers and atomically replace the original route position after an eligible manual test
controls:
  execution: STAGED
  risk: CRITICAL
  delivery: LOCAL
state: EXECUTE
preset: null
scope:
  owned:
    - db/migrations/010_environment_provider_takeovers.sql
    - deploy/postgres/grant-runtime.sql
    - deploy/postgres/verify-ai-config-runtime.sql
    - lib/server/ai-config.ts
    - lib/server/provider-config-input.ts
    - lib/server/environment-provider-target.ts
    - lib/server/environment-provider-takeover.ts
    - lib/server/provider-test-state.ts
    - lib/server/admin-provider-config.ts
    - lib/server/ai-config-store.ts
    - lib/server/readiness.ts
    - app/api/admin/_shared.ts
    - app/api/admin/providers/runtime/environment/[targetKey]/takeover/route.ts
    - components/admin/admin-api-client.ts
    - components/admin/AdminApiConsole.tsx
    - components/admin/AdminProviderForm.tsx
    - components/admin/AdminProviderLibrary.tsx
    - components/admin/AdminEnvironmentProviders.tsx
    - components/admin/AdminRouteEditor.tsx
    - components/admin/AdminApiConsole.module.css
    - scripts/admin-api-visual-smoke.mjs
    - focused tests and closeout evidence named by this plan
  forbidden:
    - production database or server mutation
    - real Provider calls
    - push or deployment
    - embedding, RAG, search Provider, ingest, or Edge changes
    - .env files, Docker secrets, credentials, or key material
    - db/migrations/009_db_growth_indexes.sql
    - .github/
  unrelated_or_unknown:
    - .github/
    - db/migrations/009_db_growth_indexes.sql
dod:
  - every configured Environment target has an edit/takeover entry without returning its key
  - configured Environment URLs stay server-only while null takeover input safely reuses them
  - takeover save is atomic, idempotent by requestId, and performs zero Provider calls
  - primary and fallback-1 independently prove their URL, key, digest, initial versions, and takeover relation
  - same-digest eligibility and latest test are computed by the server with database time
  - failed tests remain retryable and do not erase an unexpired prior success
  - replacement keeps the original Environment route position and every other route target unchanged
  - every route mutation preserves each locked target at its exact current index
  - takeover-linked initial history is tombstoned; connection deletion shreds secrets and releases takeover atomically
  - desktop and mobile complete the flow without overlap, overflow, console errors, or broken controls
approvals:
  - local implementation, local commits, disposable database, synthetic mock transport, and local browser verification are authorized
  - any real Provider call, production migration, push, or deployment requires a new explicit approval
verification:
  focused:
    - node --test tests/provider-config-input.test.ts tests/ai-config.test.ts
    - node --test tests/migration-integration.test.ts tests/provider-deployment-contract.test.ts tests/readiness.test.ts
    - node --test tests/admin-provider-integration.test.ts tests/admin-provider-api-contract.test.ts
    - node --test tests/admin-api-management-ui-contract.test.ts tests/admin-provider-ui-state.test.ts
  stage_exit:
    - npm run typecheck
    - npm test
    - npm run build
    - npm run visual:admin-api
  real_observation: []
review:
  shape: split
  correction_budget: 3
knowledge_impact:
  - docs/portfolio-blueprint.md
  - docs/engineering-standards.md
  - docs/verify/admin-api/
non_goals:
  - edit server environment variables from the browser
  - automatically test, retry, activate, or take over a Provider
  - change Chat failover semantics or route size
  - run a production migration or observe a real Provider
```

## Focused Design Brief

- Mode: `Focused fix`; preserve the existing API configuration workbench and visual language.
- User: the sole administrator changing fast-moving relay URLs, keys, models, and reasoning parameters.
- Primary path: inspect current route -> edit an Environment source -> save encrypted draft -> manually test -> replace the same route position.
- Information hierarchy: current route remains first; editable database library remains second; Environment sources become a compact “system source” band with edit/test actions and explicit takeover state.
- State contract: lifecycle, activation eligibility, and latest real test are three separate labels; a rate limit appears only as an action error.
- Mobile: one-column Environment rows and the existing full-screen form; no side-by-side compression or hidden primary action.
- Visual constraint: reuse existing tokens and CSS Module patterns; add no new palette, decorative cards, gradients, or runtime assets.
- Acceptance: both 1440x900 and 390x844 can open, save, retry test, and replace without overflow, overlap, or stale status inference.

## File Map

| File | Responsibility |
|---|---|
| `db/migrations/010_environment_provider_takeovers.sql` | Immutable takeover relation, active-target uniqueness, release-only lifecycle |
| `lib/server/environment-provider-target.ts` | Canonical Environment target resolution, effective default URL, secret-bearing digest input |
| `lib/server/environment-provider-takeover.ts` | Advisory lock, request replay, atomic encrypted draft creation, conflict audit, takeover reads |
| `lib/server/provider-test-state.ts` | Database-time eligibility and latest-test read model by config digest |
| `lib/server/admin-provider-config.ts` | Existing catalog/runtime integration, deletion history, route activation, testing |
| `app/api/admin/providers/runtime/environment/[targetKey]/takeover/route.ts` | Authenticated strict takeover HTTP boundary |
| `components/admin/AdminEnvironmentProviders.tsx` | Environment source/takeover status and edit/test/replace actions |
| `components/admin/AdminProviderForm.tsx` | Reused two-step form with Environment prefill and optional key inheritance |
| `components/admin/AdminRouteEditor.tsx` | Keep a taken-over but currently active Environment target visible and locked |
| `scripts/admin-api-visual-smoke.mjs` | Synthetic end-to-end takeover, retryable test, replacement, dual-width screenshots |

## StagePacket 1: Persistence, Grants, And Readiness

### Task 1: Add the immutable takeover relation

**Files:**
- Create: `db/migrations/010_environment_provider_takeovers.sql`
- Modify: `tests/migration-integration.test.ts`
- Modify: `deploy/postgres/grant-runtime.sql`
- Modify: `deploy/postgres/verify-ai-config-runtime.sql`
- Modify: `tests/provider-deployment-contract.test.ts`
- Modify: `lib/server/readiness.ts`
- Modify: `tests/readiness.test.ts`

- [ ] **Step 1: Write the failing migration and privilege tests**

Append a schema-contract test that applies a temporary migration set without the unrelated `009` file and verifies the table, columns, restrictive foreign keys, active-target unique index, and release-only update trigger:

```ts
test('migration 010 adds immutable replayable environment takeover history', async () => {
  const database = await createDisposablePostgresDatabase();
  const directory = await copyMigrations();
  await fs.rm(path.join(directory, '009_db_growth_indexes.sql'), { force: true });
  try {
    const migrated = await runMigrations(database.connectionString, directory);
    assert.equal(migrated.code, 0, migrated.stderr);
    await withPostgresClient(database.connectionString, async (client) => {
      const table = await client.query(
        "SELECT to_regclass('public.ai_environment_takeovers')::text AS name",
      );
      assert.equal(table.rows[0].name, 'ai_environment_takeovers');
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'ai_environment_takeovers'`,
      );
      for (const name of ['request_id', 'environment_target_key', 'source_config_digest',
        'initial_connection_version_id', 'initial_model_version_id', 'released_at']) {
        assert.ok(columns.rows.some((column) => column.column_name === name), name);
      }
      const constraints = await client.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'public.ai_environment_takeovers'::regclass`,
      );
      assert.equal(
        constraints.rows.filter((row) => /FOREIGN KEY/u.test(row.definition)
          && /ON DELETE RESTRICT/u.test(row.definition)).length,
        2,
      );
      const indexes = await client.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'ai_environment_takeovers'`,
      );
      assert.ok(indexes.rows.some((row) => /UNIQUE.+environment_target_key.+released_at IS NULL/iu
        .test(row.indexdef)));
      const trigger = await client.query<{ name: string }>(
        `SELECT tgname AS name FROM pg_trigger
          WHERE tgrelid = 'public.ai_environment_takeovers'::regclass
            AND NOT tgisinternal`,
      );
      assert.deepEqual(trigger.rows.map((row) => row.name), [
        'ai_environment_takeovers_immutable_update',
      ]);
    });
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
    await database.dispose();
  }
});
```

Extend deployment and readiness contracts so `runtime` must have `SELECT, INSERT, UPDATE` but not `DELETE`, and readiness reads the new table.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
node --test tests/migration-integration.test.ts tests/provider-deployment-contract.test.ts tests/readiness.test.ts
```

Expected: failure because migration `010`, its grants, and the readiness relation check do not exist.

- [ ] **Step 3: Create migration 010 with release-only lifecycle**

Create the migration with this complete shape:

```sql
CREATE TABLE ai_environment_takeovers (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  environment_target_key varchar(32) NOT NULL
    CHECK (environment_target_key IN ('primary', 'fallback-1', 'fallback-2')),
  source_config_digest char(64) NOT NULL
    CHECK (source_config_digest ~ '^[0-9a-f]{64}$'),
  initial_connection_version_id uuid NOT NULL
    REFERENCES ai_connections(id) ON DELETE RESTRICT,
  initial_model_version_id uuid NOT NULL
    REFERENCES ai_model_presets(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CHECK (released_at IS NULL OR released_at >= created_at)
);

CREATE UNIQUE INDEX ai_environment_takeovers_active_target_idx
  ON ai_environment_takeovers(environment_target_key)
  WHERE released_at IS NULL;
CREATE INDEX ai_environment_takeovers_connection_idx
  ON ai_environment_takeovers(initial_connection_version_id);
CREATE INDEX ai_environment_takeovers_model_idx
  ON ai_environment_takeovers(initial_model_version_id);

CREATE FUNCTION ai_guard_environment_takeover_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF ROW(NEW.id, NEW.request_id, NEW.environment_target_key, NEW.source_config_digest,
         NEW.initial_connection_version_id, NEW.initial_model_version_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.request_id, OLD.environment_target_key, OLD.source_config_digest,
         OLD.initial_connection_version_id, OLD.initial_model_version_id, OLD.created_at)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AI_ENVIRONMENT_TAKEOVER_IMMUTABLE';
  END IF;
  IF NOT (
    NEW.released_at IS NOT DISTINCT FROM OLD.released_at
    OR (OLD.released_at IS NULL AND NEW.released_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AI_ENVIRONMENT_TAKEOVER_RELEASE_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_environment_takeovers_immutable_update
BEFORE UPDATE ON ai_environment_takeovers
FOR EACH ROW EXECUTE FUNCTION ai_guard_environment_takeover_update();
```

- [ ] **Step 4: Narrow runtime privileges and include the table in readiness**

Add the table to the provider `REVOKE ALL` list, then grant only:

```sql
GRANT SELECT, INSERT, UPDATE
  ON TABLE ai_environment_takeovers
  TO runtime;
```

Add matching required/forbidden rows to `verify-ai-config-runtime.sql`, and extend the readiness query:

```sql
(SELECT count(*) FROM ai_environment_takeovers) >= 0 AS takeovers_readable
```

- [ ] **Step 5: Run the persistence checks and confirm GREEN**

Run:

```powershell
node --test tests/migration-integration.test.ts tests/provider-deployment-contract.test.ts tests/readiness.test.ts
```

Expected: all tests pass; the temporary migration directory excludes only the unrelated copied `009` file.

- [ ] **Step 6: Commit only StagePacket 1 files**

```powershell
git add -- db/migrations/010_environment_provider_takeovers.sql deploy/postgres/grant-runtime.sql deploy/postgres/verify-ai-config-runtime.sql lib/server/readiness.ts tests/migration-integration.test.ts tests/provider-deployment-contract.test.ts tests/readiness.test.ts
git diff --cached --check
git commit -m "feat: add environment provider takeover persistence"
```

Confirm `db/migrations/009_db_growth_indexes.sql` and `.github/` remain untracked and unstaged.

## StagePacket 2: Domain Transaction, Test State, And Deletion

### Task 2: Define strict input, errors, and canonical Environment targets

**Files:**
- Create: `lib/server/environment-provider-target.ts`
- Modify: `lib/server/ai-config.ts`
- Modify: `lib/server/provider-config-input.ts`
- Modify: `tests/ai-config.test.ts`
- Modify: `tests/provider-config-input.test.ts`
- Modify: `tests/admin-provider-integration.test.ts`

- [ ] **Step 1: Write failing error, parser, and default-URL tests**

Add the three public codes in the asserted order:

```ts
'AI_CONFIG_ENVIRONMENT_CHANGED',
'AI_CONFIG_ENVIRONMENT_UNAVAILABLE',
'AI_CONFIG_TAKEOVER_EXISTS',
```

Add strict parser coverage for a UUID `requestId`, 64-character lowercase digest, optional new key, nullable Base URL, nested first model, and cross-origin confirmation. Reject an unknown field, malformed UUID, malformed digest, non-string/non-null Base URL, and non-boolean confirmation.

Add integration assertions for all three redacted URL modes: an unset primary produces `public_default` plus the editable public prefill `https://api.openai.com/v1`; a configured safe URL produces `server_reusable` plus null prefill; a configured URL containing a private path/query fixture produces no full URL and either `server_reusable` for a safe path or `replacement_required` for query/userinfo/hash. Preserve the existing negative assertion in `tests/admin-provider-integration.test.ts:336-399` so serialized runtime JSON never contains the configured path, query, or secret.

Add a digest equivalence test proving Environment snapshots call the existing `createRuntimeConfigDigest` with `options.configKey.key` (the decoded `MORSE_PROVIDER_CONFIG_KEY`/key-file value) and canonical input containing the current Environment API Key plus `digestBaseUrl`. Primary without `OPENAI_BASE_URL` uses `digestBaseUrl: ''`; configured primary/fallback use their server values. Assert changing either current key or `digestBaseUrl` changes the digest; do not introduce an Environment-keyed HMAC or a second digest helper.

- [ ] **Step 2: Run the contract tests and confirm RED**

```powershell
node --test tests/ai-config.test.ts tests/provider-config-input.test.ts tests/admin-provider-integration.test.ts
```

Expected: missing public codes, parser export, and Environment target helper.

- [ ] **Step 3: Add the shared target type and effective URL resolver**

Create `environment-provider-target.ts` with these public contracts:

```ts
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export type EnvironmentTargetKey = 'primary' | 'fallback-1' | 'fallback-2';

export interface AdminEnvironmentProviderTarget {
  apiKey: string;
  baseUrlMode: 'public_default' | 'server_reusable' | 'replacement_required';
  baseUrlPrefill: string | null;
  digestBaseUrl: string;
  effectiveBaseUrl: string;
  key: EnvironmentTargetKey;
  maxOutputTokens: number;
  reasoningEffort: OpenAIReasoningEffort | null;
  snapshot: AiRouteTargetSnapshot;
  userAgent: string | null;
}

export function listAdminEnvironmentTargets(
  config: ProviderRuntimeConfig,
  configKey: AiConfigKey,
  outboundPolicy: ProviderOutboundPolicy,
): AdminEnvironmentProviderTarget[];
```

For primary, set `digestBaseUrl` to `config.openaiBaseUrl ?? ''` and `effectiveBaseUrl` to `config.openaiBaseUrl ?? OPENAI_DEFAULT_BASE_URL`. For fallbacks, both internal URL values use their configured URL. Classify configured values without exposing them: credential-free values accepted by the runtime outbound policy are `server_reusable`; userinfo/query/hash or otherwise structurally unsafe values are `replacement_required`; only the absent-primary default is `public_default` with a non-null prefill. Compute `snapshot.configDigest` only through `createRuntimeConfigDigest(canonicalInput, configKey.key)`. `apiKey`, `effectiveBaseUrl`, and `digestBaseUrl` are server-only and must never be spread into an HTTP result.

- [ ] **Step 4: Add the strict takeover parser**

Export this exact shape from `provider-config-input.ts`:

```ts
export interface ParsedEnvironmentTakeoverInput {
  apiKey: string | null;
  baseUrl: string | null;
  expectedConfigDigest: string;
  firstModel: ParsedModelInput;
  name: string;
  password: string;
  requestId: string;
  reuseKeyAcrossOrigin: boolean;
  userAgent: string | null;
}

export function parseEnvironmentTakeoverInput(input: unknown): ParsedEnvironmentTakeoverInput;
```

Use the existing strict `record`, `uuid`, `baseUrl`, `password`, `parseModelInput`, and key-length rules. `null` is the only inheritance sentinel; empty strings remain invalid. Add a `configDigest` helper that accepts only `/^[0-9a-f]{64}$/u`.

- [ ] **Step 5: Replace the private Environment builder without changing runtime snapshots**

In `admin-provider-config.ts`, remove the private `environmentTargets` implementation and call `listAdminEnvironmentTargets(options.runtimeConfig, options.configKey, options.outboundPolicy)`. Update Environment testing to use server-only `effectiveBaseUrl`, while route snapshots continue to use `digestBaseUrl`. Extend each public Environment runtime-summary item with `baseUrlMode`, `baseUrlPrefill`, `userAgent`, `modelDisplayName`, `inputUsdPerMillion`, and `outputUsdPerMillion`; never return `effectiveBaseUrl`, `digestBaseUrl`, or any configured full URL. Keep `endpointHost` as the only configured-endpoint location detail.

- [ ] **Step 6: Re-run the focused tests and commit**

```powershell
node --test tests/ai-config.test.ts tests/provider-config-input.test.ts tests/admin-provider-integration.test.ts
git add -- lib/server/ai-config.ts lib/server/provider-config-input.ts lib/server/environment-provider-target.ts lib/server/admin-provider-config.ts tests/ai-config.test.ts tests/provider-config-input.test.ts tests/admin-provider-integration.test.ts
git diff --cached --check
git commit -m "feat: define environment provider takeover contracts"
```

### Task 3: Implement the atomic, replayable takeover transaction

**Files:**
- Create: `lib/server/environment-provider-takeover.ts`
- Modify: `lib/server/admin-provider-config.ts`
- Modify: `tests/admin-provider-integration.test.ts`

- [ ] **Step 1: Write failure-first integration cases**

Add a complete happy-path test using the existing `withDatabase`, `options`, and runtime-summary helpers:

```ts
test('environment takeover creates one encrypted draft without a Provider call', async () => {
  await withDatabase(async (pool) => {
    let providerCalls = 0;
    const serviceOptions = options({
      transport: {
        async discover() { providerCalls += 1; return []; },
        async test() {
          providerCalls += 1;
          return { latencyMs: 1, usage: null };
        },
      },
    });
    const environment = (await getProviderRuntimeSummary(pool, serviceOptions))
      .environmentTargets.find((target) => target.environmentTargetKey === 'primary');
    assert.ok(environment);
    const result = await takeoverEnvironmentProvider(pool, 'primary', {
      apiKey: null,
      baseUrl: null,
      expectedConfigDigest: environment.configDigest,
      firstModel: model,
      name: 'Editable primary',
      requestId: randomUUID(),
      reuseKeyAcrossOrigin: false,
      userAgent: environment.userAgent,
    }, serviceOptions);
    assert.equal(providerCalls, 0);
    const counts = await pool.query<{
      connections: number; events: number; models: number; takeovers: number;
    }>(`SELECT
      (SELECT count(*) FROM ai_connections)::integer AS connections,
      (SELECT count(*) FROM ai_model_presets)::integer AS models,
      (SELECT count(*) FROM ai_environment_takeovers)::integer AS takeovers,
      (SELECT count(*) FROM ai_config_events
        WHERE event_type = 'environment_takeover_created')::integer AS events`);
    assert.deepEqual(counts.rows[0], {
      connections: 1, events: 1, models: 1, takeovers: 1,
    });
    assert.match(result.connectionSeriesId, /^[0-9a-f-]{36}$/u);
    assert.match(result.modelSeriesId, /^[0-9a-f-]{36}$/u);
  });
});
```

Add a separate `fallback-1 environment takeover creates an independent encrypted draft with zero Provider calls` integration test. Give primary and fallback-1 distinct URL/Key pairs, call takeover with `baseUrl: null`, and assert: transport count remains zero; decrypted connection key equals only the fallback key; stored connection URL equals only the fallback URL; stored model and connection are version 1; their digests and initial version IDs match the `fallback-1` takeover relation; `source_config_digest` equals the fallback Environment snapshot; and primary URL/Key/digest never appears in that draft. This is a functional integration proof only; do not add another visual Provider operation.

Add four additional named tests: rollback on a forced relation insert failure; same-request replay after `loseFirstCommitAcknowledgement`; two different request IDs yielding one takeover plus one committed conflict audit; and a mutable `runtimeConfigLoader` changing the digest while the second call waits on the advisory lock. Each test asserts row counts in `ai_connections`, `ai_model_presets`, `ai_environment_takeovers`, and `ai_config_events`; the inherited/replacement key is decrypted only inside the test for equality and is absent, including its final four characters, from serialized events and service results.

- [ ] **Step 2: Run the takeover cases and confirm RED**

```powershell
node --test --test-name-pattern="environment takeover|requestId|advisory lock" tests/admin-provider-integration.test.ts
```

Expected: missing `takeoverEnvironmentProvider` and takeover read functions.

- [ ] **Step 3: Implement the focused service API**

Export these contracts from `environment-provider-takeover.ts`:

```ts
export interface EnvironmentTakeoverResult {
  connectionSeriesId: string;
  connectionVersion: 1;
  modelSeriesId: string;
  modelVersion: 1;
  takeoverId: string;
}

export async function takeoverEnvironmentProvider(
  pool: pg.Pool,
  targetKey: EnvironmentTargetKey,
  input: Omit<ParsedEnvironmentTakeoverInput, 'password'>,
  options: AdminProviderServiceOptions,
): Promise<EnvironmentTakeoverResult>;
```

The transaction order must be exact:

```ts
await client.query(
  'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
  [`revolution:environment-provider-takeover:${targetKey}`],
);
const replay = await readTakeoverByRequestId(client, input.requestId);
if (replay) return assertSameTargetAndRedact(replay, targetKey);
const runtimeConfig = options.runtimeConfigLoader?.() ?? options.runtimeConfig;
const environment = requireEnvironmentTarget(runtimeConfig, options.configKey, targetKey);
if (environment.snapshot.configDigest !== input.expectedConfigDigest) {
  throw new AiConfigError('AI_CONFIG_ENVIRONMENT_CHANGED');
}
```

`requireEnvironmentTarget` must build `environment.snapshot.configDigest` with the existing `createRuntimeConfigDigest` and the same `options.configKey.key`; its canonical input contains the lock-time Environment API Key and `digestBaseUrl`. Do not add another digest algorithm or key it with the Environment API Key.

Resolve `input.baseUrl` after the digest check: a string is a requested replacement and uses the existing async outbound validation; `null` resolves to server-only `environment.effectiveBaseUrl` only when `baseUrlMode !== 'replacement_required'`, otherwise throw `AI_CONFIG_INVALID`. Then validate origin reuse against that server value, choose `input.apiKey ?? environment.apiKey`, call `createConnectionWithModel`, insert `ai_environment_takeovers`, insert `environment_takeover_created`, and commit. Use `randomUUID()` for takeover ID and the existing AES-256-GCM store path for the key.

When a new request hits the active-target unique relation, roll back the business transaction, write one redacted `environment_takeover_conflict` event in a separate transaction, then throw `AI_CONFIG_TAKEOVER_EXISTS`. Do not write a denied event when COMMIT succeeded but its acknowledgement was lost.

- [ ] **Step 4: Make production re-read environment configuration inside the lock**

Extend `AdminProviderServiceOptions`:

```ts
runtimeConfigLoader?: () => ProviderRuntimeConfig;
```

Set it to `loadServerConfig` in `adminProviderServiceOptions`. Integration tests provide a mutable loader to prove the digest comparison happens after advisory-lock acquisition.

- [ ] **Step 5: Run the complete provider integration file and commit**

```powershell
node --test tests/admin-provider-integration.test.ts
git add -- lib/server/environment-provider-takeover.ts lib/server/admin-provider-config.ts app/api/admin/_shared.ts tests/admin-provider-integration.test.ts
git diff --cached --check
git commit -m "feat: take over environment providers atomically"
```

Do not stage an unchanged `app/api/admin/_shared.ts`; it is listed only if the service option factory changes there in this task.

### Task 4: Move test eligibility to the server and preserve takeover history on deletion

**Files:**
- Create: `lib/server/provider-test-state.ts`
- Modify: `lib/server/ai-config.ts`
- Modify: `lib/server/environment-provider-takeover.ts`
- Modify: `lib/server/admin-provider-config.ts`
- Modify: `lib/server/ai-config-store.ts`
- Modify: `tests/admin-provider-integration.test.ts`

- [ ] **Step 1: Write failing eligibility and deletion tests**

Add integration cases that seed audit events relative to `SELECT clock_timestamp()` and assert this read model:

```ts
{
  eligibility: 'eligible',
  successExpiresAt: '2026-07-27T10:30:00.000Z',
  latestTest: {
    latencyMs: null,
    resultCode: 'AI_CONFIG_TEST_FAILED',
    status: 'failed',
    testedAt: '2026-07-27T10:10:00.000Z',
  },
}
```

The eligible case must have a success 10 minutes ago followed by a failure 1 minute ago. Also cover success 31 minutes ago as `expired`, failure-only as `untested`, and a `provider_operation_denied` event as absent from `latestTest`.

Rewrite the existing activation-window tests to obtain one `clock_timestamp()` from PostgreSQL, seed event times relative to that value, and assert that the activation gate and the read model agree at the 30-minute boundary. Keep the immediately-previous-route rollback grace, but remove reliance on an injected application clock for activation eligibility.

Add deletion cases that prove:

- deleting the takeover's initial model returns `history_retained`, tombstones rows, and leaves `released_at` null;
- deleting the takeover connection while inactive tombstones every connection/model version, nulls ciphertext/IV/tag, sets every `secret_destroyed_at`, and sets exactly one `released_at` in the same transaction;
- an injected failure before release rolls back tombstones and secret shredding;
- a released target accepts a new request ID and creates a second takeover history row.

- [ ] **Step 2: Run the focused cases and confirm RED**

```powershell
node --test --test-name-pattern="eligibility|latest test|takeover.*delet|released target" tests/admin-provider-integration.test.ts
```

Expected: catalog/runtime have no server test state and deletion can still choose physical removal.

- [ ] **Step 3: Add the database-time test-state query**

Define the shared response contract in `ai-config.ts`:

```ts
export interface AiProviderTestState {
  eligibility: 'untested' | 'eligible' | 'expired';
  latestTest: null | {
    latencyMs: number | null;
    resultCode: string;
    status: 'succeeded' | 'failed';
    testedAt: string;
  };
  successExpiresAt: string | null;
}
```

Create `provider-test-state.ts` with:

```ts
export async function readProviderTestStates(
  queryable: Pick<pg.Pool | pg.PoolClient, 'query'>,
  digests: string[],
): Promise<Map<string, AiProviderTestState>>;
```

Use one SQL query with `clock_timestamp()`, a lateral latest actual test ordered by `created_at DESC, id DESC`, and a lateral latest successful test. Restrict event types to `provider_test` and `environment_test`, restrict latest statuses to `succeeded` and `failed`, and calculate `success_expires_at = max(success.created_at) + interval '30 minutes'`. Do not read a fixed-size event page.

At the start of `activateProviderRoute`'s locked transaction, read one PostgreSQL `clock_timestamp()` and use it for `testedRecently`, `ai_route_revisions.activated_at`, `ai_runtime_state.updated_at`, and rollback-grace comparison. Remove the application-clock argument from `testedRecently`; this keeps the activation decision on the same time authority as the read model.

- [ ] **Step 4: Attach test state to catalog and runtime read models**

In `getProviderCatalog`, fetch states for every returned current model digest and add `testState` to each model. In `getProviderRuntimeSummary`, fetch states for current route and configured Environment digests, add `testState` to route targets and Environment targets, and add:

```ts
takeover: null | {
  connectionSeriesId: string;
  modelSeriesId: string;
  sourceConfigMatches: boolean;
  takeoverId: string;
}
```

The takeover query must join initial version IDs back to their series IDs and return only `released_at IS NULL`. The Environment response may return `endpointHost`, `baseUrlMode`, the public-default-only `baseUrlPrefill`, User-Agent, model metadata, and prices, but must never return a configured full URL, `effectiveBaseUrl`, `digestBaseUrl`, `apiKey`, ciphertext, IV, tag, secret suffix, or request headers.

- [ ] **Step 5: Make takeover-linked deletion historical and atomic**

Add `tombstoneConnection` to `ai-config-store.ts` so connection lifecycle and model lifecycle updates share the same transaction helper. Extend `modelHistory` and `connectionHistory` with active takeover joins. On connection deletion, call this sequence inside the existing transaction:

```ts
await shredConnectionSecret(client, connectionSeriesId, deletionTime);
await tombstoneConnection(client, connectionSeriesId, deletionTime);
await tombstoneModelsForConnection(client, connectionSeriesId, deletionTime);
await releaseEnvironmentTakeover(client, connectionSeriesId, deletionTime);
```

Insert `environment_takeover_released` only when an active takeover row was released. A model-only deletion never calls the release function.

- [ ] **Step 6: Run the full server boundary and commit**

```powershell
node --test tests/ai-config-store-integration.test.ts tests/admin-provider-integration.test.ts
npm run typecheck
git add -- lib/server/ai-config.ts lib/server/provider-test-state.ts lib/server/environment-provider-takeover.ts lib/server/admin-provider-config.ts lib/server/ai-config-store.ts tests/admin-provider-integration.test.ts
git diff --cached --check
git commit -m "feat: expose provider eligibility and safe takeover deletion"
```

## StagePacket 3: Admin HTTP Contract

### Task 5: Add the authenticated takeover endpoint and stable public errors

**Files:**
- Create: `app/api/admin/providers/runtime/environment/[targetKey]/takeover/route.ts`
- Modify: `app/api/admin/_shared.ts`
- Modify: `tests/admin-provider-api-contract.test.ts`

- [ ] **Step 1: Write failing API contract coverage**

Add the new route to `routePaths`, import it in the test setup, and exercise:

- unauthenticated request -> `401` + `no-store`;
- missing/wrong Origin -> `403`;
- wrong password -> `401` before any takeover row;
- unknown body field or invalid target -> `400`;
- environment digest changed -> `409 AI_CONFIG_ENVIRONMENT_CHANGED`;
- first valid request -> redacted success;
- same request ID replay -> byte-equivalent redacted identifiers with no extra versions;
- different request ID -> `409 AI_CONFIG_TAKEOVER_EXISTS`;
- unavailable target -> `503 AI_CONFIG_ENVIRONMENT_UNAVAILABLE`;
- `baseUrl: null` against `replacement_required` -> `400 AI_CONFIG_INVALID`, with no draft rows;
- response, audit JSON, and captured `console.error`/`console.warn` text do not contain any configured full URL/path/query fixture, submitted key, inherited key, ciphertext hex/base64, tag hex/base64, or key suffix.

- [ ] **Step 2: Run the API file and confirm RED**

```powershell
node --test tests/admin-provider-api-contract.test.ts
```

Expected: the takeover route and new error mappings are absent.

- [ ] **Step 3: Implement the strict route using existing security helpers**

Create the route with the same boundary order as other Provider mutations:

```ts
export const runtime = 'nodejs';
interface Context { params: Promise<{ targetKey: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const { targetKey } = await context.params;
    if (!isEnvironmentTargetKey(targetKey)) return adminInvalid();
    const input = parseEnvironmentTakeoverInput(await request.json());
    const rejected = await reauthenticateAdmin(auth, input.password);
    if (rejected) return rejected;
    const takeoverInput = {
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      expectedConfigDigest: input.expectedConfigDigest,
      firstModel: input.firstModel,
      name: input.name,
      requestId: input.requestId,
      reuseKeyAcrossOrigin: input.reuseKeyAcrossOrigin,
      userAgent: input.userAgent,
    };
    return NextResponse.json(
      await takeoverEnvironmentProvider(
        auth.pool,
        targetKey,
        takeoverInput,
        adminProviderServiceOptions(auth),
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return error instanceof ProviderConfigInputError || error instanceof SyntaxError
      ? adminInvalid()
      : adminProviderError(error);
  }
}
```

Use a named target-key guard exported from `environment-provider-target.ts`; do not repeat loose casts in the route.

- [ ] **Step 4: Map the new stable errors without leaking internals**

In `adminProviderError`, map `AI_CONFIG_ENVIRONMENT_CHANGED` and `AI_CONFIG_TAKEOVER_EXISTS` to `409`, and `AI_CONFIG_ENVIRONMENT_UNAVAILABLE` to `503`. Preserve the existing rule that internal key-loading codes collapse to `AI_CONFIG_UNAVAILABLE`.

- [ ] **Step 5: Run API, type, and redaction checks**

```powershell
node --test tests/admin-provider-api-contract.test.ts tests/provider-config-input.test.ts tests/ai-config.test.ts
npm run typecheck
rg -n "apiKey|ciphertext|api_key_tag|key suffix|OPENAI_API_KEY" app/api/admin/providers/runtime/environment lib/server/environment-provider-takeover.ts
```

Expected: tests and typecheck pass; search hits are only request parsing/server-only handling, never response construction or logging.

- [ ] **Step 6: Commit StagePacket 3**

```powershell
git add -- app/api/admin/_shared.ts app/api/admin/providers/runtime/environment/[targetKey]/takeover/route.ts tests/admin-provider-api-contract.test.ts
git diff --cached --check
git commit -m "feat: expose environment provider takeover API"
```

## StagePacket 4: Admin UI, Route Replacement, And Visual Acceptance

### Task 6: Replace browser-side event inference with typed server state

**Files:**
- Modify: `components/admin/admin-api-client.ts`
- Create: `tests/admin-provider-ui-state.test.ts`
- Create: `components/admin/provider-ui-state.ts`
- Modify: `components/admin/AdminApiConsole.tsx`
- Modify: `components/admin/AdminProviderLibrary.tsx`
- Modify: `tests/admin-api-management-ui-contract.test.ts`

- [ ] **Step 1: Write failing pure-state and source-contract tests**

Add pure tests for labels and replacement construction:

```ts
assert.deepEqual(testStateLabels({
  eligibility: 'eligible',
  successExpiresAt: '2026-07-27T10:30:00.000Z',
  latestTest: {
    latencyMs: null,
    resultCode: 'AI_CONFIG_TEST_FAILED',
    status: 'failed',
    testedAt: '2026-07-27T10:10:00.000Z',
  },
}), {
  eligibility: '30 分钟内测试通过',
  latest: '最近测试失败',
});
```

Assert `replaceEnvironmentTarget` replaces only the matching Environment target at the same array index and leaves all other target objects in the same order. Assert a missing Environment target returns `null` so the UI opens the route editor instead of inventing a route.

Add pure `preserveLockedRouteIndices` cases with current keys `['a', 'locked', 'b', 'c']`: reject moving/removing `locked`, moving `a` after it, moving `b` before it, removing `a`, and inserting before it; allow reordering `b`/`c` on the same side. The rejected result must be the original array object so React does not render a transient invalid order.

Update the source contract to forbid `Date.now()` and fixed-page event inference in `targetTestLabel`/`testLabel`, and require `eligibility`, `successExpiresAt`, and `latestTest` in the client types.

- [ ] **Step 2: Run the UI state tests and confirm RED**

```powershell
node --test tests/admin-provider-ui-state.test.ts tests/admin-api-management-ui-contract.test.ts
```

Expected: the pure helper and typed server states are missing.

- [ ] **Step 3: Extend the client response types and takeover call**

Add:

```ts
export interface ProviderTestState {
  eligibility: 'untested' | 'eligible' | 'expired';
  latestTest: null | {
    latencyMs: number | null;
    resultCode: string;
    status: 'succeeded' | 'failed';
    testedAt: string;
  };
  successExpiresAt: string | null;
}

export interface EnvironmentTakeoverInput {
  apiKey: string | null;
  baseUrl: string | null;
  expectedConfigDigest: string;
  firstModel: ModelInput;
  name: string;
  requestId: string;
  reuseKeyAcrossOrigin: boolean;
  userAgent: string | null;
}

export interface EnvironmentTakeoverResult {
  connectionSeriesId: string;
  connectionVersion: 1;
  modelSeriesId: string;
  modelVersion: 1;
  takeoverId: string;
}
```

Add `testState` to models/runtime targets/Environment targets, add `baseUrlMode` and the public-default-only `baseUrlPrefill` plus other editable metadata and the nullable takeover summary to `EnvironmentTarget`, and add:

```ts
export function takeoverEnvironmentTarget(
  targetKey: EnvironmentTarget['environmentTargetKey'],
  input: EnvironmentTakeoverInput,
  password: string,
) {
  return requestJson<EnvironmentTakeoverResult>(
    `/api/admin/providers/runtime/environment/${targetKey}/takeover`,
    { method: 'POST', body: jsonBody({ ...input, password }) },
  );
}
```

Map the three new public errors to specific operator actions: refresh changed environment, use the existing takeover, or restore the missing server source.

- [ ] **Step 4: Add pure label and route replacement helpers**

In `provider-ui-state.ts`, export:

```ts
export function testStateLabels(state: ProviderTestState): {
  eligibility: string;
  latest: string;
};

export function replaceEnvironmentTarget(
  current: RouteTargetInput[],
  targetKey: EnvironmentTarget['environmentTargetKey'],
  replacement: Extract<RouteTargetInput, { source: 'database' }>,
): RouteTargetInput[] | null;

export function effectiveRouteInputs(runtime: ProviderRuntimeSummary): RouteTargetInput[];

export function preserveLockedRouteIndices(
  currentKeys: string[],
  nextKeys: string[],
  lockedKeys: ReadonlySet<string>,
): string[];
```

`effectiveRouteInputs` maps an explicit runtime revision to exact database model version IDs or Environment target keys; when no revision exists, it maps the configured Environment baseline. `replaceEnvironmentTarget` is the only place that constructs “替换并激活”; it must preserve array length and all non-matching entries by identity. `preserveLockedRouteIndices` returns `nextKeys` only when every locked key remains present at exactly its current numeric index; otherwise it returns the original `currentKeys` object. Cover moving the locked item, moving another item across it, deleting an item before it, and drag/drop across it as rejected, plus a same-side move as allowed.

- [ ] **Step 5: Consume server state everywhere**

Remove `targetTestLabel`, `lastTest`, and `testLabel`. Render `model.testState` and `target.testState` directly. Keep Provider events only for audit history/recent activation display. A failed action updates `actionError` but does not synthesize a failed test state; refresh retrieves the canonical server read model.

- [ ] **Step 6: Run and commit the typed-state slice**

```powershell
node --test tests/admin-provider-ui-state.test.ts tests/admin-api-management-ui-contract.test.ts
npm run typecheck
git add -- components/admin/admin-api-client.ts components/admin/provider-ui-state.ts components/admin/AdminApiConsole.tsx components/admin/AdminProviderLibrary.tsx tests/admin-provider-ui-state.test.ts tests/admin-api-management-ui-contract.test.ts
git diff --cached --check
git commit -m "fix: render canonical provider test state"
```

### Task 7: Add takeover editing, locked live-source display, and atomic replacement

**Files:**
- Create: `components/admin/AdminEnvironmentProviders.tsx`
- Modify: `components/admin/AdminApiConsole.tsx`
- Modify: `components/admin/AdminProviderForm.tsx`
- Modify: `components/admin/AdminRouteEditor.tsx`
- Modify: `components/admin/AdminApiConsole.module.css`
- Modify: `tests/admin-api-management-ui-contract.test.ts`
- Modify: `tests/admin-provider-ui-state.test.ts`

- [ ] **Step 1: Write failing component contracts**

Require these observable controls and states:

- one `[data-testid="environment-provider-primary"]` row per configured target;
- an enabled “编辑” action before takeover;
- public-default Base URL or a blank safe-reuse/replacement-required URL state, plus prefilled model/protocol/reasoning/output limit and an empty password input;
- explicit copy “将安全沿用当前服务器 Key” and no key suffix;
- separate lifecycle, eligibility, and latest-test labels;
- “替换并激活” only when the source is in the effective route and the takeover model is eligible;
- “加入路由” when the source is not in the effective route;
- a locked route candidate for a taken-over source still in the current route, omitted from “可加入线路”;
- pure mutation cases prove the locked candidate keeps the same index when another item is dragged, moved, removed, or appended;
- “再次测试” remains enabled after a failed latest test.

- [ ] **Step 2: Run UI contracts and confirm RED**

```powershell
node --test tests/admin-provider-ui-state.test.ts tests/admin-api-management-ui-contract.test.ts
```

Expected: Environment rows, takeover form mode, and locked route semantics do not exist.

- [ ] **Step 3: Extend the existing two-step form**

Add `takeover_environment` to `ProviderFormMode` and pass an `environmentTarget` plus stable `requestId` in `FormState`. Initialize the Base URL field only from public `baseUrlPrefill`: show the public default when present, otherwise keep it blank with “将安全沿用当前服务器 URL”; for `replacement_required`, show a blocking replacement message and require a new URL. Initialize other connection/model fields from safe server prefill and keep the key blank. Generate `crypto.randomUUID()` once when the edit action opens; reuse it while the reauthentication dialog remains open or the request is retried.

The form result must be:

```ts
| {
    mode: 'takeover_environment';
    takeover: EnvironmentTakeoverInput & {
      environmentTargetKey: EnvironmentTarget['environmentTargetKey'];
    };
  }
```

Serialize an untouched blank Base URL as `null`. Because the browser never receives the configured origin, show the existing Key-reuse confirmation whenever the administrator types a replacement URL while leaving Key blank; the server remains authoritative and rejects only an actual cross-origin reuse without confirmation.

- [ ] **Step 4: Add the compact Environment source band**

`AdminEnvironmentProviders.tsx` renders one unframed dense row per source with source name/host/model, lifecycle, eligibility, latest test, and actions. Before takeover show “编辑” and “测试”; after takeover show the database draft identity, “编辑数据库版本”, diagnostic “测试环境源”, and either “替换并激活” or “加入路由”. The component receives callbacks and performs no fetch itself.

- [ ] **Step 5: Preserve the effective live route and replacement position**

In `AdminApiConsole`, call `effectiveRouteInputs(runtime)` and build current keys from the corresponding runtime snapshots. For a taken-over Environment target still present, include one locked `RouteCandidate`; set `locked: true`, disable its drag/up/down/remove controls, and exclude it from the available list. Route every mutation of `keys` (button move, drag/drop, remove, and add) through `preserveLockedRouteIndices`; this also blocks an unlocked item from crossing a locked item or changing its index by removal/insertion. When replacing, call `replaceEnvironmentTarget`, then queue the existing `activateRoute(runtime.activeRevision, targets, password)` flow.

After acknowledgement, close form/route layers and refresh runtime/catalog. If `AI_CONFIG_CONFLICT` occurs, keep the current conflict banner and require canonical refresh.

- [ ] **Step 6: Add responsive styles using existing tokens only**

Add stable grid tracks for Environment rows, `min-width: 0` on long identity cells, wrapping action groups, and a single-column `@media (max-width: 640px)` layout. Use only existing `var(--...)` values from `app/styles/tokens.css`; no raw color literals, gradients, nested cards, or viewport-scaled font sizes.

- [ ] **Step 7: Run UI, type, and token checks**

```powershell
node --test tests/admin-provider-ui-state.test.ts tests/admin-api-management-ui-contract.test.ts
npm run typecheck
rg -n "#[0-9a-fA-F]{3,8}|rgb\(|hsl\(|linear-gradient|radial-gradient" components/admin/AdminApiConsole.module.css
```

Expected: tests/typecheck pass and the color scan returns no new raw color or gradient.

- [ ] **Step 8: Commit the complete UI interaction**

```powershell
git add -- components/admin/AdminEnvironmentProviders.tsx components/admin/AdminApiConsole.tsx components/admin/AdminProviderForm.tsx components/admin/AdminRouteEditor.tsx components/admin/AdminApiConsole.module.css tests/admin-api-management-ui-contract.test.ts tests/admin-provider-ui-state.test.ts
git diff --cached --check
git commit -m "feat: edit and replace environment providers"
```

### Task 8: Extend synthetic browser acceptance and close locally

**Files:**
- Modify: `scripts/admin-api-visual-smoke.mjs`
- Modify: `tests/admin-api-visual-smoke-contract.test.ts`
- Create: `docs/verify/admin-api/editable-provider-takeover-closeout.md`
- Modify: `docs/portfolio-blueprint.md`

- [ ] **Step 1: Write the failing visual-smoke source contract**

Require named checks for:

```text
takeover-save-no-provider
takeover-latest-failure-retryable
takeover-success-eligible
takeover-replace-same-position
desktop:environment-overflow
mobile:environment-overflow
```

Require screenshots of the Environment source band and takeover form at 1440x900 and 390x844.

- [ ] **Step 2: Add the synthetic takeover journey**

Before creating a manual Provider, open `Environment primary`, change display name/reasoning/output limit, leave the key blank, save through reauthentication, and verify the mock Provider has not been called through the in-process transport counter asserted by the server integration test. In browser smoke, verify no test-success audit row appears after save by calling the authenticated events endpoint. Set the synthetic primary Environment key to the harness `providerKey` so the inherited-key path can pass against Mock OpenAI without exposing the key to the browser.

Keep the existing global three-operations-per-minute budget exact: one manual discover failure, one successful takeover-model test, then one failed takeover-model test after restarting Mock OpenAI in a controlled failure scenario. Verify the later failure remains the latest test, the prior success remains eligible, and “再次测试” remains enabled. Do not perform a fourth Provider operation. Replace the live Environment primary while the latest test is failed and assert activation still succeeds from the unexpired prior success, its position index is unchanged, and every other target identity stays in order.

Extend the harness's expected-error filter only for the intentional failed model-test response; any other console/network error remains fatal.

Use only the loopback disposable database and Mock OpenAI already owned by the harness. Do not add a real credential or external origin.

- [ ] **Step 3: Run pre-browser checks and production build**

```powershell
node --test tests/admin-api-visual-smoke-contract.test.ts tests/admin-api-management-ui-contract.test.ts
npm run typecheck
npm run build
```

Expected: all pass and `.next/BUILD_ID` exists for the controlled production-mode smoke.

- [ ] **Step 4: Run the dual-width browser acceptance**

```powershell
npm run visual:admin-api
```

Expected: JSON receipt has `passed: true`, all named checks, `consoleErrors: 0`, `pageErrors: 0`, `externalOrigins: 0`, and screenshots for both widths.

- [ ] **Step 5: Inspect every generated screenshot**

Use visual inspection on the 1440x900 and 390x844 runtime, Environment source, form, and route screenshots. Confirm no overlap, horizontal overflow, clipped action, unreadable long URL/model, nested-card clutter, or ambiguous state label. Record any correction against this StagePacket and rerun only the affected focused/browser check.

- [ ] **Step 6: Run the final local verification receipt once**

```powershell
git diff --check
npm test
npm run build
```

Record exact pass/fail/skip counts, the current HEAD and intended diff, screenshot paths, mock-only Provider evidence, and these explicit gaps: no real Provider call, no production migration, no push, and no deployment.

- [ ] **Step 7: Perform CRITICAL split review**

Compliance review checks auth/origin/reauth, secret redaction, request replay, migration/grants, delete/release atomicity, cost boundary, and forbidden files. Quality/safety review checks version semantics, database-time state, route position preservation, manual Provider regressions, mobile/desktop interaction, and test adequacy. Admit blockers only with concrete evidence and close them within the three-batch correction budget.

- [ ] **Step 8: Route through closeout and knowledge reconciliation**

Load `closeout`, stage only files named by this plan plus justified knowledge/evidence updates, and produce the VerificationReceipt. Invoke `neat-freak`; `KNOWLEDGE_RECONCILED` may be `updated` or `checked-no-change`. Do not stage `.github/` or `db/migrations/009_db_growth_indexes.sql`, and do not push or deploy.

## Self-Review Checklist

- Spec coverage: every requirement in sections 5-14 maps to Tasks 1-8; no real Provider or production action is implied.
- Ownership: the untracked `009` migration and `.github/` are named forbidden/unrelated and excluded from every `git add` command.
- Type consistency: `EnvironmentTargetKey`, `ProviderTestState`, `EnvironmentTakeoverInput`, `EnvironmentTakeoverResult`, and `RouteTargetInput` have one definition each and matching server/client shapes.
- Secret URL boundary: configured Environment URLs remain server-only; public JSON exposes only host, mode, and the known OpenAI default.
- Digest authority: Environment takeover reuses `createRuntimeConfigDigest` with `AiConfigKey.key`, lock-time Environment Key, and `digestBaseUrl`.
- Transaction safety: request replay is checked under target lock before active-takeover conflict; conflict audit is outside rollback; deletion release shares the tombstone/secret-shred transaction.
- Route lock: all draft mutations pass one pure index-preservation guard; locked items cannot move indirectly.
- UI truth: no browser clock or last-100-event inference remains; lifecycle, eligibility, latest test, and operation rate limit stay separate.
- Migration delivery: local file is `010`; publication remains blocked until `009` ownership/order is resolved independently.
- Verification cadence: focused RED/GREEN per task, one affected-boundary pass per StagePacket, one full suite/build/visual receipt at local exit.

## Resume Pointer

Current stage and state: `EXECUTE / Task 1 not started`.

Last completed verified step: independent re-review returned `READY_TO_CONTRACT` after verifying configured-URL redaction, canonical HMAC, locked-index preservation, and fallback-1 functional proof.

Exact next action: begin Task 1 Step 1 with failing migration/grant/readiness tests, without touching real Provider, production, `009`, or `.github/`.
