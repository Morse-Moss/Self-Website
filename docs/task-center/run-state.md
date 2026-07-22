# 正式站 v1 · Task Center(唯一运行事实源)

> Goal:在已通过的 S9/S10 作品集与数字摩斯系统上完成可观察、可回滚的腾讯云生产发布。
> 启动:2026-07-08 · S10 启动:2026-07-15 · 执行授权只以当前阶段合同为准,不继承历史阶段授权 · 模式:Morse 开发模式 + morse-goal

## current_pointer
**CHAT_V2_DISABLED_FIRST_PRODUCTION_OBSERVED / LIMITED_LAUNCH**

## next_allowed_pointer
当前生产实例运行 `e56e457`。Chat v2 已按 disabled-first 发布：服务端总开关开启、canary 0%、白名单为空、hedging 与 safe mode 均关闭；生产 `v2_sessions=0`、`chat_provider_attempts=0`，本轮未调用真实 Provider。私密简历保持 `MORSE_RESUME_ENABLED=true`，当前加密文档仍在，未授权文件接口保持 401。下一步只有在单独授权调用数、成本、评审数据和邀请码后，才可创建专用 canary 并开始真实 Provider 20 轮评审；25%、100% 和 24/48 小时观察仍是后续独立门槛。生产硬化余项关闭前不得宣称完整 `ONLINE_READY`。

## Chat v2 disabled-first production release (2026-07-22)

- Mode: `DIRECT / CRITICAL / DEPLOYED`; status: `PRODUCTION_OBSERVED / DISABLED_FIRST / LIMITED_LAUNCH`。
- Release: `e56e457` 已进入 `origin/master` 与 `origin/codex/chat-v2-release`；冻结归档 SHA-256 为 `6d7c3e2166cf364076c2347232056d9309a6c9e12a2231766501fd29502f5b16`。`/opt/revolution/current` 指向 `/opt/revolution/releases/e56e457/revolution`。
- Data/Security: migration 005/006 已应用，registry 为 001–006；grants、AI 配置与私密简历权限门禁通过，migration 角色为非超级用户。迁移前数据库备份 SHA-256 为 `bace5c1b7e94df94542c0e686e885d9dcd50549a4162f7dff16fa784daf998b7`；旧 release、私有卷与 Secrets 保留。
- Verification: 生产构建 30 routes；公网 live/ready/health/root/works/admin/admin-api 均为 200，未登录管理 API 与简历文件为 401，release smoke PASS。知识摄取为 0 更新、40 documents 跳过；Web/Worker/Edge 重启计数与发布后错误关键词计数均为 0。
- Boundary: `v2_sessions=0`、`chat_provider_attempts=0`；未创建评审邀请码、未登录管理员、未启动真实 Provider 20 轮评审、未读取或回显密钥及私密简历内容。

## Digital Morse cover refresh production release (2026-07-22)

- Mode: `DIRECT / CRITICAL / DEPLOYED`; status: `PRODUCTION_OBSERVED / LIMITED_LAUNCH`。
- Release: `6ef4ace` 已进入 `origin/master`；冻结归档 SHA-256 为 `eab327014cbebf94ea9dab6763dec217fae7ae182471332924f55a83c8ed0744`。`/opt/revolution/current` 及 Web、Worker、Edge working directory 均指向 `/opt/revolution/releases/6ef4ace/revolution`，旧 release `d23b5df` 保留。
- Scope: README 首页图与作品集图使用用户确认的两张截图；`/works#digital-morse` 封面使用同一张首页图，公开资源为 `digital-morse-home-2026-07-22.png`。验收脚本改为只校验封面尺寸，不再自动覆盖公开素材。
- Verification: 定向内容与资源测试 `21/21`；本地及生产构建均生成 30 个路由。公网 root、works、live、ready 均为 HTTP 200，release smoke PASS；线上封面为 1381x770、229100 bytes，SHA-256 为 `67241A27EC93DE7BAB5E87AFEF9BE5A4CFC89AC0E4462DC53694932F8C73F3B3`，与用户原图一致。1440x900 与 390x844 作品页均无横向溢出、console/page/HTTP error。
- Data/Boundary: migration `004` 幂等通过，grants 复验通过，知识摄取为 0 更新、40 documents 跳过。未读取或改写简历密文、邀请码、管理员密码、Provider 配置或密钥，未调用 Chat、Search、Bocha、Feishu 或其他真实 Provider。

## Private resume activation and final PDF rollout (2026-07-22)

- Mode: `STAGED / CRITICAL / DEPLOYED`; status: `OBSERVED / FEATURE_ENABLED / LIMITED_LAUNCH`。
- Release: 当前应用 release 保持 `292a24b`，本轮未发布新代码或镜像。仅将受限生产环境文件中的 `MORSE_RESUME_ENABLED` 从 `false` 原子切换为 `true`，随后强制重建 Web/Worker 以加载配置；DB、Embedding 与 Edge 未重建。
- Data/Security: 经确认的定向版最终 PDF 仅通过认证 `/admin` 上传并进入私有密文卷；通用版简历未触碰，PDF 未进入 Git、`public/`、RAG、日志、截图或验收文档。一次性上线验收码在独立 HTTP 会话中兑换，验收完成后立即停用，关联 Session 再次访问状态与文件均为 401。
- Verification: 公网 live/ready 均为 HTTP 200，`release:smoke` 返回 `{"ok":true}`；公开“简历模式”显示邀请码表单。未授权 `/api/resume/access` 返回 401 与 `enabled=true`、`authorized=false`、`documentAvailable=true`，未授权 `/api/resume/file` 返回 401。授权文件返回 HTTP 200、299,762 bytes，SHA-256 与本地最终 PDF 一致，且保持 `application/pdf`、`private, no-store`、`nosniff` 与内联 disposition。Web、Worker、Edge 最近 10 分钟错误关键词计数均为 0。
- Recovery: 启用前环境备份为 `/opt/revolution/shared/.env.production.bak-resume-20260722T065827Z`。异常时将 `MORSE_RESUME_ENABLED=false` 写回受限环境文件并强制重建 Web/Worker；保留 migration `003`、私有卷、Secret、密文和审计记录。
- Boundary: 未轮换密钥、未删除私密数据或旧 release、未调用 Chat/Search/Embedding/Bocha/Feishu Provider，未保留可继续访问的验收邀请码。后续真实访客邀请码由管理员按人创建、传递和停用。

## Admin API management production release (2026-07-22)

- Mode: `STAGED / CRITICAL / DEPLOYED`; status: `OBSERVED / LIMITED_LAUNCH`。
- Release: 功能提交 `299289c` 由 merge commit `d8d1fa2` 吸收到 `master`，来源显示修复 `292a24b` 同步到 `origin/master` 与 `origin/codex/admin-api-management`；冻结归档 SHA-256 为 `f3ad7526d74f4eeb072ca7e6abc44b562bc3f90f32bd16658ec6695efd4b1af9`。`/opt/revolution/current` 及 Web、Worker、Edge working directory 均指向 `/opt/revolution/releases/292a24b/revolution`。
- Data/Security: migration `001`-`004` checksum 通过，`004` 为 `4003b42c5b240fc0d56cb05ae7a6b32dcb83cdcd62316644072fc319dfe2f17a`；runtime AI 配置权限门禁 PASS，migration 角色保持非超级用户。Provider 主密钥为 `0600 / 1001:1001`，只挂载给 Web；Worker、Migration、Ingest 与 Edge 均不可见。配置行数为 connections `0`、models `0`、route revisions `0`、runtime state `1`、events `0`。
- Verification: 本地全量 `769/769`、生产构建 30 个静态/动态页面与 API 路由；本地认证态 1440x900 与 390x844 浏览器证据确认中转主机名可见、无溢出且零 console/page error/外部请求。生产 migration 幂等，AI runtime 权限门禁通过，连续两次 ingest 均为 0 更新、40 documents 跳过。公网 live/ready、root、works、admin、`/admin/api` 均为 HTTP 200，三个未登录 Provider 管理读 API 均为 401，release smoke PASS；Web、Worker、Edge、DB restart count 均为 0，发布后错误关键词计数均为 0。
- Recovery: migration 前数据库备份为 `/opt/revolution/shared/backups/pre-68c114c-20260722T014946Z.dump`，SHA-256 `5069ee6c3c8c7888a16b455cb8c91ef0d274f6ba32fd258c805963d129597675`；生产环境文件另有受限备份。旧 releases、数据库备份和持久卷保留。
- Boundary: 未读取生产管理员密码，未创建、测试、发现、激活或删除数据库 Provider 配置，未调用 Chat/Bocha/Feishu，未启用私密简历，未清理旧 release 或持久卷。认证后的管理流程保留为管理员显式验收。

## Private resume disabled-first production release (2026-07-21)

