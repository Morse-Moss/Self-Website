# Digital Morse Controlled Context V2.2 Implementation Plan

> **For agentic workers:** REQUIRED FOCUSED METHODS: follow Morse `STAGED / CRITICAL / DEPLOYED`, use failure-first tests for every behavior change, and keep this file's Resume Pointer current. Do not start a second lifecycle.

**Goal:** Replace route-filtered chat history with a bounded, database-authoritative Context Packet so the approved multi-turn recruitment failure chain returns relevant audited project evidence in production.

**Architecture:** Migration `012` adds an isolated V2.2 task frame, slot references, completed-turn index, legacy bridge, pipeline assignment, redacted manifests, and attempt-integrity metadata. Deterministic semantic resolution creates a candidate frame; a whitelist Final Projection, project-level Evidence Planner, and budgeted canonical Context Packet freeze the exact application-level request before any Provider attempt. Success commits the candidate state and completed index atomically, while compensation persists a terminal redacted manifest without committing candidate context.

**Tech Stack:** Next.js App Router, TypeScript, Node test runner, PostgreSQL 16 + pgvector, OpenAI-compatible Providers, SSE.

---

## StagePacket

```yaml
stage: digital-morse-controlled-context-v22
outcome: the approved recruitment failure chain is fixed by a bounded Context Packet and observed through a production invite canary without leaking prior-task or protected context
controls:
  execution: STAGED
  risk: CRITICAL
  delivery: DEPLOYED
state: CLOSEOUT
scope:
  owned:
    - db/migrations/012_controlled_context_packet.sql
    - lib/contracts/chat-context.ts
    - lib/server/conversation-context-state.ts
    - lib/server/chat-semantic-resolver.ts
    - lib/server/chat-context-projection.ts
    - lib/server/chat-context-packet.ts
    - lib/server/chat-evidence-planner.ts
    - existing chat, prompt, offline quality evaluation, attempt, config, readiness, migration, deployment, and test files required by the approved V2.2 contract
    - V2.2 plan, verification, runbook, blueprint, and closeout knowledge
  forbidden:
    - private resume plaintext, administrator data, credentials, raw production Provider payloads, and external read-only project writes
    - rewriting migrations 001 through 011
  unrelated_or_unknown:
    - E:/Revolution/.github/
dod:
  - migration 012 is additive, repeatable, and enforces same-conversation completed message references without depending on ten-day interaction retention
  - semantic intent distinguishes project catalog, project fit, named project, capability, JD, unsupported history, and temporary conversation
  - recruitment Task Frames exist without a topicRef and only successful turns advance or complete them
  - Final Projection excludes prior-task company, role, JD, history, and evidence from switch, new-task, one-shot, and temporary turns
  - project RAG over-fetches and returns at most three unique audited projects while structured evidence remains authoritative
  - canonical packet and the single normal generation-request HMAC are stable, budgeted, redacted, and identical across every primary/fallback attempt in one turn
  - complete release buffers only until protocol completion, then delivers every non-empty Provider body exactly once; quality labels never trigger strict, reset, failover, compensation, or failure
  - success, compensation, replay, rollback assignment, bridge consumption, and manifest persistence satisfy the approved atomicity contract
  - focused unit/PostgreSQL/SSE failure-chain tests, chat:eval externalCalls=0, rag gold top-3 46/46, full tests, typecheck, build, diff, and secret scan pass
  - reviewed commit is absorbed into master, pushed, deployed with migration/readiness/grants/mock checks, and observed through the authorized production invite canary
  - rollout stops at the invite canary unless the specification's time and natural-sample gates authorize later percentages
approvals:
  - action: local implementation, disposable/local PostgreSQL verification, scoped commit, master absorption, push, and aimorse.tech deployment
    policy_id: BOUNDED_PREAUTH
    decision: allowed
    bounds: user requested closeout and deployment for this approved V2.2 scope on 2026-07-27; preserve secrets and recoverable release order
  - action: production migration 009 through 012 and Web-only Context Packet secret configuration
    policy_id: BOUNDED_PREAUTH
    decision: allowed
    bounds: aimorse.tech production only; backup first; controlled write quiescence for 009; no down migration; never echo secret values
  - action: real Provider canary validation
    policy_id: BOUNDED_PREAUTH
    decision: allowed
    bounds: one named test invite, at most five main answers, only after mock/live/readiness gates; stop on any zero-tolerance signal
verification:
  focused:
    - node --env-file-if-exists=.env.local --test tests/context-*.test.ts tests/chat-semantic-resolver.test.ts tests/chat-context-packet.test.ts tests/chat-controlled-context-integration.test.ts
    - node --env-file-if-exists=.env.local --test tests/provider-attempt-log.test.ts tests/failover-provider.test.ts tests/chat-service-integration.test.ts tests/chat-sse.test.ts
  stage_exit:
    - npm run chat:eval
    - npm run rag:eval
    - npm run typecheck
    - npm test
    - npm run build
    - git diff --check
    - scoped sensitive-data scan
  real_observation:
    - production migration registry and readiness
    - release pointer and container health
    - release:smoke against https://aimorse.tech
    - no-real-Provider mock failure-chain replay before canary
    - at most five authorized canary answers and redacted manifest/attempt integrity checks
review:
  shape: split
  correction_budget: 3
knowledge_impact:
  - docs/portfolio-blueprint.md
  - docs/runbooks/tencent-lighthouse.md
  - docs/verify/digital-morse/controlled-context-v22-closeout.md
  - deployment environment contract
non_goals:
  - all-history API payloads, Provider conversation state, previous_response_id, compaction, LLM routing, Agentic RAG, or long-term user memory
  - public UI changes or private resume access
  - automatic rollout beyond the invite canary and specification sample gates
```

