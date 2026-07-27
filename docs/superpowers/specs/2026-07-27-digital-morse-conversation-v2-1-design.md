# 数字 Morse 对话系统 V2.1：任务上下文、原子成功与成本感知恢复设计

日期：2026-07-27
状态：产品与技术设计已逐节确认；规格已冻结，等待另行授权实施
规格固化合同：`DIRECT / FAST / LOCAL`
后续实施建议合同：`STAGED / CRITICAL / DEPLOYED`
授权边界：本文档不授权代码修改、真实 Provider 调用、数据库操作、push、部署或生产灰度

## 1. 适用范围与覆盖关系

本文档定义数字 Morse 公共聊天系统 V2.1 的最终行为合同，解决首轮无回答、多轮上下句断层、失败轮污染、RAG 硬依赖、重复生成、恢复成本和高尾延迟问题。

它在以下范围内覆盖旧规格：

- `2026-07-21-digital-morse-conversation-v2-design.md` 中默认检索、最多三次 Provider attempt、自动安全摘要和旧灰度步骤。
- `2026-07-22-chat-v2-response-reliability-design.md` 中以“紧邻 route anchor + 最近消息窗口”作为主要多轮上下文的做法。
- 任何在默认路由前增加 LLM 分类调用、把失败轮加入历史、或把 Embedding 故障升级为整轮失败的草稿实现。

旧规格中的以下合同继续有效：

- 数字 Morse 的第一人称数字分身身份。
- 公开证据、结构化能力台账、招聘正向陈述和私密简历隔离。
- 外部实时信息只能通过受控搜索核验，不能补造 Morse 的个人事实。
- 管理后台的不可变模型版本、活动路由快照、真实测试后激活和密钥安全边界。
- V1/V2 灰度、管理员邀请码白名单和公共聊天总开关。

`docs/portfolio-blueprint.md` 继续是项目级需求权威；本文档是其数字人聊天能力的详细行为规格。

## 2. 当前问题与底层根因

### 2.1 已观察问题

- 正常首轮问题没有得到回答，甚至在没有业务歧义时进入失败或澄清。
- 多轮对话中，上一句已经说明了对象，下一句仍像一段新对话。
- 前一轮失败或停止后，后一轮会继承错误主题、错误模板或失败输入。
- 项目和 JD 问题把 Embedding 当成必需依赖，Embedding 不可用时整轮返回 `RETRIEVAL_UNAVAILABLE`。
- Provider 恢复、strict 重生成和客户端重试可能叠加，带来额外费用和分钟级等待。
- 前端已经修改推理强度或最大输出，但热路径仍可能被路由级参数覆盖，实际调用与后台显示不一致。

### 2.2 根因不是一个 Prompt

1. 当前 Provider 历史直接读取会话最近若干条 `conversation_messages`，没有以 `interaction_turns.status = 'completed'` 为准，因此失败和停止轮的用户消息仍可能进入下一次请求。
2. `route_kind/topic_ref/inherited_from_turn_id` 只能描述某一轮如何路由，不能表达“当前正在推进什么任务、还缺什么、哪一轮最后成功”。
3. 仅检查紧邻上一轮 route anchor，会把任务状态、语言承接和消息历史混为一体；一旦中间插入闲聊、失败或页面恢复，继承就容易断裂。
4. 在默认路由前增加 LLM judge 会多一次 Provider 调用。它增加成本、延迟和故障面，但仍不能成为可靠的任务状态来源。
5. 当前 `grounded` 和 JD 链路仍可能强制执行 Embedding；检索基础设施故障被错误地等同于“无法回答”。
6. 当前最多三次 attempt 的 normal、failover 和 strict 组合，与较长的软硬超时共同放大尾延迟和费用。
7. 逐 token 展示、数据库成功提交和 SSE `done` 没有形成一个明确的用户成功边界。

