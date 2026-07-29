# Revolution 生产运行手册

> 状态：平台无关运行合同。腾讯云实现已于 2026-07-18 达到 `PRODUCTION_OBSERVED / LIMITED_LAUNCH`；这不等于全部 `ONLINE_READY` 硬化完成，实例细节与证据见 `docs/runbooks/tencent-lighthouse.md` 和 `docs/verify/s11/production-closeout.md`。

## 1. 运行拓扑与边界

完整系统至少包含以下独立运行单元：

1. TLS edge 或受控反向代理。
2. 单副本 Next.js Web 进程。
3. 单实例 Worker 进程。
4. PostgreSQL 16 + pgvector。
5. 独立 BGE/Embedding 服务或经批准的远端 Embedding endpoint。
6. OpenAI-compatible Chat Provider；Bocha 和 Feishu 按开关启用。

`Dockerfile` 只构建 Node 应用镜像，不能代替 PostgreSQL、Embedding、TLS edge 或托管备份。仓库内 `compose.yaml` 使用 loopback、`trust`、超级用户和无 TLS，只允许本地开发，禁止复制到生产。

## 2. 显式角色

同一不可变镜像支持四个角色，migration 不随 Web 自动执行：

```powershell
npm run production:migrate
npm run production:ingest
npm run production:web
npm run production:worker
```

各角色均先执行 fail-closed 预检，失败时只输出稳定错误码，不打印环境变量值。

| 角色 | 必需边界 | 不需要的权限或配置 |
|---|---|---|
| Web | runtime DB、HTTPS public/admin origin、Admin 与 invite secrets、Chat/Embedding 配置、Provider 配置主密钥文件；启用私密简历时需要简历密文卷和加密 Secret | DDL、建库、Feishu webhook |
| Worker | runtime DB、显式 `MORSE_ALERTS_ENABLED`、简历密文卷；启用告警时需要 Feishu webhook | Chat/Embedding、Admin 凭据、简历加密密钥、DDL |
| Migration | migration DB 凭据与 TLS | Provider、Admin、Feishu |
| Ingest | ingest DB、Embedding 配置与 TLS | Chat、Admin、Feishu |

部署平台必须给 runtime、migration、ingest 和 backup 注入不同的数据库角色。腾讯云首个生产实例已完成独立凭据、PostgreSQL TLS、最小 grants 和内部网络隔离；其他平台仍必须独立验证，不能复用该结论。

## 3. 生产配置