## File Map

- `db/migrations/012_controlled_context_packet.sql`: isolated V2.2 persistence, constraints, assignment, manifests, and attempt-integrity columns.
- `lib/contracts/chat-context.ts`: immutable semantic, frame, projection, packet, manifest, and generation-request contracts.
- `lib/server/conversation-context-state.ts`: assignment, bridge, completed history, frame/slot reads, success writes, rollback lock, and terminal manifest persistence.
- `lib/server/chat-semantic-resolver.ts`: versioned deterministic recruitment signals, referent resolution, semantic intent, and candidate Task Frame transitions.
- `lib/server/chat-context-projection.ts`: whitelist policy for discourse, slots, task history, and evidence.
- `lib/server/chat-evidence-planner.ts`: intent-specific structured evidence and unique-project RAG aggregation.
- `lib/server/chat-context-packet.ts`: token estimation, layer eviction, stable serialization, HMAC, prompt partitions, and generation request digest.
- `lib/server/chat-service.ts`: orchestration only; reserve, resolve, retrieve, project, build, call, success, and compensation.
- `lib/server/provider-attempt-log.ts` and `lib/server/interaction-log.ts`: pre-call integrity enforcement and mirror-from-authority terminal projection.
- `lib/server/config.ts`, `lib/server/production-config.ts`, `lib/server/readiness.ts`, `compose.production.yaml`: kill switch, canary, budgets, Web-only digest key, and fail-closed readiness.
- `tests/context-*.test.ts`, `tests/chat-semantic-resolver.test.ts`, `tests/chat-controlled-context-integration.test.ts`: failure-first unit, PostgreSQL, privacy, replay, and SSE coverage.

### Task 1: Add migration 012 and V2.2 persistence primitives

**Files:** create `db/migrations/012_controlled_context_packet.sql`, `lib/contracts/chat-context.ts`, `lib/server/conversation-context-state.ts`; modify migration/schema/integration tests.

