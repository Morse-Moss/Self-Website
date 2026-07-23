# Digital Morse Chat v2 release 集成账本

> 日期：2026-07-23
> 状态：`LOCAL_READY / RESPONSE_RELIABILITY / REAL_PROVIDER_NOT_RUN`
> 模式：`CEO / STAGED / CRITICAL / DEPLOYED`
> release 分支：`codex/chat-v2-release`
> release 集成基线：`2ae3ccc docs: record chat v2 local closeout`
> source 历史：`codex/private-resume-access` 的 Task 13 提交证据保留，不改写为 release 提交
> 主线：release merge `c7de64a` 已吸收此前 `origin/master=6e7e0ef`；功能 release `e56e457` 已推送到远端主线并完成 disabled-first 生产发布

## 2026-07-23 回答可靠性增量

- 对话先由轻量路由确定 `conversation / identity / grounded / jd / external_current / clarify` 等路径；只有需要个人事实或项目证据的路径才调用 Embedding 与 RAG。普通聊天、通用知识和职场建议不再默认注入项目资料。
- grounded 路径按明确项目名、受控跨轮锚点和相关性门槛准入证据；证据不足时不拼接无关本地摘要。多项目问题保留所有明确项目，公开“阿里邮箱 OpenAPI”实现问题不会被误判为索取私人联系方式。
- Provider 保持串行。25 秒无协议事件或 40 秒无模型正文时当前 attempt 失败并切到下一节点；Provider 阶段共享 80 秒、完整 turn 共享 90 秒，normal、strict 与 failover 合计最多 3 个 attempt，后续 attempt 只消费剩余预算。
- 最终候选回答经过直接性、证据支持、个人事实和历史长回答重复检查；守卫拒绝后最多做一次 strict 重生成，不把固定 RAG 模板或无关本地答案作为 Provider 失败兜底。
- 前端在原位显示路由、知识检索、回答组织和线路切换状态；等待态包含持续进度、停止操作和长等待提示，停止后沿用原 turn 的补偿与幂等语义。
- migration `007_chat_response_reliability` 只增加路由锚点、证据分类、attempt 启动/生成模式和三段延迟字段，不保存 raw prompt、回答或 Provider payload。

## release 集成结果

- Chat v2 的分层人格、证据型候选人陈述、社交对话、JD 匹配、需求初诊、回答守卫、节点切换、降级结果、原位恢复和后台邀请码备注归属已完成本地集成。
- v2 用量和成本由 `chat_provider_attempts` 聚合；Admin 历史快照继续使用 `interaction_provider_attempts`，两类持久化职责没有混用。
- v2 失败重试前不提前写 `usage_events`；完成、失败与停止的 Provider attempt 都先持久化，再进入终态或取消响应。
- v2 stopped/failed compensation 以事务内 `chat_provider_attempts` 汇总为权威；若部分 attempt 没有 usage/cost，只保留已知合计并将 completeness 标为 false，不生成完整估算成本。
- 本地 Mock E2E 的生产构建仍使用 `NODE_ENV=production`；运行态使用 `NODE_ENV=test`，且只放行精确的 `MORSE_PROVIDER_MOCK_ORIGIN`，没有放宽生产出站策略。
- 浏览器主清理增加 10 秒 deadline；超时后只终止并移除本次拥有的 profile，避免验收进程永久挂起。
- migration 编号为 `004_admin_api_management`、`005_chat_v2`、`006_interaction_invite_label`、`007_chat_response_reliability`；当前临时 PostgreSQL 从 001 到 007 完整登记。
- `OpenAIReasoningEffort` 保留为 `AnswerReasoningEffort` 的兼容类型别名，避免 release 集成破坏既有调用方。
- S9 历史合同不再要求新版 README 保留旧发布口号；S9 的 current pointer 不回退、历史提交、远端吸收、未部署和零 Provider 事实仍由 task-center、蓝图与 closeout 权威证据约束。

## 当前验证证据

