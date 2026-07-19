# Revolution

数字生命摩斯个人作品集正式站。项目使用 Next.js App Router + TypeScript，样式采用 CSS Modules 与全局设计 token。

## 当前状态

- S3 滚动叙事、系统展厅、杠杆账本与简历模式已完成。
- S4 本地统计管线已完成，真实数字来自 `content/stats.json`。
- S5 安全内容基线已完成；S7 已将内容缺口和联系占位退出 live 页面。
- `content/drafts/` 仍是待摩斯终审的草稿，未终审内容不得导入线上内容。
- S6 上线前验收已完成：测试、生产构建、1440/390 双宽、触控、减弱动画、简历打印与 Lighthouse 均已通过。
- S7 多页作品集已完成：首页、作品索引、四个项目案例、共享导航/页脚/简历入口和唯一公开内容源均已进入正式站。
- S8 智能客服文字对话闭环已完成并进入 `origin/master`：三类访客意图、失败补偿、幂等重放、公开来源、可恢复重试、双宽浏览器验证和分层评测均已通过。
- S9 Morse 作品集重设计已完成并进入 `origin/master`：首页以 `Morse` 为主身份，作品集改为四项目单页折叠；企业内部项目只公开获批的脱敏事实与示例媒体，不提供系统访问入口。全视口首屏、1440/390 双宽、减弱动画和 Lighthouse 门禁均已通过。
- S10 数字摩斯智能客服已达到 `MAINLINE_PROVIDER_READY / CHAT_UX_LOCAL_READY`：访客三流程、自动搜索、管理后台与离线评测完成；19/19 Mock E2E、1440/390 真实浏览器、543/543 零 skip 全量测试、BGE/pgvector 语义评测和 19/19 生产构建均已通过。2026-07-17 针对中转 WAF 和易变模型目录加入显式兼容 User-Agent，并以 Provider 当前可用模型配置完成验收；随后修复默认问题只填框、等待态仍显示建议、Markdown 源码外露、来源编号不清和 OpenAI-compatible 中转间歇性空输出/502。聊天区已扩大；正文“依据”和底部来源统一遵循不打断合同：当前页资料静态显示，项目案例和联网资料在新标签页打开，不能改变当前对话 URL、消息或 transcript 滚动位置。Responses 只有在尚未输出正文且属于空完成、incomplete 或明确瞬时 HTTP 状态时才进行最多 3 次总尝试，永久 4xx、显式 failed/error 和已有部分回答均不重试。空完成或 incomplete 轮次如返回 usage，会计入最终真实用量。最新持久化 usage 证据 turn `e9d03006-2cbd-40dd-a31c-1cd65c6b6e45` 到达 SSE `done` 和数据库 `completed`，usage 为 5766 输入 / 102 输出 token；本轮另有三个真实浏览器 turn `45d91a62-38b9-4505-9a80-5e7b563a2cb2`、`3023fc9a-af03-45e0-91c6-3994022a1fc5` 与 `389f9ccd-9f42-451f-a641-050bad5f1106` 均为 `completed`，额度各从 30 降到 29；最新一轮延迟 15706ms、5 个检索来源、`used_search=false`。中转未返回 usage，费用保持未知。真实博查/飞书未验收；S10 当时未部署，当前生产状态以 S11 条目为准。
- 管理员固定入口为 `/admin`，不出现在公开导航；生产使用独立管理员密码登录，有效管理 Session 内可生成和停用邀请码，导出私有数据时重新输入密码。安全边界仍包括 scrypt、五次失败锁定、30 分钟 Strict Session、精确 Origin 和服务端权限校验。
- S11 生产部署已于 2026-07-18 达到 `PRODUCTION_OBSERVED / LIMITED_LAUNCH`，并在 2026-07-20 将首页 Warp Tunnel、五项目作品集和生产知识更新到 `44ed094`：`aimorse.tech` 与 `www.aimorse.tech` 的 Caddy/HTTPS、Web、Worker、PostgreSQL/pgvector 和 CPU BGE 均在运行；生产 migration、最小数据库 grants、公开知识摄取、历史真实 Provider smoke、live/ready 与 release smoke 已通过。
- 内容创作 Agent、自动运营 Agent、深度研究 Agent、数字摩斯与 AI 外贸获客系统的简洁页面、正式主图和展开详情均已进入生产 Web；五张主图、公网页面和健康接口均为 HTTP 200。
- 生产 RAG 已全量收敛到 40 documents / 47 chunks；本轮首轮摄取更新 10 documents / 16 chunks，第二轮 0 更新、40 documents 跳过。生产 BGE + pgvector 的 46 条 gold 为 top-1 36/46、top-3 46/46，正负阈值均通过；本轮未调用真实 Chat Provider。
- AI 外贸获客系统的作品集页面、真实 Graphite 总控台主图、五段详情和六个主题知识已经上线。这里的“上线”只指 Revolution 作品集与公开知识发布，不改变源系统仍是本地 MVP 的状态，也不宣称规模化获客成果。
- 首页 Warp Tunnel 已合并、推送并在生产环境完成双宽浏览器观察；生产 Lighthouse 13.4.0 的移动端与桌面端 Performance 均为 99，已满足 `>= 90` 门槛。
- 当前仍不标记 `ONLINE_READY`：监控、托管备份与恢复演练、edge 速率/连接限制、真实 Bocha/Feishu smoke、moderate dependency advisory 处置及更多国内网络可达性复核仍待完成；剩余工作区改动与未跟踪证据未复制到服务器。
- M3-RAG 基础能力继续复用短期邀请码、PostgreSQL + pgvector、OpenAI 适配层、SSE、短期会话和费用门；本地 BGE 语义向量已接入。S8 的 3 次历史 `runChat` 未完成，但已由 2026-07-17 的 S10 真实 Provider 全链 PASS 更新当前结论；历史失败记录不删除，也不由 Mock 替代。
- 本次部署为用户明确授权的生产发布；后续 push、再次部署和远端变更仍需单独授权。

