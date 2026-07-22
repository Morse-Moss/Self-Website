# Chat v2 Response Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把数字 Morse 改造成默认自然交流、按需使用个人证据、在 90 秒内有界完成或诚实失败的数字分身。

**Architecture:** 服务端使用确定性策略路由、结构化能力台账和条件检索，只进行一次最终生成式 LLM 调用。Provider 协调器统一管理 25/40/80/90 秒 deadline、三次 attempt 上限和唯一的守卫重生成；客户端只发送一次请求并显示可停止的非确定等待反馈。

**Tech Stack:** Next.js 16 App Router, TypeScript 6, React 19, Node test runner, PostgreSQL 16 + pgvector, OpenAI-compatible Responses/Chat Completions, SSE, CSS Modules.

---

## Execution Contract

- 设计源：`docs/superpowers/specs/2026-07-22-chat-v2-response-reliability-design.md`。
- Morse 合同：`STAGED / CRITICAL / DEPLOYED`；本计划先证明 `LOCAL_READY`。
- 工作目录：`E:\Revolution\.worktrees\chat-v2-release`，分支 `codex/chat-v2-release`。
- 本计划覆盖语义路由、证据准入、Provider 可靠性、等待 UI 和确定性评测；不修改私密简历域、邀请码权限或 Admin 密钥管理。
- 实现阶段不调用真实 Provider、不扩大 canary、不 push、不部署。真实 20 轮评审、push 和部署分别重新请求授权。
- 每个 Task 只运行列明的 focused tests；Task 9 才运行一次受影响边界测试、构建和 S10 双宽 Mock E2E。
- 每次只暂存列明文件，禁止 `git add .` 和 `git add -A`。

## File Responsibility Map

| File | Responsibility |
| --- | --- |
| `db/migrations/007_chat_response_reliability.sql` | additive 路由锚点与 Provider 时序遥测 |
| `lib/server/chat-route-policy.ts` | 当前问题优先的确定性路由与一轮主题继承 |
| `content/chat-capability-policy.json` | 审核别名、直接能力规范化和显式迁移关系 |
| `lib/server/capability-evidence.ts` | 从公开内容编译能力台账并判定 direct/transferable/none |
| `lib/server/chat-evidence.ts` | 按路由执行 identity/ledger/RAG/web 证据解析与准入 |
| `lib/server/chat-prompt.ts` | 分层人格、回答目标和已准入证据渲染 |
| `lib/server/chat-output-guard.ts` | 路由专属输出守卫和事实边界检查 |
| `lib/server/chat-execution-budget.ts` | 80 秒 Provider deadline、三次 attempt 与 strict 预算 |
| `lib/server/provider-deadline.ts` | 25 秒协议软门槛与 40 秒正文硬门槛 |
| `lib/server/failover-ai-provider.ts` | 串行 attempt、活动事件、切换和赢家锁定 |
| `lib/server/openai-provider.ts` | 区分协议活动与模型正文事件 |
| `lib/server/chat-service.ts` | 组合路由、证据、生成、补偿、SSE 和提交 |
| `components/chat/useMorseChat.ts` | 单请求生命周期、等待秒数、停止和手动重试 |
| `components/chat/ChatPendingState.tsx` | pending assistant 的进度、阶段和等待反馈 |
| `components/chat/ChatTranscript.tsx` | 在 assistant 消息内部承载 pending UI |
| `content/chat-eval.json` | 新路由、证据、话题切换和失败语义用例 |

### Task 1: Freeze Additive Schema, Contracts, and Timing Configuration

**Files:**
- Create: `db/migrations/007_chat_response_reliability.sql`
- Modify: `lib/contracts/chat.ts`
- Modify: `lib/server/ai-provider.ts`
- Modify: `lib/server/config.ts`
- Modify: `.env.example`
- Modify: `tests/schema.test.ts`
- Modify: `tests/config.test.ts`
- Modify: `tests/migration-integration.test.ts`

- [ ] **Step 1: Write failing schema and configuration tests**

```ts
test('migration 007 adds auditable chat routes and provider timing without destructive DDL', () => {
  const sql = fs.readFileSync('db/migrations/007_chat_response_reliability.sql', 'utf8');
  for (const column of [
    'route_kind', 'route_reason_code', 'topic_kind', 'topic_ref',
    'evidence_class', 'inherited_from_turn_id',
    'launch_kind', 'generation_mode', 'first_protocol_event_ms',
    'first_model_text_ms', 'first_user_visible_ms',
  ]) assert.match(sql, new RegExp(column, 'i'));
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)/i);
});

test('v2 timing defaults are bounded and ordered', () => {
  const config = loadServerConfig(completeEnvironment());
  assert.equal(config.providerProtocolEventTimeoutMs, 25_000);
  assert.equal(config.providerModelTextTimeoutMs, 40_000);
  assert.equal(config.providerStageTimeoutMs, 80_000);
  assert.equal(config.chatTurnTimeoutMs, 90_000);
  assert.equal(config.providerMaxAttempts, 3);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/schema.test.ts tests/config.test.ts tests/migration-integration.test.ts
```

Expected: FAIL because migration `007` and the new config fields do not exist.

- [ ] **Step 3: Add the migration and shared contracts**

The migration must be additive and use constrained nullable fields:

```sql
ALTER TABLE interaction_turns
  ADD COLUMN route_kind text CHECK (route_kind IS NULL OR route_kind IN
    ('conversation','external_current','identity','personal_fact','grounded','jd_intake','jd','clarify')),
  ADD COLUMN route_reason_code text CHECK (route_reason_code IS NULL OR route_reason_code ~ '^[a-z0-9_]{1,80}$'),
  ADD COLUMN topic_kind text CHECK (topic_kind IS NULL OR topic_kind IN ('none','external','project','capability','jd')),
  ADD COLUMN topic_ref text CHECK (topic_ref IS NULL OR char_length(topic_ref) BETWEEN 1 AND 160),
  ADD COLUMN evidence_class text CHECK (evidence_class IS NULL OR evidence_class IN
    ('none','identity','web','direct','transferable','mixed','unavailable')),
  ADD COLUMN inherited_from_turn_id uuid REFERENCES interaction_turns(id) ON DELETE SET NULL;

ALTER TABLE interaction_provider_attempts
  ADD COLUMN launch_kind text CHECK (launch_kind IS NULL OR launch_kind IN ('primary','hedge','failover')),
  ADD COLUMN generation_mode text CHECK (generation_mode IS NULL OR generation_mode IN ('normal','strict')),
  ADD COLUMN first_protocol_event_ms integer CHECK (first_protocol_event_ms >= 0),
  ADD COLUMN first_model_text_ms integer CHECK (first_model_text_ms >= 0),
  ADD COLUMN first_user_visible_ms integer CHECK (first_user_visible_ms >= 0);

ALTER TABLE chat_provider_attempts
  ADD COLUMN generation_mode text CHECK (generation_mode IS NULL OR generation_mode IN ('normal','strict')),
  ADD COLUMN first_protocol_event_ms integer CHECK (first_protocol_event_ms >= 0),
  ADD COLUMN first_model_text_ms integer CHECK (first_model_text_ms >= 0),
  ADD COLUMN first_user_visible_ms integer CHECK (first_user_visible_ms >= 0);
```

Add route/evidence unions to `lib/contracts/chat.ts`. Extend `ProviderAttempt` with nullable timing fields plus `launchKind: 'primary' | 'hedge' | 'failover'` and `generationMode`; `hedge` remains readable for old/rollback telemetry even though this release never launches it. Parse the five new env settings with the defaults asserted above and reject configurations unless `protocol < modelText <= providerStage < chatTurn` and `providerMaxAttempts === 3`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests PASS and migration 007 applies to a disposable PostgreSQL database.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- db/migrations/007_chat_response_reliability.sql lib/contracts/chat.ts lib/server/ai-provider.ts lib/server/config.ts .env.example tests/schema.test.ts tests/config.test.ts tests/migration-integration.test.ts
git commit -m "feat: add chat reliability contracts"
```

### Task 2: Build the Approved Capability Ledger

**Files:**
- Create: `content/chat-capability-policy.json`
- Create: `lib/server/capability-evidence.ts`
- Create: `tests/capability-evidence.test.ts`
- Modify: `lib/site-content.ts`

- [ ] **Step 1: Write failing direct, transferable, none, and validation tests**

```ts
test('Kubernetes is not promoted from Docker evidence', () => {
  const ledger = compileCapabilityLedger(siteContent, capabilityPolicy);
  const result = assessCapability('你有 K8s 生产经验吗？', ledger);
  assert.equal(result.capabilityId, 'kubernetes');
  assert.equal(result.evidenceClass, 'transferable');
  assert.deepEqual(result.direct, []);
  assert.ok(result.transferable.some((item) => item.capabilityId === 'docker-compose'));
});

test('Docker Compose remains direct and points to public projects', () => {
  const result = assessCapability(
    '你用过 Docker Compose 吗？',
    compileCapabilityLedger(siteContent, capabilityPolicy),
  );
  assert.equal(result.evidenceClass, 'direct');
  assert.ok(result.direct.some((item) => item.projectSlug === 'digital-morse'));
});