- `NODE_ENV=production`。
- `MORSE_PUBLIC_ORIGIN` 与 `MORSE_ADMIN_ALLOWED_ORIGIN` 必须是同一个无凭据 HTTPS origin。
- `MORSE_DATABASE_SSL_MODE` 只能用 `require` 或 `verify-full`；优先 `verify-full` 并通过 Secret Store 注入 `MORSE_DATABASE_SSL_CA`。
- 数据库 URL 不携带 `sslmode`、证书或密钥 query，TLS 只由集中配置控制。
- 每个进程单独计算 `MORSE_DATABASE_POOL_MAX`。初始只运行一个 Web 和一个 Worker，容量必须小于数据库总连接上限并预留运维连接。
- `MORSE_ALLOW_TEST_EMBEDDINGS=true` 在生产直接拒绝。
- `MORSE_LOCAL_RELEASE_SMOKE=true` 只供 loopback production-build harness 使用，正式角色启动器直接拒绝。
- `MORSE_ALERTS_ENABLED` 必须显式为 `true` 或 `false`。关闭告警时 Worker 仍执行 retention cleanup。
- Chat 主节点使用 `OPENAI_API_KEY` / `OPENAI_BASE_URL`；最多两个备用节点分别使用完整的 `OPENAI_FALLBACK_1_*` 和 `OPENAI_FALLBACK_2_*` 成对配置。生产备用 URL 必须是无凭据 HTTPS URL，缺 key 或缺 URL 均 fail closed。
- 三个 Chat 节点共享 `OPENAI_CHAT_MODEL`、`OPENAI_CHAT_PROTOCOL`、`OPENAI_REASONING_EFFORT` 和兼容 User-Agent。切换顺序固定为主节点、备用 1、备用 2，只在尚未输出正文时发生；已有部分回答或访客停止后不再切换。每个节点仍受单节点总超时约束，整次切换共享“单节点总超时 × 节点数”的上限。Embedding 继续使用独立配置。
- 数据库 Provider 配置使用独立 32-byte 随机主密钥执行 AES-256-GCM 加密。生产只接受 `MORSE_PROVIDER_CONFIG_KEY_FILE` 和正整数 `MORSE_PROVIDER_CONFIG_KEY_VERSION`；直接值 `MORSE_PROVIDER_CONFIG_KEY`、mock origin 和私网 HTTP Provider override 均 fail closed。该 Secret 只挂载给 Web，Worker、Migration、Ingest 与 edge 不得读取。
- Chat v2 灰度变量均为服务端配置，不得增加 `NEXT_PUBLIC_` 前缀。生产预检按运行时解析规则验证布尔值、0-100 整数 canary 和规范 UUID 列表；备用节点缺 key 或缺 URL、未解析引用和尖括号占位值均 fail closed，预检不调用 Provider，也不回显 UUID、Provider URL 或 key。
- Controlled Context Packet 使用独立服务端开关 `MORSE_CHAT_CONTEXT_PACKET_ENABLED`、独立 `MORSE_CHAT_CONTEXT_CANARY_PERCENT`、UUID 白名单 `MORSE_CHAT_CONTEXT_CANARY_INVITE_IDS` 和大小写敏感的精确标签白名单 `MORSE_CHAT_CONTEXT_CANARY_INVITE_LABELS`，不得复用 Chat v2 灰度变量。UUID 与标签是并集；标签命中的当前 Session 即使其 invite 已满额也可继续使用，percent 仍可保持 `0`。Chat、JD、诊断、历史和本地证据没有应用层字符、条数或 token 预算；仅可依据目标模型的已知数值上下文窗口压缩最老的完整 turn 前缀。
- Context Packet HMAC 使用独立、解码后至少 32 bytes 的随机 Secret。生产只接受 Web 内的 `MORSE_CONTEXT_PACKET_DIGEST_KEY_FILE=/run/secrets/context_packet_digest_key` 和非敏感版本标识 `MORSE_CONTEXT_PACKET_DIGEST_KEY_ID`；不得使用直接值、复用 Provider/Admin/invite 密钥，Worker、Migration、Ingest 与 edge 均不得挂载该 Secret。
- 私密简历默认使用 `MORSE_RESUME_ENABLED=false`。生产首次发布必须保持关闭，完成 migration `003`、私有卷初始化、最小 grants、健康检查和回滚检查后，才可在单独授权下启用。
- 启用私密简历时，Web 还必须获得 `MORSE_RESUME_STORAGE_DIR`、`MORSE_RESUME_ENCRYPTION_KEY_FILE`、`MORSE_RESUME_KEY_VERSION`、`MORSE_RESUME_FINGERPRINT_SECRET`、`MORSE_RESUME_TRUSTED_PROXY_HOPS` 和独立 `MORSE_RESUME_COOKIE`。生产禁止使用直接值 `MORSE_RESUME_ENCRYPTION_KEY`；加密密钥只通过名为 `resume_encryption_key` 的部署 Secret 文件挂载给 Web。
- Worker 只挂载简历密文卷用于保留期清理，不读取加密密钥。聊天、Embedding、Search、Ingest、Migration 和 edge 均不得获得简历文件或密钥。
- 所有 key、密码、webhook、DB URL 和 CA 只从部署 Secret Store 或主机受限环境文件注入，不进入 Git、镜像层和日志。

完整变量名与本地默认值见 `.env.example`。示例值不是生产凭据，也不是生产安全配置。

## 4. 首次启动顺序

1. 创建受限网络内的 PostgreSQL/pgvector，并完成 TLS 与角色授权。升级现有实例时先生成并校验数据库备份。
2. 在 `MORSE_RESUME_ENABLED=false` 下初始化权限为 `0700` 的简历密文卷；不要上传 PDF。
3. 先生成并权限化 Provider 配置主密钥文件，再使用 migration 角色执行 `npm run production:migrate`，核对 migration `003`/`004` checksum，执行最小 grants，并以 `deploy/postgres/verify-ai-config-runtime.sql` 验证 runtime 权限。
4. 启动并验证生产 Embedding 服务。
5. 使用 ingest 角色执行 `npm run production:ingest`；重复执行应全量跳过。
6. 保持私密简历关闭，启动单副本 Web 和单实例 Worker，检查 `/api/health/live`、`/api/health/ready` 和公开页面。
7. 优先通过 `/admin` 创建新的聊天邀请码；管理页面不可用时使用 CLI 应急后备。完成一次受控文本对话 smoke。
8. 在真实 TLS edge 后执行 `MORSE_RELEASE_BASE_URL=https://... npm run release:smoke`。
9. 只有在前述步骤与回滚路径通过且获得单独授权后，才启用私密简历并重启 Web/Worker；先观察未上传 PDF 的锁定入口，再由管理员上传真实最终 PDF。

