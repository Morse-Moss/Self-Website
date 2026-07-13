# Handoff → Codex(正式站 v1 · S3 起)

> 交接日期:2026-07-08 · 交接方:Claude Code 侧 CEO(Morse 开发模式)
> 接收方:Codex 侧,以 **morse-development-mode**(入口:`~/.codex/skills/morse-development-mode/SKILL.md`,canonical:`E:\Evolution\skills\morse-development-mode\SKILL.md`)继续开发
> 完工后交回 Claude Code 侧做最终验收(验收标准见文末)
> 状态事实源:`docs/task-center/run-state.md`(继续在其中记账);需求唯一源:`docs/portfolio-blueprint.md`

## Codex 回执(更新至 2026-07-13)

- S3 已由 commit `c978193` 完成:滚动叙事、系统展厅、杠杆账本、联系/页脚和简历模式。
- S5 安全内容基线已由 commit `0bbbdfc` 完成:关于、FAQ、内容缺口台账、保守公开文案和不可点击联系占位。
- S6 上线前终验收已由 commit `6cdf1a0` 完成:25/25 tests、生产构建、1440/390、触控、减弱动画、简历打印与 Lighthouse 100 全部通过。
- `content/drafts/` 未通过摩斯终审,仍未注入线上内容;后续终审增量不阻塞 S6。
- M3-RAG MVP 已在分支 `codex/m3-rag-mvp` 完成本地闭环:短期邀请码、pgvector、GPT Responses、流式来源、短期记忆和预算门由 `5bdbd92` 实现;本地 BGE 语义向量、独立 Chat/Embedding 配置与 gold eval 由 `3a9cba2` 完成。
- M3 最终证据:`npm test` 62/62(含 PostgreSQL 集成)、生产构建 PASS、`BAAI/bge-small-zh-v1.5` 真实向量 8/8 幂等、gold top-1 7/8 与 top-3 8/8。当前 PyTorch 是 CPU build,未把 GTX 1070 记成已验证设备。
- 当前允许指针:M3-RAG 本地阶段已结束,等待摩斯决定下一阶段。`master` 尚未吸收 `codex/m3-rag-mvp`;部署、push、mainline 合并、域名与终审内容增量均不自动推进。

## 已完成(勿重做,证据见 run-state.md)

| 阶段 | 产出 | 状态 |
|---|---|---|
| S0/S1 | Next.js 16 + TS 骨架、token 迁移(app/styles/tokens.css=唯一 token 源)、CLAUDE.md v2 | 评审 PASS |
| S2 | 首屏:速览层 + Lifeform 光球(React 移植,参数保真,三级降级链)+ DigitalHuman 占位组件 + app/icon.svg | 评审 PASS + CEO 视觉门双宽 PASS |
| S4 | scripts/collect-stats.mjs 数据管线(16 tests 全绿,隐私审计 PASS)→ content/stats.json | 评审 PASS |
| S3 | 滚动叙事、展厅、账本、联系/页脚、简历模式 | 已完成(`c978193`) |
| S5 | 安全公开内容、关于/FAQ/内容缺口台账、联系占位 | 已完成(`0bbbdfc`) |
| S6 | 上线前终验收、首屏假链接修复、统计刷新与验收证据 | 已完成(`6cdf1a0`,Lighthouse 100) |
| M1 | content/drafts/ 9 份公开知识库草稿 | 待摩斯终审(仅阻塞终审内容增量) |

git:本地 `master` 已包含 S3/S5/S6 回执所列 commits,但尚未包含 M3-RAG 分支 commits;**禁止自动 push/建远程/部署/合并**。

## 原阶段契约与当前状态(每阶段:契约→实现→独立评审→证据入账)

