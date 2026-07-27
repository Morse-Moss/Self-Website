# Digital Morse Conversation V2.1 Implementation Plan

> **For agentic workers:** Morse Development Mode owns this run. Execute the tasks inline with failure-first tests; do not start a second lifecycle or delegate without fresh user authorization.

**Goal:** Make every valid first turn answerable, preserve multi-turn task context only through completed turns, degrade evidence retrieval without losing the answer, and cap each turn at one primary plus at most one recovery generation.

**Architecture:** A persisted Task Frame is the sole task-context authority. Deterministic routing produces an in-memory candidate transition; task-scoped completed history, structured evidence, optional RAG, provider generation, and a single success transaction remain separate boundaries. No Task Frame mutation becomes visible until the answer, usage, attempts, assistant message, completed turn, and quota settlement commit together.

**Tech Stack:** Next.js App Router, TypeScript, Node test runner, PostgreSQL/pgvector, SSE, OpenAI-compatible provider adapters.

---

## StagePacket

```yaml
stage: digital-morse-conversation-v2-1-local-implementation
outcome: V2.1 behavior is proven locally without a real Provider call or production mutation
controls:
  execution: STAGED
  risk: CRITICAL
  delivery: LOCAL
state: LOCAL_READY
preset: null
scope:
  owned:
    - db/migrations/008_conversation_task_state.sql
    - lib/server/conversation-task-state.ts
    - lib/server/chat-route-policy.ts
    - lib/server/chat-service.ts
    - lib/server/interaction-log.ts
    - lib/server/chat-execution-budget.ts
    - lib/server/chat-answer-runner.ts
    - lib/server/failover-ai-provider.ts
    - lib/server/config.ts
    - scripts/chat-eval.mjs
    - content/chat-eval.json
    - directly corresponding tests
  forbidden:
    - production database or deployment state
    - real or paid Provider calls
    - ingest
    - private resume data or authorization state
    - E:/Wiki and other external asset roots
  unrelated_or_unknown:
    - .github/
    - db/migrations/009_db_growth_indexes.sql
dod:
  - complete first-turn questions enter the answer path instead of default clarify/failure
  - Task Frame has the final 008 schema and changes only in the completed success transaction
  - provider history contains only permitted completed turns and never failed/stopped/running turns
  - no LLM route judge exists and deterministic routing preserves task continuity
  - structured evidence can answer when Embedding or pgvector is unavailable
  - total generation attempts never exceed two and failover versus strict recovery is mutually exclusive
  - the active model's reasoning and maxOutputTokens reach the provider request without route override
  - completed turn replay does not regenerate, recharge, or advance Task Frame version
  - SSE done is emitted only after durable success; provisional output is released by semantic units
  - focused tests, database integration tests where available, typecheck, eval, full test, and build pass
approvals:
  - local file edits and local non-provider tests authorized by user
  - no commit, push, deploy, ingest, production DB, or real Provider authorization in this stage
verification:
  focused:
    - node --import tsx --test <affected test files>
  stage_exit:
    - npx tsc --noEmit
    - node scripts/chat-eval.mjs
    - npm test
    - npm run build
  real_observation:
    - not applicable to LOCAL; real Provider and production observation remain a later gate
review:
  shape: split compliance/spec and quality/safety
  correction_budget: 3
knowledge_impact:
  - implementation status and verification evidence may require docs reconciliation at closeout
non_goals:
  - long-term cross-session memory
  - LLM route classification or runtime LLM-as-judge
  - parallel hedging
  - new search/provider vendors
  - frontend visual redesign
```

## File Responsibilities

- `db/migrations/008_conversation_task_state.sql`: final, one-time Task Frame schema and `interaction_turns.task_id` index; no dependency on `009`.
- `lib/server/conversation-task-state.ts`: Task Frame types, deterministic candidate transitions, optimistic persistence, and replay checks.
- `lib/server/chat-route-policy.ts`: deterministic intent/object/task-relation routing and the only legal `clarify` decision.
- `lib/server/chat-service.ts`: orchestration only: terminal-state gate, context/evidence assembly, generation, success commit, and post-commit SSE.
- `lib/server/interaction-log.ts`: completed-only task history and atomic success persistence primitives.
- `lib/server/chat-execution-budget.ts`: one primary plus one optional recovery reservation under one deadline.
- `lib/server/chat-answer-runner.ts`: mutually exclusive failover/strict recovery and semantic-unit output buffering.
- `lib/server/failover-ai-provider.ts`: serial provider attempts, health skip, no switch after user-visible output.
- `lib/server/config.ts`: environment fallback of `1200`; database model versions remain immutable and authoritative when active.
- `scripts/chat-eval.mjs` and `content/chat-eval.json`: multi-turn route, Task Frame, replay, failure-pollution, and retrieval-degradation evaluation.

