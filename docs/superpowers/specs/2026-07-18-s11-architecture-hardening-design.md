# S11 模块化架构、工程治理与上线安全设计

> 日期：2026-07-18
> 状态：已确认目标架构，待摩斯审阅书面设计后进入实施计划
> 基线：本地 `master` 提交 `88d6b9c`
> 交付边界：`LOCAL`；不 push、不部署、不修改外部只读项目
> 执行控制：`STAGED / CRITICAL / LOCAL`

## 1. 背景与判断

Revolution 已从个人作品集扩展为带访问控制、RAG、流式对话、联网搜索、管理后台、Outbox、故障监控和数据保留策略的模块化单体。当前系统不是需要推倒重写的“屎山”，但复杂度已经集中到少数热点，继续在这些热点内叠加功能会迅速增加回归风险。

2026-07-18 的只读盘点得到以下事实：

- `app/`、`components/`、`lib/` 内共有 89 个 TypeScript/TSX 模块和 142 条内部依赖边。
- 没有发现客户端组件直接依赖 `lib/server/**`、API 依赖 UI、服务端反向依赖页面等分层越界。
- 存在一条循环依赖：`turn-codec -> search-safety -> search-provider -> turn-codec`。
- `lib/server/chat-service.ts` 为 1522 行，直接依赖 15 个模块，同时承担 Turn 预留、事务恢复、RAG、Search、Provider 流、故障监控、完成提交和失败补偿。
- `components/chat/useMorseChat.ts` 为 528 行，维护访问状态、历史恢复、三类 workflow、18 组状态、SSE 消费、重试和停止。
- `next.config.mjs` 为空；仓库没有生产 Dockerfile、进程编排、CI 门禁或生产运行手册。
- 告警派发、过期清理和本地 Embedding 已有独立脚本，但没有冻结上线后的运行、健康检查和失败恢复合同。
- 本地 `compose.yaml` 使用 loopback 端口、`trust` 认证、超级用户和无 SSL，仅适合开发，不得作为生产数据库配置。
- 现有 507 项测试已覆盖访问码、Admin TOTP、防重放、事务补偿、RAG、Provider、搜索、Outbox、保留策略和 UI 合同；这些复杂度承载真实边界，不能为了缩短文件而删除。

因此 S11 选择增量式模块化治理，不重写产品，不切换框架，不引入微服务和 ORM。

## 2. 目标与非目标

### 2.1 目标

1. 让模块依赖方向可说明、可测试、不可静默退化。
2. 把对话运行时按稳定职责拆分，同时完整保留现有事务、幂等、补偿和中止语义。
3. 减少客户端与服务端重复合同，让 API、SSE、来源和错误码只有一个纯类型来源。
4. 删除已经确认无消费者、重复或被新边界取代的代码，不做猜测性清理。
5. 建立可执行的工程准则，使未来 Agent 和人工开发都受到同一组架构门禁约束。
6. 补齐从“本地可运行”到“可安全上线”之间的配置、进程、数据库、健康检查、日志和回滚合同。
7. 保持用户可见页面、API、数据库格式、邀请码、三类 workflow、来源内容与分组和现有保留时长不变；来源导航遵循已确认的非打断合同：当前页资料静态展示，站内项目与联网资料在新标签页打开。

### 2.2 非目标

- 不拆成网络微服务，不引入消息队列、Kubernetes、Service Mesh 或分布式工作流引擎。
- 不切换 Next.js、PostgreSQL/pgvector、OpenAI-compatible Provider 或 CSS Modules。
- 不引入 ORM、依赖注入容器、全局 Event Bus 或通用 Repository 基类。
- 不新增语音、视频数字人、长期记忆、自动知识写回或任意网页抓取。
- 不在重构中修改现有数据库表语义；如后续确需 migration，必须另立阶段合同。
- 不把测试、CSS、图形渲染文件仅因行数较大而机械拆分。
- 不在本阶段自动部署、push、购买服务或调用真实外部 Provider。

## 3. 方案选择

### 3.1 采用：增量式模块化单体

保留一个 Next.js 主应用和 PostgreSQL，将后台任务作为独立进程运行，Embedding 作为独立进程或受控远端适配器。模块通过进程内 TypeScript 接口和 PostgreSQL 持久状态协作。

优点：

- 复用现有 507 项回归保护和已经验证的事务语义。
- 部署、排障和成本适合当前受控访问量。
- 可以逐阶段回滚，每个阶段都能证明行为未变。
- 未来若某个边界确有独立扩缩容需求，已有端口可作为服务拆分起点。