- Mode: `STAGED / CRITICAL / DEPLOYED`; status: `OBSERVED / FEATURE_DISABLED / LIMITED_LAUNCH`。
- Release: `233a3a5` 已进入 `origin/master`，归档 SHA-256 为 `580651def3c19bc66ca8e7f215ba9ea4f0dfcdcb585b9c8482e0a331f158df7e`；`/opt/revolution/current` 及 Web、Worker、Edge working directory 均指向 `/opt/revolution/releases/233a3a5/revolution`。知识收口提交晚于运行 release，不改变生产镜像。
- Data/Security: migration `003` checksum 与仓库一致，runtime grants PASS，migration `rolsuper=false`，四张私密表总行数 0；Web 可读取文件型 Secret，Worker 不挂载 Secret，私有卷为 `0700` / `1001:1001`。
- Verification: 生产构建 25 routes；live/ready/root/works/admin 均为 HTTP 200，release smoke PASS，`/api/resume/file` 为 404，访问状态为 `enabled=false`。1440x900、390x844 与 reduced-motion 浏览器回归无 failure、console/page error、外部运行时请求或横向溢出，五个项目均可展开。
- Recovery: migration 前备份为 `/opt/revolution/shared/backups/pre-75f621a-20260721T101836Z.dump`，SHA-256 `488b4af882e679cbb434cf86d31cbb3c34b9d4e7e20909d01de06a982333f588`；旧 releases、数据库备份和持久卷保留。
- Boundary: 未启用简历、未上传真实 PDF、未创建/兑换真实简历邀请码、未轮换密钥、未清理旧 release 或私密数据。

## Three-node Chat Provider production release (2026-07-20)

- Mode: `DIRECT / CRITICAL / DEPLOYED`; status: `OBSERVED / LIMITED_LAUNCH`。
- Release: `741ddad` 已进入 `origin/master`，并从该精确 Git 提交归档到 `/opt/revolution/releases/741ddad/revolution`；`/opt/revolution/current` 及 Web、Worker、Edge working directory 均指向该 release，旧 release 与持久卷保留。
- Runtime: `gpt-5.6-terra`、Responses、high reasoning；主节点为 `sub.exellome.online`，备用 1 为 `worldclawpro.ai`，备用 2 为 `ai.sandongs.com`。节点只在零正文时切换，部分输出和访客停止均不切换；Embedding 保持独立。
- Verification: focused 59/59、全量 609/609、`npm run chat:eval` 54/54 且 external calls 0、生产构建 21 routes。切流前主节点、强制主节点失败、强制前两节点失败三种真实调用均 PASS；切流后运行 Web 容器主节点复验 PASS，共 4 次调用，均有正文、完整终态和 usage，未保存回答正文或原始 payload。
- Production: migration 001/002、grants、摄取 0 更新/40 documents 跳过；公网 live/ready/health、首页、作品页和 release smoke 均通过。Web、Worker、Edge restart count 均为 0，近 15 分钟错误关键词计数均为 0。
- Boundary: 未创建生产邀请码明文，未调用 Bocha/Feishu，未清理旧 release 或持久卷；完整邀请码到 SSE/DB 的浏览器对话未在本轮重新创建。

## Homepage Warp Tunnel production release (2026-07-20)

- Mode: `STAGED / CRITICAL / DEPLOYED`; status: `PRODUCTION_OBSERVED / LIMITED_LAUNCH`。
- Release: `e364f03` 由 merge commit `1ced025` 吸收到 `master`，S9 favicon 竞态修复为 `44ed094`；本地与 `origin/master` 均对齐，`/opt/revolution/current` 及 Web、Worker、Edge working directory 均指向 `/opt/revolution/releases/44ed094/revolution`。
- Verification: `npm test` 601/601，`npm run build` 21 routes；完整生产 S9 连续两轮无 failures、console/page errors、外部请求或横向溢出；生产 Lighthouse 13.4.0 移动端与桌面端 Performance 均为 99。
- Production: migration 001/002、grants 与 ingest 通过，0 更新、40 documents 跳过；live/ready、release smoke 通过，Web/Worker/Edge 近期错误关键词计数为 0。
- Boundary: 未调用真实 Chat、Bocha 或 Feishu Provider；未清理旧 release 或持久卷；监控、托管备份与恢复、edge 流量限制、moderate advisory 和更多国内网络可达性仍待完成。

## Project owner copy local increment (2026-07-19)

- Mode: `STAGED / CRITICAL / DEPLOYED`; status: `PRODUCTION_OBSERVED / LIMITED_LAUNCH`。
- Scope: 五项目卡片状态、展开详情、FAQ、公开知识、待终审草稿、当前蓝图、验收文档和浏览器合同；统一用“项目负责人”，技术归属继续明确为“独立完成全部技术实现”。
- Verification: failure-first 内容合同已验证；`npm test` 595/595、`npm run build` 21 routes、`npm run chat:eval` 54/54。1440x900 与 390x844 真实渲染均显示 5 个新状态，旧称呼不可见，横向溢出、console error 和 page error 均为 0。
- Production release（该里程碑）: `693e56b` 已进入 `origin/master`，并从 Git 冻结归档部署；当时 `/opt/revolution/current` 及 Web、Worker、Edge 标签均指向 `/opt/revolution/releases/693e56b/revolution`。
- Production knowledge: 首轮摄取更新 10 documents / 16 chunks，第二轮 40/40 全量跳过；生产总量 40 documents / 47 chunks，46 条 RAG gold top-1 36/46、top-3 46/46，正负阈值通过。
- Public observation: 五个新状态全部可见，旧称呼不可见；1440x900 与 390x844 横向溢出、console error、page error 均为 0，live/ready、`/works` 和 release smoke 通过。
- Boundary: 未调用真实 Chat、Bocha、Feishu、Alibaba Mail、SMTP/IMAP Provider；未删除旧 release 或持久卷。

## AI leadgen portfolio production release (2026-07-19)

- Mode: `STAGED / CRITICAL / DEPLOYED`; status: `OBSERVED / LIMITED_LAUNCH`。
- Scope: `/works#ai-leadgen`、`content/site-content.json` 中的项目与六个知识主题、公开知识 Hash 路由、RAG/Chat 评测、真实 Graphite 主图和双宽浏览器 smoke。
- Release: `c90d153` 发布五项目页面与知识，`ff03c1d` 修正 AI leadgen 聚合问法的 RAG gold，`693e56b` 统一五项目负责人称呼并成为该里程碑生产 release；当前生产版本见 `current_pointer`。
- Verification: `npm test` 595/595、`npm run build` 21 个路由、`npm run chat:eval` 54/54；公网 live/ready、`/works`、正式主图与 release smoke 均通过，主图 SHA256 与仓库一致。当前生产 RAG 为 top-1 36/46、top-3 46/46，正负阈值均通过。
- Data: 首轮生产摄取新增 8 documents / 9 chunks，重复摄取与 `ff03c1d` 发布后的两轮摄取均为 0 更新、40 documents 跳过；生产总量为 40 documents / 47 chunks，migration 保持 001/002。
- Boundary: 主图按确认原图使用；未调用 Chat、Bocha、飞书、阿里邮箱、SMTP/IMAP 或其他真实 Provider。作品集与知识上线不等于 `E:\Two` 源系统已生产部署，也不构成规模化获客成果。
- Contract and evidence: `docs/superpowers/specs/2026-07-19-ai-leadgen-works-content-design.md`、`docs/superpowers/plans/2026-07-19-ai-leadgen-portfolio.md`、`docs/verify/ai-leadgen/ai-leadgen-closeout.md`。

## S11-5D admin invite production release (2026-07-19)

- Mode: `STAGED / CRITICAL / DEPLOYED`；状态：`OBSERVED / LIMITED_LAUNCH`。
- Release: `c3f1ec6` 吸收 `50a7663`、`48d13b9` 与 `7f165a6` 后进入 `origin/master`，并从 `git archive` 冻结包发布；功能切换时 `/opt/revolution/current` 指向 `/opt/revolution/releases/c3f1ec6/revolution`，未复制根工作区脏改动。
- Runtime PASS: migration 仍为 001/002，grants 成功，ingest 为 0 documents / 0 chunks 更新、33 documents 跳过；DB、Embedding、Web healthy，Worker 与 Caddy running。
- Verification PASS: 本地 PostgreSQL 全量测试 589/589、0 fail、0 skip；本地与服务器生产构建均生成 20 routes；合并后 Mock E2E 20/20，1440x900 与 390x844 的 9 张截图已人工检查，console/page error 为 0。
- Public Observation PASS: `/admin` HTTP 200，`/api/admin/invites` 未登录 401，生产 HTML/9 个脚本包含管理密码与邀请码入口且不含动态验证码、`totpCode` 或 `inviteTotpCode`；live/ready 与 release smoke 通过，Web/Worker/Caddy 发布后 3 分钟日志的错误关键词计数均为 0。
- Security Boundary: 未读取或输出生产管理员密码、Provider key、数据库密码或私钥；未创建生产邀请码明文，未调用真实 Chat/Bocha/Feishu。认证后的邀请码创建、兑换、用量更新和停用仍需管理员按 runbook 完成。
- Knowledge reconciliation: README、`CLAUDE.md`、蓝图、两份生产 runbook、本运行状态与 S10/S11 证据按真实发布状态同步；Codex durable memory 未获用户授权，不更新。

