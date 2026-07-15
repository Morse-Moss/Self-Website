# S9 Morse 作品集重设计 · Closeout

> 日期：2026-07-15
> 分支：`codex/s9-morse-portfolio-redesign`
> Baseline：`bf12596`
> Pre-closeout evidence HEAD：`bbfae20`
> Branch HEAD：`23c04ce`
> Mainline：S9 merge commit `1fb7e28` 已包含于本地与远端 `master`
> 结论：`MAINLINE PASS · PUSHED · NOT DEPLOYED`

## Outcome

S9 已完成 Morse 个人作品集重设计并进入本地与远端 `master`：首页以 `Morse` 为主身份，只展示两个可公开代表项目；`/works` 使用四项目单页折叠与 `/works#slug` 展开；两个企业内部项目只保留脱敏文字案例，无媒体、公开访问动作或部署信息；S8 的短期邀请码、流式回复、来源、停止、重试与错误状态文字对话继续保留。

2026-07-15 的首屏修订移除了 680px 桌面上限、900px 以下的自动高度覆盖和 640px 以下的额外高度扣减。首页 hero 现在在所有验收宽度至少占满“视口高度减固定顶栏”，内容较高时自然撑开；身份与嵌入式文字对话作为整体垂直居中，下一节不再进入初始视口。

本轮没有开发数字人视频、语音、口型、字幕或音频控制，没有更换聊天 Provider，没有迁移 RAG / 向量数据库，没有调用真实 Provider，也没有部署。

## Git Boundary

- S9 基线：`master@bf12596`。
- Task 7 最终 gates 与 closeout 提交前 HEAD：`bbfae20`。
- 安全修复：`4cce515 fix: remove unsafe public CTA wording`。
- 首轮统计刷新：`051562d chore: refresh development stats`。
- Canvas bounded clip 修复：`74d8efc fix: sample S9 canvas from CDP screenshots`。
- Fresh closeout 统计刷新：`bbfae20 chore: refresh development stats`。
- 全视口 hero 基础修复：`7ada37c fix: fill the Morse viewport`。
- 移动端垂直居中修复：`2c6666c fix: center the full-height Morse hero`。
- 分支最终证据 HEAD：`23c04ce test: refresh S9 full-height hero evidence`。
- 主线吸收：branch HEAD 经 merge commit `1fb7e28` 进入本地 `master`，随后已推送，远端 `master` 已包含 `1fb7e28`。
- 本文与 S6/S7 历史契约测试所在的 closeout commit 不在本文中自引用；准确 SHA 以 `git log` 为准。
- 当前结果已进入本地与远端 `master`；部署环境未改变。

## Change Inventory

相对 `bf12596`，首屏修订后的结果为 68 个路径；下面是完整分组清单，删除项已标注：

- `app/`（9）：`app/layout.tsx`、`app/page.tsx`、`app/styles/hero.module.css`、`app/styles/tokens.css`、`app/works/[slug]/page.module.css`（删除）、`app/works/[slug]/page.tsx`、`app/works/layout.tsx`、`app/works/page.module.css`、`app/works/page.tsx`。
- `components/`（21）：`components/MorseChat.module.css`、`components/MorseChat.tsx`、`components/ResumeMode.module.css`、`components/ResumeMode.tsx`、`components/ScrollEffects.tsx`、`components/home/MorseHomeSections.module.css`、`components/home/MorseHomeSections.tsx`、`components/home/RestoredHomeSections.tsx`（删除）、`components/site/MorseSignalCanvas.module.css`、`components/site/MorseSignalCanvas.tsx`、`components/site/ResumeSheet.tsx`、`components/site/SiteFooter.tsx`、`components/site/SiteHeader.tsx`、`components/site/SiteShell.module.css`、`components/site/SiteShell.tsx`（删除）、`components/works/CaseStudy.module.css`、`components/works/CaseStudy.tsx`、`components/works/ProjectCard.module.css`、`components/works/ProjectCard.tsx`、`components/works/ProjectGallery.module.css`、`components/works/ProjectGallery.tsx`。
- `content/`（3）：`content/chat-eval.json`、`content/site-content.json`、`content/stats.json`。
- `docs/verify/s9/`（7）：五张 PNG、`s9-lighthouse-desktop.json` 与本文 `s9-closeout.md`。
- `docs/superpowers/`（2）：`docs/superpowers/specs/2026-07-15-s9-full-viewport-hero-fix-design.md`、`docs/superpowers/plans/2026-07-15-s9-full-viewport-hero-fix.md`。
- `lib/`（4）：`lib/client/chat-scroll.ts`、`lib/server/public-knowledge.ts`、`lib/site-content.ts`、`lib/stats.ts`。
- 根配置（1）：`package.json`。
- 受限旧素材（1）：`public/works/auto-operations/login-workbench-2026-07-13.png`（删除；删除后仓库没有 `public/` 目录）。
- `scripts/`（12）：`scripts/chat-eval.mjs`、`scripts/collect-stats.mjs`、`scripts/collect-stats.test.mjs`、`scripts/lib/s9-cdp.mjs`、`scripts/s6-restoration.test.mjs`、`scripts/s7-contract.test.mjs`、`scripts/s8-chat-smoke.mjs`、`scripts/s8-contract.test.mjs`、`scripts/s9-cdp.test.mjs`、`scripts/s9-contract.test.mjs`、`scripts/s9-visual-smoke.mjs`、`scripts/site-content.test.mjs`。
- `tests/`（8）：`tests/chat-scroll.test.ts`、`tests/chat-ui-contract.test.ts`、`tests/public-knowledge.test.ts`、`tests/rag-eval-contract.test.ts`、`tests/routes-contract.test.ts`、`tests/site-content.test.ts`、`tests/site-shell-contract.test.ts`、`tests/work-asset.test.ts`。

