# Agent-ready Q&A MVP Implementation Plan

> **For agentic workers:** REQUIRED CONTROLLER: continue under Morse `STAGED / CRITICAL / DEPLOYED`. Use `test-driven-development` for each behavior change and `subagent-driven-development` or `executing-plans` only if Morse routes that method. Do not start a second lifecycle. Keep the Resume Pointer at the end of this file current.

**Goal:** Replace patch-driven chat routing with one deterministic TurnPlan, one canonical evidence catalog, one direct answer executor and a non-rejecting quality validator, then prove the HR Q&A MVP through a real ten-question production conversation.

**Architecture:** `chat-service.ts` remains the Session/turn/SSE shell. A frozen `ConversationSessionSnapshot` feeds a deterministic `TurnPlanner`; `EvidenceCatalog` resolves all approved facts independently from RAG relevance; `DirectAnswerExecutor` reuses the current Context Packet, HMAC, dynamic compaction and failover foundation; `AnswerValidator` records quality warnings but blocks only private-data or Secret leakage. The answer is committed transactionally before any answer delta is released.

**Tech Stack:** Next.js App Router, TypeScript, Node test runner, PostgreSQL 16 + pgvector, OpenAI Responses/Chat Completions adapters, SSE, Docker Compose.

---

## StagePacket

```yaml
stage: agent-ready-qa-mvp
outcome: basic public and HR Q&A uses one deterministic plan and complete approved evidence, never suppresses a nonempty answer for style or quality heuristics, commits before release, and completes the named real HR acceptance chain
controls:
  execution: STAGED
  risk: CRITICAL
  delivery: DEPLOYED
state: CONTRACT_FROZEN
scope:
  owned:
    - docs/superpowers/specs/2026-07-29-agent-ready-qa-mvp-design.md
    - docs/superpowers/plans/2026-07-29-agent-ready-qa-mvp.md
    - deterministic Session snapshot, TurnPlan, EvidenceCatalog, DirectAnswerExecutor and AnswerValidator contracts
    - Context Packet and context_manifest projection needed to carry those contracts
    - chat-service extraction and commit-before-release behavior
    - focused, PostgreSQL, evaluation, SSE and real HR acceptance evidence
  forbidden:
    - E:/Revolution/.github/
    - E:/Revolution/revolution-*.tar.gz except an exact task-created release archive during an authorized release
    - E:/Wiki
    - E:/demo2
    - E:/小红书
    - E:/多agent
    - E:/Revolution/tmp/reference-repos product edits
    - credentials, private resume plaintext, raw Provider payloads, private JD/answers in committed evidence
    - editing migrations 001 through 013
  unrelated_or_unknown:
    - other worktrees and concurrent task files not named by the current stage inventory
dod:
  - every context-packet V2.2 Provider turn has one turn-plan-v1 produced without a Provider call
  - the planner cannot reject, truncate current input, remove approved evidence or select an executor other than direct
  - one catalog owns project/capability IDs, aliases, evidence references and unavailable boundaries
  - HR, JD, project-fit and capability questions include all approved projects and all approved resume facts; retrieval scores are advisory only
  - direct execution reuses current dynamic context, compaction, HMAC, attempt and failover contracts
  - provider-complete nonblank answers with coverage/citation/unsupported-capability findings are committed and delivered with warnings, with no strict/reset/retry caused by validation
  - only private-data or Secret findings block before release
  - success transaction commits before the first answer delta and same-turn replay performs no Provider work
  - old style/template/voice/next-step output guard and old capability-policy authority are deleted after consumers migrate
  - no database migration, new search, Skills integration, tool loop, LLM planner or LLM judge is introduced
  - focused tests, chat/rag evals, full tests, typecheck, build, visual checks, diff and sensitive scans pass
  - a fresh HR interview Session completes entry, JD and ten questions with the same task, full evidence, relevant nonempty answers and done
approvals:
  - action: write, review and locally commit the two planning documents
    policy_id: LOCAL_SAFE
    decision: allowed
    bounds: documentation only; no product code, Provider call, push or deployment
  - action: implement, push, deploy and run real Provider acceptance
    policy_id: EXECUTION_RESUME_REQUIRED
    decision: pending
    bounds: start only after the user explicitly resumes implementation at the intended reasoning level; recheck current Git, production and authorization state
verification:
  focused:
    - node --env-file-if-exists=.env.local --test tests/chat-evidence-catalog.test.ts tests/chat-turn-planner.test.ts tests/chat-conversation-session.test.ts
    - node --env-file-if-exists=.env.local --test tests/chat-evidence-planner.test.ts tests/chat-context-packet.test.ts tests/chat-answer-executor.test.ts tests/chat-answer-validator.test.ts
    - node --env-file-if-exists=.env.local --test tests/chat-qa-runtime.test.ts tests/chat-sse.test.ts tests/chat-controlled-context-integration.test.ts
  stage_exit:
    - npm run chat:eval
    - npm run rag:eval
    - npm run typecheck
    - npm test
    - npm run build
    - npm run visual:s10
    - git diff --check
    - scoped privacy and Secret scan
  real_observation:
    - exact release pointer and Web/Worker image identity
    - live/ready/release smoke
    - one fresh HR interview entry plus approved JD plus ten fixed questions
    - per-turn task, plan, evidence, validation, attempt, completed and done metadata
review:
  shape: split
  correction_budget: 3
knowledge_impact:
  - docs/portfolio-blueprint.md
  - docs/runbooks/production.md
  - docs/runbooks/tencent-lighthouse.md
  - docs/task-center/run-state.md
  - a dated local and production verification receipt
non_goals:
  - Skills, new web search, tool registry, ReAct, sub-agent or multi-agent runtime
  - LLM planning, LLM routing or LLM-as-judge
  - Provider management, compaction or RAG model redesign
  - UI redesign or private resume access changes
  - arbitrary cost, token, evidence-count, history-count, output or answer-attempt caps
```

## RuleDigest

```yaml
sources:
  - E:/Revolution/AGENTS.md supplied 2026-07-29
  - E:/Evolution/skills/morse-development-mode/SKILL.md
  - D:/codex/skills/writing-plans/SKILL.md
  - docs/portfolio-blueprint.md
  - docs/superpowers/specs/2026-07-27-digital-morse-conversation-v2-1-design.md
  - docs/superpowers/specs/2026-07-27-digital-morse-controlled-context-design.md
  - docs/superpowers/plans/2026-07-28-dynamic-provider-context-compaction.md
  - docs/superpowers/specs/2026-07-29-agent-ready-qa-mvp-design.md
workspace_at_plan_time: E:/Revolution, master, HEAD 15aaf98290f788cbf60d1ae3799865ea2ada0ecc, origin/master 49eb0f935a44d53a96fe62d39780eecb31f0d53b
absorbed_foundation: b59006c631252d95878bd0863b4dba66fa16c905 is an ancestor of plan-time master
preserve:
  - untracked E:/Revolution/.github/
  - untracked E:/Revolution/revolution-*.tar.gz
refresh_when: implementation starts, project rules change, ownership changes, mainline changes, or production state is rechecked
```

## File Map

### New files