test('policy rejects aliases or source terms absent from public site content', () => {
  assert.throws(
    () => compileCapabilityLedger(siteContent, invalidPolicy),
    /CAPABILITY_POLICY_INVALID/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
node --env-file-if-exists=.env.local --test tests/capability-evidence.test.ts
```

Expected: FAIL because the policy and compiler are missing.

- [ ] **Step 3: Implement canonical aliases and explicit transfer rules**

Use this policy shape; exact public `techStack.items` and `capabilities` are direct `implemented` candidates, while transfer rules are always explicit:

```json
{
  "version": 1,
  "canonical": [
    { "id": "kubernetes", "label": "Kubernetes", "aliases": ["Kubernetes", "K8s"] },
    { "id": "docker", "label": "Docker", "aliases": ["Docker", "Docker 多阶段构建"] },
    { "id": "docker-compose", "label": "Docker Compose", "aliases": ["Docker Compose", "容器化部署"] },
    { "id": "postgresql", "label": "PostgreSQL", "aliases": ["PostgreSQL", "Postgres"] },
    { "id": "rag", "label": "RAG", "aliases": ["RAG", "检索增强生成"] }
  ],
  "transferRules": [
    {
      "target": "kubernetes",
      "from": ["docker", "docker-compose"],
      "allowedWording": "公开项目能确认容器化部署基础，但不能据此确认 Kubernetes 生产实践，建议面谈核实。"
    }
  ]
}
```

Export these stable types and functions:

```ts
export type CapabilityEvidenceClass = 'direct' | 'transferable' | 'none';
export interface CapabilityAssessment {
  capabilityId: string | null;
  label: string | null;
  evidenceClass: CapabilityEvidenceClass;
  direct: CapabilityEvidenceRef[];
  transferable: CapabilityEvidenceRef[];
  boundaryText: string | null;
}
export function compileCapabilityLedger(
  content: SiteContent,
  policy: CapabilityPolicy,
): CapabilityLedger;
export function assessCapability(question: string, ledger: CapabilityLedger): CapabilityAssessment;
```

Normalization is NFKC, case-insensitive and punctuation/space tolerant. It may unify aliases but may not derive transferability, proficiency or production operation from vector similarity.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all capability tests PASS, including a policy mutation that references a missing project term.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- content/chat-capability-policy.json lib/server/capability-evidence.ts lib/site-content.ts tests/capability-evidence.test.ts
git commit -m "feat: add approved capability evidence ledger"
```

### Task 3: Route the Current Question and Persist One-Turn Topic Anchors

**Files:**
- Create: `lib/server/chat-route-policy.ts`
- Create: `tests/chat-route-policy.test.ts`
- Modify: `lib/server/chat-behavior.ts`
- Modify: `lib/server/interaction-log.ts`
- Modify: `tests/chat-behavior.test.ts`
- Modify: `tests/chat-service-integration.test.ts`

- [ ] **Step 1: Write failing route matrix and inheritance tests**

```ts
const cases = [
  ['今天吃饭了吗？', 'conversation', 'none'],
  ['职场里怎么和同事处理分歧？', 'conversation', 'none'],
  ['Next.js 当前最新版本是什么？', 'external_current', 'web'],
  ['Morse 当前有哪些项目？', 'grounded', 'direct'],
  ['Kubernetes 是什么？', 'conversation', 'none'],
  ['你有 Kubernetes 生产经验吗？', 'personal_fact', 'transferable'],
] as const;

for (const [message, routeKind, evidenceClass] of cases) {
  test(message, () => {
    const decision = routeChatTurn({ request: request(message), ledger });
    assert.equal(decision.routeKind, routeKind);
    assert.equal(decision.evidenceClass, evidenceClass);
  });
}

test('only an anaphoric short follow-up inherits one persisted topic', () => {
  const previous = projectAnchor('digital-morse');
  assert.equal(routeChatTurn({ request: request('这个为什么这样设计？'), previous, ledger }).topicRef, 'digital-morse');
  assert.equal(routeChatTurn({ request: request('今天吃什么？'), previous, ledger }).inheritedFromTurnId, null);
});
```

- [ ] **Step 2: Run route tests and verify RED**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-route-policy.test.ts tests/chat-behavior.test.ts tests/chat-service-integration.test.ts
```

Expected: FAIL because the new decision type, route kinds and persisted anchors are absent.

- [ ] **Step 3: Implement the policy and persistence API**

```ts
export interface ChatRouteDecision {
  routeKind: ChatRouteKind;
  reasonCode: string;
  topicKind: ChatTopicKind;
  topicRef: string | null;
  evidenceClass: ChatEvidenceClass;
  inheritedFromTurnId: string | null;
  release: 'segment' | 'complete';
  requiresEmbedding: boolean;
  requiresSearch: boolean;
  deterministicReply: string | null;
}

export interface RouteAnchor {
  turnId: string;
  routeKind: ChatRouteKind;
  topicKind: ChatTopicKind;
  topicRef: string | null;
}
```

Apply precedence in this exact order: explicit workflow/full JD; no-JD fit intake; explicit personal subject plus experience predicate; explicit current/external verification; identity; project fact; stable general conversation; one-turn anaphoric inheritance; clarify. `audienceIntent` changes phrasing only and cannot override the current message.

Add `loadPreviousRouteAnchor(client, conversationId, currentTurnId)` and `recordInteractionRoute(client, turnId, decision)`. A retry of the same turn loads its stored decision instead of re-routing; `topicRef` accepts only project slug, canonical capability ID or `jd`, never raw question/JD text.

- [ ] **Step 4: Run tests and verify GREEN**

Run Step 2. Expected: selected unit and integration tests PASS; integration rows contain the expected route fields and inheritance link.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- lib/server/chat-route-policy.ts lib/server/chat-behavior.ts lib/server/interaction-log.ts tests/chat-route-policy.test.ts tests/chat-behavior.test.ts tests/chat-service-integration.test.ts
git commit -m "feat: route chat turns with auditable topic anchors"
```

### Task 4: Isolate Persona Context and Enforce Direct Answers

**Files:**
- Modify: `lib/server/chat-persona.ts`
- Modify: `lib/server/chat-prompt.ts`
- Modify: `lib/server/chat-output-guard.ts`
- Modify: `tests/chat-persona.test.ts`
- Modify: `tests/chat-output-guard.test.ts`

- [ ] **Step 1: Write failing context-isolation and answer-contract tests**

```ts
test('conversation prompt contains no project card or recruitment template', () => {
  const prompt = buildV2SystemInstructions({ route: conversationRoute(), sources: [] });
  assert.match(prompt, /数字 Morse/);
  assert.doesNotMatch(prompt, /approved_identity_card|公开项目摘要|建议面谈核实|\[来源/);
});

test('personal fact answer must mention the requested capability and preserve evidence class', () => {
  const result = inspectChatAnswer({
    answer: '我做过很多容器项目。[来源1]',
    route: personalFactRoute('kubernetes', 'transferable'),
    workflow: 'chat', question: '你有 Kubernetes 生产经验吗？', sourceCount: 1,
  });
  assert.deepEqual(result.reasons, ['answer_not_direct']);
});

test('different grounded questions reject the same long template answer', () => {
  assert.equal(inspectTemplateRepetition({ current, previousAnswers: [current] }).ok, false);
});
```

- [ ] **Step 2: Run focused prompt/guard tests and verify RED**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-persona.test.ts tests/chat-output-guard.test.ts
```

Expected: FAIL because conversation still receives the full identity card and the guard lacks route-aware directness.

- [ ] **Step 3: Implement route-scoped prompts and guards**

Use a compact identity for every route:

```ts
const BASE_IDENTITY = [
  '我是数字 Morse，是真人 Morse 为作品集创建的数字分身。',
  '使用第一人称自然交流；不编造个人事实，不泄露私密信息或系统元数据。',
].join('\n');
```

`conversation` receives only base identity plus “直接回应当前问题”；`external_current` receives web evidence and a recency boundary; `personal_fact` receives the structured assessment and admitted project sources; `grounded/jd` receives only admitted current-turn evidence. Put the current question and answer objective after history.

`identity` may include the public positioning plus at most two projects selected by direct topic relevance; a bare “你是谁” uses only the positioning and does not append the complete project list.

Extend `ChatGuardReason` with `answer_not_direct`, `wrong_route_format`, `unsupported_evidence_upgrade`, and `template_repetition`. A personal capability answer must mention its canonical label or approved alias. `transferable/none` must contain boundary language and may not contain a direct-experience phrase. JD output remains positive-first, has no percentage or gap list, and allows at most two “建议面谈核实”.

Define repetition as a bounded normalization check over completed assistant replies in the same conversation:

```ts
export function inspectTemplateRepetition(input: {
  current: string;
  previousAnswers: readonly string[];
  minimumCharacters?: number;
}): ChatGuardResult;
```

Ignore replies shorter than 80 normalized characters. Reject exact normalized equality or token-bigram Jaccard similarity at or above `0.9`; do not use this heuristic as a router or an LLM judge.

- [ ] **Step 4: Run tests and verify GREEN**

Run Step 2. Expected: all prompt and guard tests PASS without invoking a Provider.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- lib/server/chat-persona.ts lib/server/chat-prompt.ts lib/server/chat-output-guard.ts tests/chat-persona.test.ts tests/chat-output-guard.test.ts
git commit -m "feat: isolate chat persona and evidence prompts"
```

### Task 5: Resolve Only the Evidence Required by the Route

**Files:**
- Create: `lib/server/chat-evidence.ts`
- Create: `tests/chat-evidence.test.ts`
- Modify: `lib/server/public-knowledge.ts`
- Modify: `scripts/ingest-knowledge.mjs`
- Modify: `lib/server/rag.ts`
- Modify: `lib/server/chat-service.ts`
- Modify: `lib/server/chat-safe-answer.ts`
- Modify: `tests/rag-integration.test.ts`
- Modify: `tests/chat-service-integration.test.ts`
- Modify: `tests/chat-safe-answer.test.ts`

- [ ] **Step 1: Write failing route-to-dependency and fallback tests**

```ts
test('conversation resolves no evidence dependency', async () => {
  const calls = dependencySpies();
  const result = await resolveChatEvidence({ route: conversationRoute(), ...calls });
  assert.deepEqual(result, { knowledge: [], search: undefined, capability: null });
  assert.deepEqual(calls.counts(), { embed: 0, retrieve: 0, search: 0 });
});

test('external current searches without personal RAG', async () => {
  const calls = dependencySpies();
  await resolveChatEvidence({ route: externalRoute(), ...calls });
  assert.deepEqual(calls.counts(), { embed: 0, retrieve: 0, search: 1 });
});

test('personal capability never uses web and admits only ledger-backed sources', async () => {
  const result = await resolveChatEvidence({
    route: kubernetesPersonalRoute(), ...dependencySpies(),
  });
  assert.equal(result.capability?.evidenceClass, 'transferable');
  assert.equal(result.search, undefined);
  assert.ok(result.knowledge.every((source) => source.documentId.startsWith('project-')));
});

test('provider failure produces no local project-summary answer', async () => {
  const events = await collect(runChat(providerFailureInput()));
  assert.equal(events.some((event) => event.type === 'delta' && /项目|系统/.test(event.text)), false);
  assert.equal(events.at(-1)?.type, 'error');
});
```

- [ ] **Step 2: Run focused evidence/service tests and verify RED**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-evidence.test.ts tests/rag-integration.test.ts tests/chat-safe-answer.test.ts tests/chat-service-integration.test.ts
```

Expected: FAIL because every non-identity v2 question still falls through to RAG and Provider failure still exposes safe fallback.

- [ ] **Step 3: Add metadata-aware evidence resolution and no-charge JD intake**

Export one route-owned API:

```ts
export interface ResolvedChatEvidence {
  capability: CapabilityAssessment | null;
  knowledge: KnowledgeSource[];
  search: SearchResponse | undefined;
}

export async function resolveChatEvidence(input: ResolveChatEvidenceInput): Promise<ResolvedChatEvidence>;
```

`public-knowledge.ts` must attach `projectSlug` and normalized topic IDs to each document. `ingest-knowledge.mjs` writes these values into `knowledge_chunks.metadata`; `rag.ts` reads them as nullable metadata so existing production rows remain readable until re-ingest. `filterRelevantKnowledge` keeps the cosine threshold but `admitKnowledgeForRoute` additionally requires a matching project/topic or a direct ledger reference.

Implement the matrix exactly:

```ts
switch (route.routeKind) {
  case 'conversation': case 'clarify': case 'jd_intake': return emptyEvidence();
  case 'identity': return identityEvidence();
  case 'external_current': return webOnlyEvidence();
  case 'personal_fact': return capabilityLedgerEvidence();
  case 'grounded': case 'jd': return admittedRagEvidence();
}
```

In `chat-service.ts`, complete `jd_intake` with a deterministic “请提供完整 JD” assistant message, `consumed: false`, no Embedding/Search/Chat Provider, and quota compensation. Remove `buildSafeChatAnswer` from automatic Provider failure handling; keep `MORSE_CHAT_SAFE_MODE` as the only explicit operator path.

- [ ] **Step 4: Run tests and verify GREEN**

Run Step 2. Expected: selected tests PASS; dependency spies prove the exact call matrix and Provider failure leaves no completed assistant fallback.

- [ ] **Step 5: Commit Task 5**

```powershell
git add -- lib/server/chat-evidence.ts tests/chat-evidence.test.ts lib/server/public-knowledge.ts scripts/ingest-knowledge.mjs lib/server/rag.ts lib/server/chat-service.ts lib/server/chat-safe-answer.ts tests/rag-integration.test.ts tests/chat-service-integration.test.ts tests/chat-safe-answer.test.ts
git commit -m "feat: resolve chat evidence by route"
```

### Task 6: Share One Provider Budget Across Normal, Strict, and Failover

**Files:**
- Create: `lib/server/chat-execution-budget.ts`
- Create: `tests/chat-execution-budget.test.ts`
- Modify: `lib/server/chat-answer-runner.ts`
- Modify: `lib/server/failover-ai-provider.ts`
- Modify: `lib/server/chat-service.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `tests/chat-answer-runner.test.ts`
- Modify: `tests/failover-provider.test.ts`
- Modify: `tests/chat-route-stream.test.ts`

- [ ] **Step 1: Write failing shared-budget and strict-trigger tests**

```ts
test('normal, strict and failover share three attempts and one absolute deadline', () => {
  const budget = createChatExecutionBudget({
    turnStartedAtMs: 1_000, providerStartedAtMs: 1_000,
    turnTimeoutMs: 90_000, providerTimeoutMs: 80_000, maxAttempts: 3,
  });
  assert.equal(budget.reserveAttempt(1_000), true);
  assert.equal(budget.reserveAttempt(2_000), true);
  assert.equal(budget.reserveAttempt(3_000), true);
  assert.equal(budget.reserveAttempt(4_000), false);
  assert.equal(budget.remainingMs(40_000), 41_000);
});

test('network and timeout errors do not start strict generation', async () => {
  for (const error of [new ProviderRunError('PROVIDER_UNAVAILABLE', []), timeoutError()]) {
    const strictCalls: boolean[] = [];
    await assert.rejects(() => drain(runGuardedChatAnswer(runnerInput(error, strictCalls))));
    assert.deepEqual(strictCalls, [false]);
  }
});

test('only output guard rejection may consume the remaining strict attempt', async () => {
  const calls: boolean[] = [];
  await drain(runGuardedChatAnswer(guardRejectedThenAccepted(calls)));
  assert.deepEqual(calls, [false, true]);
});

test('the 90 second turn deadline caps routing, retrieval and the provider remainder', async () => {
  const budget = createChatExecutionBudget({
    turnStartedAtMs: 0, providerStartedAtMs: 15_000,
    turnTimeoutMs: 90_000, providerTimeoutMs: 80_000, maxAttempts: 3,
  });
  assert.equal(budget.providerDeadlineMs(), 90_000);
  assert.equal(budget.remainingMs(15_000), 75_000);
});
```

- [ ] **Step 2: Run execution tests and verify RED**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-execution-budget.test.ts tests/chat-answer-runner.test.ts tests/failover-provider.test.ts tests/chat-route-stream.test.ts
```

Expected: FAIL because strict currently receives a fresh timeout and `canRegenerateAnswer` accepts Provider/network errors.

- [ ] **Step 3: Implement the absolute budget and remove automatic safe completion**

```ts
export interface ChatExecutionBudget {
  providerDeadlineMs(): number;
  remainingAttempts(): number;
  remainingMs(nowMs: number): number;
  reserveAttempt(nowMs: number): boolean;
  canStartAttempt(nowMs: number, minimumMs: number): boolean;
}

export interface GenerateChatAnswerInput {
  strict: boolean;
  generationMode: 'normal' | 'strict';
  remainingAttempts: number;
  remainingProviderMs: number;
}
```

Create the 90-second turn timeout when `runChat` accepts the valid request and pass its linked signal through routing, Embedding, retrieval, Search, Provider, persistence and SSE. The Provider absolute deadline is `min(providerStageStarted + 80_000, turnStarted + 90_000)`; it never receives a fresh deadline after strict or failover. Wire the new config values from `app/api/chat/route.ts` into `ChatServiceConfig`.

`runGuardedChatAnswer` passes remaining values to every generation; `failover-ai-provider.ts` must reserve before starting each primary/failover and stop when fewer than 10 seconds or zero attempts remain. When a serial failover actually starts before visible text, forward one internal `switching` event through the runner and emit one public SSE `status: switching`; it does not clear committed text because visible output locks the winner. Remove `safeAnswer()` from `ChatAnswerRunnerInput` and the terminal degraded-answer block. Implement regeneration as `error instanceof AnswerExecutionError && error.code === 'OUTPUT_GUARD_REJECTED'`; Provider/network/timeout/incomplete errors propagate to compensation.

Hedging stays disabled for v2 and `delaysMs` no longer starts 0/8/14 concurrency. Failover is serial: start the next healthy node only after the current node fails or reaches its adaptive deadline.

- [ ] **Step 4: Run tests and verify GREEN**

Run Step 2. Expected: selected tests PASS; no path emits more than three attempts or creates a new 80-second strict budget.

- [ ] **Step 5: Commit Task 6**

```powershell
git add -- lib/server/chat-execution-budget.ts tests/chat-execution-budget.test.ts lib/server/chat-answer-runner.ts lib/server/failover-ai-provider.ts lib/server/chat-service.ts app/api/chat/route.ts tests/chat-answer-runner.test.ts tests/failover-provider.test.ts tests/chat-route-stream.test.ts
git commit -m "fix: bound chat provider execution"
```

### Task 7: Distinguish Protocol Activity, Model Text, and User-Visible Text

**Files:**
- Create: `lib/server/provider-deadline.ts`
- Create: `tests/provider-deadline.test.ts`
- Modify: `lib/server/openai-provider.ts`
- Modify: `lib/server/failover-ai-provider.ts`
- Modify: `lib/server/provider-attempt-log.ts`
- Modify: `lib/server/interaction-log.ts`
- Modify: `tests/openai-provider.test.ts`
- Modify: `tests/failover-provider.test.ts`
- Modify: `tests/provider-attempt-log.test.ts`
- Modify: `tests/chat-service-integration.test.ts`

- [ ] **Step 1: Write failing adaptive-deadline and telemetry tests**

```ts
test('protocol activity extends once to an absolute 40 second model-text deadline', () => {
  const state = createProviderDeadline({ startedAtMs: 0, protocolTimeoutMs: 25_000, modelTextTimeoutMs: 40_000 });
  assert.equal(state.deadlineMs(), 25_000);
  state.recordProtocolEvent(24_000);
  assert.equal(state.deadlineMs(), 40_000);
  state.recordProtocolEvent(39_000);
  assert.equal(state.deadlineMs(), 40_000);
  state.recordModelText(39_500);
  assert.equal(state.deadlineMs(), null);
});

test('Responses metadata is protocol activity but not model text', async () => {
  const events = await collect(provider.streamAnswer(responseMetadataThenTextFixture()));
  assert.deepEqual(
    events.filter((event) => event.type === 'activity').map((event) => event.kind),
    ['protocol', 'model_text'],
  );
});

test('attempt telemetry persists three distinct latency milestones', async () => {
  const row = await loadAttempt(afterCompletedTurn());
  assert.equal(row.first_protocol_event_ms, 120);
  assert.equal(row.first_model_text_ms, 2_400);
  assert.equal(row.first_user_visible_ms, 2_650);
});
```

- [ ] **Step 2: Run Provider timing tests and verify RED**

```powershell
node --env-file-if-exists=.env.local --test tests/provider-deadline.test.ts tests/openai-provider.test.ts tests/failover-provider.test.ts tests/provider-attempt-log.test.ts tests/chat-service-integration.test.ts
```

Expected: FAIL because current first-byte timing is canceled by the first raw event and only one latency field exists.

- [ ] **Step 3: Implement internal activity events and adaptive serial switching**

Extend the internal `AnswerEvent` union:

```ts
| { type: 'activity'; kind: 'protocol' | 'model_text'; elapsedMs: number }
```

`openai-provider.ts` emits the first `protocol` activity for any valid Responses/Chat Completions event and the first `model_text` activity only for non-empty output text. Activity events do not set `emittedOutput`; only a non-empty `delta` does. In coordinated v2 execution it does not let its legacy first-byte timer preempt the outer adaptive deadline; non-v2 requests keep the current legacy timer.

`failover-ai-provider.ts` owns one `ProviderDeadline` per active serial attempt. At 25 seconds with no protocol event it aborts and starts the next node. A first protocol event extends that attempt once to the absolute 40-second point; repeated metadata never resets it. First model text cancels the attempt text deadline. The first released delta records user-visible latency and locks the winner; no later node may append to it.

Persist `generation_mode` and all three nullable timing values immediately in `chat_provider_attempts` through `provider-attempt-log.ts`, including failed/aborted partial attempts. Copy `launch_kind`, `generation_mode`, and all three timing values into `interaction_provider_attempts` through `interaction-log.ts` at terminal reconciliation. Heartbeats and public SSE status events never alter Provider deadlines.

- [ ] **Step 4: Run tests and verify GREEN**

Run Step 2. Expected: all selected timing, provider and integration tests PASS, including 25/40-second behavior represented with millisecond test fixtures.

- [ ] **Step 5: Commit Task 7**

```powershell
git add -- lib/server/provider-deadline.ts tests/provider-deadline.test.ts lib/server/openai-provider.ts lib/server/failover-ai-provider.ts lib/server/provider-attempt-log.ts lib/server/interaction-log.ts tests/openai-provider.test.ts tests/failover-provider.test.ts tests/provider-attempt-log.test.ts tests/chat-service-integration.test.ts
git commit -m "fix: track adaptive provider response deadlines"
```

### Task 8: Remove Client Replay and Add Pending Assistant Feedback

**Execution method:** Load `morse-design` before editing UI files. Preserve the existing token system and compact operational layout.

**Files:**
- Create: `components/chat/ChatPendingState.tsx`
- Modify: `components/chat/useMorseChat.ts`
- Modify: `components/chat/ChatTranscript.tsx`
- Modify: `components/chat/ChatWorkspace.tsx`
- Modify: `components/chat/ChatPhaseStatus.tsx`
- Modify: `components/MorseChat.module.css`
- Modify: `tests/chat-ui-contract.test.ts`
- Modify: `tests/chat-scroll.test.ts`
- Modify: `scripts/s10-chat-smoke.mjs`

- [ ] **Step 1: Write failing single-request and pending-state contracts**

```ts
test('one submit performs one fetch and exposes manual retry only after failure', () => {
  const hook = readChatSource('useMorseChat.ts');
  assert.doesNotMatch(hook, /AUTO_REPLAY_MAX_ATTEMPTS|waitForReplayDelay|for \(let attempt/);
  assert.equal((hook.match(/fetch\(['"]\/api\/chat['"]/g) ?? []).length, 1);
});

test('pending assistant contains progress, phase, elapsed time and stop affordance', () => {
  const pending = readChatSource('ChatPendingState.tsx');
  assert.match(pending, /role="progressbar"/);
  assert.match(pending, /elapsedSeconds\s*>=\s*8/);
  assert.match(pending, /elapsedSeconds\s*>=\s*30/);
  assert.match(pending, /onStop/);
});
```

- [ ] **Step 2: Run UI contracts and verify RED**

```powershell
node --env-file-if-exists=.env.local --test tests/chat-ui-contract.test.ts tests/chat-scroll.test.ts
```

Expected: FAIL because auto replay remains and no pending progress component exists.

- [ ] **Step 3: Implement one request and stable pending UI**

Remove `AUTO_REPLAY_MAX_ATTEMPTS`, `AUTO_REPLAY_DELAYS_MS`, `waitForReplayDelay`, and the fetch loop. Keep one `AbortController`; recoverable failures expose the existing manual retry with the same `turnId`.

Store `startedAtMs` and current phase on the pending assistant. Use one one-second interval only while a message is pending and clear it on delta, stop, error, done and unmount. Render:

```tsx
<div className={styles.pendingState} data-testid="morse-chat-pending">
  <div className={styles.pendingTrack} role="progressbar" aria-label="回答处理中">
    <span className={styles.pendingBar} />
  </div>
  <div className={styles.pendingMeta}>
    <span>{phaseLabel}</span>
    {elapsedSeconds >= 8 ? <span>已等待 {elapsedSeconds} 秒</span> : null}
    <button type="button" data-action="stop" onClick={onStop} aria-label="停止生成">停止</button>
  </div>
  {elapsedSeconds >= 30 ? <p>仍在处理中，你可以继续等待或停止。</p> : null}
</div>
```

Place it inside the assistant article so layout height is reserved and it disappears on the first visible delta. Use existing tokens only, border radius at most `var(--radius-sm)`, fixed minimum height, wrapping at 390px, and no fake percentage. Under `prefers-reduced-motion: reduce`, replace moving animation with a static high-contrast activity mark.

Update S10 Mock E2E to assert progress/phase/time/stop at 1440x900 and 390x844, no duplicate user/assistant bubbles, no client replay, no horizontal overflow, and zero console/page errors.

- [ ] **Step 4: Run UI contracts and verify GREEN**

Run Step 2. Expected: both files PASS. Do not run the S10 browser suite yet; it belongs to Task 9 once.

- [ ] **Step 5: Commit Task 8**

```powershell
git add -- components/chat/ChatPendingState.tsx components/chat/useMorseChat.ts components/chat/ChatTranscript.tsx components/chat/ChatWorkspace.tsx components/chat/ChatPhaseStatus.tsx components/MorseChat.module.css tests/chat-ui-contract.test.ts tests/chat-scroll.test.ts scripts/s10-chat-smoke.mjs
git commit -m "feat: show bounded chat waiting feedback"
```

### Task 9: Replace the Evaluation Matrix and Prove LOCAL_READY Once

**Files:**
- Modify: `content/chat-eval.json`
- Modify: `content/chat-review-cases.json`
- Modify: `scripts/chat-eval.mjs`
- Modify: `tests/s10-chat-eval.test.ts`
- Modify: `tests/s10-chat-smoke-contract.test.ts`

- [ ] **Step 1: Write failing evaluation-contract tests for the frozen 20-case composition**

```ts
test('real review manifest has the frozen 20-case category composition', () => {
  const cases = loadReviewCases();
  assert.equal(cases.length, 20);
  assert.deepEqual(countByCategory(cases), {
    conversation: 6,
    general_advice: 3,
    identity_project: 3,
    technical_contrast: 3,
    capability_evidence: 3,
    recruitment_jd: 2,
  });
});

test('zero-tolerance cases cover wrong RAG, fabricated facts and missing JD', () => {
  const cases = loadReviewCases();
  for (const id of ['conversation-no-rag', 'kubernetes-no-direct', 'jd-intake-no-provider']) {
    assert.equal(cases.find((item) => item.id === id)?.zeroTolerance, true);
  }
});
```

- [ ] **Step 2: Run evaluation contract tests and verify RED**

```powershell
node --env-file-if-exists=.env.local --test tests/s10-chat-eval.test.ts tests/s10-chat-smoke-contract.test.ts
```

Expected: FAIL because the old dataset treats free conversation as narrow social/off-topic refusal and still expects automatic recovery.

- [ ] **Step 3: Replace deterministic evaluation behavior and remove obsolete expectations**

The 20-case review manifest must contain exactly the approved 6/3/3/3/3/2 composition. Include these mandatory contrasts:

```json
[
  { "id": "conversation-no-rag", "prompt": "今天吃饭了吗？", "route": "conversation", "evidence": "none", "zeroTolerance": true },
  { "id": "workplace-general", "prompt": "职场里怎么和同事处理分歧？", "route": "conversation", "evidence": "none" },
  { "id": "workplace-personal", "prompt": "你以前怎么处理同事冲突？", "route": "personal_fact", "evidence": "unavailable" },
  { "id": "kubernetes-general", "prompt": "Kubernetes 是什么？", "route": "conversation", "evidence": "none" },
  { "id": "kubernetes-no-direct", "prompt": "你有 Kubernetes 生产经验吗？", "route": "personal_fact", "evidence": "transferable", "zeroTolerance": true },
  { "id": "docker-direct", "prompt": "你用过 Docker Compose 吗？", "route": "personal_fact", "evidence": "direct" },
  { "id": "jd-intake-no-provider", "prompt": "给我一份岗位适配度。", "route": "jd_intake", "evidence": "none", "zeroTolerance": true }
]
```

`scripts/chat-eval.mjs` must assert expected route, exact dependency calls, direct answer focus, evidence class, absence of project template in conversation, no unsupported direct claim, and no automatic fallback. Keep adversarial injection, citation, URL safety, quota and error-code tests that remain compatible. Weather/current external facts become `external_current`; predictive financial advice remains a safety refusal.

- [ ] **Step 4: Run the affected boundary checks once**

Run focused and integration checks:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-route-policy.test.ts tests/capability-evidence.test.ts tests/chat-evidence.test.ts tests/chat-persona.test.ts tests/chat-output-guard.test.ts tests/chat-execution-budget.test.ts tests/provider-deadline.test.ts tests/openai-provider.test.ts tests/failover-provider.test.ts tests/chat-answer-runner.test.ts tests/provider-attempt-log.test.ts tests/chat-service-integration.test.ts tests/chat-ui-contract.test.ts tests/chat-scroll.test.ts tests/s10-chat-eval.test.ts tests/s10-chat-smoke-contract.test.ts
npm run chat:eval
npm run build
npm run visual:s10
```

Expected:

- All selected tests PASS.
- `chat:eval` reports zero failed deterministic cases.
- `next build` exits 0.
- S10 Mock E2E passes at 1440x900 and 390x844 with zero console/page errors and produces fresh screenshots.
- No command calls a real Chat/Search Provider; S10 uses only its disposable PostgreSQL and loopback mocks.

If a focused check fails, fix only the owning Task and rerun that focused check; rerun the full Step 4 set only if the fix invalidates its evidence.

- [ ] **Step 5: Commit the evaluation milestone**

```powershell
git add -- content/chat-eval.json content/chat-review-cases.json scripts/chat-eval.mjs tests/s10-chat-eval.test.ts tests/s10-chat-smoke-contract.test.ts
git commit -m "test: gate chat response reliability"
```

- [ ] **Step 6: Stop at LOCAL_READY and request external-action approvals**

Record a VerificationReceipt with HEAD, commands, results, S10 evidence paths, remaining gaps and invalidation conditions. Then invoke `closeout` for scoped reconciliation and `KNOWLEDGE_RECONCILED`; do not push.

After `LOCAL_READY`, ask separately for:

1. Real Provider 20-round review authorization. Passing requires at least 18/20, with zero privacy leaks, fabricated personal facts, missing-JD conclusions or conversation RAG errors.
2. Push authorization after the real review is accepted.
3. Production deployment authorization after push; deployment reaches `DEPLOYED_UNOBSERVED` until the named live chat behaviors are freshly observed.

No prior authorization is carried into these three gates.
