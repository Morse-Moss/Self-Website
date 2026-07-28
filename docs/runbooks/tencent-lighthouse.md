# 腾讯云 Lighthouse 上线手册

本文对应 `aimorse.tech` 的生产部署。当前实例为腾讯云 Lighthouse 首尔节点，公网地址为 `43.133.68.202`。境外节点不需要 ICP 备案；DNS 解析和 HTTPS 证书签发已完成，域名实名状态继续由腾讯云注册控制台维护。

## 当前生产状态（2026-07-28，招聘短追问修复与 HR 定向启用）

- 状态：`DEPLOYED_UNOBSERVED / HR_TARGETED / PERCENT_0`。当前运行提交为 `2220759`；`/opt/revolution/current` 与 Web Compose working directory 指向 `/opt/revolution/releases/2220759/revolution`，运行提交已在部署前进入 `origin/master`。本次未代替用户发送真实面试问题，因此只声明发布与配置已观察，不声明真实回答已通过。
- 冻结归档为 19,579,605 bytes，SHA-256 `349883d721ac4b33b6d8b461f8191ca00b2bd740f42567f0a31f3a38616d9836`，本地与服务器哈希一致。Web 镜像为 `sha256:97e9488299793cfb05580b31e88850b0965488f8b6c1a2b77886c8c03cf35089`。
- 修复只让“你再去查一下 / 重新确认一下”这类裸追问在相邻 completed 轮次仍属于同一个 active 招聘 Task 时继续项目匹配；独立输入、临时话题之后和等待 JD 补充时仍按普通对话处理，避免错误继承旧任务。
- 本次只替换 Web。Worker 继续运行上一镜像 `sha256:22b6db3fd8a6b923c40f1c4a531b59f6b70bb43aca3dd9e92b32d734518ba65a`，Worker、DB、Embedding、Edge 容器身份未变；五容器均 healthy、restart count 为 0。没有运行 migration、grants 或 ingest。
- Context Packet 保持 enabled、percent `0`。白名单严格等于“标签精确为 `HR interview` 且仍可创建 Session”的 invite ID 与“拥有未过期 HR Session”的 invite ID 并集；最终 capacity-eligible 为 6、未过期 Session 所属 invite 为 2，后者均已包含在前者中，因此白名单总数为 6。未输出 UUID、邀请码明文或个人信息。
- 公网 live/ready/兼容 health、公开页面、未登录权限边界与 `release:smoke` 均通过；Web/Worker/Edge/DB 新鲜错误关键词计数为 0。没有临时验收邀请码、running turn 或自动真实 Chat/Provider 调用。受限环境备份为 `/opt/revolution/shared/.env.production.bak-hr-v22-targeted-20260728T040058Z`，完整脱敏证据见 `docs/verify/release/recruitment-bare-recheck-production-closeout-2026-07-28.md`。

## 历史生产状态（2026-07-28，Controlled Context V2.2 单邀请码观察完成）

- 状态：`PRODUCTION_OBSERVED / INVITE_CANARY_COMPLETE / PERCENT_0`。当前运行提交为 `f02e9de`；`/opt/revolution/current`、Web 与 Worker Compose working directory 指向 `/opt/revolution/releases/f02e9de/revolution`。运行提交已在部署前进入 `origin/master`。
- 冻结归档为 19,577,725 bytes，SHA-256 `f2f22805fa1381fdc12a43cbae3755640d388ee69e3bf9d8c63daa3c8354f2a4`，本地与服务器哈希一致。Web 镜像为 `sha256:549aa6a78b82c2040255d7184ea2dc07eee9698f5424859e736d1fb5d955b137`，Worker 镜像为 `sha256:22b6db3fd8a6b923c40f1c4a531b59f6b70bb43aca3dd9e92b32d734518ba65a`。
- 本次只替换 Web/Worker；DB、Embedding、Edge 完整容器 ID 不变。五容器均 healthy、restart count 为 0；migration registry 与 release manifest 均为 `001-012`。没有重复 migration、grants 或 ingest。
- 无 Provider 的固定失败链在隔离 Docker 内网与临时 pgvector 数据库中通过 `1/1`，无外部请求且临时资源已清理。随后只对一个测试邀请码逐轮发送冻结 fixture 的五条消息；五个主回答全部完成，共八次 Provider attempt，前三轮由 fallback 完成，后两轮由 primary 完成。最终 Task Frame 为 `completed / task_complete`、完成轮次为 5。
- 脱敏 manifest、证据 ID/真实检索分数及 packet/request HMAC 一致性通过；没有 raw input 或 stale marker 泄漏。五个答案均未输出内联 `[来源N]`，记录为非阻断 `missing_grounded_citation` 质量债，不触发丢弃已完成回答或额外 Provider attempt。
- canary 结束后测试邀请码已停用、唯一 Session 已过期、白名单已清空。Context Packet 保持 enabled、percent `0`、空白名单；未经新的当前授权不进入 10% 或更高灰度。受限环境备份为 `/opt/revolution/shared/.env.production.bak-post-canary-f02e9de-20260727T231554Z`。
- 公网 live/ready/兼容 health、公开页面、未登录权限边界与 `release:smoke` 均通过；Web/Worker/Edge/DB 新鲜错误关键词计数均为 0。完整脱敏证据见 `docs/verify/release/controlled-context-v22-production-closeout-2026-07-28.md`。

