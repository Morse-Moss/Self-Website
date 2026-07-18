# S11 Foundation Guardrails And Contracts Implementation Plan

> **For agentic workers:** REQUIRED METHOD: execute this plan task-by-task under the active Morse `STAGED / CRITICAL / LOCAL` contract. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add executable architecture boundaries and one pure chat contract source, then remove the repository's only TypeScript dependency cycle without changing runtime behavior.

**Architecture:** A Node test builds the internal TypeScript dependency graph with the repository's installed `typescript` parser and enforces acyclic, client/server, API, and pure-contract boundaries. Shared chat values and public shapes move into `lib/contracts/chat.ts`; existing server modules may re-export compatibility aliases while all active consumers import the pure contract directly.

**Tech Stack:** Next.js App Router, TypeScript, Node test runner, `typescript.preProcessFile`, CSS Modules unchanged.

---

## File Map

- Create `scripts/architecture-contract.test.mjs`: discover production TS/TSX modules, resolve local imports, detect cycles, and enforce allowed dependency directions.
- Create `lib/contracts/chat.ts`: own chat modes, audiences, workflows, phases, sources, diagnosis shapes, stable errors, history envelopes, and SSE event shapes without importing runtime modules.
- Create `tests/chat-contract.test.ts`: prove the stable runtime value sets and source/error shapes exported by the pure contract.
- Modify `lib/server/chat-core.ts`: consume and compatibility-re-export shared request types.
- Modify `lib/server/workflows/diagnosis.ts`: consume and compatibility-re-export diagnosis types.
- Modify `lib/server/budget.ts`: consume and compatibility-re-export SSE budget/usage types.
- Modify `lib/server/turn-codec.ts`: validate contract-owned sources while retaining codec exports for compatibility.
- Modify `lib/server/search-provider.ts`: return a contract-owned public source directly, removing the cycle edge to `turn-codec`.
- Modify `lib/server/chat-service.ts` and `lib/server/chat-route-stream.ts`: consume contract-owned event, error, workflow, and source types.
- Modify `lib/server/interaction-log.ts`, `lib/server/admin-query.ts`, and `lib/server/conversation-history.ts`: consume the source shape from the contract while keeping codec runtime sanitization.
- Modify `lib/client/chat-errors.ts` and `lib/client/chat-sse.ts`: consume stable public error and SSE shapes.
- Modify `components/chat/useMorseChat.ts`, `ChatSources.tsx`, `ChatMessageContent.tsx`, `ChatPhaseStatus.tsx`, and `DiagnosisIntake.tsx`: consume the shared public types instead of declaring or importing them through the hook.
- Modify `tests/chat-ui-contract.test.ts`: assert shared-contract ownership instead of requiring a duplicate workflow union in the hook.
- Create `docs/engineering-standards.md`: freeze modularity, transaction, retry, safety, testing, and delivery rules.
- Modify `docs/portfolio-blueprint.md`: register S11 and the engineering standards as the current architecture source.
- Modify `.gitignore`: ignore known generated `output/`, `tmp/`, and `scripts/.tmp-*` artifacts without deleting local files.

### Task 1: Add The Architecture Contract In RED

**Files:**
- Create: `scripts/architecture-contract.test.mjs`

- [ ] **Step 1: Write the dependency-graph tests**

Implement a production-source scanner with these roots and rules:

```js
const sourceRoots = ['app', 'components', 'lib'];

test('production TypeScript dependency graph is acyclic', async () => {
  const graph = await buildGraph();
  assert.deepEqual(findCycles(graph), []);
});

test('production TypeScript modules respect layer boundaries', async () => {
  const graph = await buildGraph();
  assert.deepEqual(findBoundaryViolations(graph), []);
});
```

Use `typescript.preProcessFile(source, true, true).importedFiles` rather than regular expressions. Resolve `@/` from the repository root, relative imports from their importer, `.ts`/`.tsx` extensions, and directory `index.ts`/`index.tsx`. Ignore packages and missing generated modules for graph edges, but retain package specifiers for purity checks.

Boundary checks:

```js
const boundaryRules = [
  ['components/', ['lib/server/', 'app/']],
  ['lib/client/', ['lib/server/', 'app/', 'components/']],
  ['lib/server/', ['app/', 'components/']],
  ['app/api/', ['components/']],
];
```

For `lib/contracts/**`, allow only relative or alias imports that resolve back into `lib/contracts/**`, and reject package imports including `node:*`, `react`, `next`, `pg`, and `openai`.

- [ ] **Step 2: Run the architecture test and verify RED**

Run:

```powershell
node --test scripts/architecture-contract.test.mjs
```

Expected: one failing acyclic test naming the existing cycle containing all three paths below; the boundary test passes.

```text
lib/server/search-provider.ts
lib/server/turn-codec.ts
lib/server/search-safety.ts
```

