# Digital Morse Conversation v2 Implementation Plan

> **执行方式：** 本计划在现有 Morse 生命周期内按 Task 1-14 顺序推进。可以由当前线程直接执行；只有用户明确选择分工时，才把互不重叠的任务交给子代理，不启动第二套开发生命周期。步骤使用 checkbox（`- [ ]`）追踪。

**Goal:** 把数字 Morse 从统一重链路的审计式问答改成逐轮路由、分层人格、证据型招聘表达和可自动恢复的生产对话系统。

**Architecture:** 保留现有 Next.js、PostgreSQL、SSE、短期会话和 Provider Adapter；新增纯函数路由/人格/守卫边界，升级三节点协调器，并通过 additive migration 持久化节点尝试。v1 只用于短期稳定灰度，安全模式、错峰接管和 v2 分流分别可关闭。

**Tech Stack:** Next.js App Router, TypeScript, React, Node test runner, PostgreSQL 16 + pgvector, OpenAI-compatible Responses, SSE, CSS Modules.

---

## 执行合同

- 设计源：`docs/superpowers/specs/2026-07-21-digital-morse-conversation-v2-design.md`。
- Morse 合同：`STAGED / CRITICAL / DEPLOYED`。
- 工作目录：`E:\Revolution\.worktrees\private-resume-access`。
- 不修改外部项目，不把私密简历接入公共 Chat/RAG/日志。
- 本地测试和 Mock 不授权真实 Provider；真实生成、push 和部署分别在 Task 14 停点确认。
- 每项任务只暂存列明文件，禁止 `git add .` 或 `git add -A`。

## 文件责任图

| 文件 | 单一责任 |
| --- | --- |
| `lib/server/chat-behavior.ts` | v1/v2/safe 分流、逐轮意图与生成档位 |
| `lib/server/chat-persona.ts` | 固定身份、分层人格和审核身份卡 |
| `lib/server/chat-prompt.ts` | v2 证据渲染与提示词组合 |
| `lib/server/chat-output-guard.ts` | 引用、招聘措辞、百分比和系统口吻守卫 |
| `lib/server/chat-safe-answer.ts` | 无 Provider 时的确定性安全结果 |
| `lib/server/provider-health.ts` | 进程内节点熔断和半开探测 |
| `lib/server/provider-attempt-log.ts` | 节点尝试持久化和 24 小时额外调用预算 |
| `lib/server/chat-answer-runner.ts` | 缓冲、守卫、一次严格重生成和安全降级 |
| `lib/server/failover-ai-provider.ts` | 串行兼容与 0/8/14 秒错峰节点协调 |
| `lib/server/chat-service.ts` | 预留、上下文、回答执行、提交和补偿编排 |
| `components/chat/useMorseChat.ts` | 相同 `turnId` 的客户端自动恢复 |
| `scripts/chat-eval.mjs` | 离线、确定性的行为与安全门禁 |

### Task 1: 冻结 v2 合同、功能开关和逐轮路由

**Files:**
- Create: `lib/server/chat-behavior.ts`
- Modify: `lib/contracts/chat.ts`
- Modify: `lib/server/config.ts`
- Modify: `.env.example`
- Test: `tests/chat-behavior.test.ts`
- Test: `tests/chat-contract.test.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: 写逐轮路由和配置失败测试**

```ts
test('routeChatTurn gives the current message priority over the starter hint', () => {
  assert.deepEqual(routeChatTurn(request('你好', 'recruiter')), {
    intent: 'social',
    profile: 'social',
    evidence: 'none',
    release: 'segment',
    reasoningEffort: 'low',
  });
  assert.equal(routeChatTurn(request('这个岗位如何证明 Agent 经验？')).intent, 'recruitment');
  assert.equal(routeChatTurn(jdRequest('Agent 工程师')).profile, 'jd');
});

test('selectChatBehavior is stable and safe mode overrides every rollout flag', () => {
  assert.equal(selectChatBehavior({
    safeMode: true,
    v2Enabled: true,
    canaryPercent: 100,
    accessSessionId: SESSION_ID,
    inviteCodeId: INVITE_ID,
    canaryInviteIds: new Set(),
  }), 'safe');
  assert.equal(selectChatBehavior({
    safeMode: false,
    v2Enabled: true,
    canaryPercent: 0,
    accessSessionId: SESSION_ID,
    inviteCodeId: INVITE_ID,
    canaryInviteIds: new Set([INVITE_ID]),
  }), 'v2');
  assert.equal(selectChatBehavior({
    safeMode: false,
    v2Enabled: false,
    canaryPercent: 100,
    accessSessionId: SESSION_ID,
    inviteCodeId: INVITE_ID,
    canaryInviteIds: new Set([INVITE_ID]),
  }), 'v1');
});
```

同时覆盖带职责/任职要求等结构标记的完整 JD 在普通 chat 入口也识别为 `jd`。在 `tests/config.test.ts` 增加 `MORSE_CHAT_V2_ENABLED`、`MORSE_CHAT_V2_CANARY_PERCENT`、`MORSE_CHAT_V2_CANARY_INVITE_IDS`、`MORSE_CHAT_HEDGED_FAILOVER_ENABLED` 和 `MORSE_CHAT_SAFE_MODE` 的正反例；invite ID 只允许规范 UUID。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
node --test tests/chat-behavior.test.ts tests/chat-contract.test.ts tests/config.test.ts
```

Expected: FAIL，提示 `chat-behavior.ts` 不存在或新配置字段缺失。

- [ ] **Step 3: 增加内部路由类型和稳定分流**

```ts
export const TURN_INTENTS = [
  'social', 'identity', 'project', 'recruitment', 'jd', 'technical',
] as const;
export type TurnIntent = typeof TURN_INTENTS[number];
export type GenerationProfile = 'social' | 'grounded' | 'jd';
export type ChatBehavior = 'v1' | 'v2' | 'safe';

export interface TurnRoute {
  intent: TurnIntent;
  profile: GenerationProfile;
  evidence: 'none' | 'identity' | 'rag';
  release: 'segment' | 'complete';
  reasoningEffort?: 'low';
}

export function routeChatTurn(request: NormalizedChatRequest): TurnRoute {
  if (request.workflow === 'jd_match') {
    return { intent: 'jd', profile: 'jd', evidence: 'rag', release: 'complete' };
  }
  const message = request.message.trim();
  if (/^(你好|嗨|hello|hi|谢谢|多谢|再见)[!！。,.，\s]*$/iu.test(message)) {
    return {
      intent: 'social',
      profile: 'social',
      evidence: 'none',
      release: 'segment',
      reasoningEffort: 'low',
    };
  }
  if (/你是谁|介绍(?:一下)?自己|数字\s*(?:morse|摩斯)/iu.test(message)) {
    return { intent: 'identity', profile: 'grounded', evidence: 'identity', release: 'segment' };
  }
  if (/招聘|岗位|面试|候选人|简历|胜任|匹配/iu.test(message)) {
    return { intent: 'recruitment', profile: 'grounded', evidence: 'rag', release: 'complete' };
  }
  if (/agent|rag|架构|技术|数据库|provider|sse|可靠性/iu.test(message)) {
    return { intent: 'technical', profile: 'grounded', evidence: 'rag', release: 'segment' };
  }
  return { intent: 'project', profile: 'grounded', evidence: 'rag', release: 'segment' };
}
```

`selectChatBehavior` 使用 SHA-256 对 `accessSessionId` 取稳定 0-99 桶；其纯函数优先级固定为 `safe > v2 master disabled > canary invite > percentage > v1`。Task 7 的服务层在 master flag 与 canary 之间应用 stored assignment；关闭 v2 时只做运行时 v1 覆盖，不改写已经持久化的 v2 分配，重新启用后恢复原分配。完整 JD 只用长度与结构标记的确定性规则识别，不额外调用模型。

- [ ] **Step 4: 解析并限制新配置**

```ts
const chatV2CanaryPercent = boundedNonNegativeInteger(
  env,
  'MORSE_CHAT_V2_CANARY_PERCENT',
  0,
  100,
);
const chatV2CanaryInviteIds = uuidList(env, 'MORSE_CHAT_V2_CANARY_INVITE_IDS');

return {
  // existing settings
  chatV2Enabled: booleanSetting(env, 'MORSE_CHAT_V2_ENABLED', false),
  chatV2CanaryPercent,
  chatV2CanaryInviteIds,
  hedgedFailoverEnabled: booleanSetting(env, 'MORSE_CHAT_HEDGED_FAILOVER_ENABLED', false),
  chatSafeMode: booleanSetting(env, 'MORSE_CHAT_SAFE_MODE', false),
};
```

新增 `uuidList` 配置解析器：空字符串返回空集合；非空值按逗号分隔、转小写、去重，并对任一非规范 UUID fail closed。在 `.env.example` 写入安全默认值：v2、hedging、safe 均为 `false`，percent 为 `0`，invite IDs 为空。

- [ ] **Step 5: 运行测试确认 GREEN**

Run:

```powershell
node --test tests/chat-behavior.test.ts tests/chat-contract.test.ts tests/config.test.ts
```

Expected: PASS，且无外部调用。

- [ ] **Step 6: 精确提交**

```powershell
git add -- .env.example lib/contracts/chat.ts lib/server/chat-behavior.ts lib/server/config.ts tests/chat-behavior.test.ts tests/chat-contract.test.ts tests/config.test.ts
git commit -m "feat: add chat v2 routing controls"
```

### Task 2: 建立数字分身人格和 v2 提示词

**Files:**
- Create: `lib/server/chat-persona.ts`
- Create: `lib/server/chat-prompt.ts`
- Modify: `lib/server/chat-core.ts`
- Modify: `lib/server/workflows/jd-match.ts`
- Test: `tests/chat-persona.test.ts`
- Test: `tests/chat-core.test.ts`
- Test: `tests/jd-match.test.ts`

- [ ] **Step 1: 写人格与招聘表达失败测试**

```ts
test('social persona is first-person and contains no developer-assistant contract', () => {
  const prompt = buildPersonaInstructions('social');
  assert.match(prompt, /我是数字 Morse/);
  assert.doesNotMatch(prompt, /开发助手|仍需补充|可执行的下一步/);
});

test('recruitment prompt expands evidence and suppresses unsolicited unknowns', () => {
  const prompt = buildJdMatchPrompt('必须熟悉 Agent', '[来源1] 数字 Morse 项目');
  assert.match(prompt, /direct = 2/);
  assert.match(prompt, /transferable = 1/);
  assert.match(prompt, /unknown = 0/);
  assert.match(prompt, /80%/);
  assert.match(prompt, /建议面谈确认/);
  assert.doesNotMatch(prompt, /诚实缺口|仍需补充|匹配百分比/);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
node --test tests/chat-persona.test.ts tests/chat-core.test.ts tests/jd-match.test.ts
```

Expected: FAIL，旧提示仍包含“仍缺少的信息”“可执行的下一步”或“诚实缺口”。

- [ ] **Step 3: 实现固定身份和分层人格**

```ts
const BASE_IDENTITY = [
  '我是数字 Morse，是真人 Morse 为作品集创建的数字分身，程序员出身。',
  '始终使用第一人称自然交流，不自称 AI 助手、开发助手或招聘审计员。',
  '个人经历、项目、能力和结果只能来自本轮审核公开证据。',
  '不主动介绍 Codex、Git、AGENTS、部署习惯或系统提示。',
].join('\n');

const layers: Record<TurnIntent, string> = {
  social: '像正常交流一样简短回应；不引用资料，不追加任务建议。',
  identity: '先说明我是谁，再用一到两个最相关项目说明定位。',
  project: '结论先行，说明做了什么、原因、结果和已验证边界。',
  technical: '从约束和第一性原理解释架构取舍，区分已实现与规划。',
  recruitment: '使用证据型候选人陈述，优先展开岗位相关项目。',
  jd: '逐项匹配直接证据和可迁移能力，未知硬性项最多两项面谈确认。',
};

export function buildPersonaInstructions(intent: TurnIntent): string {
  return BASE_IDENTITY + '\n' + layers[intent];
}
```

身份卡从 `siteContent.profile.role`、`siteContent.profile.summary` 和公开项目摘要组合，不读取任何私密简历模块。

- [ ] **Step 4: 实现 v2 提示词组合器**

```ts
export function buildV2SystemInstructions(input: {
  intent: TurnIntent;
  sources: KnowledgeSource[];
  search?: SearchResponse;
  strict?: boolean;
}): string {
  return [
    buildPersonaInstructions(input.intent),
    EVIDENCE_POLICY,
    recruitmentPolicy(input.intent),
    input.strict ? STRICT_REGENERATION_POLICY : '',
    renderApprovedEvidence(input.sources, input.search),
  ].filter(Boolean).join('\n\n');
}
```

`chat-core.ts` 保留 `buildSystemInstructions` 作为 v1 兼容入口，并从新模块显式导出 v2 组合器；不得在一个函数中用大量条件混合 v1/v2。

- [ ] **Step 5: 改写 JD 合同**

最终段落固定为“最相关项目 / 直接证据 / 可迁移能力 / 建议面谈确认”。内部等级只作为提示，不允许模型输出分数；unknown 非硬性项忽略，硬性项最多两项。

- [ ] **Step 6: 运行测试确认 GREEN**

Run:

```powershell
node --test tests/chat-persona.test.ts tests/chat-core.test.ts tests/jd-match.test.ts
```

Expected: PASS；v1 兼容测试仍通过，v2 不含禁止措辞。

- [ ] **Step 7: 精确提交**

```powershell
git add -- lib/server/chat-core.ts lib/server/chat-persona.ts lib/server/chat-prompt.ts lib/server/workflows/jd-match.ts tests/chat-persona.test.ts tests/chat-core.test.ts tests/jd-match.test.ts
git commit -m "feat: define digital Morse conversation persona"
```

### Task 3: 过滤证据、守卫输出并提供安全回答

**Files:**
- Create: `lib/server/chat-output-guard.ts`
- Create: `lib/server/chat-safe-answer.ts`
- Modify: `lib/server/rag.ts`
- Test: `tests/chat-output-guard.test.ts`
- Test: `tests/chat-safe-answer.test.ts`
- Test: `tests/rag-integration.test.ts`
- Test: `tests/resume-isolation.test.ts`

- [ ] **Step 1: 写低相关证据和招聘守卫失败测试**

```ts
test('filterRelevantKnowledge removes every source below the calibrated gate', () => {
  assert.deepEqual(
    filterRelevantKnowledge([
      source('keep', 0.51),
      source('drop', 0.449),
      source('nan', Number.NaN),
    ]).map((item) => item.documentId),
    ['keep'],
  );
});

test('guard rejects an unsolicited gap list and a fake percentage', () => {
  const result = inspectChatAnswer({
    answer: '匹配度 92%。缺少 Kubernetes、Go 和三年经验。下一步：补充简历。',
    intent: 'recruitment',
    workflow: 'chat',
    question: '哪些项目和岗位相关？',
    sourceCount: 2,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons.sort(), [
    'forced_next_step',
    'match_percentage',
    'unsolicited_gap_list',
  ]);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-output-guard.test.ts tests/chat-safe-answer.test.ts tests/rag-integration.test.ts tests/resume-isolation.test.ts
```

Expected: FAIL，新模块和 `filterRelevantKnowledge` 尚不存在。

- [ ] **Step 3: 实现相关度过滤**

```ts
export function filterRelevantKnowledge(
  sources: KnowledgeSource[],
  minimumScore = LOCAL_EVIDENCE_MIN_SCORE,
): KnowledgeSource[] {
  return sources.filter((source) => (
    Number.isFinite(source.score) && source.score >= minimumScore
  ));
}
```

v2 只能把过滤后来源交给提示词、搜索充足度判断和客户端 meta；v1 暂时保留原行为用于灰度对照。

- [ ] **Step 4: 实现输出守卫**

```ts
export interface ChatGuardResult {
  ok: boolean;
  reasons: Array<
    'invalid_citation' |
    'missing_grounded_citation' |
    'unsolicited_gap_list' |
    'too_many_interview_confirmations' |
    'match_percentage' |
    'forced_next_step' |
    'developer_assistant_voice' |
    'system_metadata'
  >;
}

export interface ChatGuardInput {
  answer: string;
  intent: TurnIntent;
  workflow: ChatWorkflow;
  question: string;
  sourceCount: number;
}

export function inspectChatAnswer(input: ChatGuardInput): ChatGuardResult {
  const reasons = new Set<ChatGuardResult['reasons'][number]>();
  validateCitations(input, reasons);
  validateRecruitmentLanguage(input, reasons);
  validateNextStep(input, reasons);
  validateVoice(input, reasons);
  return { ok: reasons.size === 0, reasons: [...reasons] };
}
```

“建议面谈确认”只有在 JD 硬性项或用户明确追问“是否/有没有/做过/熟悉”时允许，整篇最多两次。诊断流程和用户明确问“下一步/建议/怎么做”时允许自然建议。

- [ ] **Step 5: 实现不调用 Provider 的安全回答**

```ts
export interface SafeChatAnswerInput {
  intent: TurnIntent;
  sources: KnowledgeSource[];
}

export interface SafeChatAnswer {
  text: string;
  sources: KnowledgeSource[];
}

export function buildSafeChatAnswer(input: SafeChatAnswerInput): SafeChatAnswer | null {
  if (input.intent === 'social' || input.intent === 'identity') {
    return { text: approvedIdentitySummary(), sources: [identityKnowledgeSource()] };
  }
  if (input.sources.length > 0) {
    return {
      text: input.sources.slice(0, 2).map((source, index) => (
        (index + 1) + '. ' + source.title + '：' + safeSummary(source.content)
        + ' [来源' + (index + 1) + ']'
      )).join('\n'),
      sources: input.sources.slice(0, 2),
    };
  }
  return null;
}
```