## 历史生产状态（2026-07-28，回答质量检查改为非阻断）

- 状态：`DEPLOYED_UNOBSERVED / HEALTHY / PROVIDER_NOT_CALLED`。当前应用 release `d947cb7`；`/opt/revolution/current`、Web 与 Worker Compose working directory 指向 `/opt/revolution/releases/d947cb7/revolution`。本地提交未 push；部署状态不能替代远端同步状态。
- Provider 完成协议并返回非空正文后，运行时直接交付并持久化；内容质量规则不再触发丢弃、strict、reset、Provider 切换、Provider incident 或 `PROVIDER_UNAVAILABLE`。质量规则保留为离线评测或非阻断观测。只有真实 Provider、网络、协议、超时、空完成或 incomplete 故障可以在可见正文前触发后续 Provider attempt。
- 冻结归档为 25,077,760 bytes，SHA-256 `887ee3c4696bbe877f9d8192c67af49cd006a17650a5296e05c100cb1b2096d9`；本地与服务器哈希一致。生产镜像构建生成 33 条 Next.js 路由，隔离生产镜像回归测试 `27/27` 通过。
- 只重建 Web/Worker；DB `cdd60bc525be...`、Embedding `1a37c91fe1b5...`、Edge `b2c4293eec67...` 的完整容器 ID 在切换前后不变。五容器均 healthy、restart count 为 0；新 Web 启动后的 Web/Worker/Edge/DB 错误关键词计数均为 0。
- 公网 live、ready、兼容 health、根页、works、admin、admin/api 均为 HTTP 200；未登录 Provider runtime、turn list、简历文件和简历授权接口均为 HTTP 401；`release:smoke` 返回 `{"ok":true}`。
- 本次没有运行 migration、grants 或 ingest，没有修改生产环境、Provider 路由、数据库、公开知识或私密简历数据。没有真实 Chat/Embedding/Search/Bocha/Feishu/Provider 调用，因此“实际付费 Provider 回答被直接交付”尚未做生产业务观察；保留 `revolution-web:rollback-c2d575c` 与 `revolution-worker:rollback-c2d575c`。

## 历史生产状态（2026-07-27，Provider 接管与迁移链修复）