## S11-5C production content release (2026-07-19)

- Mode: `STAGED / CRITICAL / DEPLOYED`；状态：`OBSERVED / LIMITED_LAUNCH`。
- Release: `/opt/revolution/current` 指向 `/opt/revolution/releases/d83b46f/revolution`。Web、Worker 与 Edge 均已切换；发布只使用冻结提交，没有从脏工作区复制文件。
- Content/Data PASS: 内容创作 Agent、自动运营 Agent、深度研究 Agent 与数字摩斯页面、展开详情和正式主图已进入生产。生产 RAG 为 33 documents / 39 chunks，其中四项目各 7 个稳定文档，共 28 documents / 33 chunks；第二次全量摄取为 0 document 更新、0 chunk 更新、33 documents 跳过，migration 仍为 001/002。
- Verification PASS: 生产 BGE + pgvector 的 36 条 gold 为 top-1 28/36、top-3 36/36；最低正例 `0.527623`、最高负例 `0.420975`，正负阈值均通过。公网 live/ready、作品页和四张正式主图均为 HTTP 200，release smoke 与相关容器健康。本轮未调用真实 Chat Provider。
- Runtime PASS: PostgreSQL/pgvector、CPU BGE、Next.js Web、Worker 与 Caddy 均运行；DB、Embedding、Web healthy，内部端口仍未映射公网。
- Browser PASS: 1440x900 与 390x844 均无横向溢出，正式图片加载完成，控制台 error 0；从内容创作 Agent CTA 进入、输入邀请码后，预填问题保留在输入框且未自动发送。`b8d6d88` 上的真实 Provider 对话已完整返回并展示公开来源。
- Residual（截至该里程碑）: 当时生产 Lighthouse 未复测；监控、托管备份、独立 edge 速率/连接限制、真实 Bocha/Feishu 和 moderate dependency advisory 处置仍未完成；其余工作区改动和未跟踪证据未纳入生产。
- Knowledge reconciliation: README、`CLAUDE.md`、腾讯云运行手册、本运行状态与 S11 生产证据按当前 release 同步；Codex durable memory 未获用户授权，不更新。

## S11-5B Tencent production deployment (2026-07-18, superseded by S11-5C)

- Mode: `STAGED / CRITICAL / DEPLOYED`；状态：`OBSERVED / LIMITED_LAUNCH`。
- Runtime: 腾讯云 Lighthouse 首尔实例 `lhins-0oly57x8`，公网 `43.133.68.202`；`aimorse.tech` 与 `www.aimorse.tech` 已解析并由 Caddy 提供有效 HTTPS。
- Release（截至 2026-07-18）: `/opt/revolution/current` 当时指向 commit `39849e1` 对应 release；该阶段部署提交为 `3fdd7ee`、`d486b20`、`6c1af6c`、`39849e1`，当时均在本地 `master`，未 push。
- Services PASS: PostgreSQL/pgvector、CPU BGE、Next.js Web、Worker 和 Caddy 均运行；DB、Embedding、Web healthy。migration 001/002、独立角色 grants、migration 超级用户撤销、9 documents/10 chunks ingest 与第二次全跳过均通过。
- Network PASS: 腾讯云与 UFW 已放行 TCP `22/80/443`；`5432/18091/3000` 未映射公网。公网 live/ready/health、首页和作品页均 HTTP 200；HTTP 与 `www` 正确重定向到主域 HTTPS。
- Release/Provider PASS: `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` 返回 `{"ok":true}`；受控真实 Provider smoke HTTP 200、4 个 delta、消息额度 30 -> 29。
- Browser PASS: 1440x900 与 390x844 首页/作品页无横向溢出，控制台 error 0，未观察到页面重叠；2026-07-18 生产验收的 15 分钟日志窗口内，五个容器的 error/exception/panic/fatal 关键词计数均为 0。
- Security review: 密钥仅保存在本机受限凭据文件和服务器受限配置；PasswordAuthentication 已关闭，root 无 authorized key；公网响应已验证 CSP、HSTS 与基础安全头。CRITICAL compliance 与 quality/safety 无 admitted blocker。
- Residual（截至 2026-07-18）: 当时生产 Lighthouse 未复测，监控、托管备份、独立 edge 速率/连接限制、真实 Bocha/Feishu 和 moderate dependency advisory 处置仍未完成；内容更新提交 `b8d6d88` 已进入 `origin/master`，但当时线上仍运行 `39849e1`，尚未包含新的内容创作 Agent 简介、黑金设计图和六主题知识。
- Knowledge reconciliation: README、`CLAUDE.md`、生产运行手册、腾讯云手册、本运行状态与 S11 部署证据已同步；用户正在编辑的蓝图、证据矩阵、站点内容、页面样式、测试和 `public/` 素材保持不动。

## S11-5A production foundation (2026-07-18)

- Mode: `STAGED / CRITICAL / LOCAL`；状态：`LOCAL_READY`。
- Outcome: 形成 `LOCAL_RELEASE_CANDIDATE` 应用生产基础，不绑定 Railway 或国内云厂商，不执行真实部署。
- Contract: `docs/superpowers/plans/2026-07-18-s11-5a-production-foundation.md`；架构源仍为 `docs/superpowers/specs/2026-07-18-s11-architecture-hardening-design.md`。
- Hard boundary: Node 应用镜像不冒充完整 RAG 拓扑；生产 BGE/Embedding 未部署与真实 smoke 前，系统不能进入 `ONLINE_READY`。
- Data/alert boundary: 灾备采用 migration + 公开知识重摄取 + 新邀请码的重建式恢复，不长期备份 10 天交互正文；飞书继续是至少一次投递，ack 丢失窗口可能重复。
- External boundary: 不调用真实 GPT、博查或飞书，不安装新依赖，不 push、不部署。
- Verification PASS: PostgreSQL 全量测试 `543/543`、0 fail、0 skip；生产构建 `19/19`；隔离恢复/发布冒烟完成 migration 001/002、9 documents/10 chunks、72 小时测试邀请码、live/ready/health alias HTTP 200、安全头与 retention cleanup，且未调用外部 API。密钥扫描、`git diff --check`、`docker build --check` 与临时资源清理通过。
- Review PASS: CRITICAL compliance 与 quality/safety 的 admitted blocker 均为 0。Docker context 已排除 `.env*`、`content/drafts/**`、本地规则、证据和生成物；并行全测暴露的测试库强制断连竞态已按 RED (`57P01`) / GREEN 修复。
- Residual: 长期本地主库虽登记 001/002，但两个 checksum 均与当前工作树 migration 原始字节不一致，readiness 正确 fail closed；禁止擅自改登记或重建。Windows/Linux SQL 换行与 checksum 语义尚未冻结，列为首次跨平台生产迁移前阻塞项。
- Image PASS: 用户授权后从 scoped staged tree `d7e29743d14fcee04bbba4e692a293a90570e990` 构建本地 `revolution:s11-5a-local`，镜像 ID `sha256:4535533d811f...`；Node `24.16.0`、UID `1001`、默认 Web 角色、缺配置稳定 fail closed。镜像不含 `.env*`、`content/drafts/**`、`AGENTS.md`、docs/tests/prototype，包含 `.next`、公开内容、migration、Worker、角色启动器与 server contracts；层历史密钥扫描和临时 context 清理通过。
- Vulnerability boundary: 本次 lockfile `npm ci` 审计报告 2 个 moderate、0 high/critical；未执行自动升级或 `audit fix`。具体 advisory 与升级兼容性必须在 `ONLINE_READY` 前复核，不把本地镜像构建通过等同于零漏洞。
- Knowledge reconciliation PASS: README、`CLAUDE.md`、工程准则、唯一需求源、S11 架构源、production runbook 与 Task Center 已按最终代码和证据对齐；历史阶段证据保持原口径。用户未明确要求更新 Codex durable memory，本轮未写记忆扩展。
- Delivery boundary: 本阶段只生成本地镜像与本地提交；未 push、未部署、未调用真实 GPT/博查/飞书，既有 3010 服务未重启。

## S10 admin invite local increment (2026-07-19, superseded by S11-5D)

- Mode: `DIRECT / CRITICAL / LOCAL`；状态：`LOCAL_READY / AWAITING_MAINLINE_ABSORPTION`。
- Outcome: 本地隔离分支 `codex/admin-invite-management` 以 `50a7663` 增加管理员生成、复制一次、状态列表和停用邀请码，以 `48d13b9` 将管理员操作简化为密码登录、有效 Session 内直接管理邀请码、导出时重输密码。
- Security override: 本段覆盖下方 S10 历史段落中的 TOTP 运行要求。当前管理员认证保留 scrypt、五次失败锁定、30 分钟 HttpOnly/Secure/SameSite=Strict Session、精确 Origin、访客/管理员隔离和服务端权限校验；导出密码复验与登录共享锁定状态，失败不注销仍有效的 Session。
- Verification PASS: focused 103/103、生产构建 20 routes、Mock E2E 20/20；1440x900 与 390x844 登录/邀请码工具及桌面导出弹窗已人工检查，overflow、console error、page error 均为 0。全量测试为 574 total / 512 pass / 7 fail / 55 skip，7 个失败均为进入 worktree 时已有的作品集合同/缺少本地数据库配置基线。
- Delivery boundary（当时）: 两个提交均未进入 `master`、未 push、未部署；该边界已由上方 S11-5D 的主线吸收、push 和生产观察取代。