- [ ] **Step 3: Keep the RED evidence and do not weaken the rule**

Confirm the failure comes from parsed imports, not a hard-coded expected cycle. Do not add this cycle to an allowlist.

### Task 2: Freeze Engineering Rules And Workspace Hygiene

**Files:**
- Create: `docs/engineering-standards.md`
- Modify: `docs/portfolio-blueprint.md`
- Modify: `.gitignore`

- [ ] **Step 1: Add enforceable engineering standards**

Document these exact rule groups with concrete review triggers and commands:

```text
Module ownership and allowed dependency direction
400-line or fan-out-over-10 responsibility review; 600-line justification requirement
No generic Repository, service locator, pass-through wrapper, or speculative abstraction
Atomic transaction and idempotency requirements
Retry matrix: retryable set, idempotency basis, output boundary, max attempts, total timeout
Abort, timeout, failed, incomplete, and partial-output terminal distinctions
Provider URL, timeout, concurrency, AbortSignal, and safe-error adapter requirements
Focused -> affected integration -> full suite -> build -> runtime/release gate order
No secrets, request/answer bodies, invite codes, cookies, keys, TOTP, or webhook URLs in logs
Separate runtime, migration, and backup database roles for production
Stage-specific commits and knowledge reconciliation before milestone close
```

Reference `node --test scripts/architecture-contract.test.mjs` as the executable architecture gate.

- [ ] **Step 2: Register S11 in the blueprint**

Append an S11 section that points to:

```text
docs/superpowers/specs/2026-07-18-s11-architecture-hardening-design.md
docs/superpowers/plans/2026-07-18-s11-foundation-guardrails-and-contracts.md
docs/engineering-standards.md
```

State that S11 is incremental modular-monolith governance and does not change product features, persistence meaning, or deployment state.

- [ ] **Step 3: Ignore only confirmed generated artifacts**

Append:

```gitignore
output/
tmp/
scripts/.tmp-*
```

Do not delete existing untracked artifacts and do not stage `AGENTS.md`, research notes, screenshots, `output/**`, or existing temporary scripts.

- [ ] **Step 4: Verify documentation and ignore scope**

Run:

```powershell
rg -n "architecture-contract|400|600|幂等|AbortSignal|KNOWLEDGE_RECONCILED" docs/engineering-standards.md
git status --short
```

Expected: all rule anchors are present; known generated paths disappear from status because they are ignored; user-owned rules, research notes, and screenshots remain untracked and unstaged.

### Task 3: Introduce The Pure Chat Contract In RED/GREEN

**Files:**
- Create: `lib/contracts/chat.ts`
- Create: `tests/chat-contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

Import these runtime constants from `../lib/contracts/chat.ts`:

```ts
CHAT_AUDIENCE_INTENTS
CHAT_ERROR_CODES
CHAT_PHASES
CHAT_SOURCE_KINDS
CHAT_WORKFLOWS
RECOVERABLE_CHAT_ERROR_CODES
```

Assert exact ordered values and assert that recoverable codes are a subset of stable error codes. Add a typed `ChatSource` fixture and assert its JSON shape remains exactly:

```ts
{
  id: 'local-1',
  title: '公开资料',
  href: '/works#digital-morse',
  kind: 'local',
  domain: null,
  score: 0.9,
}
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```powershell
node --test tests/chat-contract.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/contracts/chat.ts`.

- [ ] **Step 3: Add the pure contract**

Define literal-derived types and public shapes without imports:

```ts
export const CHAT_WORKFLOWS = ['chat', 'jd_match', 'diagnosis'] as const;
export type ChatWorkflow = typeof CHAT_WORKFLOWS[number];

export const CHAT_PHASES = ['routing', 'knowledge', 'web', 'answering', 'handoff'] as const;
export type ChatPhase = typeof CHAT_PHASES[number];

export const CHAT_SOURCE_KINDS = ['local', 'official', 'github', 'web'] as const;
export type ChatSourceKind = typeof CHAT_SOURCE_KINDS[number];

export interface ChatSource {
  id: string;
  title: string;
  href: string;
  kind: ChatSourceKind;
  domain: string | null;
  score: number | null;
}
```

Also define `ChatMode`, `ChatAudienceIntent`, `DiagnosisFields`, server and UI diagnosis statuses, `BudgetLevel`, `TokenUsage`, `ChatErrorCode`, `ChatServiceErrorCode`, `ChatSsePayload`, `ChatServiceEvent`, and `ChatHistoryPayload` using the currently shipped field names. The error constants must preserve the current client allowlist exactly; no implicit provider/protocol fallback code is added.

- [ ] **Step 4: Run the contract and architecture purity tests GREEN/RED**

Run:

```powershell
node --test tests/chat-contract.test.ts scripts/architecture-contract.test.mjs
```