因此，V2.1 的核心不是继续扩大规则或 Prompt，而是把“当前任务状态、成功历史、证据工具、生成恢复和持久化终态”拆成独立边界。

## 3. 目标、非目标与零容忍项

### 3.1 目标

- 完整、自包含的正常首轮问题必须进入回答链路；应用不能主动制造失败。
- 用一个结构化 Task Frame 表达当前活动任务，并让它成为唯一任务上下文权威。
- 只让成功完成的轮次进入后续语义上下文；`failed/stopped/running` 均不得污染下一轮。
- 闲聊可以临时离开任务，之后仍能自然回到原任务。
- 只有真正缺少指代对象时才进入 `clarify`。
- RAG 只负责公开证据增强，Embedding 故障时优先使用结构化公开资料继续回答。
- 正常回答只调用一次主 Provider；最多再进行一次成本受控的恢复。
- 相同 `turnId` 的已完成结果只重放，不重复生成、不重复扣消息额度。
- 回答按完整语义单元显示，数据库成功后才发送 SSE `done`。
- 管理后台实际激活的推理强度和最大输出必须成为最终调用参数。

### 3.2 非目标

- 不建设跨 Session 长期记忆，也不做用户画像推断。
- 不让 Task Frame 代替已有 `diagnoses` 结构化初诊状态机。
- 不使用前置 LLM route judge、运行时 LLM-as-judge 或额外意图 Provider。
- 不启用并发 hedging，不同时向两个 Provider 发送同一个问题。
- 不把私密简历、联系方式、管理数据或外部网页写入公共个人事实。
- 不在本轮新增搜索 Provider、模型供应商或前端视觉重做。

### 3.3 零容忍项

- 正常首轮无回答。
- `failed/stopped` 轮次进入下一轮任务或 Provider 历史。
- 已完成的相同 `turnId` 再次触发 Provider 或再次扣消息额度。
- 单轮出现两个并发回答 Provider。
- 私密简历进入公共 Task Frame、RAG、Prompt、日志或回答。

## 4. V2.1 总体流程

```text
合法请求 + turnId
  -> 查询持久化 turn 终态
      -> 已 completed：重放答案和 done，结束
      -> 仍有活动执行：不启动第二次生成
      -> 可恢复的 failed/stopped/orphan：进入受控新 execution
      -> 新 turn：继续
  -> 加载当前 Task Frame
  -> 确定性动作、对象和任务关系判断
  -> 在内存形成本轮 route 与候选 Task Frame 变更
  -> 组装 completed-only 的受控上下文
  -> 选择结构化证据、可选 RAG 或受控搜索
  -> 一次主 Provider 生成
      -> 必要时在切备用和压缩重生成中二选一
  -> 以完整句子、列表项、段落或代码块为单位通过守卫并流式显示
  -> 单一成功事务提交答案、usage、attempts、turn completed 与 Task Frame
  -> COMMIT 成功后发送 SSE done
```

路由、Task Frame、RAG、Provider 和事务分别回答五个问题：

| 边界 | 只负责回答 |
| --- | --- |
| 路由 | 用户这轮想做什么、对象是什么 |
| Task Frame | 当前正在推进哪个任务、还缺什么 |
| RAG | 哪些公开证据与当前问题相关 |
| Provider | 如何自然组织最终回答 |
| 成功事务 | 这轮是否真的完成并可以成为历史 |

任何一层都不得越权。例如，向量相似度不能创建个人经历，Provider 不能自行切换任务，SSE 已显示部分文字也不能提前推进 Task Frame。

## 5. Task Frame：唯一任务上下文权威

### 5.1 数据模型

最终 `008` 将现有草稿的“活动话题”扩展为完整 Task Frame。每个 conversation 最多保存一个当前 Task Frame：

