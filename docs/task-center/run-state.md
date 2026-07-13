# 正式站 v1 · Task Center(唯一运行事实源)

> Goal:Next.js 正式站 v1 上线就绪;当前增量为数字摩斯 M3-RAG MVP。聊天仅报节点,本文件为准。
> 启动:2026-07-08 · M3-RAG 启动:2026-07-12 · 授权:装依赖(契约内)/ 本地 Docker pgvector / 最多 3 次 OpenAI 冒烟 / 本地 git commit / 只读四外部资产 · 模式:Morse 开发模式 + morse-goal 自动化运行

## current_pointer
**M3-RAG MVP LOCAL COMPLETE**

## next_allowed_pointer
等待摩斯选择下一产品阶段。部署、push、mainline 合并、域名、联网搜索、语音和数字人口型不自动推进。

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
- Git boundary:实现提交 `5bdbd92 feat: add M3 RAG chat MVP`;未 push/deploy;`AGENTS.md`、研究报告、`output/` 和旧临时脚本均未进入提交。

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

## Preauthorization Matrix
| 项 | 状态 |
|---|---|
| npm install | allowed,仅各阶段契约列明包(S3:gsap) |
| git commit(本地) | allowed,英文 message+Co-Authored-By |
| git push / 部署 / 远程仓库 | forbidden(等摩斯) |
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
