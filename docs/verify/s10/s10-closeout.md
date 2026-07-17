# S10 本地验收账本

> 日期：2026-07-17
> 状态：`MAINLINE_PROVIDER_READY / CHAT_UX_LOCAL_READY`
> 分支：`master`
> 基线：`514df87` + 本轮对话交互精确提交
> 交付边界：LOCAL；当前修正提交到本地 `master`，未 push、未部署

## 已通过

- 访客自由对话、JD 匹配、需求初诊、真实 Abort stop、原位 retry、12 小时 history、阶段状态、来源分组与独立 Admin UI 已实现。
- 正式 `npm run visual:s10` 在一次性 production、Mock OpenAI/Bocha 和 disposable pgvector 环境通过 19/19；1440x900 与 390x844 均无横向溢出，console error 和 page error 为 0。
- 四张授权态截图已生成：`s10-chat-desktop-1440x900.png`、`s10-chat-mobile-390x844.png`、`s10-admin-desktop-1440x900.png`、`s10-admin-mobile-390x844.png`。
- 内置浏览器实页复验覆盖 1440/390 布局和三种 workflow；390 页面 `scrollWidth <= clientWidth`，没有截断或重叠。
- 离线对话评测 53/53，`externalCalls: 0`；生产构建 17/17；`git diff --check` PASS。
- 2026-07-17 本地 CPU `BAAI/bge-small-zh-v1.5` 最终证据为 9 documents / 10 chunks、第二次摄取 9/9 skip；top1 18/20、top3 20/20，最低正例 0.460884、最高负例 0.420975，0.45 阈值双向通过。
- 既有 `revolution-pgvector` 容器 healthy 并监听 `127.0.0.1:55432`；加载 ignored `.env.local` 的全量测试为 499/499、0 fail、0 skip。

## 对话交互修正

- 根因确认：助手正文此前没有解析 Markdown；默认问题只写入草稿；来源可在正文前出现；`[来源N]` 是每轮重新排序的内部索引，不能作为访客能理解的资料身份。
- 访客行为：默认问题现在直接发问，候选立即退出；空回答显示“数字摩斯正在思考”；标题、段落、列表、粗体、行内代码和分隔线结构化渲染。
- 来源行为：正文显示“依据：资料标题”，底部只显示正文实际引用的具名资料及站内/联网属性；内部 citation index 只用于本轮映射和锚点，不作为可见文案。
- 失败恢复：2026-07-17 的两个失败 turn 均为空 `PROVIDER_INCOMPLETE`，无 partial answer 或 token；当前显式协议只在 `PROVIDER_RESPONSE_INCOMPLETE` 且零正文时自动重试一次，已有部分回答或明确 `response.failed/error` 时不重试，避免正文重复和额外请求。
- 最新真实证据：turn `92102e75-47d5-47bc-a2da-644105d94ec3` 使用 `gpt-5.4`，SSE 到 `done`，数据库 `completed`、15290ms、usage 2612/73。页面仅列实际引用的《数字摩斯》，没有 `[来源N]`、`**` 或裸 `---`。

## CRITICAL 双审查

- Compliance：PASS，开放 blocker 0。Admin CSV 已从 `docs/verify/s10` 移至系统临时目录下受控的 `revolution-s10-download-*`，路径边界校验后在 `finally` 删除；证据目录只保留四张 Mock 截图与本账本。
- Quality/safety：PASS，开放 blocker 0。复核覆盖 auth/Origin/TOTP、12h/10d 生命周期、citation URL、Abort/compensation、Outbox、Admin badcase 成功态、前台截图、selection 清理和授权态 Session 顺序。
- 两份空的 ignored `.tmp-s10-e2e.*.log` 已在不读取正文的前提下精确删除；本次为 3010 重启创建的 `.env.local` 只保存本机数据库、模型、Embedding 和开关配置，不含 Provider Key，保持 ignored 且未 stage。

## 外部证据边界

- 第 3 次且最后一次真实 GPT 集成 smoke 已在搜索关闭时执行；页面按设计失败回退，没有伪造回答。
- 失败发生在 interaction 预留前，数据库没有新增 `interaction_turn`；没有 Provider HTTP 状态、延迟或 usage 证据，因此结论是 `BLOCKED_CONFIG`，不是 GPT PASS。
- 原三次 Provider 尝试预算已关闭。用户于 2026-07-17 重新授权 1 次真实调用后，`gpt-5.4-mini` Responses 全链取得 HTTP 200、SSE `done` 和数据库 `completed` 证据，延迟 9872ms、`used_search=false`。
- 中转没有返回 token usage，usage 与成本保持未知；回答有来源但没有遵守“一句话”长度要求，记为真实 badcase 观察点。真实博查和飞书仍未调用。
- 用户实测后发现原模型连续空流。根因包含运行进程继承错误项目 Key，以及中转 WAF 对默认 SDK User-Agent 的拦截；修复时模型目录快照一度不含 `gpt-5.4-mini`，收口前实时目录已重新包含 mini 与 `gpt-5.4`，因此目录只能在运行或部署时实时核对。新增受控 `OPENAI_COMPAT_USER_AGENT` 并固定 `gpt-5.4` 后，移除诊断代理的最终直连站内 turn `b8b3ec78-380d-4211-9baa-9633f1847d75` 为 5 个 RAG 来源、480 字回答、SSE `done`、数据库 `completed`、12546ms、usage 1779/297。

## 关闭结论

- S10 本地 DoD、CRITICAL 双审查和知识连续性门均已关闭，状态为 `MAINLINE_PROVIDER_READY / KNOWLEDGE_RECONCILED`。
- 真实 GPT 已为 `PASS`；真实博查与飞书仍是 `BLOCKED_EXTERNAL`。这些外部证据不由 Mock 替代，也不阻塞本地交付。
- merge commit `e0a53f2` 已将 S10 吸收到本地 `master`；push、部署和其余真实外部联调仍需另行授权。

## 清理与保留

- 正式 harness 创建的 Next、Mock OpenAI、Mock Bocha、浏览器 profile、Admin 下载目录与 disposable 数据库均已清理，无 CSV/临时日志残留。
- 用户验收用 `http://127.0.0.1:3010/` 首页继续保留；短期码按当次本地运行单独提供，不写入仓库。
- 根 `AGENTS.md` 与外部只读资产未修改、未 stage；`.env.local` 仅作为 ignored 本地运行配置保留，不进入 Git。