- 状态：`PRODUCTION_OBSERVED / MIGRATIONS_009_011_APPLIED / PROVIDER_TAKEOVER_DEPLOYED`，当前应用 release `c2d575c`；`/opt/revolution/current` 指向 `/opt/revolution/releases/c2d575c/revolution`。该运行提交已推送，随后生产证据由文档提交 `0426eaf` 记录到 GitHub `master`；文档提交不需要重建运行镜像。
- 冻结归档为 19,503,454 bytes，SHA-256 `45ff9cba30e7f884302f81fb8f32373c004edcb091d109b07517cd40e36a0c2b`，本地与服务器哈希一致。迁移前备份为 `/opt/revolution/shared/backups/pre-c2d575c-20260727T155358Z.dump`，349,213 bytes，SHA-256 `d321aecccaca660cadbba7984255b121ca06e2f4d721d258b9c1e3a633a8db75`。
- 在停止 Web/Worker 的受控停写窗口内确认无长事务后，migration `009`、`010`、`011` 依次成功；重复 migration 幂等，registry 为 `001-011`。生产原本已是 canonical `008` Task Frame，因此 `011` 没有历史行需要转换；Task State 保持 0 行，10 个目标索引齐全，`ai_environment_takeovers` 已存在，migration 角色经 grants 恢复为非超级用户且 AI runtime 权限门禁通过。
- 只重建 Web/Worker；DB、Embedding、Edge 完整容器 ID 不变，五容器均 healthy 且 restart count 为 0。公开知识未变化，因此未运行 ingest；未重建 DB、Embedding 或 Edge。
- 公网 live/ready/兼容 health、根页、works、admin、admin/api 均为 HTTP 200；未登录 Provider runtime、turn list 和简历文件均为 401；`release:smoke` 返回 `{"ok":true}`。维护停写期 Edge 记录 2 条上游不可达关键词；新 Web 启动后的 Web/Worker/Edge/DB 错误关键词和 Edge 5xx 均为 0。
- 本次没有管理员登录、邀请码创建、生产配置修改、真实 Provider/Embedding/Search 调用或私密简历访问。Environment Provider 接管入口与持久化已部署，但认证后的真实接管、测试和激活仍由管理员显式操作；旧活动 V1/V2 状态未在本次发布中修改。`revolution-web:rollback-4a039ab` 与 `revolution-worker:rollback-4a039ab` 保留。

## 历史生产状态（2026-07-27，V2.1 output guard 修复）

- 状态：`DEPLOYED / HEALTHY / PROVIDER_BLOCKED`，当前应用 release `4a039ab`；`/opt/revolution/current` 指向 `/opt/revolution/releases/4a039ab/revolution`。
- 冻结归档为 19,210,438 bytes，SHA-256 `395f87d164f29ae1075ce994658f43c497dc7f8e163afd30c8fe438675565c33`，本地与服务器哈希一致。发布时 GitHub 443 暂时不可达，因此 release 来自本地已冻结 commit；远端 push 必须单独取得成功回执，不能由部署状态代替。
- 本次修复只允许已经由 grounded 路由锁定的唯一项目使用“这个项目 / 它 / 我的项目”等自然指代，并保留明确能力问答中的“我的 RAG 实现”等表达；非 grounded、topic 不匹配、多项目和泛化“我的判断”继续拒绝。聚焦回归 `88/88`、TypeScript 和生产构建通过，独立复核 PASS。
- 只重建 Web/Worker；DB、Embedding、Edge 的完整容器 ID 在切换前后不变，五容器均 healthy，restart count 为 0。没有 schema 变更，未运行 migration、grants 或 ingest；生产 migration 继续为 001–008，公开知识未改动。
- 公网 live、ready、根页、works、admin、admin/api 均为 HTTP 200，`release:smoke` 返回 `{"ok":true}`；发布后 Web、Worker、Edge、DB 的十分钟错误关键词计数均为 0。
- 真实 Provider 观察只发送第一轮“数字摩斯这个项目适合投前端岗位吗？”。路由正确落到 `grounded / project_fact_query / project / digital-morse`，但活动 V1 主节点与第一备用均在首协议事件前返回 `PROVIDER_UNAVAILABLE`，总耗时约 3.3 秒，没有正文、usage 或 token 记录；第二轮因成本门未发送。三个中转入口的无生成 HEAD 探测分别返回 HTTP 200、200、403，说明服务器基础网络可达，阻塞位于带模型、协议和鉴权的 Responses 请求链路。
- 活动主线路仍为 V1 `version 1 / high / 30000`；V2 `version 2 / medium / 1200` 仍未激活。此前 V2 官方测试与 64-token 诊断同样失败，因此禁止绕过测试门直接激活，也不因本轮失败开启并发 Provider 或额外生成重试。
- 临时 smoke 邀请码已停用，关联 Session 已过期；一次性运维镜像 `revolution-ops:c971979` 在确认无容器依赖后删除。生产密钥、邀请码、原始回答和 Provider payload 未写入证据。

## 历史生产状态（2026-07-26，第三次发布）

