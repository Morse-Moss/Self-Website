# 数字 Morse V2.2：受控上下文包、招聘语义与证据路由设计

日期：2026-07-27

状态：四节产品与技术设计已逐节确认；独立反证审查修订完成；用户已于 2026-07-27 复核批准

规格固化合同：`STAGED / STANDARD / LOCAL`

后续实施建议合同：`STAGED / CRITICAL / DEPLOYED`

授权边界：本文档不授权代码修改、生产数据库操作、真实 Provider 调用、配置变更、push、部署或生产灰度

## 1. 适用范围与覆盖关系

本文定义数字 Morse 公共聊天系统 V2.2 的受控上下文和招聘证据路由合同，修复 2026-07-27 生产 badcase 中连续出现的答非所问与错误否认证据。

`docs/portfolio-blueprint.md` 继续是项目级唯一需求权威。本文是其数字 Morse 对话能力的详细行为规格，并在以下窄范围覆盖 `2026-07-27-digital-morse-conversation-v2-1-design.md`：

- Task Frame 不能再依赖单个显式 `topicRef` 才创建。
- 项目目录、岗位相关项目、项目经验和个人能力必须是不同语义。
- 紧邻完成轮次必须能够跨 route 和 `task_id` 参与语言承接。
- Provider 历史不再等同于同任务历史；最终请求使用分层、统一预算的 Context Packet。
- 项目 RAG 只负责相关性选择，不能决定事实是否存在。
- 生产灰度必须重放真实失败链，离线路由通过不能代替用户可见回答证据。

以下 V2.1 合同继续有效：

- 第一人称数字分身身份、公开证据边界和私密简历隔离。
- completed-only 历史、失败轮不污染、Task Frame 成功后原子推进。
- 同 `turnId` 幂等、配额补偿、SSE `done`、Provider 串行恢复和有正文后不切换。
- 管理后台活动 Provider 路由快照、模型版本、成本和超时合同。
- 外部实时事实只通过受控搜索核验，不补造 Morse 的个人经历。
- V1/V2、safe mode、邀请码、预算、保留期和公共 Chat 总开关。

## 2. 当前证据与根因

2026-07-27 对生产发布 `4a039ab` 的只读复盘确认：目标 Provider 请求均正常完成，问题不是 Provider 无响应，而是应用层在路由、任务状态和历史装配中丢失语义。

生产失败链的脱敏语义如下：

1. 公司或岗位匹配问题被判成项目目录，回答机械列出全部五个项目。
2. 用户纠正后进入普通 conversation；上一轮 grounded 回答因 route/task 过滤而不可见。
3. 口语化短 JD 未满足固定长度和标题条件，被当成普通对话。
4. “你有什么相关的项目经验吗？”被判成无证据的个人历史。
5. 最终回答“没有可核验资料”，尽管同一会话刚检索到五项审核公开项目。

对应代码根因：

- `lib/server/chat-service.ts` 的完成历史查询在有 Task 时只取相同 `task_id`；无 Task 时只取 taskless conversation。
- `lib/server/conversation-task-state.ts` 在 `topicRef` 为空时不创建或推进任务。
- `lib/server/chat-route-policy.ts` 将项目目录、相关项目和项目经验交给重叠规则判断。
- `lib/server/chat-evidence.ts` 的 personal fact 分支只查能力台账，不能把审核项目作为项目经验回答。
- `lib/server/chat-message-signals.ts` 对 JD 的长度和结构判断过硬。
- `lib/server/chat-prompt.ts` 对项目集合路由强制完整列目录。
- `lib/server/openai-provider.ts` 正确地以 `store:false` 手工发送消息；问题发生在发送前。

生产 `conversation_task_state` 在该失败链中始终为空，因此仅修改 Prompt、增加一条正则或传递所有历史都不能根治。

## 3. 目标、非目标与零容忍项

### 3.1 目标

- 招聘、公司考察和岗位语境中的模糊项目经验问题默认以 Morse 为候选人主体。
- 从审核公开项目中选择最相关证据回答，不机械罗列完整目录。
- 将语言承接、任务状态、同任务历史和事实证据拆成独立上下文层。
- 每次 Provider 调用使用应用层构建的有界 Context Packet，不发送全部历史。
- RAG 参与岗位与项目的相关性排序，但事实仍由结构化审核资料决定。
- 主 Provider 与串行 fallback 接收完全相同的 Context Packet。
- 真实生产失败链成为永久自动回归和生产灰度门槛。
- 旧会话、失败补偿、幂等、配额、私密简历和现有 V2 路径保持兼容。

### 3.2 非目标

- 不建设跨 Session 长期记忆、用户画像或未经审核的自动知识沉淀。
- 不把全部会话历史发送给 API。
- 不启用 Agentic RAG、额外路由 Agent 或前置 LLM route judge。
- 不使用 Provider-native Conversation 或 `previous_response_id` 作为上下文权威。
- 不把 Prompt caching 当作记忆或正确性方案。
- 不修改公开项目内容、能力事实或 RAG 语料。
- 不接入私密简历、管理员数据、联系信息或外部只读项目。
- 不增加聊天 UI、搜索 Provider、模型供应商或依赖。
- 不在本规格阶段实施、迁移、调用真实 Provider、push 或部署。

### 3.3 零容忍项

- 招聘上下文存在时仍把“相关项目经验”判成无证据个人历史。
- Evidence Planner 已准入至少一项 direct/transferable 项目证据，却回答“没有可核验资料”。
- 前一轮 assistant 文本被升级为个人事实证据。
- failed、stopped 或 running turn 进入后续历史或推进 Task Frame。
- 私密简历或管理员信息进入 Context Packet、RAG、日志或回答。
- 同一 turn 的 failover 收到不同语义、不同证据或不同历史。
- 新任务、一次性问题或临时闲聊把旧任务的公司、岗位、JD、历史或证据发送给 Provider。
- 活跃 Task Frame 引用已经随 10 天分析日志清理而消失的槽位来源。
- `semanticIntent` 在兼容映射为 `routeKind` 后丢失，导致 Prompt、Evidence Planner 或 output guard 按错误语义工作。
- 超预算时从会话头部无差别截断，或静默裁掉当前问题。
- 相同 completed `turnId` 再次生成或重复扣额度。

## 4. 产品语义合同

### 4.1 默认主体

在招聘、公司考察、岗位、面试、候选人或 JD Task Frame 中：

- “你有什么相关项目经验？”默认主体是 Morse。
- “你和我们匹配吗？”默认比较 Morse 与当前公司或岗位。
- “哪些项目相关？”默认从 Morse 的审核公开项目中选择。
- “不是这样的”“这些呢”“那项目经验呢”默认继续当前 Task Frame，除非输入明确切换对象。

只有当前输入、紧邻完成轮次、Task Frame 和服务端可信页面上下文都无法提供公司、岗位、项目、能力或比较对象时，才追问“相关于什么”。

### 4.2 项目类问题必须区分

| 用户目标 | 语义 Intent | 默认回答 |
| --- | --- | --- |
| “你做过哪些项目？” | `project_catalog` | 审核项目完整目录，不调用 RAG |
| “哪些项目和这个岗位相关？” | `project_fit` | 选择最相关 2-3 项并解释映射 |
| “你有什么相关项目经验？”且有招聘上下文 | `project_fit` | 以 Morse 为主体选择审核项目 |
| “你会不会 Kubernetes？” | `capability_fact` | 能力台账优先，项目仅作准入补充 |
| “你做过数字 Morse 吗？” | `named_project_fact` | 锁定指定审核项目 |
| “你做过支付系统吗？” | `unsupported_personal_history` | 无直接证据时明确无法核验 |

### 4.3 JD 识别

JD 不再要求至少 80 字，也不要求同时出现“岗位职责”和“任职要求”标题。以下受控信号可以组合形成部分 JD：

- 明确岗位或角色名称。
- “负责、要求、熟悉、经验、优先”等职责或能力谓词。
- 列表式职责、技能、经验或交付目标。
- 当前招聘 Task Frame 已有公司或岗位，本轮补充新的职责或要求。

部分 JD 可以直接进入 `jd_match`。只有缺失信息会实质改变证据选择时才追问；不能以“请提供完整 JD”替代已有信息下能够完成的回答。

## 5. 总体架构