### 3.2 不采用：一次性分层重写

一次把所有 SQL、Provider、Hook 和 API 重写成新的分层架构，会同时改变事务、取消、SSE 和 UI 状态，难以判断回归来自哪里。现有系统没有达到必须重写的程度。

### 3.3 不采用：立即拆微服务

当前访问受控，单实例 Provider 并发和 PostgreSQL 锁足以满足近期需求。微服务会新增鉴权、网络重试、链路追踪、部署协调和数据一致性问题，维护成本高于收益。

## 4. 目标拓扑

```text
Browser
  -> TLS reverse proxy / platform edge
      -> Next.js main service (initially one replica)
          -> PostgreSQL + pgvector
          -> OpenAI-compatible chat adapter
          -> Embedding adapter -> BGE process or approved remote endpoint
          -> Search adapter -> Bocha (optional, kill-switch controlled)

Background worker (same repository, separate process)
  -> PostgreSQL Outbox claim / retry
  -> Feishu webhook adapter
  -> retention cleanup schedule

Operations
  -> liveness/readiness probes
  -> structured privacy-limited logs
  -> backup / restore verification
  -> migration command with a separate privileged role
```

### 4.1 初始部署约束

- Next.js 主服务先固定一个 replica。现有 Provider/Search Semaphore 是进程内上限，多副本会放大全局并发；支持多副本前必须引入跨实例限流或重新冻结容量合同。
- Background worker 可以独立重启，但同一数据库允许多个 worker 竞争；Outbox 必须继续使用 `FOR UPDATE SKIP LOCKED` 和 lease 语义。
- 初始只运行一个 worker。Outbox 空闲时每 5 秒轮询一次，单轮不超过 `MORSE_ALERT_DISPATCH_LIMIT`；连续基础设施错误采用有界退避，最长 60 秒，业务投递重试继续服从数据库中的 attempt cap 和 available time。
- retention cleanup 在 worker 启动时执行一次，之后每小时执行一次；同一时刻只允许一个 cleanup，通过 PostgreSQL advisory lock 跳过重复执行，不并发删除同一批数据。
- Embedding 不与 Next.js 生命周期绑死。主服务只依赖 Embedding port，不管理模型进程。
- PostgreSQL 是唯一跨进程协调和持久状态来源，不增加第二套队列或缓存真相源。

## 5. 模块边界

### 5.1 允许的依赖方向

```text
app routes / React components
  -> lib/client or lib/server application modules
      -> lib/contracts and domain-pure modules
          <- provider / database adapters implement ports
```

硬规则：

- `components/**` 只能依赖 React/Next 客户端能力、`lib/client/**`、`lib/contracts/**` 和公开内容模块。
- `lib/client/**` 禁止依赖 `lib/server/**`、Node 内置模块、`pg` 或 Provider SDK。
- `lib/contracts/**` 必须纯净，不依赖 React、Next、Node、数据库或 Provider。
- `app/api/**` 只负责 HTTP 解析、认证、配置装配和响应映射，不承载业务状态机或 SQL。
- `lib/server/**` 禁止依赖 `components/**` 和 `app/**`。
- 内部依赖图不得出现循环。
- Provider SDK 只能在 adapter/factory 边界实例化；业务编排只依赖 port。

这些规则由自动化 architecture contract 测试执行，不只写在文档里。

### 5.2 共享合同层

新增纯模块 `lib/contracts/chat.ts`，统一以下稳定合同：

- `ChatMode`、`ChatAudienceIntent`、`ChatWorkflow`、`ChatPhase`。
- 公开 Chat source 及来源 kind。
- SSE 的 `status/meta/delta/done/error` 公共 payload。
- 公开错误码集合与可恢复错误分类。
- 诊断字段的公共形状；运行时验证仍由服务端完成。

`turn-codec` 和 `search-provider` 改为依赖该纯合同，从而消除现有循环依赖。共享合同不包含数据库 row、SDK response、内部错误原因或管理后台私有字段。

### 5.3 服务端对话运行时

`chat-service.ts` 最终只保留应用编排：

1. 获取 Turn/Session 锁。
2. 调用 Turn 生命周期模块完成 reservation/replay。
3. 调用 Retrieval 和 Search coordinator。
4. 调用 Provider port 并转发流事件。
5. 调用 Turn 生命周期模块提交完成或补偿失败。

拆分为：

