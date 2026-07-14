# S8 Customer Service Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing gated Digital Morse RAG MVP into a visitor-ready, recoverable, citable, and measurable text customer-service flow.

**Architecture:** Keep the existing Next.js, OpenAI-provider, PostgreSQL, pgvector, SSE, access-session, and budget boundaries. Add compensating turn cleanup without a schema migration, add an allow-listed audience intent to the request/prompt contract, map internal knowledge metadata to public site hrefs, and make the client retry the same visible turn after a recoverable error. Deterministic tests and local pgvector prove behavior before loopback Mock browser and bounded real-Provider evidence.

**Tech Stack:** Next.js App Router, TypeScript, React, CSS Modules, Node test runner, PostgreSQL 16 + pgvector, OpenAI SDK Responses/Embeddings, raw CDP smoke scripts.

---

## Execution Constraints

- Profile is `CRITICAL` because auth, secrets, paid Provider behavior, and persistent database state are in scope.
- Execute inline on `codex/s7-multipage-portfolio`; the approved S8 contract forbids a new branch/worktree and overrides the generic worktree recommendation.
- No dependency installation, schema migration, external-repository writes, deployment, push, or PR.
- Keep all user-owned untracked files unstaged. Local commit is allowed only once at final closeout after all gates pass.
- Never print environment values, API keys, raw Provider payloads, raw real prompts, or raw real outputs.

## File Map

- `lib/server/chat-core.ts`: request validation, `ChatAudienceIntent`, and intent-aware system instructions.
- `lib/server/chat-service.ts`: turn reservation, exact compensating cleanup, stable public error codes, public source projection.
- `lib/server/public-knowledge.ts`: stable public href for each approved document.
- `lib/server/knowledge.ts`: include href in the checksum contract so metadata changes reindex.
- `lib/server/rag.ts`: retrieve internal source path plus public href; source path remains server-only.
- `scripts/ingest-knowledge.mjs`: persist public href in chunk metadata.
- `components/MorseChat.tsx`: select intent, show public source links, expose progress and retry without duplicating the user bubble.
- `components/MorseChat.module.css`: token-only retry/source-link states.
- `content/rag-eval.json`: at least 20 retrieval questions covering three visitor audiences and cross-project queries.
- `scripts/s8-chat-smoke.mjs`: repeatable 1440/390 access, failure, retry, stream, source, and logout smoke.
- `scripts/mock-openai.mjs`: opt-in fail-first Responses behavior for recovery verification.
- `tests/*.test.ts` and `scripts/*.test.mjs`: behavior-first coverage.
- `docs/task-center/**`, `docs/verify/s8/**`: pointer, evidence, failure register, and closeout.

### Task 1: RED for Turn Compensation and Public Errors

**Files:**
- Modify: `tests/chat-service-integration.test.ts`
- Modify: `tests/chat-core.test.ts`

- [x] **Step 1: Add a Provider that fails after retrieval and assert exact compensation**

```ts
class FailingProvider implements AiProvider {
  async embed(): Promise<number[][]> {
    return [queryEmbedding];
  }

  async *streamAnswer(): AsyncIterable<AnswerEvent> {
    throw new Error('provider failed');
  }
}

test('runChat compensates a failed provider turn without consuming quota', async () => {
  const before = await readSessionState();
  await assert.rejects(consume(runChat(inputWith(new FailingProvider()))),
    (error) => error instanceof ChatServiceError && error.code === 'PROVIDER_UNAVAILABLE');
  const after = await readSessionState();
  assert.equal(after.messageCount, before.messageCount);
  assert.equal(after.messageRows, before.messageRows);
  assert.equal(after.usageRows, before.usageRows);
});
```

- [x] **Step 2: Add an embedding failure case**

```ts
class FailingEmbeddingProvider extends FakeProvider {
  override async embed(): Promise<number[][]> {
    throw new Error('embedding failed');
  }
}
```

Assert `RETRIEVAL_UNAVAILABLE` and the same database invariants.

- [x] **Step 3: Run RED**

Run:

```powershell
$env:DATABASE_URL='postgresql://revolution@127.0.0.1:55432/revolution'
node --test tests/chat-service-integration.test.ts tests/chat-core.test.ts
```

Expected: new cases fail because the current service exposes raw failure behavior and retains the reserved turn.

### Task 2: GREEN for Turn Compensation

**Files:**
- Modify: `lib/server/chat-service.ts`
- Test: `tests/chat-service-integration.test.ts`

- [x] **Step 1: Return exact reservation identity from `beginTurn`**

```ts
interface TurnContext {
  conversationId: string;
  userMessageId: string;
  messages: AiMessage[];
}

const inserted = await client.query<{ id: string }>(
  `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
   VALUES ($1, 'user', $2, $3) RETURNING id::text AS id`,
  [conversationId, request.message, now],
);
```

- [x] **Step 2: Add idempotent compensating cleanup**

