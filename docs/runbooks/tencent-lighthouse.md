# 腾讯云 Lighthouse 上线手册

本文对应 `aimorse.tech` 的生产部署。当前实例为腾讯云 Lighthouse 首尔节点，公网地址为 `43.133.68.202`。境外节点不需要 ICP 备案；DNS 解析和 HTTPS 证书签发已完成，域名实名状态继续由腾讯云注册控制台维护。

## 当前生产状态（2026-07-23）

- 状态：`PRODUCTION_OBSERVED / RESPONSE_RELIABILITY / CANARY_0`，当前应用 release `e5f9210`，私密简历已启用并保持受控访问。
- 实例：`lhins-0oly57x8`；`/opt/revolution/current` 指向 `/opt/revolution/releases/e5f9210/revolution`，Web、Worker、Edge 与 DB Compose working directory 均指向该冻结 release，公网 live/ready 均为 HTTP 200。
- 拓扑：Caddy edge、Next.js Web、Worker、PostgreSQL 16 + pgvector、CPU BGE/Embedding 均已启动；DB、Embedding 与 Web health 为 healthy。
- 域名：`aimorse.tech` 与 `www.aimorse.tech` 均解析到 `43.133.68.202`；Let's Encrypt 证书已签发，HTTP 和 `www` 均重定向到主域 HTTPS。
- 防火墙：腾讯云入站允许 TCP `22/80/443` 与 ICMP；UFW 允许 `22/80/443`，数据库、Embedding 和 Next 内部端口未映射到公网。
- 数据：migration 001–007 已执行；runtime 私密表、AI 配置与 Chat v2 grants 通过，migration 临时超级用户权限已撤销。公开知识共 40 documents / 47 chunks，最近一次重复摄取为 0 更新、40 documents 跳过。
- 验证：公网 live、ready、兼容 health、根页、作品页、`/admin` 与 `/admin/api` 均为 HTTP 200；未登录管理 API 与简历文件为 401，`release:smoke` 通过。Chat v2 为总开关开启、canary 0%、现有白名单非空但未回显、hedging 与 safe mode 关闭；历史 `chat_provider_attempts=36`、active v2 Session 为 0，发布前后计数不变。本次发布没有登录管理员，也没有调用真实 Chat、Bocha 或 Feishu。
- 浏览器：首页 Warp Tunnel 与作品页在 1440x900、390x844 和 reduced-motion 场景均无横向溢出、控制台/page error、外部运行时请求或失败；数字摩斯封面使用 1381x770 的当前线上首页截图并完成双宽复验；从项目 CTA 输入邀请码后，预填问题保留在输入框且不会自动发送。
- 性能：生产域名 Lighthouse 13.4.0 移动端与桌面端 Performance 均为 99；桌面 FCP 0.2s、LCP 0.6s、TBT 70ms、CLS 0、Speed Index 1.0s。
- 管理入口：`https://aimorse.tech/admin` 不在公开导航中。`/admin/api` 只管理全站 OpenAI-compatible Chat 中转、模型和一主五备活动路由；当前主线路和每条备用线路显示脱敏后的中转主机名，数据库活动线路按不可变模型版本关联对应连接版本。配置密钥使用 Web-only 文件型主密钥加密，运行摘要不返回 Key 或 Base URL 路径/查询参数。当前配置表没有管理员创建的中转或模型，运行继续使用三个只读环境目标。发布验收没有读取生产管理员密码；认证后的发现、真实测试、激活、回退和删除由管理员显式执行。
- 私密简历：代码、API、migration `003`、权限为 `0700` 的私有卷和权限为 `0600` 的文件型 Secret 已部署；Web 可读取 Secret，Worker 不挂载 Secret。`MORSE_RESUME_ENABLED=true`，经确认的定向版最终 PDF 已通过认证后台进入私有密文卷；未授权文件请求保持 401。上线验收邀请码已停用且关联 Session 已失效，后续访问码由管理员按人创建和停用。
- PostgreSQL TLS：证书与私钥已持久化到 `/opt/revolution/shared/postgres/tls`，release 内 `deploy/postgres/tls` 只保留指向该目录的符号链接。任何 Compose 升级命令前必须确认证书可解析、私钥为普通文件且权限为 `0600`；不得依赖运行中容器保存已从宿主删除的 bind 源。

仍需保持诚实边界：监控、托管备份与恢复演练、独立 edge 速率/连接限制、真实 Bocha/Feishu smoke、依赖 advisory 处置和更多国内网络可达性复核尚未完成。本次生产 `npm ci` 报告 1 个 moderate、2 个 high，未执行未经评估的自动修复。首页 Warp Tunnel、五项目页面与公开知识已进入生产，但剩余工作区改动和未跟踪证据没有进入生产。