| 字段 | 含义 |
| --- | --- |
| `conversation_id` | 当前会话，主键，删除会话时级联删除 |
| `task_id` | 当前任务的稳定 UUID；切换到新任务时生成新值 |
| `task_kind` | `project_discussion / capability_verification / jd_match / external_research` |
| `topic_kind` | `project / capability / jd / external` |
| `topic_ref` | 已批准项目 slug、能力 ID、`jd` 或受控外部主题标识 |
| `status` | `active / waiting_input / completed` |
| `waiting_for` | 受控槽位 ID 数组；禁止保存任意自然语言摘要 |
| `task_started_turn_id` | 创建该任务的 turn，`ON DELETE SET NULL` |
| `last_successful_turn_id` | 最近一次成功推进该任务的 turn，`ON DELETE SET NULL` |
| `version` | 乐观并发版本，只在真实状态变化时递增 |
| `updated_by_turn_id` | 最后一次改变 Task Frame 的成功 turn，`ON DELETE SET NULL` |
| `created_at/updated_at` | 当前任务创建和更新时间 |

`waiting_for` 只允许登记受版本控制的槽位，例如 `job_description`。`waiting_input` 必须至少有一个槽位；`active/completed` 默认没有待补槽位。

`interaction_turns` 新增 nullable `task_id` 作为历史关联 ID，并建立 `(conversation_id, task_id, status, created_at)` 索引。它不外键到可被新任务覆盖的当前 Task Frame 行；一致性由成功事务保证。这样旧任务的 completed turns 在切换后仍保留自己的历史 task ID。

### 5.2 任务卡何时创建

任务识别拆成三步：

1. **动作识别**：用户是在解释、评估、比较、核验、匹配、继续，还是只做一次问答或闲聊。
2. **对象识别**：对象来自当前消息中的项目别名、能力 ID、完整 JD、受控页面上下文或现有 Task Frame。
3. **任务关系**：本轮是 `create / continue / switch / temporary / wait / complete`。

以下情况创建任务卡：

- 对某个明确项目进行适岗评估、方案分析、连续追问或比较。
- 核验某项个人能力并预计继续讨论其证据或实现。
- 进入 JD 匹配；缺少 JD 时直接创建 `waiting_input`，等待 `job_description`。
- 对受控外部主题进行需要连续核验的研究。

以下情况不创建任务卡：

- 问候、感谢、一般闲聊。
- “什么是 RAG”之类完整的一次性通用问题。
- 简单身份介绍或项目目录查询。
- 只有一次明确答案、没有后续任务状态的一次性事实问答。

任务卡先在内存中形成候选。只有回答成功事务提交时才真正创建、切换或推进；失败和停止时直接丢弃候选。

### 5.3 决策优先级

V2.1 使用确定性级联，不调用意图 LLM：

1. 显式工作流、完整 JD、安全边界和已批准确定性命令。
2. 当前消息明确命名的项目、能力或外部对象。
3. 服务端校验的页面上下文，例如作品卡“问数字摩斯”携带的公开项目 slug。
4. 当前 Task Frame，仅用于包含代词、承接词或短追问结构的输入。
5. 自包含的新问题默认作为当前问题直接回答。
6. 只有缺少指代对象且前四项均不能确定时进入 `clarify`。

页面上下文必须是服务端允许列表中的公开 slug，不能信任客户端自由文本，也不能绕过邀请码或公开证据边界。

### 5.4 任务转换合同

| 当前输入 | Task Frame 行为 |
| --- | --- |
| 明确继续当前对象 | 复用 `task_id`，成功后更新 `last_successful_turn_id` |
| 明确提出另一个任务 | 内存生成新 `task_id`，新回答成功后原子覆盖当前卡 |
| 临时问候或完整通用问题 | 不改变活动任务，当前 turn 的 `task_id = null` |
| 岗位适配但缺少 JD | 创建或切换到 `jd_match + waiting_input + job_description` |
| 随后提交完整 JD | 同一 `task_id` 转为 `active`，清空 `waiting_for` |
| 用户明确结束当前任务 | 成功确认后设为 `completed` |
| 本轮 failed/stopped | 完全不改变 Task Frame |
| 同一 completed turn 重放 | 不递增 `version`，不重复写 Task Frame |

