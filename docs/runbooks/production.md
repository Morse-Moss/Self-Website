# Revolution 生产运行手册

> 状态：S11-5A 本地发布候选。本文冻结平台无关的应用运行合同，不代表系统已经部署或达到 `ONLINE_READY`。

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
| Web | runtime DB、HTTPS public/admin origin、Admin 与 invite secrets、Chat/Embedding 配置 | DDL、建库、Feishu webhook |
| Worker | runtime DB、显式 `MORSE_ALERTS_ENABLED`；启用时需要 Feishu webhook | Chat/Embedding、Admin 凭据、DDL |
| Migration | migration DB 凭据与 TLS | Provider、Admin、Feishu |
| Ingest | ingest DB、Embedding 配置与 TLS | Chat、Admin、Feishu |

部署平台必须给 runtime、migration 和未来 backup 注入不同的数据库角色。S11-5A 只验证应用配置合同，实际 role/grant、证书和网络 ACL 是 staging 阻塞项。

## 3. 生产配置

- `NODE_ENV=production`。
- `MORSE_PUBLIC_ORIGIN` 与 `MORSE_ADMIN_ALLOWED_ORIGIN` 必须是同一个无凭据 HTTPS origin。
- `MORSE_DATABASE_SSL_MODE` 只能用 `require` 或 `verify-full`；优先 `verify-full` 并通过 Secret Store 注入 `MORSE_DATABASE_SSL_CA`。
- 数据库 URL 不携带 `sslmode`、证书或密钥 query，TLS 只由集中配置控制。
- 每个进程单独计算 `MORSE_DATABASE_POOL_MAX`。初始只运行一个 Web 和一个 Worker，容量必须小于数据库总连接上限并预留运维连接。
- `MORSE_ALLOW_TEST_EMBEDDINGS=true` 在生产直接拒绝。
- `MORSE_LOCAL_RELEASE_SMOKE=true` 只供 loopback production-build harness 使用，正式角色启动器直接拒绝。
- `MORSE_ALERTS_ENABLED` 必须显式为 `true` 或 `false`。关闭告警时 Worker 仍执行 retention cleanup。
- 所有 key、密码、TOTP、webhook、DB URL 和 CA 只从部署 Secret Store 或主机受限环境文件注入，不进入 Git、镜像层和日志。

完整变量名与本地默认值见 `.env.example`。示例值不是生产凭据，也不是生产安全配置。

## 4. 首次启动顺序

1. 创建受限网络内的 PostgreSQL/pgvector，并完成 TLS 与角色授权。
2. 使用 migration 角色执行 `npm run production:migrate`。
3. 启动并验证生产 Embedding 服务。
4. 使用 ingest 角色执行 `npm run production:ingest`；重复执行应全量跳过。
5. 启动单副本 Web，检查 `/api/health/live` 和 `/api/health/ready`。
6. 启动单实例 Worker。
7. 创建新的 72 小时邀请码，完成一次受控文本对话 smoke。
8. 在真实 TLS edge 后执行 `MORSE_RELEASE_BASE_URL=https://... npm run release:smoke`。

`/api/health/live` 不访问依赖。`/api/health/ready` 和兼容入口 `/api/health` 只有在运行配置有效、数据库可达、migration 版本与 checksum 完整、公开知识非空时返回 `200 {"ok":true}`；失败统一返回 `503 {"ok":false}`，不得泄漏模型、费用、表名、chunk 数或内部异常。

## 5. Worker 行为

- Outbox 默认每 5 秒轮询，单轮受 `MORSE_ALERT_DISPATCH_LIMIT` 限制。
- 连续基础设施错误按 5、10、20、40、60 秒有界退避，成功后复位。
- retention cleanup 在启动时执行，之后每小时执行。
- cleanup 使用 PostgreSQL transaction advisory lock；另一个 Worker 已持锁时跳过本轮，不并发删除。
- SIGINT/SIGTERM 停止新一轮工作并关闭数据库池。
- Feishu custom webhook 仍是至少一次投递。远端成功但本地写入 `sent` 前崩溃时可能重复，不能对外承诺 exactly-once。

## 6. 重建式灾备演练

当前恢复目标是恢复公开服务，不承诺恢复 12 小时 Session 或 10 天 interaction analytics：

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
- S11-5A 没有 schema 变化，因此本切片可以按应用镜像整体回滚。
- 不从脏工作树构建或部署；发布必须指向已冻结 commit。

## 8. Staging 阻塞项

以下全部完成前只能称 `LOCAL_RELEASE_CANDIDATE`，不能称 `ONLINE_READY`：

- 选择实际平台、域名和 TLS edge，并验证国内目标访客的真实可达性。
- 部署生产 BGE/Embedding 并完成真实 Embedding smoke。
- 建立 runtime/migration/backup 数据库角色、最小 grants、TLS certificate 和网络 ACL。
- 在首个跨平台生产迁移前固定 `db/migrations/*.sql` 的换行与 checksum 语义，并证明 Windows/Linux 干净检出产生相同 manifest；S11-5A 当前只验证本机原始字节 checksum。
- 在 edge 配置请求体、速率、连接数和 SSE idle timeout 限制。
- 设计并在真实 Next render 验证 CSP。
- 接入监控与日志平台，覆盖 5xx、Provider/Embedding/Search、pool、Outbox、cleanup 和容量。
- 决定托管备份范围并完成隔离恢复演练。
- 获得当次授权后分别执行真实 GPT、Bocha 和 Feishu smoke。
- 构建并检查应用镜像 user、文件、层历史和漏洞；当前 Docker build 会执行 `npm ci`，仍需单独安装审批。

## 9. 故障定位顺序

1. live 失败：Web 进程或 edge 路由故障。
2. live 成功、ready 失败：依次检查稳定 preflight code、DB TLS/连接、migration、知识 ingest。
3. Web ready、对话失败：检查 Provider/Embedding/Search incident，不打印请求正文或凭据。
4. Outbox 堆积：检查 Worker 是否运行、alert mode、DB lease、Feishu 响应和 attempt cap。
5. cleanup 过期：检查 Worker 稳定日志、DB lock 竞争和最近成功时间；不要手工绕过 10 天保留 SQL 顺序。