- [x] Write RED tests proving the new tables/columns do not exist, message references cannot cross conversations, completed messages cannot be deleted alone, conversation cascade succeeds, and completed history survives interaction cleanup.
- [x] Run the focused migration/context persistence tests and confirm failures are caused by missing `012` and missing APIs.
- [x] Add the additive schema and typed read/write primitives. Use `UNIQUE(conversation_id,id)` plus deferred composite foreign keys, never an FK from completed index to `interaction_turns`.
- [x] Add PostgreSQL tests for bridge capture, frame optimistic versioning, success atomicity, failure rollback, replay, pipeline lock, and 30-day/10-day lifetime separation.
- [x] Run focused tests GREEN and record the command/result below.

Verified 2026-07-27: `node --env-file-if-exists=.env.local --test tests/context-persistence-integration.test.ts` passed `2/2`; `node --env-file-if-exists=.env.local --test tests/context-state-integration.test.ts` passed `5/5` against disposable loopback PostgreSQL.

### Task 2: Resolve semantic intent and recruitment slots

**Files:** create `lib/server/chat-semantic-resolver.ts`; modify `lib/server/chat-message-signals.ts`, compatibility route persistence, and resolver tests.

- [x] Write the `recruitment-signals-v1` positive/negative decision-table tests, including short JD, lists, negation, capability questions, mixed-language roles, project catalog, project fit, and unsupported history.
- [x] Confirm RED against current route behavior.
- [x] Implement immutable `ResolvedChatTurn` with semantic intent plus legacy route mapping; implement slot refs with UTF-16 bounds and SHA-256, candidate frame creation without `topicRef`, correction/append/replace/clear/switch/complete transitions, and stable clarification.
- [x] Persist semantic fields without deriving them back from legacy `routeKind`; run resolver and existing route tests GREEN.

Verified 2026-07-27: resolver plus compatibility route tests passed `50/50`; `npm run typecheck` passed. Terminal semantic persistence consumes the immutable `ResolvedChatTurn` directly through the Task 1 manifest primitive and will be wired by Task 7.

### Task 3: Read bounded discourse/history and apply Final Projection

**Files:** create `lib/server/chat-context-projection.ts`; extend `conversation-context-state.ts`; add projection/history/bridge tests.

- [x] Write RED tests for one adjacent completed pair across route/task, same-scope completed history, bridge max-six capture, invalid pair stop, bridge consume/invalidate rules, and old-context exclusion from temporary/new/switch/complete paths.
- [x] Implement pre-route reads and post-route history reads using only V2.2 completed indexes and valid captured bridge references.
- [x] Implement `final-context-projection-v1` as a whitelist that returns included/excluded layers and stable reason codes without body text.
- [x] Run focused projection, bridge, history, retention, and injection tests GREEN.

Verified 2026-07-27: projection, semantic bridge, and PostgreSQL context-state tests passed `20/20`; `npm run typecheck` passed.

### Task 4: Plan approved evidence and unique-project RAG

**Files:** create `lib/server/chat-evidence-planner.ts`; modify `lib/server/rag.ts`, `lib/server/chat-evidence.ts`, prompt source metadata, and evidence/RAG tests.

- [x] Write RED tests proving catalog bypasses embedding; project fit/JD match filter audited finite `>= 0.45` candidates, select direct-first stable Top-3 unique projects after over-fetch 15, and return empty evidence for a successful below-threshold retrieval; named project locks one slug, capability facts use the ledger, and structured fallback is limited to Embedding/retrieval exceptions.
- [x] Add direct/transferable/unavailable admissions and return only audited project IDs plus required content to Approved Evidence.
- [x] Preserve the existing 46-case retrieval gate and add fixed failure-chain expected/forbidden project slugs.
- [x] Run evidence, RAG integration, and gold eval GREEN with zero external calls.

Stage-exit verification on 2026-07-28 used a disposable PostgreSQL database and local BGE: deterministic ingest produced 41 documents / 48 chunks; `npm run rag:eval` passed all 46 top-3 cases plus positive/negative thresholds with zero external calls.

### Task 5: Build, budget, serialize, and sign the Context Packet