身份、闲聊和 `clarify` 不能把当前活动任务清空。新任务只有在其首个回答成功后才替换旧任务，避免“路由判断成功、回答失败”导致上下文丢失。

### 5.5 `clarify` 的唯一合法入口

`clarify` 不是默认兜底。它只在以下条件同时成立时使用：

- 输入确实依赖“这个、那个、它、上面那点”等缺失指代。
- 当前 Task Frame 无法提供唯一对象。
- 没有合法页面上下文。
- 紧邻的 completed 语言上下文也无法确定对象。

完整、自包含但未命中专用路由的问题进入 `conversation`，由主 Provider 正常回答。不得因为路由规则不认识某个表达就让用户替系统补分类。

### 5.6 Provider 上下文组装

原始 `conversation_messages` 继续用于页面历史和审计，但不再直接作为 Provider 业务历史。

- 继续活动任务时，只读取相同 `task_id` 且 `interaction_turns.status = 'completed'` 的 user/assistant 对，按时间排序并受 token 预算限制。
- 新任务不携带旧任务内容，只带精简固定身份、当前问题和本轮证据。
- 不创建 Task Frame 的轻量闲聊，只允许读取紧邻的少量 completed `conversation` 对作为语言承接；它们不能提供个人事实或覆盖 Task Frame。
- 自包含的一次性问题默认不需要历史。
- `failed/stopped/running` 的问题、部分回答、route anchor 和候选任务状态全部排除。
- 入口 `audienceIntent` 只影响首轮提示，不成为后续人格或任务权威。

历史窗口由 token 预算而不是固定“最近 12 条消息”控制。超出预算时优先保留 Task Frame、最近成功结论和最近 completed 对；V2.1 首版不使用额外 LLM 做历史摘要。

## 6. RAG 的定位与降级合同

### 6.1 唯一定位

RAG 是“公开作品集证据召回层”，不负责意图、上下文、任务状态、权限或 Provider 恢复。

结构化资料优先级高于向量检索：

| 问题类型 | 首选证据 | RAG |
| --- | --- | --- |
| 身份、定位 | 审核身份资料 | 不调用 |
| 项目目录 | 结构化五项目录 | 不调用 |
| 明确命名单项目 | 该项目的结构化公开资料 | 可选增强 |
| 个人能力核验 | 结构化能力台账 | 仅补充已准入项目叙述 |
| 模糊跨项目问题 | 公开知识候选 | 按需调用 |
| 完整 JD | 能力台账 + 结构化项目事实 | 按需增强 |
| 通用知识、闲聊 | 模型常识和当前对话 | 不调用 |
| 外部实时信息 | 受控 Search | 不使用个人 RAG |

### 6.2 Embedding 故障

- 结构化证据足以回答时，Embedding 或 pgvector 故障只设置 `evidence_degraded` 遥测，继续主回答。
- 明确项目、能力和 JD 不得仅因 Embedding 不可用而整轮返回 `RETRIEVAL_UNAVAILABLE`。
- 只有用户明确要求检索知识库、且没有任何结构化安全答案时，才返回准确的检索不可用说明；不得编造证据。
- Search 故障不能用模型记忆冒充实时核验；它与 RAG 降级是两个独立状态。
- 任何降级都不能扩大公开范围或接触私密简历。

readiness 的 HTTP 200 不能单独证明 RAG 端到端可用。验收必须包含实际 Embedding + pgvector 评测或明确记录为降级状态。

没有公开知识内容变化时不运行 `ingest`；代码、路由、Task Frame 或 Provider 参数变化都不是 ingest 理由。

## 7. Provider 调用、成本与时间预算

### 7.1 调用上限