## 管理入口与邀请码发布验收

邀请码管理已由 `c3f1ec6` 吸收并作为冻结 release 部署；管理员按以下顺序完成认证后的业务验收：

1. 核对 `/opt/revolution/current` 指向的新 release，不能只根据本地或远端分支判断已上线。
2. 打开 `https://aimorse.tech/admin`，使用生产管理员密码登录；确认公共导航仍没有 Admin 链接。
3. 点击顶部“邀请码”，创建一个 1 小时、1 会话的 smoke 邀请码，并立即复制一次性明文；不要把明文写入终端历史、文档或截图。
4. 在隔离浏览器会话中兑换并完成最小聊天 smoke，确认列表会话用量更新。
5. 停用该 smoke 邀请码，确认新的兑换被拒绝；已经建立的访客 Session 应继续可用。
6. 重新执行公网 live/ready 与 `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke`，再记录 production-observed 证据。

如管理页面不可用，按平台无关生产手册使用 `npm run invite:create` 应急；不要为此开放数据库端口、打印生产环境变量或直接写 `invite_codes`。

## Chat v2 disabled-first 灰度

本节记录当前回答可靠性版本的生产运维合同，不改变上方 2026-07-23 的已观察生产事实。真实 Provider 评审、故障注入和扩大流量仍需分别授权：

回答可靠性版本沿用平台手册的串行共享预算：协议事件 25 秒、模型正文 40 秒、Provider 阶段 80 秒、完整 turn 90 秒、normal/strict/failover 合计 3 个 attempt。生产预检必须核对这些值的严格顺序；节点切换只消费剩余预算，不得因切备用重新获得 80 秒，评审期间不得启用 hedging。

1. 首次发布设置 `MORSE_CHAT_V2_ENABLED=true`、`MORSE_CHAT_V2_CANARY_PERCENT=0`、`MORSE_CHAT_V2_CANARY_INVITE_IDS` 留空、`MORSE_CHAT_HEDGED_FAILOVER_ENABLED=false`、`MORSE_CHAT_SAFE_MODE=false`，发布后先证明没有 Session 进入 v2。
2. 新管理 UI 可用后，在 `/admin` 创建专用聊天邀请码。一次性明文只保留在当前浏览器内；当场复制后台显示的非敏感灰度 UUID，白名单不使用邀请码明文。
3. 把该实际 UUID 直接写入 `/opt/revolution/shared/.env.production` 的 `MORSE_CHAT_V2_CANARY_INVITE_IDS`，使用不回显值的 UUID 格式检查后只重启 Web；不得使用环境变量占位符、`$` 引用或尖括号占位值代替实际值，不得在终端输出、日志或截图中记录该值。
4. 保持 hedging 关闭，完成已授权的固定 20 轮真实输出评审。至少 18/20 通过；私密信息泄露、虚构个人事实、无 JD 生成适配结论和自由对话错误调用 RAG 均为零容忍。评审遥测只保留 case id、路由/依赖计数、attempt 状态与时延和脱敏评分，不保留 raw prompt、回答或 Provider payload。通过后再单独启用 hedging 做故障注入，并分别记录调用数、延迟和失败原因。
5. 白名单观察通过后，依次设置 `MORSE_CHAT_V2_CANARY_PERCENT=25` 和 `MORSE_CHAT_V2_CANARY_PERCENT=100`；每次只重启 Web，复验 live、ready、公开页面、v1 会话和目标 canary 行为后再继续。
6. 人格或证据异常时设置 `MORSE_CHAT_SAFE_MODE=true`，运行时 safe mode 优先于已开启的 hedging；成本异常时只设置 `MORSE_CHAT_HEDGED_FAILOVER_ENABLED=false`；隐私问题时设置 `MORSE_CHAT_ENABLED=false`。每次切换后只重启 Web 并复验，不改数据库。
7. `005` / `006` / `007` 均为 additive migration，不执行 down migration；`006` 只增加并回填非敏感邀请备注快照，`007` 只增加路由锚点、证据分类、attempt 模式与分段延迟字段。Readiness 要求数据库 registry 与镜像内 migration manifest 完全一致，因此 registry 已有 007 后只能切换到包含 007 的兼容镜像；不得回切 pre-007 镜像，不删除迁移或数据。

所有 Chat v2 变量都是服务端配置，禁止增加 `NEXT_PUBLIC_` 前缀。生产预检必须拒绝 canary 超界、非 UUID、备用节点缺 key 或缺 URL、未解析引用和尖括号占位值；预检不调用 Provider，也不回显灰度 UUID、Provider URL 或 key。

## 发布边界