`/api/health/live` 不访问依赖。`/api/health/ready` 和兼容入口 `/api/health` 只有在运行配置有效、数据库可达、migration 版本与 checksum 完整、公开知识非空时返回 `200 {"ok":true}`；失败统一返回 `503 {"ok":false}`，不得泄漏模型、费用、表名、chunk 数或内部异常。

### 4.1 管理员入口与邀请码运维

- 管理入口固定为同源 `/admin`，不进入公开导航。隐藏入口不是安全措施；实际边界是独立密码、五次失败锁定、HttpOnly 管理 Session、精确 Origin 和服务端权限校验。
- 使用管理员密码登录后，点击顶部“邀请码”，填写名称、1-720 小时有效期和 1-100 个最大会话数。服务端生成带 `morse_` 前缀的 192-bit 随机码。
- 导出私有对话数据时必须再次输入管理员密码；复验与登录共享五次失败锁定，密码错误只拒绝本次导出，不注销仍有效的管理员 Session。
- 明文只在创建成功响应和当前页面内存中出现一次；数据库只保存 SHA-256。关闭工具后不能恢复，管理员必须当场复制，通过受控渠道发送，不得写入工单、日志、截图、仓库或运行手册。
- 列表只展示名称、有效/过期/耗尽/停用状态、有效期和会话用量。停用仅阻止新兑换；已登录 HR 的既有 Session 与后续聊天不受影响，需要立即中断时必须另走 Session 处置流程。
- `npm run invite:create` 仅作为管理页面不可用、首次初始化或灾备恢复时的后备路径；通过 `MORSE_NEW_INVITE_CODE` 注入人工选定码，脚本不回显明文。

| Route | 必需控制 | 用途 |
|---|---|---|
| `GET /api/admin/invites` | 有效管理员 Session | 返回邀请码元数据和派生状态，不返回明文 |
| `POST /api/admin/invites` | 管理员 Session + 精确 Origin | 生成邀请码；只在本次响应返回明文 |
| `PATCH /api/admin/invites/[inviteId]` | 管理员 Session + 精确 Origin | 仅允许将邀请码停用 |

### 4.2 Chat v2 disabled-first 灰度

以下步骤每次都先保留当前已观察镜像，记录变更后只重启 Web，并复验 live、ready、公开页面和 v1 会话。真实 Provider 评审、故障注入和扩大流量分别需要明确授权，不能因配置已写入手册而自动执行：

回答可靠性版本的默认时序为：`MORSE_PROVIDER_PROTOCOL_EVENT_TIMEOUT_MS=25000`、`MORSE_PROVIDER_MODEL_TEXT_TIMEOUT_MS=40000`、`MORSE_PROVIDER_STAGE_TIMEOUT_MS=80000`、`MORSE_CHAT_TURN_TIMEOUT_MS=90000`。启动时必须满足“协议事件 < 模型正文 <= Provider 阶段 < 完整 turn”；attempt 数不再由环境变量配置。normal 与仅由真实 Provider、协议或超时故障触发的串行 failover 共用同一个绝对 deadline；内容质量不得触发第二次调用、strict、reset 或节点切换。切换节点不得重置 80 秒预算，SSE heartbeat 不延长任何 deadline，hedging 保持关闭。

升级已有实例时，必须先独立验证 DB/Embedding healthy、PostgreSQL TLS 证书可解析且私钥为普通 `0600` 文件；migration、grants、ingest 和存储初始化使用 `docker compose run --rm --no-deps ...`。plain `compose run` 会协调 `depends_on`，配置或 bind 源漂移时可能重建依赖容器，不能用于升级路径。