## Statistics Cutoff

`content/stats.json` 由 `npm run stats` 生成，只包含聚合数字、日期和方法说明，不包含原始会话、消息、路径、密钥或个人内容。

- 已提交统计快照 `051562d` 的生成时间为 `2026-07-15T06:59:47.458Z`。
- Task 7 fresh `npm run stats` 生成时间：`2026-07-15T07:54:10.749Z`（Asia/Shanghai：2026-07-15 15:54:10）。该次真实聚合 diff 经独立复核后提交为 `bbfae20`，没有混入 closeout commit。
- Fresh Claude Code coverage：`2026-04-20` 至 `2026-07-15`；106 sessions、54 projects。
- Fresh Codex coverage：`2026-03-20` 至 `2026-07-15`；2662 sessions、19 projects。
- Fresh 合并口径：2768 sessions、67 normalized projects、最近 90 天 84 active days。
- 聚合结构白名单检查通过；`node --test scripts/collect-stats.test.mjs` 为 15/15 PASS。

## Automated Verification

- 历史契约 TDD：ASCII-only inline contract 对 `c350d53` 基线确认预期 RED，对修改后工作树确认 GREEN；`node --test scripts/s6-restoration.test.mjs scripts/s7-contract.test.mjs` 为 8/8 PASS。
- CTA 安全 TDD：加入 `/访问系统/` 后 `node --test tests/site-content.test.ts` 先得到 9 PASS / 1 FAIL，精确命中公开 JSON；等义改为“网站尚未部署，因此不提供公开访问入口。”后 10/10 PASS，数字摩斯 GitHub action 保持不变。
- Fresh `npm test`：215 total / 200 pass / 15 PostgreSQL SKIP / 0 fail。15 个 skip 均为 `DATABASE_URL` 缺失时的数据库集成用例。
- Fresh `npm run build`：PASS；Next.js / TypeScript 编译成功，page data 为 12/12。路由表包含 8 个路由模式：`/`、`/_not-found`、`/api/access`、`/api/chat`、`/api/health`、`/icon.svg`、`/works`、`/works/[slug]`；最后一个模式生成四个静态 slug 入口，入口只重定向到 Hash，不承载独立详情。
- Post-merge `master` fresh verification：`npm test` 保持 215 total / 200 pass / 15 PostgreSQL SKIP / 0 fail，`npm run build` 保持 12/12 页面，`npm run visual:s9` exit 0 且 `failures: []`、console/page error 0、外部运行时请求 0、所有横向溢出 0。
- `git diff --check`：PASS。Next 构建只造成 `next-env.d.ts` 换行漂移，经 EOL-normalized 内容相等验证后恢复，未提交。

## Public Safety Review

- 结构化内部项目检查：`content-agent` 与 `auto-operations` 均为 `disclosure: internal-redacted`、`media: null`、`actions: []`，exit 0。
- Live surface 扫描范围：`content/site-content.json content/stats.json app components lib`。`RUNNING|login-workbench|生产环境运行中|部署 commit|访问系统` 为 0 命中（`rg` exit 1）；本地绝对路径、`content/drafts` 和 `sk-...` 为 0 命中（`rg` exit 1）。仓库当前没有 `public/` 目录，因此没有把不存在路径传给 `rg`。
- 全 `content/` 原始扫描仍会命中 `content/rag-eval.json` 中“为什么还没有访问系统按钮”的测试问句，以及 `content/drafts/**` 的本地只读来源说明。这些分别是评估 fixture 和未终审草稿，不属于 live JSON 或运行时导入；`app components lib` 对 `content/drafts` 的 import 扫描为 0 命中。
- 未发现企业项目媒体、公开 CTA、生产入口、密钥或公开面本地路径。