- `content/chat-evidence-catalog.json`: one versioned ID/alias/evidence-reference/boundary authority; contains no private text.
- `lib/contracts/chat-turn-plan.ts`: `ConversationSessionSnapshot`, `TurnPlanV1`, `EvidenceRequirement`, manifest projection and executor/validation contracts.
- `lib/contracts/chat-evidence-catalog.ts`: catalog JSON schema, compiled entries and `EvidenceBundle` types.
- `lib/server/chat-evidence-catalog.ts`: validate/compile catalog and resolve project/capability aliases to approved `site-content` references.
- `lib/server/chat-conversation-session.ts`: load and freeze current input, Frame, adjacent completed turn and same-scope completed history.
- `lib/server/chat-turn-planner.ts`: deterministic semantic/task/evidence plan; no Provider dependency.
- `lib/server/chat-answer-executor.ts`: extract the current provider/dynamic-context/failover path and return a complete `AnswerCandidate`.
- `lib/server/chat-answer-validator.ts`: five-code validation with non-blocking quality warnings and security-only block.
- `lib/server/chat-qa-runtime.ts`: compose Session -> Plan -> Evidence -> Context -> Execute -> Validate and return a commit-ready result.
- `tests/chat-evidence-catalog.test.ts`, `tests/chat-conversation-session.test.ts`, `tests/chat-turn-planner.test.ts`, `tests/chat-answer-executor.test.ts`, `tests/chat-answer-validator.test.ts`, `tests/chat-qa-runtime.test.ts`: focused behavior contracts.
- `tests/fixtures/hr-qa-mvp-chain.ts`: one public, synthetic JD and ten fixed acceptance questions.

### Modified files

- `lib/site-content.ts`: import/export Catalog v2 instead of capability policy v1.
- `lib/contracts/chat-context.ts`: add plan/validation manifest projections without changing database schema.
- `lib/contracts/capability.ts`: retain a temporary compatibility type only until all consumers use catalog v2.
- `lib/server/capability-evidence.ts`: migrate query helpers to the compiled Catalog, then remove duplicate compiler ownership.
- `lib/server/chat-projects.ts`: migrate callers to Catalog project aliases, then delete the hard-coded alias table.
- `lib/server/chat-semantic-resolver.ts`: consume Catalog match results and emit semantic decision only.
- `lib/server/chat-evidence-planner.ts`: accept `TurnPlanV1` and return `EvidenceBundle`; separate approved facts from relevance.
- `lib/server/chat-context-packet.ts`: serialize the plan projection and complete evidence set into the signed request.
- `lib/server/conversation-context-state.ts`: persist plan/validation manifest projections in existing JSONB.
- `lib/server/interaction-log.ts`: validate manifest IDs against Catalog v2.
- `lib/server/chat-service.ts`: retain reserve/replay/lifecycle/SSE, delegate the answer path to `chat-qa-runtime.ts` and release only after commit.
- `lib/server/chat-answer-runner.ts`: stop exposing candidate answer delta before commit; keep attempt/switching/complete events.
- `scripts/chat-eval.mjs`: compile Catalog v2 and add plan/evidence/non-rejection fixtures.
- Existing semantic, evidence, context, SSE, integration, privacy and evaluation tests: migrate assertions to the new authority.

### Deleted after migration gates pass

- `content/chat-capability-policy.json`
- `lib/server/chat-output-guard.ts`
- `tests/chat-output-guard.test.ts`
- The hard-coded `MANUAL_ALIASES` authority in `lib/server/chat-projects.ts`; delete the whole module if `rg` shows no remaining public helper consumer.

## Task 0: Recheck baseline, isolate work and freeze characterization

**Files:** create the worktree; modify existing tests only to characterize current successful behavior; do not change runtime.

- [x] **Step 1: Re-read authority and verify topology**

Run from `E:\Revolution`:

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse origin/master
git merge-base --is-ancestor b59006c631252d95878bd0863b4dba66fa16c905 HEAD
git worktree list --porcelain
```

Expected: the dynamic-context commit is an ancestor; root untracked `.github/` and `revolution-*.tar.gz` remain untouched. If HEAD or ownership has changed, refresh the StagePacket before continuing.

- [x] **Step 2: Create an isolated implementation worktree**

```powershell
git worktree add E:\Revolution\.worktrees\agent-ready-qa-mvp -b codex/agent-ready-qa-mvp master
git -C E:\Revolution\.worktrees\agent-ready-qa-mvp status --short --branch
```

Expected: clean `codex/agent-ready-qa-mvp` worktree at the refreshed mainline.

- [x] **Step 3: Add characterization assertions before extraction** (`checked-no-change`: assertions already existed)

In `tests/chat-controlled-context-integration.test.ts`, extend the existing Vibe/JD/follow-up cases to record these pre-refactor invariants:

```ts
assert.equal(row.status, 'completed');
assert.equal(row.execution_pipeline, 'context_packet_v22');
assert.ok(row.context_manifest.packet_hmac_sha256);
assert.ok(row.context_manifest.evidence_ids.length > 0);
assert.equal(provider.requests.length, expectedAnswerCalls);
```

In `tests/chat-sse.test.ts`, freeze the existing replay rule:

```ts
assert.equal(secondRunProviderCalls, firstRunProviderCalls);
assert.equal(secondRunDone.consumed, false);
assert.equal(secondRunAnswer, firstRunAnswer);
```

- [x] **Step 4: Run characterization checks**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-controlled-context-integration.test.ts tests/chat-sse.test.ts
```

Expected: PASS. A failure is a baseline issue; stop and record it rather than changing expectations.

- [x] **Step 5: Commit the frozen baseline** (`checked-no-change`: no duplicate test edit to commit)

```powershell
git add tests/chat-controlled-context-integration.test.ts tests/chat-sse.test.ts
git commit -m "test: freeze qa pipeline behavior"
```

## Task 1: Build the canonical EvidenceCatalog and remove policy drift

**Files:** create `content/chat-evidence-catalog.json`, `lib/contracts/chat-evidence-catalog.ts`, `lib/server/chat-evidence-catalog.ts`, `tests/chat-evidence-catalog.test.ts`; modify `lib/site-content.ts`, `lib/server/capability-evidence.ts`, `lib/server/chat-projects.ts`, `lib/server/interaction-log.ts`, capability/project tests; delete `content/chat-capability-policy.json` only at the final step.

- [x] **Step 1: Write RED schema and coverage tests**

Create `tests/chat-evidence-catalog.test.ts` with these core assertions:

```ts
test('catalog v2 resolves every project, capability and evidence reference', () => {
  const catalog = compileChatEvidenceCatalog(siteContent, chatEvidenceCatalog);
  assert.equal(catalog.version, 2);
  assert.deepEqual(
    catalog.projects.map((entry) => entry.slug),
    siteContent.projects.map((project) => project.slug),
  );
  assert.deepEqual(
    [...catalog.capabilities.keys()].sort(),
    chatEvidenceCatalog.capabilities.map((entry) => entry.id).sort(),
  );
  assert.equal(catalog.unresolvedReferences.length, 0);
});

test('Vibe Coding maps to audited AI programming evidence', () => {
  const matches = matchCatalogCapabilities('Vibe Coding', catalog);
  assert.deepEqual(matches.map((item) => item.id), ['ai-programming-collaboration']);
  assert.ok(matches[0].direct.some((ref) => ref.resumeFactId === 'ai-application-role'));
});

test('Cursor remains unavailable and is not promoted by project text', () => {
  const [cursor] = matchCatalogCapabilities('Cursor', catalog);
  assert.equal(cursor.evidenceClass, 'unavailable');
  assert.deepEqual(cursor.direct, []);
});

test('normalization conflicts and unknown references fail closed', () => {
  assert.throws(
    () => compileChatEvidenceCatalog(siteContent, conflictingFixture),
    /CHAT_EVIDENCE_CATALOG_INVALID/u,
  );
});
```

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-evidence-catalog.test.ts
```

Expected: FAIL because Catalog v2 and compiler do not exist.

- [x] **Step 2: Define exact Catalog contracts**

Create `lib/contracts/chat-evidence-catalog.ts`:

```ts
import type { ProjectSlug } from './site-content.ts';
import type { KnowledgeSource } from './chat-runtime.ts';