## S10 smart customer service amendment(2026-07-15)

- Product boundary:受控个人作品集内置客服，完成自由对话、JD 匹配和需求初诊；语音、视频和长期记忆不在本轮。
- Runtime boundary:72 小时邀请码，12 小时可恢复 history；独立 interaction 表保存原始问答/搜索/来源 10 天。
- Retrieval/Search:本地 BGE + PostgreSQL/pgvector；服务端自动调用唯一 Bocha Provider，每轮最多一次/每 Session 五次；只用标题/摘要/HTTPS URL，不抓网页正文。
- Provider boundary:OpenAI-compatible 中转，协议显式选择且不自动跨协议重试；当前中转需显式兼容 User-Agent，模型使用 `/models` 当前返回的 `gpt-5.4`。最终站内 Responses 集成 PASS，usage 1747/125，成本因未配置单价保持未知。
- Admin/alerts:独立密码+TOTP 管理认证、badcase 与 JSON/CSV 导出；首次邀请码、初诊、故障恢复和安全事件写稳定-key Outbox，飞书 custom webhook 按至少一次语义发送可识别事件 key 的卡片。
- Cost/safety:无月预算硬门；保留 30 条消息、五次联网、并发、超时、限流、kill switch 和 usage 统计。
- Contract:`docs/task-center/s10-smart-customer-service.md`;design/plan 位于 `docs/superpowers/{specs,plans}/2026-07-15-s10-smart-customer-service*.md`。

### S10-CX-1 chat UX and relay recovery(2026-07-18)

- Root cause:对话 UI 的 Markdown 与来源身份问题已在 2026-07-17 关闭；后续真实故障来自 OpenAI-compatible 中转间歇性返回零正文完成、仅终止文本事件或 502。旧适配只重试 `response.incomplete`，会把零正文 `response.completed` 当成功交给服务层，再被补偿为 `PROVIDER_INCOMPLETE`；非流式同请求实测 502，不能作为可靠 fallback。
- Code PASS:保留结构化 Markdown、默认问题直发、思考态和具名来源；聊天区扩大，正文依据与底部来源统一为当前页资料静态显示、项目与联网资料新标签打开，不改变原对话 URL、消息或 transcript 滚动位置。Responses 在没有 delta 时可从 `response.output_text.done` 恢复正文。尚未输出正文时，空完成/incomplete 和 408/409/429/5xx 在共享总超时内最多 3 次总尝试；永久 4xx、`response.failed/error`、超时和部分正文均不重试。空完成或 incomplete 如返回 usage，会与最终成功轮次累加，避免中转重试成本漏记。
- Real Provider PASS:生产构建真实 turn `e9d03006-2cbd-40dd-a31c-1cd65c6b6e45` 使用 `gpt-5.4`，SSE 到 `done`，数据库 `completed`、19362ms、usage 5766/102；数据库保留 5 个检索来源，页面正文 174 字并只显示 1 个实际引用的具名来源，重试按钮消失，Provider incident 为 `recovered`。
- Real browser PASS:用户授权后通过 3010 正式页面完成三个 `gpt-5.4` turn：`45d91a62-38b9-4505-9a80-5e7b563a2cb2` 为 `completed`/10165ms，`3023fc9a-af03-45e0-91c6-3994022a1fc5` 为 `completed`/16633ms，重启当前构建后 `389f9ccd-9f42-451f-a641-050bad5f1106` 为 `completed`/15706ms、5 个检索来源；三次均无错误、额度 30→29、`used_search=false`。最新页面实测候选 3→0、思考态出现、URL/消息与 transcript 保持连续。中转未返回 usage，成本保持未知。
- Verification PASS:Provider/流链 focused 40/40；更新后的 `visual:s10` 19/19、1440/390、四张截图、0 console/page error 且命令自行退出；加载 `.env.local` 的 PostgreSQL 全量测试 517/517、0 fail、0 skip；生产构建 17/17；`/api/health` 为 HTTP 200、database ready、10 chunks、Provider configured。测试浏览器按主 PID 与专属 profile 双层清理，Windows `EACCES` 仅在有界窗口内重试。
- Delivery boundary:改动与本条知识同步在本地 `master` 收口，未 push、未部署；`.env.local` 受 ignore 保护且不含 Provider Key。

### S10-CS-6 UI/eval verification evidence(2026-07-17)

- Implementation PASS:访客自由对话、JD 匹配、需求初诊、真实停止、原位 retry、12 小时 history、阶段状态和站内/联网来源分组完成；`/admin` 使用独立 route shell，具备登录、筛选、分页、详情、badcase 与 fresh-TOTP JSON/CSV 导出，公共导航无 Admin 入口。
- Evaluation PASS:`chat:eval` 53/53 且 externalCalls 0；本地 CPU BGE 重摄取 9 documents/10 chunks、第二次 9/9 skip，20 正例/10 负例为 top1 18/20、top3 20/20，最低正例 0.460884、最高负例 0.420975，0.45 正负阈值均通过。
- Runtime/build PASS:隔离 production server + Mock OpenAI/Bocha 的直接 API 主链通过邀请码、站内回答、搜索失败降级、搜索恢复、6 条 history 和 Admin 登录/列表/详情/badcase/CSV 导出；生产 build 17/17，`git diff --check`、`.env.local` 忽略和密钥扫描通过。
- Review correction:CRITICAL quality/safety 审查发现 browser harness 在移动授权验收前提前过期访客 Session，且移动截图落在过期页；已改为授权态截图后再过期，Admin 同样在全屏详情态截图，新顺序合同 8/8 PASS。
- Browser PASS:`visual:s10` 在隔离 production + Mock OpenAI/Bocha + disposable pgvector 环境通过 17/17；四张授权态 1440/390 截图已生成，overflow、console error、page error 均为 0。内置浏览器实页复验双宽与三 workflow 通过；Admin 授权态由正式 harness 的生成凭据覆盖。
- Review PASS:CRITICAL compliance 将 Admin CSV 从证据目录迁到受控系统临时目录并在 `finally` 清理，两份空 ignored E2E 日志亦精确删除；quality/safety 复核覆盖 stop compensation、前台截图、selection 清理、Admin badcase 成功态与 Session 过期顺序，开放 blocker 为 0。
- Provider boundary:第 3 次且最后一次真实 GPT 集成 smoke 在关闭搜索后仍于 interaction 预留前失败；无 Provider HTTP/延迟/usage 证据，无伪造回答，记为 `BLOCKED_CONFIG`。三次 Provider 预算已耗尽；真实博查和飞书未调用。
- Final PostgreSQL/RAG PASS:既有 `revolution-pgvector` 恢复为 healthy 并监听 `127.0.0.1:55432`；显式本地 `DATABASE_URL` 下 `npm test` 为 491/491、0 fail、0 skip。`rag:eval` 使用 loopback CPU `BAAI/bge-small-zh-v1.5` 取得 top1 18/20、top3 20/20，最低正例 0.460884、最高负例 0.420975，0.45 正负阈值均通过。
- Cleanup/git:正式 harness 的 Next、Mock、浏览器、下载目录与 disposable 数据库均已清理；用户验收用 3010 首页在本地提交后重启。`.env.local` 未读取、未修改且受 ignore 保护；S10 精确本地提交，不 push、不部署。

### S10-CS-7 real Provider/mainline evidence(2026-07-17)

- Real Provider PASS:用户重新授权后，在隔离端口、搜索关闭、本地 BGE + 项目 pgvector 环境执行 1 次真实 `gpt-5.4-mini` Responses 全链调用；HTTP 200、SSE 到 `done`、5 个站内来源、消息额度 30→29。
- Persistence PASS:interaction `8fe61666-4d6f-4cdd-b5ae-ec6f3567a19f` 为 `completed`，provider/model 为 `openai/gpt-5.4-mini`，延迟 9872ms，`used_search=false`。中转未返回 input/output token usage，因此 usage 与成本保持空值，不伪造为 0。
- Quality observation:回答带有效来源标记且没有越过公开知识边界，但没有遵守“一句话”长度要求；该样本作为真实 badcase 观察点，不把传输成功等同于回答质量完全通过。
- Health correction:`/api/health` 原先把 Provider readiness 与可选价格环境变量绑定；失败测试证明误判后拆分为 `provider.configured` 与 `provider.costConfigured`。
- Delivery boundary:merge commit `e0a53f2` 已将 S10 吸收到本地 `master`；未授权 push、PR、部署。真实博查与飞书仍未调用。

### S10-CS-8 Provider compatibility repair(2026-07-17)

