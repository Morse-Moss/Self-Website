# 腾讯云 Lighthouse 上线手册

本文对应 `aimorse.tech` 的生产部署。当前实例为腾讯云 Lighthouse 首尔节点，公网地址为 `43.133.68.202`。境外节点不需要 ICP 备案；DNS 解析和 HTTPS 证书签发已完成，域名实名状态继续由腾讯云注册控制台维护。

## 当前生产状态（2026-07-19）

- 状态：`PRODUCTION_OBSERVED / LIMITED_LAUNCH`，运行修订 `b15be68`，`origin/master` 已包含该生产修订。
- 实例：`lhins-0oly57x8`；`/opt/revolution/current` 指向 `/opt/revolution/releases/b15be68/revolution`；`39849e1` 与 `b8d6d88` release 继续保留用于回退。
- 拓扑：Caddy edge、Next.js Web、Worker、PostgreSQL 16 + pgvector、CPU BGE/Embedding 均已启动；DB、Embedding 与 Web health 为 healthy。
- 域名：`aimorse.tech` 与 `www.aimorse.tech` 均解析到 `43.133.68.202`；Let's Encrypt 证书已签发，HTTP 和 `www` 均重定向到主域 HTTPS。
- 防火墙：腾讯云入站允许 TCP `22/80/443` 与 ICMP；UFW 允许 `22/80/443`，数据库、Embedding 和 Next 内部端口未映射到公网。
- 数据：migration 001/002 已执行并通过幂等复验；内容发布后公开知识共 15 documents，`b15be68` 最终 ingest 为 0 document 更新、0 chunk 更新、15 documents 跳过；migration 临时超级用户权限已撤销。
- 验证：公网 live、ready、兼容 health、根页、作品页与内容创作 Agent 正式图片均为 HTTP 200；`release:smoke` 通过；真实 Provider smoke 为 HTTP 200 并完成 SSE 输出。
- 浏览器：1440x900 与 390x844 的作品页和对话框均无横向溢出、控制台 error 为 0；正式图片加载完成；从项目 CTA 输入邀请码后，预填问题保留在输入框且不会自动发送。
- 管理入口：`https://aimorse.tech/admin` 不在公开导航中。当前 release `b15be68` 包含既有登录、对话复盘、badcase 和导出；本地邀请码管理提交 `50a7663` 尚未进入 `master` 或部署，生产顶部暂不应声称已有“邀请码”入口。

仍需保持诚实边界：当前生产域名的 Lighthouse 分数未复测；监控、托管备份、独立 edge 速率/连接限制和真实 Bocha/Feishu smoke 尚未完成。当前 `b15be68` 已吸收内容创作 Agent 简介、黑金设计图、六主题知识和 CTA 修复；数字摩斯提交 `7c4c2a0` 已进入 `origin/master` 但尚未部署，剩余工作区改动同样没有进入该 release。

## 管理入口与邀请码发布验收

邀请码管理只有在对应功能提交被 `master` 吸收并作为冻结 release 部署后才可验收。部署后按以下顺序检查：

1. 核对 `/opt/revolution/current` 指向的新 release，不能只根据本地或远端分支判断已上线。
2. 打开 `https://aimorse.tech/admin`，使用生产管理员密码和当前 TOTP 登录；确认公共导航仍没有 Admin 链接。
3. 点击顶部“邀请码”，用新的未使用 TOTP 创建一个 1 小时、1 会话的 smoke 邀请码，并立即复制一次性明文；不要把明文写入终端历史、文档或截图。
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
chown 999:999 /opt/revolution/deploy/secrets/db_*_password
chmod 600 /opt/revolution/deploy/secrets/db_*_password
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -subj /CN=revolution-db \
  -keyout /opt/revolution/deploy/postgres/tls/server.key \
  -out /opt/revolution/deploy/postgres/tls/server.crt
chown 999:999 /opt/revolution/deploy/postgres/tls/server.key /opt/revolution/deploy/postgres/tls/server.crt
chmod 600 /opt/revolution/deploy/postgres/tls/server.key
```

在 `/opt/revolution/.env.production` 注入生产变量。必须至少包括：

```text
DATABASE_URL_RUNTIME=postgresql://runtime:<password>@db:5432/revolution
DATABASE_URL_MIGRATION=postgresql://migration:<password>@db:5432/revolution
DATABASE_URL_INGEST=postgresql://ingest:<password>@db:5432/revolution
MORSE_PUBLIC_ORIGIN=https://aimorse.tech
MORSE_ADMIN_ALLOWED_ORIGIN=https://aimorse.tech
OPENAI_API_KEY=<provider-secret>
OPENAI_BASE_URL=https://<provider-host>/v1
OPENAI_CHAT_MODEL=<provider-model>
OPENAI_CHAT_PROTOCOL=responses
OPENAI_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
EMBEDDING_API_KEY=<random-internal-key>
MORSE_ADMIN_PASSWORD_HASH=<scrypt-hash>
MORSE_ADMIN_TOTP_SECRET=<base32-secret>
MORSE_INVITE_FINGERPRINT_SECRET=<random-secret>
MORSE_ALERTS_ENABLED=false
MORSE_SEARCH_ENABLED=false
```

## 发布顺序

```bash
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d db embedding
docker compose --env-file .env.production -f compose.production.yaml run --rm migration
docker compose --env-file .env.production -f compose.production.yaml --profile ops run --rm grants
docker compose --env-file .env.production -f compose.production.yaml run --rm ingest
docker compose --env-file .env.production -f compose.production.yaml up -d web worker edge
```

迁移完成后 `grants` 会撤销 migration 角色的临时超级用户权限。重复执行 migration 和 ingest 应分别保持幂等，第二次入库应跳过未变化内容。

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

应用镜像按 Git 提交保留 digest。无 schema 变化的发布可以停止 `edge/web/worker` 并切回上一 digest；迁移是前向追加，不执行猜测性的 down migration。若新 schema 与旧镜像不兼容，停止发布并按对应 migration 设计修复或重建数据库。

当前数据策略是可重建优先：公开知识从仓库重新 ingest，短期会话和交互分析按既定保留期处理，不把原始对话复制到临时备份。是否启用腾讯云快照或独立加密备份，需要在首轮真实恢复演练后单独决定。