**Files:** create `lib/server/chat-context-packet.ts`; modify config/readiness/production/deployment contracts and packet tests.

- [x] Write RED tests for stable key ordering, exact current-input single copy, 12k/24k budgets, 90% reserve, whole-turn eviction, uncuttable over-budget failure, HMAC domain separation, invalid key readiness, and redacted manifests.
- [x] Implement canonical `context-packet-v1` and one normal `generation-request-v1`, Base64 32-byte key validation, key ID validation, stable UTF-8 serialization, and no strict overlay.
- [x] Add `MORSE_CHAT_CONTEXT_PACKET_ENABLED`, context canary, invite IDs, token budgets, digest key/file and key ID configuration. Mount the digest key only into Web in production.
- [x] Run config, readiness, production contract, packet, and privacy tests GREEN.

Verified 2026-07-27: packet tests passed `7/7`, config/readiness/production tests passed `50/50`, production contract passed `12/12`, and TypeScript passed.

### Task 6: Enforce attempt integrity and protocol-complete buffering

**Files:** modify `lib/server/ai-provider.ts`, `provider-attempt-log.ts`, `interaction-log.ts`, `failover-ai-provider.ts`, `chat-answer-runner.ts`, and their tests; keep `chat-output-guard.ts` offline-only.

- [x] Write RED tests proving each started attempt records builder/key/packet/request digests before the Provider starts; any packet/request/mode/overlay mismatch prevents the network call; all primary/fallback attempts match; historical strict rows remain readable; mirror rows copy authority values.
- [x] Write RED SSE tests proving complete release exposes no body before protocol completion and then emits the exact non-empty body once, while segment release remains streaming without `reset`.
- [x] Add attempt integrity to `AnswerExecutionOptions`, enforce it transactionally in `chat_provider_attempts`, and copy it to `interaction_provider_attempts` without recomputation.
- [x] Make semantic release policy authoritative for display timing only; remove online quality checks, strict regeneration, reset, and quality-triggered Provider failure.
- [x] Run provider, guard, answer-runner, SSE, and attempt PostgreSQL tests GREEN.

Reverified after mainline integration on 2026-07-28: answer runner and packet tests passed `15/15`; Provider attempt PostgreSQL passed `5/5`; the affected unit boundary passed `119/119`; `npm run typecheck` passed. New attempts accept only normal/no-overlay requests, all integrity fields must match within a turn, and complete release changes timing without gating content quality.

### Task 7: Integrate the three-stage V2.2 chat transaction

**Files:** modify `lib/server/chat-service.ts`, `interaction-log.ts`, request wiring, and integration tests.

- [x] Write RED integration tests for reserve-only user message, candidate state not visible before success, atomic success writes, terminal manifest on failed/stopped compensation, replay without Provider/cost, safe/kill-switch assignment locking, and no legacy payload contamination.
- [x] Orchestrate assignment selection, pre-route context, semantic resolution, candidate frame, evidence plan, Final Projection, packet build, frozen generation request, Provider attempt, success coordinator, and failure compensation.
- [x] Keep legacy V1/V2 and diagnosis paths schema-aware but payload-isolated; a successful non-V2.2 override locks a prior V2.2 conversation and closes its frame.
- [x] Run chat service, PostgreSQL, compensation, replay, and existing V1/V2 compatibility tests GREEN.

Reverified after mainline integration on 2026-07-28: the controlled-context/migration/context-state/attempt/runtime PostgreSQL boundary passed with zero failures; the complete legacy Chat service integration passed `90/90`, 0 fail, 0 skip after migrations `001-012` and deterministic ingest of 41 documents / 48 chunks in a disposable loopback PostgreSQL database. The database was removed in `finally`.

### Task 8: Replay the real failure chain and close local CRITICAL gates

**Files:** add a desensitized fixture/eval and Mock SSE replay; update `scripts/chat-eval.mjs` only if needed.