- 正常情况只有一次主回答 Provider 调用。
- 禁止并发、hedging 和“路由 Provider + 回答 Provider”。
- 每轮最多一次额外恢复调用，总计最多两个生成 attempt。
- 备用线路接管与压缩/strict 重生成二选一，不能连续执行两种恢复。
- 已向用户发送第一段可见正文后锁定当前 Provider，不再切备用或重生成。
- `jd_intake` 和合法确定性 `clarify` 可以零次生成调用。

### 7.2 恢复选择

| 情况 | 行为 |
| --- | --- |
| 正文可见前出现连接、5xx、429、协议或空完成故障 | 费用和剩余时间允许时，切一个健康备用 |
| 正文可见前回答被输出守卫拒绝 | 费用允许时，使用一次压缩/strict 重生成 |
| `max_output_tokens` 截断 | 不记为节点故障；正文尚未可见时可选择一次压缩重生成 |
| 已经显示正文后故障或截断 | 不自动切换；保持同一消息失败态并允许手动重试 |
| 用户停止 | 立即停止，不恢复，不推进任务 |

节点级基础设施失败进入现有健康状态；连续故障节点在冷却期内直接跳过，避免每轮先等它失败再切换。输出守卫拒绝、token 截断和用户停止不打开节点熔断。

### 7.3 成本门

恢复前必须计算额外调用的保守费用上界：

- 优先使用活动模型版本中配置的 input/output 单价和预计 token 上限。
- 价格不完整时不能把成本记成 0；使用管理员配置的未知价格保守上界。
- 单轮恢复预算、滚动窗口恢复率和实际 attempt 费用都要记录。
- 预计费用超过单轮上限、滚动预算已满、费用无法形成受控上界或剩余时间不足时，不自动恢复。
- Provider usage 或价格未知时保留 `null/cost_complete=false`，不得伪造精确成本。

消息额度仍只在完整回答成功提交后扣一次。已经失败的上游 attempt 可能产生真实 Provider 成本，系统必须如实记录；禁止的是自动并发重复、已完成 turn 再生成和多次扣消息额度，而不是把实际发生的失败调用伪装成免费。

### 7.4 推理强度与最大输出

- V2.1 不设置请求级 `reasoningEffort`，最终值只来自当前活动模型版本；路由不得强制覆盖为 `low/minimal`。
- 主回答目标 `max_output_tokens = 1200`。它是最大输出上限，不要求模型写满 1200，也不增加输入 token。
- 1200 能降低长 JD、项目分析和完整句子缓冲时的意外截断，但会提高最坏情况下的输出费用和生成时长；Prompt 和回答守卫仍应按问题控制篇幅。
- 环境默认值、示例配置、后台运行摘要和测试必须保持一致。
- 已存在的数据库模型版本不可原地修改；需要由管理员创建 `1200` 的新模型版本、完成一次受控真实测试，再激活新路由版本。

### 7.5 可调时间策略

时间阈值必须来自配置，不写死在业务分支。首轮灰度建议从以下配置开始观察：

- 无有效协议活动：12 秒后结束当前 attempt。
- 已有协议活动但无模型正文：最多等待到 attempt 第 35 秒。
- Provider 阶段总预算：70 秒。
- 整轮绝对预算：90 秒。

`12/35/70/90` 是首轮灰度配置，不是永久产品常量。明确网络错误立即失败，不等待阈值；协议元数据不能反复重置计时；有正文后只受剩余总预算约束。任何配置都必须满足：

```text
protocol inactivity < first model text <= provider stage <= turn deadline
```

只有剩余时间足以完成一次有意义的恢复时才能启动第二 attempt。灰度后根据首协议、首模型正文、首用户可见正文和完成时长的分位数据调整，而不是只看总耗时猜测 Provider 慢。

## 8. 原子成功、SSE 与幂等

### 8.1 单一成功事务

一次回答只有在同一数据库事务完成以下写入后才算成功：

