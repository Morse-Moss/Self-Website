# S8 智能客服文字对话闭环 · Closeout

> 日期:2026-07-14
> 分支:`codex/s7-multipage-portfolio`
> Profile:`CRITICAL`
> 结论:`LOCAL PASS · REAL PROVIDER BLOCKED`

## Outcome

数字摩斯已具备受控访客可使用的文字智能客服闭环:短期码解锁、招聘方/合作方/同行三类意图、实时流式回答、公开站内来源、短期会话、额度显示、失败恢复与同 turn 重试。S8 未加入数字人、语音、联网搜索、工具 Agent、外置向量库、管理后台或部署能力。

## Reliability Evidence

- Provider、Embedding、空白完成和 assistant/usage 事务失败均精确补偿,不残留孤立 user message、不扣额度、不写 usage。
- PostgreSQL advisory try-lock 保证 turn 与 conversation 单飞;检索、锁与短事务复用同一 DB client,避免连接池饥饿。
- 客户端生成持久 `turnId`;完成事件丢失后重放首次已提交回答与公开来源,不重复调用回答 Provider、不重复消息、usage 或额度。
- SSE parser 覆盖 partial EOF、畸形帧、reader failure、error 稳定码和 done 终态;未知 fetch 错误统一为 `CHAT_UNAVAILABLE`。
- 所有 S8 OpenAI SDK client 均显式 `maxRetries: 0`,应用层决定重试与补偿。

## Verification

- `DATABASE_URL=local npm test`:113/113 PASS,0 fail,0 skip。
- `npm run chat:eval`:24/24 PASS;覆盖三类访客、跨项目、证据不足、prompt injection、off-topic、访问/预算/检索/Provider 错误与来源导航。
- `npm run rag:eval`:20 cases;top-1 17/20,top-3 20/20。
- Local pgvector:9 documents/9 chunks;invalid source 0;missing href 0;draft/local source 0。
- `npm run build`:Next.js production build 与 TypeScript PASS;12 条静态/动态路由生成成功。
- `git diff --check`:PASS。
- Secret scan:`sk-<credential>` 模式 0 命中。

## Browser Evidence

隔离 production Next `3011`、fail-first Mock `18090`、CPU BGE `18091` 与临时 headless Edge CDP `9222` 下:

- 1440x900:`failures: []`;recoverable retry 可见并成功;quota 30→29;来源导航 `/works/digital-morse`;无横向溢出。
- 390x844:`failures: []`;面板 390x844 全屏;quota 30→29;来源导航 `/`;无横向溢出。
- 两端三类 starter intent 均进入正确 mode/context;过期邀请码、DB 过期 session、恢复解锁、退出锁定均通过。
- 每端恰好 2 个预期 401 负路径单独计数;非预期 console error 0,page error 0。
- 人工检查未见文本、控件、来源列表、输入区或页脚互相遮挡。

Evidence:

- `docs/verify/s8/s8-chat-desktop-1440x900.png`
- `docs/verify/s8/s8-chat-mobile-390x844.png`

## Real Provider

真实 Provider 证据为 `BLOCKED`,不能由 Mock 替代。受信 OpenAI-compatible endpoint 与 `gpt-5.4-mini` 可用,但 3 次正式 `runChat` 均未完成;本阶段调用上限已耗尽,未做第 4 次调用。smoke 包装只保留了稳定 `ChatServiceError`,因此不记录或推断更具体根因;未保存 raw prompt、raw output、payload、header 或 key。

## Review

- CRITICAL compliance review:PASS,BLOCKER 0。
- CRITICAL quality/safety review:PASS,BLOCKER 0。
- Controller 已复核最终 diff、测试输出、DB 边界、双宽结果和两张新截图。

## Cleanup And Boundaries

- 临时 `3011/18090/18091/9222` 均已关闭;smoke invite 残留 0;临时 Edge profile 已清理。
- 用户原 `3010` 服务 PID 40648 在 browser smoke 前后未变化。
- 项目 pgvector 保留在 `127.0.0.1:55432`,供后续本地验证。
- 未安装依赖、未改 schema、未写外部资产、未 merge、未 push、未部署。
- 本地 S8 closeout commit 已创建;当前分支按既定选项原样保留。
- `AGENTS.md`、用户研究稿、概念图、`output/**`、旧临时脚本和非最终截图排除在提交外。

## Residuals

- Real Provider 完整三类对话仍需未来新预算与新授权重新验证。
- Retrieval top-1 为 17/20;top-3 20/20 达到本阶段门槛,未为刷分改写公开事实。
- 更深 Agent/Memory 面试题仍受公开知识覆盖约束;回答必须保持诚实边界。
- 当前结果只在本地分支;并入 `master`、push 与部署等待摩斯显式决策。
