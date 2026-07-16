# S10 Smart Customer Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally verifiable Digital Morse customer-service system with three workflows, 12-hour conversation recovery, 10-day analysis records, local RAG, controlled Bocha search, private admin analytics, and idempotent Feishu alerts.

**Architecture:** Extend the existing `/api/chat -> runChat -> pgvector -> AiProvider -> SSE -> MorseChat` chain instead of creating a second chat stack. Keep ephemeral conversation history separate from durable 10-day interaction records, inject Provider/Search/Alert boundaries, and use one additive PostgreSQL migration with a checksum-aware runner.

**Tech Stack:** Next.js App Router, TypeScript, React, CSS Modules, Node.js `crypto`, PostgreSQL 16 + pgvector, local BGE OpenAI-compatible embedding server, OpenAI-compatible Responses/Chat Completions, Bocha Web Search API.

---

## File Ownership Map

- Migration and retention: `db/migrations/002_s10_customer_service.sql`, `scripts/migrate-db.mjs`, `scripts/cleanup-expired.mjs`.
- Runtime records: `lib/server/interaction-log.ts`, `lib/server/conversation-history.ts`, `lib/server/turn-codec.ts`.
- Provider lifecycle: `lib/server/ai-provider.ts`, `openai-provider.ts`, `provider.ts`, `timeout.ts`, `concurrency.ts`.
- Search: `lib/server/search-provider.ts`, `bocha-search-provider.ts`, `search-router.ts`, `search-safety.ts`.
- Workflows: `lib/server/workflows/jd-match.ts`, `diagnosis.ts`, plus `chat-core.ts` and `chat-service.ts`.
- Alerts: `lib/server/alert-service.ts`, `feishu-alert-provider.ts`, `scripts/dispatch-alerts.mjs`.
- Admin: `lib/server/admin-auth.ts`, `admin-query.ts`, `admin-export.ts`, `app/api/admin/**`, `app/admin/**`, `components/admin/**`.
- Visitor UI: `components/MorseChat.tsx`, `components/chat/**`, `lib/client/chat-*`.
- Contracts/evidence: focused `tests/**`, `scripts/s10-*.mjs`, `content/chat-eval.json`, `docs/verify/s10/**`, task-center documents.

## Task 0: Freeze S10 Contract And Provider Boundary

**Files:**
- Create: `docs/superpowers/specs/2026-07-15-s10-smart-customer-service-design.md`
- Create: `docs/task-center/s10-smart-customer-service.md`
- Modify: `docs/portfolio-blueprint.md`
- Modify: `docs/task-center/run-state.md`
- Modify: `.env.example`
- Test: `scripts/s10-contract.test.mjs`

- [x] **Step 1: Write the failing S10 contract test**

Assert that the blueprint contains a dated S10 override, the task center points to seven phases, `.env.example` contains no secret, and legacy monthly-budget copy is absent from the active S10 section.

- [x] **Step 2: Run the contract test and verify RED**

Run: `node --test scripts/s10-contract.test.mjs`

Expected: FAIL because the S10 blueprint/run-state/environment contract is incomplete.

- [x] **Step 3: Add the S10 blueprint override and current pointer**

Record the exact approved decisions from the design document. Keep old M3/S8 text explicitly historical rather than rewriting prior evidence.

- [x] **Step 4: Define all environment names without values**

Add Provider protocol/timeouts, search, retention, kill switches, admin hash/TOTP/origin, concurrency and Feishu webhook names. Remove the active requirement for `MORSE_MONTHLY_BUDGET_USD`; keep optional token rates for analytics.

- [x] **Step 5: Run contract test and verify GREEN**

Run: `node --test scripts/s10-contract.test.mjs`

Expected: PASS with no key-like literal or local absolute asset path in live configuration.

- [x] **Step 6: Record real Provider capability evidence**

Record only protocol, model, HTTP/result status and usage presence. Total S10 paid attempts are capped at three; two capability probes are already consumed and blocked. Do not make another real call before the complete Mock path passes.

- [x] **Step 7: Commit the contract slice**

Stage only S10 docs, `.env.example`, and the contract test. Do not stage `.env.local` or root `AGENTS.md`.

## Task 1: Add Checksum-Aware Migration And 10-Day Records

**Files:**
- Create: `db/migrations/002_s10_customer_service.sql`
- Modify: `scripts/migrate-db.mjs`
- Modify: `scripts/cleanup-expired.mjs`
- Modify: `tests/schema.test.ts`
- Modify: `tests/operations-scripts.test.ts`
- Create: `tests/migration-integration.test.ts`
- Create: `tests/retention-integration.test.ts`

