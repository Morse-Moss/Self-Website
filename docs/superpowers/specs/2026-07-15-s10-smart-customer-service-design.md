# S10 数字摩斯智能客服设计

> 日期：2026-07-15
> 状态：已确认，进入本地实现
> 产品边界：受控访问的个人作品集内置智能客服，不是独立客服 SaaS

## 1. 目标与边界

S10 在现有 S8 文字对话闭环上完成可本地验收的智能客服系统。访客使用 72 小时邀请码进入，获得 12 小时可恢复的对话上下文；系统继续使用本地 BGE 与 PostgreSQL/pgvector 检索公开作品集知识，通过配置化的 OpenAI-compatible 中转调用 GPT，并在确有必要时自动调用博查搜索。

本轮同时交付三种流程：

1. 自由对话：回答关于 Morse、项目和 Agent/RAG 方法的问题。
2. JD 匹配：粘贴最多 12,000 字 JD，输出岗位要求、可核验证据、真实缺口和追问建议，不生成伪造匹配百分比。
3. 需求初诊：用受控字段收集问题、目标、现状、约束和期望时间，生成初诊摘要；首次完成后通过事务 Outbox 排队发送飞书。

明确不做：语音、TTS、数字人视频、实时口型、跨 Session 长期记忆、自动写回知识库、部署、push、任意网页抓取和访客可控工具调用。

## 2. 决策覆盖

`docs/portfolio-blueprint.md` 中 2026-07-07 至 S8 的无 RAG、月预算硬熔断、日志脱敏和首阶段不联网记录保留为历史决策。S10 以后决策覆盖它们：

- 使用本地 BGE + PostgreSQL/pgvector RAG，不单独部署 Milvus/Qdrant。
- 不设置月预算硬熔断；保留 Token、估算费用、消息额度、联网次数、并发、超时和 kill switch。
- 原始问题、回答、搜索词和来源不脱敏保存 10 天，仅管理员可见；页面不向访客展示保留提示。
- 允许系统自动联网，访客没有搜索开关。
- 博查是唯一搜索 Provider；失败时诚实降级到站内知识，不自动切换其他搜索源。

## 3. 主流程

```text
72h 访客邀请码
  -> 12h HttpOnly access cookie/session
  -> 选择 workflow 或直接提问
  -> 恢复/创建 12h runtime conversation
  -> 本地 BGE embedding + pgvector 站内检索
  -> 服务端 SearchRouter 判断是否需要联网
       -> 不需要：直接构造证据
       -> 需要：每轮最多一次博查，只消费标题/摘要/HTTPS URL
  -> GPT 流式回答
  -> 保存 runtime history + 10d interaction log + usage
  -> SSE done；刷新仍可恢复 12h history
```

JD 与初诊沿用同一条编排主链，不另建第二套聊天服务。workflow 只改变输入合同、提示结构和完成副作用。

## 4. 数据生命周期

运行态与分析态必须物理分离：

- `access_sessions`、`conversations`、`conversation_messages` 是 12 小时运行态。Session 删除可以级联清理历史，过期后不得从分析日志恢复上下文。
- `interaction_turns` 独立保存原始问题、完整或部分回答、workflow、intent、状态、错误、Token/费用和 10 天 `delete_after`。其 Session/Conversation 标识不使用级联外键。
- `interaction_searches` 保存每轮最多一次的搜索词、路由原因、结果摘要、来源和状态，同样保留 10 天。
- `diagnoses` 保存受控初诊字段、完成状态和通知状态；原始内容按 10 天删除。
- `alert_outbox` 保存幂等通知任务；发送成功后仅保留必要投递状态，过期清理。
- 10 天后删除原文，只允许保留不含正文的聚合统计。

usage 缺失时数据库记 `NULL`，不使用 `0` 冒充真实 Token 或费用。

## 5. 数据库迁移

不修改 `001_morse_rag.sql`。新增 additive `002_s10_customer_service.sql`，并把迁移器升级为：

