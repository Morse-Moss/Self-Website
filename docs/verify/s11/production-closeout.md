# S11 腾讯云生产部署 Closeout

## Outcome

- 日期：2026-07-18 首发；2026-07-22 OpenAI-compatible API 管理更新
- 模式：`STAGED / CRITICAL / DEPLOYED`
- 状态：`PRODUCTION_OBSERVED / LIMITED_LAUNCH`
- 公网入口：`https://aimorse.tech`
- 当前应用 release：`68c114c`
- 实例：腾讯云 Lighthouse 首尔 `lhins-0oly57x8`，公网 `43.133.68.202`

## Release And Runtime

- `/opt/revolution/current` 指向 `/opt/revolution/releases/68c114c/revolution`；Web、Worker 与 Edge 的 Compose working directory 均指向该冻结 release。
- `db`、`embedding`、`web` 为 healthy；`worker` 与 `edge` 为 running。
- PostgreSQL 16 + pgvector 使用 TLS 和独立 admin/runtime/migration/ingest/backup 凭据。
- migration 001/002/003/004 与 checksum 复验通过；AI 配置 grants 和专用 SQL 权限门禁通过，migration 角色不再拥有超级用户权限。
- 公开知识共 40 documents / 47 chunks；本轮生产摄取为 0 document 更新、0 chunk 更新、40 documents 跳过。
- 首个生产邀请码已创建，但邀请码明文、管理员凭据、TOTP、Provider key、数据库密码和私钥不进入本证据或 Git。

## Public Observation

- `GET https://aimorse.tech/api/health/live` -> `200 {"ok":true}`。
- `GET https://aimorse.tech/api/health/ready` -> `200 {"ok":true}`。
- `GET https://aimorse.tech/api/health` -> HTTP 200。
- `GET https://aimorse.tech/` 与 `/works` -> HTTP 200。
- `GET https://aimorse.tech/works/content-agent/atelier-main-design-2026-07-18.jpg` -> HTTP 200。
- 自动运营 Agent、深度研究 Agent、数字摩斯与 AI 外贸获客系统正式主图 -> HTTP 200；AI 外贸获客系统图片 SHA256 与仓库文件一致。
- `http://aimorse.tech` -> 301 到主域 HTTPS。
- `https://www.aimorse.tech/works` -> 301 到 `https://aimorse.tech/works`。
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` -> `{"ok":true}`，同时验证 HSTS、frame、content-type、referrer、permissions policy 和无 `X-Powered-By`。
- `GET https://aimorse.tech/admin` -> HTTP 200；未登录 `GET /api/admin/invites` -> HTTP 401。
- `GET https://aimorse.tech/admin/api` -> HTTP 200；未登录 `GET /api/admin/providers`、`/runtime` 与 `/events` -> HTTP 401。
- 生产管理员脚本包含管理密码与邀请码入口，不含动态验证码、`totpCode` 或 `inviteTotpCode`。
- 受控真实 Provider smoke -> HTTP 200、4 个 delta、消息额度 30 -> 29；不保存原始 prompt、回答、header 或 key。
- 三节点容灾发布使用 `gpt-5.6-terra`、Responses 和 high reasoning；切流前主节点、强制一级接管、强制二级接管均通过，切流后运行 Web 容器主节点复验通过。共 4 次真实调用，均有正文、完整终态和 usage；不保存正文、原始 payload、header 或 key。
- 生产 BGE + pgvector 的 46 条 gold 为 top-1 36/46、top-3 46/46；最低正例 `0.553473`、最高负例 `0.426972`，正负阈值均通过。
- 首页 Warp Tunnel 已在生产域名完成 1440x900、390x844 与 reduced-motion 观察；`release:smoke`、live/ready 均通过，Web/Worker/Edge 近期错误关键词计数为 0。

## Browser Observation