- [x] **Step 1: Write migration RED tests**

Cover `001 -> 002`, ordered application, repeat execution, checksum drift rejection, preservation of an existing invite/document, and a transaction rollback when `002` fails.

- [x] **Step 2: Run migration tests and verify RED**

Run: `node --test tests/migration-integration.test.ts tests/schema.test.ts`

Expected: FAIL because the runner hardcodes `001` and S10 tables do not exist.

- [x] **Step 3: Implement additive schema**

Create `interaction_turns`, `interaction_searches`, `diagnoses`, `alert_outbox`, `service_incidents`, `admin_sessions`, `admin_security_state`, `access_attempts`, and required indexes. Add `workflow`, `audience_intent`, and `search_count` without destructive conversion. Use nullable usage/cost columns and plain runtime identifiers in 10-day tables so Session deletion cannot cascade. `schema_migrations` is runner infrastructure and is not created by `002`.

- [x] **Step 4: Implement the migration runner**

Bootstrap `schema_migrations` before reading its rows. Read `db/migrations/*.sql`, sort by numeric prefix, hash bytes with SHA-256, apply one file per transaction, record checksum in the same transaction, and reject mismatches before executing later files. On an existing 001-only database, verify the vector extension plus 001 table/column/constraint sentinels and baseline-register the current 001 checksum; reject partial or incompatible schemas. Tests cover empty DB, 001-only DB, repeated execution, checksum drift and 002 rollback.

- [x] **Step 5: Verify migration GREEN**

Run: `node --test tests/migration-integration.test.ts tests/schema.test.ts`

Expected: PASS on a disposable PostgreSQL database.

- [x] **Step 6: Write retention RED tests**

At fixed times, prove 12-hour Session cleanup removes runtime messages while a 9-day interaction remains, then prove 10-day cleanup removes raw turn/search/diagnosis content and expired admin/outbox rows while retaining knowledge and invite definitions.

- [x] **Step 7: Implement idempotent cleanup**

Delete each data class by its own expiry column in one transaction and print counts only. Never print content.

- [x] **Step 8: Verify retention GREEN and commit**

Run: `node --test tests/retention-integration.test.ts tests/operations-scripts.test.ts`

Expected: PASS on first and repeated cleanup.

## Task 2: Provider Abort, Timeout, SSE And History Recovery

**Files:**
- Create: `lib/server/timeout.ts`
- Create: `lib/server/concurrency.ts`
- Create: `lib/server/turn-codec.ts`
- Create: `lib/server/conversation-history.ts`
- Modify: `lib/server/ai-provider.ts`
- Modify: `lib/server/openai-provider.ts`
- Modify: `lib/server/provider.ts`
- Modify: `lib/server/config.ts`
- Modify: `lib/server/chat-service.ts`
- Modify: `lib/server/sse.ts`
- Modify: `lib/client/chat-sse.ts`
- Modify: `app/api/chat/route.ts`
- Create: `app/api/chat/history/route.ts`
- Modify: `tests/openai-provider.test.ts`
- Modify: `tests/chat-sse.test.ts`
- Modify: `tests/chat-service-integration.test.ts`
- Create: `tests/conversation-history-integration.test.ts`

- [x] **Step 1: Write Provider protocol RED tests**

Assert explicit `responses` and `chat_completions` request shapes, `store:false`, no automatic fallback, nullable usage, AbortSignal forwarding, first-byte timeout and total timeout.

- [x] **Step 2: Verify Provider RED**

Run: `node --test tests/openai-provider.test.ts`

Expected: FAIL on protocol selection, signal and nullable usage.

- [x] **Step 3: Implement Provider boundary and bounded concurrency**

Use an explicit protocol config. Pass one signal to embedding and generation. Add small in-process semaphores with abortable queue waits. Convert raw errors to stable internal categories without logging payloads.

- [x] **Step 4: Verify Provider GREEN**

Run: `node --test tests/openai-provider.test.ts tests/config.test.ts`

Expected: PASS for both local fake clients and timeout/abort cases.

- [x] **Step 5: Write runtime lifecycle RED tests**

Cover stop before first token, stop after partial token, request disconnect, heartbeat framing, failed persistence, idempotent replay, quota restoration and one active turn per conversation.

- [x] **Step 6: Implement runtime lifecycle**

