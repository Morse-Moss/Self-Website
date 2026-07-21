# Native Web Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inactive Bocha-first search path with a controlled Responses `web_search` path that preserves privacy vetoes, 1+1 session budgeting, clickable citations, audit records, failover safety, and the production kill switch.

**Architecture:** The server performs RAG first and produces a deterministic `disabled / auto / required` search decision. For the native backend, the same Responses request receives the hosted tool; the Provider normalizes tool and citation events, while `chat-service` owns quota reservation, source sanitization, final citation markers, persistence, and downgrade behavior. Existing Bocha code remains behind its explicit backend value, but production and the new local smoke use `native` only.

**Tech Stack:** Next.js App Router, TypeScript 6, Node test runner, OpenAI SDK 6.46, PostgreSQL 16/pgvector, React 19, existing SSE and browser smoke harnesses.

---

## Stage Contract

- Worktree: `E:\Revolution\.worktrees\native-web-search`
- Branch: `codex/native-web-search`
- Starting revision: `b85d369` on top of `origin/master@b6ddad5`
- Morse controls: `STAGED / CRITICAL / LOCAL`
- Local scope: code, tests, Mock production chain, documentation, 1440x900 and 390x844 acceptance.
- Forbidden in this plan: real Provider calls, production environment changes, push, deployment, Bocha registration, hosted shell, MCP, Skills tool, new dependencies, and changes to `E:\Revolution\.worktrees\private-resume-access`.
- Paid compatibility smoke, push, and deployment remain later explicit approval gates.

## File Responsibility Map

| File | Responsibility after this change |
|---|---|
| `lib/server/search-router.ts` | Deterministic privacy veto, mode, minimal query, reason, and quota threshold |
| `lib/server/ai-provider.ts` | Provider-neutral native search request and normalized answer events |
| `lib/server/openai-provider.ts` | Responses request fields and OpenAI stream/output normalization |
| `lib/server/failover-ai-provider.ts` | Stop all retries and node switching after irreversible tool activity |
| `lib/server/native-web-search.ts` | Sanitize native sources and convert annotations to existing citation markers |
| `lib/server/interaction-search.ts` | Atomic claim, unused-claim release, actual-query finalization, and idempotency |
| `lib/server/chat-service.ts` | Backend selection, native orchestration, audit finalization, downgrade, and event order |
| `lib/contracts/chat.ts` | Public `replace` event and stable `SEARCH_UNAVAILABLE` error contract |
| `lib/client/chat-sources.ts` | Pure source merge helper for repeated meta events |
| `components/chat/useMorseChat.ts` | Apply late source metadata and final answer replacement |
| `lib/server/config.ts`, `production-config.ts`, `provider.ts`, `app/api/chat/route.ts` | Backend configuration and route wiring |
| `scripts/mock-openai.mjs`, `scripts/s10-chat-smoke.mjs` | Native search Mock and browser acceptance |
| Existing tests plus `tests/native-web-search.test.ts`, `tests/chat-sources.test.ts` | Failure-first coverage without new test dependencies |

### Task 1: Replace Boolean Search Routing With a Privacy-Aware Mode Contract

**Files:**
- Modify: `lib/server/search-router.ts`
- Modify: `lib/server/chat-service.ts`
- Modify: `tests/search-router.test.ts`
- Modify: `tests/chat-service-integration.test.ts`

- [ ] **Step 1: Write failing tests for the new decision shape and strict priority**

Replace assertions on `shouldSearch/query` with `mode/minimalQuery/quotaLimit`, and add the exact boundary cases:

```ts
assert.deepEqual(routeSearch({
  question: '请核验摩斯今天最新的工作经历',
  workflow: 'chat',
  searchEnabled: true,
  searchCount: 0,
  localEvidenceSufficient: false,
}), {
  mode: 'disabled',
  minimalQuery: null,
  reason: 'personal_fact_veto',
  quotaLimit: 1,
});

assert.deepEqual(routeSearch({
  question: 'OpenAI Responses API 当前版本是什么？',
  workflow: 'chat',
  searchEnabled: true,
  searchCount: 0,
  localEvidenceSufficient: false,
}), {
  mode: 'required',
  minimalQuery: 'OpenAI Responses API 当前版本是什么？',
  reason: 'recency',
  quotaLimit: 1,
});

assert.deepEqual(routeSearch({
  question: '请核验 OpenAI Responses API 官方文档',
  workflow: 'chat',
  searchEnabled: true,
  searchCount: 1,
  localEvidenceSufficient: false,
}), {
  mode: 'required',
  minimalQuery: 'OpenAI Responses API 官方文档',
  reason: 'explicit_verification',
  quotaLimit: 2,
});
```

Add table cases that require `workflow_veto` for `jd_match` and `diagnosis`, `sensitive_content_veto` for emails, phone numbers, API keys, Cookies, and text longer than 2000 characters, `quota_exhausted` at automatic count 1 and explicit count 2, and `auto` only for external insufficient evidence. Add one mixed question where the personal clause is removed and the external clause remains:

```ts
assert.equal(routeSearch({
  ...baseInput,
  question: '摩斯做过哪些项目？同时请查 OpenAI API 最新版本。',
}).minimalQuery, 'OpenAI API 最新版本');
```

- [ ] **Step 2: Run the focused router test and confirm RED**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/search-router.test.ts
```

Expected: FAIL because the returned object still uses `shouldSearch/query` and does not accept `workflow`.

- [ ] **Step 3: Implement the exact mode and minimal-query contract**

Use these exported types and priority order:

```ts
export type WebSearchMode = 'disabled' | 'auto' | 'required';
export type SearchWorkflow = 'chat' | 'jd_match' | 'diagnosis';

