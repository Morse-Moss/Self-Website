# 管理员 OpenAI-Compatible 中转与模型管理实施计划

> 生命周期：Morse `STAGED / CRITICAL / LOCAL`
>
> 需求权威：`docs/superpowers/specs/2026-07-21-admin-api-management-design.md` 与
> `docs/portfolio-blueprint.md` §24。
>
> 当前工作区：`E:\Revolution\.worktrees\admin-api-management`，
> 分支 `codex/admin-api-management`，基线 `origin/master@75f621a`。

## 1. 目标与不可变边界

完成后，只有管理员能在 `/admin/api` 管理全站 Chat 的 OpenAI-compatible 中转和模型；
访客仍只使用管理员激活的一条主线路和最多五条备用线路。配置保存在 PostgreSQL，API Key
使用环境注入主密钥执行 AES-256-GCM 加密。激活后，新请求无需重启即读取新路由快照，
已开始的流保持原快照。

以下边界在四个 StagePacket 中均不可放宽：

- 只支持 `responses` 与 `chat_completions`，不改 Embedding、RAG、BGE、搜索 Provider。
- 保存配置不调用 Provider；模型发现和真实测试只能由管理员显式触发。
- 本计划与本地实现不授权真实或付费 Provider 调用。
- 不读取、输出、记录或截图真实 API Key、密文、Authorization 或 Provider 原始错误正文。
- 环境主节点和 `OPENAI_FALLBACK_1_*` / `OPENAI_FALLBACK_2_*` 保留为只读应急目标。
- 数据库已存在活动路由但损坏或无法解密时 fail closed，不静默回退环境线路。
- 整条 Chat 路由共享 90 秒截止时间；每个目标只有 20 秒首字节预算。
- 只在零正文时 failover；任一正文 delta 输出后禁止换模型拼接。
- 不安装新依赖。受控出站使用 Node 内置 DNS、HTTPS、TLS 和 Web Stream API。
- 不写生产数据库，不 push，不部署，不重启线上服务。

## 2. 已批准与未批准事项

- 已批准：创建本 worktree 和本地分支；按项目规则执行本地代码修改、自动测试和范围化本地提交。
- 已批准：设计中的数据库动态配置、环境主密钥、多备用线路和受约束删除语义。
- 未批准：真实 Provider 测试、模型发现或其他可能计费的外部调用。
- 未批准：依赖安装、生产 schema/data 变更、远端 push、PR、部署和线上重启。
- 本计划不需要新增依赖；若实现证明 Node 内置传输不足，停止对应 StagePacket 并重新申请依赖安装授权。

## 3. RuleDigest

`sources`：

- 用户提供的 `E:\Revolution\AGENTS.md` 指令，2026-07-21；
- `docs/superpowers/specs/2026-07-21-admin-api-management-design.md`；
- `docs/portfolio-blueprint.md` §24；
- `E:\Evolution\skills\morse-development-mode\SKILL.md` 及 StagePacket schema；
- 当前主线 `75f621a`，包含 `003_private_resume.sql` 和私密简历管理员工作台。

`workspace`：

- 分支 `codex/admin-api-management`；
- 设计提交 `aa95f70`、`a856ddf`；
- worktree 创建时无无关修改。

`refresh_when`：

- `origin/master` 再次变化且需要吸收；
- 需求权威文件、管理员鉴权、Provider 端口、interaction 终态事务或 migration runner 被其他任务修改；
- 任一 StagePacket 扩大 owned files。

## 4. 阶段依赖与回退下限

实施顺序固定为：

1. 数据库迁移、加密与兼容基线；
2. 请求级运行解析、Provider 路由和终态遥测；
3. 管理 API、受控出站策略复用、删除与审计清理；
4. `/admin/api` UI、集成验收和 closeout。

`004_admin_api_management.sql` 一旦应用，即成为数据库兼容下限。Stage 1 的提交 SHA
必须写入 VerificationReceipt；之后只能回退到该 SHA 或更晚提交，不能回退到只认识 003 的二进制，
也不执行破坏性 down migration。Stage 2 失败时恢复环境路由；Stage 3 或 Stage 4 失败时关闭新增入口，
但保留 004 schema 和 Stage 1 兼容代码。

每个 StagePacket 在 stage-exit 后都必须把 packet、VerificationReceipt、split-review verdict 和
exact staging allowlist 交给 `closeout`，再运行 `neat-freak` 到
`KNOWLEDGE_RECONCILED`；`checked-no-change` 是允许结果。下文的
`git add` / commit message 是 closeout 的精确提交合同，不是绕过 closeout 的第二套流程。

---

## StagePacket 1：数据库、加密与兼容基线

```yaml
stage: admin-api-management-1-storage-baseline
outcome: 004 migration、环境主密钥解析和版本化配置存储可用，Chat 仍只走现有环境路由
controls:
  execution: STAGED
  risk: CRITICAL
  delivery: LOCAL
state: CONTRACT
preset: null
scope:
  owned:
    - db/migrations/004_admin_api_management.sql
    - lib/server/ai-config.ts
    - lib/server/ai-config-crypto.ts
    - lib/server/ai-config-store.ts
    - lib/server/production-config.ts
    - lib/server/readiness.ts
    - .env.example
    - compose.production.yaml
    - deploy/postgres/verify-ai-config-runtime.sql
    - deploy/postgres/grant-runtime.sql
    - deploy/postgres/init/01-roles.sh
    - docs/runbooks/production.md
    - docs/runbooks/tencent-lighthouse.md
    - tests/ai-config.test.ts
    - tests/ai-config-crypto.test.ts
    - tests/ai-config-store-integration.test.ts
    - tests/schema.test.ts
    - tests/migration-integration.test.ts
    - tests/readiness.test.ts
    - tests/production-config.test.ts
    - tests/provider-deployment-contract.test.ts
  forbidden:
    - app/api/chat/route.ts
    - Provider 调用与管理员 UI
    - production database
    - dependency installation
  unrelated_or_unknown: []
dod:
  - 004 在空库和已有 001-003 数据库上原子应用且保留既有数据
  - API Key AES-256-GCM 使用随机 96-bit IV、16-byte tag、AAD 和主密钥版本
  - 配置版本不可变，生命周期字段单向，secret shred 后不能解密
  - 生产 Web 只接受文件型主密钥，其他生产角色不读取该密钥
  - readiness 精确识别 004，并证明单例 runtime state 和配置表可读
  - Chat 行为与环境 Provider 路由保持不变
approvals:
  - confirmed design and local implementation
  - no production migration authorization
verification:
  focused:
    - node --env-file-if-exists=.env.local --test tests/ai-config.test.ts tests/ai-config-crypto.test.ts tests/ai-config-store-integration.test.ts
    - node --env-file-if-exists=.env.local --test tests/schema.test.ts tests/migration-integration.test.ts tests/readiness.test.ts tests/production-config.test.ts tests/provider-deployment-contract.test.ts
  stage_exit:
    - node --env-file-if-exists=.env.local --test tests/config.test.ts tests/database-config.test.ts tests/openai-provider.test.ts tests/failover-provider.test.ts
  real_observation: []
review:
  shape: split
  correction_budget: 2
knowledge_impact:
  - .env.example
  - compose.production.yaml
  - docs/runbooks/production.md
  - docs/runbooks/tencent-lighthouse.md
non_goals:
  - runtime route switching
  - admin APIs
  - UI
```

