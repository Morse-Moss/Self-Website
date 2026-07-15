# S10 数字摩斯智能客服 Task Center

> 唯一需求源：`docs/portfolio-blueprint.md#15-s10-数字摩斯智能客服`
> 设计：`docs/superpowers/specs/2026-07-15-s10-smart-customer-service-design.md`
> 计划：`docs/superpowers/plans/2026-07-15-s10-smart-customer-service.md`
> 分支：`codex/s10-smart-customer-service`
> Worktree：`E:\Revolution\.worktrees\s10-smart-customer-service`

## Stage Packet

```yaml
outcome: 本地可验收的数字摩斯智能客服，覆盖自由对话、JD 匹配、需求初诊、RAG、自动博查、10 天分析、飞书 Outbox 和私有管理后台
delivery_priority: reliability-and-honest-evidence
execution_mode: GOAL
risk_profile: CRITICAL
delivery_target: LOCAL
current_lifecycle_state: EXECUTE
definition_of_done:
  - 本地 pgvector 零 skip 集成、三种 workflow、12h 恢复、10d 日志、搜索、停止、管理后台和导出通过
  - Provider/博查/飞书证据按 real 或 BLOCKED_EXTERNAL 分开标记
  - 1440/390 交互、全量测试、build、diff、secret scan 和 CRITICAL 双审查通过
allowed_scope:
  - app/api/chat/**, app/api/access/**, app/api/admin/**, app/admin/**
  - components/MorseChat*, components/chat/**, components/admin/**
  - lib/server/** 与 lib/client/chat-*
  - db/migrations/**, scripts/migrate-db.mjs, scripts/cleanup-expired.mjs, S10 mock/eval/smoke 脚本
  - tests/**, content/chat-eval.json, docs/task-center/**, docs/superpowers/**, docs/portfolio-blueprint.md, docs/verify/s10/**
forbidden_scope:
  - content/drafts/** 进入 live/RAG
  - 写入 E:\Wiki, E:\demo2, E:\小红书, E:\多agent
  - 语音、数字人视频、长期记忆、网页正文抓取、外置向量库、部署、push、PR
  - 密钥、邀请码明文、cookie token、原始 Provider payload 进入代码、文档、日志或证据
verification:
  focused: node --test <stage tests>
  stage_exit: npm test && npm run build && git diff --check
review_budget:
  correction_cycles: 3
  review_shape: split compliance + quality/safety
  provider_attempts: S10 总计最多 3 次，已使用 2 次能力探测，Mock PASS 后最多剩 1 次集成 smoke
knowledge_reconciliation:
  scope: code + blueprint + task center + evidence + continuation state
  verdict: pending
release_boundary:
  push_pr_deploy: forbidden
  commit: 本地验证阶段可按显式范围提交
  cleanup: 仅清理本轮可精确识别的测试数据和临时服务
```

## Current Pointer

**S10-CS-2 PROVIDER + RUNTIME**

## Next Allowed Pointer

只有当前阶段的 RED/GREEN、focused verification、审查和状态账本同步后才能推进下一阶段。缺少博查/飞书凭据不阻塞 Mock 实现，但真实链保持 `BLOCKED_EXTERNAL`。

## Phase Registry

| Pointer | State | Exit evidence |
|---|---|---|
| `S10-CS-0 CONTRACT + PROVIDER EVIDENCE` | PASS | contract test 5/5；CRITICAL compliance 与 safety delta review PASS |
| `S10-CS-1 MIGRATION + RETENTION` | PASS | migration focused 15/15；retention 3/3；full PostgreSQL suite 236/236，0 skip；CRITICAL 双审查 PASS |
| `S10-CS-2 PROVIDER + RUNTIME` | IN PROGRESS | 双协议 adapter、abort、timeout、heartbeat、history |
| `S10-CS-3 RAG + AUTO SEARCH` | PENDING | BGE/pgvector、SearchRouter、Bocha Mock、引用安全 |
| `S10-CS-4 JD + DIAGNOSIS` | PENDING | workflow 合同、结构化初诊、Outbox 幂等 |
| `S10-CS-5 ADMIN + ALERTS` | PENDING | scrypt+TOTP、权限矩阵、badcase、导出、飞书 Mock |
| `S10-CS-6 UI + EVAL + CLOSEOUT` | PENDING | 双宽浏览器、全量验证、CRITICAL 双审查、知识收尾 |

## Fixed Controls

- 访客邀请码最长 72 小时；access/session 上下文 12 小时。
- 每 Session 30 条消息、5 次联网；同 Session/Conversation 单飞。
- 默认 Provider 并发 4、Search 并发 2；由环境变量可收紧。
- SSE heartbeat 15 秒；Embedding/Search/首字节/总时长有独立超时。
- `MORSE_CHAT_ENABLED` 与 `MORSE_SEARCH_ENABLED` 是独立 kill switch。
- S10 搜索只消费博查标题、摘要、URL，不抓取网页正文。
- 原始问题、回答、搜索词和来源 10 天，不脱敏；页面不显示保留提示。
- 管理 Session 30 分钟滑动过期；写操作/导出做 Origin 校验；导出需要新 TOTP。
- 迁移 runner bootstrap（自举）`schema_migrations`；空库执行 001，既有 001-only 库经结构哨兵验证后登记 baseline，部分 schema 直接拒绝。
- 服务故障五分钟内连续三次才创建 incident；恢复沿用该 incident id，下一轮同类故障必须创建新 id。
- 本轮零新增 npm/Python 依赖。