- Runner 在读取登记前先 bootstrap `schema_migrations(version, checksum, applied_at)`；它不属于 `002` 业务迁移。
- 空库执行 `001` 后登记 checksum。现有 001-only 数据库必须先验证 vector extension、001 的表/列/约束哨兵完整，再将当前 `001` checksum 登记为 baseline；结构部分存在或不匹配时拒绝猜测和继续。
- 按文件名顺序执行未应用迁移。
- 已应用迁移 checksum 漂移时拒绝继续。
- 验证从纯 `001` 升级到 `002`、重复执行幂等、旧邀请码/知识/历史不丢失。
- 正式回退优先回退应用代码；破坏性 down migration 只允许 disposable test database。

## 6. Provider 与取消

Provider adapter 由环境变量选择 `responses` 或 `chat_completions`，单次请求绝不自动跨协议回退，避免重复计费。模型 ID 和 base URL 均配置化。

- Responses 请求强制 `store:false`。
- Provider、Embedding、博查均接收同一个 `AbortSignal`。
- 浏览器停止、连接断开、首字节超时或总时长超时都会终止下游。
- SSE 每 15 秒发送 heartbeat，并输出 `routing / knowledge / web / answering / handoff` 状态，不输出推理内容。
- 停止或完成前失败不扣消息额度，不留下孤立 runtime user message；分析日志仍记录 `stopped` 或稳定错误码。
- 全局 Provider 与 Search 并发有独立上限，Chat 与 Search 各有 kill switch。

中转的 `/models` 已验证可达；2026-07-15 的 Responses 与 Chat Completions 两次极短探测均未取得 HTTP 响应，因此真实生成链当前标记 `BLOCKED_EXTERNAL`，不得由 Mock 覆盖。

## 7. 自动联网与引用

SearchRouter 使用可测试的服务端规则，不增加一次意图分类模型调用：

- 当前、最新、今天、版本、外部技术文档或用户明确要求查证时可联网。
- Morse 的履历、项目状态、数字、联系方式和能力事实只能由站内审核知识确认；网页只能补充外部背景，不能补造个人事实。
- 站内检索足够且问题不含时效性时不联网。
- 每轮最多一次、每 Session 最多五次博查。

S10 不抓取搜索结果页，只消费博查返回的标题、摘要和 URL。URL 必须是规范化 HTTPS，禁止凭证、非 HTTPS、localhost、私网和元数据地址。来源等级仅由服务端已配置域名/组织规则判断为站内、官方、GitHub 或普通网页；模型只引用服务端分配的 citation id，不能自行生成可点击 URL。搜索结果永不写回知识库。

## 8. 认证与安全

访客与管理员认证完全分离：

- 访客 cookie 只访问聊天 API，永远不能访问 `/api/admin/**`。
- Admin 使用独立 HttpOnly、Secure、SameSite=Strict cookie，30 分钟滑动过期。
- Admin 登录需要 scrypt 密码哈希 + RFC 6238 TOTP，允许正负一个时间窗，并在数据库拒绝同一 counter 重放。
- 管理写操作与导出检查 Origin；登录失败统一响应，数据库计数并临时锁定。
- 导出前必须再次输入一个未使用的 TOTP；JSON/CSV 直接返回，不在服务器落文件。
- 创建邀请码必须检查精确 Origin，并再次输入一个未使用的 TOTP；邀请码由服务端生成，数据库只保存 SHA-256，明文只在创建响应中出现一次。
- CSV 对公式前缀、引号、换行和编码做防护。
- 邀请码兑换按来源指纹限流，攻击事件进入幂等 Outbox。

本轮零新增运行依赖。密码与 TOTP 使用 Node `crypto`，TOTP 必须通过 RFC 6238 固定向量测试。

## 9. Outbox 与飞书

业务事务只负责写 Outbox，网络发送在提交后独立执行，失败绝不回滚访客回答。稳定去重键：

- `invite-first-use:<inviteId>`
- `diagnosis-complete:<diagnosisId>`
- `service-down:<incidentId>`
- `service-recovered:<incidentId>`
- `security:<category>:<fingerprint>:<window>`