- 完整 assistant answer 与公开来源。
- 最终 usage、已知费用和成本完整性。
- 本轮 Provider attempts 的最终快照和赢家。
- `interaction_turns.status = 'completed'` 与 `completed_at`。
- assistant conversation message。
- 成功后的消息额度结算和现有工作流副作用。
- `interaction_turns.task_id` 与候选 Task Frame 创建、切换或推进。

任一写入失败都回滚整个成功事务。`failed/stopped` 可以拥有独立的失败审计和真实 attempt 记录，但不能拥有 completed assistant 历史、成功额度结算或 Task Frame 变更。

`COMMIT` 返回不确定结果时，服务端必须重新查询持久化 turn、答案、attempts 和 Task Frame：只有全部匹配才视为成功；否则不得发送 `done`。

### 8.2 SSE 可见性

- Provider token 先在服务端缓冲为完整句子、列表项、Markdown 段落或完整代码块，再通过输出守卫后发送。
- 用户可见 delta 在 `done` 前均属于 pending assistant，不进入下一轮语义历史。
- 只有成功事务 COMMIT 后才能发送 SSE `done`。
- COMMIT 前连接断开不改变成功判定；如果事务最终成功，相同 `turnId` 重连后重放完整持久化答案。
- 持久化失败时不发送 `done`，现有消息气泡转为稳定失败态；已显示的临时文本不得成为后续上下文。
- 完整缓冲的 JD、能力边界和高证据风险回答在提交前不释放不完整片段。

### 8.3 相同 `turnId` 的状态机

每次进入生成前都先查询 `interaction_turns`：

| 持久化状态 | 行为 |
| --- | --- |
| `completed` | 原样重放 answer、sources、usage 摘要和 `done`；Provider 调用数为 0 |
| `running` 且原执行仍持锁 | 返回进行中/恢复状态；不得启动第二执行 |
| `running` 但已成为 orphan | 在抢占同一 advisory lock 后恢复，不允许并发执行 |
| `failed/stopped` | 用户明确重试时创建新的受控 `execution_id`，仍复用原 `turnId` |
| 不存在 | 创建新 turn |

每个执行的 attempts 通过 `execution_id` 区分。重复请求不得新增用户消息、重复扣消息额度或重复推进 Task Frame。手动重试失败执行前也必须先复查 completed 结果，避免“上一次其实已经提交，只是客户端没收到 done”时再次付费生成。

## 9. 隐私、权限与兼容性

- Task Frame 只保存稳定 ID 和受控槽位，不保存原始 JD、自由文本摘要、私密简历、联系方式或网页正文。
- 公共聊天邀请码与私密简历邀请码继续独立；聊天 Task Frame 不得读取简历授权状态。
- 管理员 Cookie、Provider Key、Base URL、系统 Prompt 和原始 Provider payload 不进入 Task Frame 或 attempt 公共详情。
- V1 不读取 `conversation_task_state` 和 `interaction_turns.task_id`，最终 `008` 必须是纯新增兼容迁移。
- 生产当前只有 `001-007` 时，可以在发布前最终确定 `008`；已经应用旧草稿 `008` 的本地开发库必须先按显式本地授权重建该草稿结构，再验证最终迁移。
- 无关的 `db/migrations/009_db_growth_indexes.sql` 不进入 V2.1 范围。

## 10. 可观察性

每轮至少记录以下非敏感指标：

- 最终 route、reason code、task action、task kind 和是否使用历史。
- 是否调用结构化证据、Embedding、pgvector 或 Search，以及是否发生证据降级。
- attempt 数、primary/failover/strict、首协议、首模型正文、首用户可见正文和完成时长。
- 是否发生恢复、恢复原因、恢复前费用上界、实际 usage 和 `cost_complete`。
- `done` 前事务耗时、COMMIT 不确定恢复次数、相同 turn replay 次数。
- 错误 clarify、任务误切换和失败轮污染通过评测标签记录，不保存私密正文到结构化日志。

