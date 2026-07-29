# Night Stability 2026-07-30

## Intent

在明日 HR 推广前，对当前生产 release 执行真实、多 Session、自然语言和受控并发稳定性测试；用真实回答、持久化路由/证据/attempt 元数据、服务健康和日志共同判断是否可以推广。

## Boundaries

- 最多 6 个隔离 Session、60 次真实 Chat Provider 调用、3 路跨 Session 并发、2 次必要修复发布，授权截止 `2026-07-30T09:00:00+08:00`。
- 原始 JD、问题、回答、Cookie、Session、invite 明文、HMAC、Provider payload 和凭据只允许在瞬时测试内存中使用，不进入 Git、证据文档或聊天汇报。
- 允许创建并清理本轮专用 invite/Session，允许因可复现 blocker 做范围内修复、测试、commit、push 和部署。
- 禁止 Skills、工具 Agent、自动联网搜索、schema/migration、依赖安装、破坏性数据库操作、修改私密简历或扩大 Context Packet 百分比。

## Terminal Outcome

以真实测试和稳定观察给出 `PROMOTION_READY`、`PROMOTION_LIMITED` 或 `PROMOTION_BLOCKED`；若发生缺陷，必须保留可复现证据和处置状态。