```text
当前用户消息
  + 紧邻完成问答（Discourse Context）
  + 当前 Task Frame
  -> 语义解析：action / subject / intent / referent / task action
  -> 候选 Task Frame 变更（仅内存）
  -> 证据计划：结构化目录 / 能力台账 / RAG / Search
  -> 同任务 completed-only 历史
  -> Final Context Projection：按本轮 action/intent 最小化投影
  -> Context Packet 统一预算与信任标签
  -> 一次主 Provider；必要时同包串行 fallback
  -> 成功事务提交 answer / sources / usage / turn / Task Frame / manifest
  -> COMMIT 后 SSE done
```

一个边界只回答一个问题：

| 边界 | 职责 |
| --- | --- |
| Discourse Context | “相关、这些、不是这样的”在语言上指什么 |
| Semantic Resolver | 用户本轮想做什么、主体是谁、是否切换任务 |
| Task Frame | 当前持续任务、受控槽位及最后成功状态 |
| Evidence Planner | 哪类审核资料可以支撑本轮事实 |
| RAG | 审核公开项目中哪些内容最相关 |
| Final Context Projection | 本轮究竟允许把哪些历史、槽位和证据发送给 Provider |
| Context Assembler | 哪些内容在预算内发送给 Provider |
| Provider | 在既定任务和证据边界内组织自然语言 |
| Success Transaction | 哪些成功结果可以成为后续历史 |

`chat-service.ts` 只负责主链编排。语义解析、上下文读取、最终投影、证据计划和预算装配应形成可独立测试的模块，不能继续堆入同一文件。

## 6. Context Packet

### 6.1 五层输入

| 层 | 内容 | 信任级别 | 选择规则 |
| --- | --- | --- | --- |
| Current Input | 本轮用户原文 | 不可信数据 | 永远完整保留 |
| Discourse Context | 紧邻上一组 completed user/assistant | 仅语言承接 | 允许跨 route/task；最多一组 |
| Task Frame | 当前结构化任务和槽位引用 ID | 服务端受控状态 | 被最终投影准入时完整保留核心字段；不包含槽位原文 |
| Task History | 同 `task_id` 的 completed-only 轮次 | 语言历史，不是事实权威 | 由近到远、整轮选择 |
| Approved Evidence | 结构化项目、能力台账、准入 RAG/Search | 唯一事实支撑 | 由 Evidence Planner 决定 |

Discourse Context 和 Task History 中的 assistant 消息可以帮助理解用户纠正了什么，但不能直接进入 Approved Evidence。

### 6.2 两阶段装配

路由前只在服务端加载：

- 当前用户输入。
- 紧邻上一组 completed 问答，不受 route 或 `task_id` 限制。
- 当前 Task Frame 及其受控槽位来源。
- 存量 conversation 首次提升到 V2.2 且尚无 V2.2 completed index 时捕获一次 Legacy Discourse Bridge；其后只要 bridge 仍为 `captured`，Resolver 可以继续加载这些有界消息引用，直至成功消费或作废。
- 服务端验证的页面项目 slug。

完成语义解析和任务判断后，再加载：

- 同任务 completed-only 历史。
- 当前 intent 允许的结构化证据。
- 必要时的 RAG 或受控 Search 结果。

这样避免“必须先知道 route 才能加载理解 route 所需历史”的循环依赖。

路由前加载结果只是 Resolver 的只读输入，不是待发送 Payload；禁止把该对象整体传给 Prompt 或 Provider。

### 6.3 Final Context Projection

语义解析完成后必须执行一次白名单式 `FinalContextProjection`。它以 `discourseAction`、`taskAction`、`intent` 和候选 Task Frame 为输入，生成唯一允许进入 Context Packet 的字段；未被显式准入的旧内容默认排除。

| 本轮决策 | Discourse Context | Task Frame / task inputs | Task History / Approved Evidence |
| --- | --- | --- | --- |
| `follow_up` 或 `correction` + `continue` | 仅保留解析当前指代所必需的紧邻 completed 问答 | 仅保留当前任务及本轮相关槽位 | 可取同任务 completed-only 历史；证据严格按当前 intent |
| `new_task` 或 `switch` | 不发送旧任务问答；只有当前输入明确引用上一轮时才保留最小引用句 | 只发送候选新任务和当前输入提取的新槽位，旧槽位先清空 | 不发送旧任务历史或证据 |
| `one_shot` 或 `temporary` | 默认不发送 | 不发送已保存 Task Frame、公司、岗位或 JD；数据库中的活动 Frame 保持不变 | 只允许当前自包含问题所需证据或 Search，不发送旧任务历史 |
| `wait` 或 `clarify` | 默认使用确定性澄清，不调用 Provider | 只在持久化成功后更新 `waitingFor`，不发送无关槽位 | 不检索、不发送旧证据 |
| `complete` | 只保留生成本任务最终回答所必需的最小 completed 问答；确定性结束语不发送 | Provider 最终回答只投影当前候选 Frame 和本轮相关槽位；确定性结束语不发送 | Provider 最终回答只取当前任务所需的 completed-only 历史和证据；确定性结束语不检索、不发送 |

如果当前问题通过紧邻轮次解析出了唯一指代，投影只保留支持该指代的最小一组 completed 问答，不能顺带携带整轮旧 JD。`temporary` turn 不加入活动任务历史；`new_task` 不继承旧 task ID。`complete` 在成功事务中把当前 Frame 标记为 `completed / task_complete`；后续输入不得把该 Frame 当作活动任务隐式恢复，只有显式重新开始或切换任务时才创建新的 `task_id`。最终投影的字段清单、淘汰结果和原因进入 manifest，但不记录正文。

Current Input 是本轮用户正文进入 Provider 请求的唯一正文副本。若投影槽位的 `sourceMessageId` 等于本轮 user message ID，`<task_inputs>` 只保留槽位类型、ordinal、来源 ID 和 `valueSource='current_input'`，不得再次解引用或复制 span 正文；历史 user message 来源的槽位才在 `<task_inputs>` 中携带一次解引用文本。预算按最终线上序列化后的唯一表示计数，不能按概念层重复计入同一正文。

### 6.4 历史选择

- V2.2 紧邻问答以会话期 `conversation_context_completed_turns` 为准；该表只在成功事务中写入完整 user/assistant message IDs，不存在 running、failed 或 stopped 行。
- 同任务历史按 completed-turn index 中的 `context_scope_id` 选择，并以完整 user/assistant 对为最小单元；持续任务的 `context_scope_id` 等于 `task_id`，一次性/临时 turn 使用隔离 UUID。十天分析态 `interaction_turns` 不是会话期历史权威。
- 紧邻问答若已经包含在同任务历史中，Context Packet 只保留一份。
- 显式换话题创建新任务；旧任务 turns 保留原 `task_id`，不删除、不改写。
- 临时闲聊不清空 Task Frame，但当前闲聊 turn 不加入任务历史，最终 Provider Packet 也不携带该 Frame 的输入。
- 存量 conversation 首次从 `legacy` 提升到 `context_packet_v22` 时，reserve transaction 按 `legacy-discourse-bridge-v1` 捕获当前消息之前最近最多 6 个 legacy completed user/assistant 对，只保存 turn/message IDs，不复制正文。合法 pair 必须在同一 conversation 中具有相同 `turnId`、恰好一个 user 和一个 assistant message；若十天分析态 interaction 仍存在，还必须为 `completed`，若已按保留期删除，则以成功事务留下的完整消息对作为会话期完成证据。running、failed、stopped、重复或孤立消息均不准入，也不能跳过异常 pair 继续向更旧历史取值。
- Legacy Discourse Bridge 只供首次 V2.2 Resolver 在服务端从 user messages 确定性重建候选公司、岗位和 JD 槽位；assistant messages 只可用于紧邻语言承接。Resolver 从新到旧处理，遇到显式 `new_task/switch` 边界即停止；多个任务或槽位冲突且会改变证据选择时必须澄清。Final Projection 仍最多发送一组紧邻问答和准入槽位，不得把 6 对 bridge 消息整体发送给 Provider，也不得把 bridge assistant 文本升级为 Approved Evidence。
- `follow_up/correction/continue/complete` 实际使用 bridge 重建旧任务时，success transaction 才原子消费 bridge、写入当前 completed index，并按候选状态创建或完成 Frame。显式 `new_task/switch` 或“忽略以前内容”成功时作废 bridge；`temporary/one_shot` 未引用旧任务、`wait/clarify` 尚待消歧、failed/stopped 均保持 bridge 为 `captured`。任何成功的非 V2.2 覆盖则在锁定 `legacy_locked_after_v22` 时一并作废 bridge。消费或作废后永不再读，conversation 到期时级联删除；不对其余 legacy turns 做批量回填。
- 历史读取必须同时满足当前有效 pipeline/context scope；不能因 routeKind 相同而混入 legacy、V2.2 temporary 或其他 task 的 turns。