Propagate `request.signal` through one AbortController; send 15-second SSE comments; expose service-driven status events; record stopped/failed interaction rows while compensating runtime history and message quota.

- [x] **Step 7: Write and implement history recovery**

The authenticated history route returns only conversations belonging to the current valid access Session, including decoded text, workflow, sources and remaining quota. Expired access returns 401; 10-day logs are never queried by this route.

- [x] **Step 8: Verify runtime/history GREEN and commit**

Run: `node --test tests/chat-sse.test.ts tests/chat-service-integration.test.ts tests/conversation-history-integration.test.ts tests/api-contract.test.ts`

Expected: all focused tests PASS with PostgreSQL enabled.

## Task 3: Local RAG, Automatic Bocha Search And Safe Citations

**Files:**
- Create: `lib/server/search-provider.ts`
- Create: `lib/server/search-safety.ts`
- Create: `lib/server/search-router.ts`
- Create: `lib/server/bocha-search-provider.ts`
- Modify: `lib/server/chat-core.ts`
- Modify: `lib/server/chat-service.ts`
- Modify: `lib/server/config.ts`
- Create: `scripts/mock-bocha.mjs`
- Create: `tests/search-safety.test.ts`
- Create: `tests/search-router.test.ts`
- Create: `tests/bocha-search-provider.test.ts`
- Modify: `tests/chat-core.test.ts`
- Modify: `tests/chat-service-integration.test.ts`

- [x] **Step 1: Write SearchRouter and URL RED tests**

Cases include recency/current-version questions, sufficient local evidence, Morse personal facts, five-search Session quota, disabled search, malicious schemes, URL credentials, localhost/private/metadata addresses, fake official labels and prompt injection in snippets.

- [x] **Step 2: Verify search RED**

Run: `node --test tests/search-router.test.ts tests/search-safety.test.ts`

Expected: FAIL because no search boundary exists.

- [x] **Step 3: Implement deterministic routing and source classification**

Return `{ shouldSearch, query, reason }` without a model call. Personal Morse facts cannot use web evidence. Normalize HTTPS URL and classify source using configured official domains or GitHub host/organization; do not fetch result pages.

- [x] **Step 4: Implement Bocha adapter and Mock contract**

Send one bounded search request, accept at most five title/summary/URL results, validate every result server-side, apply timeout/signal, and return a stable degraded result on Provider failure.

- [x] **Step 5: Integrate server-owned citations**

Merge local and web evidence with unique server IDs. Prompts wrap snippets as untrusted data; public SSE receives only server-produced IDs/title/href/kind/domain/score. Search rows record query, reason, status and sanitized results.

- [x] **Step 6: Verify search GREEN and local RAG**

Run: `node --test tests/search-router.test.ts tests/search-safety.test.ts tests/bocha-search-provider.test.ts tests/chat-core.test.ts tests/chat-service-integration.test.ts`

Then run: `npm run rag:eval`

Expected: focused tests PASS and existing top-3 retrieval remains passing.

- [x] **Step 7: Commit the search slice**

Keep real Bocha evidence `BLOCKED_EXTERNAL` while no API key exists.

## Task 4: JD Matching, Structured Diagnosis And Transactional Outbox

**Files:**
- Create: `lib/server/workflows/jd-match.ts`
- Create: `lib/server/workflows/diagnosis.ts`
- Create: `lib/server/alert-service.ts`
- Modify: `lib/server/chat-core.ts`
- Modify: `lib/server/chat-service.ts`
- Modify: `lib/server/access.ts`
- Modify: `app/api/access/route.ts`
- Create: `tests/jd-match.test.ts`
- Create: `tests/diagnosis.test.ts`
- Create: `tests/alert-outbox-integration.test.ts`
- Modify: `tests/access-integration.test.ts`

- [x] **Step 1: Write workflow input RED tests**

Free chat accepts at most 2,000 characters, JD accepts 12,000, and diagnosis validates controlled fields with per-field/total limits. Reject file payloads, invalid workflow transitions and unknown fields.

- [x] **Step 2: Verify workflow RED**

Run: `node --test tests/chat-core.test.ts tests/jd-match.test.ts tests/diagnosis.test.ts`

Expected: FAIL because only `mode` exists and all messages use 500 characters.

- [x] **Step 3: Implement workflow contracts**

JD output instructions require requirement decomposition, project evidence, honest gaps and follow-up questions with no invented percentage. Diagnosis transitions `collecting -> complete -> handoff_pending`, and only the server decides completion from required fields.