## Task 1: Final 008 And Full Task Frame

**Files:**
- Modify: `tests/conversation-task-state.test.ts`
- Modify: `tests/migration-integration.test.ts`
- Replace: `db/migrations/008_conversation_task_state.sql`
- Replace: `lib/server/conversation-task-state.ts`

- [ ] **Step 1: Write migration RED tests**

Assert that `conversation_task_state` exposes `task_id`, `task_kind`, `topic_kind`, `topic_ref`, `status`, `waiting_for`, `task_started_turn_id`, `last_successful_turn_id`, `version`, `updated_by_turn_id`, `created_at`, and `updated_at`; assert `interaction_turns.task_id` and `(conversation_id, task_id, status, created_at)` exist. Remove every new `009` expectation from this stage's migration tests.

- [ ] **Step 2: Write transition RED tests**

Use the desired public shape:

```ts
interface ConversationTaskFrame {
  conversationId: string;
  taskId: string;
  taskKind: 'project_discussion' | 'capability_verification' | 'jd_match' | 'external_research';
  topicKind: 'project' | 'capability' | 'jd' | 'external';
  topicRef: string;
  status: 'active' | 'waiting_input' | 'completed';
  waitingFor: string[];
  taskStartedTurnId: string | null;
  lastSuccessfulTurnId: string | null;
  version: number;
  updatedByTurnId: string | null;
}
```

Cover create-after-success, same-task continuation, temporary conversation no-op, new-task switch, `job_description` waiting slot, completion, failed/stopped no-op, and completed replay no version bump.

- [ ] **Step 3: Verify RED**

Run:

```powershell
node --import tsx --test tests/conversation-task-state.test.ts
node --import tsx --test tests/migration-integration.test.ts
```

Expected: Task Frame field/constraint assertions fail because the current draft is only topic/status; database tests may explicitly skip only when no disposable PostgreSQL is configured.

- [ ] **Step 4: Implement final schema and data access**

Create `task_id uuid NOT NULL`, checked task/topic kinds, `waiting_for text[] NOT NULL DEFAULT '{}'`, all three turn references with `ON DELETE SET NULL`, timestamps, and consistency checks (`waiting_input` has at least one allowed slot; other statuses have none). Add nullable `interaction_turns.task_id` without a current-frame foreign key. Persist with optimistic `version` matching and assign `updated_by_turn_id` only inside successful completion.

- [ ] **Step 5: Verify GREEN**

Run the two focused commands from Step 3 and require PASS or an explicitly reported DB-only skip.

## Task 2: Completed-Only Context And Deterministic Routing

**Files:**
- Modify: `tests/chat-route-policy.test.ts`
- Modify: `tests/chat-service-integration.test.ts`
- Modify: `lib/server/chat-route-policy.ts`
- Modify: `lib/server/chat-service.ts`
- Modify: `lib/server/interaction-log.ts`

- [ ] **Step 1: Write context RED tests**

Prove that task answers load only messages joined through `interaction_turns.status = 'completed'` and the same `task_id`; prove failed/stopped/running turns are absent. Prove lightweight conversation can read only a small adjacent completed conversation pair and cannot supply facts or replace Task Frame context.

- [ ] **Step 2: Write routing RED tests**

Cover explicit new object, page object, valid direct task continuation, short/anaphoric continuation through current Task Frame, unrelated complete question as a new/self-contained answer, and `clarify` only when an anaphoric object remains unresolved. Add a source/behavior assertion that the default route performs zero Provider classification calls.

- [ ] **Step 3: Verify RED**

```powershell
node --import tsx --test tests/chat-route-policy.test.ts tests/chat-service-integration.test.ts
```

Expected: raw recent-message history and the current LLM fallback judge violate the new contract.

- [ ] **Step 4: Implement deterministic context boundary**

