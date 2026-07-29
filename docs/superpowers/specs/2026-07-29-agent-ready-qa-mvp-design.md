# 数字 Morse Agent-ready 基础问答 MVP 设计

日期：2026-07-29

状态：产品与架构方向已确认；规格冻结，等待另行授权实施

规格固化合同：`STAGED / FAST / LOCAL`

后续实施建议合同：`STAGED / CRITICAL / DEPLOYED`

授权边界：本文档不授权产品代码修改、真实 Provider 调用、数据库操作、push、部署或生产灰度

## 1. 结论

本轮不接 Skills、不新增联网搜索、不建设完整 Agent 工具循环。先把最基础的问答链路改造成一个单一、可解释、不会因质量规则拒绝正常答案的 MVP：

```text
ConversationSession
  -> TurnPlanner
  -> EvidenceCatalog
  -> DirectAnswerExecutor
  -> AnswerValidator
  -> successful transactional commit
  -> SSE answer + done
```

它解决的不是某一个问法，而是当前系统中“语义、任务、证据、Prompt、生成和输出判定分散在多处”的结构问题。首版 `TurnPlanner` 是确定性的，不增加一次 LLM 规划调用；首版只有 `DirectAnswerExecutor`，但它的输入输出合同允许未来增加 Agent 执行器，而不需要再次推翻会话、证据和事务层。

## 2. 适用范围与覆盖关系

`docs/portfolio-blueprint.md` 继续是项目级唯一需求权威。本文在基础问答架构范围内覆盖以下旧实现或旧设计倾向：

- 继续在 `chat-service.ts` 内增加问法特判、路由补丁和证据补丁。
- 让 route、RAG 分数或 output guard 决定一个已审核事实是否能到达模型。
- 用格式、语气、模板、项目数量或引用样式规则丢弃 Provider 已完成的非空回答。
- 为了规划意图再增加一次 Provider/LLM 调用。
- 在当前输入、审核证据、历史、输出或 Provider attempt 上重新增加成本驱动的固定上限。

以下现有合同继续有效，并作为本设计的前置基础：

- V2.1 Task Frame、completed-only 历史、失败轮不污染和同 `turnId` 幂等。
- V2.2 Context Packet、受控 JD 槽位、Final Projection、HMAC 和成功后原子推进。
- migration `013` 的动态 Provider 上下文、完整轮次压缩、真实模型窗口溢出恢复和 Provider 串行 failover。
- 审核公开项目、脱敏 `profile.resumeFacts`、私密简历隔离和受控 Search 的安全边界。
- Provider 路由快照、调用前 attempt 记录、取消、超时、真实模型能力和事务一致性。

## 3. 当前流程和根因

### 3.1 当前流程

当前 `lib/server/chat-service.ts` 同时承担 Session 锁、turn 预留、V1/V2/V2.2 选择、语义解析、旧 route 兼容、Task Frame、证据规划、RAG、Search、Prompt、Context Packet、Provider 协调、attempt 审计、持久化和 SSE。它已经超过 3,400 行。

实际热路径近似为：

```text
请求
  -> 预留 turn / 选择 legacy、V2 或 V2.2
  -> semantic resolver + route policy + Task Frame
  -> evidence planner + capability ledger + RAG/Search
  -> projection + Context Packet + Prompt
  -> Provider runner + dynamic context/failover
  -> completeTurn transaction
  -> SSE done
```

虽然 V2.2 已修正一批具体 badcase，但“这一轮到底要回答什么、需要哪些事实、事实边界是什么”仍分别存在于 semantic decision、legacy route、Task Frame、capability policy、evidence planner、Prompt 和历史质量规则中。于是同一语义只要换一种表达，就可能走到另一条分支；某一层没有识别别名时，后续层看到的是“没有证据”，而不是“规划信息不完整”。

### 3.2 频繁返工的结构原因