### 6.5 长会话与摘要

V2.2 首版不生成 LLM 会话摘要，也不调用 Provider compaction。超出预算的旧 turns 继续按现有保留策略留在数据库，但不进入当前 Provider 请求；持续任务依靠结构化 Task Frame，而不是依靠模型重述全部旧历史。

只有后续评测证明存在无法由 Task Frame 和 bounded history 表达的长程依赖时，才单独设计应用层摘要。未来摘要也只能作为带来源 turn IDs 的 Discourse Context，不能成为 Approved Evidence，不能覆盖原始 completed turns。

## 7. Task Frame 数据模型

### 7.1 任务身份与证据焦点分离

当前实现把 `topicKind/topicRef` 同时当作任务身份和本轮证据焦点。V2.2 将两者分离：

- Task identity 表示持续目标，例如“评估 Morse 与某招聘场景的匹配”。
- Evidence focus 表示本轮正在回答的项目、能力或 JD 片段。

因此，招聘任务可以在尚无单个项目 slug 时存在；本轮证据焦点也可以从项目 A 切到项目 B 而不创建新招聘任务。

### 7.2 逻辑结构

```ts
type ContextWaitingFor =
  | 'company'
  | 'role'
  | 'job_description'
  | 'relevance_referent';

interface TaskSlotRef {
  slot: 'company' | 'role' | 'job_description';
  sourceMessageId: string; // conversation_messages.id
  startUtf16: number;
  endUtf16: number;
  contentSha256: string;
  extractorVersion: 'recruitment-slots-v1';
  ordinal: number;
}

interface ConversationTaskFrameV22 {
  conversationId: string;
  taskId: string;
  ownerPipeline: 'context_packet_v22';
  taskKind:
    | 'recruitment_evaluation'
    | 'project_discussion'
    | 'capability_verification'
    | 'jd_match'
    | 'external_research';
  subjectKind: 'morse' | 'portfolio' | 'project' | 'capability' | 'external';
  subjectRef: string;
  slots: {
    company: TaskSlotRef | null;
    role: TaskSlotRef | null;
    jobDescription: TaskSlotRef[];
  };
  evidenceFocus: {
    topicKind: 'project' | 'capability' | 'jd' | 'external' | 'none';
    topicRef: string | null;
  };
  status: 'active' | 'waiting_input' | 'completed';
  closedReason: 'task_complete' | 'pipeline_rollback' | null;
  waitingFor: ContextWaitingFor[];
  taskStartedMessageId: string;
  lastSuccessfulMessageId: string;
  version: number;
  updatedByMessageId: string;
}
```

Task Frame 不复制原始 JD、自由文本摘要、公司私密信息或 assistant 回答。槽位引用指向 `conversation_messages` 中同一 conversation 的 user 消息，而不是十天后会清理的 `interaction_turns`。`startUtf16/endUtf16` 针对 `turn-codec` 解码后的用户正文，`contentSha256` 针对该 span 的精确 UTF-8 bytes。当前 user message 先由 reserve transaction 持久化；候选 Frame、槽位引用、assistant message 和 completed interaction 只在后续 success transaction 中一并提交。后续装配校验同 conversation、`role='user'`、UTF-16 span 边界和内容 SHA-256。解引用文本始终是不可信数据，不能因引用受控而升级为可信指令。

`company` 和 `role` 各最多一个活动引用。`jobDescription` 允许按顺序保留最多 8 个去重片段，解引用后合计不得超过 12,000 字；显式 `jd_match` workflow 的每次提交视为一份完整 JD，执行 `replace_all`，不会把两份 JD 拼接。同一 workflow conversation 已有 completed JD 时，新提交使用 `taskAction='switch'` 和新 `task_id`；相同 completed `turnId` 则在解析前直接幂等重放。槽位引用与 conversation 同寿命：conversation 到期后由外键级联删除 Frame、槽位和消息；十天分析日志清理不得影响仍有效 Session 的 Frame。任何来源消息缺失、跨 conversation、role 错误、span/hash 不匹配都使本次 Context Build 失败，不能静默使用残缺槽位。

普通 chat 中从公司考察、岗位说明到部分 JD 都保持同一个 `recruitment_evaluation` task；补充 JD 只更新槽位和 evidence focus，不更换 `task_id`。`jd_match` task kind 仅用于显式 `workflow='jd_match'`，不能让 workflow 在同一 conversation 中途切换。`subjectRef` 只能是审核 slug、能力 ID 或 `morse/portfolio/recruitment` 等版本化保留值，禁止保存公司名、岗位原文或其他自由文本。

### 7.3 槽位提取与更新

槽位提取是版本化确定性组件，不调用 LLM。它只输出受约束的 `TaskSlotRef`，不把推断文本写入状态。单槽位转换如下：

| 输入语义 | company / role | jobDescription | Task 行为 |
| --- | --- | --- | --- |
| `new_task` 或 `switch` | 先清空旧值，再写入当前消息中唯一明确值 | 先清空旧片段，再写入当前明确 JD 片段 | 创建新 `task_id` |
| `follow_up` + 明确新增信息 | 当前消息唯一明确值执行 `replace`；未提及则保持 | 声明式职责/要求执行去重 `append` | 保持 `task_id` |
| `correction`，例如“公司不是 A，是 B” | 只对被点名槽位执行 `replace`，被否定值不得保留 | 对被点名片段执行 `replace` | 保持 `task_id` |
| 明确“清除/忽略前面的公司、岗位或 JD” | 被点名槽位置空 | JD 清空全部片段 | 若本轮回答缺少必要信息则 `wait` |
| 同一单值槽出现多个候选且无标签或修正关系 | 不写入 | 不适用 | `clarify`，不得猜测 |
| 与招聘槽位无关或 interrogative capability 问句 | 不变 | 不变 | `temporary` 或对应事实 intent |
| 明确结束当前任务，或生成最后答复后结束 | 不再新增旧任务槽位 | 不再追加旧任务 JD | `complete`；成功后标记 `completed / task_complete` |

公司/岗位标签、显式替换词、否定范围、JD 列表边界和 span 规则属于 `recruitment-slots-v1` 的固定测试合同。更换规则必须升级 `extractorVersion`。`waitingFor` 只能取 `company`、`role`、`job_description`、`relevance_referent`；`waiting_input` 必须至少有一项，其他状态必须为空。`completed` 必须有 `closedReason`，其他状态的 `closedReason` 必须为空。跨 conversation message ID 注入、assistant message 引用、越界 span、重复 JD hash 和超过 8 片段/12,000 字均必须有负向测试。

### 7.4 持久化兼容与回滚投影

实施迁移必须 additive：