### 1.1 先写失败测试

创建 `tests/ai-config-crypto.test.ts`，覆盖：

- 32-byte base64 主密钥正常往返；
- 同一明文两次加密得到不同 IV 和密文；
- AAD 精确绑定 `connectionVersionId`、`seriesId`、`keyVersion`；
- 修改密文、IV、tag、AAD、主密钥或密钥版本均只返回稳定
  `AI_CONFIG_SECRET_UNAVAILABLE`，错误字符串不含秘密；
- 被 crypto-shred 的空 envelope 不可解密。

创建 `tests/ai-config.test.ts`，覆盖：

- development/test 可从 `MORSE_PROVIDER_CONFIG_KEY` 读取 canonical base64；
- production 只接受 `MORSE_PROVIDER_CONFIG_KEY_FILE`；
- direct 与 file 同时存在、非 32-byte、非 canonical base64、无效版本均失败；
- canonical runtime digest 对属性顺序稳定，任一 Key、Base URL、模型、协议、reasoning effort、
  User-Agent 或输出限制变化都会改变；显示名和价格变化不改变 runtime digest，也不强制重测；
- digest 使用 HMAC-SHA256，不把 Key 或 Base URL 直接包含在返回值中。

创建 `tests/ai-config-store-integration.test.ts`，使用
`tests/postgres-test-utils.ts` 的 disposable PostgreSQL，覆盖：

- 创建 connection + 首个 model 的不可变 version 1；
- connection 新版本在一个事务中克隆所有未删除模型版本；
- model 新版本保持 series ID 并递增 version；
- old version 不被原地覆盖；
- list/read API 永不返回密文、IV、tag；
- model tombstone 不销毁共享 connection secret；
- connection crypto-shred 清空三段密钥材料并阻止运行解析；
- 并发版本写入以唯一约束或行锁失败，不产生半版本。

先运行上述三个文件，确认因模块/迁移缺失而 RED。

### 1.2 新增 004 schema

创建 `db/migrations/004_admin_api_management.sql`。只做 additive migration，
不修改 001-003 正文。必须创建并约束：

- `ai_connections`：`id`、`series_id`、`version`、
  `previous_version_id`、`display_name`、规范化 `base_url`、
  可空 `user_agent`、`api_key_ciphertext`、`api_key_iv`、
  `api_key_tag`、`key_version`、`config_digest`、
  `created_at`、`archived_at`、`deleted_at`、
  `secret_destroyed_at`。唯一键为 `(series_id, version)`；secret 三字段必须
  同时存在或同时为空；为空时 `secret_destroyed_at` 必须非空。
- `ai_model_presets`：version/series/previous、`connection_version_id`、
  display name、真实 `model_id`、协议、可空 reasoning effort、max output tokens、
  可空 input/output USD-per-million、config digest 和单向生命周期字段。
- `ai_route_revisions`：不可变 route ID、递增 `revision_number`、
  previous active ID、activation kind、created/activated time、actor session ID。
- `ai_route_targets`：route ID、连续 `position 0..5`、source type、
  database model version 或 environment target key 二选一，以及激活时安全显示快照、
  protocol、model ID、config digest 和价格快照。唯一键为 route + position。
- deferred constraint trigger：提交时每个仍存在的 route revision 必须恰有 1..6 个 target，
  position 必须等于 `0..count-1`，不能重复同一运行摘要。
- `ai_runtime_state`：只允许 `id=true` 的单例行，active route 可空，
  `lock_version` 从 0 开始；migration 插入唯一初始行。
- `ai_config_events`：显式 event type、actor session、可空 connection/model/route 引用、
  environment target key、config digest、稳定 result code、status、latency、usage、item count、
  created/delete-after。entity series/version IDs 是删除后仍保留的安全快照，不以级联外键抹除；
  禁止存任意 Provider payload；delete-after 固定为 created-at + 180 天。
- `interaction_provider_attempts`：turn ID、`attempt_index`、route/version/position、
  source、连接/模型版本、显示快照、protocol、config digest、终态、稳定错误码、首字节/总延迟、
  可空 usage、可空 known cost、cost completeness、created/completed/delete-after。
  唯一键 `(interaction_turn_id, attempt_index)`，turn 删除时 cascade。
- 对 `interaction_turns` additive 增加 route revision、target position、protocol、
  config digest、known cost、usage completeness、cost completeness。
- 对 `usage_events` additive 增加可空 interaction turn、attempt index、cost completeness；
  将 `estimated_cost_usd` 改为 nullable，避免缺价时写假零。

为 runtime state、series/version、active route、config event retention、attempt retention 和历史引用
建立明确索引。所有名称、URL、model ID、User-Agent、reasoning effort、协议、token 和价格字段都加
长度、枚举或数值 CHECK。

### 1.3 实现密钥配置、加密和存储

创建 `lib/server/ai-config.ts`：