发布观察重点是：

- 正常回答完成率。
- 首轮无回答数。
- `clarify` 率和误 clarify 数。
- Provider 恢复率、平均 attempt 数、费用和 P95 延迟。
- RAG 降级率及降级后回答完成率。
- 相同 completed `turnId` 再生成数和重复扣额度数。

样本不足时报告分子、分母和观察窗口，不用百分比制造稳定性结论。

## 11. 五层验收合同

### 11.1 第一层：意图与 Task Frame，不调用 Provider

- 单轮 route、动作、对象和 create/continue/switch/temporary/wait/complete 全覆盖。
- 完整问题默认回答，`clarify` 只覆盖缺失指代。
- 页面上下文存在时，“这个项目适合投前端岗位吗？”识别对应项目并创建评估任务。
- 没有页面上下文、没有 Task Frame 且“这个项目”确实无指代时，才返回一次自然澄清。
- 已有任务 -> 临时闲聊 -> “那它适合前端吗”能够恢复原任务。
- failed/stopped previous turn 不可成为 task anchor。
- 离线评测必须证明 route judge Provider 调用为 0。

### 11.2 第二层：RAG 与降级

- 现有固定 RAG gold 集继续验证 top-k 和公开范围。
- 增加不写进规则的盲测口语集，覆盖项目别名、跨项目比较和 JD 长文本。
- 身份、项目目录、明确项目和能力问题断言结构化资料优先。
- 注入 Embedding 连接失败、超时和 pgvector 查询失败；有结构化证据时回答仍完成。
- RAG、Search 与私密简历隔离合同必须全部通过。

### 11.3 第三层：Provider 与成本

- 正常路径严格一次 Provider。
- 无并发 Provider，任何路径总 attempt 不超过 2。
- failover 和 strict/压缩重生成不能同时发生。
- 正文可见后不切 Provider。
- 费用超限、价格无法形成上界、节点熔断或剩余时间不足时不恢复。
- token 截断不计入节点故障。
- 活动模型的 reasoning 与 `max_output_tokens=1200` 到达最终 Provider 请求。

### 11.4 第四层：数据库、SSE 与幂等

- 使用真实测试 PostgreSQL 运行 migration 和事务集成测试，不允许以 `skip: !pool` 代替发布证据。
- 在 answer、usage、attempts、assistant message、turn completed 和 Task Frame 每个写点注入故障，全部证明回滚。
- 故障注入测试必须断言确实到达目标写点，不能因错误向量等前置校验失败而假通过。
- `done` 只能出现在 COMMIT 后。
- COMMIT 响应丢失后能通过持久化核对恢复成功。
- completed replay、running 并发重试、orphan 恢复、failed/stopped 手动重试均保持单飞和额度幂等。

### 11.5 第五层：最多五次真实主回答

只有获得单独付费 Provider 授权后才执行，最多五次主回答，不额外启动 route judge：

- 正常首轮项目适岗问题。
- 项目连续追问。
- 中间插入闲聊后回到任务。
- Embedding 不可用时的结构化降级回答。
- completed turn 断线重放，验证第二次 Provider 调用为 0。

这五次是发布前受控冒烟，不冒充统计 SLO。后续稳定性通过真实灰度流量观察，不为了凑样本主动增加付费调用。

### 11.6 零容忍发布门

- 正常首轮无回答：0。
- 失败轮污染：0。
- completed `turnId` 重复生成或重复扣额度：0。
- 并发 Provider：0。
- 私密内容泄露或无证据个人事实：0。

任一项出现一次即停止扩大灰度。

## 12. 当前未提交草稿的处理结论

当前工作区的 V2.1 草稿只能作为实现素材，不能整体提交。正式实施时按下表处理：