export type EvidenceReference =
  | { kind: 'project'; projectSlug: ProjectSlug; level: 'direct' | 'transferable' }
  | { kind: 'resume_fact'; resumeFactId: string; level: 'direct' | 'transferable' };

export interface ChatEvidenceCatalogV2 {
  version: 2;
  projects: Array<{ slug: ProjectSlug; aliases: string[] }>;
  capabilities: Array<{
    id: string;
    label: string;
    aliases: string[];
    evidenceRefs: EvidenceReference[];
    unavailableBoundary: string | null;
  }>;
}

export interface EvidenceBundle {
  catalogVersion: 2;
  approved: readonly KnowledgeSource[];
  admissions: readonly {
    evidenceId: string | null;
    level: 'direct' | 'transferable' | 'unavailable';
    projectSlug: string | null;
    capabilityId: string | null;
  }[];
  relevance: readonly { evidenceId: string; score: number | null }[];
  unavailableCapabilityIds: readonly string[];
  degradedReason: 'embedding' | 'retrieval' | null;
}
```

- [x] **Step 3: Create Catalog v2 without changing facts**

Create `content/chat-evidence-catalog.json` by migrating every current capability ID, label and alias from `content/chat-capability-policy.json`, every manual project alias from `lib/server/chat-projects.ts`, and every direct/transferable relation currently compiled from approved project data or `profile.resumeFacts`.

The migration must preserve these named facts:

```text
ai-programming-collaboration -> resume_fact:ai-application-role direct
claude-code -> resume_fact:ai-application-role direct
codex -> resume_fact:ai-application-role direct
workbuddy -> resume_fact:ai-application-role direct
java -> resume_fact:internal-tool-role direct
cursor -> no evidenceRefs, unavailableBoundary set
kubernetes -> docker/docker-compose evidence represented as transferable, never direct
```

All other current IDs retain at least the same direct evidence reachability they had under policy v1. Do not add a fact not present in `site-content.json`.

- [x] **Step 4: Implement fail-closed compilation and matching**

Create `lib/server/chat-evidence-catalog.ts` with these exported functions:

```ts
export function compileChatEvidenceCatalog(
  content: SiteContent,
  input: ChatEvidenceCatalogV2,
): CompiledChatEvidenceCatalog;

export function matchCatalogProjects(
  value: string,
  catalog: CompiledChatEvidenceCatalog,
): ProjectSlug[];

export function matchCatalogCapabilities(
  value: string,
  catalog: CompiledChatEvidenceCatalog,
): CompiledCapabilityEntry[];

export function allApprovedPortfolioEvidence(
  catalog: CompiledChatEvidenceCatalog,
): KnowledgeSource[];
```

Use the existing NFKC/case/punctuation normalization, stable catalog order and exact source IDs. Reject duplicate normalized aliases owned by different entries and unknown references.

- [x] **Step 5: Migrate consumers and prove no semantic loss**

Modify `lib/site-content.ts`, `lib/server/capability-evidence.ts`, `lib/server/chat-projects.ts`, `lib/server/interaction-log.ts`, `scripts/chat-eval.mjs` and their tests to consume the compiled Catalog. Temporary wrappers may retain existing function names, but they must delegate to one compiled catalog and may not compile policy v1 separately.

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-evidence-catalog.test.ts tests/capability-evidence.test.ts tests/chat-route-policy.test.ts tests/chat-semantic-resolver.test.ts tests/chat-evidence-planner.test.ts
npm run chat:eval
```

Expected: PASS; `chat:eval` reports `externalCalls=0`.

- [x] **Step 6: Delete the old authority**

```powershell
rg -n "chatCapabilityPolicy|chat-capability-policy|CapabilityPolicy" lib scripts tests content
```

Expected before deletion: no runtime or test consumer. Remove `content/chat-capability-policy.json`; remove policy-v1-only types and compiler branches. If `chat-projects.ts` only re-exports Catalog helpers, migrate its final callers and delete it.

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-evidence-catalog.test.ts tests/capability-evidence.test.ts tests/chat-route-policy.test.ts tests/chat-semantic-resolver.test.ts tests/chat-evidence-planner.test.ts
rg -n "chatCapabilityPolicy|chat-capability-policy|MANUAL_ALIASES" lib scripts tests content
```

Expected: tests PASS and `rg` returns no match.

- [x] **Step 7: Commit Catalog convergence**

```powershell
git add content lib/contracts lib/server tests scripts/chat-eval.mjs
git diff --cached --check
git commit -m "refactor: centralize chat evidence catalog"
```

## Task 2: Freeze ConversationSessionSnapshot

**Files:** create `lib/contracts/chat-turn-plan.ts`, `lib/server/chat-conversation-session.ts`, `tests/chat-conversation-session.test.ts`; modify `lib/server/conversation-context-state.ts` only to expose existing reads cleanly.

- [x] **Step 1: Write RED completed-only Snapshot tests**

Create `tests/chat-conversation-session.test.ts` with a disposable PostgreSQL fixture containing completed, failed, stopped and running turns:

```ts
const snapshot = await loadConversationSessionSnapshot(client, {
  conversationId,
  interactionTurnId: currentTurnId,
  currentUserMessageId,
  request,
});

assert.equal(snapshot.currentInput, exactCurrentInput);
assert.equal(snapshot.adjacentCompletedTurn?.turnId, latestCompletedTurnId);
assert.deepEqual(snapshot.completedHistory.map((turn) => turn.turnId), completedScopeTurnIds);
assert.equal(
  snapshot.completedHistory.some((turn) => [failedId, stoppedId, runningId].includes(turn.turnId)),
  false,
);
assert.ok(Object.isFrozen(snapshot));
```

Add a second case where current user text contains leading/trailing meaningful whitespace and a long JD; assert exact stored text is returned without an application cap.

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-conversation-session.test.ts
```

Expected: FAIL because the loader does not exist.

- [x] **Step 2: Define Snapshot and Plan base contracts**

Create the exact base in `lib/contracts/chat-turn-plan.ts`:

```ts
export const TURN_PLAN_VERSION = 'turn-plan-v1' as const;
export const TURN_PLANNER_VERSION = 'deterministic-turn-planner-v1' as const;

export interface ConversationSessionSnapshot {
  conversationId: string;
  interactionTurnId: string;
  currentUserMessageId: string;
  currentInput: string;
  workflow: ChatWorkflow;
  mode: ChatMode;
  audienceIntent: AudienceIntent;
  pageContext: Readonly<Record<string, string>> | null;
  currentFrame: ConversationTaskFrameV22 | null;
  adjacentCompletedTurn: CompletedContextTurn | null;
  completedHistory: readonly CompletedContextTurn[];
}
```

Use existing exported request types for `ChatWorkflow`, `ChatMode` and `AudienceIntent`; do not redeclare string unions.

- [x] **Step 3: Implement one frozen loader** (`conversation-context-state.ts` checked-no-change)

Create `loadConversationSessionSnapshot()` in `lib/server/chat-conversation-session.ts`. Reuse `loadContextTaskFrame()` and `loadCanonicalAnswerHistory()`; add one adjacent-completed query only if no existing helper expresses it. Validate current message ID, role and conversation, then deep-freeze arrays/objects.