- `chat-turn-lifecycle.ts`
  - Session/Conversation/Turn 校验。
  - reservation、orphan recovery、replay。
  - diagnosis 状态与 Outbox 原子提交。
  - completion、usage、history、retention。
  - stop/failure compensation 和 ambiguous commit 恢复。
- `chat-search-coordinator.ts`
  - SearchRouter 决策、claim、quota、Provider 调用、持久化和降级。
  - Search incident success/failure 记录。
- `chat-dependency-monitor.ts`
  - Provider/Search 的稳定 fingerprint、故障和恢复记录。
  - 只记录受控事件字段，不记录问题、回答、API payload 或密钥。
- `chat-service.ts`
  - 只组织阶段顺序和 SSE 业务事件。

事务生命周期模块允许较长，因为它承载一个完整状态机；不得为了文件行数把一次原子事务拆到多个不透明的通用 Repository。

### 5.4 客户端对话运行时

新增 `lib/client/morse-chat-api.ts`：

- access check / redeem / logout。
- history load。
- chat request 构造与 SSE 调用。
- HTTP/SSE 稳定错误映射。

`useMorseChat` 继续作为页面编排 Hook，但不再直接调用 `fetch` 或解释 SSE frame。第一阶段不强制改成 `useReducer`；只有当状态转换可以写成稳定、可测试的有限状态机时才迁移，避免用大量 action 样板替换可读状态。

## 6. 不可破坏的运行语义

以下行为是重构硬门：

- 同一 Session 同时只允许一个 running Turn。
- Turn idempotency、completed replay、stopped retry 和 conversation/workflow 校验保持不变。
- advisory lock 覆盖整个需要串行化的 Turn 生命周期，并在异常时可靠释放或销毁连接。
- reservation、完成、diagnosis Outbox、message quota 和 usage 的事务边界保持原子。
- COMMIT acknowledgement 丢失时必须通过持久状态确认，不能盲目重放或扣两次额度。
- Provider/Embedding/Search 的 AbortSignal 必须从 HTTP 断线和用户停止一直传播到下游。
- 已输出部分正文后不得自动重试 Provider，以免产生重复回答。
- 只有幂等且尚未对访客输出正文的瞬时失败可以有界重试；SDK 自带重试保持关闭。
- Provider 失败、停止和持久化失败必须执行补偿，不保留孤立 runtime user message，不错误扣额度。
- 12 小时 runtime history 与 10 天 interaction analytics 继续物理隔离。

## 7. 输出合同与 badcase

2026-07-18 的真实 turn `76f4ed91-a3ce-4fc8-a30b-ec0c0c0d4fc7` 已完成，但正文开头出现 `search("\\u...")` 伪工具调用文本；该 turn 没有执行真实 Search。

处理原则：

1. 先通过受控 Provider 事件采样确认污染来自模型正文、特定事件类型还是中转转换。
2. 建立 badcase fixture 和输出合同测试，覆盖伪工具调用、推理标签、空正文和非法 citation。
3. 如果是非消息事件，adapter 必须按 item/content 类型过滤。
4. 如果是模型正文，优先修正请求合同和模型配置；只有语法明确、不会删除合法内容时才使用确定性 sanitizer。
5. 不使用宽泛正则删除 `search(...)`，不静默隐藏无法解释的输出。

## 8. 工程准则

S11 实施时新增 `docs/engineering-standards.md` 作为项目工程准则，并由根项目规则引用。准则至少包含以下硬规则。

### 8.1 复杂度与抽象

- 每个模块必须有一个可用一句话说明的职责和明确消费者。
- 生产 TS/TSX 文件超过 400 行或内部扇出超过 10 时触发职责审查；600 行不是机械失败线，但必须在设计或评审中说明为何不能按稳定边界拆分。
- CSS、测试、生成文件、图形算法和单一事务状态机可以例外；例外必须说明承载的真实边界。
- 只有稳定重复、独立变化原因或外部边界才能形成抽象；单一调用点不创建通用层。
- 不为了“解耦”引入透传 wrapper、万能 helper、Service Locator 或泛型 Repository。
- 删除代码前必须证明无运行时消费者、无动态入口、无测试/运维合同依赖。

### 8.2 错误与重试

- 对外只暴露稳定错误码；原始 Provider、数据库和 webhook payload 不进入响应。
- 每次重试必须说明：可重试错误集合、幂等依据、输出前/后边界、最大次数和总超时。
- Abort、timeout、failed、incomplete 和 partial output 是不同终态，不得合并成模糊 catch。
- 降级必须可见且诚实，不得隐式切模型、切协议或把 Mock 证据当真实 Provider。