- 定义 `AiConfigError` 和设计 §16 的稳定错误码；
- 定义连接、模型、路由、目标、测试摘要和 attempt 的内部类型；
- 实现严格 env key loader，规则与 `resume-config.ts` 一致，但变量名为
  `MORSE_PROVIDER_CONFIG_KEY`、`MORSE_PROVIDER_CONFIG_KEY_FILE`、
  `MORSE_PROVIDER_CONFIG_KEY_VERSION`；
- 实现 canonical JSON + HMAC-SHA256 config digest；
- 只导出脱敏 DTO 转换函数，密钥 envelope 不进入 API DTO。

创建 `lib/server/ai-config-crypto.ts`：

- 使用 `aes-256-gcm`、12-byte random IV、16-byte auth tag；
- AAD 是版本化 canonical bytes；
- catch 时只抛稳定错误，不保留底层 crypto message；
- 将 ciphertext、IV、tag 分列返回，便于受约束 crypto-shred。

创建 `lib/server/ai-config-store.ts`：

- 所有版本创建接收 `PoolClient`，由调用者拥有事务；
- 实现 catalog list、current version resolution、connection+first-model insert、
  connection version + model clone、model version insert、active route raw read、
  secret shred 和 event insert；
- connection 新版本沿用旧 Key 时先解密，再按新 version ID/AAD 重新加密，绝不复制旧 envelope；
- SQL 只使用参数绑定；
- 对外读取方法返回加密 envelope 只给运行解析器，管理 DTO 方法永不返回 envelope。

### 1.4 配置、readiness 与生产密钥分发

- 修改 `lib/server/production-config.ts`：production web 必须验证 file key 与 key version；
  worker/migration/ingest 不读取该密钥。
- 修改 `lib/server/readiness.ts`：除精确 migration manifest 外，验证
  `ai_runtime_state` 单例存在；Stage 1 不解析或激活数据库路由。
- 更新 `.env.example`，新增空 secret/value 和 key version，不放示例真实 key。
- 更新 `compose.production.yaml`：只向 web mount
  `/run/secrets/provider_config_key`；worker 不需要解密密钥。
- 更新两份 production runbook：生成/权限化 secret、先注入密钥再执行 004、运行 privilege gate，
  并记录 004 后只能回退到 Stage 1 compatibility floor。
- 新增 `deploy/postgres/verify-ai-config-runtime.sql`，逐表验证 runtime 的
  SELECT/INSERT/UPDATE/DELETE 和 sequence 权限。
- 创建 `tests/provider-deployment-contract.test.ts`，证明 secret 只分发给 web、
  runtime 权限门覆盖 004 表、其他服务不可见 secret；production preflight 还必须拒绝
  `MORSE_PROVIDER_MOCK_ORIGIN` 或任何 local mock override。

### 1.5 Stage 1 验证、双审与提交

按 StagePacket 顺序运行 focused 和 stage-exit 命令。然后进行两路只读审查：

1. 合规审查：逐项核对 schema、不可变版本、crypto-shred、环境密钥和 migration floor；
2. 质量/安全审查：重点检查 AAD、secret exposure、事务、索引、权限和 readiness 回退。

修复 admitted finding 后只重跑受影响 focused tests，再跑 Stage 1 stage-exit。提交：

```powershell
git add -- db/migrations/004_admin_api_management.sql lib/server/ai-config.ts lib/server/ai-config-crypto.ts lib/server/ai-config-store.ts lib/server/production-config.ts lib/server/readiness.ts .env.example compose.production.yaml deploy/postgres/verify-ai-config-runtime.sql docs/runbooks/production.md docs/runbooks/tencent-lighthouse.md tests/ai-config.test.ts tests/ai-config-crypto.test.ts tests/ai-config-store-integration.test.ts tests/schema.test.ts tests/migration-integration.test.ts tests/readiness.test.ts tests/production-config.test.ts tests/provider-deployment-contract.test.ts
git commit -m "feat: persist encrypted AI provider configuration"
git rev-parse HEAD
```

把最后一条命令输出记录为 004 migration 的应用回退下限。

---

## StagePacket 2：运行解析、路由与终态遥测

```yaml
stage: admin-api-management-2-runtime-routing
outcome: 每个新 Chat 请求快照化解析 1..6 个目标，安全 failover，并把每次尝试与终态幂等持久化
controls:
  execution: STAGED
  risk: CRITICAL
  delivery: LOCAL
state: CONTRACT
preset: null
scope:
  owned:
    - lib/server/ai-provider.ts
    - lib/server/openai-provider.ts
    - lib/server/failover-ai-provider.ts
    - lib/server/provider.ts
    - lib/server/provider-outbound.ts
    - lib/server/provider-runtime.ts
    - lib/server/chat-service.ts
    - lib/server/interaction-log.ts
    - lib/server/readiness.ts
    - app/api/chat/route.ts
    - scripts/mock-openai.mjs
    - tests/provider-outbound.test.ts
    - tests/provider-runtime.test.ts
    - tests/openai-provider.test.ts
    - tests/failover-provider.test.ts
    - tests/chat-route-stream.test.ts
    - tests/chat-service-integration.test.ts
    - tests/readiness.test.ts
    - tests/rag-integration.test.ts
  forbidden:
    - admin write APIs
    - admin UI
    - embedding route changes
    - real Provider calls
  unrelated_or_unknown: []
dod:
  - 无数据库 active route 时保持现有环境主备行为
  - 有 active route 时一次读取并固定完整请求快照
  - active route 损坏或解密失败返回稳定 503 且不降级
  - 全路由共享 90 秒，单目标首字节 20 秒，正文后绝不 failover
  - winner、失败尝试、usage、价格完整性在 completed/failed/stopped 终态同事务幂等保存
  - Embedding 与 RAG 不读取数据库 Chat route
approvals:
  - local mock Provider only
  - no real observation authorization
verification:
  focused:
    - node --env-file-if-exists=.env.local --test tests/provider-outbound.test.ts tests/provider-runtime.test.ts tests/openai-provider.test.ts tests/failover-provider.test.ts
    - node --env-file-if-exists=.env.local --test tests/chat-route-stream.test.ts tests/chat-service-integration.test.ts
  stage_exit:
    - node --env-file-if-exists=.env.local --test tests/rag-integration.test.ts tests/readiness.test.ts tests/config.test.ts
  real_observation:
    - local injected OpenAI mock only
review:
  shape: split
  correction_budget: 2
knowledge_impact: []
non_goals:
  - config mutation
  - paid connection test
  - UI
```

