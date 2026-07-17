# S10 本地验收账本

> 日期：2026-07-17
> 状态：`LOCAL_READY`
> 分支：`codex/s10-smart-customer-service`
> 基线：`2f56d4a` + Task 6 本地交付
> 交付边界：LOCAL；精确本地提交，不 push、不部署

## 已通过

- 访客自由对话、JD 匹配、需求初诊、真实 Abort stop、原位 retry、12 小时 history、阶段状态、来源分组与独立 Admin UI 已实现。
- 正式 `npm run visual:s10` 在一次性 production、Mock OpenAI/Bocha 和 disposable pgvector 环境通过 17/17；1440x900 与 390x844 均无横向溢出，console error 和 page error 为 0。
- 四张授权态截图已生成：`s10-chat-desktop-1440x900.png`、`s10-chat-mobile-390x844.png`、`s10-admin-desktop-1440x900.png`、`s10-admin-mobile-390x844.png`。
- 内置浏览器实页复验覆盖 1440/390 布局和三种 workflow；390 页面 `scrollWidth <= clientWidth`，没有截断或重叠。
- 离线对话评测 53/53，`externalCalls: 0`；生产构建 17/17；`git diff --check` PASS。
- 2026-07-17 本地 CPU `BAAI/bge-small-zh-v1.5` 最终证据为 9 documents / 10 chunks、第二次摄取 9/9 skip；top1 18/20、top3 20/20，最低正例 0.460884、最高负例 0.420975，0.45 阈值双向通过。
- 既有 `revolution-pgvector` 容器恢复 healthy 并监听 `127.0.0.1:55432`；显式本地 `DATABASE_URL` 下全量测试为 491/491、0 fail、0 skip。

## CRITICAL 双审查

- Compliance：PASS，开放 blocker 0。Admin CSV 已从 `docs/verify/s10` 移至系统临时目录下受控的 `revolution-s10-download-*`，路径边界校验后在 `finally` 删除；证据目录只保留四张 Mock 截图与本账本。
- Quality/safety：PASS，开放 blocker 0。复核覆盖 auth/Origin/TOTP、12h/10d 生命周期、citation URL、Abort/compensation、Outbox、Admin badcase 成功态、前台截图、selection 清理和授权态 Session 顺序。
- 两份空的 ignored `.tmp-s10-e2e.*.log` 已在不读取正文的前提下精确删除；`.env.local` 保持 ignored，未读取、未修改、未 stage。

## 外部证据边界

- 第 3 次且最后一次真实 GPT 集成 smoke 已在搜索关闭时执行；页面按设计失败回退，没有伪造回答。
- 失败发生在 interaction 预留前，数据库没有新增 `interaction_turn`；没有 Provider HTTP 状态、延迟或 usage 证据，因此结论是 `BLOCKED_CONFIG`，不是 GPT PASS。
- 三次 Provider 尝试预算已经耗尽，禁止继续自动重试；真实博查和飞书均未调用。

## 关闭结论

- S10 本地 DoD、CRITICAL 双审查和知识连续性门均已关闭，状态为 `LOCAL_READY / KNOWLEDGE_RECONCILED`。
- 真实 GPT 仍是 `BLOCKED_CONFIG`；真实博查与飞书仍是 `BLOCKED_EXTERNAL`。这些外部证据不由 Mock 替代，也不阻塞本地交付。
- 主线吸收、push、部署和真实外部联调需要摩斯另行授权。

## 清理与保留

- 正式 harness 创建的 Next、Mock OpenAI、Mock Bocha、浏览器 profile、Admin 下载目录与 disposable 数据库均已清理，无 CSV/临时日志残留。
- 用户验收用 `http://127.0.0.1:3010/` 首页继续保留；短期码为 `S10LOCAL-20260716-A`。
- 根 `AGENTS.md`、`.env.local` 和外部只读资产未修改、未 stage。