### S3 滚动叙事 + 展厅 + 账本 + 简历模式
- **允许新依赖:仅 gsap**(ScrollTrigger 做滚动驱动章节);此外零新依赖
- 章节化滚动叙事:首屏(已有,勿动其视觉)以下依次为——系统展厅、方法论/杠杆账本、联系/页脚;滚动触发的浮现动画,**电码节奏转场**(点划 motif,呼应 icon.svg 的 M=——)
- 展厅:三张系统卡(内容生成 agent/运营流水线/深度研究)+ 1 孵化位卡。卡片结构按蓝图 3.1 L1(痛点→方案→人机分工→状态);**本阶段文案用占位(标「示例数据」),真实文案 S5 注入**;深度研究卡留「试驾间回放·筹备中」入口
- 账本区:消费 content/stats.json 的真实数字(会话数/项目数/活跃天数,标注统计口径),其余数字一律「示例数据」标注
- 简历模式:右上角开关,全站切纸感可打印排版(参照 prototype/ 的实现意图),localStorage 持久,打印样式
- 全站第一人称「数字摩斯口吻」的**结构**就位(旁白文案槽位),正式措辞 S5 定稿
- 硬约束:`prefers-reduced-motion` 全降级(含 gsap 动画);移动端动画轻量;组件样式零裸色值;零外部资源;速览层首屏不滚动可见的既有验收不许回归

### S5 内容注入 + 口吻统一(安全基线已完成;终审增量待定)
- 安全基线只使用蓝图已确认事实和公开安全文案,已完成展厅、关于、FAQ、内容缺口台账与联系占位;缺失事实不编造。
- 摩斯终审通过前**不得**把 drafts 内容上线;终审后再按需替换对应占位,可溯源真实数字除外。
- 若终审暂未完成,保留安全基线并继续 S6;终审内容增量留给后续独立阶段。

### S6 收尾自检(Codex 侧完成后交回)
- 已完成:`npm run build` + `npm test`(25/25)全绿;`git diff --check`;控制台零报错;1440/390 双宽与触控自检;reduced-motion 真静止;简历模式与打印契约通过;桌面 Lighthouse 100。
- 证据:`docs/verify/v1/s6-{desktop-1440,mobile-390,mobile-390-reduced,resume-1440}.png` 与 `s6-lighthouse-desktop.json`。
- 遗留:部署/域名待摩斯指令;`content/drafts/` 终审增量独立排队;Next.js 间接 PostCSS 的 2 个 moderate 已按静态站威胁模型记录为残余风险,不采用自动建议的 Next 9 降级。

## 红线(与 CLAUDE.md 一致,逐条生效)
- 不 push、不部署、不建远程仓库;依赖仅限契约列明(S3=gsap)
- `prototype/**` 冻结只读;`docs/verify/**` 证据不动;`E:\Wiki`、`E:\demo2`、`E:\小红书`、`E:\多agent` 只读禁写
- token 只在 app/styles/tokens.css;密钥不进代码;commit 英文、语义清晰
- 不动 S2 已验收的首屏视觉(Lifeform 参数、布局)——需要改动先在 run-state.md 记决策理由

## 已知陷阱(省你六轮调试)
- 浏览器自动化验证三伪影:见 `E:\Evolution\skills\morse-development-mode\references\browser-verification-pitfalls.md`(幽灵滚动/touch 仿真/过期帧)
- 视觉自检可复用 `docs/task-center/tools/visual-gate.mjs`(Node 24 原生 WebSocket 直连 Edge :9222,dev server 3000)
- Node 24/Win:`node --test scripts/` 不可用,用 `npm test`(已配 glob 写法)

## 交回后的 Claude Code 侧验收清单(我会逐条查,提前自检可少一轮)
1. build/test 全绿(我亲自跑)
2. commit 边界:逐 commit diff 对照契约,契约外文件零改动
3. CEO 视觉质量门:1440/390 CDP 截图亲验(布局/信息不被特效遮挡/无碰撞)+ reduced-motion 双帧一致 + 控制台零报错
4. 滚动叙事在 390 触摸仿真下可用;简历模式开关+打印样式可用;无横向溢出
5. Lighthouse 性能 ≥90(蓝图验收标准)
6. stats.json 数字未被篡改为编造值;「示例数据」标注无遗漏
7. run-state.md 记账完整(阶段契约/评审verdict/验证输出)