export interface SearchRouteInput {
  question: string;
  workflow: SearchWorkflow;
  searchEnabled: boolean;
  searchCount: number;
  localEvidenceSufficient: boolean;
  explicitVerification?: boolean;
}

export type SearchRouteReason =
  | 'personal_fact_veto'
  | 'workflow_veto'
  | 'sensitive_content_veto'
  | 'disabled'
  | 'quota_exhausted'
  | 'explicit_verification'
  | 'recency'
  | 'external_technical'
  | 'local_sufficient'
  | 'local_insufficient';

export interface SearchRouteDecision {
  mode: WebSearchMode;
  minimalQuery: string | null;
  reason: SearchRouteReason;
  quotaLimit: 1 | 2;
}
```

Implement `routeSearch` in this order: personal-fact clause split/veto, non-chat workflow veto, sensitive-content veto, kill switch, explicit verification with limit 2, automatic quota limit 1, recency required, external technical auto, local sufficient disabled, local insufficient auto. `minimalQuery` must collapse whitespace, remove verification filler (`请核验`, `请查证`, `verify`, `fact-check`), discard clauses recognized as Morse personal facts, trim punctuation, and cap the result at 240 Unicode code points. If nothing safe remains, return `sensitive_content_veto`.

Use explicit detection constants rather than a model call:

```ts
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const phonePattern = /(?:\+?86[-\s]?)?1[3-9]\d{9}/u;
const credentialPattern = /(?:api[_ -]?key|secret|token|password|cookie|authorization)\s*[:=]/iu;
const MAX_SEARCHABLE_QUESTION_CODE_POINTS = 2000;
const MAX_MINIMAL_QUERY_CODE_POINTS = 240;
```

Adapt the existing Bocha call site in `chat-service.ts` in the same commit so the repository remains type-correct: pass `workflow: requestWorkflow(input.request)`, treat `route.mode !== 'disabled'` as the old search condition, use `route.minimalQuery` as the claimed query, and keep the existing Bocha quota/config behavior until Task 7 introduces backend-specific limits.

- [ ] **Step 4: Run router tests and confirm GREEN**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/search-router.test.ts tests/chat-service-integration.test.ts
```

Expected: PASS with personal facts taking priority over recency and explicit verification, and no test invoking a model.

- [ ] **Step 5: Commit the routing contract**

```powershell
git add -- lib/server/search-router.ts lib/server/chat-service.ts tests/search-router.test.ts tests/chat-service-integration.test.ts
git commit -m "feat: define native search routing policy"
```

### Task 2: Add Native Backend Configuration Without Weakening Bocha Compatibility

**Files:**
- Modify: `lib/server/config.ts`
- Modify: `lib/server/production-config.ts`
- Modify: `lib/server/provider.ts`
- Modify: `lib/server/chat-service.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `tests/config.test.ts`
- Modify: `tests/production-config.test.ts`
- Modify: `tests/search-provider.test.ts`

- [ ] **Step 1: Write failing configuration tests**

Add assertions for a Responses-native configuration:

```ts
const native = loadServerConfig({
  ...completeEnv,
  OPENAI_CHAT_PROTOCOL: 'responses',
  MORSE_SEARCH_ENABLED: 'true',
  MORSE_SEARCH_PROVIDER: 'native',
  MORSE_MAX_SEARCHES_PER_SESSION: '2',
});
assert.equal(native.searchProvider, 'native');
assert.equal(native.maxSearchesPerSession, 2);
assert.equal(native.bochaApiKey, null);
assert.equal(native.bochaBaseUrl, null);
```

Add rejects for `native + chat_completions`, quotas above 2, and unknown Provider values. Keep the existing Bocha key/base tests. Change the disabled default assertion from 5 to 2. In `tests/search-provider.test.ts`, prove `createSearchProvider(native) === null` and Bocha still constructs only for `bocha`.

In `tests/production-config.test.ts`, add one Web-role PASS for native Responses and one failure with code `PRODUCTION_NATIVE_SEARCH_REQUIRES_RESPONSES` for Chat Completions.

- [ ] **Step 2: Run configuration tests and confirm RED**

```powershell
node --env-file-if-exists=.env.local --test tests/config.test.ts tests/production-config.test.ts tests/search-provider.test.ts
```

Expected: FAIL because only `bocha` is accepted and the default/maximum is still 5.

- [ ] **Step 3: Implement the discriminated backend settings**

Change `searchSettings` to return one of three shapes:

```ts
type SearchSettings =
  | { searchEnabled: false; searchProvider: null; bochaApiKey: null; bochaBaseUrl: null }
  | { searchEnabled: true; searchProvider: 'native'; bochaApiKey: null; bochaBaseUrl: null }
  | { searchEnabled: true; searchProvider: 'bocha'; bochaApiKey: string; bochaBaseUrl: string };