稳定 key 保证同一业务事件在事务重试或重复触发时不重复入队，但非幂等 webhook 无法提供物理恰好一次投递。Dispatcher 使用带 lease 的至少一次语义：失败和过期 claim 可恢复；若远端已接收而本地 `sent` 提交结果未知，允许极端重复并保留同一事件 key 供识别。严格恰好一次需要切换到支持服务端幂等键且完成真实验证的应用消息接口或投递中介，S10 不伪造这项保证。

只发送首次邀请码使用、需求初诊、服务故障/恢复和安全攻击。普通对话、JD 匹配和常规额度不通知。飞书配置缺失时 Outbox 与 Mock 合同仍可验收，真实发送保持 `BLOCKED_EXTERNAL`。

`service_incidents` 按依赖与错误 fingerprint 保存独立 incident。五分钟内连续三次失败才从 `observing` 转为 `down` 并为该 incident 入队一次故障通知；后续一次成功把同一 incident 转为 `recovered` 并入队一次恢复通知。未来同一 fingerprint 再故障必须创建新 incident id，不能被旧恢复键永久去重。Provider/Search 完成路径调用服务状态记录器；邀请码触发封禁与管理员登录锁定分别在各自数据库事务内写安全 Outbox。

## 10. 管理后台

`/admin` 不进入公共导航，使用独立管理壳。功能包括：

- 密码 + TOTP 登录与退出。
- 按时间、workflow、状态、是否联网、badcase 筛选 10 天记录。
- 查看原始问题、回答、搜索词、站内/网页来源、错误、延迟和 usage。
- 标记 badcase 并记录管理员备注。
- JSON/CSV 导出，导出前重新验证 TOTP。
- 生成、查看和停用短期邀请码；列表只返回名称、状态、有效期与会话用量，不返回邀请码明文。状态区分有效、已过期、已耗尽和已停用；停用只阻止新兑换，不撤销已登录访客的 Session。

桌面是列表 + 详情双栏；390px 是单列列表和全屏详情，不压缩为横向表格。邀请码管理在桌面使用独立工具对话框，在 390px 使用全屏工具面板。

## 11. 前端交互

保留 S9 的嵌入式/浮层聊天外观，不重设计作品集。访客面只增加：

- `自由对话 / JD 匹配 / 需求初诊` 三个 workflow。
- 服务端驱动的单行阶段状态。
- 发送按钮原位切换为停止按钮。
- 站内来源与联网来源分组。
- 12 小时历史恢复、可恢复错误和搜索降级文案。

停止后保留当前部分回答并标记“已停止”，但不写入 runtime assistant history、不扣额度；可以立即重试。没有独立页面的当前站点资料显示为静态依据；站内项目案例与外部来源均在新标签页打开并带 `noopener noreferrer`，不得替换当前对话页面。状态区使用 `role=status`，逐 Token 正文不使用整体 `aria-live`。

## 12. 验收标准

- 邀请码 72 小时；对话上下文只在有效 Session 的 12 小时内恢复。
- 三种 workflow、站内 RAG、自动搜索路由、引用、停止、重试和降级均有 RED/GREEN 覆盖。
- 30 条/Session、5 次搜索/Session、单 Session 单飞、全局并发、超时、兑换/管理员限流和 kill switch 有确定性测试。
- disposable pgvector 中迁移升级、重复执行、checksum 漂移、时间旅行清理、并发、补偿、TOTP 重放、Outbox 重放和 admin 权限矩阵全通过且零 skip。
- Provider、博查、飞书分别通过本地 Mock 合同；真实证据单独标 `PASS` 或 `BLOCKED_EXTERNAL`。
- 评测覆盖三类访客、三个 workflow、拒答、prompt injection、恶意 URL、伪引用、超长 JD、错误恢复和重复通知。
- 1440x900 与 390x844 完成解锁、三流程、历史恢复、停止、搜索降级、初诊转交和管理后台；无横向溢出，console/page error 为 0。
- `prefers-reduced-motion` 下无新增持续动画；所有新增 CSS 只消费 `app/styles/tokens.css`。
- `npm test`、本地 PostgreSQL 集成、RAG/chat eval、`npm run build`、`git diff --check`、密钥扫描全部通过。
- 不部署、不 push；语音、视频、长期记忆保持未实现。