- 只发布已冻结的 Git 提交，不从脏工作区复制文件。
- 公网只开放 `80/443`；PostgreSQL、BGE 和 Next 内部端口不映射到宿主机。
- `web`、`worker`、`migration`、`ingest` 使用不同数据库连接角色。
- BGE 只通过 Docker 内网访问。`MORSE_EMBEDDING_ALLOW_PRIVATE_HTTP=true` 只允许内部单标签主机名或 RFC1918 地址。
- `MORSE_ALLOW_TEST_EMBEDDINGS=true`、`MORSE_LOCAL_RELEASE_SMOKE=true` 不能出现在生产角色环境。

## 首次初始化

在服务器上创建 `/opt/revolution`，并准备 Docker、Git（或通过本机打包上传）和防火墙。证书和密钥只在服务器生成：

```bash
umask 077
mkdir -p /opt/revolution/deploy/secrets /opt/revolution/deploy/postgres/tls
openssl rand -hex 32 > /opt/revolution/deploy/secrets/db_admin_password
openssl rand -hex 32 > /opt/revolution/deploy/secrets/db_runtime_password
openssl rand -hex 32 > /opt/revolution/deploy/secrets/db_migration_password
openssl rand -hex 32 > /opt/revolution/deploy/secrets/db_ingest_password
openssl rand -hex 32 > /opt/revolution/deploy/secrets/db_backup_password
openssl rand -base64 32 > /opt/revolution/deploy/secrets/provider_config_key
chown 999:999 /opt/revolution/deploy/secrets/db_*_password
chmod 600 /opt/revolution/deploy/secrets/db_*_password
chown 1001:1001 /opt/revolution/deploy/secrets/provider_config_key
chmod 600 /opt/revolution/deploy/secrets/provider_config_key
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -subj /CN=revolution-db \
  -keyout /opt/revolution/deploy/postgres/tls/server.key \
  -out /opt/revolution/deploy/postgres/tls/server.crt
chown 999:999 /opt/revolution/deploy/postgres/tls/server.key /opt/revolution/deploy/postgres/tls/server.crt
chmod 600 /opt/revolution/deploy/postgres/tls/server.key
```

在 `/opt/revolution/shared/.env.production` 注入生产变量，并让当前 release 的 `.env.production` 符号链接指向该文件。必须至少包括：

```text
DATABASE_URL_RUNTIME=postgresql://runtime:<password>@db:5432/revolution
DATABASE_URL_MIGRATION=postgresql://migration:<password>@db:5432/revolution
DATABASE_URL_INGEST=postgresql://ingest:<password>@db:5432/revolution
MORSE_PUBLIC_ORIGIN=https://aimorse.tech
MORSE_ADMIN_ALLOWED_ORIGIN=https://aimorse.tech
OPENAI_API_KEY=<provider-secret>
OPENAI_BASE_URL=https://<provider-host>/v1
OPENAI_FALLBACK_1_API_KEY=<provider-secret>
OPENAI_FALLBACK_1_BASE_URL=https://<fallback-1-host>/v1
OPENAI_FALLBACK_2_API_KEY=<provider-secret>
OPENAI_FALLBACK_2_BASE_URL=https://<fallback-2-host>/v1
OPENAI_CHAT_MODEL=<provider-model>
OPENAI_CHAT_PROTOCOL=responses
OPENAI_REASONING_EFFORT=high
OPENAI_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
EMBEDDING_API_KEY=<random-internal-key>
MORSE_ADMIN_PASSWORD_HASH=<scrypt-hash>
MORSE_INVITE_FINGERPRINT_SECRET=<random-secret>
MORSE_PROVIDER_CONFIG_KEY_VERSION=1
MORSE_ALERTS_ENABLED=false
MORSE_SEARCH_ENABLED=false
MORSE_RESUME_ENABLED=false
MORSE_RESUME_COOKIE=morse_resume_access
MORSE_RESUME_KEY_VERSION=1
MORSE_RESUME_FINGERPRINT_SECRET=<random-secret>
MORSE_RESUME_TRUSTED_PROXY_HOPS=1
```

`compose.production.yaml` 固定把 `provider_config_key` 只挂载给 Web；Worker、Migration、Ingest 和 edge 不得获得该文件。它还把 `revolution_private_resume` 挂载到 Web/Worker，并只把 `resume_encryption_key` Secret 挂载给 Web。`MORSE_PROVIDER_CONFIG_KEY_FILE`、`MORSE_RESUME_STORAGE_DIR` 和 `MORSE_RESUME_ENCRYPTION_KEY_FILE` 由 Compose 注入，禁止在 `.env.production` 改成宿主机任意路径。首次准备这些资源仍属于对应部署授权，不能因为命令已写入手册就提前执行。

## 发布顺序