- 状态：`PRODUCTION_OBSERVED / RETRIEVAL_AND_SEO_APPLIED`，当前应用 release `3ec952a`。
- `/opt/revolution/current` 指向 `/opt/revolution/releases/3ec952a/revolution`；冻结归档 SHA-256 `5c431bac78313ef4ad7fc4802d9883ebe7d5447db2d56c232860576818b709f4`，本地与服务器哈希一致。
- 本次生效：RAG 两段式检索（内层 ANN LIMIT 40 对齐 pgvector 默认 `hnsw.ef_search`，语料增长后可走 HNSW 索引；gold 集 46/46 top-3 复验通过）、系统提示词稳定前缀重排（人设/证据政策前置以命中 Provider prompt cache，文案零改动，chat-eval 91/91）、retention 补齐（usage_events 10 天、recovered service_incidents 90 天，由 worker cleanup 执行）、`/sitemap.xml` 与 `/robots.txt`（disallow /admin /api）上线并经公网实测、openGraph/twitter 元数据、admin 分页上限 500。
- 无 schema 变更：本 release 的 migrations 仍为 001–007，`Database migrations current through 007`；ingest 幂等（0 更新、41 documents 跳过）。工作区中的 008/009 migration 均未进入本次冻结归档。
- 诚实边界：DB 与 Embedding 容器再次被重建——尽管 compose 配置与上一 release 完全一致，但 db 服务的 postgresql.conf/init/TLS/secret 以 bind mount 挂自 release 目录，路径随 release 切换而变化，compose 视为配置变更强制重建。数据卷不变、restart count 0、migration 与 ingest 复验通过。**结构性事实：在当前 bind-mount 布局下，每次 release 切换都必然重建 db/embedding**，上一节「后续显式计划重建窗口」应按此理解；若要消除,需把这些 bind 源迁到 `/opt/revolution/shared/` 固定路径（属远端安全配置变更,需单独授权）。
- 公网复验：live/ready `{"ok":true}`、根页/works/admin 200、未授权 resume file 401、`release:smoke` `{"ok":true}`、sitemap.xml 与 robots.txt 内容正确;发布后十分钟窗口 web/worker/edge/db 错误关键词计数均为 0;五容器 healthy。
- `revolution-web:rollback-95a85ea` 与 `revolution-worker:rollback-95a85ea` 保留为回滚镜像。本次发布无管理员登录、无邀请码创建、无真实 Chat/Bocha/Feishu 调用。

## 历史生产状态（2026-07-26，第二次发布）

- 状态：`PRODUCTION_OBSERVED / OPS_HARDENING_APPLIED`，当前应用 release `95a85ea`。
- `/opt/revolution/current` 指向 `/opt/revolution/releases/95a85ea/revolution`；冻结归档 19,170,813 bytes，SHA-256 `34693e1ce8f0451df0ff827ded3b3da1aedc9dd89f56b1f919c5551b3f01fa0f`，本地与服务器哈希一致。
- 本节「容器健康检查、资源限制与日志轮转」声明的配置已随本次发布套用到生产：五容器全部 healthy（worker 心跳与 edge 端口探针生效）、web 实测 mem 1GiB / 1 cpu、日志 json-file 10m×3、web 注入 `MORSE_INVITE_TRUSTED_PROXY_HOPS=1`,chat 60s/10 条窗口节流默认生效。
- 诚实边界：因 db/embedding 服务本次新增了资源限制与日志配置，`up -d web worker edge` 连带重建了 DB 与 Embedding 容器(数据卷 `revolution_pgdata` / `revolution_embedding_models` 保持不变，migration 001–007 checksum 与 41 documents / 48 chunks 公开知识经 ready 与 ingest 幂等复验通过,两者 restart count 均为 0)。这与「切换应用 release 不得隐式重建依赖容器」的边界不符,根因是配置变更本身作用于这两个服务;后续含 db/embedding 配置变更的发布应显式计划其重建窗口。
- migration、ingest 幂等复验:`Database migrations current through 007`,ingest 0 更新、41 documents 跳过。公网 live/ready/根页/works/admin 均 200,未授权 resume file 为 401,`release:smoke` 返回 `{"ok":true}`。发布后十分钟窗口 web/worker/edge/db 错误关键词计数均为 0。
- `revolution-web:rollback-b80a728` 与 `revolution-worker:rollback-b80a728` 保留为回滚镜像。本次发布无管理员登录、无邀请码创建、无真实 Chat/Bocha/Feishu 调用。

