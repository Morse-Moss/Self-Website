# S11 腾讯云生产部署 Closeout

## Outcome

- 日期：2026-07-18 首发；2026-07-19 内容发布更新
- 模式：`STAGED / CRITICAL / DEPLOYED`
- 状态：`PRODUCTION_OBSERVED / LIMITED_LAUNCH`
- 公网入口：`https://aimorse.tech`
- 运行修订：`b15be68`
- 实例：腾讯云 Lighthouse 首尔 `lhins-0oly57x8`，公网 `43.133.68.202`

## Release And Runtime

- `/opt/revolution/current` 指向 `/opt/revolution/releases/b15be68/revolution`；`39849e1` 与 `b8d6d88` release 继续保留。
- `db`、`embedding`、`web` 为 healthy；`worker` 与 `edge` 为 running。
- PostgreSQL 16 + pgvector 使用 TLS 和独立 admin/runtime/migration/ingest/backup 凭据。
- migration 001/002 首次执行和幂等复验通过；grants 完成后 migration 角色不再拥有超级用户权限。
- 内容发布后公开知识共 15 documents；`b15be68` 最终 ingest 为 0 document 更新、0 chunk 更新、15 documents 跳过。
- 首个生产邀请码已创建，但邀请码明文、管理员凭据、TOTP、Provider key、数据库密码和私钥不进入本证据或 Git。

## Public Observation

- `GET https://aimorse.tech/api/health/live` -> `200 {"ok":true}`。
- `GET https://aimorse.tech/api/health/ready` -> `200 {"ok":true}`。
- `GET https://aimorse.tech/api/health` -> HTTP 200。
- `GET https://aimorse.tech/` 与 `/works` -> HTTP 200。
- `GET https://aimorse.tech/works/content-agent/atelier-main-design-2026-07-18.jpg` -> HTTP 200。
- `http://aimorse.tech` -> 301 到主域 HTTPS。
- `https://www.aimorse.tech/works` -> 301 到 `https://aimorse.tech/works`。
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` -> `{"ok":true}`，同时验证 HSTS、frame、content-type、referrer、permissions policy 和无 `X-Powered-By`。
- 受控真实 Provider smoke -> HTTP 200、4 个 delta、消息额度 30 -> 29；不保存原始 prompt、回答、header 或 key。

## Browser Observation

- 首页：1440x900 与 390x844 均无横向溢出，console error 为 0。
- 作品页：1440x900 与 390x844 均无横向溢出，console error 为 0。
- 内容创作 Agent 正式图片在双宽均加载完成；从项目 CTA 进入、输入邀请码后，预填问题保留在输入框且未自动发送。
- 桌面和移动首屏未观察到控件重叠或不可读文字。
- 生产域名 Lighthouse 未复测：本机没有 Lighthouse 可执行文件，离线 npm 缓存也不可用；依赖安装不在本阶段授权内。

## Network And Security

- 腾讯云入站允许 TCP `22/80/443` 与 ICMP；UFW 允许 `22/80/443`。
- PostgreSQL `5432`、Embedding `18091` 和 Next.js `3000` 只在 Docker 内部网络可见。
- 公网根页面响应已验证 CSP、HSTS、Permissions Policy、Referrer Policy、X-Content-Type-Options 和 X-Frame-Options。
- Password SSH authentication 已关闭；root 没有 authorized key。`PermitRootLogin` 仍是系统默认 `yes`，当前没有有效 root 登录通道，后续可在独立 SSH hardening 变更中改为 `no` 并完成防锁出演练。
- 2026-07-18 生产验收的 15 分钟日志窗口内，五个运行容器的 `error|exception|panic|fatal` 关键词计数均为 0。
- 敏感凭据只保存在受限本机凭据文件和服务器受限配置，不进入仓库、镜像说明或本证据。

## Deployment Fixes

- `d486b20`：强制生产 shell 脚本使用 LF，修复 Linux 容器中的 CRLF 启动失败。
- `6c1af6c`：数据库 Secret 设为 PostgreSQL UID/GID 999、权限 0600。
- `39849e1`：pgvector schema 创建只由 migration 管理，init 脚本只管理数据库角色。
- `b8d6d88`：发布内容创作 Agent 简介、黑金设计图和六主题公开知识。
- `b15be68`：收紧公开证据口径，并用 `pendingPromptRef` 修复 CTA 在邀请码授权期间丢失预填问题的竞态。
- 部署前 S11 生产合同 10/10、migration 集成 13/13；`b15be68` 独立归档全量测试 557/557、定向测试 48/48、生产构建 19 routes 与敏感信息扫描均通过。

## Residual Boundaries

- 当前为有限生产发布，不标记完整 `ONLINE_READY`。
- 仍需生产 Lighthouse `>= 90`、监控、托管备份与恢复演练、入口层速率/连接限制、真实 Bocha/Feishu smoke 和 moderate dependency advisory 处置。
- 线上 release 只来自冻结提交，没有复制本地脏工作区。生产运行 `b15be68`，本地 `master` 与 `origin/master` 均包含该修订；本地 `master` 另含尚未 push/部署的数字摩斯提交 `7c4c2a0`，其余工作区改动也未纳入生产。
- `b15be68` 已 push；未创建 PR，未清理旧 release、上传包或持久卷。