Expected: the contract test and contract-purity boundary test pass; the existing three-module cycle still fails until consumers migrate.

### Task 4: Migrate Consumers And Remove The Cycle

**Files:**
- Modify all contract consumers listed in the File Map.
- Modify `tests/chat-ui-contract.test.ts`.

- [ ] **Step 1: Move server type ownership without changing runtime fields**

Import types and constants from `../contracts/chat.ts` or `@/lib/contracts/chat`. Retain compatibility aliases such as:

```ts
export type TurnSource = ChatSource;
export type TurnSourceKind = ChatSourceKind;
export type { ChatMode, ChatAudienceIntent, ChatWorkflow } from '../contracts/chat.ts';
export type { BudgetLevel, TokenUsage } from '../contracts/chat.ts';
```

Change `search-provider.ts` to return `ChatSource` directly. This removes the `search-provider -> turn-codec` edge and therefore the only cycle. Do not change `normalizePublicHttpsUrl`, source sanitization, score/domain checks, or stored envelope serialization.

- [ ] **Step 2: Move client type ownership**

Import chat modes, audience, workflow, phase, source, diagnosis, history, and SSE types from `@/lib/contracts/chat`. Child chat components import public types directly from the contract instead of importing them through `useMorseChat.ts`.

Use contract constants for stable phase/error membership checks. Keep all existing text, fetch URLs, request bodies, stream event names, retry behavior, and state transitions unchanged.

- [ ] **Step 3: Update the source-based UI contract test**

Replace the assertion that requires a duplicated `type ChatWorkflow = ...` declaration in the hook with assertions that:

```ts
assert.match(hook, /from ['"]@\/lib\/contracts\/chat['"]/);
assert.match(contract, /CHAT_WORKFLOWS\s*=\s*\[['"]chat['"],\s*['"]jd_match['"],\s*['"]diagnosis['"]\]/);
```

Keep the three visible workflow label and click-action assertions unchanged.

- [ ] **Step 4: Run focused GREEN verification**

Run:

```powershell
node --test scripts/architecture-contract.test.mjs tests/chat-contract.test.ts tests/turn-codec.test.ts tests/search-provider.test.ts tests/search-safety.test.ts tests/chat-core.test.ts tests/chat-sse.test.ts tests/chat-route-stream.test.ts tests/chat-ui-contract.test.ts tests/diagnosis.test.ts
```

Expected: all focused tests pass, architecture reports zero cycles and zero boundary violations.

- [ ] **Step 5: Run TypeScript/build verification**

Run:

```powershell
npm run build
```

Expected: Next.js production build exits 0 with all current routes generated; no public route or response field changes.

### Task 5: Stage Exit, Review, And Local Commit

**Files:**
- All intended S11 foundation files only.

- [ ] **Step 1: Inspect the exact diff and scope**

Run:

```powershell
git diff --check
git diff --stat
git status --short
```

Expected: no whitespace errors; no user-owned untracked file is staged or modified.

- [ ] **Step 2: Run the full suite once**

Run:

```powershell
npm test
```

Expected: zero failures and zero skips, with the new architecture and chat contract tests included.

- [ ] **Step 3: Re-run the dependency graph and build as final claim evidence**

Run:

```powershell
node --test scripts/architecture-contract.test.mjs
npm run build
```

Expected: zero cycles, zero boundary violations, and build exit 0.

- [ ] **Step 4: Perform CRITICAL split review**

Compliance review checks exact frozen type values, unchanged JSON/SSE/database field names, scope ownership, and no external action. Quality/safety review checks graph resolution correctness, false-negative paths, contract purity, sanitizer behavior, and backward-compatible exports. Any admitted blocker must include file/line evidence and a minimum closure condition.

- [ ] **Step 5: Commit the verified stage locally**

Stage only the intended files and commit:

```powershell
git add .gitignore docs/engineering-standards.md docs/portfolio-blueprint.md docs/superpowers/plans/2026-07-18-s11-foundation-guardrails-and-contracts.md scripts/architecture-contract.test.mjs lib/contracts/chat.ts lib/server/chat-core.ts lib/server/workflows/diagnosis.ts lib/server/budget.ts lib/server/turn-codec.ts lib/server/search-provider.ts lib/server/chat-service.ts lib/server/chat-route-stream.ts lib/server/interaction-log.ts lib/server/admin-query.ts lib/server/conversation-history.ts lib/client/chat-errors.ts lib/client/chat-sse.ts components/chat/useMorseChat.ts components/chat/ChatSources.tsx components/chat/ChatMessageContent.tsx components/chat/ChatPhaseStatus.tsx components/chat/DiagnosisIntake.tsx tests/chat-contract.test.ts tests/chat-ui-contract.test.ts
git commit -m "refactor: establish S11 architecture contracts"
```

Do not push or deploy. Reconcile project knowledge through `closeout` before calling this S11 milestone closed.
