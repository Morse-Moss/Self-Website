# S10 本地验收账本

> 日期：2026-07-18
> 状态：`MAINLINE_PROVIDER_READY / CHAT_UX_LOCAL_READY`
> 分支：`master`
> 基线：`bd698b5` + 本轮中转恢复修正
> 交付边界：LOCAL；当前修正提交到本地 `master`，未 push、未部署

## 已通过

- 访客自由对话、JD 匹配、需求初诊、真实 Abort stop、原位 retry、12 小时 history、阶段状态、来源分组与独立 Admin UI 已实现。
- 正式 `npm run visual:s10` 在一次性 production、Mock OpenAI/Bocha 和 disposable pgvector 环境通过 19/19；1440x900 与 390x844 均无横向溢出，console error 和 page error 为 0。
- 四张授权态截图已生成：`s10-chat-desktop-1440x900.png`、`s10-chat-mobile-390x844.png`、`s10-admin-desktop-1440x900.png`、`s10-admin-mobile-390x844.png`。
- 内置浏览器实页复验覆盖 1440/390 布局和三种 workflow；390 页面 `scrollWidth <= clientWidth`，没有截断或重叠。
- 离线对话评测 53/53，`externalCalls: 0`；生产构建 17/17；`git diff --check` PASS。
- 2026-07-17 本地 CPU `BAAI/bge-small-zh-v1.5` 最终证据为 9 documents / 10 chunks、第二次摄取 9/9 skip；top1 18/20、top3 20/20，最低正例 0.460884、最高负例 0.420975，0.45 阈值双向通过。
- 既有 `revolution-pgvector` 容器 healthy 并监听 `127.0.0.1:55432`；加载 ignored `.env.local` 的全量测试为 517/517、0 fail、0 skip。

## 对话交互修正

- 根因确认：助手正文此前没有解析 Markdown；默认问题只写入草稿；来源可在正文前出现；`[来源N]` 是每轮重新排序的内部索引，不能作为访客能理解的资料身份。
- 访客行为：默认问题现在直接发问，候选立即退出；空回答显示“数字摩斯正在思考”；标题、段落、列表、粗体、行内代码和分隔线结构化渲染。
- 来源行为：正文显示“依据：资料标题”，底部只显示正文实际引用的具名资料及站内/联网属性；正文依据和底部来源统一为当前页资料静态显示、项目与联网资料新标签打开，不改变当前对话 URL、消息或 transcript 滚动位置。内部 citation index 只用于本轮映射，不作为可见文案。
- 失败恢复：真实链路证明中转会间歇性返回零正文完成或 502；非流式同请求也返回 502，因此不跨协议 fallback。适配层在无 delta 时恢复 `response.output_text.done`；零正文空完成/incomplete 或 408/409/429/5xx 最多 3 次总尝试，永久 4xx、明确 `response.failed/error`、超时和部分正文不重试。空完成或 incomplete 返回的 usage 会累加到最终成功轮次。
- 最新真实证据：turn `e9d03006-2cbd-40dd-a31c-1cd65c6b6e45` 使用 `gpt-5.4`，SSE 到 `done`，数据库 `completed`、19362ms、usage 5766/102。页面显示 174 字正文和 1 个实际引用的《数字摩斯》，没有重试按钮；数据库保留 5 个检索来源，Provider incident 已恢复。
- 本轮真实页面证据：快捷问题原位直发后候选立即消失并进入思考态，URL、消息与 transcript 保持连续；turn `45d91a62-38b9-4505-9a80-5e7b563a2cb2`、`3023fc9a-af03-45e0-91c6-3994022a1fc5` 和重启当前构建后的 `389f9ccd-9f42-451f-a641-050bad5f1106` 均为 `completed`，延迟 10165ms/16633ms/15706ms、额度各 30→29、无错误；最新一轮保留 5 个检索来源且 `used_search=false`。中转未返回 usage，不伪造成本。

## CRITICAL 双审查