- [x] Write the five-turn RED fixture with expected semantic intent, task ID continuity, project slugs, evidence levels, prompt/packet projection, offline quality evaluation, and final visible answer.
- [x] Make the smallest production corrections required by the fixture, keeping them inside Tasks 2-7 ownership.
- [x] Run focused tests, `chat:eval` with `externalCalls=0`, `rag:eval` top-3 46/46, typecheck, full tests, build, diff check, and scoped secret scan.
- [x] Perform split compliance/spec and quality/safety review against this StagePacket; close admitted blockers within the CRITICAL correction budget.

Verified 2026-07-28: the complete isolated test set passed `1156/1156` with zero failures and zero skips; the affected Context/Provider/Chat/SSE boundary passed `191/191`, and the planner plus V2.2 PostgreSQL boundary passed `31/31`. `chat:eval` passed `96/96` with `externalCalls=0`; RAG passed `46/46` top-3 and both thresholds; typecheck, 33-route production build, changed-file ESLint, diff check and the scoped production-sensitive scan passed. Full ESLint retains 20 pre-existing errors in untouched frontend files. The final CRITICAL compliance/spec and quality/safety delta review returned PASS after the bounded corrections.

### Task 9: Close out, absorb, push, and freeze the release

**Files:** implementation/tests plus impacted knowledge and the Morse rollout log.

- [x] Reconcile blueprint, runbook, environment contract, closeout evidence, and Resume Pointer; obtain a current `KnowledgeReceipt`.
- [ ] Stage only explicit owned files, inspect the full staged diff, create scoped commits, and verify `master` contains them without touching `.github/`.
- [ ] Push the frozen commit, create and hash the release archive, and verify the local/remote SHA-256 before any production pointer change.

### Task 10: Deploy disabled-first and observe the invite canary

**Files:** production release and redacted evidence only; never commit secrets or production data.

- [x] Recheck live release, containers, schema registry, active Chat V2/safe mode, Provider route, RAG, long transactions, backup destination, and rollback-compatible prior release.
- [x] Confirm the deployed `9c13490` baseline already has migration `001-012`, a verified pre-release backup, runtime grants and the Web-only digest Secret while Context Packet remains disabled/0%/empty allowlist; this correction has no migration or public-knowledge corpus change, so it must not repeat quiescence, backup, migration, grants or ingest.
- [ ] Build/start the reviewed correction release with Context Packet still disabled; rebuild only Web/Worker, then verify migration manifest, live/ready, mock failure-chain, containers, logs, and `release:smoke` before real Provider use.
- [ ] Enable only the named test invite and issue at most five main answers. Reproduce the new-conversation failure chain and, when eligible, the legacy bridge; inspect user-visible output plus redacted manifest/attempt invariants.
- [ ] Stop at invite canary observation. Do not start 10% until 24-hour/20-turn natural-sample monitoring can be satisfied under a separately current rollout decision.
- [ ] Update production evidence/runbook, finalize the CloseoutReceipt, validate/commit the Morse rollout-log entry, and reach `KNOWLEDGE_RECONCILED`.

## Resume Pointer

Current stage and state: `CLOSEOUT / Task 9 final KnowledgeReceipt and scoped commit in progress`.

Last completed verified step: local stage exit passed `1156/1156`, the affected boundary passed `191/191`, planner plus V2.2 PostgreSQL passed `31/31`, `chat:eval` passed `96/96` with zero external calls, RAG passed `46/46` top-3, and typecheck/build/scoped lint/diff/sensitive scans plus split CRITICAL review passed; fresh production read-only preflight confirmed release `9c13490`, migration `001-012`, 41/48 RAG, route revision 2, Context Packet disabled/0%/empty allowlist, Web-only Secret scope, five healthy zero-restart containers, live/ready/release smoke, and zero 20-minute error-keyword counts.

Exact next action: finish the current KnowledgeReceipt, explicitly stage owned files, commit and absorb/push the frozen release without touching the main worktree `.github/` directory.