1. **没有单一本轮计划。** 每一层都在重新猜问题类型和对象，局部修复不能约束后续层。
2. **事实目录不统一。** 能力 ID、别名、项目映射、脱敏简历事实和不可确认边界分散在 JSON、项目内容和代码常量中。
3. **相关性被误当成事实准入。** RAG 低分或别名漏识别会让已审核事实根本到不了模型。
4. **服务编排与业务规则耦合。** 修改一个招聘问法会触及 Session、路由、证据、Prompt、事务和 SSE，难以证明没有旁路。
5. **过去的 output guard 试图在生成后补救规划错误。** 规则只能识别表面格式，不能真正理解回答；结果是“可能不够好”被升级为“不给用户回答”。
6. **代码测试和真实回答效果没有同一观察合同。** 路由、sources 和健康状态通过，不等于用户看到的答案正确。

## 4. 目标、非目标与不变量

### 4.1 目标

- 每个 Provider-backed turn 在调用模型前形成一个唯一、可审计的 `TurnPlan`。
- `TurnPlan` 只组织语义、任务和证据需求，不修改或删减用户原文。
- HR、JD、岗位适配和项目经验回答拿到全部审核项目与全部审核脱敏职业事实；相关性只用于排序提示，不用于删除事实。
- 正常、非空、协议完成的 Provider 回答不会因风格、格式、模板、项目数量、引用样式或“看起来不够直接”而被拒绝。
- 输出验证只保留事实覆盖、引用有效性、未支持能力边界、隐私和 Secret 检查，并明确区分“质量告警”和“安全阻断”。
- `chat-service.ts` 收缩为 Session/turn/SSE 外壳；规划、证据、执行和验证各有一个责任明确的模块。
- 当前 Direct Q&A 能稳定运行；以后增加 Skills、联网工具或 Agent loop 时，只新增 Executor，不重写 Session、TurnPlan、EvidenceCatalog、Validator 和事务合同。

### 4.2 非目标

- 不实现 Skills 注册、发现、执行或权限模型。
- 不新增联网搜索功能；现有受控 Search 保持现状。
- 不实现 ReAct、工具循环、子 Agent、多 Agent、长期记忆或自主任务分解。
- 不增加一个 LLM planner、LLM router 或 LLM-as-judge 调用。
- 不重做 Provider 管理、动态上下文压缩、RAG 模型或前端 UI。
- 不以本次架构重整为理由修改数据库 schema；`TurnPlan` 和验证元数据写入现有 `interaction_turns.context_manifest`。
- 不把原始私密简历、公司私密信息、Search 原文、Provider payload 或 Secret 纳入新目录。

### 4.3 不变量

1. 当前用户输入完整保留，不能被 planner、RAG、预算或 validator 删除、摘要或改写。
2. Task Frame 和 completed-only 历史继续是会话状态权威；`TurnPlan` 不能创建第二套会话记忆。
3. 已审核事实是否存在由 `EvidenceCatalog` 决定，不由相似度分数决定。
4. RAG 可以排序或补充公开 chunk，但不能否定或移除目录中已审核的项目和职业事实。
5. 正常生成只有回答 Provider，不增加规划 Provider。
6. 非空回答的质量告警不能改变 completed 状态，不能触发 strict、reset、额外生成、Provider incident 或失败补偿。
7. 只有 Secret/私密数据泄漏可以在输出前安全阻断；这是不可逆信息安全边界，不是回答风格门禁。
8. Provider 空输出、协议不完整、真实模型窗口不足、取消、超时和持久化失败仍是执行失败，不伪装成质量拒答。
9. 成功事务提交前不发送回答正文；提交成功后一次释放正文并发送 `done`。同 `turnId` 重试重放已提交答案，不重复调用 Provider。

## 5. 目标架构

```text
API / SSE
  |
  v
chat-service.ts
  - 鉴权、Session 锁、turn reserve/replay、状态事件
  |
  v
ConversationSessionSnapshot
  - 当前原文、当前 Frame、相邻 completed turn、同作用域 completed history
  |
  v
TurnPlanner (deterministic)
  - intent、discourse、task transition、evidence requirement、executor kind
  |
  v
EvidenceCatalog + EvidencePlanner
  - 审核项目、脱敏职业事实、能力别名、直接/可迁移/不可确认边界
  - RAG 只附加 relevance，不做事实准入
  |
  v
CanonicalAnswerSourceV2 / Context Packet / HMAC
  |
  v
DirectAnswerExecutor
  - 复用 Provider snapshot、动态上下文、完整轮压缩、串行 failover
  - 返回完整 AnswerCandidate，不直接向用户释放正文
  |
  v
AnswerValidator
  - quality warning: coverage/citation/unsupported-boundary
  - hard block: private data/secret only
  |
  v
success transaction
  - assistant message、turn completed、Task Frame、manifest、attempt projection
  |
  v
SSE delta + done
```

