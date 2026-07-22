# Digital Morse Chat v2 release 集成账本

> 日期：2026-07-22
> 状态：`RELEASE_INTEGRATION_READY / DEPLOY_PENDING / REAL_PROVIDER_NOT_RUN`
> 模式：`CEO / STAGED / CRITICAL / DEPLOYED`
> release 分支：`codex/chat-v2-release`
> release 集成基线：`2ae3ccc docs: record chat v2 local closeout`
> source 历史：`codex/private-resume-access` 的 Task 13 提交证据保留，不改写为 release 提交
> 主线：当前本地 `master` 尚未包含 release 集成；吸收前必须刷新并合并最新 `origin/master`

## release 集成结果

- Chat v2 的分层人格、证据型候选人陈述、社交对话、JD 匹配、需求初诊、回答守卫、节点切换、降级结果、原位恢复和后台邀请码备注归属已完成本地集成。
- v2 用量和成本由 `chat_provider_attempts` 聚合；Admin 历史快照继续使用 `interaction_provider_attempts`，两类持久化职责没有混用。
- v2 失败重试前不提前写 `usage_events`；完成、失败与停止的 Provider attempt 都先持久化，再进入终态或取消响应。
- 本地 Mock E2E 的生产构建仍使用 `NODE_ENV=production`；运行态使用 `NODE_ENV=test`，且只放行精确的 `MORSE_PROVIDER_MOCK_ORIGIN`，没有放宽生产出站策略。
- 浏览器主清理增加 10 秒 deadline；超时后只终止并移除本次拥有的 profile，避免验收进程永久挂起。
- migration 编号统一为 `004_admin_api_management`、`005_chat_v2`、`006_interaction_invite_label`；临时 PostgreSQL 从 001 到 006 完整登记。
- `OpenAIReasoningEffort` 保留为 `AnswerReasoningEffort` 的兼容类型别名，避免 release 集成破坏既有调用方。

## 当前验证证据

- `npm run build`：PASS；TypeScript PASS，Next.js 共 30 routes。
- runtime/Admin focused suites：31/31 PASS。
- migration/retention/Admin suites：34/34 PASS。
- `npm run chat:eval`：72/72 PASS，`externalCalls: 0`；结果不保存 raw prompt、回答或 Provider payload。
- 临时 PostgreSQL：migration 001–006 PASS；确定性 ingest 为 40 documents / 47 chunks。
- `npm run visual:s10`：26/26 Mock E2E checks PASS；1440x900 与 390x844；13 张截图；console error 0，page error 0，failure 0。
- 人工抽查桌面与移动 Chat/Admin 截图：非空、详情可滚动、无横向溢出或控件重叠，未包含真实问题、回答、邀请码、凭据或私密简历内容。
- 全仓测试当前为 860/861；唯一失败为旧 `scripts/s9-contract.test.mjs` 对未来 Task Center pointer 的枚举约束。当前 `origin/master` 自身也会触发该旧约束；release 吸收最新主线后必须修正该历史 invariant，并以全仓 0 fail 作为发布门槛。
- loopback Mock `rag:eval` 的 top-3 为 41/46，未达到正向阈值。该结果只说明哈希 Mock 不具备真实 embedding 语义质量，不得标记 RAG 质量通过，也没有触发真实 embedding Provider。
- 当前真实 Chat/Embedding Provider 调用数为 0。

## 持久截图

- `chat-v2-recruitment-desktop-1440x900.png`：SHA-256 `70ea67766de4eab2b04c81448292858b993aad8534b643a40872e68a33ea7b9a`
- `chat-v2-recruitment-mobile-390x844.png`：SHA-256 `04892bd2056e9e9f6baa946fdef1678deea061e0b334e09059ef2f6a0c4f12c0`
- `chat-v2-switching-desktop-1440x900.png`：SHA-256 `5b35ac6e460a18a5e239cb626913f2532d04b2317308e5e24f10003f7ea5a01d`
- `chat-v2-degraded-mobile-390x844.png`：SHA-256 `27bb527ca9f060b393635143c35c292512bb2b26efbb3550f836ee71f1e73c90`

截图均来自受控 loopback Mock，不构成真实 Provider 输出质量证据。

## CRITICAL 审查状态

- Compliance/Privacy：此前 source 实现审查已 PASS；release 集成保持私密简历与 Chat/RAG/日志/截图/评测隔离，未读取、上传或输出真实私密简历，未回显 Provider URL 或 key。
- Quality/Reliability：此前 source 实现审查已 PASS；release 集成新增的 stopped telemetry、v2 attempt 聚合、Mock 出站边界和 cleanup deadline 已有回归测试。吸收最新主线后的 correction delta 仍需独立复审。

## 开放门槛

- 固定 20 轮真实 Provider 输出评审仍需单独授权调用数、成本和数据边界；当前没有用 Mock 冒充真实输出质量。
- 发布前必须完成：提交当前 owned 集成修正、刷新并吸收最新 `origin/master`、关闭 S9 旧合同失败、全仓测试 0 fail、CRITICAL correction delta 双审查。
- 生产发布按 disabled-first 执行：`MORSE_CHAT_V2_ENABLED=true`、canary 0%、空白名单、hedging 关闭、safe mode 关闭；migration 005/006 只向前执行，不做 down migration。
- disabled-first 部署只证明 v2 代码和 schema 已上线但流量为 0；真实 Provider 评审、邀请码白名单、25%、100% 以及 24/48 小时指标观察都是后续独立门槛。

## 交付边界

- 本账本记录的是 release 集成的本地证据，不代表主线、远端或生产已经更新。
- 当前未 push、未部署、未创建评审邀请码、未调用真实 Provider。
