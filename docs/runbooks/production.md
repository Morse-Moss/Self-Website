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
| Web | runtime DB、HTTPS public/admin origin、Admin 与 invite secrets、Chat/Embedding 配置；启用私密简历时需要简历密文卷和加密 Secret | DDL、建库、Feishu webhook |
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
- 私密简历默认使用 `MORSE_RESUME_ENABLED=false`。生产首次发布必须保持关闭，完成 migration `003`、私有卷初始化、最小 grants、健康检查和回滚检查后，才可在单独授权下启用。
- 启用私密简历时，Web 还必须获得 `MORSE_RESUME_STORAGE_DIR`、`MORSE_RESUME_ENCRYPTION_KEY_FILE`、`MORSE_RESUME_KEY_VERSION`、`MORSE_RESUME_FINGERPRINT_SECRET`、`MORSE_RESUME_TRUSTED_PROXY_HOPS` 和独立 `MORSE_RESUME_COOKIE`。生产禁止使用直接值 `MORSE_RESUME_ENCRYPTION_KEY`；加密密钥只通过名为 `resume_encryption_key` 的部署 Secret 文件挂载给 Web。
- Worker 只挂载简历密文卷用于保留期清理，不读取加密密钥。聊天、Embedding、Search、Ingest、Migration 和 edge 均不得获得简历文件或密钥。
- 所有 key、密码、webhook、DB URL 和 CA 只从部署 Secret Store 或主机受限环境文件注入，不进入 Git、镜像层和日志。

完整变量名与本地默认值见 `.env.example`。示例值不是生产凭据，也不是生产安全配置。

## 4. 首次启动顺序

1. 创建受限网络内的 PostgreSQL/pgvector，并完成 TLS 与角色授权。升级现有实例时先生成并校验数据库备份。
2. 在 `MORSE_RESUME_ENABLED=false` 下初始化权限为 `0700` 的简历密文卷；不要上传 PDF。
3. 使用 migration 角色执行 `npm run production:migrate`，核对 migration `003` checksum，再执行最小 grants。
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

### 4.2 私密简历运维

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

- Outbox 默认每 5 秒轮询，单轮受 `MORSE_ALERT_DISPATCH_LIMIT` 限制。
- 连续基础设施错误按 5、10、20、40、60 秒有界退避，成功后复位。
- retention cleanup 在启动时执行，之后每小时执行。
- cleanup 使用 PostgreSQL transaction advisory lock；另一个 Worker 已持锁时跳过本轮，不并发删除。
- 简历 Session、邀请码和访问审计按独立保留合同清理；原始访问审计固定 30 天，过期无引用密文和临时文件由同一 Worker 周期受控清理。
- SIGINT/SIGTERM 停止新一轮工作并关闭数据库池。
- Feishu custom webhook 仍是至少一次投递。远端成功但本地写入 `sent` 前崩溃时可能重复，不能对外承诺 exactly-once。

## 6. 重建式灾备演练

当前公开服务的恢复不承诺恢复 12 小时 Session 或 10 天 interaction analytics。私密简历启用后，恢复演练必须另行证明数据库行、加密卷和对应密钥版本一致；缺少其中任一项时只能由管理员重新上传最终 PDF：

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
- 私密简历异常时先设置 `MORSE_RESUME_ENABLED=false` 并只重启 Web/Worker；保留 migration `003`、密文卷和 Secret，不执行 down migration或删除数据。确认旧镜像忽略新增表后才可切回上一冻结版本。
- 不从脏工作树构建或部署；发布必须指向已冻结 commit。

## 8. 当前生产状态与硬化余项

首个生产实例在 `39849e1` 完成平台、域名、TLS edge、生产 BGE、独立数据库角色、最小 grants、PostgreSQL TLS、迁移换行/checksum、2 MB body limit、SSE flush、CSP、真实对话 smoke 和公网 live/ready/release smoke。2026-07-21 只读核验的当前应用 release 为 `b6ddad5`，沿用同一生产拓扑，并已发布密码登录、邀请码管理、私有导出密码复验、五个项目的简洁页面、展开详情和正式主图、首页 Warp Tunnel、三节点 Chat 容灾及“招聘 / 合作 / 同行交流”入口。生产 migration 仍为 001/002，私密简历分支、migration `003`、私有卷、密钥和真实 PDF 均未部署。生产公开知识为 40 documents / 47 chunks；最近一次摄取为 0 更新、40 documents 跳过。生产 BGE + pgvector 的 46 条 gold 为 top-1 36/46、top-3 46/46，正负阈值均通过。生产 Lighthouse 13.4.0 的移动端与桌面端 Performance 均为 99；实例细节和历史发布证据以实例手册及 S11 closeout 为准。

以下事项完成前保持 `LIMITED_LAUNCH`，不标记完整 `ONLINE_READY`：

- 从更多国内网络复核可达性。
- 在 edge 增加独立的速率、连接数和异常流量限制；应用层现有限流不能代替入口层保护。
- 接入监控与日志平台，覆盖 5xx、Provider/Embedding/Search、pool、Outbox、cleanup 和容量。
- 冻结托管备份范围并完成一次独立恢复演练；当前只承诺公开知识可重建。
- 获得当次授权后分别执行真实 Bocha 和 Feishu smoke。
- 复核并处置当前生产依赖审计中的 moderate advisory，不执行无评估的 `audit fix`。
- 将经人工确认的最终内容与素材冻结成新提交后再发布；不得从当前脏工作区直接覆盖生产。
- 私密简历需要单独授权完成 push/主线吸收、数据库备份、migration `003`、私有卷与 Secret 初始化、disabled-first 切流、真实 PDF 上传和生产观察。

## 9. 故障定位顺序

1. live 失败：Web 进程或 edge 路由故障。
2. live 成功、ready 失败：依次检查稳定 preflight code、DB TLS/连接、migration、知识 ingest。
3. Web ready、对话失败：按主节点、备用 1、备用 2 的顺序检查 Chat Provider，再检查 Embedding/Search incident；不打印请求正文、响应正文或凭据。
4. Outbox 堆积：检查 Worker 是否运行、alert mode、DB lease、Feishu 响应和 attempt cap。
5. cleanup 过期：检查 Worker 稳定日志、DB lock 竞争和最后成功时间；不要手工绕过 10 天保留 SQL 顺序。