## External Evidence Register

| ID | State | Evidence / next route |
|---|---|---|
| `S10-E1 GPT models` | PASS | configured endpoint `/models` HTTP 200，13 个模型，选定 `gpt-5.4-mini` |
| `S10-E2 GPT Responses` | BLOCKED_EXTERNAL | 1 次极短探测未取得 HTTP 响应；未记录正文/payload |
| `S10-E3 GPT Chat Completions` | BLOCKED_EXTERNAL | 1 次极短探测未取得 HTTP 响应；不再自动跨协议重试 |
| `S10-E4 Bocha` | BLOCKED_EXTERNAL | 未提供 API key；只允许 Mock/合同验收 |
| `S10-E5 Feishu` | BLOCKED_EXTERNAL | 未提供 webhook；只允许 Outbox/Mock/合同验收 |

## Failure Register

| ID | State | Closure condition |
|---|---|---|
| `S10-F1` | CLOSED | 蓝图 §15、唯一指针、active S10 contract test 与 CRITICAL 双审查通过 |
| `S10-F2` | CLOSED | 12h runtime cascade、9d interaction 保留、10d 原文删除与幂等清理在 disposable pgvector 通过 |
| `S10-F3` | CLOSED | bootstrap、001-only baseline、checksum、并发锁、partial-002、事务回滚与旧数据保全通过 |
| `S10-F4` | OPEN | admin 与 visitor cookie/权限物理隔离，TOTP replay/CSRF/CSV 防护通过 |
| `S10-F5` | OPEN | SearchRouter、恶意 URL、citation 和站内个人事实边界通过 |
| `S10-F6` | OPEN | 初诊、首次邀请码、两轮故障/恢复、邀请码/管理员安全通知 Outbox 去重通过 |
| `S10-F7` | OPEN | stop/abort/断线不扣额度且 history 可恢复 |

## Progress Ledger

- 2026-07-15：S10 worktree 基于 `master@c81e2e8` 建立，`npm ci` 成功。
- 2026-07-15：基线 `npm test` 为 216 total / 201 pass / 15 PostgreSQL skip / 0 fail；`npm run build` PASS，12/12 路由。DB 零 skip 仍是最终硬门。
- 2026-07-15：完成代码、UI 与 CRITICAL challenge 三路只读审查。确认复用 S8 主链，不建第二套聊天服务；合同需覆盖旧蓝图冲突、拆分 12h/10d 数据、additive migration、独立 admin、snippet-only 搜索与事务 Outbox。
- 2026-07-15：中转 `/models` PASS；Responses 与 Chat Completions 共 2 次极短探测均无 HTTP 响应，按预算停止。真实 GPT 当前 `BLOCKED_EXTERNAL`。
- 2026-07-15：`S10-CS-0` PASS / `S10-CS-1` START。合同测试 5/5；compliance 与 quality/safety delta review 均 PASS，72h/12h、migration bootstrap、incident/outbox、GitHub 分类、push 边界和九组安全条件已冻结。
- 2026-07-16：`S10-CS-1` PASS / `S10-CS-2` START。001-only 本地项目库经哨兵验证 baseline 登记并升级到 002，原 9 条知识文档保全。迁移 15/15、retention 3/3、完整 PostgreSQL suite 236/236、0 skip；spec 与 quality/safety 双审查全部 PASS。旧 S9 current-pointer 契约已修为历史 closeout 保留，S9/S10 focused 25/25。

## Preauthorization Matrix

| Action | State |
|---|---|
| 本地文件/测试/构建 | allowed |
| 本地 PostgreSQL 既有项目容器 | inspect/start/migrate/test allowed；只清理本轮测试行 |
| 本地 BGE | 复用既有环境，loopback start/eval allowed；禁止安装新包 |
| 中转 GPT | 总计 3 次；已用 2，Mock PASS 后最多 1 次；同类失败立即停 |
| 博查 / 飞书 | 凭据缺失，真实调用 forbidden；Mock allowed |
| 依赖安装 | forbidden；本轮零新增依赖 |
| Git commit | allowed，必须精确 stage，排除 AGENTS.md 与未知文件 |
| Push / PR / merge / deploy | forbidden |
| 外部资产四目录 | read-only；本轮实现不需要继续读取 |
| 破坏性数据库/文件操作 | forbidden；disposable test database 除外 |

## Closeout Policy

- 所有行为变更严格 RED → GREEN；机械文档/配置验证精确内容。
- 每个阶段完成后先 spec/compliance review，再 quality/safety review；阻塞项关闭后推进。
- Mock、本地 pgvector、真实 GPT、真实博查和真实飞书证据不可互相替代。
- 最终必须同步蓝图、run-state、本文件、验证证据和 continuation state；不部署、不 push。