```ts
async function compensateTurn(pool: Pool, accessSessionId: string, turn: TurnContext) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deleted = await client.query(
      `DELETE FROM conversation_messages
        WHERE id = $1 AND conversation_id = $2 AND role = 'user'`,
      [turn.userMessageId, turn.conversationId],
    );
    if (deleted.rowCount === 1) {
      await client.query(
        `UPDATE access_sessions
            SET message_count = GREATEST(message_count - 1, 0)
          WHERE id = $1`,
        [accessSessionId],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

- [x] **Step 3: Map failure stages without leaking raw errors**

Add `RETRIEVAL_UNAVAILABLE` and `PROVIDER_UNAVAILABLE` to `ChatServiceErrorCode`. Wrap embedding/retrieval separately from Provider streaming; compensate before throwing the public code. Preserve `BUDGET_EXHAUSTED`, session, mode, and message-limit errors.

- [x] **Step 4: Run GREEN and adjacent tests**

```powershell
node --test tests/chat-service-integration.test.ts tests/chat-core.test.ts tests/api-contract.test.ts
```

Expected: all selected tests pass with local PostgreSQL enabled.

### Task 3: RED/GREEN for Audience Intent and Public Sources

**Files:**
- Modify: `tests/chat-core.test.ts`
- Modify: `tests/public-knowledge.test.ts`
- Modify: `tests/rag-integration.test.ts`
- Modify: `tests/chat-service-integration.test.ts`
- Modify: `lib/server/chat-core.ts`
- Modify: `lib/server/public-knowledge.ts`
- Modify: `lib/server/knowledge.ts`
- Modify: `lib/server/rag.ts`
- Modify: `lib/server/chat-service.ts`
- Modify: `scripts/ingest-knowledge.mjs`

- [x] **Step 1: Add failing request and prompt tests**

```ts
assert.deepEqual(normalizeChatRequest({
  message: '介绍项目',
  mode: 'general',
  audienceIntent: 'collaboration',
}), {
  message: '介绍项目',
  mode: 'general',
  audienceIntent: 'collaboration',
  conversationId: null,
});
assert.throws(() => normalizeChatRequest({ message: '你好', audienceIntent: 'admin' }), /audienceIntent/);
assert.match(buildSystemInstructions('general', 'peer', [source]), /技术判断/);
```

- [x] **Step 2: Add failing public-href tests**

Expect `about -> /`, every project -> `/works/<slug>`, and FAQ -> `/works/digital-morse`. Assert public chat events contain `href` and do not contain `sourcePath`.

- [x] **Step 3: Run RED**

```powershell
node --test tests/chat-core.test.ts tests/public-knowledge.test.ts tests/rag-integration.test.ts tests/chat-service-integration.test.ts
```

Expected: failures for missing intent/href and the old public source projection.

- [x] **Step 4: Implement allow-listed intent and prompt contract**

```ts
export type ChatAudienceIntent = 'general' | 'recruiter' | 'collaboration' | 'peer';

export interface NormalizedChatRequest {
  message: string;
  mode: ChatMode;
  audienceIntent: ChatAudienceIntent;
  conversationId: string | null;
}
```

Build instructions from a fixed record and always include direct answer, evidence, honest boundary, and one next action. Do not call another model for classification.

- [x] **Step 5: Implement internal/public source separation**

Add `href` to `PublicKnowledgeDocument` and chunk metadata/checksum. `KnowledgeSource` may retain `sourcePath` for server evidence, but `ChatServiceEvent.meta.sources` returns only `documentId`, `title`, `href`, and `score`.

- [x] **Step 6: Run GREEN**

Run the Task 3 command again. Expected: all selected tests pass.

### Task 4: RED/GREEN for Client Recovery UX

**Files:**
- Modify: `tests/chat-ui-contract.test.ts`
- Modify: `components/MorseChat.tsx`
- Modify: `components/MorseChat.module.css`

- [x] **Step 1: Add failing UI contract assertions**

Require `audienceIntent`, an `<a href={source.href}>` source, `重试本次问题`, retrieval/answering labels, and retry logic that reuses the failed assistant ID without appending another user message. Assert no `sourcePath` client field.

- [x] **Step 2: Run RED**

```powershell
node --test tests/chat-ui-contract.test.ts
```

Expected: failure for the missing S8 client contract.

- [x] **Step 3: Implement minimal retry state**

```ts
interface ChatRequestSnapshot {
  message: string;
  mode: ChatMode;
  audienceIntent: ChatAudienceIntent;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: ChatSource[];
  error?: boolean;
  retry?: ChatRequestSnapshot;
  pendingLabel?: string;
}
```

Initial send appends one user and one assistant bubble. Retry clears and reuses the failed assistant bubble, sends the stored snapshot with the current conversation ID, and never appends a second user bubble. `meta` changes the label to answering; the first delta clears it.

- [x] **Step 4: Add token-only styles**

Use existing color, spacing, radius, and typography tokens for source links and retry controls. Keep 44px targets and mobile full-screen behavior.

- [x] **Step 5: Run GREEN and S7 adjacency**

```powershell
node --test tests/chat-ui-contract.test.ts tests/routes-contract.test.ts tests/site-shell-contract.test.ts
```

Expected: all selected tests pass.

### Task 5: Knowledge Reingest and 20-Case Retrieval Evaluation

**Files:**
- Modify: `content/rag-eval.json`
- Modify: `tests/rag-eval-contract.test.ts`
- Modify: `scripts/rag-eval.mjs` only if output needs per-case failure IDs

- [x] **Step 1: Expand the gold set before ingestion**

Add at least 20 real visitor questions across recruiter, collaboration, peer, general, and cross-project wording. Every case names an existing approved document ID; no desired answer text is fabricated.

- [x] **Step 2: Run the contract test and observe RED**

```powershell
node --test tests/rag-eval-contract.test.ts
```

Expected: the new `>=20` assertion fails before the dataset expansion and passes after it.

- [x] **Step 3: Start the existing loopback embedding service and reingest**

Use `BAAI/bge-small-zh-v1.5`, bind only `127.0.0.1:18091`, and set the local project `DATABASE_URL`. Run `npm run knowledge:ingest` twice; first run updates approved documents, second run reports all documents skipped.

- [x] **Step 4: Verify stored source boundaries**

Query counts and distinct `source_path` values only. Expected: nine approved documents, chunks for those documents, every path starts with `content/site-content.json#`, and no draft/S3 path remains.