- 保留现有 `conversation_task_state`、`interaction_turns.task_id`、版本和时间字段；`conversation_task_state` 继续只由 legacy V2 读写。
- 新建独立的 `conversation_context_task_state`、`conversation_context_slot_refs` 和 `conversation_context_completed_turns`，均带 `owner_pipeline='context_packet_v22'` 约束；V2.2 不向 legacy 表双写，也不把 `recruitment_evaluation` 塞入旧枚举。
- 新建 `conversation_context_legacy_bridge_turns`，每个被提升的存量 conversation 最多 6 行，保存 version、ordinal、legacy turn ID、user/assistant message IDs、captured time、status 和 consumed/invalidated turn ID，不保存正文。两组 message ID 使用与 slots 相同的同 conversation 复合外键；legacy turn ID 只作无外键审计标识，十天分析日志删除不得破坏已捕获 bridge。
- 为 `conversation_messages` 增加父键 `UNIQUE (conversation_id, id)`。槽位表和 Task Frame 的 message 引用都以 `(conversation_id, source_message_id)` 复合外键绑定同 conversation 的 messages；仅普通非唯一索引不足以建立该约束。
- message 复合外键使用 `ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED`，而 Frame、槽位和 completed-turn index 自身通过 conversation FK `ON DELETE CASCADE`。因此 conversation 级联事务可以一起删除所有数据，单独删除仍被引用的 completed message 则在提交时失败。
- completed-turn index 保存 `turn_id`、`context_scope_id`、user/assistant message IDs、pipeline version 和 completed 时间，不保存正文；两组 message ID 都通过上述复合外键约束在同一 conversation，并由成功事务校验 user/assistant role。持续任务的 scope 等于 V2.2 `task_id`，一次性/临时 turn 使用隔离 UUID。它只在成功事务中插入，并与 conversation 同寿命，为 11-30 天内的 Discourse Context 和 Task History 提供 completed-only 权威。
- completed-turn index 的 `turn_id` 只是会话期不透明 UUID，不得建立到十天分析态 `interaction_turns` 的外键、级联或读取依赖。被 completed index 引用的 messages 在 conversation 到期前不可单独删除；失败补偿删除 user message 时尚不存在 completed index。
- 为 conversation 增加受约束的 Context Pipeline assignment：`legacy | context_packet_v22 | legacy_locked_after_v22`；为 interaction 增加 pipeline version、稳定 semantic intent 和 redacted context manifest。
- 每个 V2.2 interaction 的现有 `task_id` 都必须非空：持续任务使用 V2.2 `task_id`，`one_shot`/`temporary` 使用仅该 turn 有效的隔离 context scope UUID。该 ID 可在 Context Build 后写入分析态 interaction 作为观测元数据，但只有成功事务才写 completed-turn index 和 Task Frame。这是对 legacy `task_id IS NULL` history 查询的纵深隔离，不能替代 pipeline filter。
- 回滚不执行 down migration。项目 readiness 要求精确 migration manifest，因此执行 V2.2 migration 后，pre-V2.2 镜像不是可启动的回滚目标，不能声称旧二进制可读新 schema。

兼容投影固定如下：

| V2.2 状态 | legacy `conversation_task_state` 投影 | 执行非 V2.2 覆盖后的下一轮 |
| --- | --- | --- |
| `recruitment_evaluation` | 无，不写旧表 | 当前版本的 legacy 分支忽略 V2.2 Frame 与 turns，从当前输入开始；成功后锁定 `legacy_locked_after_v22` |
| `project_discussion` / `capability_verification` / `jd_match` / `external_research` | 无，不写旧表，即使名称与旧枚举相同 | 同上；不得复用 V2.2 task ID 读取 legacy history |
| 无持久 Frame 的 `one_shot` / `temporary` | 无；interaction 使用隔离 scope UUID | 不进入任何 legacy task/history |

主回滚路径是在当前 schema-aware 版本关闭独立 Context Packet 开关，不是部署旧二进制。任何 assignment 为 `context_packet_v22` 的 conversation，只要因独立 Context Packet kill switch、safe mode、Chat V2 总开关关闭或其他兼容覆盖而成功提交一次 `execution_pipeline != 'context_packet_v22'` 的 turn，success transaction 就必须原子地把 assignment 改为 `legacy_locked_after_v22`，并把 V2.2 Frame 标记为 `completed / pipeline_rollback`。即使之后恢复任一全局开关，该 conversation 也不得恢复旧 Frame、旧 JD 或 V2.2 history，只能从新 conversation 重新加入 V2.2。覆盖期间没有成功提交非 V2.2 turn 的 conversation 可在恢复后继续原 V2.2 Frame，因为期间没有形成分叉历史。

必须增加真实 PostgreSQL 集成测试：先用 V2.2 创建 `recruitment_evaluation` Frame，再分别模拟独立 Context Packet 开关关闭、safe mode 和 Chat V2 总开关关闭，在同 conversation 成功提交下一轮，证明非 V2.2 Payload 不包含旧 JD、旧 V2.2 history 或不兼容 task row；随后恢复对应开关，证明 conversation 仍为 `legacy_locked_after_v22`，旧 Frame 不会复活。还要覆盖覆盖期间失败或 stopped、未提交用户可见 turn 时 assignment 与 Frame 不被关闭。若必须回滚应用镜像，只能发布带当前 migration manifest 的新 compatibility build 并走相同 legacy 路径，不能部署 pre-V2.2 image。

migration `009/011` 和相关脚本已由独立修复提交 `c2d575c` 形成权威顺序 `008 -> 009 -> 010 -> 011`，并在生产应用到 `011`。它们不属于本规格的实现内容，后续 Context V2.2 若需要 additive migration，应从 `012` 起重新冻结编号与兼容边界，不得改写或复用 `009-011`。

## 8. 语义解析与路由

### 8.1 结构化结果

```ts
type EvidencePlanCode =
  | 'identity_card'
  | 'approved_project_catalog'
  | 'ranked_project_fit'
  | 'named_approved_project'
  | 'capability_ledger'
  | 'controlled_search'
  | 'none';

interface SemanticTurnDecision {
  discourseAction: 'follow_up' | 'correction' | 'new_task' | 'one_shot';
  subject: 'morse' | 'general' | 'unknown';
  intent:
    | 'identity_fact'
    | 'project_catalog'
    | 'project_fit'
    | 'named_project_fact'
    | 'capability_fact'
    | 'jd_match'
    | 'recruitment_intake'
    | 'unsupported_personal_history'
    | 'external_current'
    | 'general_conversation'
    | 'clarify';
  taskAction: 'create' | 'continue' | 'switch' | 'temporary' | 'wait' | 'complete';
  referent: {
    kind: 'company' | 'role' | 'project' | 'capability' | 'jd' | 'external';
    ref: string;
  } | null;
  evidencePlan: EvidencePlanCode[];
  confidence: number; // 0..1
  reasonCodes: string[];
}

interface ResolvedChatTurn {
  semantic: SemanticTurnDecision;
  legacyRoute: ChatRouteDecision;
}
```

该结果由确定性规则、审核项目别名、能力台账、Task Frame 和 Discourse Context 生成，不新增 LLM 分类调用。`confidence` 必须位于 `0..1`，只用于审计和澄清门槛，不允许由低置信度自动升级事实。`evidencePlan` 只允许版本化枚举值，不能携带查询文本或模型生成的工具名；`referent.ref` 只允许审核 slug、能力 ID、槽位来源 ID 等受控引用，不能携带公司、岗位或 JD 原文。

`ResolvedChatTurn` 是 V2.2 下游稳定合同。`legacyRoute` 只是兼容适配结果，不能替代或反推出 `semantic`。Semantic Resolver、Task Frame、Evidence Planner、RAG、Final Context Projection、Prompt、output guard、manifest 和 interaction 持久化必须接收同一份不可变 `ResolvedChatTurn`；任何一层仅凭 `routeKind` 或 `reasonCode` 决定招聘语义都属于实现错误。

### 8.2 优先级

1. 安全、隐私、显式 workflow 和受控 Search 请求。
2. 明确命名的审核项目、能力或 JD。
3. 当前招聘、公司、岗位或候选人 Task Frame。
4. 紧邻 completed 问答中的唯一指代。
5. 自包含的一次性问题。
6. 只有前五项都不能唯一确定时才 `clarify`。

招聘 Task Frame 下，`project_fit` 优先于泛化 `personal_history_query`。项目集合规则不能捕获“相关、匹配、证明、经验、最适合、比较”等选择性问题。

### 8.3 短 JD 确定性判定

JD 判定不使用字符数阈值，也不要求固定双标题。`recruitment-signals-v1` 固定以下信号：

- `W`：显式 `workflow='jd_match'`。
- `F`：当前存在 `recruitment_evaluation` Task Frame。
- `R`：明确出现“岗位、职位、招聘、候选人、JD”标签，或服务端版本化角色词典/角色后缀（如工程师、产品经理、架构师、运营、设计师、负责人、专家）。
- `D`：声明式职责/要求谓词，例如“负责、要求、需要、掌握、熟悉、经验、优先、能够、交付”。
- `L`：至少两个非空列表项，且每项包含职责/要求谓词或审核能力词。
- `Q`：面向 Morse 的能力问句，例如“你熟悉 PostgreSQL 吗、是否做过、会不会”，或明确的一般知识疑问。