`chat-service.ts` 不再拥有语义决策、证据选择、Prompt 内容或答案质量规则。它只协调生命周期和把领域结果映射成 SSE。

## 6. ConversationSession 合同

`ConversationSessionSnapshot` 是一次 turn 的只读输入快照，不是新数据库实体：

```ts
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

装载规则：

- `currentInput` 来自 reserve transaction 已持久化的当前 user message，逐字保留。
- `adjacentCompletedTurn` 只允许同 conversation 的最近 completed user/assistant 对，不受旧 route 限制。
- `completedHistory` 只允许当前作用域下 completed 的完整问答对；`running/failed/stopped/orphan` 不进入。
- `pageContext` 只保留服务端校验的公开 slug/枚举，不接受客户端自由文本成为事实。
- Snapshot 在本轮内冻结；Provider failover 和动态压缩不能重新加载并改变语义输入。

## 7. TurnPlan 合同

### 7.1 设计原则

`TurnPlan` 是“这一轮准备怎么回答”的唯一权威，不是自由文本计划，也不是模型思维链。它必须可序列化、可版本化、可用确定性测试覆盖。

首版建议合同：

```ts
export const TURN_PLAN_VERSION = 'turn-plan-v1' as const;
export const TURN_PLANNER_VERSION = 'deterministic-turn-planner-v1' as const;

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

`TurnPlan` 不复制 `currentInput`；Executor 必须从同一个冻结 Snapshot 接收原文。manifest 只保存受约束投影，不保存 `candidateFrame` 槽位原文、输入或自由文本 reason。

### 7.2 生成方式

`TurnPlanner` 复用现有 V2.2 semantic resolver、Task Frame 转换和确定性别名匹配。它不调用 Provider，也不解析 JSON 模型输出。原因是当前 Provider adapter 只保证流式文本，对 strict JSON Schema/`response_format` 没有统一协议合同；为一个基础问答再增加规划调用会增加延迟、故障面和不可测试分支。

规划顺序固定为：

1. 显式 workflow、安全边界和服务端页面上下文。
2. 当前输入中命名的项目、能力、JD 或外部对象。
3. 当前 Task Frame 与相邻 completed turn 的受控承接。
4. 自包含问题按当前问题直接回答。
5. 只有缺失唯一指代对象时进入 `clarify`。

### 7.3 Planner 的权限边界

Planner 可以：

- 选择 intent、task transition、证据范围和 `direct` executor。
- 为证据排序提供受控 capability/project IDs。
- 产生稳定 reason codes 供测试和观测。

Planner 不可以：

- 返回 `reject`、`deny`、`drop_input` 或任何内容门禁动作。
- 删除、截断、总结或改写当前用户输入。
- 删除 Catalog 已批准的证据。
- 根据成本、token 预算或 RAG 分数缩窄 `portfolio_full`。
- 生成自然语言 Prompt、答案模板或风格检查表。
- 修改数据库；候选 Task Frame 仍只在回答成功事务中提交。

## 8. EvidenceCatalog 合同

### 8.1 单一目录

新增 `content/chat-evidence-catalog.json` 作为 Chat 证据标识目录，最终替代 `content/chat-capability-policy.json` 和代码中的手写项目别名。实际项目/职业事实正文仍只存在于 `content/site-content.json`，目录只保存稳定引用，不复制事实文本。

目录包含：

- 项目 slug、显示名和受控别名。
- capability ID、显示名和受控别名。
- capability 到审核项目或 `resumeFactId` 的明确 evidence references。
- `direct / transferable / unavailable` 关系和允许的事实边界。
- 版本号和稳定顺序。

建议结构：