- Compliance：PASS，开放 blocker 0。Admin CSV 已从 `docs/verify/s10` 移至系统临时目录下受控的 `revolution-s10-download-*`，路径边界校验后在 `finally` 删除；证据目录只保留四张 Mock 截图与本账本。
- Quality/safety：PASS，开放 blocker 0。复核覆盖 auth/Origin/TOTP、12h/10d 生命周期、正文与底部 citation URL、当前对话隔离、Abort/compensation、Outbox、Admin badcase 成功态、前台截图、selection 清理、授权态 Session 顺序和自有浏览器/profile 清理。
- 两份空的 ignored `.tmp-s10-e2e.*.log` 已在不读取正文的前提下精确删除；本次为 3010 重启创建的 `.env.local` 只保存本机数据库、模型、Embedding 和开关配置，不含 Provider Key，保持 ignored 且未 stage。

## 外部证据边界

- 第 3 次且最后一次真实 GPT 集成 smoke 已在搜索关闭时执行；页面按设计失败回退，没有伪造回答。
- 失败发生在 interaction 预留前，数据库没有新增 `interaction_turn`；没有 Provider HTTP 状态、延迟或 usage 证据，因此结论是 `BLOCKED_CONFIG`，不是 GPT PASS。
- 原三次 Provider 尝试预算已关闭。用户于 2026-07-17 重新授权 1 次真实调用后，`gpt-5.4-mini` Responses 全链取得 HTTP 200、SSE `done` 和数据库 `completed` 证据，延迟 9872ms、`used_search=false`。
- 中转没有返回 token usage，usage 与成本保持未知；回答有来源但没有遵守“一句话”长度要求，记为真实 badcase 观察点。真实博查和飞书仍未调用。
- 用户实测后发现原模型连续空流。根因包含运行进程继承错误项目 Key，以及中转 WAF 对默认 SDK User-Agent 的拦截；修复时模型目录快照一度不含 `gpt-5.4-mini`，收口前实时目录已重新包含 mini 与 `gpt-5.4`，因此目录只能在运行或部署时实时核对。新增受控 `OPENAI_COMPAT_USER_AGENT` 并固定 `gpt-5.4` 后，移除诊断代理的最终直连站内 turn `b8b3ec78-380d-4211-9baa-9633f1847d75` 为 5 个 RAG 来源、480 字回答、SSE `done`、数据库 `completed`、12546ms、usage 1779/297。
- 2026-07-18 增量兼容验证中，Responses 流式请求出现零正文完成，非流式同请求出现 HTTP 502；Chat Completions 流式接口未形成兼容终态，故保持已验收 Responses 协议，不做隐式跨协议或模型 fallback。显式有界恢复后的真实 turn 与上节证据一致。

## 关闭结论

- S10 本地 DoD、CRITICAL 双审查和知识连续性门均已关闭，状态为 `MAINLINE_PROVIDER_READY / KNOWLEDGE_RECONCILED`。
- 真实 GPT 已为 `PASS`；真实博查与飞书仍是 `BLOCKED_EXTERNAL`。这些外部证据不由 Mock 替代，也不阻塞本地交付。
- merge commit `e0a53f2` 已将 S10 吸收到本地 `master`；push、部署和其余真实外部联调仍需另行授权。

## 清理与保留

- 正式 harness 创建的 Next、Mock OpenAI、Mock Bocha、Admin 下载目录与 disposable 数据库均已清理，无新 CSV/临时日志残留；一次清理失败复现遗留 `revolution-s9-edge-D8piLC` profile，未获删除授权，按现状保留。最终成功 harness 已自行回收其 Edge/profile；Windows profile 删除的短暂 `EACCES` 由有界重试处理，最终失败不再静默吞掉。
- 用户验收用 `http://127.0.0.1:3010/` 首页继续保留；短期码按当次本地运行单独提供，不写入仓库。
- 根 `AGENTS.md` 与外部只读资产未修改、未 stage；`.env.local` 仅作为 ignored 本地运行配置保留，不进入 Git。