Delete `fallbackRouteFromTaskState`, `parseStrictJsonObject`, `llmFallbackIntentPrompt`, `parseFallbackIntentJudgeOutput`, and `judgeDefaultRouteAgainstTaskState`. Move history selection to an explicit completed-only query accepting `{ conversationId, taskId, mode, tokenBudget }`; preserve Task Frame while allowing conversation detours.

- [ ] **Step 5: Verify GREEN**

Run the focused command from Step 3 and require no Provider call in routing tests.

## Task 3: Structured Evidence First And RAG Degradation

**Files:**
- Modify: `tests/chat-service-integration.test.ts`
- Modify: relevant retrieval contract tests under `tests/`
- Modify: `lib/server/chat-service.ts`
- Modify: the smallest existing evidence/retrieval helper required by the current call chain

- [ ] **Step 1: Write retrieval RED tests**

Inject Embedding connection failure, timeout, and pgvector query failure for explicit project, capability, and JD questions. Assert the answer path continues when structured public evidence exists, records `evidence_degraded`, and never reads private resume content. Assert external-current Search failure remains a separate failure/degradation contract and is never replaced with model-memory claims.

- [ ] **Step 2: Verify RED**

```powershell
node --import tsx --test tests/chat-service-integration.test.ts tests/rag*.test.ts
```

Expected: existing `RETRIEVAL_UNAVAILABLE` propagation fails the structured-evidence cases.

- [ ] **Step 3: Implement optional retrieval**

Assemble structured evidence before optional vector retrieval. Convert Embedding/pgvector infrastructure errors into typed evidence degradation when structured evidence is sufficient; retain hard failure only where the requested fact cannot be supported. Record which evidence layers ran and the degradation reason without storing private text.

- [ ] **Step 4: Verify GREEN**

Run the focused command from Step 2 plus the existing fixed RAG gold set.

## Task 4: Two-Attempt Cost Gate And Active Model Parameters

**Files:**
- Modify: `tests/chat-execution-budget.test.ts`
- Modify: `tests/chat-answer-runner.test.ts`
- Modify: provider/failover focused tests
- Modify: `lib/server/chat-execution-budget.ts`
- Modify: `lib/server/chat-answer-runner.ts`
- Modify: `lib/server/failover-ai-provider.ts`
- Modify: `lib/server/config.ts`

- [ ] **Step 1: Write budget RED tests**

Assert exactly one primary reservation plus at most one recovery reservation; the recovery kind is either `failover` or `strict`, never both. Assert no concurrent attempts, no provider switch after first user-visible semantic unit, unhealthy nodes are skipped without consuming a call, and insufficient remaining time/cost budget prevents recovery.

- [ ] **Step 2: Write parameter RED tests**

Assert environment fallback `maxOutputTokens` is `1200`, the active immutable database model version wins when present, and route/orchestration never overwrites active `reasoningEffort` with `low` or `minimal`.

- [ ] **Step 3: Verify RED**

```powershell
node --import tsx --test tests/chat-execution-budget.test.ts tests/chat-answer-runner.test.ts tests/failover-provider.test.ts tests/provider-runtime.test.ts
```

Expected: the current three-attempt contract and route-level reasoning overrides fail.

- [ ] **Step 4: Implement the recovery decision**

Replace the numeric three-attempt assumption with a two-slot execution budget and an explicit one-time recovery choice. Failover is eligible only for a pre-visible transport/provider failure; strict compression is eligible only for a guard/truncation outcome where no failover already ran. Preserve serial execution and per-attempt usage/cost truth.

- [ ] **Step 5: Verify GREEN**

Run the focused command from Step 3 and inspect assertions for attempt count, launch kind, generation mode, and final request parameters.

## Task 5: Semantic SSE, Atomic Success, And Idempotent Replay

**Files:**
- Modify: `tests/chat-service-integration.test.ts`
- Modify: `tests/chat-answer-runner.test.ts`
- Modify: `lib/server/chat-answer-runner.ts`
- Modify: `lib/server/chat-service.ts`
- Modify: `lib/server/interaction-log.ts`

- [ ] **Step 1: Write semantic-unit RED tests**

Feed split tokens for Chinese/English sentences, Markdown list items, paragraphs, and fenced code. Assert only complete guarded units become deltas; an invalid later unit cannot expose rejected text. Assert failover is prohibited after any visible unit.

- [ ] **Step 2: Write atomicity and replay RED tests**