## 本地运行

```powershell
npm ci
npm run dev
```

开发服务默认位于 `http://localhost:3000`。

## M3-RAG 本地运行

先按 `.env.example` 准备 `.env.local`。`OPENAI_CHAT_MODEL` 使用 API 项目实际可用的模型 ID；费用单价必须按所选模型当前价格填写，不能把 ChatGPT/Codex 订阅当作 API 额度。

Chat 与 Embeddings 可使用不同的 base URL 和密钥。本地 Embeddings 服务复用现有 Python 环境中的 `torch`、`sentence-transformers` 和 `numpy`，首次启动只下载 `BAAI/bge-small-zh-v1.5`：

```powershell
$env:MORSE_EMBEDDING_DEVICE = 'auto'
E:\AI\Python\python.exe scripts\local-embedding-server.py
```

服务只监听 `127.0.0.1:18091`。`auto` 仅在当前 PyTorch 支持 CUDA 时使用显卡，否则明确降级为 CPU；可通过 `http://127.0.0.1:18091/health` 核对实际设备。若本机无法直连 Hugging Face，首次下载可临时设置 `HF_ENDPOINT=https://hf-mirror.com`，模型进入本地缓存后不再依赖镜像运行。

```powershell
npm run db:up
$env:DATABASE_URL = 'postgresql://revolution@127.0.0.1:55432/revolution'
npm run db:migrate
npm run knowledge:ingest
npm run rag:eval
npm run dev
```

创建一个 72 小时、最多 3 个会话的短期码。脚本只保存哈希，也不会回显邀请码：

```powershell
$env:MORSE_NEW_INVITE_CODE = Read-Host '输入短期邀请码'
npm run invite:create -- --label '2026-07 activity' --hours 72 --max-sessions 3
Remove-Item Env:MORSE_NEW_INVITE_CODE
```