- Root cause:运行进程曾继承错误项目 Key；使用本站 Key 后，默认 OpenAI Node SDK 请求仍被中转 WAF 403。浏览器式受控 User-Agent 的 `/models` 返回 200；修复时目录快照为 12 个模型且不含 `gpt-5.4-mini`，收口前实时复查已变为 17 个并重新包含 `gpt-5.4-mini` 与 `gpt-5.4`，证明目录数量和成员不可作为持久配置。
- Code PASS:新增可选 `OPENAI_COMPAT_USER_AGENT`，只注入远程聊天客户端；单行、最多 256 字符并拒绝控制字符，Embedding 本地客户端不受影响。协议仍显式为 Responses，不新增隐式重试或跨协议 fallback。
- Real Provider PASS:最终直连站内 turn `b8b3ec78-380d-4211-9baa-9633f1847d75` 走短期码、本地 BGE、pgvector、5 个 RAG 来源、`gpt-5.4` Responses 和 SSE；480 字回答带引用并到达 `done`，数据库 `completed`、12546ms、usage 1779/297、`used_search=false`。诊断代理已移除，最终运行态直连中转。
- Verification PASS:focused 24/24；全量 493/493、0 fail、0 skip；生产构建 17/17；费用单价未配置，成本保持未知。真实博查/飞书未调用，未 push、未部署。

### S10-CS-5 admin/alerts evidence(2026-07-16)

- Auth PASS:Admin 与访客 cookie/API 物理隔离；scrypt、RFC 6238 TOTP 正负一窗、全局 counter 并发防重放、锁定与事务安全事件完成。浏览器使用 Session cookie，数据库以最后活动时间执行 30 分钟 idle TTL；写操作和导出精确检查 Origin。
- Admin PASS:10 天边界、未来记录排除、workflow/status/search/badcase/时间筛选、稳定分页、详情与 badcase 完成；JSON/CSV 只输出白名单字段，CSV 含 UTF-8 BOM、RFC 4180 转义与公式注入防护，无临时文件；导出消耗一个未使用 TOTP。
- Alert PASS:首次邀请码、初诊、邀请码 abuse、管理员锁定、Provider/Search 三连故障与恢复均通过事务 Outbox；security key 统一为 `security:<category>:<fingerprint>:<window>`。飞书按官方 `code === 0` 判断成功，输出只含白名单字段和稳定事件标识的 `interactive` 卡片；HTTP 200 业务错误、畸形 JSON、timeout、lease/reclaim 与 bounded retry 均通过 Mock。
- Delivery boundary:稳定 key 保证业务重试不重复入队；非幂等 custom webhook 是至少一次投递，远端已收但本地提交未知时可能重复。严格恰好一次需支持服务端幂等键的应用消息接口或中介，S10 未伪造该能力。
- Verification PASS:Task 5 affected 130/130；`DATABASE_URL=local npm test` 444/444、0 fail、0 skip；`npm run build` 16/16；`git diff --check` 与显式 secret scan PASS；CRITICAL compliance、quality/safety 双审查最终 PASS。
- External boundary:参考 `E:\Two` 已验证卡片链路与飞书官方 Markdown 文档做只读核对；未读取其密钥或写入该项目。未调用真实 GPT、博查或飞书，未 push/部署；真实链继续 `BLOCKED_EXTERNAL`。
- Follow-up:全局 Admin 锁定仍可能被远程错误登录触发；严格来源级 account-lockout DoS 防护与 webhook exactly-once 中介不在本地 MVP 阻塞集。

### S10-CS-4 workflow/diagnosis/outbox evidence(2026-07-16)

- Workflow PASS:`chat` 默认并限制 2,000 字，`jd_match` 限制 12,000 字，`diagnosis` 只接受五个受控字段；同 conversation/replay 不允许切换 workflow，三者复用同一 RAG/Search/Provider 主链。
- Diagnosis PASS:字段跨 turn 合并并由服务端判定 `collecting -> complete -> handoff_pending`；结构化历史原文不再作为普通 user 消息回注，JD 与初诊字段在 system/prompt 双层标记为不可信数据。
- Search PASS:合并后的初诊摘要用于 Embedding 和实际 Search query；SearchRouter 只消费无服务端标签的字段值，普通初诊不因“当前状态”误触联网，真实“最新 OpenAI API”请求仍正常搜索。
- Transaction PASS:首次邀请码使用与 Session 同事务写 `invite-first-use:<inviteId>`；完整初诊的 assistant、usage、interaction、稳定 diagnosis 与 `diagnosis-complete:<diagnosisId>` Outbox 同事务。replay、retry、新 turn、Outbox 失败和 COMMIT 两类不确定结果均保持恰好一份。
- Lifecycle PASS:diagnosis FK 锚点迁移到最新成功 interaction turn，diagnosis 与 Outbox 复用该 turn 的同一 10 天 deadline；延迟 Provider 回归证明不存在父记录提前级联窗口。
- Verification PASS:Task 4 focused 80/80、`DATABASE_URL=local npm test` 383/383、0 fail、0 skip；`npm run build` 13/13；`git diff --check` 与显式密钥扫描 PASS；CRITICAL compliance 与 quality/safety 三轮 correction 后均 PASS。
- External boundary:未调用真实 GPT、博查或飞书；Bocha/Feishu 保持 `BLOCKED_EXTERNAL`，未 push/部署。

### S10-CS-3 RAG/automatic-search evidence(2026-07-16)

- Search PASS:确定性 Router 保护 Morse 中英文个人事实；外部时效/技术问题可联网；禁用、额度耗尽或 Provider 失败均诚实降级且不虚报已核验。
- Citation PASS:Bocha one-shot Mock 只消费标题/摘要/URL；单标签、私网、metadata 与 special-use DNS 被拒绝；公开/history/replay citation 严格为 `id/title/href/kind/domain/score`。
- Transaction PASS:每 turn 一次、每 Session 五次；claim/finalize 复用既有锁连接；COMMIT 发送前失败不调用搜索，提交后丢 ack 只从已结束事务确认 durable claim；`max=2` 并发无连接池饥饿。
- RAG PASS:冻结 20 正例/10 负例并由 `rag:eval` 硬门 `0.45`；top1 17/20、top3 20/20，最低正例 `0.4822101`、最高负例 `0.4209749`。
- Verification PASS:`DATABASE_URL=local npm test` 355/355、0 fail、0 skip；`npm run build` 13/13；`git diff --check` 与 secret filename scan PASS；CRITICAL compliance 与 quality/safety 双审查 PASS。
- External boundary:未调用真实 GPT、博查或飞书；Bocha/Feishu 保持 `BLOCKED_EXTERNAL`，未 push/部署。

### S10-CS-2 provider/runtime evidence(2026-07-16)

- Runtime PASS:显式 Responses/Chat Completions 双协议、同一 AbortSignal、Embedding/首字节/总时长超时、Provider 并发、15 秒 SSE heartbeat、终态清理、同 Session 单飞、幂等 replay/orphan 恢复和事务补偿均完成。
- Lifecycle PASS:停止、断线和失败只保留 10 天 interaction，不扣消息额度、不写 12 小时 runtime assistant；history 只返回当前有效访客 Session 所属且未过期的完成会话。
- Verification PASS:`DATABASE_URL=local npm test` 为 308/308、0 fail、0 skip；`npm run build` PASS，13/13 页面并包含 `/api/chat/history`；`git diff --check ffa4afb` PASS。
- Review PASS:CRITICAL compliance 与 quality/safety 双审查均无 blocker；真实 GPT 未调用，仍保持 `BLOCKED_EXTERNAL`。

## S9 Morse portfolio closeout evidence(2026-07-15)
- Product PASS:首页以 `Morse` 为主身份并保留嵌入式文字对话;`/works` 承载四项目单页折叠与 Hash 同步,旧案例路由只重定向;两个企业内部项目保持无媒体、无公开访问动作的脱敏文字案例。
- Viewport PASS:首页 hero 在 1440x900、390x844 与 390x844 reduced-motion 下完整占据首屏,下一节不进入初始视口;身份、操作和对话区整体垂直居中。
- Verification PASS:`npm test` 为 215 total / 200 pass / 15 PostgreSQL SKIP / 0 fail;`npm run build` 生成 12/12 页面;post-merge `npm run visual:s9` 为 `failures: []`,console/page error 0,外部运行时请求 0,所有横向溢出 0。
- Performance PASS:Lighthouse desktop performance 1.00,FCP 0.2s,LCP 0.5s,TBT 0ms,CLS 0;证据与完整边界见 `docs/verify/s9/s9-closeout.md`。
- Environment boundary:`DATABASE_URL` 与本地 embedding 未配置,因此 15 个 PostgreSQL 用例保持 SKIP;未调用 Provider、未写数据库、未安装依赖、未改 schema、未部署。
- Git boundary:S9 branch HEAD `23c04ce` 经 merge commit `1fb7e28` 吸收到本地与远端 `master`;`AGENTS.md`、研究稿、概念图、旧截图、`output/**` 与临时脚本未进入提交。