### 8.3 数据与事务

- 数据不变量优先由数据库 constraint、unique key、foreign key 和事务保护。
- migration 只追加；checksum 漂移、partial schema 和多入口 migration 必须 fail closed。
- 普通运行角色无 DDL、建库、建角色和超级用户权限；migration 使用独立受控角色。
- 明文邀请码、Session token、Admin 密码、TOTP secret、Provider key 和 webhook 永不入库或日志。
- `delete_after` 不等于已删除；上线必须有定时 cleanup、执行指标和失败告警。

### 8.4 Provider 与外部网络

- 所有外部访问经过 adapter，必须有 allowlist/URL 校验、timeout、concurrency、AbortSignal 和安全错误映射。
- 业务层禁止直接实例化 SDK 或读取密钥。
- 联网结果是不可信数据，不是指令；外部来源不能补造 Morse 的个人事实。
- 真实 API 调用、部署和远端修改继续是明确审批门。

### 8.5 测试与交付

- 新行为先有失败测试；重构先有行为刻画，并证明重构前后合同一致。
- 分层门禁为：focused -> affected integration -> full suite -> build -> browser/API smoke -> release security checks。
- 测试不得通过 skip 掩盖缺失环境；外部证据必须单独标记 `PASS` 或 `BLOCKED_EXTERNAL`。
- 架构测试检查层级越界、循环依赖和纯合同污染。
- UI 改动必须做 1440/390 真实渲染；纯后端重构复用既有视觉基线并执行最小页面 smoke。
- 每阶段独立提交，禁止把行为修复、架构迁移和部署配置混成一个不可回滚提交。

## 9. 上线安全基线

### 9.1 HTTP 与浏览器

- 生产只接受 HTTPS；TLS 在受控 reverse proxy 或平台边缘终止。
- 配置 `poweredByHeader: false`、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、frame 限制和最小 `Permissions-Policy`。
- CSP 采用单独阶段设计并在真实 Next.js render 上验收，不使用会破坏 hydration 的拍脑袋策略。
- Access/Admin cookie 保持 HttpOnly；生产 Secure；Admin SameSite=Strict；Allowed Origin 必须是精确 HTTPS origin。
- Proxy 必须限制请求体、请求速率、连接数和 SSE idle timeout；应用层仍保留字段长度与业务额度校验。
- 健康检查拆为无敏感细节的 liveness/readiness；公开响应不泄漏模型、密钥状态、表结构或内部错误。

### 9.2 数据库

- 生产禁用 `trust`，使用强凭据和 TLS。
- runtime、migration、backup 使用不同角色和最小权限。
- 不把数据库公网暴露给任意来源；只允许应用/worker 网络访问。
- 初始恢复目标是恢复服务，不承诺恢复短期访客 Session 或 10 天 interaction analytics。schema 由 migration 重建，公开知识由仓库内容重新摄取，邀请码可重新生成；原始问题、回答和搜索摘要不复制到长期备份，从而不延长 10 天保留边界。
- 上线前在隔离数据库完成一次“空库 migration -> 公开知识重摄取 -> 新邀请码 -> 对话 smoke”的恢复演练，并记录恢复耗时与校验结果。未来若要备份 interaction analytics，必须先建立单独的数据保留决策。
- Pool 必须有连接上限、连接/statement/idle timeout 和可识别的 `application_name`；容量按主服务和 worker 副本总和计算。

### 9.3 进程与密钥

- 同一代码镜像支持 web、worker 和 migration 三种显式命令；migration 不在每个 web replica 启动时自动并发执行。
- Worker 的 Outbox、cleanup 具备 lease/idempotency，并能在崩溃后恢复。
- 密钥只由部署平台 secret store 或主机受限环境文件注入，不进入镜像层、日志、构建产物和 Git。
- 环境启动前做 fail-closed 配置校验；开发专用 test embedding 开关在生产必须拒绝。
- 依赖锁文件必须提交；上线门执行生产依赖审计、密钥扫描和镜像/主机补丁检查。

### 9.4 可观测性

- 结构化日志只包含稳定 event code、turn/incident id、dependency、latency 和终态。
- 默认不记录问题、回答、搜索摘要、邀请码、cookie、Authorization、API key、TOTP 或 webhook URL。
- 至少监控：HTTP 5xx、Provider/Embedding/Search 失败率、空回答、p95 latency、连接池等待、Outbox backlog/retry、cleanup 最近成功时间和磁盘/数据库容量。
- 告警只覆盖真实需要处理的事件，沿用飞书 Outbox，不为普通对话或正常额度发送噪声。