JD 没有已经完成的安全解析结果时返回 `null`，由客户端保留原输入并同轮重试，不猜测岗位结论。

- [ ] **Step 6: 运行测试确认 GREEN**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-output-guard.test.ts tests/chat-safe-answer.test.ts tests/rag-integration.test.ts tests/resume-isolation.test.ts
```

Expected: PASS；序列化守卫输入和安全回答中不出现私密简历标记。

- [ ] **Step 7: 精确提交**

```powershell
git add -- lib/server/chat-output-guard.ts lib/server/chat-safe-answer.ts lib/server/rag.ts tests/chat-output-guard.test.ts tests/chat-safe-answer.test.ts tests/rag-integration.test.ts tests/resume-isolation.test.ts
git commit -m "feat: guard chat evidence and fallback answers"
```

### Task 4: 增加行为分配和 Provider 尝试审计表

**Files:**
- Create: `db/migrations/005_chat_v2.sql`
- Create: `lib/server/provider-attempt-log.ts`
- Modify: `lib/server/interaction-log.ts`
- Modify: `tests/migration-integration.test.ts`
- Test: `tests/provider-attempt-log.test.ts`

- [ ] **Step 1: 写 migration 和持久化失败测试**

在 migration 测试中把预期版本改为 `001/002/003/004/005`，并断言：

```ts
assert.equal(columns.chat_behavior_version, 'text');
assert.deepEqual(attemptPrimaryKey, [
  'interaction_turn_id', 'execution_id', 'attempt_no',
]);
assert.equal(rawTextColumns.length, 0);
```

`provider-attempt-log.test.ts` 必须证明 started → first_byte → completed 的 UPSERT、`primary/hedge/failover` 启动类型、失败错误码、winner、usage、10 天 `delete_after` 和级联清理。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/migration-integration.test.ts tests/provider-attempt-log.test.ts
```

Expected: FAIL，`004`、新表和记录函数不存在。

- [ ] **Step 3: 写 additive migration**

```sql
ALTER TABLE access_sessions
  ADD COLUMN chat_behavior_version text
  CHECK (chat_behavior_version IN ('v1', 'v2'));

CREATE TABLE chat_provider_attempts (
  interaction_turn_id uuid NOT NULL
    REFERENCES interaction_turns(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL,
  attempt_no smallint NOT NULL CHECK (attempt_no > 0),
  provider_alias text NOT NULL CHECK (char_length(provider_alias) BETWEEN 1 AND 32),
  launch_kind text NOT NULL
    CHECK (launch_kind IN ('primary', 'hedge', 'failover')),
  status text NOT NULL
    CHECK (status IN ('started', 'streaming', 'completed', 'failed', 'aborted')),
  winner boolean NOT NULL DEFAULT false,
  start_delay_ms integer NOT NULL CHECK (start_delay_ms >= 0),
  first_byte_ms integer CHECK (first_byte_ms >= 0),
  duration_ms integer CHECK (duration_ms >= 0),
  error_code text,
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  estimated_cost_usd numeric(12, 6) CHECK (estimated_cost_usd >= 0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  delete_after timestamptz NOT NULL,
  PRIMARY KEY (interaction_turn_id, execution_id, attempt_no),
  CHECK (delete_after > started_at)
);

CREATE INDEX chat_provider_attempts_delete_after_idx
  ON chat_provider_attempts(delete_after);
CREATE INDEX chat_provider_attempts_alias_started_idx
  ON chat_provider_attempts(provider_alias, started_at DESC);
```

- [ ] **Step 4: 实现逐事件 UPSERT 和额外调用预算**

```ts
export async function recordProviderAttemptEvent(
  client: PoolClient,
  key: ProviderAttemptKey,
  event: ProviderAttemptEvent,
  deleteAfter: Date,
): Promise<void> {
  await client.query(UPSERT_ATTEMPT_SQL, valuesFor(key, event, deleteAfter));
}

export async function reserveHedgedProviderAttempt(
  client: PoolClient,
  key: ProviderAttemptKey,
  started: Extract<ProviderAttemptEvent, { type: 'started' }>,
  deleteAfter: Date,
  now: Date,
  maximumRatio = 0.15,
): Promise<boolean> {
  return inTransaction(client, async () => {
    await lockRollingHedgeBudget(client);
    const counts = await loadRollingHedgeCounts(client, now);
    const allowed = (counts.hedgedAttempts + 1)
      / Math.max(counts.completedTurns + 1, 1) <= maximumRatio;
    if (!allowed) return false;
    await recordProviderAttemptEvent(client, key, started, deleteAfter);
    return true;
  });
}
```

`lockRollingHedgeBudget` 使用固定数据库事务级 advisory lock；预算判断与 `started/hedge` 事件写入同一事务，不能先检查后异步记录。预算分子只统计 `launch_kind = 'hedge'`，串行故障接管记录为 `failover`，不占 hedge 预算也不能绕过节点总超时。查询只使用时间、状态、turn/execution/attempt 标识和 token；不得加载问题或回答正文。

- [ ] **Step 5: 运行数据库测试确认 GREEN**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/migration-integration.test.ts tests/provider-attempt-log.test.ts
```

Expected: PASS；重复 migration 无变化，旧数据保留，尝试表无正文列。

- [ ] **Step 6: 精确提交**

```powershell
git add -- db/migrations/005_chat_v2.sql lib/server/interaction-log.ts lib/server/provider-attempt-log.ts tests/migration-integration.test.ts tests/provider-attempt-log.test.ts
git commit -m "feat: persist chat provider attempts"
```

### Task 5: 支持逐轮 reasoning 并实现节点健康状态

**Files:**
- Create: `lib/server/provider-health.ts`
- Modify: `lib/server/ai-provider.ts`
- Modify: `lib/server/openai-provider.ts`
- Modify: `lib/server/config.ts`
- Test: `tests/provider-health.test.ts`
- Test: `tests/openai-provider.test.ts`

- [ ] **Step 1: 写 reasoning 和熔断失败测试**

```ts
test('OpenAIProvider lets a social turn lower reasoning without changing the default', async () => {
  await collect(provider.streamAnswer({
    instructions: 'social',
    messages: [{ role: 'user', content: '你好' }],
    reasoningEffort: 'low',
  }));
  assert.equal(requests[0].reasoning?.effort, 'low');
});