## S8 customer-service scope amendment(2026-07-13)
- Stage contract:`docs/task-center/s8-customer-service-conversation.md`;本文件只保存唯一指针,详细阶段、授权、失败登记和 LOOP 以阶段合同为准。
- Product boundary:产品仍是受控访问的个人作品集;S8 把现有数字摩斯从技术 MVP 补成招聘方、合作方和同行可真实使用的文字智能客服,不是独立客服 SaaS。
- Reuse boundary:复用 M3 的短期码、HttpOnly session、OpenAI Provider、SSE、PostgreSQL + pgvector、短期记忆、来源和预算门;不重复建设底层。
- First closure:显式访客意图、结构化回答、公开来源链接、失败补偿与重试、20-case 评测、loopback Mock 双宽和最多 3 次真实 GPT smoke。
- Knowledge boundary:唯一 live source 仍是 `content/site-content.json`;知识不足进入 coverage gap,不得读取草稿或外部仓库编造答案。
- Non-goals:数字人形象、语音/TTS/口型、联网搜索、工具 Agent、Milvus/Qdrant、长期访客画像、管理后台、通知渠道、部署。
- Execution boundary:S8 已通过 merge commit `9ca4895` 吸收到本地与远端 `master`;未部署。后续动作不继承本轮执行授权。

## S8 customer-service closeout evidence(2026-07-14)
- Scope PASS:在既有短期码、SSE、OpenAI adapter、PostgreSQL + pgvector 和预算门上完成三类访客意图、公开来源、恢复 UX、幂等 turn 与评测闭环;零新增依赖、零 schema migration。
- Reliability PASS:Provider/Embedding/空白完成/持久化失败精确补偿;turn + conversation advisory try-lock;客户端 `turnId` 支持完成事件丢失后的幂等重放,不重复消息、usage、额度或来源。
- Evaluation PASS:`DATABASE_URL=local npm test` 113/113;`chat:eval` 24/24;BGE + pgvector 20-case top-1 17/20、top-3 20/20;9 documents/9 chunks,invalid source 0,missing href 0,draft/local source 0。
- Browser PASS:隔离 production server + fail-first Mock 在 1440x900/390x844 均 `failures: []`;过期码、会话过期、三类 intent、同 turn retry、stream、source navigation、logout、quota 30→29、overflow 和移动全屏通过;非预期 console/page error 0。证据:`docs/verify/s8/s8-chat-{desktop-1440x900,mobile-390x844}.png`。
- Build/Safety PASS:`npm run build`、`git diff --check`、secret scan 通过;`3010` 用户服务 PID 未改变,临时 3011/18090/18091/9222、smoke 邀请和 profile 已清理;项目 pgvector 保留。
- Review PASS:CRITICAL compliance 与 quality/safety 两个独立 review 均 PASS,BLOCKER 0。
- Real Provider BLOCKED:受信 OpenAI-compatible endpoint 与 `gpt-5.4-mini` 可用,但 3 次正式 `runChat` 均未完成;smoke 预算已耗尽,未做第 4 次调用。只记录稳定 `ChatServiceError`,不伪造更具体根因。
- Git boundary:S8 commit `71a6213` 已通过 merge commit `9ca4895` 吸收到本地与远端 `master`;未 PR 或部署。`AGENTS.md`、研究稿、概念图、`output/**`、旧临时脚本和非最终截图未进入提交。

## S6 visual restoration amendment(2026-07-14)
- Pointer boundary:本修订当时只恢复展示层、未推进 S8 指针;该指针已由 2026-07-15 的 S9 收尾推进。
- Product PASS:首页恢复 S6 深色身份首屏、光球氛围、系统展厅、关于、真实统计、FAQ 与 CTA;S7 `/works` 和四个案例路由、S8 短期码/RAG/SSE/来源/短期记忆/预算/重试/幂等全部保留。
- Visibility PASS:hero 从 100svh 收敛为 70svh;首个系统标题取消滚动 reveal 依赖;移动 launcher 按 640/560 两级断点移入顶部控制行。浏览器门要求标题完整入屏且真实可见,并对 launcher 与视口内文字/图片/控件做相交检查,1440x900、600x900 与 390x844 最终均为 0 overlap。
- Verification PASS:`DATABASE_URL=local npm test` 114/114;`npm run build` 生成 12 条路由;`visual:s6-restore` 覆盖六路由 1440/600/390 主文档 200、聊天开关、外链、overflow、console/page error、外部请求和 reduced-motion;CDP 连接、命令与关闭均有界失败并输出结构化诊断,最终 `failures: []`。
- Data/Provider:本地健康接口为 database ready、9 indexed chunks、Provider `configured:false`;未调用真实 GPT,未 ingest、未改 schema。
- Evidence:`docs/verify/s6-restore/home-{desktop-1440x900,mobile-390x844}.png`;人工复核确认首屏身份、光球与下一节标题无重叠。
- Git boundary:本次只在 `codex/s7-multipage-portfolio` 本地恢复与验证;未合并 `master`、未 push、未部署。`AGENTS.md`、两份研究稿、概念图、`output/**`、临时脚本和非最终 S8 截图继续排除。

## S7 multipage scope amendment(2026-07-13)
- Git baseline:`master` 已通过 `d1ebd88` 吸收 M3-RAG;S7 在 `codex/s7-multipage-portfolio` 开发,不重复合并历史功能分支。
- Product boundary:多页作品集负责介绍摩斯与四个真实项目;数字摩斯继续复用现有短期码、RAG、SSE、来源和预算门。
- First slice:`/`、`/works`、`/works/auto-operations`、共享导航/页脚/简历入口/数字摩斯;其余项目先建立真实内容与路由契约。
- Evidence boundary:只使用经核验的公开事实与脱敏真实截图;生成图、蓝图、示例数字、假联系方式和未终审草稿禁止进入作品证据位。
- Dependencies:零新增依赖;继续使用 Next.js App Router、TypeScript、CSS Modules 和 `app/styles/tokens.css`。
- External boundary:`E:\\Wiki`、`E:\\demo2`、`E:\\小红书`、`E:\\多agent` 只读;本阶段不调用 Provider、不修改数据库 schema、不部署、不 push。
- Stage contract:`docs/task-center/s7-multipage-portfolio.md`;implementation plan:`docs/superpowers/plans/2026-07-13-s7-multipage-portfolio.md`。

## S7 multipage closeout evidence(2026-07-13)
- Scope PASS:基于 `master@a4eba23` 在 `codex/s7-multipage-portfolio` 完成 `c72493c..961de7f`;53 个 tracked 文件覆盖 S7 需求、真实内容、六路由、共享站点壳、公开 RAG 内容源、脱敏素材、测试与证据。
- Product PASS:`/`、`/works`、`/works/content-agent`、`/works/auto-operations`、`/works/deep-research`、`/works/digital-morse` 最终生产构建均 HTTP 200;首页首屏为“数字生命摩斯 / Agent 系统开发者”,四个案例结构与 CTA 精确,详情页不再链接自身。
- Content PASS:`content/site-content.json` 是 live 页面与 RAG 的唯一新公开源;公开页面无假数字、假联系方式、内容缺口台账、生成 UI 或内部路径;旧 S3 内容/组件保留但退出 live 路径。
- Asset PASS:自动运营公开证据为 510x580 真实登录工作台脱敏裁剪;原图、品牌、账号、任务、业务数据和 Provider 配置未进入 `public/` 或 Git。
- Verification PASS:`DATABASE_URL` 未设置时 `npm test` 为 90 total / 84 pass / 6 PostgreSQL SKIP / 0 fail;RAG 纯提取/分块/eval 9/9;`npm run build` PASS;`git diff --check` PASS。
- Browser PASS:`visual:s7` 在 1440x900/390x844 检查六路由均 `failures: []`;全局 Header/Footer/简历/聊天、精确 CTA、510x580 图片、诚实缺图状态、0 横向溢出、0 console/page error、0 外部运行时请求;reduced-motion 无无限动画且双帧一致。证据为 `docs/verify/s7/s7-*.png`。
- Performance PASS:Lighthouse 13.4.0 desktop performance 1.00(FCP 247ms,LCP 468ms,TBT 0ms,CLS 0);报告 `docs/verify/s7/s7-lighthouse-desktop.json`。
- Review PASS:STANDARD combined independent reviewer 无 blocker、follow-up 或 scope/profile mismatch;controller 已逐张检查 7 份桌面/移动/reduced-motion 证据图。
- Safety PASS:未执行知识库 ingest、PostgreSQL 写入、Provider、schema/API/检索算法变更、依赖安装、部署、push 或 PR;四外部资产保持只读。
- Git boundary:S7 已随 merge commit `9ca4895` 吸收到本地与远端 `master`;`AGENTS.md`、两份用户研究文档、`docs/verify/concepts/**`、`output/**` 和旧临时脚本未进入提交。