定期清理过期短期会话：

```powershell
npm run session:cleanup
```

`MORSE_ALLOW_TEST_EMBEDDINGS=true` 只用于本地 pgvector 集成验证，生产环境禁止开启。它能验证迁移、摄取、幂等和 top-k 查询，但不能作为语义召回质量证据。

当前受控访问、低并发和小规模知识库继续使用 PostgreSQL + pgvector，不额外部署 Milvus/Qdrant。只有基准测试证明检索延迟或写入吞吐不达标，或出现独立扩缩容、多租户强隔离、专用混合检索需求时，才评估外置向量库。

`GET /api/health/live` 只报告进程存活；`GET /api/health/ready` 与兼容入口 `GET /api/health` 只返回通用 `{ "ok": true|false }`，并以运行配置、数据库、migration checksum 和非空公开知识为就绪条件，不公开 Provider、费用、表名或 chunk 数。完整生产边界见 `docs/runbooks/production.md`。

部分 OpenAI-compatible 中转会拦截 SDK 默认 User-Agent。仅在模型列表用默认 SDK 请求返回 403、而同凭据的受控兼容请求返回 200 时，设置 `OPENAI_COMPAT_USER_AGENT`；值必须是单行且不超过 256 字符。2026-07-17 本地直连验收使用 `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Revolution/1.0`，该值不含秘密，但属于当前中转兼容配置，部署时仍需重新验证。模型 ID 必须以中转实时 `/models` 返回为准，不能把某次目录快照当作持久事实。

## 验证

```powershell
npm test
npm run chat:eval
npm run rag:eval
npm run build
```

UI 改动还需检查 1440 与 390 双宽、浏览器控制台、横向溢出和 `prefers-reduced-motion`。Lighthouse 性能分数需在上线前达到 90 以上。

S6 最终验收证据位于 `docs/verify/v1/s6-*`；桌面 Lighthouse 性能分数为 100。
S8 最终验收与真实/Mock 证据边界位于 `docs/verify/s8/s8-closeout.md`。
S9 最终验收、公开内容边界与主线吸收记录位于 `docs/verify/s9/s9-closeout.md`。
S11 腾讯云生产部署证据与剩余边界位于 `docs/verify/s11/production-closeout.md`。
内容创作 Agent 项目简介、主图、知识主题与双视口验收记录位于 `docs/verify/content-agent/content-agent-closeout.md`。
自动运营 Agent 项目简介、主图、知识主题与双视口验收记录位于 `docs/verify/auto-operations/auto-operations-closeout.md`。
数字摩斯项目简介、主图、知识主题与双视口验收记录位于 `docs/verify/digital-morse/digital-morse-closeout.md`。
深度研究 Agent 项目简介、主图、知识主题与双视口验收记录位于 `docs/verify/deep-research/deep-research-closeout.md`。
AI 外贸获客系统本地展示、主图、知识主题与双视口验收记录位于 `docs/verify/ai-leadgen/ai-leadgen-closeout.md`。

## 目录

- `app/`：路由、页面入口与全局样式
- `components/`：正式站组件与 CSS Modules
- `content/site-content.json`：当前页面与 RAG 的唯一公开内容源
- `content/drafts/`：待人工终审内容，不直接上线
- `scripts/`：统计、测试与视觉冒烟脚本
- `db/migrations/`：M3-RAG PostgreSQL + pgvector schema
- `docs/portfolio-blueprint.md`：唯一需求源
- `docs/task-center/`：阶段状态与交接记录
- `prototype/`：冻结的静态原型，仅供参照

## 内容边界

- 缺失事实进入“内容缺口台账”，不补造联系方式、履历或量化效果。
- 真实数字必须来自可追溯的数据管线；占位内容必须明确标注状态。
- 不引入外部运行时字体、脚本或 CDN 资源。
- 不自动 push 或部署。