- [x] **Step 4: Run Snapshot and state regressions**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-conversation-session.test.ts tests/canonical-history.test.ts tests/context-state-integration.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit the Session boundary**

```powershell
git add lib/contracts/chat-turn-plan.ts lib/server/chat-conversation-session.ts lib/server/conversation-context-state.ts tests/chat-conversation-session.test.ts
git commit -m "refactor: freeze conversation session snapshots"
```

## Task 3: Introduce deterministic TurnPlan

**Files:** modify `lib/contracts/chat-turn-plan.ts`; create `lib/server/chat-turn-planner.ts`, `tests/chat-turn-planner.test.ts`; modify `lib/server/chat-semantic-resolver.ts` only to remove duplicate evidence decisions after the planner owns them.

- [x] **Step 1: Write RED plan matrix tests**

Create table-driven `tests/chat-turn-planner.test.ts`:

```ts
const cases = [
  ['你是谁？', null, 'identity_fact', 'identity'],
  ['你做过哪些项目？', null, 'project_catalog', 'portfolio_full'],
  ['哪个项目最能证明你会 Vibe Coding？', recruitmentFrame, 'project_fit', 'portfolio_full'],
  ['你用过 Cursor 吗？', null, 'capability_fact', 'capabilities'],
  ['数字摩斯怎么实现动态上下文？', null, 'named_project_fact', 'named_projects'],
  ['为什么天空是蓝色的？', recruitmentFrame, 'general_conversation', 'none'],
] as const;

for (const [message, frame, intent, evidenceKind] of cases) {
  const plan = planChatTurn(snapshot({ message, frame }), catalog);
  assert.equal(plan.semantic.intent, intent);
  assert.equal(plan.evidence.kind, evidenceKind);
  assert.equal(plan.executor.kind, 'direct');
}
```

Add explicit invariants:

```ts
assert.equal('reject' in plan, false);
assert.equal('maxTokens' in plan, false);
assert.equal('maxEvidence' in plan, false);
assert.equal(fakeProvider.calls, 0);
```

Add the ten HR follow-ups from `tests/fixtures/hr-qa-mvp-chain.ts`; after the JD, all ten plans must continue one task and require `portfolio_full` or `capabilities` with `includePortfolio=true`.

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-turn-planner.test.ts
```

Expected: FAIL because plan contracts and planner are incomplete.

- [x] **Step 2: Complete TurnPlan contracts**

Add to `lib/contracts/chat-turn-plan.ts`:

```ts
export type EvidenceRequirement =
  | { kind: 'none' }
  | { kind: 'identity' }
  | { kind: 'portfolio_full'; rankForQuestion: boolean }
  | { kind: 'named_projects'; projectSlugs: readonly ProjectSlug[] }
  | { kind: 'capabilities'; capabilityIds: readonly string[]; includePortfolio: boolean }
  | { kind: 'controlled_search' };

export interface TurnPlanV1 {
  schemaVersion: typeof TURN_PLAN_VERSION;
  plannerVersion: typeof TURN_PLANNER_VERSION;
  conversationId: string;
  interactionTurnId: string;
  currentUserMessageId: string;
  semantic: SemanticTurnDecision;
  taskId: string | null;
  candidateFrame: CandidateConversationTaskFrameV22 | null;
  evidence: EvidenceRequirement;
  executor: { kind: 'direct' };
  reasonCodes: readonly string[];
}
```

- [x] **Step 3: Implement planning as a pure deterministic composition**

Create `planChatTurn(snapshot, catalog)` in `lib/server/chat-turn-planner.ts`:

1. Call the existing semantic resolver with Snapshot, Catalog matches and existing candidate-frame transition helpers.
2. Map intent to `EvidenceRequirement` with an exhaustive `switch`.
3. Map HR/JD/project-fit/project-experience to `portfolio_full`.
4. Map capability questions to `capabilities`; set `includePortfolio=true` in recruiter/JD context.
5. Map external-current to existing controlled search without adding search behavior.
6. Freeze the returned plan.

Use `assertNever(intent)` in the default branch; no general fallback may silently emit `none` for a new intent.

- [x] **Step 4: Run planner and semantic tests**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-turn-planner.test.ts tests/chat-semantic-resolver.test.ts tests/chat-route-policy.test.ts
```

Expected: PASS. Legacy route tests remain compatibility tests; they no longer define V2.2 evidence policy.

- [x] **Step 5: Commit TurnPlan**

```powershell
git add lib/contracts/chat-turn-plan.ts lib/server/chat-turn-planner.ts lib/server/chat-semantic-resolver.ts tests/chat-turn-planner.test.ts tests/chat-semantic-resolver.test.ts
git commit -m "feat: add deterministic chat turn plans"
```

## Task 4: Separate approved facts from retrieval relevance

**Files:** modify `lib/server/chat-evidence-planner.ts`, `lib/server/chat-context-packet.ts`, `tests/chat-evidence-planner.test.ts`, `tests/chat-context-packet.test.ts`; create `tests/fixtures/hr-qa-mvp-chain.ts`.

- [x] **Step 1: Create the fixed synthetic HR chain** (completed early for Task 3 HR invariants)

Create `tests/fixtures/hr-qa-mvp-chain.ts` with this exact public fixture:

```ts
export const hrQaMvpChain = {
  jd: [
    '岗位：跨境电商 AI 产品负责人（Vibe Coding 方向）',
    '工作内容：把业务想法转成产品方案，接手前后端并快速交付。',
    '岗位要求：使用 Claude Code，建设自动化流程，依据用户反馈和业务数据持续迭代。',
  ].join('\n'),
  questions: [
    '请介绍与岗位最相关的项目和能力证据。',
    '综合这份 JD，给出三项优势和两项风险。',
    '结合岗位要求，你最大的能力差距是什么？',
    '你会如何接手陌生的 AI 生成前后端代码？',
    '如何保证快速交付仍然可验证、可回滚？',
    '哪个项目最能证明你能用 Vibe Coding 独立交付？',
    '如何把跨境电商业务想法转成可执行产品方案？',
    '如何在主备模型之间切换并保证可回滚？',
    '如何依据用户反馈和业务数据持续迭代？',
    '为什么你适合 AI 产品负责人岗位？',
  ],
} as const;
```

- [x] **Step 2: Write RED full-portfolio evidence tests**

In `tests/chat-evidence-planner.test.ts`:

```ts
for (const mode of ['success-low-score', 'empty', 'embedding-error', 'retrieval-error'] as const) {
  const bundle = await planChatEvidence({ plan: hrPlan, session, catalog, retrieval: fake(mode) });
  assert.deepEqual(
    bundle.approved.filter((source) => source.projectSlug).map((source) => source.projectSlug),
    siteContent.projects.map((project) => project.slug),
  );
  assert.ok(siteContent.profile.resumeFacts?.every((fact) =>
    bundle.approved.some((source) => source.chunkId.includes(fact.id) || source.content.includes(fact.content)),
  ));
}
```

