# M3-RAG MVP Stage Contract

## Objective

在不隐藏现有作品集内容的前提下,用短期邀请码解锁数字摩斯文字对话和面试官模式。回答必须先从 pgvector 检索审核公开知识,以流式方式输出并展示来源;邀请码有效期内保留短期上下文。

## Definition of Done

- 未登录访客可浏览全站,但不能调用 `/api/chat`。
- 有效短期码创建 HttpOnly 会话;过期、撤销、超次数和错误码均被拒绝。
- `content/s3-content.json` 可重复摄取;同一内容不会产生重复分块。
- 每次提问先生成 query embedding,再从 pgvector 取 top-k,最后调用 GPT。
- 普通模式与面试官模式使用不同指令,但都只把检索内容当证据而非指令。
- 对话以 SSE 输出 `meta`、`delta`、`done` 或 `error`;UI 始终有文本降级。
- 消息只保留到邀请码/会话到期;清理脚本可删除过期会话和关联消息。
- 用量账本记录 token 和估算费用;预算达到 75/90/100% 时产生结构化级别,100% 熔断。
- 自动化测试、`npm run build`、本地 pgvector 集成和 1440/390 浏览器冒烟通过。

## Stage Package

1. `M3-RAG-0 CONTRACT`:修复 Task Center,锁定依赖、数据边界和验证层级。
2. `M3-RAG-1 RED`:邀请码、切片、预算、SSE 和检索契约先出现预期失败。
3. `M3-RAG-2 DATA GREEN`:pgvector schema、迁移、公开知识摄取和向量检索通过。
4. `M3-RAG-3 API GREEN`:访问会话、短期记忆、OpenAI provider adapter 和聊天流通过。
5. `M3-RAG-4 UI GREEN`:短期码解锁、模式切换、流式消息、来源和错误状态可用。
6. `M3-RAG-5 REAL SMOKE`:本地数据库真实检索;网络允许时最多 3 次真实 OpenAI 冒烟。
7. `M3-RAG-6 CLOSEOUT`:全测、build、双宽、控制台、diff-check、Task Center 与证据同步。

## Research And Parking

- OpenAI 官方文档不可达时使用官方 SDK 类型约束,不得根据第三方示例猜 API。
- `api.openai.com` 不可达时,真实 Provider 验证标记 BLOCKED,但本地数据库和 loopback 验证继续。
- 向量召回质量不足先补 gold questions 和调 chunk/top-k,不得直接增加第二套向量库。
- 联网搜索、语音、TTS、实时口型、长期用户画像、管理后台全部 parked。

## Preauthorization

| Action | State |
|---|---|
| Local pgvector Docker | allowed,project container only,bind `127.0.0.1:55432` |
| OpenAI real calls | allowed,max 3 smoke calls,stop after 2 same-category failures |
| Network install | allowed,only `openai`,`pg`,`@types/pg` |
| Database migration | allowed,local project database only |
| Browser | allowed,loopback 1440/390 only |
| Public web | official OpenAI docs only;runtime web search forbidden |
| Commit | allowed after verification,explicit staging only |
| Push/deploy/remote DB | forbidden |
| External asset writes | forbidden |
| Destructive operations | approval-required |

## LOOP Contract

- State source:`docs/task-center/run-state.md` and this contract.
- Previous evidence:tests, migration output, retrieval traces, browser screenshots and Provider smoke label.
- Next cycle:highest-value safe stage declared above;blocked Provider work does not block independent local stages.
- Pointer rule:only `run-state.md` advances the current pointer.
- Stop:secret exposure risk, cost/retry cap, non-local migration, Critical review finding or no safe next stage.
- Closeout packet:changed files, exact verification, real-vs-mock distinction, parked items and next pointer.

## Current Result(2026-07-13)

- `M3-RAG-0` through `M3-RAG-4`:PASS。
- `M3-RAG-5` local pgvector + loopback Mock Provider:PASS;real OpenAI Provider:BLOCKED by local network reachability。
- `M3-RAG-6` local closeout:PASS;final closeout waits only for bounded real Provider smoke。