## 10. 分阶段迁移

### S11-0 Guardrails

- 新增工程准则和 architecture contract 测试。
- 固定当前依赖图、循环依赖和允许例外。
- 补齐 `.gitignore` 中已确认的临时输出边界，避免误提交；不删除用户现有文件。
- 不改变运行行为。

### S11-1 Contracts And Cycle

- 引入纯 `lib/contracts/chat.ts`。
- 统一 Chat/SSE/source/error 类型。
- 消除唯一循环依赖。
- 保持 JSON、SSE 和数据库 envelope 字节级兼容。

### S11-2 Server Runtime Cohesion

- 提取 Turn lifecycle、Search coordinator 和 dependency monitor。
- `chat-service.ts` 保留编排，不直接承载 SQL 和 incident 细节。
- 每次只移动一个职责集，运行完整 integration tests 后再继续。

### S11-3 Client Runtime Cohesion

- 提取 `morse-chat-api.ts`。
- Hook 不直接解析 HTTP/SSE。
- 是否引入 reducer 由状态迁移测试决定，不预先承诺。

### S11-4 Output Robustness

- 建立 `search("...")` 等输出 badcase。
- 用真实事件证据决定 adapter filtering、prompt contract 或安全 sanitizer。
- 验证 citation 和 Markdown 渲染不回归。

### S11-5 Deployment And Security

- 增加生产镜像/命令合同、web/worker/migration 运行方式和部署 runbook。
- 增加安全响应头、健康检查、数据库权限/TLS/Pool 合同和备份恢复清单。
- 增加 release security gate；真实平台配置保持人工审批。

### S11-6 Final Verification

- architecture contract 零循环、零越界。
- 全量测试零 fail、零 skip，生产构建通过。
- Mock E2E 与 1440/390 页面 smoke 通过。
- Provider 真实调用只在获得当次审批后执行并单独记录。
- 运行手册包含启动、迁移、worker、cleanup、备份、恢复、回滚和故障排查命令。

## 11. 验收标准

1. 依赖图无循环，分层规则由自动测试强制执行。
2. `chat-service.ts` 不再直接实现 Turn SQL、Search claim/finalize 或 incident persistence，只做可读的阶段编排。
3. 事务、补偿、replay、orphan recovery、stop、partial answer 和 quota 行为与 S10 一致。
4. 客户端 Hook 不直接解析 SSE frame，公共合同不再在 client/server 重复定义。
5. 删除项均有无消费者证据；没有为了行数进行机械拆分。
6. 现有 507 项测试及 S11 新增测试全部通过，零 skip；`npm run build` 通过。
7. `search("...")` badcase 有可复现 fixture、根因分类和确定性处理结论。
8. 生产拓扑、进程命令、健康检查、数据库权限、TLS、清理、告警、备份和回滚均有可执行文档。
9. 安全响应头、Origin/cookie、URL、body limit、rate limit、secret scan 和生产依赖审计有自动或可重复证据。
10. 不 push、不部署；远端和真实 Provider 证据保持独立审批。

## 12. 回滚与风险控制

- 每个 S11 阶段单独提交，阶段间保持可构建、可测试。
- 纯文件移动必须先保留公共导出或在同一提交更新全部消费者，禁止跨提交留下断裂入口。
- 第一轮不修改 schema；如发现必须改表，停止当前阶段并建立独立 migration 设计。
- 如果提取导致测试只能依赖更多 mock 或暴露事务内部细节，视为边界选择错误，回退并重新设计。
- 如果真实输出问题无法从 Provider 事件证据解释，不上线正则补丁，保留 badcase 和稳定失败提示。
- 部署配置在本地和 disposable 环境验证后仍只达到 `DEPLOYED_UNOBSERVED` 前置条件；没有真实环境 smoke 不得声称上线可用。

## 13. 已冻结决策

- 采用模块化单体，不拆网络微服务。
- 运行拓扑为 Next.js 主服务 + PostgreSQL + 独立后台 Worker；Embedding 独立运行。
- PostgreSQL 继续作为持久状态、锁、Outbox 和 pgvector 的唯一真相源。
- 重构优先保护事务和安全边界，不追求最少行数。
- 工程准则必须同时有文档和自动化架构门禁。
- S11 不改变产品功能、不新增依赖、不部署、不 push。