```json
{
  "version": 2,
  "projects": [
    {
      "slug": "digital-morse",
      "aliases": ["数字 Morse", "数字摩斯", "digitalmorse"]
    }
  ],
  "capabilities": [
    {
      "id": "ai-programming-collaboration",
      "label": "AI 编程协作",
      "aliases": ["Vibe Coding", "AI 编程协作", "AI 辅助编程"],
      "evidenceRefs": [
        { "kind": "resume_fact", "resumeFactId": "ai-application-role", "level": "direct" }
      ],
      "unavailableBoundary": null
    }
  ]
}
```

编译时 fail closed：重复 ID、归一化别名冲突、未知 project slug、未知 resume fact、空引用、自引用 transfer 或事实披露级别不合法都使应用构建/启动失败。运行时不得从任意叙述临时推断新的 direct evidence。

### 8.2 EvidenceBundle

EvidencePlanner 的输出从“按分数筛出的 knowledge 数组”升级为显式 bundle：

```ts
export interface EvidenceBundle {
  catalogVersion: 2;
  approved: readonly KnowledgeSource[];
  admissions: readonly EvidenceAdmission[];
  relevance: readonly { evidenceId: string; score: number | null }[];
  unavailableCapabilityIds: readonly string[];
  degradedReason: 'embedding' | 'retrieval' | null;
}
```

`approved` 是事实准入结果；`relevance` 是排序提示。二者不能再用同一个数组或 threshold 表达。

### 8.3 证据选择矩阵

| TurnPlan evidence | 必须进入 Context Packet | RAG 作用 |
| --- | --- | --- |
| `none` | 无个人事实证据 | 不调用 |
| `identity` | 审核身份资料 | 不调用 |
| `portfolio_full` | 全部审核项目 + 全部审核脱敏 `resumeFacts` | 可排序、不可删除 |
| `named_projects` | 所有命名审核项目 + 目录中直接关联的职业事实 | 可补充项目 chunk、不可替换结构化项目 |
| `capabilities` + `includePortfolio=true` | 全部审核项目 + 全部审核脱敏职业事实 + 问到但无证据的 capability boundary | 可排序、不可删除 |
| `controlled_search` | 现有受控 Search 冻结结果 | 保持现有 Search 合同 |

HR、recruiter、JD、项目适配、项目经历和岗位能力问题统一使用 `portfolio_full` 或 `capabilities + includePortfolio=true`。即使 Embedding 故障、相似度低或某个别名没有命中，模型仍能看到全部审核项目和职业事实；Planner/Validator 可以把别名漏识别记录为质量信号，但不能把它解释成“事实不存在”。

## 9. DirectAnswerExecutor 合同

### 9.1 首版唯一执行器

首版只实现 `DirectAnswerExecutor`：

```ts
export interface AnswerExecutionInput {
  session: ConversationSessionSnapshot;
  plan: TurnPlanV1;
  evidence: EvidenceBundle;
  canonicalSource: CanonicalAnswerSourceV2;
}

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

它复用现有 Provider target snapshot、`CanonicalAnswerSourceV2`、动态上下文、完整轮次压缩、HMAC、attempt 记录、串行 failover、取消和超时合同。它不拥有 Session、Task Frame 写入、证据准入或输出判定。

### 9.2 释放边界

Provider delta 在服务端内存中累计为完整 candidate；期间只允许向 SSE 发送 `status/activity/switching`，不能发送正文。Provider 协议完成且正文非空后，candidate 才进入 Validator 和 success transaction。

成功事务提交后：

1. 发送一次 `delta`，内容为已提交的完整答案。
2. 发送 `done`。
3. 连接中断后，同一 `turnId` 重放数据库中已提交的答案。

这牺牲逐 token 显示，但换来一个清楚的事实：用户看到的答案必然是已验证、已持久化、可重放的答案。基础 MVP 先保证正确终态；后续若恢复语义段流式，需要单独设计可撤销/可恢复协议，不能偷渡回本轮。

## 10. AnswerValidator 合同

### 10.1 两类结果

```ts
export type AnswerValidationIssueCode =
  | 'missing_evidence_coverage'
  | 'invalid_citation'
  | 'unsupported_capability_claim'
  | 'private_data_leak'
  | 'secret_leak';