按下表自上而下判定：

| 条件 | 结果 |
| --- | --- |
| `W` | `jd_match`；首份创建 task，已有 completed JD 时 `switch` 到新 task；整份 JD `replace_all` |
| 明确 `JD/岗位职责/任职要求` 标签且后有非空内容 | 无“补充/还有/追加”词时创建或 `switch` 并 `replace_all`；有追加词且存在 `F` 时继续当前 task 并 `append` |
| `F && (D || L) && !Q` | 当前招聘任务的增量 JD，执行槽位 `append/replace` |
| `R && (D || L) && !Q` | 创建招聘任务并进入 `jd_match` |
| `Q` | 不判 JD；按 `capability_fact`、`project_fit` 或一般问题继续解析 |
| 仅有 `D`，但没有 `F/R/JD` 标签 | 不判 JD；不得因“熟悉、经验”等单词误报 |
| 仅有角色名、公司名或模糊“帮我看看” | 信息不足时进入 `recruitment_intake`，只追问会改变证据选择的最小字段 |

显式“换个岗位、另一家公司、另一份 JD、重新看这个岗位”优先解析为 `new_task/switch`，先清空旧槽位，再进入上表。例如，“后端工程师，负责 Agent 平台，熟悉 PostgreSQL”是短 JD；已有招聘 Frame 后的“还要求做 RAG 评测”是增量 JD；“你熟悉 PostgreSQL 吗？”是能力事实问题；“PostgreSQL 适合什么场景？”是一般技术问题。失败链原句之外，测试必须覆盖同义改写、否定句、疑问句、单个技能词、列表式短 JD 和中英文混合角色，防止只为一个 fixture 写规则。

### 8.4 兼容映射

现有下游 `routeKind` 可以保留，由新语义映射：

| Semantic intent | 兼容 routeKind | 新 reason code 示例 |
| --- | --- | --- |
| `identity_fact` | `identity` | `identity_query` |
| `project_catalog` | `grounded` | `portfolio_project_collection_query` |
| `project_fit` | `grounded` | `recruitment_project_fit` |
| `named_project_fact` | `grounded` | `personal_named_project_query` |
| `capability_fact` | `personal_fact` | `personal_capability_query` |
| `jd_match` | `jd` | `contextual_jd_match` |
| `recruitment_intake` | `jd_intake` | `missing_material_job_context` |
| `unsupported_personal_history` | `personal_fact` | `personal_history_query` |
| `external_current` | `external_current` | `external_current_query` |
| `general_conversation` | `conversation` | `stable_general_conversation` |
| `clarify` | `clarify` | `missing_relevance_referent` |

这允许复用现有 SSE 和部分持久化边界，同时消除旧 routeKind 承担过多语义的情况。Prompt、Evidence Planner 和 output guard 必须读取 `semantic.intent` 与 `evidencePlan`：普通 `workflow='chat'` 的 `project_fit` 也必须启用招聘回答合同，拒绝虚构匹配百分比、无项目名的泛化回答，以及在已准入项目证据时声称“没有可核验资料”。

`releasePolicy` 也必须由 `ResolvedChatTurn.semantic` 决定，不能沿用兼容 `routeKind` 的默认值。凡回答合同含只能在完整候选上判定的终态约束，均使用 `complete`：首版至少包括 `project_catalog`、`project_fit`、`named_project_fact`、`capability_fact`、`jd_match`、`unsupported_personal_history` 和 `external_current`。Provider 仍可在服务端流式接收，但应用必须缓存到完整 output guard 通过后才发送首个用户可见 delta；被拒绝的 normal 候选不得泄漏任何正文，也不得依赖前端 reset 修补，再以 strict 候选从空白重生成。只有没有终态约束且所有守卫都能在已释放前缀上证明的 intent 才可使用 `segment`。

## 9. 证据与 RAG

### 9.1 证据计划

| Intent | 结构化来源 | RAG | 回答合同 |
| --- | --- | --- | --- |
| `project_catalog` | 五项目录 | 禁止 | 仅用户明确问全部时完整列出 |
| `project_fit` | 审核项目资料 | Top 3 唯一项目 | 最多 3 项；达到门槛的项目不少于两项时默认选择 2-3 项 |
| `named_project_fact` | 指定项目完整资料 | 可选补段 | 锁定 slug，不借相似项目 |
| `capability_fact` | 能力台账 | 仅补充台账已准入项目 | 不把 transferable 升级为 direct |
| `jd_match` | 能力台账 + 审核项目 | Top 3 唯一项目 | 只展开有证据或可迁移基础的匹配 |
| `unsupported_personal_history` | 无直接审核事实 | 禁止 | 只说明当前无法核验，不借相似项目 |
| `external_current` | 受控 Search | 不用于个人事实 | 必须显示外部来源与时间边界 |

### 9.2 RAG 定位

RAG 的职责是“在已经获准公开的项目资料中排序相关内容”，不是判断 Morse 是否做过某个项目。

`project_fit` 和 `jd_match` 的流程：

1. 用当前问题、Task Frame 中的公司/岗位/JD 来源构造检索查询。
2. pgvector 按现有阈值过滤后 over-fetch 最多 15 个候选 chunk；该数字覆盖当前五项目语料的项目级去重，不是最终回答数量。
3. 丢弃没有审核 `projectSlug` 的候选，按 `projectSlug` 聚合；项目分数取该项目最高合格 chunk 分数，同分按审核项目目录稳定顺序排序。
4. 取 Top 3 **唯一项目**，再通过 `projectSlug` 回填审核结构化项目资料；同一项目的多个 chunk 不能占用多个名额。
5. 只将回填后的事实和每项目必要片段放入 Approved Evidence，回答按 direct、transferable、unavailable 三个等级陈述。

当前五项目规模不需要 Agentic RAG。若 Embedding 或 pgvector 失败，使用结构化项目、项目别名和能力关联做确定性项目级降级；不得因 RAG 不可用而否认结构化公开事实。降级只能补入满足 direct/transferable 合同的项目，不能为了凑足数量加入无关项目，且必须进入 manifest。

### 9.3 回答形态

岗位相关项目默认最多选择 3 项；有至少两项达到准入门槛时回答 2-3 项，只有一项达到门槛时诚实回答一项，没有项目达到门槛时说明无直接匹配。每项回答：

- 做了什么。
- 为什么与当前岗位或公司相关。
- 是直接匹配还是可迁移基础。
- 对应的审核项目来源。

不输出虚构匹配百分比，不主动罗列完整缺口，不把“能力台账无单项命中”写成“没有相关项目经验”。

当 `project_fit` 或 `jd_match` 已准入至少一项 direct/transferable 项目时，output guard 必须要求回答命名至少一个对应审核项目，并拒绝笼统的“没有可核验资料”。当没有任何项目达到准入门槛时，允许诚实说明无直接匹配，不能为了满足格式强塞无关项目。

项目级评测 fixture 必须固定：预期入选 slug、明确禁止的无关 slug、每个项目的 direct/transferable 等级、去重后的项目顺序和 RAG 降级结果。既有 `top-3 46/46` 继续作为 chunk retrieval 不回归门，但不能替代 `project_fit` 的项目级排序、去重和回答验收。

## 10. Prompt 与 Provider API

### 10.1 Prompt 信任分区

Provider 请求保留稳定前缀，并明确区分：

- `<policy>`：身份、安全、隐私和证据规则。
- `<response_contract>`：来自 `ResolvedChatTurn.semantic` 的 intent、evidence plan、证据等级和回答形态。
- `<task_frame>`：仅包含 Final Context Projection 准入的服务端受控任务字段、枚举和槽位来源 ID。
- `<task_inputs>`：仅包含本轮投影准入的公司、岗位和 JD 槽位；历史 user message 来源携带一次解引用文本，本轮 user message 来源只携带 `valueSource='current_input'` 引用标签，始终是不可信数据。
- `<discourse_context>`：仅包含本轮投影准入的最小语言承接历史，不是事实证据。
- `<approved_evidence>`：当前 semantic intent 唯一允许使用的事实支撑。
- 当前用户消息：保持 user role，视为不可信数据。

JD、Search 摘要、用户文本和历史 assistant 文本均按不可信数据转义，不能覆盖 policy 或 response contract。