## M3-RAG MVP scope amendment(2026-07-12)
- Product boundary:首页、关于与项目公开;短期邀请码只解锁数字摩斯对话和面试官模式。
- Knowledge boundary:只摄取 `content/s3-content.json` 的已公开内容;`content/drafts/**` 与四个外部资产禁止进入索引。
- Retrieval:PostgreSQL 16 + pgvector;同库保存知识文档、分块、向量、邀请码会话、短期消息和用量。
- Vector-store boundary:当前受控低并发、小规模公开语料不单独部署 Milvus/Qdrant,以复用 PostgreSQL 事务、备份和访问控制并减少故障面;仅在基准证明检索/写入瓶颈,或出现独立扩缩容、多租户强隔离、专用混合检索需求时再评估外置。
- Provider:OpenAI Responses API + Embeddings API;模型和 base URL 由环境变量配置;真实冒烟最多 3 次,同类失败 2 次即停。
- Dependencies allowed:`openai`,`pg`,`@types/pg`;不得引入向量数据库第二套服务或 UI 框架。
- Docker:仅允许本机 `127.0.0.1:55432` 的项目专用 pgvector 容器;不得改动现有容器或远程数据库。
- Local embedding:允许复用现有 `torch/transformers/sentence-transformers` 与 GTX 1070;仅下载 `BAAI/bge-small-zh-v1.5`;服务只绑定 `127.0.0.1:18091`;禁止新增 Python 包。
- Cost gate:按环境变量配置的单价估算月度费用;50/75/90/100% 分级,100% 拒绝普通会话。
- Secrets:API key、邀请码明文、cookie token、原始 provider payload 不进入代码、测试证据、文档或日志。
- Verification labels:local tests / local pgvector / loopback browser / real Provider;Mock 不得称为真实 GPT 验证。
- Stage contract:`docs/task-center/m3-rag-mvp.md`;implementation plan:`docs/superpowers/plans/2026-07-12-digital-morse-rag-mvp.md`。

## M3-RAG local closeout evidence(2026-07-13)
- Scope PASS:公开作品集保持可访问;短期码只解锁普通对话/面试官模式;`content/drafts/**` 和四个外部资产未进入索引。
- Data PASS:本地 `pgvector/pgvector:pg16` 健康;schema 迁移成功;8 个公开文档/8 个向量分块;重复摄取 8/8 跳过;模型签名变化会强制重建。
- Access/memory PASS:邀请码、token 哈希、HttpOnly cookie、会话上限、过期拒绝、服务器端短期历史和退出清理均由真实 PostgreSQL 集成测试覆盖。
- Chat PASS:OpenAI SDK Responses/Embeddings adapter、SSE `meta/delta/done/error`、来源、普通/面试官 prompt、费用入账和 50/75/90/100% 预算门已覆盖。
- Verification PASS:`DATABASE_URL=local npm test` 62/62(含 6 个 PostgreSQL 集成用例);`npm run build` PASS;`git diff --check` PASS;`sk-*` 敏感值扫描 0 命中,环境变量扫描仅有变量名、测试假值与 `local-embedding` 占位。
- Browser PASS:loopback Mock Provider 下 1440/390 解锁、流式回答、来源、面试官模式、无效码、退出和 50% 费用预警通过;控制台 error/warn 0;证据 `docs/verify/m3-rag-{desktop-1440,mobile-390}.png`。
- Cleanup PASS:验收后测试邀请码 0、Mock/预算测试用量 0;项目 pgvector 容器保留用于后续真实 Provider 验证。
- Real Provider PARTIAL PASS:直连 `api.openai.com:443` 因 DNS 污染/连接超时不可用;现有受信 Sub2API `http://127.0.0.1:8080/v1` 可达。真实 `gpt-5.4-mini` Responses 调用 PASS(输入 4393/output 7 tokens,正文未记录);`gpt-5.6-mini` 一次 502;`text-embedding-3-small` 一次 404 `model_not_found`;按 3 次上限停止 Provider 调用。
- Local semantic embedding PASS:`BAAI/bge-small-zh-v1.5` 通过 OpenAI-compatible loopback `127.0.0.1:18091` 返回归一化 512 维向量并零填充到 pgvector 1536 维;8 文档/8 分块重建后重复摄取 8/8 跳过;gold eval top-1 7/8、top-3 8/8。当前 `torch 2.11.0+cpu` 使实际设备为 CPU,GTX 1070/CUDA 加速未在本轮声称通过。
- Residual audit:依赖审计仍为既有 Next.js 间接 PostCSS 的 2 个 moderate;自动修复会破坏性降级到 Next 9,继续沿用 S6 处置。
- Git boundary:M3 已通过 merge commit `d1ebd88` 吸收到本地与远端 `master`(`https://github.com/Morse-Moss/Self-Website.git`);功能分支保留为历史,未 deploy;`AGENTS.md`、研究报告、`output/` 和旧临时脚本均未进入提交。

## 本轮收尾状态(2026-07-08,Claude Code 侧停机点)
- S2 终态评审 PASS(参数逐字段零漂移/降级链完整/边界干净/一条非阻塞:WEBGL_lose_context 兼容性记录)
- CEO 视觉门双宽 PASS + reduced-motion 真静止 + 控制台零报错(favicon 已补)
- git 6 commits 全部落库,工作区仅剩 docs/task-center 与 docs/verify/v1 待随交接 commit
- dev server 已关;验收工具归档 docs/task-center/tools/visual-gate.mjs

## Stage Package
- [x] S0 盘点:环境全绿(Node24/npm11/registry 通),e:\Revolution 原非 git 仓库已 init
- [x] S1 骨架:Next.js@16 + TS + token 迁移 + CLAUDE.md v2 + 2 commits —— 评审进行中
- [x] S2 首屏:速览层 + 数字人占位组件(视频源可配)+ 光球氛围层移植(React 化)
- [x] S3 滚动叙事框架 + 展厅 + 账本 + 简历模式(GSAP 契约内新增依赖)
- [x] S4 数据管线:scripts/collect-stats.mjs(git log + CC/Codex 本地记录 → JSON;TDD 适用)
- [x] S5 安全内容基线:公开安全文案 + 关于/FAQ/内容缺口台账 + 联系占位;未读取或注入 content/drafts/
- [ ] M1 终审内容增量:摩斯终审通过后再替换对应占位,不阻塞 S6
- [x] S6 终验收:build + 1440/390 Playwright 截图视觉门 + Lighthouse 100 + reduced-motion + closeout
- 并行 M1 内容线:知识库/简历/口播稿草稿 → content/drafts/(产出只进终审队列,不自动上线)
- Research lane:置信 <96% 的阶段先研究出 Decision Note;Parking:阻塞则记档并切独立安全阶段

## Historical v1 Preauthorization Matrix(not applicable to S10)
| 项 | 状态 |
|---|---|
| npm install | allowed,仅各阶段契约列明包(S3:gsap) |
| git commit(本地) | allowed,英文 message+Co-Authored-By |
| git push / 部署 / 远程仓库 | historical:feature and mainline push completed(2026-07-13);S10 follows its current task center and forbids push/deploy |
| Browser CDP | allowed,仅本地视觉验收(临时 profile,截图入 docs/verify/v1/) |
| Provider(OpenAI/TTS 真调用) | forbidden(v1 无分身) |
| Public Web | 仅 CEO 决策研究可用;实现 agent forbidden |
| 外部资产四目录 | 只读;M1 agent 亦禁写 |
| 删除/破坏性操作 | approval-required |
| 密钥 | 不进代码不进日志 |

## Review Gates
每实现阶段独立只读评审(Sonnet);PASS 才推进;UI 阶段另过 CEO 视觉门(全新加载+双宽截图)。

## LOOP Contract
- State source:本文件 current_pointer
- 每轮:读 pointer → 执行该阶段(派 Sonnet)→ 评审 → 更新 pointer/证据 → 下一阶段
- Research fallback:置信不足转研究巷道,产 Decision Note 再继续
- Stop/escalate:预授权外动作、BLOCKER 修复两轮仍不过、试图把未终审 drafts 注入线上内容、破坏性操作需求
- 摩斯不在场时:低噪声推进,阶段 PASS 只落盘,聊天仅报里程碑/阻塞/收尾

### M1 内容线(2026-07-08)完成,进入摩斯终审队列
- 产出:content/drafts/ 9 份草稿全齐(CEO 亲验:9 文件、禁词 grep 零命中、终审标头 9/9、[待摩斯补充] 34 处零编造)
- 红线自查:demo2 脱敏 / 小红书叙事框架 / 隐私 / 状态诚实 / 语气 五项全过
- **摩斯终审三重点**:① system-operations「摩斯的角色」段——与开源上游 XHS_ALL_IN_ONE 的关系口径必须本人定(诚信敏感);② resume 量化区仅 1 条硬亮点,依赖回填(S4 管线可补 git/CC 数字);③ faq 第一人称口径(尤其 6/16/18 条)+ 口播稿三版风格拍板