1. 首次发布设置 `MORSE_CHAT_V2_ENABLED=true`、`MORSE_CHAT_V2_CANARY_PERCENT=0`、`MORSE_CHAT_V2_CANARY_INVITE_IDS` 留空、`MORSE_CHAT_HEDGED_FAILOVER_ENABLED=false`、`MORSE_CHAT_SAFE_MODE=false`，先证明没有 Session 进入 v2。
2. 部署新管理 UI 后创建专用聊天邀请码。一次性明文只保留在当前浏览器内；当场复制后台显示的非敏感灰度 UUID，不能用邀请码明文做白名单。
3. 把该实际 UUID 直接写入服务器 `.env.production` 的 `MORSE_CHAT_V2_CANARY_INVITE_IDS`，执行不回显值的 UUID 格式检查后只重启 Web；不得使用环境变量占位符、`$` 引用或尖括号占位值代替实际值。
4. 保持 hedging 关闭，完成已授权的固定 20 轮真实输出评审。清单固定为 6 轮自由对话、3 轮通用建议、3 轮身份/项目、3 轮通用技术与个人实现对照、3 轮个人能力证据、2 轮招聘/JD；岗位质量样本必须携带真实测试 JD，无 JD 样本只验证前置门。至少 18/20 通过，且私密信息泄露、虚构个人事实、无 JD 生成适配结论、自由对话错误调用 RAG 均为零容忍。评审只保存 case id、路由/依赖计数、attempt 状态与时延、脱敏评分，不保存 raw prompt、回答或 Provider payload。通过后再单独启用 hedging 做故障注入，不能把两类成本混在同一批调用中。
5. 白名单验证稳定后，依次设置 `MORSE_CHAT_V2_CANARY_PERCENT=25` 和 `MORSE_CHAT_V2_CANARY_PERCENT=100`，每次只重启 Web 并独立观察错误率、延迟、Provider 尝试数和回答质量。
6. 人格或证据异常时设置 `MORSE_CHAT_SAFE_MODE=true`，运行时 safe mode 优先于已开启的 hedging；成本异常时只设置 `MORSE_CHAT_HEDGED_FAILOVER_ENABLED=false`；隐私问题时设置 `MORSE_CHAT_ENABLED=false`。每次降级后只重启 Web 并复验，不改数据库。
7. `005` / `006` / `007` 均为 additive migration，不执行 down migration；`006` 只增加并回填非敏感邀请备注快照，`007` 只增加路由锚点、证据分类、attempt 模式与分段延迟字段。Readiness 要求数据库 registry 与镜像内 migration manifest 完全一致，因此 registry 已有 007 后只能切换到包含 007 的兼容镜像；不得回切 pre-007 镜像，不删除迁移或数据。

本节是未来发布合同，不改变“当前生产状态与硬化余项”中的历史事实；在部署 revision、运行配置和真实观察完成前，不得描述为 Chat v2 已上线。

### 4.3 Controlled Context Packet disabled-first 灰度

该灰度独立于 Chat v2。每次只变更 Context Packet 自身开关、百分比、UUID 白名单或精确标签白名单，并只重启 Web；Chat v2、Provider route、safe mode、hedging、RAG 和私密简历状态不得被顺带修改。

1. migration `012` 只做前向追加。registry 仍为 `001-011` 的首次部署，先在受控停写窗口停止 Web/Worker、确认无长事务并创建可校验备份，再用 `docker compose run --rm --no-deps migration` 和 grants 应用。registry 已为 `001-012` 且 release 不含新 migration 的 correction 只核对现有可读备份、manifest 与 grants，禁止为发布仪式重复停写、备份或 migration。任何路径都禁止 down migration、删除新表/列或伪造 registry。
2. 生成独立 32-byte Web-only HMAC Secret，owner/mode 按部署平台固定为应用 UID/GID `1001:1001` 与 `0600`；设置 key ID、`MORSE_CHAT_CONTEXT_PACKET_ENABLED=true`、`MORSE_CHAT_CONTEXT_CANARY_PERCENT=0`、空 UUID 白名单和空标签白名单后构建并只重建 Web/Worker。migration `013` 启用动态上下文时，不再配置 12k/24k 或其他应用层输入、历史、检索、attempt、输出固定上限。
3. 在 Context Packet 白名单为空且百分比为 `0` 时先验证 migration manifest、grants、live/ready、release smoke、容器身份、错误日志和无 Provider 的固定失败链。公开知识未变化时禁止为发布仪式重跑 ingest。
4. 创建一个专用测试邀请码，只把其非敏感 invite UUID 写入 `MORSE_CHAT_CONTEXT_CANARY_INVITE_IDS`，保持百分比始终为 `0`，只重启 Web。该 canary 必须逐轮重放 `tests/fixtures/controlled-context-failure-chain.ts` 中已脱敏的 5 条消息，不得合并、增补、改写或用其他问题替代；每轮来源按当次真实 BGE 分数与 direct-first 规则核验，不得假设固定 Top-3。最多发起 5 次真实 Provider 主回答，不得额外开启百分比流量。
5. 观察只保存 case ID、pipeline/semantic/task 状态、来源 ID、脱敏 manifest、attempt 数/状态/时延，以及同 turn 的 packet/request HMAC 一致性；不得保存邀请码明文、原始问答、Provider payload、Key、Base URL 或私密简历内容。
6. canary 结束后停用邀请码、清空 Context Packet 白名单并保持百分比 `0`，只重启 Web，再复验 live/ready/release smoke、容器 identity/restart count 和新 Web 启动后的错误日志。未经新的当前授权，不进入 10% 或更高灰度。