```

Set `MORSE_MAX_SEARCHES_PER_SESSION` fallback and maximum to 2. When enabled, accept only `native` and `bocha`; require Responses for native and require Bocha secrets only for Bocha. Keep trust-domain and timeout settings common.

In `validateWeb`, add:

```ts
if (
  env.MORSE_SEARCH_ENABLED?.trim() === 'true'
  && env.MORSE_SEARCH_PROVIDER?.trim() === 'native'
  && env.OPENAI_CHAT_PROTOCOL?.trim() !== 'responses'
) fail('PRODUCTION_NATIVE_SEARCH_REQUIRES_RESPONSES');
```

Do not create a second native provider object. `createProvider(config)` already owns the Responses client and compatible `User-Agent`; `createSearchProvider(config)` remains Bocha-only.

- [ ] **Step 4: Wire the backend value into chat-service configuration**

In `app/api/chat/route.ts`, pass:

```ts
searchBackend: config.searchProvider,
searchEnabled: config.searchEnabled,
maxSearchesPerSession: config.maxSearchesPerSession,
officialSourceDomains: config.officialSourceDomains,
officialGithubOwners: config.officialGithubOwners,
```

Add matching fields to `ChatServiceConfig` in the same commit:

```ts
searchBackend?: 'native' | 'bocha' | null;
officialSourceDomains?: string[];
officialGithubOwners?: string[];
```

- [ ] **Step 5: Run configuration tests and confirm GREEN**

Run the command from Step 2.

Expected: PASS; disabled search requires no Bocha values, native requires Responses, and Bocha tests remain unchanged.

- [ ] **Step 6: Commit backend configuration**

```powershell
git add -- lib/server/config.ts lib/server/production-config.ts lib/server/provider.ts lib/server/chat-service.ts app/api/chat/route.ts tests/config.test.ts tests/production-config.test.ts tests/search-provider.test.ts
git commit -m "feat: configure native search backend"
```

### Task 3: Normalize Responses Web Search Events in the AI Provider

**Files:**
- Modify: `lib/server/ai-provider.ts`
- Modify: `lib/server/openai-provider.ts`
- Modify: `tests/openai-provider.test.ts`

- [ ] **Step 1: Add failing request-body and event-sequence tests**

Add an `AnswerRequest.webSearch` fixture:

```ts
webSearch: {
  mode: 'required',
  minimalQuery: 'OpenAI Responses API 当前版本',
  routeReason: 'explicit_verification',
},
```

Make the fake Responses stream emit this order:

```ts
yield { type: 'response.web_search_call.in_progress', item_id: 'ws_1', output_index: 0 };
yield { type: 'response.web_search_call.searching', item_id: 'ws_1', output_index: 0 };
yield {
  type: 'response.output_text.delta',
  delta: '当前版本已发布。',
  item_id: 'msg_1', output_index: 1, content_index: 0,
};
yield {
  type: 'response.output_text.annotation.added',
  item_id: 'msg_1', output_index: 1, content_index: 0, annotation_index: 0,
  annotation: {
    type: 'url_citation', start_index: 0, end_index: 8,
    url: 'https://openai.com/news', title: 'OpenAI News',
  },
};
yield {
  type: 'response.completed',
  response: {
    output: [{
      type: 'web_search_call', id: 'ws_1', status: 'completed',
      action: {
        type: 'search', queries: ['OpenAI Responses API current version'],
        sources: [{ type: 'url', url: 'https://openai.com/news', title: 'OpenAI News' }],
      },
    }],
    usage: { input_tokens: 200, output_tokens: 30 },
  },
};
```

Assert the normalized events are exactly `web_search_started`, `delta`, `citation`, `web_search_completed`, `done`, with `web_search_started` emitted only once.

Assert the request body contains:

```ts
tools: [{ type: 'web_search', search_context_size: 'low' }],
tool_choice: 'required',
max_tool_calls: 1,
include: ['web_search_call.action.sources'],
```

and does not contain `return_token_budget`, `user_location`, image settings, shell, MCP, or Skills fields. Add a second test proving `auto` maps to `tool_choice: 'auto'`; an ordinary request must retain the exact old body without any search fields.

- [ ] **Step 2: Run the Provider test and confirm RED**

```powershell
node --env-file-if-exists=.env.local --test tests/openai-provider.test.ts
```

Expected: FAIL because `AnswerRequest` rejects `webSearch`, the request lacks tools, and the new events are ignored.

- [ ] **Step 3: Define Provider-neutral request and event types**

Add to `lib/server/ai-provider.ts`:

```ts
export interface NativeWebSearchRequest {
  mode: 'auto' | 'required';
  minimalQuery: string;
  routeReason: SearchRouteReason;
}

export interface NativeWebSearchSource {
  url: string;
  title: string;
}