## Browser And Visual Evidence

主 Agent 在 `74d8efc` 上独立 fresh `npm run visual:s9` exit 0：`failures: []`、`consoleErrors: 0`、`pageErrors: 0`、`externalRuntimeRequests: []`、所有视口 `horizontalOverflow: 0`；Canvas bounded 160×90 CDP clip 为 desktop variance `0.960395` / frame difference `0.078657`，mobile `375.900641` / `0.054074`，mobile reduced-motion `376.036358` / `0`。运行结束后 3010、worker、Edge 和临时 profile 均无残留。

修复实现 Agent 的第一次 live run 已取得合格 clip 与页面功能数据，但最终因一次 `browser:owned-cleanup-failed` exit 1，未被记作 PASS；主 Agent 随后独立重跑 exit 0 且清理后无残留，最终证据采用后者。

全视口 hero 修订后重新执行生产视觉门禁。`7ada37c` 的第一次运行页面几何全部通过，但 Windows profile cleanup 再次抖动；检查时发现两个受控 Temp profile，其中一个为此前遗留、一个属于本次运行。两个目录在无 Edge/worker 进程后通过项目边界校验删除，该轮未记作 PASS。独立复跑 exit 0；随后 `2c6666c` 的最终生产运行直接 exit 0、`failures: []`，desktop / mobile / mobile-reduced 的下一节均位于首屏下方，`consoleErrors`、`pageErrors`、外部请求和所有横向溢出仍为 0。最终 Canvas variance / frame difference 为 desktop `0.960395` / `0.078657`、mobile `375.843547` / `0.055023`、mobile reduced-motion `376.036358` / `0`。

人工逐张打开并检查以下五张 fresh PNG：

- `s9-home-desktop-1440x900.png`（1440x900）
- `s9-home-mobile-390x844.png`（390x844）
- `s9-home-mobile-390-reduced.png`（390x844）
- `s9-works-desktop-1440x900.png`（1440x900）
- `s9-works-mobile-390x844.png`（390x844）

检查结论：身份为 `Morse`，没有虚构人物头像；1440x900 与两个 390x844 首页截图都完整停留在 hero，分隔线和“公开代表作品”不再进入首屏；移动端身份、操作与对话区垂直分布均衡，没有用底部大空白假装占满。首页没有静态 FAQ、职业经历或完整四项目展厅；作品页截图为单项目展开状态，详情与分组技术栈可读；桌面与 390px 文本、输入、按钮和导航没有横向溢出或互相遮挡；reduced-motion 截图保持静态布局。自动浏览器门禁另行确认作品页有四张项目卡、同一时间只展开一项、Hash 同步以及 reduced-motion 下运行中动画为 0。PNG 当前展示的是公开的深度研究项目，内部项目不可见的无媒体/无动作状态由结构化检查与浏览器门禁证明，不把 PNG 表述成其直接证据。

Lighthouse 证据 `s9-lighthouse-desktop.json` 实际解析结果：2026-07-15 07:17:46（Asia/Shanghai）采集，Performance `1.00`，FCP `0.2 s`，LCP `0.5 s`，TBT `0 ms`，CLS `0`。

## Review Evidence

- Task 6 fresh 规格复审：`Spec compliant: Yes`；bounded 160×90 `Page.captureScreenshot` clip、双帧像素解码、variance / frame difference、normal / reduced-motion 判定均满足计划，Missing / Extra / Misunderstood 为 0。
- Task 6 fresh 质量复审：`Ready: Yes`；Critical 0、Important 0。唯一 Minor 是契约包含源码正则，但主 Agent live 主路径已覆盖，因此不阻塞。
- Task 6 最终双审为 2/2 PASS。

## Retained S8 Chat

S9 保留 S8 的真实文字对话组件与边界：首页为 embedded chat，作品页保留 overlay chat；短期邀请码、模式、流式回复、来源、停止、重试、错误与退出状态仍由现有测试覆盖。本轮没有用视频或语音包装文字对话，也没有调用真实 Provider 重新制造证据。

## Environment Gaps

- `DATABASE_URL` 未设置；PostgreSQL `127.0.0.1:55432` 未监听。
- 本地 embedding `127.0.0.1:18091` 未监听。
- 因此本轮没有验证知识库幂等重摄取、真实 pgvector 检索或真实 embedding 服务；这些不能写成已完成。
- 未调用 Provider、未写数据库、未部署；也未安装依赖、修改 schema 或写外部只读仓库。