## 历史生产状态（2026-07-26，第一次发布）

- 状态：`PRODUCTION_OBSERVED / RUNTIME_SETTINGS_VISIBLE / MAX_OUTPUT_PENDING_ADMIN_ACTIVATION`，当前应用 release `b80a728`。
- `/opt/revolution/current`、Web 与 Worker 指向 `/opt/revolution/releases/b80a728/revolution`。DB `74c365fb4f00...`、Embedding `1d156d6ffd16...` 与 Edge `df8eba464f76...` 在切换前后保持同一容器，本次只重建 Web/Worker；五个容器 restart count 均为 `0`。
- migration `001–007`、grants、AI runtime 权限门禁和两轮 ingest 均通过；生产公开知识为 41 documents / 48 chunks，48/48 chunks 均带 `projectSlug` 与 `topicIds`，两轮 ingest 都是 0 更新、41 documents 跳过。
- 公网 live、ready、兼容 health、根页、作品页、`/admin` 与 `/admin/api` 均为 HTTP 200；未登录 Provider runtime、turn list、简历文件和简历授权接口均为 HTTP 401；`release:smoke` 返回 `{"ok":true}`。公网 ICO 的 SHA-256 与 commit 文件一致，公网 SVG 的 Git blob 与 `b80a728:app/icon.svg` 一致。
- 生产 Web 环境为 `OPENAI_REASONING_EFFORT=high`、`MORSE_MAX_OUTPUT_TOKENS=1200`、Chat v2 enabled、canary 100%，hedging 与 safe mode 关闭。但活动数据库主线路仍优先使用不可变模型版本中的 `high / 30000`；因此 `1200` 尚未成为主线路实际值，必须由管理员创建并真实测试新模型版本后再激活，不能绕过测试门禁直接修改历史版本。
- 冻结归档为 19,123,456 bytes，SHA-256 `db4eaf79129008b5698427e396b7ef41e8fdfc927fec40d6d93f437ce845c8ae`；本地与服务器上传哈希一致。发布没有管理员登录、邀请码创建或真实 Chat/Bocha/Feishu 调用，最近十分钟 Web、Worker、Edge 与 DB 的错误关键词计数均为 `0`。
- `revolution-web:rollback-11ce329` 与 `revolution-worker:rollback-11ce329` 保留为本次应用回滚镜像；回滚后仍需复验 live、ready、未授权边界和 release smoke。

## 历史生产状态（2026-07-25）

- 状态：`PRODUCTION_OBSERVED / CHAT_PROJECT_COLLECTION / USER_CONVERSATION_NOT_RERUN`，当前应用 release `11ce329`。
- `/opt/revolution/current`、Web 与 Worker Compose working directory 指向 `/opt/revolution/releases/11ce329/revolution`。Edge、DB 与 Embedding 延续既有容器；三者的完整容器 ID 在切换前后保持不变，本次未重建。
- Web、DB 与 Embedding 为 healthy，Worker 与 Edge 为 running；五个容器 restart count 均为 `0`。公网 live、ready、兼容 health、根页、作品页、`/admin` 与 `/admin/api` 均为 HTTP 200，未登录 Provider runtime、turn list、简历文件和简历授权接口均为 HTTP 401，`release:smoke` 返回 `{"ok":true}`。
- 本次冻结归档为 19,115,703 bytes，SHA-256 `3055b710accfbad71685b280f0af182ed6d1f2abbf10d6f020501cf2a3eb3936`；本地与服务器上传哈希一致。只重建 Web/Worker，生产环境文件、Provider 路由、数据库、公开知识、Embedding、Edge 与私密简历密文卷均未修改。
- 发布流程没有登录管理员，没有创建邀请码，没有调用 Chat、Embedding、Bocha 或 Feishu Provider。最近十分钟 Web、Worker、Edge 与 DB 的 `error|exception|panic|fatal|unhandled` 关键词计数均为 `0`。
- `revolution-web:rollback-43cbcf6` 与 `revolution-worker:rollback-43cbcf6` 保留为本次应用回滚镜像；回滚后仍需复验 live、ready、未授权边界和 release smoke。