### 2.1 先冻结 Provider 端口合同

先扩展测试，再改实现：

- `tests/failover-provider.test.ts`：1..6 目标顺序、失败 attempt、winner metadata、usage、
  价格快照、全局 90 秒不乘节点数、每节点 20 秒首字节、取消/停止不继续、正文后错误不切换。
- `tests/openai-provider.test.ts`：Responses 和 Chat Completions 均只执行一次网络 attempt；
  移除同节点隐藏重试，避免一次 target 被错误记为一次但实际计费多次。
- `tests/chat-service-integration.test.ts`：completed、failed、stopped、commit-without-ack 重放、
  compensation retry 均只产生唯一 `(turn_id, attempt_index)`；winner 写入
  `interaction_turns.provider/model/route/position/protocol`，失败线路 usage 不套 winner 价格。

修改 `lib/server/ai-provider.ts`：

- 增加安全 `ProviderTargetSnapshot`、`ProviderAttempt`、
  `ProviderWinner`；
- `AnswerEvent` 增加 `attempt` 事件，`done` 带 winner 与聚合完整性；
- 新增只含稳定 code 和 attempt snapshots 的 `ProviderRunError`，不保留原始 payload；
- Embedding 方法签名保持不变。

`FailoverAiProvider` 必须在每个失败、成功、超时或停止目标结束时形成 attempt；
成功时先发 attempt 再发 done；失败抛出的 `ProviderRunError` 带已完成 attempts。
Chat service 同时消费 attempt event 和 error snapshots，保证任何终态都可持久化。

### 2.2 实现统一受控出站

创建 `lib/server/provider-outbound.ts`，只使用 Node 内置模块：

- `validateProviderBaseUrl`：只接受 HTTPS、无 userinfo/query/fragment，规范化 path；
- `resolvePublicProviderAddresses`：`dns.promises.lookup(..., {all:true, verbatim:true})`，
  校验全部 A/AAAA 和 IPv4-mapped IPv6；任一私有、保留、loopback、link-local、multicast、
  unspecified、benchmark 或 metadata 地址即整体拒绝；
- `createPinnedProviderFetch`：每个请求重新解析，选择已验证地址，通过
  `https.request` 的 injected `lookup` 固定实际连接 IP，同时保留原 hostname
  作为 Host 和 TLS `servername`；默认 TLS certificate/hostname verification 不关闭；
- 3xx 一律转成稳定错误，绝不自动 follow；
- 将 Node response 以 `Readable.toWeb` 包装为标准 `Response`，支持 SDK 流式解析；
- request abort 必须销毁 socket；日志和异常不含 Authorization、body、完整 URL 或 DNS 原始异常；
- 测试依赖通过函数参数注入 resolver/request transport，不提供生产 loopback 白名单；
- 仅当 `NODE_ENV !== 'production'`、`MORSE_LOCAL_RELEASE_SMOKE=true` 且
  `MORSE_PROVIDER_MOCK_ORIGIN` 是精确 loopback origin 时，构造显式 local-mock policy，
  允许该 origin 通过 `http.request`；production preflight 对任一 mock override fail closed。

创建 `tests/provider-outbound.test.ts`，覆盖公网 IPv4/IPv6、全地址集合含一个私网、
IPv4-mapped IPv6、metadata、CNAME 后结果、检查后 rebinding、固定连接地址、TLS SNI、
redirect、abort、长 URL 和 secret-safe error。所有测试使用假 resolver/transport，不联网。

### 2.3 请求级 runtime snapshot

创建 `lib/server/provider-runtime.ts`：

- `resolveProviderRuntime(pool, envConfig)` 在请求开始时只读取一次 runtime state 和 route；
- active route 为空时从环境主节点和两个完整 fallback pair 构造 1..3 个只读 snapshots；
- active route 非空时，严格加载所有 target、生命周期和密钥 envelope，解密后构造独立 client；
- route target 的 config digest、显示名、模型、协议、价格和 position 全部冻结在返回对象；
- active route 缺目标、不连续、digest 不符、deleted、secret destroyed 或 decrypt 失败时抛
  `AI_CONFIG_UNAVAILABLE`，不回退环境；
- 环境和数据库 Chat client 均注入 `createPinnedProviderFetch`；
- Embedding client 仍只从 `OPENAI_EMBEDDING_*` 构造，不进入 failover。

重构 `lib/server/provider.ts`：

- 拆出环境 Embedding provider；
- 所有 Chat targets 都由一个 router 持有同一个 generation semaphore 和 90 秒 deadline；
- `providerTotalTimeoutMs` 直接传给 router，删除当前
  `* answerProviders.length`；
- 每个 target 一次网络 attempt，first-byte timer 每次重建但受全局 signal 约束。

修改 `app/api/chat/route.ts`：

- 完成 runtime config、request、access session 校验后，调用一次 async resolver；
- resolver 失败在 SSE 建立前返回通用 `CHAT_NOT_CONFIGURED` / 503；
- 将返回的 provider snapshot 传入 `runChat`，之后不再读 active pointer；
- search 和 Embedding 配置保持原路径。

### 2.4 终态事务与成本归因

修改 `lib/server/interaction-log.ts`：

- 增加 `replaceProviderAttempts(client, turnId, attempts)`，先按 turn 锁定，再通过
  unique key 幂等 insert/upsert 完整 attempt 集；
- `restartInteraction` 清理旧 attempt 以及新增 aggregate 字段；
- `completeInteraction` / `terminateInteraction` 接收 winner 和 aggregates，
  不再接收静态 config provider/model。

修改 `lib/server/chat-service.ts`：