获得定向 HR 测试授权后，可以在 percent 仍为 `0` 时保留既有 UUID 白名单，并将 `MORSE_CHAT_CONTEXT_CANARY_INVITE_LABELS` 精确设置为 `HR interview`。运行时会把标签严格等于 `HR interview` 且 active、未过期、仍有 Session 容量的 invite，以及标签严格等于 `HR interview` 且拥有未过期 Session 的 invite 纳入同一准入并集；后者即使 invite 已满额也必须保留。标签匹配大小写敏感，不使用模糊匹配。变更必须使用环境文件 CAS、只重启 Web、比较变更前后的 UUID/标签配置，并且不得回显 UUID、邀请码明文或个人信息。定向启用本身不授权自动发送真实问题；真实问答由用户发起并单独观察。

migration `012` 应用后，回滚只先设置 `MORSE_CHAT_CONTEXT_PACKET_ENABLED=false`、清空白名单并只重启 Web；保留 migration、HMAC Secret 和数据。任何回滚镜像都必须识别 migration manifest `001-012`，禁止切回 pre-012 镜像。

### 4.4 Dynamic Provider Context migration 013

1. 先发布同一冻结提交的 013-aware Web/Worker，并在 schema `012`、`MORSE_DYNAMIC_PROVIDER_CONTEXT_ENABLED=false` 下证明 live、ready、release smoke 和无外呼双协议回放通过；失败时在迁移前恢复旧指针与镜像。
2. 停止 Web/Worker 写入、确认无长事务并创建非空可校验备份；migration `013` 连续执行两次，第二次必须为 no-op。随后重新执行 grants，确认 registry 为 `001-013`、Web/Worker 使用不同数据库角色并通过权限探针。
3. 删除旧能力变量前，先确认活动 Provider route 的每个 target 都已通过管理服务创建、真实测试并激活为 `config_digest_version = 2`；任何 V1 target 仍活动时必须保留其旧摘要所需变量并先完成 V2 迁移。门禁通过后设置 `MORSE_DYNAMIC_PROVIDER_CONTEXT_ENABLED=true`，删除 `MORSE_HISTORY_MESSAGE_LIMIT`、`MORSE_CHAT_CONTEXT_TOKEN_BUDGET`、`MORSE_JD_CONTEXT_TOKEN_BUDGET`、`MORSE_RETRIEVAL_LIMIT`、`MORSE_PROVIDER_MAX_ATTEMPTS` 和旧的固定 `MORSE_MAX_OUTPUT_TOKENS`；除非已核实目标模型能力，否则上下文窗口和输出能力字段保持未配置。
4. 只重建 Web/Worker，执行 Responses 与 Chat Completions 的 schema-013 无外呼回放，再进行已授权的真实 Provider HR 对话。观测只保存计数、状态、时延和脱敏类别，不保存原始问题、JD、回答、摘要、Provider payload、凭证或会话值。
5. migration `013` 后的回滚只能关闭动态上下文并使用已验证的 013-aware feature-off 镜像；禁止切回 pre-013 镜像、删除新表或修改 migration registry。schema 问题必须前向修复。

### 4.5 私密简历运维