## 历史生产状态（2026-07-23）

- 状态：`PRODUCTION_OBSERVED / ANSWER_RELEVANCE / CANARY_0`，当前应用 release `74be589`，私密简历已启用并保持受控访问。
- 实例：`lhins-0oly57x8`；`/opt/revolution/current`、Web、Worker 与 Edge Compose working directory 指向 `/opt/revolution/releases/74be589/revolution`；DB 保持 `e5f9210`，Embedding 保持 `e56e457`，二者均未在本次无 migration 发布中重建。公网 live/ready 均为 HTTP 200。
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

仍需保持诚实边界：监控、托管备份与恢复演练、独立 edge 速率/连接限制、真实 Bocha/Feishu smoke、依赖 advisory 处置和更多国内网络可达性复核尚未完成。2026-07-25 生产 `npm ci` 报告 3 个 high，未执行未经评估的自动修复。首页 Warp Tunnel、五项目页面与公开知识已进入生产；本地忽略目录和归档素材没有进入冻结 release。

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

回答可靠性版本沿用平台手册的串行共享预算：协议事件 25 秒、模型正文 40 秒、Provider 阶段 80 秒、完整 turn 90 秒，normal 与仅由真实 Provider、协议或超时故障触发的 failover 合计最多 3 个 attempt。内容质量不得触发第二次调用、strict、reset 或节点切换。生产预检必须核对这些值的严格顺序；节点切换只消费剩余预算，不得因切备用重新获得 80 秒，评审期间不得启用 hedging。

1. 首次发布设置 `MORSE_CHAT_V2_ENABLED=true`、`MORSE_CHAT_V2_CANARY_PERCENT=0`、`MORSE_CHAT_V2_CANARY_INVITE_IDS` 留空、`MORSE_CHAT_HEDGED_FAILOVER_ENABLED=false`、`MORSE_CHAT_SAFE_MODE=false`，发布后先证明没有 Session 进入 v2。
2. 新管理 UI 可用后，在 `/admin` 创建专用聊天邀请码。一次性明文只保留在当前浏览器内；当场复制后台显示的非敏感灰度 UUID，白名单不使用邀请码明文。
3. 把该实际 UUID 直接写入 `/opt/revolution/shared/.env.production` 的 `MORSE_CHAT_V2_CANARY_INVITE_IDS`，使用不回显值的 UUID 格式检查后只重启 Web；不得使用环境变量占位符、`$` 引用或尖括号占位值代替实际值，不得在终端输出、日志或截图中记录该值。
4. 保持 hedging 关闭，完成已授权的固定 20 轮真实输出评审。至少 18/20 通过；私密信息泄露、虚构个人事实、无 JD 生成适配结论和自由对话错误调用 RAG 均为零容忍。评审遥测只保留 case id、路由/依赖计数、attempt 状态与时延和脱敏评分，不保留 raw prompt、回答或 Provider payload。通过后再单独启用 hedging 做故障注入，并分别记录调用数、延迟和失败原因。
5. 白名单观察通过后，依次设置 `MORSE_CHAT_V2_CANARY_PERCENT=25` 和 `MORSE_CHAT_V2_CANARY_PERCENT=100`；每次只重启 Web，复验 live、ready、公开页面、v1 会话和目标 canary 行为后再继续。
6. 人格或证据异常时设置 `MORSE_CHAT_SAFE_MODE=true`，运行时 safe mode 优先于已开启的 hedging；成本异常时只设置 `MORSE_CHAT_HEDGED_FAILOVER_ENABLED=false`；隐私问题时设置 `MORSE_CHAT_ENABLED=false`。每次切换后只重启 Web 并复验，不改数据库。
7. `005` / `006` / `007` 均为 additive migration，不执行 down migration；`006` 只增加并回填非敏感邀请备注快照，`007` 只增加路由锚点、证据分类、attempt 模式与分段延迟字段。Readiness 要求数据库 registry 与镜像内 migration manifest 完全一致，因此 registry 已有 007 后只能切换到包含 007 的兼容镜像；不得回切 pre-007 镜像，不删除迁移或数据。