export interface NativeWebCitation {
  startIndex: number;
  endIndex: number;
  url: string;
  title: string;
}
```

Extend `AnswerRequest` with `webSearch?: NativeWebSearchRequest` and `AnswerEvent` with:

```ts
| { type: 'web_search_started'; callId: string }
| { type: 'web_search_completed'; callId: string; queries: string[]; sources: NativeWebSearchSource[] }
| ({ type: 'citation' } & NativeWebCitation)
```

Import `SearchRouteReason` as a type only.

- [ ] **Step 4: Implement Responses request fields and event normalization**

In `streamResponses`, spread search fields only when `request.webSearch` exists:

```ts
...(request.webSearch ? {
  tools: [{ type: 'web_search' as const, search_context_size: 'low' as const }],
  tool_choice: request.webSearch.mode === 'required' ? 'required' as const : 'auto' as const,
  max_tool_calls: 1,
  include: ['web_search_call.action.sources' as const],
} : {}),
```

Track `startedCallIds`, `citations`, and completed calls. Normalize `url_citation` annotations immediately. On `response.completed`, inspect `response.output` structurally, emit any missing start event, extract `action.queries` or legacy singular `action.query`, collect only string URL/title pairs, then emit one completed event per call. Keep raw Provider objects out of application events and logs.

- [ ] **Step 5: Make tool activity stop outputless retries**

In `OpenAIProvider.streamAnswer`, replace the delta-only idea of output with irreversible activity:

```ts
if (next.value.type !== 'done') irreversibleActivity = true;
yield next.value;
```

The retry condition must require `!irreversibleActivity`. This ensures a search event without text cannot repeat on the same node.

- [ ] **Step 6: Run Provider tests and confirm GREEN**

Run the command from Step 2.

Expected: PASS, including old Responses and Chat Completions tests with unchanged non-search bodies.

- [ ] **Step 7: Commit Provider event support**

```powershell
git add -- lib/server/ai-provider.ts lib/server/openai-provider.ts tests/openai-provider.test.ts
git commit -m "feat: stream native web search events"
```

### Task 4: Make Search Activity Non-Replayable Across Provider Nodes

**Files:**
- Modify: `lib/server/failover-ai-provider.ts`
- Modify: `tests/failover-provider.test.ts`

- [ ] **Step 1: Write failing failover tests for a tool-only partial response**

Add a primary that yields a tool event and then fails:

```ts
const primary = new FakeProvider([
  { type: 'web_search_started', callId: 'ws_1' },
], new OpenAIProviderError('PROVIDER_STREAM_FAILED'));
const fallback = new FakeProvider([
  { type: 'delta', text: 'must not run' },
  { type: 'done', usage: null },
]);
```

Assert the error escapes, the only observed event is `web_search_started`, and the fallback call count is zero. Add equivalent cases where the first irreversible event is `citation` or `web_search_completed`, protecting against malformed gateways that omit the start event.

- [ ] **Step 2: Run the failover test and confirm RED**

```powershell
node --env-file-if-exists=.env.local --test tests/failover-provider.test.ts
```

Expected: FAIL because failover currently treats only `delta` as output.

- [ ] **Step 3: Implement the irreversible-event predicate**

Add:

```ts
function isIrreversibleAnswerEvent(event: AnswerEvent): boolean {
  return event.type === 'delta'
    || event.type === 'web_search_started'
    || event.type === 'web_search_completed'
    || event.type === 'citation';
}
```

Set `irreversibleActivity` before yielding each matching event. Permit the next node only when it remains false. Continue accumulating usage from failures that occurred before irreversible activity.

- [ ] **Step 4: Run failover tests and confirm GREEN**

Run the command from Step 2.

Expected: PASS for old text behavior and new tool-only behavior.

- [ ] **Step 5: Commit the failover boundary**

```powershell
git add -- lib/server/failover-ai-provider.ts tests/failover-provider.test.ts
git commit -m "fix: prevent replay after search starts"
```

### Task 5: Build a Pure Native Source and Citation Finalizer

**Files:**
- Create: `lib/server/native-web-search.ts`
- Create: `tests/native-web-search.test.ts`
- Modify: `lib/server/search-safety.ts`
- Modify: `tests/search-safety.test.ts`

- [ ] **Step 1: Write failing source and citation tests**

Define tests against one pure entry point:

```ts
const result = finalizeNativeWebSearch({
  answer: 'OpenAI 已发布新版。',
  sources: [
    { url: 'https://openai.com/news', title: 'OpenAI News' },
    { url: 'https://127.0.0.1/private', title: 'Private' },
  ],
  citations: [{
    startIndex: 0,
    endIndex: 6,
    url: 'https://openai.com/news',
    title: 'OpenAI News',
  }],
  trust: { officialDomains: ['openai.com'], githubOwners: [] },
});

assert.equal(result.answer, 'OpenAI[来源1] 已发布新版。');
assert.deepEqual(result.results.map(({ href, kind }) => ({ href, kind })), [{
  href: 'https://openai.com/news',
  kind: 'official',
}]);
assert.equal(result.invalidCitationCount, 0);
```

Add cases for Chinese plus Emoji code points, duplicate URLs, two citations ending at the same position, adjacent citations, more than five sources, credentialed/private URLs, negative/overlong/overlapping indices, and a citation URL absent from the full source list. Invalid ranges must never produce an anchor marker and must increment `invalidCitationCount`.

- [ ] **Step 2: Run the new test and confirm RED**

```powershell
node --env-file-if-exists=.env.local --test tests/native-web-search.test.ts tests/search-safety.test.ts
```

Expected: FAIL because `native-web-search.ts` and the native candidate adapter do not exist.

- [ ] **Step 3: Reuse the existing URL trust boundary**

Export a small candidate type from `search-safety.ts` only if TypeScript requires it, and feed native sources through the existing `sanitizeSearchCandidates` by mapping:

```ts
const candidates = rawSources.map((source) => ({
  name: source.title,
  url: source.url,
  snippet: '',
}));
```

Do not create a second URL validator or source classifier. Preserve the existing stable SHA-256 source IDs and five-result cap.

- [ ] **Step 4: Implement code-point-safe citation insertion**

Create:

```ts
export interface FinalizedNativeWebSearch {
  answer: string;
  results: SearchResult[];
  invalidCitationCount: number;
}