- 公开入口只显示授权状态；真实 PDF 只通过 `GET /api/resume/file` 在有效简历 Session 下解密返回。响应必须保持 `Content-Type: application/pdf`、`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff` 和内联 disposition。
- 管理员在 `/admin` 上传最终 PDF、创建一人一码的简历邀请或停用邀请。明文邀请码只在创建响应中出现一次；停用后关联简历 Session 下一次请求立即失效。聊天邀请码与简历邀请码互不升级权限。
- 简历访问事件只记录受控元数据，30 天后由 Worker 删除。Worker 还会删除至少 24 小时且无数据库引用的密文/临时文件；清理或文件事务异常必须写入 `storage_recovery`，不能静默吞掉。
- 备份必须把数据库、加密密文卷和密钥版本作为一个恢复集合校验，同时将密钥材料与密文备份分离保管。不得备份明文 PDF、邀请码明文、Session token、原始请求或响应正文。未完成一次隔离恢复演练前，不宣称私密简历可灾备恢复。

密钥轮换使用 `scripts/rotate-resume-key.mjs` 的四阶段协议，并在受控维护窗口执行：

1. `prepare`：向一次性运维容器只读挂载旧/新密钥文件，设置 `MORSE_RESUME_OLD_KEY_FILE`、`MORSE_RESUME_NEW_KEY_FILE`、`MORSE_RESUME_OLD_KEY_VERSION` 和 `MORSE_RESUME_NEW_KEY_VERSION` 后重新加密并校验；当前指针不变。
2. `activate <previous-id> <prepared-id>`：原子切换当前文档；随后替换 Web 的 `resume_encryption_key` 和 `MORSE_RESUME_KEY_VERSION`，重启并观察文件响应和健康状态。
3. 观察失败且尚未 finalize 时执行 `rollback <previous-id> <activated-id>`，恢复旧 Secret/版本并重新观察。
4. 观察通过后执行 `finalize <activated-id> <retired-id> <observed-id>`；只有指针与观察目标一致时才删除退役行和密文。

每个阶段只接受稳定 `RESUME_KEY_ROTATION_OK`。数据库提交状态不明确、指针不一致、密文清理失败或出现 `storage_recovery` 时必须停止，不得盲目重试、覆盖旧密钥或手工删除文件。

## 5. Worker 行为

- 设置 `MORSE_WORKER_HEARTBEAT_FILE` 时，Worker 在每轮迭代开始把当前时间戳写入该文件作为存活信号；写入失败只记录 `WORKER_HEARTBEAT_WRITE_FAILED`，不影响业务循环。部署平台可用该文件的 mtime 实现容器级 liveness 检查；未设置该变量时行为不变。
- Outbox 默认每 5 秒轮询，单轮受 `MORSE_ALERT_DISPATCH_LIMIT` 限制。
- 连续基础设施错误按 5、10、20、40、60 秒有界退避，成功后复位。
- retention cleanup 在启动时执行，之后每小时执行。
- cleanup 使用 PostgreSQL transaction advisory lock；另一个 Worker 已持锁时跳过本轮，不并发删除。
- 简历 Session、邀请码和访问审计按独立保留合同清理；原始访问审计固定 30 天，过期无引用密文和临时文件由同一 Worker 周期受控清理。
- SIGINT/SIGTERM 停止新一轮工作并关闭数据库池。
- Feishu custom webhook 仍是至少一次投递。远端成功但本地写入 `sent` 前崩溃时可能重复，不能对外承诺 exactly-once。

## 6. 重建式灾备演练

当前公开服务的恢复不承诺恢复管理员设定访问期内的 Session 或 10 天 interaction analytics。私密简历启用后，恢复演练必须另行证明数据库行、加密卷和对应密钥版本一致；缺少其中任一项时只能由管理员重新上传最终 PDF：

1. 在隔离的新数据库上启用 pgvector。
2. 执行全部 migration。
3. 从仓库审核后的公开内容重新 ingest，并验证第二次全量跳过。
4. 创建新邀请码。
5. 启动 Web/Worker，验证 live/ready、静态页面和一轮文本对话。
6. 记录恢复耗时、镜像 digest、migration 集与知识 checksum。

不得为了“备份”把访客问题、回答、搜索摘要或短期 token 复制到长期存储，从而绕过 10 天删除边界。未来若要托管备份 interaction analytics，必须先单独冻结保留策略、加密、访问控制和恢复删除语义。

## 7. 回滚