所有 Chat v2 变量都是服务端配置，禁止增加 `NEXT_PUBLIC_` 前缀。生产预检必须拒绝 canary 超界、非 UUID、备用节点缺 key 或缺 URL、未解析引用和尖括号占位值；预检不调用 Provider，也不回显灰度 UUID、Provider URL 或 key。

## Controlled Context Packet V2.2 单邀请码 canary

该发布使用独立 Context Packet 灰度，不修改当前 Chat v2 100% 状态、活动 Provider route revision 2、safe mode、hedging、RAG 或私密简历。腾讯云实例的受控顺序如下：

1. 冻结并上传 Git commit 归档，核对本地/远端 SHA-256；切换前确认 `/opt/revolution/current`、五容器 identity/health/restart count、migration manifest、41 documents / 48 chunks、活动 Provider route、零长事务、PostgreSQL TLS 与回滚镜像。`001-011` 进入首次迁移路径，`001-012` 且 release 不含新 migration 进入 correction 路径；其他 manifest 立即停止。
2. 仅首次迁移路径停止 Web/Worker，创建 `/opt/revolution/shared/backups/pre-<release>-<UTC>.dump`，要求非空、mode `0600` 且记录 SHA-256，再使用 `--no-deps` 执行 migration `012`、grants 和 runtime 权限验证。correction 路径只校验现有 pre-release 备份可读、manifest 与 grants，不重复停写、备份、migration 或 ingest。migration 前向追加，不执行 down migration。
3. 在 `/opt/revolution/shared/secrets/context_packet_digest_key` 生成独立 32-byte Secret，owner `1001:1001`、mode `0600`，只挂载给 Web。共享环境设置 `MORSE_CONTEXT_PACKET_DIGEST_KEY_ID`、12k/24k 预算、Context Packet enabled、canary percent `0` 与空白名单。
4. 只构建/重建 Web、Worker，不运行 ingest，不重建 DB、Embedding、Edge。空白名单下先验证 ready、manifest `001-012`、grants、固定 Mock 失败链、公网 smoke、容器身份和错误日志。
5. 创建一个 1 小时、最多 1 个 Session 的专用测试邀请码，只把其非敏感 UUID 写入 `MORSE_CHAT_CONTEXT_CANARY_INVITE_IDS`，百分比始终保持 `0`，只重启 Web。逐轮重放 `tests/fixtures/controlled-context-failure-chain.ts` 中已脱敏的 5 条消息，不得合并、增补、改写或用其他问题替代；每轮来源按当次真实 BGE 分数与 direct-first 规则核验，不得假设固定 Top-3。最多发送 5 次真实 Provider 主回答。
6. 只记录脱敏 manifest、Task Frame 状态、来源 ID、attempt 状态/时延及同 turn packet/request HMAC 一致性，不记录原始问答、邀请码明文、Provider payload、Key 或 URL。完成后停用邀请码、清空白名单、保持 percent `0`，只重启 Web并复验全部健康与日志门禁。

异常时只关闭 `MORSE_CHAT_CONTEXT_PACKET_ENABLED`、清空白名单并重启 Web；保留 migration `012`、Secret 和数据。回滚镜像必须识别 `001-012`；禁止使用 pre-012 镜像，当前 correction 的最低兼容回滚 release 是 `9c13490`。未经新的当前授权，停止在单邀请码 canary，不进入 10% 或更高灰度。

## 发布边界

- 只发布已冻结的 Git 提交，不从脏工作区复制文件。
- 公网只开放 `80/443`；PostgreSQL、BGE 和 Next 内部端口不映射到宿主机。
- `web`、`worker`、`migration`、`ingest` 使用不同数据库连接角色。
- BGE 只通过 Docker 内网访问。`MORSE_EMBEDDING_ALLOW_PRIVATE_HTTP=true` 只允许内部单标签主机名或 RFC1918 地址。
- `MORSE_ALLOW_TEST_EMBEDDINGS=true`、`MORSE_LOCAL_RELEASE_SMOKE=true` 不能出现在生产角色环境。

## 容器健康检查、资源限制与日志轮转

仓库内 `compose.production.yaml` 声明以下运维配置；已随 release `95a85ea`（2026-07-26 第二次发布）套用到生产：