export function finalizeNativeWebSearch(input: {
  answer: string;
  sources: NativeWebSearchSource[];
  citations: NativeWebCitation[];
  trust: SearchTrustConfig;
}): FinalizedNativeWebSearch;
```

Build the source candidate order from citations first, then full sources, so the five-item cap cannot hide an inline citation. Use `Array.from(input.answer)` for Unicode code points. Reject citations unless `0 <= startIndex < endIndex <= codePoints.length`; reject overlapping ranges unless they are exact duplicates. Map each valid normalized URL to its sanitized result index, collect marker insertions by `endIndex`, sort insertions descending, and insert unique `[来源N]` markers. Return original text plus safe bottom sources when every range is invalid.

- [ ] **Step 5: Run citation and safety tests and confirm GREEN**

Run the command from Step 2.

Expected: PASS; unsafe URLs never survive in `results` or markers.

- [ ] **Step 6: Commit the pure finalizer**

```powershell
git add -- lib/server/native-web-search.ts lib/server/search-safety.ts tests/native-web-search.test.ts tests/search-safety.test.ts
git commit -m "feat: finalize native search citations"
```

### Task 6: Add Atomic Release and Actual-Query Finalization to Search Persistence

**Files:**
- Modify: `lib/server/interaction-search.ts`
- Modify: `tests/interaction-search-integration.test.ts`

- [ ] **Step 1: Write failing integration tests for unused claims**

After a successful `claimSearch`, call the new function twice:

```ts
await releaseUnusedSearchClaim({
  pool,
  accessSessionId,
  turnId,
});
await releaseUnusedSearchClaim({
  pool,
  accessSessionId,
  turnId,
});
```

Assert exactly:

```ts
{ search_count: 0, search_rows: 0, used_search: false }
```

Add cases proving it refuses a foreign session, leaves `completed` and `failed` rows/counts unchanged, recovers from commit acknowledgement loss by reading durable state, and cannot decrement below zero.

Add a completion test:

```ts
await finalizeSearchCompleted({
  pool,
  turnId,
  query: 'OpenAI Responses API current version',
  results: safeResults,
});
```

Assert the provisional query is replaced atomically and a repeated finalization cannot replace a terminal row.

- [ ] **Step 2: Run the database integration test and confirm RED**

```powershell
node --env-file-if-exists=.env.local --test tests/interaction-search-integration.test.ts
```

Expected: FAIL because `releaseUnusedSearchClaim` and final query replacement do not exist. If the configured disposable PostgreSQL is unavailable, record that environment blocker and do not mark this task GREEN from unit tests.

- [ ] **Step 3: Implement idempotent unused-claim release**

Export:

```ts
export async function releaseUnusedSearchClaim(input: {
  pool: Pool;
  client?: PoolClient;
  accessSessionId: string;
  turnId: string;
}): Promise<'released' | 'already_terminal' | 'missing'>;
```

Within one transaction:

1. Lock the session row by `accessSessionId`.
2. Lock the turn and verify it belongs to that session.
3. Delete only `interaction_searches` with this turn and `status='pending'`, using `RETURNING id`.
4. If deleted, run `UPDATE access_sessions SET search_count = GREATEST(search_count - 1, 0)` and `UPDATE interaction_turns SET used_search=false`.
5. If a terminal row exists, return `already_terminal`; if no row exists, return `missing`.

Follow the existing claim function's commit-ambiguity pattern: destroy an owned uncertain client, then read durable state from the pool before deciding whether release succeeded.

- [ ] **Step 4: Permit actual query replacement only during pending finalization**

Extend the private finalizer input with `query?: string` and update:

```sql
SET query = COALESCE($5, query),
    status = $2,
    results = $3::jsonb,
    error_code = $4
WHERE interaction_turn_id = $1
  AND status = 'pending'
```

Keep stored `results` as the existing array shape; do not add a migration or raw Provider payload column.

- [ ] **Step 5: Run persistence tests and confirm GREEN**

Run the command from Step 2.

Expected: PASS with zero skipped integration tests when the disposable database is available.

- [ ] **Step 6: Commit persistence support**

```powershell
git add -- lib/server/interaction-search.ts tests/interaction-search-integration.test.ts
git commit -m "feat: manage native search reservations"
```

### Task 7: Orchestrate Native Search in the Chat Service

**Files:**
- Modify: `lib/server/chat-service.ts`
- Modify: `lib/server/chat-core.ts`
- Modify: `lib/contracts/chat.ts`
- Modify: `lib/client/chat-errors.ts`
- Modify: `tests/chat-service-integration.test.ts`
- Modify: `tests/chat-contract.test.ts`
- Modify: `tests/chat-core.test.ts`

- [ ] **Step 1: Add a stable non-recoverable public search error**

Update contract tests first so `SEARCH_UNAVAILABLE` is in `CHAT_ERROR_CODES` and `CHAT_SERVICE_ERROR_CODES`, but not in `RECOVERABLE_CHAT_ERROR_CODES`. Add the exact public message test:

```ts
assert.equal(
  publicErrorMessage('SEARCH_UNAVAILABLE'),
  '暂时无法核验最新信息，本次未扣减对话次数。请稍后重新明确发起核验。',
);
```

This intentionally prevents the existing same-turn retry button after a paid search may have started; the user must send a new explicit request.

- [ ] **Step 2: Add failing native chat integration fixtures**

Create a fake AI Provider whose `streamAnswer` emits native events. Cover these named scenarios:

1. `native required success`: start, text delta, citation, completed sources/query, done.
2. `native auto unused`: text and done with no tool event; reservation is released.
3. `native required unused`: text and done with no tool event; turn fails `SEARCH_UNAVAILABLE`, reservation is released, no assistant history is saved.
4. `native unsafe sources`: private URL plus safe URL; only safe URL appears in meta, stored results, answer marker, and history replay.
5. `native no valid citation`: tool starts but every annotation/source is unsafe; search is failed and its quota remains consumed.
6. `native abort before start`: pending claim is released.
7. `native abort after start`: claim remains, search row becomes failed with `CLIENT_ABORTED`.
8. `native Provider failure after start`: no second AI Provider request and search row becomes failed.
9. `bocha compatibility`: existing pre-search result injection and audit continue when backend is `bocha`.

For success, assert the event order:

```ts
[
  'status', 'status', 'status',
  'meta', 'status',
  'delta',
  'meta', 'replace', 'done',
]
```

Assert the final stored answer contains `[来源N]`, the early meta contains local sources only, the late meta contains local plus web sources, `search_count === 1`, `used_search === true`, and the actual query replaces the provisional query.

- [ ] **Step 3: Run contract and chat integration tests and confirm RED**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-contract.test.ts tests/chat-core.test.ts tests/chat-service-integration.test.ts
```