升级已有实例时，先显式确认 DB/Embedding healthy，再对 migration、grants、ingest 和 resume-storage-init 使用 `docker compose run --rm --no-deps ...`。plain `compose run` 会协调 `depends_on`，配置或 bind 源漂移时可能重建 DB/Embedding。切换应用 release 不得隐式重建依赖容器。

```bash
docker compose --env-file .env.production -f compose.production.yaml build
# 仅首次初始化执行；升级已有 healthy DB/Embedding 时跳过下一行
docker compose --env-file .env.production -f compose.production.yaml up -d db embedding
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps resume-storage-init
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps migration
docker compose --env-file .env.production -f compose.production.yaml --profile ops run --rm --no-deps grants
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps ingest
docker compose --env-file .env.production -f compose.production.yaml up -d web worker edge
```

迁移完成后 `grants` 会撤销 migration 角色的临时超级用户权限；随后必须在受控 psql 会话执行 `deploy/postgres/verify-ai-config-runtime.sql`。重复执行 migration 和 ingest 应分别保持幂等，第二次入库应跳过未变化内容。migration `004` 应用后只允许回退到识别 004 的 Stage 1 兼容镜像，禁止切回只认识 001-003 的版本。私密简历首次部署必须先保持 `MORSE_RESUME_ENABLED=false` 完成上述序列，核对 migration `003` checksum、runtime grants、live/ready 和公开 release smoke，再在单独授权下切换开关并只重启 Web/Worker。

## 私密简历首次启用与密钥轮换

1. 获得私密简历生产授权后，在受限主机上生成 `deploy/secrets/resume_encryption_key`，所有者设为容器 Web UID/GID `1001:1001`、权限 `0600`；确认数据库备份可读取、私有卷权限为 `0700`、Web 能读取该 Secret、Worker 不能读取它。生成命令不得回显密钥：

   ```bash
   umask 077
   openssl rand -base64 32 > /opt/revolution/deploy/secrets/resume_encryption_key
   chown 1001:1001 /opt/revolution/deploy/secrets/resume_encryption_key
   chmod 600 /opt/revolution/deploy/secrets/resume_encryption_key
   ```

2. 设置 `MORSE_RESUME_ENABLED=true` 并重启 Web/Worker；先观察未上传 PDF 的公开入口，不创建邀请码。
3. 真实最终 PDF 只能由管理员通过 `/admin` 上传；不得使用 SCP 写入卷，不得截图或记录正文。上传后只核对密文大小/SHA-256、数据库当前指针、PDF 响应状态与安全头。
4. 只有再次授权后才创建一个真实简历邀请码并完成受控兑换；明文不进入终端历史、文档、截图或日志。

密钥轮换在一次性受控运维容器中运行 `node scripts/rotate-resume-key.mjs`，旧/新密钥都以只读文件挂载，依次执行 `prepare`、`activate`、观察、`finalize`；观察失败时在 finalize 前执行 `rollback`。每一步的参数与停止条件见平台无关运行手册。发生指针不一致、提交状态未知或 `storage_recovery` 时立即停止，不覆盖旧 Secret、不删除密文，并先关闭 `MORSE_RESUME_ENABLED`。

## DNS、端口和检查

腾讯云 DNS 设置：`aimorse.tech` 和 `www.aimorse.tech` 的 A 记录都指向 `43.133.68.202`。安全组/`ufw` 只放行 `22`、`80`、`443`；不要放行 `5432`、`18091`、`3000`。

```bash
curl -fsS https://aimorse.tech/api/health/live
curl -fsS https://aimorse.tech/api/health/ready
MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke
docker compose --env-file .env.production -f compose.production.yaml ps
```

执行 Compose 运维命令时必须带 `--env-file .env.production`；省略后出现的空变量警告不代表现有容器丢失配置，但会让新建、重建或一次性角色使用错误配置。

`/api/health/ready` 返回 `503` 时，按顺序检查数据库 TLS、migration checksum、知识入库、BGE health 和 Web 日志；不要通过打开测试 embedding 或复制本地数据库来绕过预检。

## 回滚和数据策略

应用镜像按 Git 提交保留 digest。无 schema 变化的发布可以停止 `edge/web/worker` 并切回上一 digest；迁移是前向追加，不执行猜测性的 down migration。若已应用 migration `004`，旧镜像必须至少具备 Stage 1 兼容性并识别 004 manifest；否则停止发布并按前向修复恢复，不能删除配置表、回填假 checksum 或切回只认识 003 的镜像。

公开知识继续从仓库重新 ingest，短期会话和交互分析按既定保留期处理，不把原始对话复制到临时备份。私密简历启用后不属于“可重建数据”：数据库、加密密文卷和对应密钥版本必须分离备份并共同恢复验证；任何备份都不得包含明文 PDF、邀请码明文或 Session token。是否启用腾讯云快照或独立加密备份，需要在首轮真实恢复演练后单独决定。