test('health opens after three retryable failures and permits one half-open probe', () => {
  registry.failure('primary', now);
  registry.failure('primary', now);
  registry.failure('primary', now);
  assert.equal(registry.acquire('primary', plus(now, 30_000)), null);
  const probe = registry.acquire('primary', plus(now, 60_000));
  assert.ok(probe);
  assert.equal(registry.acquire('primary', plus(now, 60_001)), null);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
node --test tests/provider-health.test.ts tests/openai-provider.test.ts
```

Expected: FAIL，逐轮 reasoning 和 registry 尚不存在。

- [ ] **Step 3: 把 reasoning 类型移到 Provider 合同**

```ts
export type AnswerReasoningEffort =
  | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface AnswerRequest {
  instructions: string;
  messages: AiMessage[];
  reasoningEffort?: AnswerReasoningEffort;
}
```

`OpenAIProvider` 使用 `request.reasoningEffort ?? config.reasoningEffort`；Responses 和 Chat Completions 两种协议都覆盖测试。

- [ ] **Step 4: 实现进程内 health registry**

```ts
export class ProviderHealthRegistry {
  acquire(alias: string, now: Date): ProviderHealthLease | null;
  success(alias: string): void;
  failure(alias: string, now: Date): void;
  abort(alias: string): void;
  snapshot(alias: string, now: Date): ProviderHealthSnapshot;
}
```

固定策略：3 次连续失败、60 秒 open、单个 half-open lease。调用方停止调用 `abort`，不增加失败计数。

- [ ] **Step 5: 运行测试确认 GREEN**

Run:

```powershell
node --test tests/provider-health.test.ts tests/openai-provider.test.ts
```

Expected: PASS；原有 Responses/Chat Completions/timeout/concurrency 测试无回归。

- [ ] **Step 6: 精确提交**

```powershell
git add -- lib/server/ai-provider.ts lib/server/config.ts lib/server/openai-provider.ts lib/server/provider-health.ts tests/openai-provider.test.ts tests/provider-health.test.ts
git commit -m "feat: add provider health and per-turn reasoning"
```

### Task 6: 将三节点串行接管升级为受预算约束的错峰协调

**Files:**
- Modify: `lib/server/ai-provider.ts`
- Modify: `lib/server/failover-ai-provider.ts`
- Modify: `lib/server/provider.ts`
- Test: `tests/failover-provider.test.ts`
- Test: `tests/provider-factory.test.ts`

- [ ] **Step 1: 写 0/8/14、最大两个在途和赢家测试**

使用可注入 fake scheduler，把生产延迟缩短为 `0/8/14ms`：

```ts
test('hedging never has more than two nodes in flight and delays node three', async () => {
  const result = await collect(resilient({
    nodes: [slow('primary'), failAt('fallback-1', 12), succeedAt('fallback-2', 18)],
    delaysMs: [0, 8, 14],
  }));
  assert.equal(maxInFlight, 2);
  assert.deepEqual(started, ['primary@0', 'fallback-1@8', 'fallback-2@14']);
  assert.equal(result.text, 'fallback-2');
});

test('complete release never exposes a rejected recruitment candidate', async () => {
  const events = await collect(provider.streamAnswer(request({
    releasePolicy: 'complete',
    acceptCandidate: (text) => !text.includes('缺口清单'),
  })));
  assert.deepEqual(deltaText(events), '证据型回答');
  assert.doesNotMatch(deltaText(events), /缺口清单/);
});
```

再增加一个时间可观测测试：segment 赢家在第一个完整语义段通过守卫后立即产生首个 delta，而底层 provider 的 done 仍未发生；后续语义段逐段释放，证明实现没有退化成整篇缓冲。

同时覆盖：预算拒绝后等待当前节点失败再串行切换、用户 abort 不接管、赢家产生后 loser 被中止并等待清理、usage 合计、attempt 事件顺序、open 节点跳过和 half-open 恢复。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
node --test tests/failover-provider.test.ts tests/provider-factory.test.ts
```

Expected: FAIL，当前实现只串行且没有节点别名、health、budget callback 或 candidate guard。

- [ ] **Step 3: 扩展通用执行选项**

```ts
export interface AnswerExecutionOptions {
  executionId: string;
  releasePolicy: 'segment' | 'complete';
  minimumBufferCharacters: number;
  totalTimeoutMs: number;
  hedgingEnabled: boolean;
  delaysMs: readonly number[];
  acceptCandidate(text: string, complete: boolean): boolean;
  reserveHedgedAttempt(
    event: Extract<ProviderAttemptEvent, { type: 'started' }>,
  ): Promise<boolean>;
  onAttempt(event: ProviderAttemptEvent): Promise<void>;
}

export type ProviderAttemptEvent =
  | {
      type: 'started';
      attemptNo: number;
      providerAlias: string;
      launchKind: 'primary' | 'hedge' | 'failover';
      startedAt: Date;
      startDelayMs: number;
    }
  | {
      type: 'first_byte';
      attemptNo: number;
      providerAlias: string;
      firstByteMs: number;
    }
  | {
      type: 'completed' | 'failed' | 'aborted';
      attemptNo: number;
      providerAlias: string;
      durationMs: number;
      winner: boolean;
      errorCode: string | null;
      usage: TokenUsage | null;
    };

export interface AnswerRequest {
  instructions: string;
  messages: AiMessage[];
  reasoningEffort?: AnswerReasoningEffort;
  execution?: AnswerExecutionOptions;
}

export const ANSWER_EXECUTION_ERROR_CODES = [
  'OUTPUT_GUARD_REJECTED', 'PROVIDER_INCOMPLETE',
] as const;
export type AnswerExecutionErrorCode = typeof ANSWER_EXECUTION_ERROR_CODES[number];

export class AnswerExecutionError extends Error {
  readonly code: AnswerExecutionErrorCode;

  constructor(code: AnswerExecutionErrorCode) {
    super(code);
    this.name = 'AnswerExecutionError';
    this.code = code;
  }
}
```

`AnswerEvent` 的 done 分支增加仅服务端使用的可选 `providerAlias`；协调器返回的 usage 是所有实际尝试的合计。上述 execution 字段只在本地协调器消费，`OpenAIProvider` 构造 SDK payload 时只读取 instructions/messages/reasoning。

- [ ] **Step 4: 实现节点协调器**

`FailoverAiProvider` 默认无 `execution` 时保留 v1 串行行为；有 `execution` 时：

1. 节点只在真正准备启动时获取 health lease；open 节点跳过，未启动的 half-open lease 不得被占用。
2. 按 `0/8000/14000ms` 资格时间启动。只有当前仍有节点在途、准备增加并发时才调用 `reserveHedgedAttempt`，成功返回表示 started 事件和预算已原子预留，不得重复写 started；预算拒绝后等待当前节点退出，再把下一节点记为串行 `failover`。
3. 任意时刻最多两个节点在途，所有节点共享 `execution.totalTimeoutMs` 和调用方 AbortSignal。
4. segment 模式为每个节点缓冲到完整语义段和最小字符数；首个累计文本通过 `acceptCandidate` 的节点成为赢家，立即释放首段，不等待整篇 done。之后继续消费赢家，把每个后续完整语义段加入累计文本并通过守卫后立即释放；done 前的非空尾段按完整末段验收和释放，短 social 回答不能被吞掉。
5. complete 模式必须收到 done 并对整篇候选验收后才释放任何 delta。未通过的节点记为 `OUTPUT_GUARD_REJECTED` 后继续其他可用节点；只有全部候选被拒绝时协调器才抛出明确定义的 `AnswerExecutionError('OUTPUT_GUARD_REJECTED')`。赢家后续段失败则终止该执行，由上层 reset/严格重生成。
6. 赢家确定后立即中止 loser，并在最终 done 前等待 loser 清理；不得为等待整篇缓冲而推迟 segment 首段。
7. 每个状态变化都 await `onAttempt`，错误只记录稳定码；done 的 usage 合并成功、失败和已中止尝试中可获得的 usage。

- [ ] **Step 5: 工厂使用稳定别名和共享 registry**

```ts
const nodes = [
  { alias: 'primary', provider: primary },
  ...fallbacks.map((provider, index) => ({
    alias: 'fallback-' + (index + 1),
    provider,
  })),
];

return new FailoverAiProvider(
  primary,
  nodes,
  config.providerTotalTimeoutMs * nodes.length,
  sharedProviderHealthRegistry,
);
```

构造器中的乘法超时只保留给无 `execution` 的 v1 串行兼容；v2 必须使用 `execution.totalTimeoutMs = config.providerTotalTimeoutMs`，不能按节点数放大。别名不能包含域名或 Key；即使只有主节点也由协调器包装，以保持尝试审计一致。

- [ ] **Step 6: 运行测试确认 GREEN**

Run:

```powershell
node --test tests/failover-provider.test.ts tests/provider-factory.test.ts tests/openai-provider.test.ts
```

Expected: PASS；并发峰值为 2，失败候选不泄露，旧串行合同仍通过。

- [ ] **Step 7: 精确提交**

```powershell
git add -- lib/server/ai-provider.ts lib/server/failover-ai-provider.ts lib/server/provider.ts tests/failover-provider.test.ts tests/provider-factory.test.ts
git commit -m "feat: hedge healthy chat provider nodes"
```

### Task 7: 在服务层持久化行为版本并跳过闲聊重链路

**Files:**
- Modify: `lib/server/chat-service.ts`
- Modify: `lib/server/interaction-log.ts`
- Test: `tests/chat-service-integration.test.ts`

- [ ] **Step 1: 写行为分配、跨意图和 no-RAG 失败测试**

```ts
test('v2 social skips embedding, RAG and search', { skip: !pool }, async () => {
  const provider = new CountingProvider('你好，我是数字 Morse。');
  const events = await consumeChat(chatInput({
    provider,
    message: '你好',
    config: v2Config({ canaryPercent: 100 }),
  }));
  assert.equal(provider.embedCalls, 0);
  assert.equal(provider.answerRequests[0].reasoningEffort, 'low');
  assert.deepEqual(meta(events).sources, []);
});

test('one chat conversation can move from recruiter to social without mismatch', {
  skip: !pool,
}, async () => {
  const first = await completedTurn({ message: '介绍岗位相关项目', audienceIntent: 'recruiter' });
  await assert.doesNotReject(() => completedTurn({
    conversationId: first.conversationId,
    message: '谢谢',
    audienceIntent: 'general',
  }));
});
```

增加 identity 不调用 Embedding、低于 0.45 的来源不进入 prompt/meta、v1 仍走旧 RAG、Session 行首次写入并保持 `chat_behavior_version` 的测试。另加 safe mode 不调用 Embedding/Search 的 spy（零 Provider 终态在 Task 8 固化），以及 v2 master flag 关闭时现有 v2 Session 运行时走 v1、但数据库分配不被改写的测试；master 关闭期间新建且尚未分配的 Session 则持久化为 v1，之后不能在同一 Session 漂到 v2。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
node --env-file-if-exists=.env.local --test --test-name-pattern "v2|social|identity|move from recruiter" tests/chat-service-integration.test.ts
```

Expected: FAIL；当前每轮都 embed，且 conversation 校验 audience/mode。

- [ ] **Step 3: 在 Session 锁内分配行为版本**

先显式扩展 `ChatServiceConfig`，加入 `chatV2Enabled`、`chatV2CanaryPercent`、`chatV2CanaryInviteIds`、`hedgedFailoverEnabled`、`chatSafeMode` 和 `providerTotalTimeoutMs`；Route 只把 `loadServerConfig` 中这些服务端字段传入，不新增任何 `NEXT_PUBLIC_` 配置。

```ts
const behavior = input.config.chatSafeMode
  ? 'safe'
  : !input.config.chatV2Enabled
    ? 'v1'
    : session.chat_behavior_version
      ?? selectChatBehavior({
        safeMode: false,
        v2Enabled: true,
        canaryPercent: input.config.chatV2CanaryPercent,
        accessSessionId: input.accessSessionId,
        inviteCodeId: session.invite_code_id,
        canaryInviteIds: input.config.chatV2CanaryInviteIds,
      });

if (
  behavior !== 'safe'
  && session.chat_behavior_version === null
) {
  await input.client.query(
    'UPDATE access_sessions SET chat_behavior_version = $2 WHERE id = $1',
    [input.accessSessionId, behavior],
  );
}
```

`TurnContext` 携带 behavior。安全模式不覆盖持久分配；关闭 safe 后恢复原 v1/v2。

- [ ] **Step 4: 放宽会话内 audience/mode，保留 workflow 边界**

`validateConversation` 只拒绝 workflow 改变；`validateInteraction` 继续校验同一 `turnId` 的 Session、workflow、问题和 conversation，不再把 audience hint 当幂等身份。

- [ ] **Step 5: 按 route 加载上下文**

```ts
const legacyRoute: TurnRoute = {
  intent: input.request.workflow === 'jd_match' ? 'jd' : 'project',
  profile: input.request.workflow === 'jd_match' ? 'jd' : 'grounded',
  evidence: 'rag',
  release: input.request.workflow === 'jd_match' ? 'complete' : 'segment',
};
const route = turn.behavior === 'v1' ? legacyRoute : routeChatTurn(input.request);

if (turn.behavior === 'safe') {
  knowledge = approvedSafeKnowledge(route.intent);
} else if (route.evidence === 'none') {
  knowledge = [];
} else if (route.evidence === 'identity') {
  knowledge = [identityKnowledgeSource()];
} else {
  const [embedding] = await input.provider.embed([effectiveQuery], input.signal);
  const retrieved = await retrieveKnowledge(lockClient, embedding, input.config.retrievalLimit);
  knowledge = turn.behavior === 'v2'
    ? filterRelevantKnowledge(retrieved)
    : retrieved;
}
```

`approvedSafeKnowledge` 只从审核身份卡和静态公开项目摘要取值，不读取私密简历，也不执行 Embedding/RAG/Search。只有非 safe 且 `route.evidence === 'rag'` 才进入 SearchRouter；social/identity/safe 不发 status `knowledge/web`。Task 8 再把 safe 行为接到确定性终态。

- [ ] **Step 6: 运行测试确认 GREEN**

Run:

```powershell
node --env-file-if-exists=.env.local --test --test-name-pattern "v2|social|identity|move from recruiter|low relevance" tests/chat-service-integration.test.ts
```

Expected: PASS；Session 版本稳定，social 的 embedding/search 调用均为 0。

- [ ] **Step 7: 精确提交**

```powershell
git add -- lib/server/chat-service.ts lib/server/interaction-log.ts tests/chat-service-integration.test.ts
git commit -m "feat: route chat turns by current intent"
```

### Task 8: 接入缓冲守卫、尝试审计、安全降级和额度幂等

**Files:**
- Create: `lib/server/chat-answer-runner.ts`
- Modify: `lib/server/chat-service.ts`
- Modify: `lib/server/provider-attempt-log.ts`
- Test: `tests/chat-answer-runner.test.ts`
- Test: `tests/chat-service-integration.test.ts`

- [ ] **Step 1: 写招聘缓冲、严格重生成和降级失败测试**

```ts
test('recruitment never emits the first rejected candidate', async () => {
  const events = await collect(runGuardedChatAnswer(runnerInput([
    '缺口清单：没有 Kubernetes。下一步：补充。',
    '我最相关的项目是数字 Morse。[来源1]',
  ])));
  assert.equal(deltaText(events), '我最相关的项目是数字 Morse。[来源1]');
  assert.equal(provider.calls, 2);
  assert.equal(provider.requests[1].instructions.includes('严格重生成'), true);
});

test('second guard failure returns a non-consuming safe result', { skip: !pool }, async () => {
  const before = await sessionCount();
  const events = await consumeChat(failingGuardInput());
  assert.equal(done(events).consumed, false);
  assert.equal(done(events).degraded, true);
  assert.equal(await sessionCount(), before);
});

test('a later rejected segment resets provisional text before strict regeneration', async () => {
  const events = await collect(runGuardedChatAnswer(segmentedRunnerInput()));
  assert.deepEqual(events.map((event) => event.type), [
    'delta', 'reset', 'delta', 'complete',
  ]);
  assert.equal(finalVisibleText(events), '严格重生成后的完整回答');
});
```

数据库集成还要断言 safe mode 的生成调用数为 0；每个 attempt 有 alias/启动类型/耗时/状态但没有问题、JD、回答、URL 或 Key；完成 replay 不再调用 Provider 或重复扣额度。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
node --env-file-if-exists=.env.local --test --test-name-pattern "guard|attempt|degraded|winner|safe mode|segment" tests/chat-answer-runner.test.ts tests/chat-service-integration.test.ts
```

Expected: FAIL，runner 和 degraded done 尚不存在。

- [ ] **Step 3: 实现回答 runner**

```ts
export type ChatAnswerRunnerEvent =
  | { type: 'delta'; text: string }
  | { type: 'reset' }
  | {
      type: 'complete';
      answer: string;
      usage: TokenUsage | null;
      degraded: boolean;
      providerAlias: string | null;
    };

export interface ChatAnswerRunnerInput {
  generate(strict: boolean): AsyncIterable<AnswerEvent>;
  inspect(answer: string): ChatGuardResult;
  safeAnswer(): SafeChatAnswer | null;
  canRegenerate(error: unknown): boolean;
}

export async function* runGuardedChatAnswer(
  input: ChatAnswerRunnerInput,
): AsyncGenerator<ChatAnswerRunnerEvent> {
  for (const strict of [false, true]) {
    let answer = '';
    let emitted = false;
    try {
      for await (const event of input.generate(strict)) {
        if (event.type === 'delta') {
          const nextAnswer = answer + event.text;
          if (!input.inspect(nextAnswer).ok) {
            throw new AnswerExecutionError('OUTPUT_GUARD_REJECTED');
          }
          answer = nextAnswer;
          emitted = true;
          yield event;
          continue;
        }
        if (!answer.trim()) throw new AnswerExecutionError('PROVIDER_INCOMPLETE');
        yield {
          type: 'complete',
          answer,
          usage: event.usage,
          degraded: false,
          providerAlias: event.providerAlias ?? null,
        };
        return;
      }
      throw new AnswerExecutionError('PROVIDER_INCOMPLETE');
    } catch (error) {
      if (!input.canRegenerate(error)) throw error;
      if (emitted) yield { type: 'reset' };
    }
  }
  const safe = input.safeAnswer();
  if (safe) {
    yield { type: 'delta', text: safe.text };
    yield {
      type: 'complete',
      answer: safe.text,
      usage: null,
      degraded: true,
      providerAlias: null,
    };
    return;
  }
  throw new AnswerExecutionError('OUTPUT_GUARD_REJECTED');
}
```

`AnswerExecutionError` 已在 Task 6 的 Provider 合同中定义；本任务不得再引入另一套未定义错误类。协调器在 segment 模式只把完整语义段作为 delta 交给 runner，因此上述循环会逐段释放而不是等待整篇。`canRegenerate` 只接受输出守卫拒绝和可重试 Provider 失败，用户 abort、Session、额度和请求校验必须直接退出。严格重生成最多一次；第二次禁用 hedging，防止守卫重试与节点错峰叠加失控。每个 Provider attempt 通过同一 lock client 实时 UPSERT。

- [ ] **Step 4: 在 runChat 中提交正常或降级终态**

`reset` 事件在服务端清空本轮 answer/sources 累加器并映射为 `status:switching`；客户端在 Task 9 同步清空同一个助手占位的临时文本，严格重生成内容从空白位置继续。正常回答沿用 `completeTurn`；提交事务从本 turn 的 attempt 行汇总普通与严格重生成两次 execution 的实际 usage/cost，写入 interaction/usage event，并只扣一次消息额度，不能只相信最终赢家 done 的 usage。

`runChat` 在创建 runner 前处理 safe behavior，不调用 `generate`，直接使用 `safeAnswer`。Provider 全失败或两次守卫失败时新增 `completeDegradedTurn`：将 interaction 标记 `failed`、保存安全摘要和 `SAFE_DEGRADED`，不插入 runtime assistant message、不增加 Session 消息数，但仍从 attempt 行记录真实 Provider usage/cost 并进入成本统计，然后发送 `done consumed:false degraded:true`。纯 safe mode 没有 attempt，usage/cost 保持空。

任何异常进入现有 compensation；attempt 表通过外键保留到 interaction 的 10 天删除时间。

- [ ] **Step 5: 运行 focused 与现有补偿矩阵**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-answer-runner.test.ts tests/chat-service-integration.test.ts
```

Expected: PASS；现有完成、停止、COMMIT 歧义、重放、搜索、诊断和私密简历隔离用例全部保持 GREEN。

- [ ] **Step 6: 精确提交**

```powershell
git add -- lib/server/chat-answer-runner.ts lib/server/chat-service.ts lib/server/provider-attempt-log.ts tests/chat-answer-runner.test.ts tests/chat-service-integration.test.ts
git commit -m "feat: guard and recover chat answers"
```

### Task 9: 扩展 SSE 并让客户端自动重放同一 turn

**Files:**
- Modify: `lib/contracts/chat.ts`
- Modify: `lib/server/chat-route-stream.ts`
- Modify: `lib/client/chat-sse.ts`
- Modify: `lib/client/chat-errors.ts`
- Modify: `components/chat/useMorseChat.ts`
- Test: `tests/chat-sse.test.ts`
- Test: `tests/chat-route-stream.test.ts`
- Test: `tests/chat-ui-contract.test.ts`

- [ ] **Step 1: 写 switching、degraded 和自动重连失败测试**

```ts
test('recoverable stream failure retries the same turn and replaces provisional text', async () => {
  mockFetch
    .respondWith(partialThenError('旧片段', 'PROVIDER_INCOMPLETE'))
    .respondWith(doneStream('恢复后的完整回答'));
  await send();
  assert.deepEqual(requestBodies.map((body) => body.turnId), [TURN_ID, TURN_ID]);
  assert.equal(screen.assistantText(), '恢复后的完整回答');
  assert.equal(screen.userBubbleCount(), 1);
});

test('degraded done remains complete but does not consume quota', async () => {
  const result = await read(doneFrame({ consumed: false, degraded: true }));
  assert.equal(result.degraded, true);
});

test('switching after a delta clears provisional text in the same assistant slot', async () => {
  await read(stream(delta('旧片段'), switching(), delta('新回答'), doneFrame()));
  assert.equal(screen.assistantText(), '新回答');
  assert.equal(screen.assistantBubbleCount(), 1);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
node --test tests/chat-sse.test.ts tests/chat-route-stream.test.ts tests/chat-ui-contract.test.ts
```

Expected: FAIL，contract 没有 `switching` / `degraded`，客户端只提供手动重试。

- [ ] **Step 3: 扩展稳定 SSE 合同**

```ts
export const CHAT_PHASES = [
  'routing', 'knowledge', 'web', 'answering', 'switching', 'handoff',
] as const;

// done event
{
  type: 'done';
  usage: TokenUsage | null;
  budgetLevel: BudgetLevel;
  consumed: boolean;
  degraded: boolean;
  remainingMessages: number;
}
```

`switching` 只作为 status，不写 assistant history。原错误码保留兼容，不向浏览器发送节点别名。

新增仅用于自动重放的窄集合 `AUTO_REPLAY_CHAT_ERROR_CODES`：网络断开、`RETRIEVAL_UNAVAILABLE`、`PROVIDER_UNAVAILABLE`、`PROVIDER_INCOMPLETE`、`CONVERSATION_BUSY` 和临时 `CHAT_UNAVAILABLE`。Session/权限/额度/请求校验/`CONVERSATION_INVALID`/`CONVERSATION_MODE_MISMATCH` 不得自动重放；它们仍可按现有产品规则提供手动操作。

- [ ] **Step 4: 把 sendSnapshot 改为有界循环**

```ts
for (let attempt = 0; attempt < 3; attempt += 1) {
  try {
    await sendOnce(requestSnapshot, assistantId, abortController.signal);
    return;
  } catch (error) {
    const code = normalizeChatErrorCode(error);
    if (
      abortController.signal.aborted ||
      !isAutoReplayChatError(code) ||
      attempt === 2
    ) throw error;
    setPhase('switching');
    resetAssistantForReplay(assistantId);
    await retryDelay(attempt, abortController.signal);
  }
}
```

延迟固定 `250ms / 1000ms`；用户 stop 必须中断 delay 和当前 fetch。重放保持问题、JD、conversationId 和 turnId，清除未持久化片段与旧 sources。服务器在同一 SSE 内发出 `switching` 时也调用同一 reset helper，但不增加 HTTP 重放次数。

- [ ] **Step 5: 改写用户错误文案**

Provider 可恢复期间显示“线路有点慢，我正在切换”。三次均失败才显示“这次线路还没有恢复，问题已经保留，可以重试本次回答”。删除“回答流中断”。

- [ ] **Step 6: 运行测试确认 GREEN**

Run:

```powershell
node --test tests/chat-sse.test.ts tests/chat-route-stream.test.ts tests/chat-ui-contract.test.ts
```

Expected: PASS；一条用户消息、一条助手占位、相同 turnId，服务端 reset 不拼接旧片段，stop/Session/额度/校验错误无额外请求。

- [ ] **Step 7: 精确提交**

```powershell
git add -- lib/contracts/chat.ts lib/server/chat-route-stream.ts lib/client/chat-sse.ts lib/client/chat-errors.ts components/chat/useMorseChat.ts tests/chat-sse.test.ts tests/chat-route-stream.test.ts tests/chat-ui-contract.test.ts
git commit -m "feat: recover interrupted chat turns"
```

### Task 10: 修正入口措辞并完成双宽状态体验

**Files:**
- Modify: `components/chat/ChatWorkspace.tsx`
- Modify: `components/chat/ChatPhaseStatus.tsx`
- Modify: `components/chat/ChatTranscript.tsx`
- Modify: `components/MorseChat.module.css`
- Modify: `components/admin/AdminInviteDialog.tsx`
- Modify: `components/admin/AdminInviteDialog.module.css`
- Modify: `scripts/s10-chat-smoke.mjs`
- Create: `docs/verify/chat-v2/chat-v2-recruitment-desktop-1440x900.png`
- Create: `docs/verify/chat-v2/chat-v2-recruitment-mobile-390x844.png`
- Create: `docs/verify/chat-v2/chat-v2-switching-desktop-1440x900.png`
- Create: `docs/verify/chat-v2/chat-v2-degraded-mobile-390x844.png`
- Test: `tests/chat-ui-contract.test.ts`
- Test: `tests/s10-admin-ui-contract.test.ts`
- Test: `tests/s10-chat-smoke-contract.test.ts`

- [ ] **Step 1: 写入口和状态文案失败测试**

```ts
assert.match(workspace, /介绍与岗位最相关的项目和能力证据/);
assert.doesNotMatch(workspace, /仍需补充的信息/);
assert.match(phaseStatus, /switching: '线路有点慢，我正在切换'/);
assert.match(transcript, /简要结果/);
assert.match(adminInviteDialog, /灰度 ID/);
assert.match(adminInviteDialog, /invite\.id/);
```

浏览器合同新增 desktop/mobile 的 social、recruitment、JD、switching、degraded 和原位 retry 场景；管理员邀请码列表还要验证 UUID 可复制，但一次性邀请码仍只展示一次。保留已落地的邀请备注归属合同：对话列表和详情显示 `inviteLabel`，Session 删除后快照仍存在，桌面与移动详情均可独立滚到底。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
node --test tests/chat-ui-contract.test.ts tests/s10-admin-ui-contract.test.ts tests/s10-chat-smoke-contract.test.ts
```

Expected: FAIL，旧招聘 prompt 和旧状态仍存在。

- [ ] **Step 3: 更新 UI，不重做布局**

招聘 starter 改为：

```ts
prompt: '请介绍与岗位最相关的项目和能力证据。'
```

`ChatPhaseStatus` 增加 switching；`ChatTranscript` 对 degraded done 显示“简要结果”。管理员邀请码列表在认证后的现有行内显示非敏感 UUID，并提供带明确 accessible label 的复制控件；不得把 ID 混入一次性明文输入框或公开页面。CSS 只使用 `app/styles/tokens.css` 中 token，保持现有 44px 控件和 transcript 稳定高度。

- [ ] **Step 4: 扩展 Mock browser harness**

`s10-chat-smoke.mjs` 的 Mock Provider 增加：

- social 请求断言没有 embedding；
- 首节点首字节延迟、备用节点获胜；
- 第一条可见片段后断线、同 turn 原位恢复；
- 两次守卫拒绝后的安全结果；
- 管理员创建邀请码后可分别复制一次性明文和灰度 UUID，访客页面无法读取 UUID 列表；
- 管理员对话列表/详情显示合成邀请备注，详情在 1440x900 / 390x844 均满足 `scrollHeight > clientHeight` 且可滚到底；
- 1440x900 / 390x844 无横向溢出、console/page error 为 0。

- [ ] **Step 5: 运行合同和可视验收**

Run:

```powershell
node --test tests/chat-ui-contract.test.ts tests/s10-admin-ui-contract.test.ts tests/s10-chat-smoke-contract.test.ts
npm run visual:s10
```

Expected: 合同 PASS；Mock 浏览器所有 v1/v2 场景 PASS，两个视口无溢出和错误。

- [ ] **Step 6: 人工检查截图**

逐张检查招聘长回答、JD、switching 和 degraded 状态；确认文本不遮挡按钮、来源或下一条消息，移动端没有横向压缩。

- [ ] **Step 7: 精确提交**

```powershell
git add -- components/chat/ChatWorkspace.tsx components/chat/ChatPhaseStatus.tsx components/chat/ChatTranscript.tsx components/MorseChat.module.css components/admin/AdminInviteDialog.tsx components/admin/AdminInviteDialog.module.css scripts/s10-chat-smoke.mjs tests/chat-ui-contract.test.ts tests/s10-admin-ui-contract.test.ts tests/s10-chat-smoke-contract.test.ts docs/verify/chat-v2/chat-v2-recruitment-desktop-1440x900.png docs/verify/chat-v2/chat-v2-recruitment-mobile-390x844.png docs/verify/chat-v2/chat-v2-switching-desktop-1440x900.png docs/verify/chat-v2/chat-v2-degraded-mobile-390x844.png
git commit -m "fix: make digital Morse chat natural and recoverable"
```

只加入上面四张由本轮 harness 明确生成且人工检查过的证据文件；不得 broad-add 任何证据目录。

### Task 11: 重写离线评测并固化三条真实反馈

**Files:**
- Modify: `content/chat-eval.json`
- Modify: `scripts/chat-eval.mjs`
- Modify: `tests/s10-chat-eval.test.ts`
- Create: `content/chat-review-cases.json`
- Create: `scripts/chat-review-score.mjs`
- Test: `scripts/chat-review-score.test.mjs`

- [ ] **Step 1: 写评测合同失败测试**

```ts
assert.equal(dataset.cases.length, 72);
assert.equal(dataset.cases.filter((item) => item.feedbackRegression).length, 3);
assert.equal(source.includes("answer.includes('下一步')"), false);
assert.equal(source.includes('/不足|无法|不会|边界/'), false);
```

三条 feedback regression 固定为：招聘措辞过直、数字 Morse 像开发助手、Provider 回答失败。新增 social、identity、recruitment-positive、explicit-unknown、no-rag 和 recovery 类别。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
node --test tests/s10-chat-eval.test.ts scripts/chat-review-score.test.mjs
npm run chat:eval
```

Expected: FAIL；当前 54 例验证器强制“边界 + 下一步”。

- [ ] **Step 3: 将验证器改成按场景检查**

```js
const validators = {
  social: validateSocial,
  identity: validateIdentity,
  grounded: validateGrounded,
  recruitment: validateRecruitment,
  explicit_unknown: validateExplicitUnknown,
  refuse: validateSafetyRefusal,
};

function validateRecruitment(answer, item) {
  return hasValidCitations(answer, item.sourceCount)
    && !hasGapList(answer)
    && !hasMatchPercentage(answer)
    && countInterviewConfirmations(answer) <= 2
    && item.requiredAnswerFragments.every((fragment) => answer.includes(fragment));
}
```

输出仍只报告 case ID/category/pass，不打印 raw prompt 或 answer，`externalCalls` 必须为 0。

- [ ] **Step 4: 增加人工评分输入和计算器**

`chat-review-cases.json` 固定 20 条合成问题，覆盖五个评分维度。`chat-review-score.mjs` 只读取人工填写的 1-5 分 JSON，检查每维平均 ≥4、总体 pass ≥90%、三项零容忍为 0；它不调用模型。

- [ ] **Step 5: 运行测试确认 GREEN**

Run:

```powershell
node --test tests/s10-chat-eval.test.ts scripts/chat-review-score.test.mjs
npm run chat:eval
```

Expected: `72/72`、`externalCalls: 0`，且输出不包含回答正文。

- [ ] **Step 6: 精确提交**

```powershell
git add -- content/chat-eval.json content/chat-review-cases.json scripts/chat-eval.mjs scripts/chat-review-score.mjs scripts/chat-review-score.test.mjs tests/s10-chat-eval.test.ts
git commit -m "test: evaluate natural evidence-led chat"
```

### Task 12: 完成生产配置合同、运行手册和安全回滚

**Files:**
- Modify: `lib/server/production-config.ts`
- Modify: `tests/production-config.test.ts`
- Modify: `scripts/s11-production-contract.test.mjs`
- Modify: `docs/runbooks/production.md`
- Modify: `docs/runbooks/tencent-lighthouse.md`

- [ ] **Step 1: 写生产配置失败测试**

覆盖：

- v2 开启但 canary 超界、invite ID 非 UUID，或值仍含 `$...`/尖括号占位时拒绝启动；空白名单作为 disabled-first 安全值允许启动；
- safe mode 可在 hedging 开启时覆盖生成；
- fallback 节点不完整仍拒绝；
- 新变量没有 `NEXT_PUBLIC_` 前缀；
- 旧镜像可忽略 additive `005` / `006`。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
node --test tests/production-config.test.ts scripts/s11-production-contract.test.mjs
```

Expected: FAIL，生产 validator 和 runbook 还不知道 v2 开关及 migration 005 / 006。

- [ ] **Step 3: 更新生产合同**

`production-config.ts` 调用与 `loadServerConfig` 相同的解析规则；不得输出 canary invite IDs、Provider URL 或 Key。readiness 只验证格式，不执行 Provider 调用。生产合同测试必须证明空值和真实 UUID 列表可通过，而带 `$` 或尖括号的未解析引用 fail closed。

- [ ] **Step 4: 更新两份 runbook**

记录精确顺序：

1. 首次发布使用 `MORSE_CHAT_V2_ENABLED=true`、`MORSE_CHAT_V2_CANARY_PERCENT=0`、空 `MORSE_CHAT_V2_CANARY_INVITE_IDS`、`MORSE_CHAT_HEDGED_FAILOVER_ENABLED=false`、`MORSE_CHAT_SAFE_MODE=false`，先证明无人进入 v2。
2. 部署新管理 UI 后创建专用聊天邀请码；一次性明文只留在当前浏览器，复制后台显示的非敏感灰度 UUID。
3. 把该实际 UUID 直接写入服务器 `.env.production` 的 `MORSE_CHAT_V2_CANARY_INVITE_IDS`，用不回显值的 UUID 格式检查通过后只重启 Web；不得使用环境变量占位符代替实际值。
4. 先在 hedging 关闭时完成已授权的 20 轮真实输出评审，再单独启用 hedging 做故障注入。
5. `MORSE_CHAT_V2_CANARY_PERCENT=25` / `100` 分阶段重启 Web 和观察。
6. 人格或证据异常切 `MORSE_CHAT_SAFE_MODE=true`；成本异常只切 `MORSE_CHAT_HEDGED_FAILOVER_ENABLED=false`；隐私问题切 `MORSE_CHAT_ENABLED=false`。
7. `005` / `006` 均为 additive migration，不执行 down migration；`006` 只增加并回填非敏感邀请备注快照。

历史生产状态保持历史事实，不提前写成 v2 已上线。

- [ ] **Step 5: 运行测试确认 GREEN**

Run:

```powershell
node --test tests/production-config.test.ts scripts/s11-production-contract.test.mjs
git diff --check
```

Expected: PASS，文档无占位、无凭据、无假上线声明。

- [ ] **Step 6: 精确提交**

```powershell
git add -- lib/server/production-config.ts tests/production-config.test.ts scripts/s11-production-contract.test.mjs docs/runbooks/production.md docs/runbooks/tencent-lighthouse.md
git commit -m "docs: govern chat v2 production rollout"
```

### Task 13: 本地完整验收、CRITICAL 双视图审查和 closeout

**Files:**
- Modify only when evidence requires: scoped implementation/test/docs files
- Create: `docs/verify/chat-v2/chat-v2-local-closeout.md`
- Create: only the named screenshots produced by the accepted browser harness

- [ ] **Step 1: 运行 focused 边界集**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/chat-behavior.test.ts tests/chat-persona.test.ts tests/chat-output-guard.test.ts tests/chat-safe-answer.test.ts tests/provider-health.test.ts tests/failover-provider.test.ts tests/provider-attempt-log.test.ts tests/openai-provider.test.ts tests/chat-sse.test.ts tests/chat-route-stream.test.ts tests/chat-ui-contract.test.ts tests/s10-chat-eval.test.ts
```

Expected: 全部 PASS、0 skip（数据库专属测试除非命令未提供数据库；该情况不能替代下一步集成）。

- [ ] **Step 2: 运行数据库与主链集成**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/migration-integration.test.ts tests/chat-service-integration.test.ts tests/resume-isolation.test.ts
```

Expected: migration 001-006 幂等、Chat 主链和私密简历隔离全部 PASS；不得用 skip 宣称数据库已验收。

- [ ] **Step 3: 运行最终出口检查一次**

Run:

```powershell
npm test
node --env-file-if-exists=.env.local scripts/rag-eval.mjs
npm run chat:eval
npm run build
npm run visual:s10
git diff --check
```

随后用独立端口启动一次 `npm run dev`，观察 ready、首页 200 后正常停止。Expected: 全量 0 fail/0 skip；本地 BGE RAG 阈值通过且无外部付费调用；Chat `72/72 externalCalls:0`；production build 与 dev smoke 完成；双宽 browser 0 console/page error。

- [ ] **Step 4: 执行 CRITICAL 合规视图**

检查：私密简历不可达、没有凭据/Provider URL/raw prompt 写入 attempt 表或日志、真实调用未发生、权限和 Cookie scope 未扩大、所有 kill switch fail closed。

- [ ] **Step 5: 执行 CRITICAL 质量/安全视图**

检查：意图切换、引用守卫、未知项上限、segment 逐段释放、最多两个节点在途、loser cleanup、24h 15% hedge 预算、串行 failover 不被预算阻断、turnId 幂等、COMMIT 歧义、自动重连、safe 零 Provider 和 v1 回退。

- [ ] **Step 6: 修复 admitted blockers 并只复测修正边界**

最多三轮。每轮记录根因、修改路径和使旧证据失效的边界；不得把风格偏好升级成 blocker。

- [ ] **Step 7: 写本地 VerificationReceipt**

`chat-v2-local-closeout.md` 记录 commit、命令、精确计数、截图、开放外部门槛和“未调用 Provider/未 push/未部署”。不得记录真实问题、回答、邀请码或凭据。

- [ ] **Step 8: 使用 closeout 精确提交**

只暂存 Task 13 产生且人工检查过的 receipt/截图和修正文件；执行 `neat-freak`，将知识结论标为 `updated` 或 `checked-no-change`。记录本地 commit，不吸收主线、不 push。

### Task 14: 经单独授权后执行真实输出评审、灰度、push 和部署

> 2026-07-22 release 接管状态：`codex/chat-v2-release` worktree 已创建并完成 source 提交集成。push、远端 `master` 吸收、生产备份、migration 005/006 和 disabled-first 部署已获本轮授权；固定 20 轮真实 Provider 评审仍未授权，调用数保持 0。

**Files:**
- Modify after observed evidence: `docs/verify/chat-v2/chat-v2-production-closeout.md`
- Modify after observed evidence: `docs/task-center/run-state.md`
- Modify after observed evidence: `docs/portfolio-blueprint.md`
- Modify after observed evidence: `docs/runbooks/production.md`
- Modify after observed evidence: `docs/runbooks/tencent-lighthouse.md`

- [ ] **Step 1: 停在付费调用授权边界**

向用户报告本地 commit、测试、Mock 浏览器和开放风险，请求明确授权固定 20 轮合成问题的真实 Provider 调用。未授权时本计划在 `LOCAL_READY / BLOCKED_EXTERNAL` 停止，不试探 Key、不调用 `/responses`。

- [ ] **Step 2: 停在 push 和部署授权边界**

报告将要 push 的冻结 commit、远端分支、migration 005 / 006、配置变化、回滚开关和预计 Provider 重复成本。没有明确授权不得 push、合并或 SSH。

- [ ] **Step 3: 在独立 release worktree 吸收并 push 精确提交**

现有 release worktree 为 `E:\Revolution\.worktrees\chat-v2-release`，分支为 `codex/chat-v2-release`。不得重新创建 worktree、重复 cherry-pick source 提交或触碰已被其他任务占用且分叉的本地 `master`。先精确提交当前 owned release 修正，再刷新远端引用并把最新 `origin/master` 合并到 release；解决合同冲突后重新执行受影响出口检查：

```powershell
$releasePath = 'E:\Revolution\.worktrees\chat-v2-release'
git -C $releasePath fetch origin --prune
$base = (git -C $releasePath rev-parse origin/master).Trim()
git -C $releasePath merge --no-edit origin/master
```

完成验证和 CRITICAL correction delta 双审查后再次 fetch；只有 `origin/master` 仍等于 `$base`、release worktree 无未提交文件且检查通过，才按用户明确授权执行普通快进 push：

```powershell
git -C $releasePath fetch origin --prune
if ((git -C $releasePath rev-parse origin/master).Trim() -ne $base) { throw 'origin/master moved.' }
if (git -C $releasePath status --porcelain) { throw 'Release worktree is dirty.' }
git -C $releasePath push origin codex/chat-v2-release
git -C $releasePath push origin HEAD:master
```

Expected: 远端 `codex/chat-v2-release` 与 `master` 指向同一已验证 release HEAD；push 是基于最新远端主线的普通快进，不使用 force。本地共享 `master`、source 分支和其他 worktree 未改动。

- [ ] **Step 4: 冻结 release 并执行 disabled-first 发布**

发布初始配置：

```text
MORSE_CHAT_V2_ENABLED=true
MORSE_CHAT_V2_CANARY_PERCENT=0
MORSE_CHAT_V2_CANARY_INVITE_IDS=
MORSE_CHAT_HEDGED_FAILOVER_ENABLED=false
MORSE_CHAT_SAFE_MODE=false
```

按 `docs/runbooks/tencent-lighthouse.md` 在冻结 commit 上执行：

```bash
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d db embedding
docker compose --env-file .env.production -f compose.production.yaml run --rm migration
docker compose --env-file .env.production -f compose.production.yaml --profile ops run --rm grants
docker compose --env-file .env.production -f compose.production.yaml run --rm ingest
docker compose --env-file .env.production -f compose.production.yaml up -d web worker edge
```

Expected: migration 005 / 006 each registered once，旧数据保留且仍可关联的历史对话已回填邀请备注，live/ready 200，公开页面和 v1 会话可用；白名单为空且 canary 为 0，因此没有 Session 进入 v2。不得启用私密简历或执行无关真实 Bocha/Feishu。

- [ ] **Step 5: 注入实际管理员白名单并完成 20 轮真实输出评审**

在已部署的新管理后台创建专用 Chat 邀请码。一次性明文只在当前浏览器使用，不进入终端、日志、文档或截图；从同一行复制非敏感灰度 UUID，把该实际值直接写入服务器 `.env.production` 的 `MORSE_CHAT_V2_CANARY_INVITE_IDS`。先用不回显值的格式检查证明它是单个规范 UUID，再只重启 Web；格式检查失败或值为空时不得继续。重启后才兑换邀请码，确保新 Session 被稳定分配到 v2。

保持 hedging 关闭，按 `content/chat-review-cases.json` 完成已授权的 20 轮并人工评分：

```powershell
node scripts/chat-review-score.mjs "$env:TEMP\morse-chat-v2-scores.json"
```

Expected: 每维平均 ≥4/5、整体 ≥90%、缺口清单/虚构事实/私密泄露均为 0。评分 JSON 验收后从受控临时目录删除，只保留汇总计数。

- [ ] **Step 6: 启用 hedging 并验证受控故障**

设置 `MORSE_CHAT_HEDGED_FAILOVER_ENABLED=true`，只重启 Web；完成受控节点延迟/失败场景。确认最多两个节点在途、winner 唯一、24 小时投机 hedge 比例 ≤15%、预算饱和后串行 failover 仍可用、重复扣额度为 0。

- [ ] **Step 7: 执行 25% 稳定 Session 灰度**

设置 `MORSE_CHAT_V2_CANARY_PERCENT=25`，观察至少 24 小时且至少 50 个完成轮次。每个窗口报告分子/分母：

- 完整回答成功率 ≥99%；
- 用户可见终态断流 <0.5%；
- social P95 ≤5s；
- grounded/JD P95 ≤15s；
- 重复扣额度、虚构事实、隐私泄露为 0；
- 投机 hedge 调用比例 ≤15%。

任一硬门失败即停止扩大；人格/证据异常切 safe，成本异常关 hedging，隐私异常关 Chat。

- [ ] **Step 8: 执行 100% 并观察 48 小时**

25% 门槛通过后设置 `MORSE_CHAT_V2_CANARY_PERCENT=100`。已有 v1 Session 保持原分配直至 12 小时过期，新 Session 进入 v2。观察 48 小时并重复同一指标。

- [ ] **Step 9: 公网和浏览器最终观察**

Run on the release host:

```bash
curl -fsS https://aimorse.tech/api/health/live
curl -fsS https://aimorse.tech/api/health/ready
MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke
docker compose --env-file .env.production -f compose.production.yaml ps
```

在 1440x900 和 390x844 观察 social、招聘、JD、switching、degraded、重试和来源；console/page error 为 0。对生产域名重跑 Lighthouse mobile/desktop，记录工具版本与实际分数，Performance 均须 ≥90。

- [ ] **Step 10: 只按已观察事实同步知识并 closeout**

更新生产 receipt、Task Center、蓝图和两份 runbook；分别记录 commit、push、主线吸收、release 指针、migration、真实调用数量、SLO 窗口和残余风险。通过 `closeout` 和 `KNOWLEDGE_RECONCILED` 后才声明 `OBSERVED`。

## 完成定义

该计划只有在以下全部成立时完成：

- v2 行为、可靠性、评测和 UI 本地证据通过；
- 用户授权的真实输出评审通过；
- push/部署实际发生并指向冻结 commit；
- 25% 和 100% 两阶段达到明确样本与时间门槛；
- 公网行为已观察；
- 文档只陈述真实达到的边界。
