# 正式站 v1 · Task Center(唯一运行事实源)

> Goal:Next.js 正式站 v1 上线就绪(vercel.app 部署由摩斯执行)。聊天仅报节点,本文件为准。
> 启动:2026-07-08 · 授权:装依赖(契约内)/ 本地 git init+commit / 只读四外部资产 · 模式:Morse 开发模式 + morse-goal 自动化运行

## current_pointer
**HANDOFF → Codex**(S3 起由 Codex 侧 morse-development-mode 执行,见 handoff-to-codex.md)

## next_allowed_pointer
Codex:S3 → (S5 若终审完成) → S6 自检 → 交回 Claude Code 侧最终验收

## 本轮收尾状态(2026-07-08,Claude Code 侧停机点)
- S2 终态评审 PASS(参数逐字段零漂移/降级链完整/边界干净/一条非阻塞:WEBGL_lose_context 兼容性记录)
- CEO 视觉门双宽 PASS + reduced-motion 真静止 + 控制台零报错(favicon 已补)
- git 6 commits 全部落库,工作区仅剩 docs/task-center 与 docs/verify/v1 待随交接 commit
- dev server 已关;验收工具归档 docs/task-center/tools/visual-gate.mjs

## Stage Package
- [x] S0 盘点:环境全绿(Node24/npm11/registry 通),e:\Revolution 原非 git 仓库已 init
- [x] S1 骨架:Next.js@16 + TS + token 迁移 + CLAUDE.md v2 + 2 commits —— 评审进行中
- [ ] S2 首屏:速览层 + 数字人占位组件(视频源可配)+ 光球氛围层移植(React 化)
- [ ] S3 滚动叙事框架 + 展厅 + 账本 + 简历模式(GSAP 契约内新增依赖)
- [ ] S4 数据管线:scripts/collect-stats.mjs(git log + CC/Codex 本地记录 → JSON;TDD 适用)
- [ ] S5 内容注入 + 数字摩斯口吻统一(依赖 M1 终审产出;未终审内容一律占位)
- [ ] S6 终验收:build + 1440/390 CDP 截图视觉门(硬规则15)+ Lighthouse + reduced-motion + closeout
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
- Stop/escalate:预授权外动作、BLOCKER 修复两轮仍不过、M1 终审阻塞 S5(则完成 S6 前置项后停)、破坏性操作需求
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
### S1(2026-07-08)
- Changed:package.json/tsconfig/next.config.mjs/.gitignore/app/{layout,page,globals}/app/styles/tokens.css/CLAUDE.md
- Verify:`npm run build` PASS(Turbopack);dev 冒烟 GET / 200;`diff tokens` 逐字节一致(CEO 亲验);git log 2 commits(CEO 亲验)
- Review:**PASS**(独立评审:commit 范围/依赖/外链零命中/token 逐字节/tsconfig 无危险项/build 亲验全过)。非阻塞:①task-center 与 content/drafts 未入版本控制,后续阶段决定;②dev 冒烟以实现方自述为准(build 已独立复验)
- FOLLOW-UP:npm audit 2 moderate(间接依赖,契约外未处理,S6 收尾统一决定)

## 摩斯的人工队列(不阻塞工程线)
1. content/drafts/ 终审(阻塞 S5 真实内容注入)
2. 录数字人素材 + 可灵/豆包训练(阻塞占位点亮,不阻塞 v1)
3. Vercel 部署(S6 后)