Expected: FAIL because the service still performs Bocha before answering and cannot consume native events.

- [ ] **Step 4: Separate Bocha resolution from native reservation**

Rename the existing `resolveSearch` to `resolveBochaSearch` without changing its tested behavior. Add:

```ts
type EnabledSearchDecision = SearchRouteDecision & {
  mode: 'auto' | 'required';
  minimalQuery: string;
};

interface NativeSearchExecution {
  decision: EnabledSearchDecision;
  claimed: boolean;
  started: boolean;
  callId: string | null;
  queries: string[];
  rawSources: NativeWebSearchSource[];
  citations: NativeWebCitation[];
}
```

Before answering, when `searchBackend === 'native'`:

1. Call `routeSearch` with the real workflow.
2. If disabled, do not claim and omit `AnswerRequest.webSearch`.
3. If enabled, `claimSearch` using `decision.minimalQuery`, `decision.reason`, and `decision.quotaLimit`.
4. If quota is exhausted for a required decision, throw `SEARCH_UNAVAILABLE`; an automatic decision may continue without the tool.
5. Send the early meta with local sources, then enter `answering`.

Keep Bocha as the only branch that invokes `SearchProvider.search` before the answer. Never activate both backends in one turn.

- [ ] **Step 5: Consume normalized native events in the answer loop**

Pass this only for a claimed native plan:

```ts
webSearch: {
  mode: execution.decision.mode,
  minimalQuery: execution.decision.minimalQuery,
  routeReason: execution.decision.reason,
},
```

In the event loop:

```ts
if (event.type === 'web_search_started') {
  execution.started = true;
  execution.callId ??= event.callId;
  continue;
}
if (event.type === 'web_search_completed') {
  execution.started = true;
  execution.callId ??= event.callId;
  execution.queries.push(...event.queries);
  execution.rawSources.push(...event.sources);
  continue;
}
if (event.type === 'citation') {
  execution.started = true;
  execution.citations.push(event);
  continue;
}
```

Continue streaming only `delta`. At `done`:

- No tool start: release the claim. `auto` completes normally; `required` throws `SEARCH_UNAVAILABLE` before `completeTurn`.
- Tool started: call `finalizeNativeWebSearch`. Require at least one safe inline citation and source; otherwise finalize failed and throw `SEARCH_UNAVAILABLE`.
- Success: finalize search with the actual joined/capped query, append safe web sources to local sources, replace `answer` with finalized text, yield late `meta`, then yield `{ type:'replace', text: answer }`, then persist and yield `done`.

Use the first distinct actual query strings, joined by ` | ` and capped at 1000 code points. Do not store raw output items.

- [ ] **Step 6: Finalize pending claims on every exit path**

Add one cleanup helper invoked by normal completion, Provider error, abort, and persistence error:

```ts
async function settleNativeSearchFailure(
  execution: NativeSearchExecution | null,
  errorCode: string,
): Promise<void>;
```

If not started, call `releaseUnusedSearchClaim`. If started, call `finalizeSearchFailed` with empty results and the stable internal code. Record search dependency success only after safe cited completion; record failure for timeout, no citations, Provider failure, and abort. Cleanup errors are logged as stable codes and must not replace a visitor abort reason.

- [ ] **Step 7: Keep instructions honest for disabled and failed freshness**

Update `buildSystemInstructions` so native search results are never represented as XML snippets. For a native claimed request, add only the minimal-search constraint:

```text
联网工具仅用于核验外部主题“<minimal query>”。不要把个人履历、JD、联系方式、凭据、站内资料或完整历史写入搜索词。所有时效结论必须有可点击引用；搜索失败时不得根据记忆猜测最新状态。
```

Escape the query with the existing prompt-data helper before insertion. Bocha continues using the existing `<web_search_result>` data format.

- [ ] **Step 8: Run chat tests and confirm GREEN**

Run the command from Step 3.

Expected: PASS for all new native scenarios and all existing Bocha, stop, replay, quota, persistence, diagnosis, and JD tests.

- [ ] **Step 9: Commit native chat orchestration**

```powershell
git add -- lib/server/chat-service.ts lib/server/chat-core.ts lib/contracts/chat.ts lib/client/chat-errors.ts tests/chat-service-integration.test.ts tests/chat-contract.test.ts tests/chat-core.test.ts
git commit -m "feat: orchestrate native search in chat"
```

### Task 8: Support Final Answer Replacement and Late Source Metadata in the Client

**Files:**
- Create: `lib/client/chat-sources.ts`
- Create: `tests/chat-sources.test.ts`
- Modify: `lib/contracts/chat.ts`
- Modify: `components/chat/useMorseChat.ts`
- Modify: `tests/chat-sse.test.ts`
- Modify: `tests/chat-ui-contract.test.ts`
- Modify: `tests/chat-message-format.test.ts`

- [ ] **Step 1: Write failing pure source-merge and SSE tests**

Create a merge test:

```ts
assert.deepEqual(mergeChatSources(
  [{ id: 'local-1', title: 'Local', href: '/', kind: 'local', domain: null, score: 0.9 }],
  [
    { id: 'local-1', title: 'Local', href: '/', kind: 'local', domain: null, score: 0.9 },
    { id: 'web-1', title: 'Docs', href: 'https://openai.com/docs', kind: 'official', domain: 'openai.com', score: null },
  ],
).map((source) => source.id), ['local-1', 'web-1']);
```

Add an SSE sequence test with `meta`, `delta`, second `meta`, `replace`, `done`; `readChatSse` must deliver all five events in order and still reject clean EOF before done.