- Worker healthcheck：Worker 进程在每轮迭代开始把时间戳写入 `MORSE_WORKER_HEARTBEAT_FILE`（Compose 固定为 `/tmp/worker-heartbeat`），healthcheck 用 `find -mmin -3` 检查心跳 mtime 在 3 分钟内。阈值依据：正常轮询 5 秒一轮，基础设施退避上限 60 秒（`MORSE_WORKER_BACKOFF_MAX_MS`），3 分钟覆盖连续退避仍存活的场景，只有主循环真正停滞才判定 unhealthy。
- Edge healthcheck：`nc -z 127.0.0.1 80 && nc -z 127.0.0.1 443`，只探测 Caddy 本地端口存活，不发起 TLS 请求、不产生访问日志。
- 资源限制（宿主按 4GB 内存预算的保守分配，实例规格如有变化按本手册实测值调整）：db `768m / 1.0 cpu`（`shared_buffers=256MB` + 连接开销）、embedding `1g / 1.0 cpu`（CPU BGE 模型驻留内存最大头）、web `1g / 1.0 cpu`（Next.js 运行时）、worker `512m / 0.5 cpu`（轻量轮询进程）、edge `256m / 0.5 cpu`（Caddy）。常驻五服务上限合计约 3.5GB，为系统与一次性角色（migration/ingest/grants）留余量；一次性角色不设限制，只随命令短暂运行。
- 日志轮转：全部服务统一 `json-file` driver，`max-size: 10m`、`max-file: 3`，单容器日志磁盘占用上限 30MB。
- 邀请码防刷：Compose 给 Web 注入 `MORSE_INVITE_TRUSTED_PROXY_HOPS=1`，对应站点在 Caddy 单层反向代理后的拓扑；若未来在 Caddy 前增加新的代理层，需同步调整该值。生产预检对 web 角色强制该值 ≥1，缺失时以 `PRODUCTION_INVITE_PROXY_HOPS_REQUIRED` fail-closed。
- Chat 窗口节流：下一次部署起默认生效「每会话 60 秒内最多 10 条用户消息」（`MORSE_CHAT_WINDOW_SECONDS` / `MORSE_CHAT_WINDOW_MAX_MESSAGES` 可调，1–3600 秒 / 1–100 条，无关闭档）。这是行为变更而非可选项；超限访客收到引导等待的提示且不扣减会话额度。

限制值高于当前观察负载，OOM kill 或 CPU 饱和时先查异常原因，再考虑调档；不要用调大限制掩盖泄漏。healthcheck 判 unhealthy 仅是可观测信号（`docker compose ps` 可见），plain compose 不会据此自动重启容器。

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

Git 归档会保留 `deploy/secrets/.gitkeep` 与 `deploy/postgres/tls/.gitkeep`，因此解压后这两个路径最初是目录。必须先确认目录内只有受控占位文件，再删除占位目录并让路径本身分别链接到 `/opt/revolution/shared/secrets` 与 `/opt/revolution/shared/postgres/tls`；随后以不回显内容的 `test -f` 检查 Secret、证书和私钥。不得直接对现存目录执行 `ln -sfn`，否则链接会被创建在目录内部，Compose bind mount 将在服务重建时失败。

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

迁移完成后 `grants` 会撤销 migration 角色的临时超级用户权限；随后必须在受控 psql 会话执行 `deploy/postgres/verify-ai-config-runtime.sql`。重复执行 migration 和 ingest 应分别保持幂等，第二次入库应跳过未变化内容。migration `009` 使用事务内普通 `CREATE INDEX`，生产执行前必须进入维护窗口或受控停写，并确认没有长事务；当前 runner 的单文件事务是失败回滚边界，不得直接把该文件改成 `CREATE INDEX CONCURRENTLY`。migration `011` 对 canonical `008` 为 no-op；只有 checksum 和旧七列结构都精确匹配时才修复历史 Task State，任何其他漂移都必须在应用 `009` 前停止发布。migration `004` 应用后只允许回退到识别 004 的 Stage 1 兼容镜像，禁止切回只认识 001-003 的版本。私密简历首次部署必须先保持 `MORSE_RESUME_ENABLED=false` 完成上述序列，核对 migration `003` checksum、runtime grants、live/ready 和公开 release smoke，再在单独授权下切换开关并只重启 Web/Worker。

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