### 10.2 Provider 状态策略

项目安装的官方 OpenAI SDK `6.46.0` 类型声明支持 `conversation`、`previous_response_id`、`context_management` compaction 和 prompt cache 参数；2026-07-27 官方 Docs MCP 与官方网页均因当前网络边缘 403 无法读取，启用可选能力前必须重新核验官方文档和真实中转兼容性。

V2.2 首版决策：

| 能力 | 决策 | 原因 |
| --- | --- | --- |
| `conversation` | 不启用 | 状态绑定具体 Provider，不利于串行切换 |
| `previous_response_id` | 不启用 | 与 conversation 互斥，跨中转无法接管 |
| Provider compaction | 不启用 | 兼容性未证实，不能替代 Task Frame |
| Prompt caching | 维持现有稳定前缀，可后续优化 | 只影响成本和延迟，不提供记忆 |
| `store:false` | 保留 | 应用数据库继续是上下文唯一权威 |

Context Packet 在 Provider 调用前只构建一次并冻结。主节点和所有串行 fallback 获得相同的 canonical packet bytes、base instructions、messages、evidence 和预算结果；不能按 Provider 重新路由、重新投影或重新检索。Provider adapter 只能增加协议封装字段，不能修改语义内容。

保留现有 output guard 的最多一次 strict 重生成，但它只能在相同 Context Packet 上增加一个版本化固定 overlay：`generation_mode='strict'` 与 `strict-overlay-v1`。该 overlay 不得修改 semantic intent、Task Frame、task inputs、history、evidence、检索结果或预算，也不能触发新的 Resolver/RAG/Search。普通模式及其 fallback 使用同一 normal request；strict 模式及其 fallback 使用同一 strict request。两种模式分别审计 request HMAC，Context Packet HMAC 在整个 turn 内必须相同。

对 §8.4 列出的 `complete` intent，normal 候选通过完整 output guard 前 `first_user_visible` 必须为空；若 normal 被拒绝，strict 候选也必须完整通过后才一次开始释放。SSE 可以在缓存期间发送不含候选正文的 activity/status，但不能发送 normal 文本、局部引用或需要客户端撤回的 delta。

## 11. 上下文预算

### 11.1 统一预算

新增请求级配置 `MORSE_CHAT_CONTEXT_TOKEN_BUDGET`，普通 chat 首版默认 `12000`。它是应用允许发送的输入预算，不等同于模型宣传的最大上下文窗口。

既有 `jd_match` workflow 允许最长 12,000 字输入，不能因新预算发生静默收窄。为该 workflow 增加 `MORSE_JD_CONTEXT_TOKEN_BUDGET`，首版默认 `24000`；它仍执行相同分层和 90% 预留规则。首轮整份 JD 的正文只作为 Current Input 发送一次，当前消息槽位在 `<task_inputs>` 中使用引用标签，不能重复消耗正文 token。部署前必须确认活动模型和所有可用 fallback 的输入能力覆盖该上限；不能依赖 Provider 自动截断。

- 输出预算继续由活动 Provider target 独立控制；环境默认目前为 `MORSE_MAX_OUTPUT_TOKENS=1200`，数据库活动模型版本可能覆盖它，本规格不修改该值。
- 预估内容最多使用输入预算的 90%，为分词和消息包装误差保留 10%。
- token 计算必须覆盖 instructions、Task Frame、history、evidence 和当前输入，而不是只计算 history。
- 预算按较大的 `strict-overlay-v1` 请求计算并预留固定 overlay；normal 通过但 strict 超预算的 Packet 不得启动 Provider。
- 沿用对中文偏保守的估算；未来替换 tokenizer 不改变优先级合同。

### 11.2 分层上限与淘汰顺序

- Current Input：完整保留。
- Policy 与核心 Task Frame：完整保留。
- Discourse Context：最多一组 completed 问答，约 `1000 tokens` 上限。
- Task History：约 `2500 tokens` 上限，整轮由近到远。
- Approved Evidence：Top 3 内按回答必要性使用剩余预算。

超预算时依次删除：

1. 最旧 Task History。
2. 低排名且未被回答合同要求的证据。
3. 同一来源中的冗余证据段落。

不能静默裁剪当前输入、安全规则、核心 Task Frame 或事实回答所需的最小证据。不可删除层本身超限时，在 Provider 调用前返回稳定输入过长错误，并按现有补偿合同恢复配额和持久化状态。

## 12. 原子性、失败与兼容

- reserve transaction：锁定 Session/conversation 和幂等状态，写入 `running` interaction 与本轮 user message，并执行现有配额预留；提交后 Resolver 和 Context Build 才能安全创建指向该 user message 的候选槽位引用。reserve transaction 不写候选 Frame、completed-turn index 或 terminal manifest。
- Semantic decision、候选 Task Frame、Final Context Projection 和 Context Packet 在 reserve commit 后、Provider 调用前于内存生成。
- success transaction：写 assistant message、completed interaction、usage、terminal manifest，以及成功结果对应的 Task Frame、槽位引用和 `conversation_context_completed_turns`；这些写入必须同成同败。deterministic reply 也走该 success transaction，只是 `context_build_status='not_required'` 且不写 Provider attempt。
- failure compensation：若 turn 尚未 completed，删除 reserve transaction 写入但未完成的 user message、恢复相应配额，并把 interaction 终结为 `failed` 或 `stopped`，同时写入无正文 terminal manifest；不得提交候选 Frame、槽位、completed-turn index 或 Approved Evidence 正文。
- Provider、output guard、Context Build 或 success transaction 失败时，不提交候选 Task Frame。若 success commit 的客户端确认丢失，只能按现有幂等核验读取已提交结果，不能再次执行 Provider。
- 相同 completed `turnId` 原样重放，不重新装配 Context Packet、不调用 Provider。
- running turn 不允许读取尚未完成的 conversation message 作为历史。
- Embedding/RAG 降级不改变任务身份，只改变 evidence plan 和 manifest。
- 有正文后不自动切 Provider；手动 retry 仍复查 completed 结果。
- 当前 schema-aware 版本中的 V1 和 legacy V2 Payload 组装必须忽略 V2.2 Frame、slots、bridge 与 history；跨管线 success coordinator 仍必须执行 assignment 锁定和 Frame/bridge 关闭，不能把“忽略 Payload 状态”实现成“忽略回滚状态机”。pre-V2.2 image 不是迁移后的回滚目标，safe mode 优先级保持最高。
- diagnosis workflow 的五字段状态机保持独立，本设计不以 Task Frame 替换 diagnoses。

## 13. 可观测性与隐私

每个 V2.2 interaction 保存一个受约束、无原文的 `context_manifest`：

```text
pipeline_version
semantic_intent
discourse_action
task_action
task_id
task_state_version
context_builder_version
projection_policy_version
release_policy
context_build_status
context_build_error_code
discourse_source_turn_ids
legacy_bridge_policy_version
legacy_bridge_source_turn_ids
legacy_bridge_status
included_layers
excluded_layers
projected_slot_kinds
evicted_layers
projection_reason_codes
eviction_reason_codes
token_estimate_by_layer
evidence_ids
retrieval_scores
degraded_reason
packet_hmac_key_id
packet_hmac_sha256
```

`context_build_status` 只能是 `not_required | built | over_budget | failed`，`release_policy` 只能是 `not_required | segment | complete`。`legacy_bridge_status` 只能是 `not_eligible | captured | used | ambiguous | invalid | consumed | invalidated`；不适用时 policy version 和 source IDs 为空，适用时只记录最多 6 个 turn IDs，不记录消息正文。确定性回复使用 `not_required`；只有完整 canonical packet 生成后才能写 `built` 和 `packet_hmac_sha256`。构建失败时 HMAC 为空并保存稳定错误码。`included_layers`、`excluded_layers` 和 `evicted_layers` 只允许 `current_input | discourse_context | task_frame | task_inputs | task_history | approved_evidence`；`projected_slot_kinds` 只允许 `company | role | job_description`。`excluded` 表示 Final Projection 按策略未准入，`evicted` 表示已准入后因预算淘汰；两类原因使用随 `projection_policy_version` 固定的版本化枚举，不保存正文或自由文本。manifest 必须覆盖 completed、failed、stopped 和补偿完成的 V2.2 interaction，而不是只在成功 answer 事务中创建。