- 从 AnswerEvent 累积 attempts/winner；
- `completeTurn`、`compensateTurnOnce` 在现有终态事务内先/同时写 attempts，
  再更新 interaction；
- usage token 只汇总 Provider 实际返回值；任一 attempt 缺 usage 时
  `usage_complete=false`；
- 每个有 usage 的 attempt 写一条 `usage_events`；缺价格时 cost 为 null 且
  `cost_complete=false`；
- interaction 的 `known_cost_usd` 是可计价小计，只有全部 attempts 可计价时才把
  `estimated_cost_usd` 设为完整总价；
- commit-without-ack 判定同时比较 answer 和 attempt 集，重放不重复 usage/attempt；
- 日志仍只输出稳定 error code。

更新 `scripts/mock-openai.mjs`，补齐 `/v1/models`、Responses、
Chat Completions、认证失败、首字节延迟、无输出、流中断、usage 缺失和 usage 返回；
默认只监听 loopback。

### 2.5 Stage 2 验证、双审与提交

合规审查检查快照、fail-closed、超时和 §13/§14；质量/安全审查检查 socket pinning、TLS、
abort、stream 状态机、事务幂等和 cost completeness。通过后提交：

```powershell
git add -- lib/server/ai-provider.ts lib/server/openai-provider.ts lib/server/failover-ai-provider.ts lib/server/provider.ts lib/server/provider-outbound.ts lib/server/provider-runtime.ts lib/server/chat-service.ts lib/server/interaction-log.ts lib/server/readiness.ts app/api/chat/route.ts scripts/mock-openai.mjs tests/provider-outbound.test.ts tests/provider-runtime.test.ts tests/openai-provider.test.ts tests/failover-provider.test.ts tests/chat-route-stream.test.ts tests/chat-service-integration.test.ts tests/readiness.test.ts tests/rag-integration.test.ts
git commit -m "feat: route chat through dynamic provider snapshots"
```

---

## StagePacket 3：管理 API、安全、测试与删除

```yaml
stage: admin-api-management-3-admin-api
outcome: 管理员可通过受控 API 版本化配置、显式发现/测试、原子激活/回退并安全删除
controls:
  execution: STAGED
  risk: CRITICAL
  delivery: LOCAL
state: CONTRACT
preset: null
scope:
  owned:
    - lib/server/admin-provider-config.ts
    - lib/server/provider-config-input.ts
    - app/api/admin/_shared.ts
    - app/api/admin/providers/**
    - scripts/cleanup-expired.mjs
    - tests/provider-config-input.test.ts
    - tests/admin-provider-integration.test.ts
    - tests/admin-provider-api-contract.test.ts
    - tests/operations-scripts.test.ts
    - tests/worker.test.ts
  forbidden:
    - visitor-facing model selection
    - arbitrary headers or arbitrary HTTP methods
    - implicit Provider calls on save
    - real Provider credentials or calls
    - UI
  unrelated_or_unknown: []
dod:
  - 所有响应 no-store，所有 mutation/外部操作校验 Session 和精确 Origin
  - Key、Base URL/origin、discover、test、activate、rollback、archive、delete 强制密码复验
  - 旧 Key 跨 origin 复用必须独立显式确认
  - 测试/发现使用同一受控出站，单管理员并发 1、每分钟最多 3 次
  - 新增/变化目标只有 30 分钟成功测试才可激活
  - 激活以 expectedActiveRevision 乐观锁原子提交完整 1..6 路由
  - model tombstone 与 connection crypto-shred 严格分离
  - ai_config_events 满 180 天由 Worker 幂等清理
approvals:
  - local fake or loopback mock only
  - no paid test authorization
verification:
  focused:
    - node --env-file-if-exists=.env.local --test tests/provider-config-input.test.ts tests/admin-provider-integration.test.ts tests/admin-provider-api-contract.test.ts
    - node --env-file-if-exists=.env.local --test tests/operations-scripts.test.ts tests/worker.test.ts
  stage_exit:
    - node --env-file-if-exists=.env.local --test tests/admin-auth.test.ts tests/admin-api-contract.test.ts tests/failover-provider.test.ts tests/provider-outbound.test.ts
  real_observation:
    - injected fake transport or explicit local mock only
review:
  shape: split
  correction_budget: 2
knowledge_impact: []
non_goals:
  - UI
  - automatic health polling
  - production activation
```

### 3.1 输入合同与领域服务

创建 `lib/server/provider-config-input.ts`：

- UUID、名称、Base URL、model ID、User-Agent、协议、reasoning effort、token、价格、
  pagination、route targets 和 confirmation 字段使用 allowlist parser；
- 名称 1..80、model ID 1..200、Base URL 2048、User-Agent 256；
- max output tokens 1..100000；价格为 0..100000 的 decimal，每百万 token；
- 禁止任意 headers、HTTP method、path override、query 和 redirect option；
- body 出现未知字段直接 `AI_CONFIG_INVALID`，避免 silent typo。

创建 `lib/server/admin-provider-config.ts`，实现：

- runtime summary、catalog/version list、event pagination；
- create connection + first model；
- connection new version + model clone；
- create/update/archive model；
- discover models；
- test database model 和只读 environment target；
- activate/rollback route；
- delete model series 与 delete connection series。

所有 DTO 只返回 `hasApiKey`，不返回 Key 尾号、envelope 或完整 internal error。

### 3.2 管理 API 路由

创建以下 route files，全部 `runtime='nodejs'` 且响应
`Cache-Control: no-store`：

- `app/api/admin/providers/runtime/route.ts`；
- `app/api/admin/providers/route.ts`；
- `app/api/admin/providers/[connectionId]/route.ts`；
- `app/api/admin/providers/[connectionId]/models/route.ts`；
- `app/api/admin/providers/[connectionId]/discover/route.ts`；
- `app/api/admin/providers/models/[modelId]/route.ts`；
- `app/api/admin/providers/models/[modelId]/test/route.ts`；
- `app/api/admin/providers/runtime/environment/[targetKey]/test/route.ts`；
- `app/api/admin/providers/routes/activate/route.ts`；
- `app/api/admin/providers/events/route.ts`。

请求合同固定为：