- 每次发布记录不可变镜像 digest，保留上一个已观察版本。
- 应用配置或行为异常且 schema 兼容时，将 Web/Worker 回滚到上一 digest，再执行 live/ready 和文本 smoke。
- migration 只追加，不提供 down migration。若新版本已改变 schema 且旧镜像不兼容，禁止盲目回滚；停止发布并按对应 migration 的前向修复方案恢复。
- migration `004` 应用后，回滚下限是仍能识别 `004` manifest、`ai_runtime_state` 单例和新增可空列的 Stage 1 兼容镜像；不得切回只认识 001-003 的二进制，也不得删除 Provider 配置表或伪造 migration registry。
- migration `012` 应用后只允许关闭 Context Packet 开关并使用识别 `001-012` manifest 的镜像；不得 down migration 或切回 pre-012 镜像。
- 私密简历异常时先设置 `MORSE_RESUME_ENABLED=false` 并只重启 Web/Worker；保留 migration `003`、密文卷和 Secret，不执行 down migration或删除数据。确认旧镜像忽略新增表后才可切回上一冻结版本。
- 不从脏工作树构建或部署；发布必须指向已冻结 commit。

## 8. 当前生产状态与硬化余项

首个生产实例在 `39849e1` 完成平台、域名、TLS edge、生产 BGE、独立数据库角色、最小 grants、PostgreSQL TLS、迁移换行/checksum、2 MB body limit、SSE flush、CSP、真实对话 smoke 和公网 live/ready/release smoke。2026-07-29 当前应用 release 为 `0d2fa84`：招聘入口、完整 JD、审核能力证据和 unavailable 能力边界已通过，但首个十问评估问题被误路由为 `unsupported_personal_history / temporary`，新建 Task 且为 0 sources / 0 evidence，因此状态仍是 `PRODUCTION_OBSERVED_FAILURE / HR_ACCEPTANCE_STOPPED`，不得开始推广。该 release 只重建 Web/Worker，DB、Embedding 与 Edge 身份未变；Context Packet 保持 enabled、percent `0` 和精确 `HR interview` 标签准入。第五次本地修复须冻结发布后通过全新入口、完整 JD 和十问真实链，脱敏证据以 `docs/verify/release/hr-recruitment-evaluation-followup-local-closeout-2026-07-29.md` 为准。

以下事项完成前保持 `LIMITED_LAUNCH`，不标记完整 `ONLINE_READY`：

- 从更多国内网络复核可达性。
- 在 edge 增加独立的速率、连接数和异常流量限制；应用层现有限流不能代替入口层保护。
- 接入监控与日志平台，覆盖 5xx、Provider/Embedding/Search、pool、Outbox、cleanup 和容量。
- 冻结托管备份范围并完成一次独立恢复演练；当前只承诺公开知识可重建。
- 获得当次授权后分别执行真实 Bocha 和 Feishu smoke。
- 复核并处置当前生产依赖 advisory；2026-07-25 生产 `npm ci` 报告 3 个 high，不执行无评估的 `audit fix`。
- 将经人工确认的最终内容与素材冻结成新提交后再发布；不得从当前脏工作区直接覆盖生产。
- 私密简历已启用且最终 PDF 已上传；后续真实访客邀请码的创建与传递、密钥轮换和恢复演练仍需分别授权。

## 9. 故障定位顺序

1. live 失败：Web 进程或 edge 路由故障。
2. live 成功、ready 失败：依次检查稳定 preflight code、DB TLS/连接、migration、知识 ingest。
3. Web ready、对话失败：按主节点、备用 1、备用 2 的顺序检查 Chat Provider，再检查 Embedding/Search incident；不打印请求正文、响应正文或凭据。
4. Outbox 堆积：检查 Worker 是否运行、alert mode、DB lease、Feishu 响应和 attempt cap。
5. cleanup 过期：检查 Worker 稳定日志、DB lock 竞争和最后成功时间；不要手工绕过 10 天保留 SQL 顺序。
# Latest release override (2026-07-29)

- Current runtime commit: `0d2fa84`; `/opt/revolution/current` points to `/opt/revolution/releases/0d2fa84/revolution`.
- Context Packet remains enabled with percent `0`; exact label allowlist is `HR interview`, preserving the existing UUID allowlist.
- Status is `PRODUCTION_OBSERVED_FAILURE`: the entry and complete JD passed, but the first HR evaluation follow-up switched to an unsupported personal-history task with zero evidence. The fifth local correction must be deployed and pass a fresh isolated 12-turn HR chain before promotion.