Inject failure at answer, usage, attempt snapshot, assistant message, quota settlement, turn completion, `interaction_turns.task_id`, and Task Frame write. Assert every failure rolls back the whole success state. Simulate uncertain COMMIT and require a full persisted-result reconciliation. Replay a completed `turnId` and assert zero Provider calls, zero quota charge, and unchanged Task Frame version.

- [ ] **Step 3: Verify RED**

```powershell
node --import tsx --test tests/chat-answer-runner.test.ts tests/chat-service-integration.test.ts
```

Expected: semantic buffering and any missing write-point reconciliation assertions fail for the intended reason.

- [ ] **Step 4: Implement success boundary**

Buffer Provider output into complete semantic units before guard/release. Keep the candidate Task Frame in memory until one transaction writes answer, usage, attempts, assistant message, quota, completed turn/task ID, and Task Frame. Emit SSE `done` only after COMMIT or exact post-COMMIT reconciliation proves all persisted fields.

- [ ] **Step 5: Verify GREEN**

Run the focused command from Step 3 against a disposable PostgreSQL when available; report DB-dependent skips as an open verification gap rather than a pass.

## Task 6: Multi-Turn Evaluation And CRITICAL Exit

**Files:**
- Modify: `content/chat-eval.json`
- Modify: `scripts/chat-eval.mjs`
- Modify: `tests/rag-eval-contract.test.ts`
- Modify: `tests/s10-chat-eval.test.ts`

- [ ] **Step 1: Add evaluation cases**

Include at least: failed first turn followed by self-contained question, failed/stopped middle turn followed by task continuation, conversation detour and return, explicit task switch, unresolved “这个项目” clarify, resolved “继续/那这个呢”, completed replay, Embedding degradation, no-judge cost assertion, and attempt ceiling of two.

- [ ] **Step 2: Run focused eval RED/GREEN loop**

```powershell
node --import tsx --test tests/rag-eval-contract.test.ts tests/s10-chat-eval.test.ts
node scripts/chat-eval.mjs
```

Require all declared cases to pass; do not call a live Provider.

- [ ] **Step 3: Run affected boundary verification once**

```powershell
npx tsc --noEmit
npm test
npm run build
```

Record exact pass/fail counts, skips, warnings, and the absence of real Provider calls. Do not run `ingest` because public knowledge content did not change.

- [ ] **Step 4: Perform split CRITICAL review**

Compliance/spec review checks privacy, Task Frame authority, completed-only history, no LLM judge, attempt ceiling, immutable active model parameters, transaction/replay semantics, and scope exclusions. Quality/safety review checks query correctness, concurrency, recovery eligibility, SSE buffering, error paths, and meaningful test coverage. Admit only evidence-backed blockers.

- [x] **Step 5: Close local milestone**

Correct admitted blockers within the three-batch budget, refresh the VerificationReceipt, then route through `closeout` and `KNOWLEDGE_RECONCILED`. Do not stage or commit implementation files without fresh user authorization.

## Verification Receipt

- Final focused unit boundaries: 80/80 passed.
- Final Chat service integration on a disposable fully migrated PostgreSQL database: 91/91 passed; the database was destroyed after the run.
- Final unit suite: 777/777 passed.
- Deterministic multi-turn evaluation: 96/96 passed with `externalCalls: 0`.
- `npx tsc --noEmit`, `npm run build`, and `git diff --check`: passed.
- Repository-wide database suite baseline: 1047/1047 passed before the review corrections; the correction delta was revalidated by the final unit, Chat integration, typecheck, eval, and build checks above.
- CRITICAL compliance/spec review: PASS after closing privacy-limited `evidence_degraded` telemetry.
- CRITICAL quality/safety review: PASS after preserving structured evidence on off-topic vector hits and applying history budgets to whole completed turns with token estimation.
- No real Provider call, ingest, fixed development database mutation, production mutation, push, deploy, staging, or implementation commit occurred.

## Recovery Pointer

Current stage and state: LOCAL_READY; implementation, split CRITICAL review, verification, and knowledge reconciliation are complete.
Last completed verified step: final unit 777/777, disposable Chat integration 91/91, eval 96/96, typecheck, build, and diff check all passed on the reviewed correction delta.
Exact next action: obtain fresh authorization before staging or committing the V2.1 implementation; deployment remains a separate migration, active-model-version, real-Provider, and production-observation gate.