- create connection：`{name,baseUrl,userAgent?,apiKey,firstModel,password}`；
- patch connection：`{name,baseUrl,userAgent?,apiKey?,reuseKeyAcrossOrigin,password}`；
- create/patch model：显示名、model ID、协议、reasoning、max tokens、两项可空价格；
- discover/test：`{password}`，不接受 prompt；
- activate：`{expectedActiveRevision,password,targets:[{source,modelId|environmentTargetKey}]}`；
- delete：`{password,confirmationName}`；
- list/events：只接受显式 page/limit/includeDeleted。

在 `app/api/admin/_shared.ts` 增加统一 stable JSON error、strict Origin mutation guard
和 password reauth helper。GET 只要求有效 Session；所有 mutation 要求 Session + Origin；设计列出的
高风险操作再要求 password。错误映射严格使用设计 §16。

### 3.3 显式发现和测试门

- 保存时执行 URL syntax + DNS 地址校验，但不发送 Provider HTTP 请求；
- discover 只调用规范化 Base URL 下的 `/models`，只返回去重、排序、限量后的 model IDs；
- test 使用固定极短 prompt，max output tokens 取安全最小值，不读访客、历史、RAG、Embedding 或搜索；
- test 走所选 `responses` / `chat_completions` 流，必须得到非空正文和完成事件；
- 只存 status、稳定 code、latency、usage、config digest 和时间，不存输出正文；
- 使用 PostgreSQL session advisory lock 保证每个 admin session 同时最多一个 discover/test；
- 锁内统计过去 60 秒 config events，合计达到 3 次返回
  `AI_CONFIG_RATE_LIMITED`；
- 任何 Key/Base URL/model/protocol/reasoning/User-Agent/max tokens 变化都改变 digest，使旧测试失效；
- 激活只接受 30 分钟内相同 digest 的成功测试；
- environment target 首次迁移可继承当前 active 状态，之后移除再加入必须通过新增环境 test endpoint。

自动测试只注入 fake/pinned transport。不得在测试命令中放真实 URL 或凭据。

### 3.4 原子激活、回退和删除

激活事务顺序固定：

1. Session、Origin、password 已在 route 层完成；
2. `SELECT ... FOR UPDATE` 锁 singleton runtime state；
3. 比较 `expectedActiveRevision`，不匹配返回 409；
4. 解析 1..6 targets，验证 position、去重、生命周期、secret、digest 和 test window；
5. 插入 route revision 与完整 targets；
6. 更新 active pointer 和 lock version；
7. 写安全 audit event；
8. commit 后返回脱敏 runtime summary。

回退创建新 revision，引用仍可运行的旧 snapshots；前一 active revision 30 分钟内免重测，
超过窗口按新目标测试规则执行。

删除规则：

- active route 引用 model/connection 任一版本时返回 `AI_CONFIG_IN_USE`；
- model series 从未被 route 或 attempt 引用时物理删除该 series，不碰 connection secret；
- model series 有历史引用时只 tombstone 该 model series 的所有版本，共享 connection 仍可供其他模型运行；
- connection series 从未引用时物理删除 connection 及其全部未使用 models；
- connection 有历史引用时 crypto-shred 该 series 所有 secrets，并 tombstone 其 models；
- environment target 的 delete/archive/patch 一律 `AI_CONFIG_INVALID`。

### 3.5 审计清理

修改 `scripts/cleanup-expired.mjs`：

- 在同一 retention advisory-lock transaction 中按
  `delete_after <= injected now` 删除 `ai_config_events`；
- 将 `deletedAiConfigEvents` 放入稳定 summary；
- 不删除 connection/model/route history 或 attempts；attempts 随 interaction turn cascade；
- 清理失败 rollback，Worker 下一轮重试，不影响 Web Chat。

扩展 `tests/operations-scripts.test.ts` 与 `tests/worker.test.ts`，证明 180 天边界、
锁竞争、rollback 和 Worker backoff。

### 3.6 Stage 3 验证、双审与提交

合规审查对照全部端点、30 分钟 test gate、删除矩阵和错误码；安全审查重点攻击 stolen admin
session、跨 origin Key、DNS rebinding、rate-limit race、secret/log leakage 和激活事务。
通过后提交：

```powershell
git add -- lib/server/admin-provider-config.ts lib/server/provider-config-input.ts app/api/admin/_shared.ts app/api/admin/providers scripts/cleanup-expired.mjs tests/provider-config-input.test.ts tests/admin-provider-integration.test.ts tests/admin-provider-api-contract.test.ts tests/operations-scripts.test.ts tests/worker.test.ts
git commit -m "feat: add secure admin provider APIs"
```

---

## StagePacket 4：后台 UI、集成验收与 closeout