canonical packet 使用稳定键排序、稳定数组顺序和 UTF-8 编码。部署配置新增 secret `MORSE_CONTEXT_PACKET_DIGEST_KEY` 与非敏感版本 `MORSE_CONTEXT_PACKET_DIGEST_KEY_ID`；key 必须是解码后至少 32 bytes 的独立随机值，key ID 只允许受约束的非敏感版本标识。两项只在 Context Packet 可能启用时必填；启用但缺失或非法必须使 readiness 失败，关闭时不得阻断 legacy Chat。`packet_hmac_sha256 = HMAC-SHA256(key, UTF8("morse/context-packet/v1\0") || canonicalPacketBytes)`；manifest 的 `packet_hmac_key_id` 只保存 key ID，不保存 key。不得使用可被字典猜测的裸内容 hash，也不得复用 Provider、邀请码或管理员凭据。HMAC key 只存在于服务端 secret 配置，不进入数据库、日志或 manifest。

`generation-request-v1` 是 Provider adapter 之前的应用级语义请求，按同一稳定 JSON 规则编码为 `canonicalGenerationRequestBytes`，字段白名单固定为：`schemaVersion`、`packetHmacKeyId`、`packetHmacSha256`、`generationMode`、`overlay`、`baseInstructions`、有序 `messages[{role, content}]`、应用级 `reasoningEffort` 和 `store:false`。normal 的 `overlay=null`；strict 的 overlay 必须编码为独立对象 `{ version: 'strict-overlay-v1', content: <固定版本正文> }`，不得先用未规定的分隔符拼接后再计算。新增任何会改变模型语义的应用级字段都必须升级 schema 并进入该白名单。

`generation_request_hmac_sha256 = HMAC-SHA256(key, UTF8("morse/generation-request/v1\0") || canonicalGenerationRequestBytes)`。Provider alias、route revision、target position、model ID、Base URL、协议 envelope、API key/headers、连接超时、传输重试和各 target 的输出上限是单独审计的 Provider 专属字段，不进入该 HMAC；adapter 不得借这些字段改写白名单中的 instructions、messages、overlay 或 reasoning effort。这样 request HMAC 证明主节点与 fallback 获得相同应用级语义请求，而 Provider 专属配置继续由既有 config digest/attempt 字段证明。

每个 turn 在 Context Build 时快照 key/key ID；轮换只影响后续新 turn。`chat_provider_attempts` 是调用前一致性校验的唯一实时权威：每个 Provider attempt 必须先在该表写入同一个 builder version、key ID 与 `packet_hmac_sha256`，并另存 `generation_mode`、overlay version 和 `generation_request_hmac_sha256`，成功提交 `started` 记录后才可发起网络调用。写入时必须与该 turn 已有 attempt 在事务内比较；所有 attempt 的 packet HMAC 必须相同，request HMAC 只允许在 `normal -> strict` 的单次守卫重生成边界变化，且同一 generation mode 内主节点与 fallback 必须相同。任何其他差异都以稳定一致性错误终结，且不得发起该 Provider 调用。

`interaction_provider_attempts` 仅是 execution 结束后供管理后台与分析使用的投影，不参与调用前 enforcement。若它镜像 builder/HMAC/overlay 字段，值必须从对应 `chat_provider_attempts` 行复制，不得独立重算；缺失源行或复制不一致必须使 terminal transaction 失败，不能形成第二套权威。

manifest 不保存完整 Prompt、用户原文、JD 副本、assistant 回答、私密简历、Search 正文、Provider payload、Key 或 Base URL。它沿用 interaction 的十天分析保留期和权限边界，不新增公共 API 或前台显示；Task Frame 的会话期槽位引用不依赖 manifest。

`evidence_ids` 只允许审核公开资料的稳定 chunk/document/project ID；`retrieval_scores` 只与这些公开 ID 配对。两者不得包含查询文本、公司名、岗位原文或自由文本标签。

生产观察至少查询：

- 招聘或 JD turn 的空 Task Frame 数和比例。
- `project_fit` 被映射为 personal history 或 catalog 的数量。
- 有审核项目却 evidence 为空的数量。
- Context Packet 预算使用、淘汰层和超限错误。
- Final Context Projection 排除层、旧任务输入误准入数和 Context Build terminal status。
- RAG 降级原因与降级后完成率。
- Provider attempts、错误率、输入 tokens 和 P95 延迟。
- 同 turn attempt 的 packet HMAC 不一致数、同 generation mode request HMAC 不一致数，均必须为 0。
- completed replay 再生成、重复扣额度和失败轮污染，均必须为 0。

样本不足时报告分子、分母、时间窗和 pipeline 版本，不能用百分比制造稳定性结论。

## 14. 测试合同

### 14.1 真实失败链回归

使用不含生产身份和公司隐私的脱敏固定 fixture 重放：

1. 公司/岗位匹配问题进入 `project_fit`，创建非空招聘 Task Frame，不列完整目录。
2. “不是这样的”继续原任务，不掉入 taskless conversation。
3. 口语化短 JD 进入 `jd_match`，不要求标题或 80 字。
4. “你有什么相关项目经验吗？”解析为 Morse 的 `project_fit`。
5. 最终回答至少引用一个相关审核项目，不得输出“没有可核验资料”。

该 fixture 固定预期入选 slug、禁止出现的无关 slug 和 direct/transferable 等级，并覆盖 semantic intent、legacy route、Task Frame、Final Context Projection、history、项目级 RAG、evidence、prompt 和 output guard，不能只测正则函数。

### 14.2 反例与故障注入

- 无公司、岗位或上文参照的“相关项目”进入一次自然澄清。
- “你做过哪些项目”仍返回完整审核目录且不调用 Embedding。
- `recruitment-signals-v1` 的正负决策表覆盖短 JD 同义改写、列表、否定、疑问句、单技能词和中英文角色；“你熟悉 PostgreSQL 吗”不得误判为 JD。
- 槽位转换覆盖公司更正、岗位更正、多段 JD 去重追加、显式整份 JD 替换、清空旧槽位、同槽多候选澄清、跨 conversation/assistant message 注入和 span/hash 失配。
- 数据库约束覆盖 message 父表复合 UNIQUE、同 conversation 的 user/assistant 复合 FK、completed message 单独删除失败、conversation 级联成功，以及 completed index 对 `interaction_turns` 零 FK/零级联依赖。
- 30 天 Session 在第 10 天清理 `interaction_turns` 后仍能通过会话期 completed-turn index 与 `conversation_messages` 继续招聘追问、Discourse Context 和同任务历史；conversation 到期后 Frame、槽位、completed index 和消息一并级联消失。
- 存量 legacy conversation 在空 V2.2 表下首次被灰度提升：捕获最近最多 6 个合法消息对，能在不发送整段 bridge 的前提下重建失败链中的招聘槽位并正确回答最终项目经验问题；十天 interaction 清理后仍可凭已捕获消息引用完成。异常/冲突 pair 进入澄清或稳定 bridge error，不混入更旧任务；失败、澄清和先发生的 temporary turn 后仍可使用，实际承接成功后只消费一次，显式新任务则作废。
- 先提交含敏感标记的 JD，再发送临时闲聊、自包含新任务和显式切题；三类 Provider Payload 均不得包含旧 JD、旧 Task History 或旧 evidence，活动 Frame 本身保持不变。
- V2.2 创建招聘 Frame 后，分别关闭 Context Packet 开关、启用 safe mode、关闭 Chat V2 总开关；同 conversation 的非 V2.2 下一轮均不读取 V2.2 Frame/history/JD，并能从当前输入完成。该 turn 成功后 assignment 锁定 `legacy_locked_after_v22`，恢复开关也不复活旧 Frame；failed/stopped 则不锁定。
- `taskAction='complete'` 的 Provider 最终回答只收到当前任务最小投影，确定性结束语不调用 Provider；两者成功后都原子写入 `completed / task_complete`，后续输入不得隐式恢复已完成 Frame。
- `project_fit + workflow='chat'` 分别拒绝虚构匹配百分比、已准入证据时的“没有可核验资料”和未命名任何准入项目的回答。
- `project_fit` normal 候选在完整 guard 因未命名准入项目或错误否认证据而拒绝时，SSE 中用户可见 delta 必须为 0，normal attempt 的 `first_user_visible` 为空；只有完整通过的 strict 候选可以开始释放正文。其余 §8.4 `complete` intent 同样不得先流出再 reset。
- RAG over-fetch 后按 `projectSlug` 去重、稳定项目级排序；多个高分 chunk 属于同一项目时只能占一个名额，不足两项时不得强塞禁止 slug。
- 首轮显式 `jd_match` 使用恰好 12,000 字的最大输入 fixture：Current Input 正文只序列化一次，本轮槽位在 `<task_inputs>` 中不复制正文，并在默认 24k、90% 上限和 strict overlay 预留下完成 Context Build；不得因重复计 token 返回输入过长。
- canonical packet 的稳定序列化可重放；`chat_provider_attempts` 的调用前事务拒绝任何 builder version/packet HMAC 不一致。normal 与 strict 各自的主 Provider/fallback request HMAC 必须相同，只有一次 `normal -> strict-overlay-v1` 边界允许 request HMAC 变化；`interaction_provider_attempts` 的镜像值逐行等于实时权威且无独立重算。
- Context Build 的 `built/over_budget/failed/not_required` 均持久化无正文 manifest；失败和 stopped 路径不提交候选 Frame。
- 未审核支付、医疗或规模经历保持 unavailable。
- assistant 自称做过某事不能成为 Approved Evidence。
- failed、stopped、running 和 orphan 的历史准入保持原合同。
- token 淘汰保持整轮、保留当前输入，并在不可裁剪层超限时补偿失败。
- migration、并发版本、成功事务和 completed replay 使用真实 PostgreSQL 故障注入。
- 私密简历域继续在 public knowledge、RAG、Provider request、manifest 和日志中不可达。