| 草稿内容 | 结论 |
| --- | --- |
| answer、usage、attempts、completed、task state 同事务 | 保留方向，按本规格补全故障注入 |
| completed replay 不重复 bump version | 保留 |
| failed/stopped previous anchor 排除 | 保留并扩展到全部 Provider 历史 |
| `conversation_task_state` 的简化 topic/status | 重写为完整 Task Frame |
| 默认路由前 LLM fallback judge | 删除实现和测试，不进入主回答前链路 |
| 最近 12 条原始 conversation history | 替换为 task-scoped completed-only 历史 |
| `grounded/JD` Embedding 硬失败 | 改成结构化优先和可观测降级 |
| 最多三次 Provider attempt | 改成正常 1 次、额外恢复最多 1 次 |
| 多轮 eval 与 task-state replay | 保留框架，按本规格扩充失败、闲聊和降级用例 |
| 未真正到达事务故障点的集成测试 | 修正前置数据并断言注入点已命中 |

## 13. 实施切片

正式开发应按以下顺序进行，每一片先写失败用例：

1. **最终 008 与 Task Frame 数据访问**：完整字段、turn task ID、版本和原子转换。
2. **确定性任务识别与上下文装配**：删除 LLM judge，完成 completed-only 历史。
3. **结构化证据优先与 RAG 降级**：拆除 Embedding 总开关语义。
4. **成本感知 Provider 恢复**：最多两次、无并发、健康节点跳过、1200 输出配置。
5. **句级 SSE、成功事务与 turn 幂等**：COMMIT 后 done 和故障注入。
6. **五层评测、灰度开关与观察面板**：先本地和测试 DB，再请求真实调用授权。

每个切片都要保持现有私密简历、管理员认证、搜索额度、初诊状态机和 V1 兼容边界。不得把时序、Task Frame、RAG 和 Provider 恢复继续全部堆入 `chat-service.ts`。

## 14. 灰度上线与回滚

### 14.1 上线顺序

1. 最终 `008` 只做 additive migration；排除无关 `009`。
2. 部署 V2.1 代码时默认关闭 V2，并保持普通访客走 V1。
3. 通过既有聊天邀请码 ID 白名单，只为指定的新聊天 Session 启用 V2.1；私密简历邀请码不参与。
4. 获得单独授权后完成最多五次真实主回答验收。
5. 通过后按聊天邀请码批次扩大，不在低流量站点使用缺乏意义的虚假百分比。
6. 达到足够自然流量后再考虑普通 Session 灰度和全量。

生产迁移需要运行最终 `008` 和对应最小 app-role grants。知识内容没有变化，因此不运行 ingest。若镜像和基础设施定义未变化，不重建 DB、Embedding 或 Edge；具体部署范围仍以实施后的实际 diff 为准。

### 14.2 回滚

- 问题出现时关闭现有 V2 总开关，只让**后续新 turn** 回到 V1。
- 已经开始的请求不在中途切版本或切 Provider，避免重复回答和重复计费。
- 不执行数据库 down migration；V1 忽略纯新增的 `008` 表和列。
- 私密内容泄露时直接关闭公共 Chat 总开关，而不只回到 V1。
- 重复扣额度、并发 Provider、失败轮污染或正常首轮无回答时立即停止扩大灰度。

V1 至少保留一个完整观察周期，并保留可用发布镜像。V2.1 达到真实稳定证据后，再单独评估旧代码和历史镜像清理；不得为了节省少量磁盘空间提前失去回滚路径。

## 15. 完成定义与后续授权边界

V2.1 只有同时满足以下条件才能称为“生产稳定”：

- 本规格的五层验收均有当前证据。
- 真实测试数据库没有跳过事务和 migration 用例。
- 最多五次授权主回答全部通过。
- 指定邀请码灰度中零容忍项保持为 0。
- Git commit、push、生产 release 指针和线上行为分别有独立证据。

本文档提交只代表规格已固化，不代表当前未提交代码正确，也不代表 V2.1 已实施、已迁移、已调用 Provider、已 push 或已部署。上述动作必须分别获得明确授权。