Update contract tests so `ChatServiceEvent` accepts `{ type:'replace', text:string }` and `ChatSsePayload.text` serves both delta and replace.

- [ ] **Step 2: Run client-focused tests and confirm RED**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-sources.test.ts tests/chat-sse.test.ts tests/chat-ui-contract.test.ts tests/chat-message-format.test.ts
```

Expected: FAIL because the helper and replace contract do not exist.

- [ ] **Step 3: Implement deterministic source merging**

Create:

```ts
export function mergeChatSources(current: ChatSource[], incoming: ChatSource[]): ChatSource[] {
  const merged = new Map(current.map((source) => [source.id, source]));
  for (const source of incoming) merged.set(source.id, source);
  return [...merged.values()];
}
```

Do not merge by title or domain; stable IDs own identity.

- [ ] **Step 4: Apply late meta and replace in `useMorseChat`**

Change the meta branch to:

```ts
sources: mergeChatSources(assistant.sources, payload.sources ?? []),
```

Add before done:

```ts
} else if (event === 'replace') {
  updateAssistant(assistantId, (assistant) => ({
    ...assistant,
    text: payload.text ?? assistant.text,
  }));
```

Do not mark the message complete on replace. `done` remains the only successful terminal client event. Error and stopped states keep their existing behavior.

- [ ] **Step 5: Prove existing citation UI renders finalized markers**

Extend `tests/chat-message-format.test.ts` with final text containing Chinese, Emoji and `[来源1]`. Extend `tests/chat-ui-contract.test.ts` to require the replace branch and `mergeChatSources` import. No visual redesign or CSS change is expected.

- [ ] **Step 6: Run client tests and confirm GREEN**

Run the command from Step 2.

Expected: PASS with no change to ordinary delta-only streams or restored history.

- [ ] **Step 7: Commit SSE client support**

```powershell
git add -- lib/client/chat-sources.ts lib/contracts/chat.ts components/chat/useMorseChat.ts tests/chat-sources.test.ts tests/chat-sse.test.ts tests/chat-ui-contract.test.ts tests/chat-message-format.test.ts
git commit -m "feat: apply late native search citations"
```

### Task 9: Move the Production-Like Mock and Operational Documentation to Native Search

**Files:**
- Modify: `scripts/mock-openai.mjs`
- Modify: `scripts/s10-chat-smoke.mjs`
- Modify: `tests/s10-chat-smoke-contract.test.ts`
- Modify: `scripts/s10-contract.test.mjs`
- Modify: `.env.example`
- Modify: `docs/runbooks/tencent-lighthouse.md`
- Modify: `docs/portfolio-blueprint.md`
- Modify: `docs/task-center/run-state.md`

- [ ] **Step 1: Write failing Mock and smoke contract assertions**

Require `scripts/mock-openai.mjs` to inspect `body.tools`, `body.tool_choice`, `body.max_tool_calls`, and `body.include`. Require the smoke harness to run with:

```js
MORSE_SEARCH_ENABLED: 'true',
MORSE_SEARCH_PROVIDER: 'native',
MORSE_MAX_SEARCHES_PER_SESSION: '2',
```

and forbid `BOCHA_API_KEY`, `BOCHA_BASE_URL`, or a Mock Bocha process in the native scenario. Preserve the standalone Bocha unit/Mock tests as historical compatibility coverage.

- [ ] **Step 2: Run smoke contract tests and confirm RED**

```powershell
node --env-file-if-exists=.env.local --test tests/s10-chat-smoke-contract.test.ts scripts/s10-contract.test.mjs
```

Expected: FAIL because the production-like smoke still starts Mock Bocha.

- [ ] **Step 3: Emit official-shaped native search events from Mock OpenAI**

When a Responses body includes `tools: [{type:'web_search'}]`, emit:

```js
const searchedText = 'OpenAI 当前文档已核验。';
const events = [
  { type: 'response.web_search_call.in_progress', item_id: 'ws_mock_1', output_index: 0 },
  { type: 'response.web_search_call.searching', item_id: 'ws_mock_1', output_index: 0 },
  { type: 'response.output_text.delta', delta: searchedText, item_id: 'msg_1', output_index: 1, content_index: 0 },
  {
    type: 'response.output_text.annotation.added', item_id: 'msg_1', output_index: 1,
    content_index: 0, annotation_index: 0,
    annotation: {
      type: 'url_citation', start_index: 0, end_index: 6,
      url: 'https://openai.com/news', title: 'OpenAI News',
    },
  },
  {
    type: 'response.completed',
    response: {
      output: [{
        type: 'web_search_call', id: 'ws_mock_1', status: 'completed',
        action: {
          type: 'search', queries: ['OpenAI current documentation'],
          sources: [{ type: 'url', url: 'https://openai.com/news', title: 'OpenAI News' }],
        },
      }],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    },
  },
];
```

Keep ordinary non-search Mock responses unchanged. Add deterministic query triggers for required-no-call and search-failed scenarios without printing request payloads.

- [ ] **Step 4: Update browser smoke scenarios**

Replace Bocha success/failure checks with:

- automatic non-search answer has no external source;
- required native success produces a clickable `openai.com` inline citation and external source group;
- required no-call produces the public `SEARCH_UNAVAILABLE` message and no retry button;
- stopping after search start shows stopped state and does not issue a second Responses request;
- session search count moves 0 -> 1 and never exceeds 2.

Keep 1440x900 and 390x844 coverage, console/page error zero, source links opening in a new tab, and existing invitation/history/admin workflows.

- [ ] **Step 5: Run Mock contract tests and focused production-like smoke**

```powershell
node --env-file-if-exists=.env.local --test tests/s10-chat-smoke-contract.test.ts scripts/s10-contract.test.mjs
npm run visual:s10
```

Expected: both commands PASS; the smoke report has `failures: []`. This command uses local Mock services only and must not resolve or call the real Provider hosts.

- [ ] **Step 6: Update example and operational documentation with the disabled production default**

Set `.env.example` to:

```text
MORSE_MAX_SEARCHES_PER_SESSION=2
MORSE_SEARCH_ENABLED=false
MORSE_SEARCH_PROVIDER=native
```

Keep the Bocha key/base variables in a clearly labeled legacy compatibility block, empty by default. Update the runbook to state that deployment must preserve `MORSE_SEARCH_ENABLED=false`; enabling native search requires a separately authorized compatibility smoke and Responses protocol. Update blueprint and run-state with proven local behavior only, explicitly recording `real Provider smoke: not run`, `push: not performed`, and `deployment: not performed`.

- [ ] **Step 7: Commit Mock and operational documentation**

```powershell
git add -- scripts/mock-openai.mjs scripts/s10-chat-smoke.mjs tests/s10-chat-smoke-contract.test.ts scripts/s10-contract.test.mjs .env.example docs/runbooks/tencent-lighthouse.md docs/portfolio-blueprint.md docs/task-center/run-state.md
git commit -m "test: cover native search production flow"
```

### Task 10: Complete Critical Review, Verification, and Local Closeout

**Files:**
- Create after fresh browser evidence: `docs/verify/native-web-search/native-search-desktop-1440x900.png`
- Create after fresh browser evidence: `docs/verify/native-web-search/native-search-mobile-390x844.png`
- Modify only if evidence changes the documented result: `docs/task-center/run-state.md`

- [ ] **Step 1: Run focused tests for every changed boundary**

```powershell
node --env-file-if-exists=.env.local --test tests/search-router.test.ts tests/config.test.ts tests/production-config.test.ts tests/search-provider.test.ts tests/openai-provider.test.ts tests/failover-provider.test.ts tests/native-web-search.test.ts tests/search-safety.test.ts tests/interaction-search-integration.test.ts tests/chat-contract.test.ts tests/chat-core.test.ts tests/chat-service-integration.test.ts tests/chat-sources.test.ts tests/chat-sse.test.ts tests/chat-ui-contract.test.ts tests/chat-message-format.test.ts tests/s10-chat-smoke-contract.test.ts scripts/s10-contract.test.mjs
```

Expected: PASS, zero failures, and zero skipped database integration tests when the configured disposable PostgreSQL is available.

- [ ] **Step 2: Run the complete repository test and build once at stage exit**

```powershell
npm test
npm run build
git diff --check origin/master...HEAD
```

Expected: all tests PASS, Next.js production build PASS, and diff check emits no output. Do not rerun these broad checks unless a subsequent correction invalidates them.

- [ ] **Step 3: Run fresh desktop and mobile acceptance**

Run the local Mock production chain through `npm run visual:s10`, then save the two named screenshots under `docs/verify/native-web-search/`. Inspect both images and the smoke JSON for:

- citation marker visible in the answer and clickable;
- external source domain visible and not clipped;
- streaming-to-replace transition leaves no duplicated sentence;
- no overlap or horizontal overflow at 1440x900 or 390x844;
- console/page errors zero;
- required-no-call error has no same-turn retry action.

If the existing harness does not save exactly these two paths, change only its output path constants and rerun the affected browser smoke.

- [ ] **Step 4: Perform separate CRITICAL reviews**

Compliance review must verify: no secret exposure, no sensitive-content search path, no hosted shell/MCP/Skills tool, no private-resume import, no real Provider host in Mock acceptance, production switch remains false, and no push/deploy occurred.

Quality/safety review must verify: event ordering, citation indices, claim release idempotency, actual-query audit, `required` failure honesty, ordinary-chat regression, tool-start retry prohibition, and full source sanitization.

Record only reproducible findings with file/line evidence. Apply at most three correction rounds; rerun only tests invalidated by each correction and re-review the correction delta.

- [ ] **Step 5: Reconcile documentation with the final evidence**

Update `docs/task-center/run-state.md` only if the final commands, screenshots, or review verdict differ from Task 9's provisional record. The final entry must contain:

```text
Controls: STAGED / CRITICAL / LOCAL
State: LOCAL_READY
Real Provider call: not performed
Production search switch: unchanged and disabled
Push: not performed
Deployment: not performed
```

Run the `neat-freak` knowledge reconciliation required by project rules and record `updated` or `checked-no-change`; do not predict the result before inspection.

- [ ] **Step 6: Commit final evidence and reconciliation**

```powershell
git add -- docs/verify/native-web-search/native-search-desktop-1440x900.png docs/verify/native-web-search/native-search-mobile-390x844.png docs/task-center/run-state.md
git commit -m "docs: record native search acceptance"
```

If `run-state.md` required no change, stage and commit only the two screenshot files. Never use `git add -A` in the shared repository.

- [ ] **Step 7: Run `closeout` and produce the local receipt**

Use the project `closeout` skill with the StagePacket and fresh VerificationReceipt. Confirm:

- branch and exact commit range from `b85d369`;
- intended files only;
- worktree clean after the final commit;
- all required review findings closed;
- verification commands and screenshot paths recorded;
- `KNOWLEDGE_RECONCILED` reached;
- no push, Provider call, or deployment claimed.

Stop at `LOCAL_READY`. Real Provider compatibility smoke, remote synchronization, mainline absorption, and deployment require new explicit authorization and are not execution steps in this plan.