```yaml
stage: admin-api-management-4-workbench
outcome: /admin/api 在桌面和移动端完整管理配置与路由，并通过全量本地回归和视觉验收
controls:
  execution: STAGED
  risk: CRITICAL
  delivery: LOCAL
state: CONTRACT
preset: null
scope:
  owned:
    - app/admin/layout.tsx
    - app/admin/page.tsx
    - app/admin/api/page.tsx
    - components/admin/AdminShell.tsx
    - components/admin/AdminShell.module.css
    - components/admin/AdminConsole.tsx
    - components/admin/AdminConsole.module.css
    - components/admin/AdminApiConsole.tsx
    - components/admin/AdminApiConsole.module.css
    - components/admin/AdminProviderLibrary.tsx
    - components/admin/AdminRouteEditor.tsx
    - components/admin/AdminProviderForm.tsx
    - components/admin/AdminReauthDialog.tsx
    - components/admin/admin-api-client.ts
    - components/admin/admin-client.ts
    - package.json
    - scripts/admin-api-visual-smoke.mjs
    - tests/admin-api-management-ui-contract.test.ts
    - tests/admin-api-visual-smoke-contract.test.ts
    - tests/s10-admin-ui-contract.test.ts
    - tests/resume-admin-ui-contract.test.ts
    - tests/site-shell-contract.test.ts
    - tests/routes-contract.test.ts
    - docs/verify/admin-api/**
    - docs/portfolio-blueprint.md
    - docs/superpowers/specs/2026-07-21-admin-api-management-design.md
  forbidden:
    - public navigation link to /admin
    - real Provider calls
    - raw colors outside app/styles/tokens.css
    - dependency installation
    - deployment or Lighthouse claim
  unrelated_or_unknown: []
dod:
  - /admin 保持对话复盘，/admin/api 提供 API 配置，共享登录/session/nav/logout
  - 桌面为列表+inspector，移动端详情/编辑/路由为全屏层
  - 一主五备、拖动与无障碍移动控制、冲突 diff、test gate、危险删除均可操作
  - loading/empty/error/permission/conflict/long URL/long model/six targets 均不溢出
  - 1440x900 与 390x844 截图、控制台零错误、意外外部请求为零
  - 完整 npm test、npm run build、本地 dev smoke 通过
approvals:
  - local mock UI acceptance only
  - Lighthouse deferred until deployment authorization
verification:
  focused:
    - node --env-file-if-exists=.env.local --test tests/admin-api-management-ui-contract.test.ts tests/admin-api-visual-smoke-contract.test.ts tests/s10-admin-ui-contract.test.ts tests/resume-admin-ui-contract.test.ts tests/site-shell-contract.test.ts tests/routes-contract.test.ts
  stage_exit:
    - npm test
    - npm run build
    - npm run visual:admin-api
  real_observation:
    - local browser at 1440x900 and 390x844 against disposable database and loopback mock
review:
  shape: split
  correction_budget: 2
knowledge_impact:
  - docs/portfolio-blueprint.md
  - docs/verify/admin-api/
non_goals:
  - public model picker
  - production activation
  - deployment
  - Lighthouse completion
```

### 4.1 提取共享管理员外壳

当前 `AdminConsole.tsx` 自己拥有登录/session/logout。创建
`components/admin/AdminShell.tsx` 并在 `app/admin/layout.tsx` 包裹 children：

- Shell 负责 session check、login、logout、expiry、unauthorized reset；
- 顶部使用两个导航 tab：`/admin` “对话复盘”和 `/admin/api` “API 配置”；
- public header 不出现后台链接，robots 继续 noindex/nofollow；
- 通过小型 context 向两个页面提供 `requireLogin` 和 session expiry；
- `AdminConsole` 只保留对话列表、详情、邀请、简历和导出状态；
- 私密简历现有隔离、modal 和 contract tests 不回退。

新增 `app/admin/api/page.tsx`，只渲染 `AdminApiConsole`。

### 4.2 API 配置工作台

创建：

- `admin-api-client.ts`：DTO、strict fetch wrappers、stable error copy、query builder；
- `AdminApiConsole.tsx`：runtime summary、catalog load、选中状态、mobile layer、全局 notice；
- `AdminProviderLibrary.tsx`：连接列表、deleted filter、版本/模型 inspector、test status；
- `AdminRouteEditor.tsx`：一主五备草稿、drag-and-drop、上移/下移/移除、diff、409 refresh；
- `AdminProviderForm.tsx`：两步 create、connection/model edit、Key 显隐但不回填；
- `AdminReauthDialog.tsx`：discover/test/activate/archive/delete 的密码复验和付费提示；
- `AdminApiConsole.module.css`：只用 `app/styles/tokens.css` token。

桌面首屏直接显示 active provider/model、route revision、fallback 数、最近激活和每目标 test 状态；
下方是不嵌套卡片的紧凑 list + inspector。390px 先显示列表；详情、表单、route editor 均为
fixed full-screen layer，提供明确返回按钮。

控件约束：

- route position 使用稳定 grid tracks，六条线路不因状态文字改变尺寸；
- drag 不是唯一操作；提供 `↑`、`↓`、`×` 熟悉符号按钮，
  每个有 `aria-label` 和 `title`；
- protocol 用 segmented control，binary 状态用 checkbox/toggle，价格/token 用 number input；
- Key 保存后永不回填，`hasApiKey` 只显示状态；
- test 按钮和确认层明确“可能产生极少 API 费用”，但自动视觉验收不点击真实目标；
- delete 显示物理删除、model tombstone 或 connection crypto-shred 的实际结果；
- 所有 interactive target 至少 44px；长 URL/model ID 用 wrap/overflow-wrap，不横向撑破；
- 页面不展示教程、快捷键说明或设计说明。

### 4.3 UI 合同与本地视觉脚本

先创建失败的 `tests/admin-api-management-ui-contract.test.ts`：

- route 隔离与共享 Shell；
- runtime first-viewport signal；
- list/inspector 与 mobile full-screen；
- Key 不回填；
- test/activate/delete reauth；
- 一主五备和 accessible move controls；
- conflict/loading/empty/error/permission states；
- token-only colors、44px controls、reduced motion 和 long text wrapping。

更新现有 S10、resume、site-shell 和 route contract tests，反映 auth state 从 Console 移到 Shell，
但不删除原有断言覆盖。

创建 `scripts/admin-api-visual-smoke.mjs` 和 package script：

```json
"visual:admin-api": "node scripts/admin-api-visual-smoke.mjs"
```

脚本必须：

1. 使用 disposable PostgreSQL 并运行 001-004；
2. 生成随机测试主密钥和合成 admin 凭据；
3. 只启动 loopback `scripts/mock-openai.mjs`；
4. 以这些临时 env 自行启动 `next dev` 子进程并固定使用 3012；不得依赖调用者预先启动的 server；
5. 通过 local-release-smoke 专用注入让受控 transport 固定连接该 mock，生产 preflight 明确拒绝此模式；
6. 登录、创建中转/首模型、模拟 discover 失败后手填、执行 mock test、组成一主多备、激活；
7. 打开并关闭 route editor、409 conflict、delete 结果和错误状态；
8. 在 1440x900 与 390x844 保存：
   - `docs/verify/admin-api/admin-api-desktop-1440x900.png`；
   - `docs/verify/admin-api/admin-api-mobile-390x844.png`；
9. 断言 console error 为零，除 loopback app/mock 外请求为零；
10. finally 中停止 Next/mock 子进程并销毁 disposable database。