- 首页：1440x900 与 390x844 均无横向溢出，console error 为 0。
- 作品页：1440x900 与 390x844 均无横向溢出，console error 为 0。
- 内容创作 Agent 正式图片在双宽均加载完成；从项目 CTA 进入、输入邀请码后，预填问题保留在输入框且未自动发送。
- AI 外贸获客系统在 1440x900 与 390x844 均完成主图加载、展开详情、CTA 预填、零横向溢出和 console/page error 0 的生产浏览器检查。
- 桌面和移动首屏未观察到控件重叠或不可读文字。
- 生产域名 Lighthouse 13.4.0：移动端 Performance 99；桌面端 Performance 99，FCP 0.2s、LCP 0.6s、TBT 70ms、CLS 0、Speed Index 1.0s。

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
- `d3f8d77`：发布自动运营作品集模块，并将四项目页面、详情和知识集合纳入同一冻结 release。
- `d83b46f`：修正自动运营主题拆分后的 RAG gold 漂移；生产 BGE + pgvector 评测达到 top-3 36/36。
- `c3f1ec6`：吸收管理员邀请码管理与密码登录简化；生产 `/admin` 和邀请码 API 已更新，动态验证码字段退出生产脚本。
- `c90d153`：发布 AI 外贸获客系统页面、真实 Graphite 主图、五段详情与六主题公开知识。
- `ff03c1d`：将歧义的销售流程问法从聚合文档 gold 调整为已验证的技术栈聚合问法；生产 RAG 达到 top-3 46/46。
- `693e56b`：将五项目卡片、详情、FAQ 和公开知识的“唯一开发者”统一调整为“项目负责人”，并保留“独立完成全部技术实现”的能力口径。
- `e364f03` / `1ced025`：实现首页 Warp Tunnel 并以显式 merge commit 吸收到 `master`。
- `44ed094`：收紧 S9 网络监控，仅接受 Next.js 生成的 favicon 指纹查询，消除导航取消导致的误报，同时继续拒绝任意查询参数。
- 本轮发布前全量测试 601/601、生产构建 21 routes；完整生产 S9 连续两轮无 failures、console/page errors、外部请求或横向溢出；公网 live/ready、作品页、正式主图与 release smoke 均通过。
- `741ddad`：加入一个主节点和两个有序备用节点、Responses high reasoning、正文前切换、部分输出/主动停止保护、usage 累加与跨节点共享总超时。focused 59/59、全量 609/609、Chat eval 54/54、生产构建 21 routes；生产 migration/grants、40/40 摄取跳过、公网 live/ready/release smoke 与 Web/Worker/Edge 零重启、零错误关键词均通过。
- `299289c` / `d8d1fa2` / `68c114c`：实现、吸收并发布仅管理员可用的 OpenAI-compatible API 管理。生产应用 migration `004`、Web-only Provider 主密钥、最小 grants 和运行权限门禁；公网 `/admin/api`、未登录 401、live/ready、release smoke、零重启与零错误关键词通过。配置表尚无管理员创建的中转或模型，本轮没有读取管理员密码或调用真实 Provider。

## Residual Boundaries

- 当前为有限生产发布，不标记完整 `ONLINE_READY`。
- 仍需监控、托管备份与恢复演练、入口层速率/连接限制、真实 Bocha/Feishu smoke、依赖 advisory 处置及更多国内网络可达性复核。本次生产 `npm ci` 报告 1 个 moderate、2 个 high，未执行自动修复。
- 线上 Web release 只来自冻结提交，没有复制本地脏工作区。五项目页面、正式主图和 40 documents / 47 chunks 公开知识已进入生产。
- 历史三节点发布曾调用真实 Chat Provider 4 次；本次 API 管理发布未调用任何真实 Provider，未读取管理员密码，未创建或切换数据库 Provider 配置，也未清理旧 release 或持久卷。认证后的管理操作仍需管理员显式验收，公开 adapter smoke 不替代该证据。