export interface AnswerValidationResult {
  verdict: 'pass' | 'warn' | 'block';
  issues: readonly {
    code: AnswerValidationIssueCode;
    evidenceId: string | null;
  }[];
}
```

### 10.2 质量告警不拒答

以下问题只产生 `warn`，答案仍然 completed、持久化并交付：

- 没有覆盖 Planner 要求的全部项目或能力。
- 内联引用缺失、编号越界或没有覆盖全部来源。
- 回答对目录中 `unavailable` 的能力作了直接经历声称。

这些信号进入 `context_manifest` 的稳定 issue codes 和离线/管理分析，不保存回答正文或自由文本解释。它们不能触发第二次生成、strict、reset、failover、Provider incident、配额补偿或公共错误。

质量的主要保证来自生成前的完整证据和明确 Prompt，不再依靠生成后丢弃答案。

### 10.3 唯一硬阻断

只有以下两类返回 `block`：

- 输出含已知私密简历 canary、受保护联系方式/身份数据或本轮不应可达的私密字段。
- 输出含 Secret、API key、Authorization、数据库凭据或其他已知凭据模式。

硬阻断发生在任何正文释放前。turn 进入稳定安全失败并执行现有补偿；日志只记录 issue code，不记录命中内容。引用无效、事实覆盖不足或语言不理想都不得升级为安全阻断。

原 `chat-output-guard.ts` 的 voice、模板重复、主动缺口、固定下一步、route format、开头直接性和项目数量规则不进入新 Validator。所有消费者迁移后删除该文件及对应测试，而不是保留一套“暂时不用”的第二权威。

## 11. Prompt 和 Context Packet

Prompt 由 `TurnPlan + EvidenceBundle + ConversationSessionSnapshot` 构建，固定信任分区：

```text
<policy>可信系统边界</policy>
<turn_plan>受约束 plan 投影</turn_plan>
<task_frame>受约束任务状态</task_frame>
<task_inputs>用户提供的不可信数据</task_inputs>
<approved_evidence>审核事实</approved_evidence>
<unavailable_boundaries>被明确询问但无审核事实的 capability IDs</unavailable_boundaries>
<history>completed-only 完整历史或私有摘要</history>
<current_input>当前原文，恰好一次</current_input>
```

要求：

- `current_input` 在 canonical source 中恰好一次且不可裁剪。
- `portfolio_full` 的全部项目和全部脱敏职业事实进入 `approved_evidence`，不按 Top-K 删除。
- RAG score 只出现在 relevance metadata，不写成“有/无经历”的判断。
- TurnPlan 不包含自然语言答案模板。
- `<turn_plan>` 由服务端从受约束字段稳定序列化到现有 `CanonicalAnswerSourceV2.trustedInstructions`；它不进入用户数据层，也不增加新的 packet schema。Context Packet 与 generation request 继续使用现有 V2 HMAC，因此同一 plan 投影随 `trustedInstructions` 一并进入 HMAC 覆盖。
- 当前 Provider 没有统一 strict JSON Schema 输出能力，Direct answer 继续是文本协议。

## 12. 状态、事务与 manifest

### 12.1 不新增 migration

`interaction_turns.context_manifest` 已是受约束 JSONB，首版在现有 `ContextPacketManifest` 增加：

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

禁止保存 `currentInput`、JD、Frame 槽位文本、Prompt、答案、Secret、私密简历、Search 正文或 Provider payload。项目/能力 ID 必须通过 Catalog 校验。

### 12.2 成功事务

success transaction 原子完成：

1. 写 assistant message。
2. 写 sources 与 usage/attempt projection。
3. 把 interaction turn 设为 `completed`。
4. 提交 candidate Task Frame 和 completed-turn index。
5. 写 TurnPlan manifest 投影和 validation result。
6. 扣除本轮已成功消费的消息额度。

任一步失败则整体回滚，不释放正文，不推进 Task Frame。成功后发送正文和 `done`。

### 12.3 失败和重放

- Provider/模型/超时/取消失败：保存不含正文的 terminal manifest；candidate Frame 丢弃。
- Validator `block`：保存安全 issue code，不保存命中内容；candidate Frame 丢弃。
- Validator `warn`：按普通成功提交并交付。
- 同一 completed `turnId`：直接重放已提交答案、sources 和 done，不重新规划、检索、生成或验证。

## 13. 与未来 Agent、Skills 和联网工具的关系

这次只建设必要扩展点，不建设空系统：

- `TurnPlan` 描述用户目标、任务关系和证据需求，不描述工具调用步骤。
- `EvidenceCatalog` 只管理事实，不把工具能力和事实证据混在一起。
- `AnswerExecutor` 是唯一执行扩展点；未来 `AgentAnswerExecutor` 可以消费同一 Session、Plan 和 EvidenceBundle。
- 未来工具/Skills 需要独立的 capability/permission catalog、typed tool events、循环终止和副作用授权；这些合同在真实需求出现时新增。
- 新 Executor 仍必须返回 `AnswerCandidate`，经过同一个 Validator 和成功事务，不能绕过 HMAC、completed-only 历史、隐私或重放。

从 PI Agent 吸收的是边界思想：Session 与执行器分离、模型能力显式化、完整 turn 压缩、执行结果先形成稳定候选再提交。当前已经吸收其动态上下文部分；本轮不复制 PI Agent 的工具循环、固定 token reserve、主动压缩或 source truncation。RAGFlow 继续只作为后续复杂知识处理参考，不进入基础问答 MVP。

## 14. 兼容、迁移与删除顺序

### 14.1 兼容策略

- 新管线先接入现有 `context_packet_v22`，复用既有邀请码/标签定向准入。
- V1/V2 保留为发布期回滚路径，但不再获得新业务规则。
- legacy `ChatRouteDecision` 只作为边界兼容投影；Prompt 和 EvidencePlanner 读取 `TurnPlan`。
- 动态上下文开启和关闭都必须支持同一 `DirectAnswerExecutor`，不得出现两套答案事务。

### 14.2 删除门

只有满足对应门禁才删除旧实现：

| 待删除 | 删除门 |
| --- | --- |
| `content/chat-capability-policy.json` | Catalog v2 覆盖全部 ID/别名/ref/boundary；全仓无消费者；能力和生产 HR 回归通过 |
| `chat-projects.ts` 手写 alias 表 | 项目别名迁入 Catalog；所有项目识别测试通过 |
| `chat-output-guard.ts` 及测试 | 运行时无消费者；Validator 覆盖五类保留 issue；非阻断集成测试通过 |
| `chat-service.ts` 内证据/Provider 大块逻辑 | 新模块通过 characterization + integration；service 只保留生命周期外壳 |
| legacy route 对 V2.2 的决策权 | TurnPlan 与 manifest 已成为 V2.2 唯一权威；兼容投影不再反向影响 plan |

不得先删除再用临时兼容代码补回，也不得长期保留两个可写事实目录。

## 15. 失败语义

| 条件 | 用户结果 | 状态 |
| --- | --- | --- |
| Provider 完成且非空，Validator pass | 交付答案 | completed |
| Provider 完成且非空，Validator warn | 交付答案 | completed + quality warning |
| 私密数据或 Secret 命中 | 不交付候选正文，返回稳定安全错误 | failed/compensated |
| Provider 空输出或协议不完整 | 返回 Provider 不完整错误 | failed/compensated |
| 所有目标都无法容纳不可裁剪的输入+证据 | 返回真实模型上下文限制 | failed/compensated |
| Embedding/RAG 故障，结构化 Catalog 可用 | 使用全部审核结构化事实继续 | completed + evidence degraded |
| success transaction 失败 | 不交付正文；同 turn 可受控恢复 | failed/orphan recovery |
| 客户端在 commit 后断开 | 同 turn 重试重放已提交答案 | completed replay |

不存在 `OUTPUT_GUARD_REJECTED`、模板拒绝、风格拒绝或“引用不够所以不给回答”。

## 16. 验收合同

### 16.1 单元与集成

- Planner 对身份、项目目录、命名项目、能力、JD、招聘续问、临时话题、真实澄清和外部实时问题产生唯一 TurnPlan，Provider 调用数为 0。
- `portfolio_full` 始终包含五个审核项目和所有有效 `profile.resumeFacts`；Embedding 低分、空结果和故障都不能减少它们。
- Vibe Coding、Claude Code、Codex、WorkBuddy、Cursor 等正反例从 Catalog 得到稳定 direct/unavailable 结果。
- candidate Frame 只在成功事务推进；failed/stopped/block 不推进。
- Provider 非空回答即使触发 coverage/citation/unsupported warning，仍只调用一次回答链并 completed。
- style/template/voice/next-step 等旧 guard 规则不再存在于运行时或测试权威。
- Secret/私密 canary 在正文释放前阻断，日志/manifest 不含命中内容。
- 成功提交发生在首个 answer delta 之前；同 turn replay 不增加 Provider call 或额度。
- 动态上下文、完整轮次压缩、HMAC、attempt、failover、Search 和私密简历隔离保持回归通过。

### 16.2 固定 HR 对话链

使用脱敏 JD 和固定问题覆盖：

1. 与岗位最相关的项目和能力证据。
2. 综合 JD 的优势与风险。
3. 最大能力差距。
4. 如何接手陌生 AI 生成代码。
5. 如何保证快速交付可验证、可回滚。
6. 哪个项目最能证明 Vibe Coding 独立交付。
7. 如何把跨境电商业务想法变成产品方案。
8. 如何做主备模型切换与回滚。
9. 如何依据用户反馈和业务数据持续迭代。
10. 为什么适合 AI 产品负责人岗位。

每一轮必须：

- 保持原招聘 Task 和 JD 槽位，除非问题明确切换任务。
- Context Packet 包含全部审核项目与全部脱敏职业事实。
- 返回非空、针对当前问题的答案并完成 `done`。
- 不错误声称“没有 Vibe Coding/Claude Code/Codex/WorkBuddy 证据”。
- 不编造跨境电商直接经历；可以基于真实相邻经验说明可迁移性。
- 不因质量 warning 拒答或追加生成。

### 16.3 退出验证

- focused unit/integration tests 全通过。
- `npm run chat:eval` 通过且 `externalCalls=0`。
- `npm run rag:eval` 保持当前独立检索评测；其 Top-3 指标不再等同事实准入。
- `npm run typecheck`、`npm test`、`npm run build`、`git diff --check` 通过。
- 1440/390 Chat 视觉冒烟无错误、无重复答案、无提交前正文泄漏。
- 代码与 manifest 敏感扫描无私密简历、凭据、原始 Prompt/答案或 Provider payload。
- 定向生产 release 后，用一个全新 `HR interview` Session 完成“入口 + JD + 十问”真实观察；健康或代码测试不能代替该证据。

## 17. 发布与停止条件

发布继续复用现有定向 `HR interview` 标签准入，percent 保持 `0`，不直接扩大公开流量。

顺序：

1. 在隔离 worktree 完成 TDD、review、完整本地验证和 scoped commit。
2. 吸收到最新主线，重跑因吸收而失效的边界检查。
3. 按生产 runbook 生成不可变归档、核验 SHA-256、部署必要服务并运行 live/ready/release smoke。
4. 创建或使用一个明确授权的全新 HR 测试 Session，发送入口、JD 和十问。
5. 每轮读取受约束 metadata：TurnPlan、task ID、evidence IDs、validation verdict、Provider attempts、completed/done；不在证据文档保存原始私密 JD、答案、token 或 Secret。
6. 全链通过后才评估扩大 HR 推广；本轮不自动开启百分比灰度。

任一条件立即停止真实链并回到该 turn 诊断：

- 答非所问、错误项目、错误否认证据或事实编造。
- 0 approved evidence 的 HR/JD/项目问题。
- Task/JD 槽位意外切换或失败轮污染。
- 非安全原因的回答拒绝。
- 5xx、Provider attempt 异常增长、重复扣额度或未发送 `done`。
- 私密信息、Secret、原始 Provider payload 或未审核事实外泄。

## 18. 信心边界

对架构实现具有高把握的原因：现有系统已经具备 Session、Task Frame、completed-only history、Context Packet、HMAC、动态 compaction、failover 和原子提交，重构主要是把分散决策收敛为显式合同，而不是重写底层。

不能在实施前声称的部分：模型最终语言质量仍必须通过十问真实对话观察。完整证据能显著降低“模型根本看不到事实”的失败，但不能仅靠 TypeScript 类型保证每次生成措辞都理想。因此上线结论必须分别报告代码/事务正确性、部署健康和真实回答效果，不能互相替代。