Assert relevance may differ by mode but `approved` does not. Assert Cursor appears only in `unavailableCapabilityIds`, never as a `KnowledgeSource`.

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-evidence-planner.test.ts
```

Expected: FAIL because the current ranked path applies `LOCAL_EVIDENCE_MIN_SCORE` to admission.

- [x] **Step 3: Implement `EvidenceBundle` policy**

Change `planChatEvidence()` to accept `{ plan, session, catalog, ...retrieval }` and return `EvidenceBundle`.

For `portfolio_full`:

```ts
const approved = allApprovedPortfolioEvidence(catalog);
const relevance = await rankWithoutFilteringApproved(session.currentInput, approved, retrieval);
return {
  catalogVersion: 2,
  approved,
  admissions: admissionsFor(approved, requestedCapabilities),
  relevance,
  unavailableCapabilityIds,
  degradedReason,
};
```

Deduplicate by stable `chunkId`; preserve catalog order. `LOCAL_EVIDENCE_MIN_SCORE` remains in RAG evaluation and may annotate relevance, but it cannot remove a Catalog-approved item from HR bundles.

- [x] **Step 4: Serialize all approved facts exactly once**

Modify `chat-context-packet.ts` so `CanonicalAnswerSourceV2.approvedEvidence` comes from `bundle.approved` and `retrieval_scores` comes from `bundle.relevance`. Add an assertion in `tests/chat-context-packet.test.ts`:

```ts
for (const source of bundle.approved) {
  assert.equal(serialized.split(source.chunkId).length - 1, 1);
}
assert.equal(serialized.split(session.currentInput).length - 1, 1);
```

- [x] **Step 5: Run evidence/packet/regression checks**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-evidence-catalog.test.ts tests/chat-evidence-planner.test.ts tests/chat-context-packet.test.ts tests/rag-integration.test.ts
npm run rag:eval
```

Expected: PASS; RAG evaluation remains a retrieval metric, while full HR admission is proven separately.

- [x] **Step 6: Commit evidence separation**

```powershell
git add lib/server/chat-evidence-planner.ts lib/server/chat-context-packet.ts tests/chat-evidence-planner.test.ts tests/chat-context-packet.test.ts tests/fixtures/hr-qa-mvp-chain.ts
git commit -m "refactor: separate evidence admission from relevance"
```

## Task 5: Sign and persist TurnPlan metadata without migration

**Files:** modify `lib/contracts/chat-context.ts`, `lib/server/chat-context-packet.ts`, `lib/server/conversation-context-state.ts`, `lib/server/interaction-log.ts`, `tests/chat-context-packet.test.ts`, `tests/context-state-integration.test.ts`, `tests/context-persistence-integration.test.ts`.

- [x] **Step 1: Write RED manifest projection tests**

Add:

```ts
assert.deepEqual(manifest.turn_plan, {
  schema_version: 'turn-plan-v1',
  planner_version: 'deterministic-turn-planner-v1',
  evidence_kind: 'portfolio_full',
  executor_kind: 'direct',
  project_ids: siteContent.projects.map((project) => project.slug),
  capability_ids: ['ai-programming-collaboration'],
});
assert.deepEqual(manifest.answer_validation, {
  verdict: 'not_run',
  issue_codes: [],
});
assert.doesNotMatch(JSON.stringify(manifest), /跨境电商|Vibe Coding|current_input|approved_evidence/u);
```

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-context-packet.test.ts tests/context-state-integration.test.ts tests/context-persistence-integration.test.ts
```

Expected: FAIL because fields do not exist.

- [x] **Step 2: Extend `ContextPacketManifest` with bounded projections**

Add exact fields:

```ts
turn_plan: {
  schema_version: 'turn-plan-v1';
  planner_version: 'deterministic-turn-planner-v1';
  evidence_kind: EvidenceRequirement['kind'];
  executor_kind: 'direct';
  project_ids: string[];
  capability_ids: string[];
};
answer_validation: {
  verdict: 'not_run' | 'pass' | 'warn' | 'block';
  issue_codes: AnswerValidationIssueCode[];
};
```

Create pure projectors `projectTurnPlanManifest(plan, bundle)` and `projectAnswerValidationManifest(result)`. Validate every ID against Catalog before persistence.

- [x] **Step 3: Include the plan projection in existing HMAC coverage**

Implement `renderTrustedTurnPlan(planManifest)` with stable key and array ordering. Append its `<turn_plan>` block to `CanonicalAnswerSourceV2.trustedInstructions` before building `context-packet-v2`; do not put it in `taskInputs`, add an unsigned side channel or introduce a new packet schema. Existing packet/request V2 HMACs then cover the exact plan projection through signed trusted instructions. Tests must prove changing `evidence_kind` changes packet and request HMAC while changing RAG score order alone does not change approved-fact identity.

- [x] **Step 4: Persist through existing JSONB paths**

Modify completed, failed, stopped and compensation manifest builders. Build `answer_validation.verdict='not_run'` only in the in-memory pre-validation manifest; do not perform an interim database write. The success transaction persists `pass` or `warn`; a security compensation persists `block` with issue codes; an earlier execution failure persists `not_run`. No SQL migration is allowed.

- [x] **Step 5: Run persistence checks**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-context-packet.test.ts tests/context-state-integration.test.ts tests/context-persistence-integration.test.ts tests/provider-attempt-log.test.ts
```

Expected: PASS with no plaintext input, answer, JD, Secret or Provider body in manifest rows.

- [x] **Step 6: Commit plan integrity and persistence**

```powershell
git add lib/contracts/chat-context.ts lib/server/chat-context-packet.ts lib/server/conversation-context-state.ts lib/server/interaction-log.ts tests/chat-context-packet.test.ts tests/context-state-integration.test.ts tests/context-persistence-integration.test.ts tests/provider-attempt-log.test.ts
git commit -m "feat: persist signed turn plan metadata"
```

## Task 6: Extract DirectAnswerExecutor and keep current recovery semantics

**Files:** create `lib/server/chat-answer-executor.ts`, `tests/chat-answer-executor.test.ts`; modify `lib/server/chat-answer-runner.ts`, `lib/server/chat-service.ts` only enough to delegate; retain `chat-context-coordinator.ts`, `chat-history-compaction.ts`, `failover-ai-provider.ts` behavior.

- [x] **Step 1: Write RED executor contract tests**

Create `tests/chat-answer-executor.test.ts` with fake Provider targets:

```ts
const candidate = await executor.execute(input, signal);
assert.equal(candidate.executorKind, 'direct');
assert.equal(candidate.text, '完整候选答案');
assert.equal(publicEvents.some((event) => event.type === 'delta'), false);
assert.equal(provider.planCalls, 0);
assert.equal(provider.answerCalls, 1);
```

Add cases for primary infrastructure failure -> serial fallback, numeric context overflow -> existing one retry/compaction, cancellation, empty output and all-target exhaustion. Assert protected input/evidence HMACs and attempt indices match existing contracts.

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-answer-executor.test.ts tests/chat-dynamic-context.test.ts tests/failover-provider.test.ts
```

Expected: new test FAIL because execution is embedded in `chat-service.ts`.

- [x] **Step 2: Define executor and candidate contracts**

Add to `lib/contracts/chat-turn-plan.ts`:

```ts
export interface AnswerCandidate {
  executorKind: 'direct';
  text: string;
  usage: TokenUsage | null;
  attempts: readonly ProviderAttempt[];
  winner: ProviderWinner | null;
  sources: readonly PublicChatSource[];
}