- [x] **Step 4: Write core Outbox RED tests**

Prove the first invite use inserts exactly one row across repeated redemptions; diagnosis completion inserts exactly one row across retry/replay; ordinary chat, JD and routine quota events insert none; answer persistence and Outbox enqueue share one transaction. Invite abuse lockout and admin lockout security events remain in Task 5 Step 6 with their owning rate-limit/auth transactions.

- [x] **Step 5: Implement transactional Outbox**

Use unique dedupe keys and JSON payloads that omit secrets. External delivery is never attempted inside the user request transaction and failure cannot roll back an answer.

- [x] **Step 6: Verify workflows/Outbox GREEN and commit**

Run: `node --test tests/jd-match.test.ts tests/diagnosis.test.ts tests/alert-outbox-integration.test.ts tests/access-integration.test.ts tests/chat-service-integration.test.ts`

Expected: focused PostgreSQL tests PASS, including replay and rollback.

## Task 5: Private Admin, Export And Feishu Dispatcher

**Files:**
- Create: `lib/server/admin-auth.ts`
- Create: `lib/server/admin-query.ts`
- Create: `lib/server/admin-export.ts`
- Create: `lib/server/feishu-alert-provider.ts`
- Create: `app/api/admin/session/route.ts`
- Create: `app/api/admin/turns/route.ts`
- Create: `app/api/admin/turns/[turnId]/route.ts`
- Create: `app/api/admin/export/route.ts`
- Create: `scripts/dispatch-alerts.mjs`
- Create: `tests/admin-auth.test.ts`
- Create: `tests/admin-api-contract.test.ts`
- Create: `tests/admin-export.test.ts`
- Create: `tests/feishu-alert.test.ts`
- Create: `tests/service-incidents-integration.test.ts`

- [x] **Step 1: Write RFC 6238 and auth RED tests**

Use published SHA-1 TOTP vectors. Cover password mismatch, valid ±1 window, replayed counter, lockout, expired/sliding session, visitor cookie denial and Strict admin cookie attributes.

- [x] **Step 2: Verify auth RED**

Run: `node --test tests/admin-auth.test.ts tests/admin-api-contract.test.ts`

Expected: FAIL because admin auth does not exist.

- [x] **Step 3: Implement isolated admin auth**

Use `crypto.scrypt`, constant-time comparison, base32 decoding and HMAC-SHA1 TOTP. Persist only hashed session tokens, last accepted counter, failure count and lock time. Validate configured Origin for writes and export.

- [x] **Step 4: Write query/export RED tests**

Cover filters, pagination, detail, badcase update, 10-day boundary, fresh-TOTP export, JSON shape, CSV quoting/newlines/UTF-8 BOM and formula prefixes `= + - @`.

- [x] **Step 5: Implement admin APIs and streaming export**

Return only admin-authorized records. Escape formula-like CSV cells with a leading apostrophe, quote RFC 4180 fields, and stream the response without temporary files.

- [x] **Step 6: Write and implement incident state plus Feishu dispatcher**

Mock success, HTTP 200 business error, malformed response, non-2xx, timeout, bounded retries, dedupe and recovered-service notification. Five-minute windows require three consecutive Provider/Search failures to open one incident; one later success recovers that incident. A second outage with the same fingerprint creates a new incident id. Invite lockout and admin lockout write security Outbox rows in their respective transactions. Dispatcher claims pending rows safely, updates attempt metadata, and never logs webhook or raw private payload. Stable event keys prevent duplicate Outbox rows; the non-idempotent custom webhook remains an honest at-least-once delivery boundary.

- [x] **Step 7: Verify admin/alerts GREEN and commit**

Run: `node --test tests/admin-auth.test.ts tests/admin-api-contract.test.ts tests/admin-export.test.ts tests/feishu-alert.test.ts tests/service-incidents-integration.test.ts`

Expected: PASS. Real Feishu remains `BLOCKED_EXTERNAL` without webhook.

## Task 6: Visitor UI, Admin UI, Evaluation And CRITICAL Closeout