`tests/admin-api-visual-smoke-contract.test.ts` 静态验证脚本绝不读取真实
`.env.production`、不接受公网 Provider URL、证据在 cleanup 前生成。

### 4.4 全量验收、设计审查和文档状态

按顺序运行：

```powershell
node --env-file-if-exists=.env.local --test tests/admin-api-management-ui-contract.test.ts tests/admin-api-visual-smoke-contract.test.ts tests/s10-admin-ui-contract.test.ts tests/resume-admin-ui-contract.test.ts tests/site-shell-contract.test.ts tests/routes-contract.test.ts
npm test
npm run build
npm run visual:admin-api
```

视觉脚本负责启动 dev server；ready 后验证 `/api/health/live`、`/admin` 和
`/admin/api`，结束后停止所有子进程，不留后台服务。

质量审查使用 `morse-design` 检查现有深色后台一致性、信息密度、响应式、无障碍、
overlap 和 overflow；合规审查逐项核对设计 19 节、真实调用边界与所有 StagePacket receipts。

更新 `docs/portfolio-blueprint.md` §24：

- 只能写“本地已实现/已验证”的证据；
- 不写“已部署”“线上已切换”或“真实中转已测试”；
- Lighthouse 保持待部署验收。

提交 UI：

```powershell
git add -- app/admin/layout.tsx app/admin/page.tsx app/admin/api/page.tsx components/admin/AdminShell.tsx components/admin/AdminShell.module.css components/admin/AdminConsole.tsx components/admin/AdminConsole.module.css components/admin/AdminApiConsole.tsx components/admin/AdminApiConsole.module.css components/admin/AdminProviderLibrary.tsx components/admin/AdminRouteEditor.tsx components/admin/AdminProviderForm.tsx components/admin/AdminReauthDialog.tsx components/admin/admin-api-client.ts components/admin/admin-client.ts package.json scripts/admin-api-visual-smoke.mjs tests/admin-api-management-ui-contract.test.ts tests/admin-api-visual-smoke-contract.test.ts tests/s10-admin-ui-contract.test.ts tests/resume-admin-ui-contract.test.ts tests/site-shell-contract.test.ts tests/routes-contract.test.ts docs/verify/admin-api docs/portfolio-blueprint.md docs/superpowers/specs/2026-07-21-admin-api-management-design.md
git commit -m "feat: add admin API management workbench"
```

最后按 `closeout` 生成 VerificationReceipt，再由 `neat-freak` 执行
`KNOWLEDGE_RECONCILED`。仅本地提交；不 push、不部署。

---

## 5. 设计 19 节自审矩阵

| 设计节 | 实施归属 | 必须出现的证据 |
|---|---|---|
| 1. 背景 | 全局 | `/admin/api` 可切换，访客无 selector |
| 2. 目标/非目标 | 全局 | Chat-only；Embedding/RAG 回归通过 |
| 3. 产品规则 | 2/3/4 | 一主五备、显式测试、无重启快照 |
| 4. 架构 | 1/2 | DB active pointer；无 active 时环境路由 |
| 5. 运行快照 | 2 | 每请求单次 resolver；流中不重读 |
| 6. 数据模型 | 1 | 004 schema + integration tests |
| 7. 加密 | 1 | AES-GCM/AAD/tamper/secret shred |
| 8. 信息架构 | 4 | shared Shell、list+inspector、mobile layer |
| 9. 管理 API | 3 | 全端点 contract、no-store、Origin、reauth |
| 10. SSRF | 2/3 | 全 DNS、pinned IP、TLS SNI、no redirect |
| 11. 发现/测试 | 3 | fixed probe、rate limit、30-minute digest gate |
| 12. 激活/回退 | 3 | lock version、409、transaction、new revision rollback |
| 13. 路由/超时 | 2 | 90 秒共享、20 秒首字节、delta 后禁切换 |
| 14. 日志/成本 | 2 | attempt + winner 同终态事务、unknown 不为零 |
| 15. 删除 | 1/3 | physical/model tombstone/connection shred/in-use |
| 16. 错误合同 | 1/3/4 | stable server codes + actionable UI copy |
| 17. 迁移/兼容 | 1 | 004 additive、Stage 1 rollback floor |
| 18. 验收 | 1-4 | focused/full/build/dev/1440/390 receipts |
| 19. 实施边界 | 全局 | 无真实调用、生产写、依赖安装、push、部署 |

## 6. CRITICAL 挑战项关闭条件

- 单包过大：已拆四个 StagePacket，每阶段独立 owned scope、测试、审查、提交和回退。
- migration 回退：004 应用后只回退到 Stage 1 兼容提交，readiness 不允许旧 manifest。
- stolen admin session：Base URL/origin、discover、test、激活和删除均强制 password reauth；
  old Key 跨 origin 另需显式确认。
- DNS rebinding：每次出站重新解析全部地址，实际 socket pin 到验证 IP，TLS 校验原 hostname，
  禁止 redirect。
- attempt/winner 错归因：Provider 端口返回结构化 attempt/winner；completed/failed/stopped 和重放
  与 interaction 终态同事务幂等保存。
- model delete 误毁共享 Key：model tombstone 与 connection crypto-shred 是独立代码路径和测试。
- audit retention 漏项：`ai_config_events` 由现有 Worker cleanup transaction 在 180 天删除。

## 7. 最终完成判定

只有以下全部成立才能声明 `LOCAL_READY`：

- 四个 StagePacket 的 focused 与 stage-exit 命令全部 exit 0；
- 每阶段 split review 为 PASS，或所有 finding IDs 已经 delta review 关闭；
- `npm test` 和 `npm run build` 通过；
- 本地 dev 的 live/admin/admin-api 冒烟通过；
- 1440x900 和 390x844 新鲜截图经人工查看，无 overlap/overflow，控制台零错误；
- 自动验收只使用 disposable DB、随机测试密钥和 loopback mock；
- git diff 仅包含计划 owned scope，用户或并行任务文件未被吸收；
- closeout receipt 和 `KNOWLEDGE_RECONCILED` 完成；
- 最终报告明确：未真实测试中转、未写生产数据库、未 push、未部署、未完成 Lighthouse。
