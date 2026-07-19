# 深度研究 Agent 系统作品集信息完善 Closeout

## Outcome

- 日期：2026-07-19
- 模式：`STAGED / STANDARD / LOCAL`
- 状态：`LOCAL_READY / KNOWLEDGE_RECONCILED`
- 展示入口：`/works#deep-research`
- 本地验收入口：`http://127.0.0.1:3023/works#deep-research`
- 公开状态文案：`唯一开发者 · 核心研究链可用`

## Display Contract

- 折叠层使用两行简介、五个能力短词、真实状态、Operator Workbench 主图和展开按钮。
- 展开层严格使用“项目简介、核心能力、系统架构、我的技术实现、技术栈”五段。
- AI / Agent 技术栈展示 Responses API、NodeContract DAG、Tool Gateway 和角色化模型路由，不写具体模型名称。
- 项目详情保留“问数字摩斯”和真实 GitHub 仓库入口；公开文案不额外使用“开源项目”标签。
- Agent OS 内核、可审核生产记忆、分布式 Worker、语义级事实核验和领域研究方法库均标记为未来方向。

## Public Story

- 简介：本地优先的多 Agent 深度研究与报告系统，围绕研究问题完成方法发现、证据采集、横纵分析、质量审查与正式报告生成。
- 五个能力短词：横纵研究、证据台账、论断映射、缺口修复、发布审批。
- 技术归属：项目方向与研究方法吸收实际使用反馈、架构评审和外部系统研究；摩斯是项目发起人和唯一开发者，负责全部技术实现。
- 主图：`public/works/deep-research/operator-workbench-example.png`，尺寸 1440x1080，使用“运行界面 · 示例数据”角标。

## Knowledge

- 公共知识使用项目定位与价值、使用流程、核心架构、关键技术实现、个人技术贡献、未来方向六个独立主题。
- 六个主题和项目聚合文档统一链接 `/works#deep-research`。
- 公开知识提取不包含草稿、媒体元数据、操作入口、验证证据或当前边界。

## Verification

- `node --env-file=.env.local --test --test-isolation=none tests/works-presentation.test.ts tests/site-content.test.ts tests/public-knowledge.test.ts tests/work-asset.test.ts`：`31/31`，0 fail。
- `npm test`：`570/570`，0 fail，0 skip。
- `npm run build`：Next.js / TypeScript PASS，生成 19 个路由。
- 本地 production 页面 `GET /works`：HTTP 200；包含获批简介、主图路径和深度研究 GitHub 仓库入口。
- `docs/verify/deep-research/` 的 1440x900 与 390x844 折叠、展开截图均已人工复盘；简介保持两行，五个能力短词、状态和主图可读，展开详情无明显重叠或横向溢出。
- `py -3 scripts/deep-research-visual-smoke.py http://127.0.0.1:3023`：1440x900 与 390x844 均完成折叠、展开、GitHub CTA 和详情合同验证；两个视口横向溢出 0、console error 0、page error 0。
- `git diff --check`：本项目范围无 whitespace error；仅有 Windows 工作区的 LF/CRLF 提示。

## Changed Surface

- `content/drafts/system-deep-research.md`：已确认项目资料草稿。
- `content/site-content.json`：折叠内容、五段详情、技术栈、六主题知识、主图和 CTA。
- `public/works/deep-research/operator-workbench-example.png`：公开示例主图。
- `scripts/deep-research-visual-smoke.py`：双宽折叠、展开、内容、主图、CTA 与布局合同。
- `tests/works-presentation.test.ts`、`tests/site-content.test.ts`、`tests/public-knowledge.test.ts`、`tests/work-asset.test.ts`：展示、知识和资产合同。
- `docs/portfolio-blueprint.md`、`README.md`：当前需求口径与验收索引。

## Git And Release Boundary

- 本次 closeout 只吸收本文件“Changed Surface”列出的深度研究展示、知识、资产、测试与文档增量。
- 未部署、未创建 PR，也未修改外部项目 `E:\多agent\deep-research-agent`；push 不代表生产环境已更新。
- Content Agent、数字摩斯、页面样式、RAG 评测和其他验收资产属于并行线程，本轮均未回退或吸收。