### S4 数据管线(2026-07-08)实现完成,修正+评审进行中
- 产出:scripts/collect-stats.mjs + 15 个 node:test(TDD RED→GREEN 有证据)、content/stats.json
- CEO 亲验:测试 15/15 全绿(glob 写法)、stats.json 真实(CC 128 会话/13 项目/近90天活跃26天;Codex 归档 111)、未执行 git、隐私口径 methodology 内嵌
- 契约瑕疵(CEO 责任):`node --test scripts/` 在 Node24/Win 不可用 → CEO 决定改为 glob 写法,已修正(CEO 亲验 `npm test` 全绿)
- 独立评审:**PASS**(隐私审计逐行过:零内容读取、execSync 仅两条只读 git、JSON 无泄漏通道、口径与代码一致、TDD fixture 真实)
- FOLLOW-UP×3 → CEO 决定全修(源码硬编码用户名改 os.homedir(仓库将公开)/补 scanCodexMeta 分支测试/execFn 死参数清理),原 agent 修复中,修完原评审复核
- 按约未 commit,S2 完成后统一提交

### S2 首屏(2026-07-08)实现完成,CEO 视觉门已过半
- 实现:commit 186057f(Lifeform React 移植三级降级链+参数保真、DigitalHuman 占位组件、速览层双宽布局);独立评审进行中
- CEO 视觉门(dev server + CDP,touch 仿真+滚动归位+帧沉降):桌面 1440 **PASS**(五项全齐、光球不挡字、不滚动全可见、动画运行、reduced-motion 双帧一致=真静止);移动 390 **1 缺陷**——底部「数字人筹备中」与「示例数据」标签碰撞、联系行贴边
- 控制台 1 个 404 = favicon 缺失(违反零报错标准)
- CEO 修正单(等评审汇合后派发):①移动端标注移右上+hero 底部内边距 ②补 app/icon(深蓝底青色点划) ③桌面「示例数据」标签对齐卡片行(nit)
- 截图证据:docs/verify/v1/{desktop-hero,mobile-hero,mobile-reduced-motion}.png;dev server 保持运行待复验

### 执行层模型事故(2026-07-08,已闭环)
- 摩斯发现大量主模型调用 → 转录取证:model:"sonnet" 仅首次启动生效,SendMessage 复活会以会话主模型重启(同一 agent 25 条 sonnet + 48 条 fable)
- 对策已固化:修正/复审/断流恢复一律新开 Sonnet agent 带上下文摘要;已写入记忆 + canonical skill + runtime-adapters + CC 薄入口 + CHANGELOG

## Failure Register
- 2026-07-08 M1 内容 agent API timeout 一次 → 已续跑(SendMessage 复活)

## Evidence Ledger
### S6 上线前终验收(2026-07-11,Codex)
- Scope:刷新 `content/stats.json`;首屏 GitHub/Email/WeChat 假链接改为 `aria-disabled` 不可点击占位;新增回归测试;未改 Lifeform 参数、token、依赖或公开内容来源。
- Verification:`npm test` PASS(25/25);`npm run build` PASS(Next.js 静态预渲染 / TypeScript PASS);`git diff --check` PASS。
- Browser:生产构建 `http://127.0.0.1:3000` 下 1440、390、390 reduced-motion 和 1440 简历模式全部 PASS;HTTP 200,控制台/页面/请求错误 0,横向溢出 0,外部运行时请求 0,首屏联系区可见,假 hash 链接 0;移动触控仿真 `pointer:coarse=true` / `maxTouchPoints=1`;reduced-motion 双帧一致且持续动画 0;简历模式持久化、显示与打印契约通过。
- Lighthouse:桌面性能 100(LCP 0.5s,FCP 0.3s,TBT 0ms,CLS 0,Speed Index 0.4s),达到蓝图 `>=90` 门槛;报告 `docs/verify/v1/s6-lighthouse-desktop.json`。
- Evidence:`docs/verify/v1/s6-{desktop-1440,mobile-390,mobile-390-reduced,resume-1440}.png`。
- Security audit:`npm audit --omit=dev` 报 2 个 moderate,来自 Next.js 16.2.10 间接携带的 PostCSS 8.4.31;自动修复建议降级到 Next 9.3.3,不安全且不采用。当前静态站无用户可控 CSS 输入,作为上线前已知残余风险记录,后续随 Next.js 安全升级复核。
- Commit:`6cdf1a0 fix: complete S6 release readiness gates`。
- Boundaries:未读取或注入 `content/drafts/`;未 push、部署、绑定域名、调用 Provider 或改写外部资产。
- Result:正式站 v1 达到本地上线就绪;部署与域名操作等待摩斯指令,M1 终审内容增量继续独立排队。

### S5 安全内容基线(2026-07-11,Codex)
- Scope:仅更新 `content/s3-content.json`、`components/S3Sections.tsx`、`components/S3Sections.module.css`、`scripts/site-content.test.mjs`;未读取 drafts 作为线上内容源。
- Content safety:live JSON 禁止草稿/终审标记、本地绝对路径、内部来源名和高风险运营措辞;缺失身份、联系方式、量化效果、系统关系口径和数字人素材统一进入“内容缺口台账”,不编造事实。
- UI:新增关于、FAQ、内容缺口台账;`href="#"` 的联系方式渲染为不可点击占位;新增样式全部消费既有 token,桌面与移动端分别采用三列/两列和单列布局。
- Verification:`npm test` PASS(24/24);`npm run build` PASS(Next.js static prerender / TypeScript PASS);Playwright 1440 + 390 + 390 reduced-motion PASS(控制台/页面错误 0,横向溢出 0,S5 区块全部可见,3 个联系占位均无假链接);`git diff --check` PASS。
- Commit:`0bbbdfc feat: add safe S5 portfolio content`。
- Boundaries:`content/drafts/` 仍待摩斯终审且未注入;`prototype/**`、`docs/verify/**`、外部资产、依赖、Provider、远程仓库和部署均未改动。
- Resolved:S6 上线前验收与最终视觉门已通过;部署仍等待摩斯指令。

### S3(2026-07-10,Codex)
- Stage contract:滚动叙事 + 系统展厅 + 方法论/杠杆账本 + 联系/页脚 + 简历模式;唯一新增依赖 `gsap`;S5 正式内容未终审前只上线结构占位与「示例数据 / 筹备中」标注。
- Changed:app/page.tsx,app/layout.tsx,app/globals.css,components/{ScrollEffects,ResumeMode,S3Sections}.*,content/s3-content.json,scripts/{site-content.test.mjs,s3-visual-smoke.mjs},package.json,package-lock.json。
- Implementation:首屏 S2 JSX 仅包裹后挂载 S3 区块;Lifeform/DigitalHuman/hero.module.css/tokens.css/content/stats.json 未改。展厅 4 卡按 L1「痛点→方案→人机分工→状态」;深度研究保留「试驾间回放 · 筹备中」。账本消费 content/stats.json 的真实 128 会话/13 项目/近90天 26 活跃天,其余仍标「示例数据」。简历模式右上角开关,localStorage key `morse.resumeMode`,预水合脚本防首帧闪烁,打印样式就位。
- Verification:`npm test` PASS(21/21);`npm run build` PASS(Next.js static prerender / TypeScript PASS);`npm run visual:s3` PASS(1440 + 390 + 390 reduced-motion,控制台零错误,无横向溢出,简历模式持久化/打印入口,移动 reduced-motion 双帧一致=true);`git diff --check` PASS(仅 CRLF 工作区提示,无 whitespace error)。
- Review:独立只读评审 PASS。FOLLOW-UP 1-3 已修(简历模式预水合 guard;visual:s3 npm 入口;reduced-motion 双帧一致;CDP target close)。FOLLOW-UP 4 本条记账已完成。
- Boundaries:未引用 content/drafts/;未改 prototype/** 或 docs/verify/**;未 push/部署/建远程;未调用 Provider;除 `gsap` 外零新增依赖;新增视觉截图只写系统临时目录 `revolution-s3-smoke`,不覆盖既有验收证据。
- Resolved:S5 采用不依赖 drafts 的安全内容基线完成,S6 自检与交回也已通过;终审内容继续作为独立增量。

### S1(2026-07-08)
- Changed:package.json/tsconfig/next.config.mjs/.gitignore/app/{layout,page,globals}/app/styles/tokens.css/CLAUDE.md
- Verify:`npm run build` PASS(Turbopack);dev 冒烟 GET / 200;`diff tokens` 逐字节一致(CEO 亲验);git log 2 commits(CEO 亲验)
- Review:**PASS**(独立评审:commit 范围/依赖/外链零命中/token 逐字节/tsconfig 无危险项/build 亲验全过)。非阻塞:①task-center 与 content/drafts 未入版本控制,后续阶段决定;②dev 冒烟以实现方自述为准(build 已独立复验)
- FOLLOW-UP resolved:S6 复核为 Next.js 间接 PostCSS 的 2 个 moderate;不采用会降级 Next.js 的强制修复,残余风险与处置见 S6 Evidence Ledger。

## 摩斯的人工队列(不阻塞工程线)
1. content/drafts/ 终审(阻塞终审内容增量,不阻塞 S6;S5 安全基线已完成)
2. 录数字人素材 + 可灵/豆包训练(阻塞占位点亮,不阻塞 v1)
3. Vercel 部署(S6 已通过,等待摩斯指令)