export interface AnswerExecutor {
  execute(input: AnswerExecutionInput, signal: AbortSignal): Promise<AnswerCandidate>;
}
```

- [x] **Step 3: Extract provider coordination without changing it**

Move from `chat-service.ts` into `chat-answer-executor.ts`:

- `CanonicalAnswerSourceV2` target preparation.
- generation variant ID/revision handling.
- dynamic context fit/compaction callbacks.
- Provider attempt reservation/event projection callbacks supplied as dependencies.
- `runChatAnswer()` consumption and aggregate usage/winner result.

The executor buffers candidate text and returns it. It may emit typed operational events (`attempt`, `switching`) to a callback, but never answer deltas.

- [x] **Step 4: Make the runner completion-only for answer text**

Change `ChatAnswerRunnerEvent` to remove the pre-commit `delta` event. Its successful terminal event already contains `answer`; attempt and switching events remain.

```ts
export type ChatAnswerRunnerEvent =
  | { type: 'switching' }
  | { type: 'attempt'; attempt: ProviderAttempt }
  | { type: 'complete'; answer: string; /* existing metadata */ };
```

- [x] **Step 5: Run executor and recovery boundaries**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-answer-executor.test.ts tests/chat-answer-runner.test.ts tests/chat-dynamic-context.test.ts tests/context-compaction-integration.test.ts tests/failover-provider.test.ts tests/provider-attempt-log.test.ts tests/openai-provider.test.ts
```

Expected: PASS; no external Provider call.

- [x] **Step 6: Commit executor extraction**

```powershell
git add lib/contracts/chat-turn-plan.ts lib/server/chat-answer-executor.ts lib/server/chat-answer-runner.ts lib/server/chat-service.ts tests/chat-answer-executor.test.ts tests/chat-answer-runner.test.ts
git commit -m "refactor: extract direct answer executor"
```

## Task 7: Replace output rejection with typed validation

**Files:** create `lib/server/chat-answer-validator.ts`, `tests/chat-answer-validator.test.ts`; modify integration/eval tests; delete `lib/server/chat-output-guard.ts`, `tests/chat-output-guard.test.ts` after all runtime imports are absent.

- [ ] **Step 1: Write RED pass/warn/block tests**

Create `tests/chat-answer-validator.test.ts`:

```ts
test('quality findings warn but never reject a nonblank answer', () => {
  for (const candidate of [missingProject, invalidCitation, unsupportedClaim]) {
    const result = validateAnswer({ plan, evidence, candidate, privacyCanaries });
    assert.equal(result.verdict, 'warn');
    assert.ok(result.issues.length > 0);
  }
});

test('style and template shape are not validation inputs', () => {
  const result = validateAnswer({
    plan,
    evidence,
    candidate: answerWithOldVoiceAndTemplateSignals,
    privacyCanaries,
  });
  assert.notEqual(result.verdict, 'block');
  assert.equal(result.issues.some((issue) => /voice|template|next_step/u.test(issue.code)), false);
});

test('private and secret canaries block before release', () => {
  for (const text of [privateCanaryAnswer, secretCanaryAnswer]) {
    const result = validateAnswer({ plan, evidence, candidate: { ...candidate, text }, privacyCanaries });
    assert.equal(result.verdict, 'block');
  }
});
```

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-answer-validator.test.ts
```

Expected: FAIL because Validator does not exist.

- [ ] **Step 2: Define exact issue codes and severity**

Add to `lib/contracts/chat-turn-plan.ts`:

```ts
export type AnswerValidationIssueCode =
  | 'missing_evidence_coverage'
  | 'invalid_citation'
  | 'unsupported_capability_claim'
  | 'private_data_leak'
  | 'secret_leak';

export interface AnswerValidationResult {
  verdict: 'pass' | 'warn' | 'block';
  issues: readonly { code: AnswerValidationIssueCode; evidenceId: string | null }[];
}
```

- [ ] **Step 3: Implement deterministic checks**

Create `validateAnswer()` with these fixed severities:

```ts
const BLOCKING = new Set<AnswerValidationIssueCode>([
  'private_data_leak',
  'secret_leak',
]);
```

Coverage compares requested IDs with Catalog aliases/projects in the final text. Citation validity accepts absent citations as a warning and rejects no answer. Unsupported capability detection only checks capabilities explicitly requested and marked unavailable. Privacy/Secret patterns reuse existing isolation/canary utilities; do not persist matched substrings.

- [ ] **Step 4: Prove old guard has no runtime consumer, then delete it**

```powershell
rg -n "chat-output-guard|inspectChatAnswer|inspectTemplateRepetition|OUTPUT_GUARD_REJECTED" lib app scripts tests
```

Migrate any remaining quality-only consumer to `validateAnswer()` and ensure warning cannot enter Provider recovery. Delete `lib/server/chat-output-guard.ts` and `tests/chat-output-guard.test.ts`.

- [ ] **Step 5: Run validator and non-rejection tests**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-answer-validator.test.ts tests/chat-safe-answer.test.ts tests/chat-controlled-context-integration.test.ts tests/chat-service-integration.test.ts
rg -n "inspectChatAnswer|inspectTemplateRepetition|OUTPUT_GUARD_REJECTED|unsolicited_next_step|developer_voice|template_repetition" lib app scripts tests
```

Expected: tests PASS and `rg` returns no runtime/test authority match.

- [ ] **Step 6: Commit Validator convergence**

```powershell
git add lib/contracts/chat-turn-plan.ts lib/server/chat-answer-validator.ts tests/chat-answer-validator.test.ts tests/chat-safe-answer.test.ts tests/chat-controlled-context-integration.test.ts tests/chat-service-integration.test.ts
git add -u lib/server/chat-output-guard.ts tests/chat-output-guard.test.ts
git commit -m "refactor: replace answer rejection with validation"
```

## Task 8: Compose the Q&A runtime and commit before release

**Files:** create `lib/server/chat-qa-runtime.ts`, `tests/chat-qa-runtime.test.ts`; modify `lib/server/chat-service.ts`, `lib/server/conversation-context-state.ts`, `tests/chat-sse.test.ts`, `tests/chat-controlled-context-integration.test.ts`.

- [ ] **Step 1: Write RED orchestration-order tests**

Create `tests/chat-qa-runtime.test.ts` with dependency spies:

```ts
assert.deepEqual(trace, [
  'load-session',
  'plan-turn',
  'build-evidence',
  'build-context',
  'execute-direct',
  'validate-answer',
  'commit-success',
  'release-answer',
]);
```

For a warning candidate:

```ts
assert.equal(result.validation.verdict, 'warn');
assert.equal(result.committed, true);
assert.equal(result.publicAnswer, candidate.text);
assert.equal(executor.calls, 1);
```

For a security block:

```ts
assert.equal(commitSuccess.calls, 0);
assert.equal(releasedAnswers.length, 0);
assert.equal(compensate.calls, 1);
```

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-qa-runtime.test.ts
```

Expected: FAIL because runtime does not exist.

- [ ] **Step 2: Implement one runtime composition**

Create:

```ts
export async function runQaTurn(
  input: RunQaTurnInput,
  dependencies: QaRuntimeDependencies,
): Promise<CommittedQaTurn>;
```

The function loads/fixes the Snapshot once, plans once, builds evidence once, builds one canonical source, executes one direct answer chain, validates once and invokes one success transaction. It returns only committed data. It does not write SSE or authenticate Sessions.

- [ ] **Step 3: Extend the success transaction atomically**

Pass `TurnPlanManifest` and `AnswerValidationManifest` into existing `completeTurn()` / `commitContextTurnSuccess()`. The same transaction must write assistant text, sources, usage, completed status, candidate Frame, completed index and final manifest.

- [ ] **Step 4: Make `chat-service.ts` a lifecycle shell**

For `context_packet_v22`, replace inline resolver/evidence/provider/commit blocks with `runQaTurn()`. Keep:

- advisory locks and reserve/replay;
- request normalization and access/session checks;
- status/meta mapping;
- terminal compensation;
- post-commit `delta` and `done`.

Do not rewrite V1/V2 rollback behavior in this task. Add a source-level architecture test that `chat-service.ts` no longer imports catalog compiler, evidence planner internals, context coordinator internals or Validator implementation directly; it may import `runQaTurn()` and shared lifecycle types.

- [ ] **Step 5: Prove commit happens before answer delta**

In `tests/chat-sse.test.ts`, inject a commit barrier:

```ts
const pending = collectChatEvents();
await candidateReady;
assert.equal(events.some((event) => event.type === 'delta'), false);
releaseCommit();
await pending;
assert.deepEqual(events.filter((event) => event.type === 'delta').map((event) => event.text), [answer]);
assert.equal(events.at(-1)?.type, 'done');
```

Add commit-failure assertion: no delta/done, candidate Frame unchanged, terminal compensation recorded.

- [ ] **Step 6: Run orchestration and PostgreSQL boundaries**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-qa-runtime.test.ts tests/chat-sse.test.ts tests/chat-controlled-context-integration.test.ts tests/context-state-integration.test.ts tests/context-persistence-integration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit runtime wiring**

```powershell
git add lib/server/chat-qa-runtime.ts lib/server/chat-service.ts lib/server/conversation-context-state.ts tests/chat-qa-runtime.test.ts tests/chat-sse.test.ts tests/chat-controlled-context-integration.test.ts tests/context-state-integration.test.ts tests/context-persistence-integration.test.ts
git commit -m "refactor: run chat through qa runtime"
```

## Task 9: Prove the ten-question MVP and negative boundaries

**Files:** modify `tests/chat-controlled-context-integration.test.ts`, `scripts/chat-eval.mjs`, `content/chat-eval.json`; add focused fixture expectations to `tests/fixtures/hr-qa-mvp-chain.ts`.

- [ ] **Step 1: Add one full PostgreSQL HR chain**

Use `hrQaMvpChain`: recruiter entry, exact synthetic JD, then ten questions in one Session. For every question assert:

```ts
assert.equal(row.status, 'completed', question);
assert.equal(row.execution_pipeline, 'context_packet_v22', question);
assert.equal(row.context_manifest.turn_plan.executor_kind, 'direct', question);
assert.ok(['portfolio_full', 'capabilities'].includes(row.context_manifest.turn_plan.evidence_kind), question);
assert.deepEqual(row.context_manifest.turn_plan.project_ids, expectedProjectSlugs, question);
assert.equal(row.context_manifest.context_build_status, 'built', question);
assert.ok(['pass', 'warn'].includes(row.context_manifest.answer_validation.verdict), question);
assert.equal(visibleAnswer.trim().length > 0, true, question);
assert.equal(doneEvents.length, 1, question);
```

After the JD, assert one task ID and unchanged slot hashes. Inspect the Provider request for every turn and assert all project IDs plus every approved resume fact ID are present once.

- [ ] **Step 2: Add non-rejection Provider candidates**

Make a fake Provider answer deliberately omit citations or one project. Assert:

```ts
assert.equal(provider.calls, 1);
assert.equal(row.status, 'completed');
assert.equal(row.context_manifest.answer_validation.verdict, 'warn');
assert.equal(visibleAnswer, providerAnswer);
assert.equal(attempts.some((attempt) => attempt.generationMode === 'strict'), false);
```

- [ ] **Step 3: Add isolation and security negatives**

Cover:

- unrelated general question inside an active HR Session -> `evidence.kind='none'`, no old JD/evidence in payload, Frame preserved;
- failed/stopped turn -> absent from next Snapshot/history;
- Cursor direct claim -> warning but delivered;
- private resume canary or Secret canary -> block before delta, no matched content in manifest/log;
- same completed turn replay -> zero additional plan/evidence/Provider calls.

- [ ] **Step 4: Extend deterministic chat evaluation**

Add cases to `content/chat-eval.json` for the ten questions and negatives. `scripts/chat-eval.mjs` must assert plan intent/evidence kind, Catalog admissions, warning/block classification and `externalCalls=0`; it must not grade prose style.

- [ ] **Step 5: Run acceptance boundaries**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-turn-planner.test.ts tests/chat-evidence-planner.test.ts tests/chat-answer-validator.test.ts tests/chat-qa-runtime.test.ts tests/chat-controlled-context-integration.test.ts tests/chat-sse.test.ts
npm run chat:eval
```

Expected: all PASS and evaluation reports `externalCalls=0`.

- [ ] **Step 6: Commit acceptance coverage**

```powershell
git add tests/chat-controlled-context-integration.test.ts tests/chat-sse.test.ts tests/fixtures/hr-qa-mvp-chain.ts scripts/chat-eval.mjs content/chat-eval.json
git commit -m "test: cover agent ready qa acceptance"
```

## Task 10: Remove duplicate authorities and verify architecture

**Files:** modify/delete only files proven obsolete by `rg`; create a dated local verification receipt; reconcile authority docs only when implementation facts differ.

- [ ] **Step 1: Run duplicate-authority scans**

```powershell
rg -n "chatCapabilityPolicy|chat-capability-policy|CapabilityPolicy|MANUAL_ALIASES" content lib scripts tests
rg -n "inspectChatAnswer|inspectTemplateRepetition|OUTPUT_GUARD_REJECTED|strict-overlay-v1" lib app scripts tests
rg -n "planChatEvidence|prepareTargetContext|validateAnswer|compileChatEvidenceCatalog" lib/server/chat-service.ts
```

Expected: first two scans have no active runtime/test authority; `chat-service.ts` only delegates to `runQaTurn()` and does not own planner/evidence/executor/validator internals. Historical schema readers may retain `strict-overlay-v1` only if a test proves they are read-only and new runtime cannot create it.

- [ ] **Step 2: Check size and responsibility, not an arbitrary line target**

Review `chat-service.ts` and new modules against this ownership table:

```text
chat-service             access/session/turn/SSE lifecycle
chat-conversation-session completed-only read snapshot
chat-turn-planner        deterministic plan
chat-evidence-catalog    fact identity and aliases
chat-evidence-planner    plan -> evidence bundle
chat-answer-executor     Provider execution -> candidate
chat-answer-validator    candidate -> pass/warn/block
chat-qa-runtime          composition and commit-ready result
conversation-context-state persistence and atomic state
```

Move any misplaced business decision to its owner before review. Do not create forwarding-only modules with no ownership.

