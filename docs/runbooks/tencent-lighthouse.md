# 腾讯云 Lighthouse 上线手册

本文对应 `aimorse.tech` 的生产部署。当前实例为腾讯云 Lighthouse 首尔节点，公网地址为 `43.133.68.202`。境外节点不需要 ICP 备案；DNS 解析和 HTTPS 证书签发已完成，域名实名状态继续由腾讯云注册控制台维护。

## 当前生产状态（2026-07-21）

- 状态：`PRODUCTION_OBSERVED / LIMITED_LAUNCH`，当前应用 release `b6ddad5`。
- 实例：`lhins-0oly57x8`；2026-07-21 只读核验 `/opt/revolution/current` 指向 `/opt/revolution/releases/b6ddad5/revolution`，公网 live/ready 均为 HTTP 200。
- 拓扑：Caddy edge、Next.js Web、Worker、PostgreSQL 16 + pgvector、CPU BGE/Embedding 均已启动；DB、Embedding 与 Web health 为 healthy。
- 域名：`aimorse.tech` 与 `www.aimorse.tech` 均解析到 `43.133.68.202`；Let's Encrypt 证书已签发，HTTP 和 `www` 均重定向到主域 HTTPS。
- 防火墙：腾讯云入站允许 TCP `22/80/443` 与 ICMP；UFW 允许 `22/80/443`，数据库、Embedding 和 Next 内部端口未映射到公网。
- 数据：migration 001/002 已执行并通过幂等复验；公开知识共 40 documents / 47 chunks。本轮 Provider 发布摄取为 0 更新、40 documents 跳过；migration 临时超级用户权限已撤销。
- 验证：公网 live、ready、兼容 health、根页与作品页均为 HTTP 200；`release:smoke` 通过。Chat 固定使用 `gpt-5.6-terra`、Responses 和 high reasoning；主节点、强制一级接管、强制二级接管及运行 Web 容器主节点共 4 次受控真实调用均返回完整终态和 usage，未保存回答正文、原始 payload 或凭据。真实 Bocha 和 Feishu 本次未调用。
- 浏览器：首页 Warp Tunnel 与作品页在 1440x900、390x844 和 reduced-motion 场景均无横向溢出、控制台/page error、外部运行时请求或失败；正式图片加载完成；从项目 CTA 输入邀请码后，预填问题保留在输入框且不会自动发送。
- 性能：生产域名 Lighthouse 13.4.0 移动端与桌面端 Performance 均为 99；桌面 FCP 0.2s、LCP 0.6s、TBT 70ms、CLS 0、Speed Index 1.0s。
- 管理入口：`https://aimorse.tech/admin` 不在公开导航中。功能基线 `c3f1ec6` 使用密码登录，包含对话复盘、badcase、密码复验导出和邀请码管理；生产脚本不再引用 `totpCode` 或 `inviteTotpCode`。发布验收没有读取生产管理员密码，因此未创建邀请码明文；认证后的创建、兑换与停用按下方顺序由管理员验收。
- 私密简历：本地分支已达到 `LOCAL_READY`，但生产 release `b6ddad5` 不包含简历 API、migration `003`、私有卷、简历 Secret、真实 PDF 或简历邀请码；不得把本地验收描述为已上线。

仍需保持诚实边界：监控、托管备份与恢复演练、独立 edge 速率/连接限制、真实 Bocha/Feishu smoke、moderate dependency advisory 处置和更多国内网络可达性复核尚未完成。首页 Warp Tunnel、五项目页面与公开知识已进入生产，但剩余工作区改动和未跟踪证据没有进入生产。

## 管理入口与邀请码发布验收

邀请码管理已由 `c3f1ec6` 吸收并作为冻结 release 部署；管理员按以下顺序完成认证后的业务验收：

1. 核对 `/opt/revolution/current` 指向的新 release，不能只根据本地或远端分支判断已上线。
2. 打开 `https://aimorse.tech/admin`，使用生产管理员密码登录；确认公共导航仍没有 Admin 链接。
3. 点击顶部“邀请码”，创建一个 1 小时、1 会话的 smoke 邀请码，并立即复制一次性明文；不要把明文写入终端历史、文档或截图。
4. 在隔离浏览器会话中兑换并完成最小聊天 smoke，确认列表会话用量更新。
5. 停用该 smoke 邀请码，确认新的兑换被拒绝；已经建立的访客 Session 应继续可用。
6. 重新执行公网 live/ready 与 `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke`，再记录 production-observed 证据。

如管理页面不可用，按平台无关生产手册使用 `npm run invite:create` 应急；不要为此开放数据库端口、打印生产环境变量或直接写 `invite_codes`。

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

```bash
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d db embedding
docker compose --env-file .env.production -f compose.production.yaml run --rm resume-storage-init
docker compose --env-file .env.production -f compose.production.yaml run --rm migration
docker compose --env-file .env.production -f compose.production.yaml --profile ops run --rm grants
docker compose --env-file .env.production -f compose.production.yaml run --rm ingest
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