### 14.3 出口验证

实施完成后的最小出口证据：

- 新增 focused unit 和 integration tests 全部通过。
- `npm run chat:eval` 全部通过，且 `externalCalls=0`。
- 生产等价 BGE + pgvector 的既有 46 条 gold 保持 `top-3 46/46`，正负阈值通过。
- `npm test` 零失败、零未经说明的 skip。
- `npm run build` 通过。
- Mock SSE 完整多轮重放通过，未调用真实 Provider。
- `git diff --check` 和敏感信息扫描通过。

本设计没有 UI 改动，不要求视觉验收。若实际 diff 触及 Chat UI、Admin UI 或可见文案，必须重新纳入 1440x900、390x844、console/page error 和 overflow 验收。

## 15. 灰度、真实验收与回滚

### 15.1 独立管线灰度

生产当前 Chat V2 已为 100%，不能复用该百分比直接全量替换。V2.2 使用独立 Context Pipeline 开关：

- `MORSE_CHAT_CONTEXT_PACKET_ENABLED`
- `MORSE_CHAT_CONTEXT_CANARY_PERCENT`
- `MORSE_CHAT_CONTEXT_CANARY_INVITE_IDS`

启用期间 assignment 以 conversation 为单位保持粘滞，避免同一多轮任务在 legacy 和 packet 管线之间跳动；`legacy_locked_after_v22` 永久优先于后续 canary assignment。`MORSE_CHAT_CONTEXT_PACKET_ENABLED=false` 是高于粘滞 assignment 的紧急 kill switch，关闭后新 execution 按 §7.4 的空 legacy 投影运行。safe mode 和 Chat V2 总开关优先级更高；但只要这些覆盖让原 `context_packet_v22` conversation 成功提交非 V2.2 turn，就必须按 §7.4 锁定并关闭旧 Frame。公共 Chat 总开关若直接拒绝请求且没有成功 turn，则不改变 assignment。邀请码白名单只使用数据库 invite UUID，不使用一次性邀请码明文，也不复用私密简历邀请码。

### 15.2 上线顺序

1. 以已部署的 migration `001-011` 和 release `c2d575c` 为实施基线；新增 schema 从 `012` 起编号并重新完成独立迁移合同。
2. additive migration 与兼容代码部署，Context Packet 默认关闭。
3. 配置独立 Context Packet HMAC secret；不调用 Provider 完成 live/ready、migration、grants、构建、manifest 和 Mock 主链验证。
4. 获得单独授权后，只对指定测试邀请码开启并执行最多五次真实主回答。
5. 在一条新 conversation 中完整重放失败链；若原问题会话仍在保留期，再通过 `legacy-discourse-bridge-v1` 补原会话首次提升与恢复检查，确认没有把 bridge 尾部整体发送给 Provider。
6. 指定邀请码通过后，按 `10% -> 50% -> 100%` 扩大普通 conversation。
7. 10% 至少观察 24 小时，并取得至少 20 个 V2.2 completed turns、其中覆盖至少 5 条多轮 conversation。
8. 50% 再观察至少 24 小时，累计取得至少 50 个 V2.2 completed turns、其中覆盖至少 10 条多轮 conversation。
9. 100% 后继续观察至少 48 小时，并报告该窗口全部 V2.2 turns；未满足前述样本门槛时不得跳级。
10. 每级报告自然完成轮数、多轮 conversation 数、错误分子/分母和观察时间；低流量不能只靠等待时间宣称通过，也不能未经授权主动制造付费流量凑样本。

### 15.3 立即停止条件

任一项出现一次即停止扩大灰度：

- 私密或管理员信息进入 public Chat 任一层。
- Evidence Planner 已准入 direct/transferable 项目却错误回答无证据。
- 真实失败链任一语义再次错误。
- `context_build_error`、静默截断当前输入或输入预算越界。
- 新任务、一次性问题或临时闲聊的 Provider Payload 携带旧公司、岗位、JD、历史或证据。
- failed/stopped turn 污染历史或 Task Frame。
- 同 turn 不同 Provider 收到不同 Context Packet。
- V2.2 interaction 缺失 terminal manifest、同 turn Provider attempt 的 packet HMAC 不一致，或同 generation mode request HMAC 不一致。
- completed replay 再生成、重复扣额度或并发回答。

在可比且各自至少 20 个 completed turns 的窗口内，V2.2 Provider 错误率比 legacy 高 5 个百分点，或 P95 完成时长高 30%，即停止扩大并调查。平均输入 tokens 必须连同 route 构成和样本数报告；任何单轮越过应用预算均立即停止。小样本不得使用无分母百分比直接判定。

### 15.4 回滚

- 关闭独立 Context Packet 开关，只让后续新 execution 回到 legacy V2。
- 已开始的 execution 不在中途切管线或切 Provider。
- 不执行数据库 down migration；当前 schema-aware 版本的 legacy 分支忽略 V2.2 表和字段。若必须更换镜像，只能发布带当前 migration manifest 的 compatibility build，不能部署 pre-V2.2 image。
- 保留 manifest 和失败证据用于复盘，不保留新的敏感正文副本。
- 任何隐私泄漏直接关闭公共 Chat 总开关并进入事故处置，不能只回到 legacy。

## 16. 完成定义与实施前置条件

V2.2 只有同时满足以下条件才能称为生产修复完成：

- 本规格的产品语义、Context Packet、Task Frame、证据和预算合同均有对应实现与测试。
- 脱敏失败链和反例全部通过。
- migration 在真实测试 PostgreSQL 上通过，并以已部署的 `001-011` manifest 为不可改写基线。
- RAG `top-3 46/46` 与公开/私密隔离门槛保持通过。
- 真实测试邀请码的失败链得到用户可见正确回答。
- 零容忍项为 0，Git commit、push、生产 release 指针和线上行为分别有独立证据。
- closeout 达到 `KNOWLEDGE_RECONCILED`。

实施计划开始前必须满足：

1. 用户复核并批准本规格。
2. 已部署的 migration `001-011`、提交 `c2d575c` 和生产 schema 作为明确实施基线；任何新 migration 从 `012` 起。
3. 基于干净、已确认的提交创建隔离实施工作树，或由用户显式授权在当前工作树协作。
4. 重新核对生产 release、Chat V2/safe mode、活动 Provider 路由和 RAG 状态。

本规格提交只代表设计已固化，不代表已实施、已测试、已迁移、已调用 Provider、已 push、已部署或已在线修复。真实 Provider、生产数据库、配置、push 和部署仍需分别获得明确授权。