- [ ] **Step 3: Run focused and full verification once**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-evidence-catalog.test.ts tests/chat-conversation-session.test.ts tests/chat-turn-planner.test.ts tests/chat-evidence-planner.test.ts tests/chat-context-packet.test.ts tests/chat-answer-executor.test.ts tests/chat-answer-validator.test.ts tests/chat-qa-runtime.test.ts tests/chat-sse.test.ts tests/chat-controlled-context-integration.test.ts
npm run chat:eval
npm run rag:eval
npm run typecheck
npm test
npm run build
git diff --check master...HEAD
git status --short --branch
```

Expected: all exit 0; no unexplained skip; only task-owned files differ.

- [ ] **Step 4: Run visual Chat verification**

Start the fresh production build using the existing S10 harness and run:

```powershell
npm run visual:s10
```

Inspect 1440x900 and 390x844. Confirm one answer appears only after commit, status/switching does not resize controls, replay shows one answer, no overlap/horizontal overflow, console/page errors 0 and no unexpected external runtime asset.

- [ ] **Step 5: Run scoped privacy and Secret scans**

```powershell
git diff --name-only master...HEAD
rg -n -i "authorization:|bearer [a-z0-9._-]{12,}|api[_-]?key[=:][^< ]|private resume|raw provider|response body|current_input|approved_evidence" content lib tests scripts docs .env.example
```

Classify every match. Expected: schema names, synthetic canaries, tests and redacted placeholders only; no credential, private resume text, real JD/answer, raw Provider payload, production value or Session token.

- [ ] **Step 6: Perform split CRITICAL review**

Review 1, compliance/spec:

- no new DB migration, Skills/search/tool scope or artificial caps;
- full approved evidence and private-resume isolation;
- security-only block and non-blocking quality warnings;
- manifest/HMAC privacy and compatibility;
- commit-before-release/replay/compensation.

Review 2, quality/safety:

- one plan authority and exhaustive intent mapping;
- evidence admission independent from relevance;
- direct executor preserves dynamic compaction/failover/attempt semantics;
- no duplicate alias/policy/guard authority;
- ten-question and negative coverage.

Each finding needs severity, exact file/location, evidence and minimum closure. Use at most three root-cause correction batches; rerun only invalidated focused checks and delta-review fixes. Both final verdicts must be PASS before release.

- [ ] **Step 7: Write local VerificationReceipt and reconcile knowledge**

Create `docs/verify/release/agent-ready-qa-mvp-local-closeout-2026-07-29.md` recording branch/HEAD, diff inventory, exact test counts, eval results, visual evidence, scans, review verdicts, exclusions and invalidation conditions. Do not include real questions/answers, private JD, Prompt, HMAC value, Provider payload or Secret.

Run `closeout` and `neat-freak`. Update `docs/portfolio-blueprint.md`, runbooks or task center only for facts that are now true; otherwise record `checked-no-change`. Final knowledge verdict must be `KNOWLEDGE_RECONCILED`.

- [ ] **Step 8: Commit the reviewed local milestone**

First write the exact reviewed paths to a PowerShell array from `git diff --name-only HEAD`; compare it with the StagePacket inventory and stop on any unknown path. Stage only those literal paths plus the local receipt and justified authority updates:

```powershell
$ownedPaths = @(
  'docs/verify/release/agent-ready-qa-mvp-local-closeout-2026-07-29.md'
)
git add -- $ownedPaths
git diff --cached --name-status
git diff --cached --check
git commit -m "docs: record agent ready qa verification"
```

All implementation files should already be in the reviewed task commits. If review corrections remain uncommitted, append their exact literal paths to `$ownedPaths`; never stage a directory. Expected: cached inventory contains only reviewed task files; no root `.github/` or historical archive.

## Task 11: Absorb, deploy and observe the real HR MVP

**Files:** no source changes unless an observed defect is first reproduced; create `docs/verify/release/agent-ready-qa-mvp-production-closeout-2026-07-29.md` and update current authority pointers after observation.

- [ ] **Step 1: Recheck authorization and current release state**

Before push or production mutation, reread `morse-dev-sop`, `closeout`, `docs/runbooks/production.md` and `docs/runbooks/tencent-lighthouse.md`. Confirm the user has explicitly resumed implementation/deployment at the intended reasoning level.

```powershell
git -C E:\Revolution status --short --branch
git -C E:\Revolution\.worktrees\agent-ready-qa-mvp status --short --branch
git -C E:\Revolution\.worktrees\agent-ready-qa-mvp log -1 --format="%H %s"
git -C E:\Revolution worktree list --porcelain
```

Stop if mainline/ownership changed, reviews are not PASS or authorization is absent.

- [ ] **Step 2: Absorb onto latest mainline and refresh invalidated checks**

Use the current `closeout` absorption method. Preserve root untracked files. After absorption run:

```powershell
npm run typecheck
npm test
npm run build
npm run chat:eval
git diff --check
```

Expected: PASS at the exact absorbed commit.

- [ ] **Step 3: Push only the frozen absorbed commit**

```powershell
git push origin master
git rev-parse HEAD
git rev-parse origin/master
```

Expected: exact SHA equality. If GitHub transport fails, report local/remote separation; do not claim push.

- [ ] **Step 4: Deploy through the current immutable-release runbook**

Follow `docs/runbooks/tencent-lighthouse.md` from the exact pushed commit: create one archive outside the repo, record SHA-256, transfer, verify the same hash, create a new immutable release directory, link protected shared config/secrets without printing them, build required Web/Worker images, switch `/opt/revolution/current`, and restart only services required by the actual diff.

Verify:

```powershell
$env:MORSE_RELEASE_BASE_URL='https://aimorse.tech'
npm run release:smoke
```

On the server verify five containers healthy, restart counts 0, release pointer and Web/Worker image working directories match the exact release. A healthy result is `DEPLOYED_UNOBSERVED`, not answer-quality proof.

- [ ] **Step 5: Run one fresh authorized HR Session**

Use one new exact-label `HR interview` Session. Keep Context Packet percent `0`; do not broaden public traffic. Send exactly:

1. recruiter entry;
2. the user-approved JD for this acceptance run;
3. the ten questions in `hrQaMvpChain.questions`, in order.

For each turn, wait for terminal `done` before the next. Read only bounded metadata from `interaction_turns`: status, execution pipeline, semantic/discourse/task action, context scope ID, TurnPlan projection, evidence IDs, validation verdict/issue codes and Provider attempt counts. Do not commit or paste the private JD or raw answers into evidence.

Required per-turn result:

```text
status=completed
pipeline=context_packet_v22
executor=direct
answer nonblank and relevant to current question
HR evidence contains all approved project IDs and approved resume facts
validation=pass or warn, never quality block
same task ID and unchanged JD slot hashes after JD
exactly one done
```

Immediately stop on an irrelevant answer, false fact, false evidence denial, 0 HR evidence, Task/JD drift, quality rejection, 5xx, missing done, duplicate charge or private/Secret exposure. Diagnose that exact turn before any further question.

- [ ] **Step 6: Observe and record production evidence**

After the final question, observe live/ready, container health/restarts, Web/Worker/Edge errors, attempt counts and Session terminal state for 15 minutes. Write `docs/verify/release/agent-ready-qa-mvp-production-closeout-2026-07-29.md` with exact commit/pointer/image IDs, bounded per-turn status counts, warning codes, stop signals, observation window and exclusions. Do not store raw JD, questions, answers, HMACs, Provider payloads, credentials or Session tokens.

- [ ] **Step 7: Finish at OBSERVED / KNOWLEDGE_RECONCILED**

Reconcile blueprint, production runbooks and task center with the observed state. Commit/push only the production evidence and justified authority updates under the same scoped authorization. The final claim may be:

- `OBSERVED` only if all ten real questions pass;
- `DEPLOYED_UNOBSERVED` if deployment is healthy but real testing did not finish;
- `OBSERVED_WITH_BLOCKER` if a named turn failed and testing stopped.

Do not recommend large HR promotion unless the real chain passes and the remaining risk is explicitly reported.

## Resume Pointer

Current: `TASK_7 / RED / READY`.

Last verified: Task 5 is committed as `4ad1620`. Task 6's executor/recovery suite passed `100/100`, the affected service integration passed after correcting one stale Task 3 intent expectation, TypeScript passed, and DirectAnswerExecutor returns only complete candidates while chat-service releases the answer delta only after the success transaction. No real Provider call, push or deployment has occurred.

Next action: add Task 7 RED coverage for deterministic pass/warn/block validation, then remove the old quality-rejection authority after all consumers migrate.