**Files:**
- Modify: `components/MorseChat.tsx`
- Modify: `components/MorseChat.module.css`
- Create: `components/chat/useMorseChat.ts`
- Create: `components/chat/ChatWorkspace.tsx`
- Create: `components/chat/ChatTranscript.tsx`
- Create: `components/chat/ChatPhaseStatus.tsx`
- Create: `components/chat/ChatComposer.tsx`
- Create: `components/chat/ChatSources.tsx`
- Create: `components/chat/JdIntake.tsx`
- Create: `components/chat/DiagnosisIntake.tsx`
- Create: `components/admin/AdminConsole.tsx`
- Create: `components/admin/AdminConsole.module.css`
- Modify: `app/layout.tsx`
- Move: `app/page.tsx` and `app/page.module.css` to `app/(portfolio)/`
- Move: `app/works/**` to `app/(portfolio)/works/**`
- Create: `app/(portfolio)/layout.tsx`
- Create: `app/admin/layout.tsx`
- Create: `app/admin/page.tsx`
- Modify: `content/chat-eval.json`
- Modify: `scripts/chat-eval.mjs`
- Create: `scripts/s10-chat-smoke.mjs`
- Modify: `tests/chat-ui-contract.test.ts`
- Create: `tests/s10-admin-ui-contract.test.ts`
- Create: `docs/verify/s10/s10-closeout.md`

- [ ] **Step 1: Write visitor UI RED tests**

Require three workflow controls, real AbortController stop, status region, history restore, grouped sources, 12,000-character JD handling, diagnosis handoff state, retry without duplicate user text, and removal of monthly budget UI.

- [ ] **Step 2: Verify visitor UI RED**

Run: `node --test tests/chat-ui-contract.test.ts`

Expected: FAIL on missing workflows, stop and recovery.

- [ ] **Step 3: Implement visitor interaction without visual redesign**

Keep the S9 panel shell. Extract state/SSE/history to `useMorseChat`; make the send control switch in place to stop; use service status events; group local and web sources; preserve focus and partial stopped output. All controls are at least 44px and all CSS uses existing tokens.

- [ ] **Step 4: Split the route shells without changing public URLs**

Keep global metadata/styles in the root layout. Move the existing page and works routes under the `(portfolio)` route group with the current Canvas/Header/Footer/Resume shell, and give `/admin` a separate layout with none of those public controls. Update route contract tests so `/`, `/works`, existing Hash redirects and static generation remain unchanged.

- [ ] **Step 5: Write and implement admin UI**

Require login, filters, paginated list, detail, badcase notes and an export dialog that asks for a fresh TOTP. Desktop uses list/detail; 390px uses list then full-screen detail. Do not add admin to public navigation.

- [ ] **Step 6: Verify UI contract GREEN**

Run: `node --test tests/chat-ui-contract.test.ts tests/s10-admin-ui-contract.test.ts tests/site-shell-contract.test.ts`

Expected: PASS with no raw colors or external runtime assets.

- [ ] **Step 7: Expand deterministic evaluation**

Add at least 36 cases covering recruiter/collaboration/peer, three workflows, cross-project evidence, refusal, injection, malicious URL, recency routing, search degradation, oversized JD, auth/errors and duplicate diagnosis notification.

- [ ] **Step 8: Run local PostgreSQL/BGE and Mock E2E**

Run migrations and ingest audited `content/site-content.json`; run `npm run rag:eval` and `npm run chat:eval`; then run `scripts/s10-chat-smoke.mjs` against loopback Mock GPT/Bocha/Feishu at 1440x900 and 390x844.

Expected browser assertions: unlock, all workflows, status, stop, refresh recovery, citation navigation, search degradation, Session expiry, admin login/list/detail/badcase/export, no overflow, no unexpected console/page errors.

- [ ] **Step 9: Run the one remaining real GPT smoke only after Mock PASS**

Use one short integrated request through the application. Record only model/protocol/status, latency, usage presence, citation validity and final PASS/BLOCKED label. Do not call real Bocha or Feishu without credentials.

- [ ] **Step 10: Run final verification**

Run: `npm test`

Run: `npm run rag:eval`

Run: `npm run chat:eval`

Run: `npm run build`

Run: `git diff --check`

Run a secret scan for key/token patterns and verify `.env.local` is ignored. PostgreSQL integration must have zero skip.

- [ ] **Step 11: Perform CRITICAL split review**

Compliance reviewer checks DoD, approvals, migrations, 12h/10d lifecycle, evidence labels and scope. Quality/safety reviewer checks auth, CSRF, TOTP replay, URL/citation safety, abort/compensation, Outbox, export and test quality. Close all admitted blockers within three correction cycles.

- [ ] **Step 12: Reconcile knowledge and commit local result**

Update `docs/portfolio-blueprint.md`, `docs/task-center/run-state.md`, this task center, evidence and next pointer. Stage only intended S10 files, commit locally, and leave push/deploy forbidden.