- 合并最新 `origin/master` 后执行 `npm run build`：PASS；TypeScript PASS，Next.js 共 30 routes。
- runtime/Admin focused suites：31/31 PASS。
- migration/retention/Admin suites：34/34 PASS。
- `npm run chat:eval`：72/72 PASS，`externalCalls: 0`；结果不保存 raw prompt、回答或 Provider payload。
- 回答可靠性 focused：37 PASS、0 fail、3 个 PostgreSQL 条件用例按预期跳过；`npm run chat:eval` 为 72/72，`externalCalls: 0`。
- 专用 loopback PostgreSQL：migration 001–007 PASS；离线确定性 ingest 为 40 documents / 47 chunks；受影响的 Chat/Provider/RAG 集成门禁 93/93 PASS、0 skip。
- `npm run visual:s10`：26/26 Mock E2E checks PASS；1440x900 与 390x844；13 张截图；console error 0，page error 0，failure 0。
- 人工抽查桌面与移动 Chat/Admin 截图：非空、详情可滚动、无横向溢出或控件重叠，未包含真实问题、回答、邀请码、凭据或私密简历内容。
- 合并主线后的 `npm test`：863/863 PASS，0 fail，0 skip；环境显式指向专用 loopback 库，未使用旧 001–004 基库冒充 Chat v2 验证。该结果早于最终 stopped completeness 修正；修正后按用户要求不再重复全仓。
- 最终 stopped completeness 修正 RED/GREEN：`node --test tests/provider-runtime.test.ts` 为 5/5 PASS；新增用例证明一个已知 usage attempt 加一个无 usage 的 aborted attempt 会写入部分已知合计，并保持 `usage_complete=false`、`cost_complete=false`、`estimated_cost_usd=null`。
- `node --test scripts/s9-contract.test.mjs`：24/24 PASS；README 历史文案耦合已移除，剩余 S9 历史 invariant 保持。
- loopback Mock `rag:eval` 的 top-3 为 41/46，未达到正向阈值。该结果只说明哈希 Mock 不具备真实 embedding 语义质量，不得标记 RAG 质量通过，也没有触发真实 embedding Provider。
- 当前真实 Chat/Embedding Provider 调用数为 0。

## 持久截图

- `chat-v2-recruitment-desktop-1440x900.png`：SHA-256 `0774ef0b5f59c4b7595e8cdeac3465280ea305e80635b88ad08abffe3320abb6`
- `chat-v2-recruitment-mobile-390x844.png`：SHA-256 `0af6a8aef07fe79c2afcd0778ae7a3d06754cae1ef81c1707629ce8bc9ba604f`
- `chat-v2-switching-desktop-1440x900.png`：SHA-256 `92137423704b89d4a7bc4f7d6369e368265c42fddd7558c13fb3bdd0c56ec3a6`
- `chat-v2-pending-mobile-390x844.png`：SHA-256 `6bf4b433cf5333a8d42f370041016b3f15641e052d43346ebb1c4a7f05efe56e`
- `chat-v2-degraded-mobile-390x844.png`：SHA-256 `27bb527ca9f060b393635143c35c292512bb2b26efbb3550f836ee71f1e73c90`

截图均来自受控 loopback Mock，不构成真实 Provider 输出质量证据。

## CRITICAL 审查状态

- Compliance/Privacy：此前 source 实现审查已 PASS；release 集成保持私密简历与 Chat/RAG/日志/截图/评测隔离，未读取、上传或输出真实私密简历，未回显 Provider URL 或 key。
- Quality/Reliability：最终复审发现 `QR-REL-01` stopped attempt completeness blocker；失败优先集成测试修复后 correction delta 复审 PASS，无开放 blocker。
- 2026-07-23 回答可靠性复审：Compliance PASS；Quality 的 `QSR-01` 多项目别名/证据准入和 `QSR-05` 公开邮箱 API 误拦截均在 delta review 中 CLOSED，最终 PASS。

## 开放门槛

- 固定 20 轮真实 Provider 输出评审已获本轮授权，但必须等待本增量完成冻结提交、push、disabled-first 部署与生产观察后开始；不扩大灰度，不启用 hedging，不用 Mock 冒充真实输出质量。
- 2026-07-22 基线发布与 push 已完成，生产 closeout 见 `docs/verify/chat-v2/chat-v2-production-closeout.md`；2026-07-23 回答可靠性增量当前尚未 push 或部署，冻结提交与生产 revision 以实际 Git/生产观察为准。
- 生产发布按 disabled-first 执行：`MORSE_CHAT_V2_ENABLED=true`、canary 0%、空白名单、hedging 关闭、safe mode 关闭；migration 005/006/007 只向前执行，不做 down migration。
- disabled-first 部署只证明 v2 代码和 schema 已上线但流量为 0；真实 Provider 评审、邀请码白名单、25%、100% 以及 24/48 小时指标观察都是后续独立门槛。

## 交付边界

- 本账本保留 release 集成的本地证据；远端与生产事实以 `chat-v2-production-closeout.md` 为准。
- 生产仍运行 2026-07-22 的 disabled-first 基线；本增量当前只达到 `LOCAL_READY`，未创建评审邀请码、未调用真实 Provider。