- [x] **Step 5: Run semantic retrieval eval**

```powershell
npm run rag:eval
```

Expected: top-3 `20/20`; record top-1 honestly. Adjust only query wording or retrieval limit when a case is genuinely ambiguous; never change public facts to force the score.

### Task 6: Repeatable Mock Browser Recovery Smoke

**Files:**
- Modify: `scripts/mock-openai.mjs`
- Create: `scripts/s8-chat-smoke.mjs`
- Modify: `package.json`
- Modify: `scripts/s8-contract.test.mjs`

- [x] **Step 1: Add failing script-contract assertions**

Require `visual:s8-chat`, both `1440x900` and `390x844`, access unlock, all three intents, fail-first retry, streamed answer, source navigation, logout, overflow, and console/page error checks.

- [x] **Step 2: Run RED**

```powershell
node --test scripts/s8-contract.test.mjs
```

Expected: failure because the S8 browser command/harness does not exist.

- [x] **Step 3: Implement opt-in fail-first Mock behavior**

When `MORSE_MOCK_FAIL_FIRST_RESPONSE=true`, return one HTTP 503 from `/v1/responses`, then resume the existing deterministic SSE response. Do not affect embeddings.

- [x] **Step 4: Implement raw-CDP smoke**

The script reads the temporary invite only from `MORSE_SMOKE_INVITE_CODE`, never logs it, drives a fresh loopback page, and outputs only booleans/counts plus screenshot paths under `docs/verify/s8/`.

- [x] **Step 5: Run GREEN and rendered inspection**

Start Mock, Next production server, and the smoke harness with local-only configuration. Run `npm run visual:s8-chat`; inspect fresh desktop/mobile screenshots and verify retry/source behavior plus zero console/page errors.

### Task 7: Bounded Real Provider and CRITICAL Closeout

**Files:**
- Modify: `docs/task-center/run-state.md`
- Modify: `docs/task-center/s8-customer-service-conversation.md`
- Create: `docs/verify/s8/s8-closeout.md`

- [x] **Step 1: Run all local claim-proving gates**

```powershell
$env:DATABASE_URL='postgresql://revolution@127.0.0.1:55432/revolution'
npm test
npm run rag:eval
npm run build
git diff --check
```

Expected: zero failures; PostgreSQL tests run instead of skip.

- [x] **Step 2: Run bounded real GPT smoke only after local PASS**

Use the already trusted loopback OpenAI-compatible endpoint and a currently available configured model. Ask exactly one recruiter, one collaboration, and one peer question, max three calls total. Record only PASS/BLOCKED and redacted factual/citation/boundary checks; do not save raw prompts or outputs.

- [x] **Step 3: Perform two CRITICAL review views**

Compliance view checks task-center scope, secrets, public knowledge, evidence labels, and authorization. Quality/safety view checks database compensation, concurrency, prompt boundaries, SSE parsing, retry behavior, and regressions. Maximum three correction cycles; every admitted blocker must close.

- [x] **Step 4: Close Task Center**

Advance `run-state.md` only after evidence is final. Record exact tests, browser widths, retrieval scores, real Provider status, parked gaps, changed files, and remaining merge/push approval.

- [x] **Step 5: Explicitly stage and commit only S8-owned files**

List every path; exclude `AGENTS.md`, user research, concept images, `output/**`, and old temporary scripts. Do not merge or push.

## Plan Self-Review

- Spec coverage: all S8 phases map to Tasks 1-7; no digital-human, voice, web-search, external vector DB, admin, notification, deployment, or push work is included.
- Persistence choice: exact compensating deletion avoids a schema migration and keeps transactions short; the tests must prove quota/history invariants before acceptance.
- Type consistency: `ChatAudienceIntent`, `audienceIntent`, `href`, and the four public error codes use the same names across request, server event, client, tests, and smoke.
- Evidence boundary: deterministic/local/Mock/real Provider evidence is separated at every gate.
