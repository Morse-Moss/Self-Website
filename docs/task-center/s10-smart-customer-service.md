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
current_lifecycle_state: VERIFY
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
  provider_attempts: 原 3 次预算已关闭；用户于 2026-07-17 重新授权 1 次真实集成调用，该调用已使用并 PASS
knowledge_reconciliation:
  scope: code + blueprint + task center + evidence + continuation state
  verdict: updated
release_boundary:
  local_merge: allowed by user on 2026-07-17
  push_pr_deploy: forbidden
  commit: 本地验证阶段可按显式范围提交
  cleanup: 仅清理本轮可精确识别的测试数据和临时服务
```

## Current Pointer

**S10 REAL_PROVIDER_VERIFIED / MAINLINE_ABSORPTION**

## Next Allowed Pointer

完成全量回归、知识收口和本地 `master` 吸收；push、部署、真实博查和真实飞书仍需单独授权与凭据。

## Phase Registry

| Pointer | State | Exit evidence |
|---|---|---|
| `S10-CS-0 CONTRACT + PROVIDER EVIDENCE` | PASS | contract test 5/5；CRITICAL compliance 与 safety delta review PASS |
| `S10-CS-1 MIGRATION + RETENTION` | PASS | migration focused 15/15；retention 3/3；full PostgreSQL suite 236/236，0 skip；CRITICAL 双审查 PASS |
| `S10-CS-2 PROVIDER + RUNTIME` | PASS | 双协议 adapter、全链 abort、timeout、heartbeat、12h history；PostgreSQL 全套 308/308、0 skip；build 13/13；CRITICAL 双审查 PASS |
| `S10-CS-3 RAG + AUTO SEARCH` | PASS | SearchRouter/Bocha Mock/六字段 citation；355/355；正负 RAG 阈值与 CRITICAL 双审查 PASS |
| `S10-CS-4 JD + DIAGNOSIS` | PASS | 三 workflow 同主链、跨 turn 初诊、事务 Outbox；383/383、build 13/13、CRITICAL 双审查 PASS |
| `S10-CS-5 ADMIN + ALERTS` | PASS | scrypt+TOTP、权限矩阵、10 天查询、badcase、导出、飞书卡片与 incident；Task 5 130/130、全套 444/444、build 16/16、CRITICAL 双审查 PASS |
| `S10-CS-6 UI + EVAL + CLOSEOUT` | PASS | 17/17 双宽 Mock 浏览器、491/491 零 skip 全套、RAG 正负阈值、17/17 构建、CRITICAL 双审查与知识收口均通过 |
| `S10-CS-7 REAL PROVIDER + MAINLINE` | PASS | 真实 `gpt-5.4-mini` 全链、491/491、17/17 构建和健康状态语义修复 PASS；等待本地 `master` 吸收 |

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
- 稳定事件 key 防止重复入队；飞书 custom webhook 采用至少一次投递，远端已收但本地 `sent` 未确认时允许极端重复，卡片保留同一事件标识供识别。
- 本轮零新增 npm/Python 依赖。

## External Evidence Register

| ID | State | Evidence / next route |
|---|---|---|
| `S10-E1 GPT models` | PASS | configured endpoint `/models` HTTP 200，13 个模型，选定 `gpt-5.4-mini` |
| `S10-E2 GPT Responses` | BLOCKED_EXTERNAL | 1 次极短探测未取得 HTTP 响应；未记录正文/payload |
| `S10-E3 GPT Chat Completions` | BLOCKED_EXTERNAL | 1 次极短探测未取得 HTTP 响应；不再自动跨协议重试 |
| `S10-E6 GPT integrated smoke` | PASS | 用户重新授权后，`gpt-5.4-mini` Responses 全链 HTTP 200，SSE 到 `done`，数据库 interaction 为 `completed`、延迟 9872ms、未使用搜索；中转未返回 usage，成本保持未知 |
| `S10-E4 Bocha` | BLOCKED_EXTERNAL | 未提供 API key；只允许 Mock/合同验收 |
| `S10-E5 Feishu` | BLOCKED_EXTERNAL | 未提供 webhook；只允许 Outbox/Mock/合同验收 |

## Failure Register

| ID | State | Closure condition |
|---|---|---|
| `S10-F1` | CLOSED | 蓝图 §15、唯一指针、active S10 contract test 与 CRITICAL 双审查通过 |
| `S10-F2` | CLOSED | 12h runtime cascade、9d interaction 保留、10d 原文删除与幂等清理在 disposable pgvector 通过 |
| `S10-F3` | CLOSED | bootstrap、001-only baseline、checksum、并发锁、partial-002、事务回滚与旧数据保全通过 |
| `S10-F4` | CLOSED | admin 与 visitor cookie/权限物理隔离，scrypt/TOTP replay、30 分钟滑动 Session、Origin 与 CSV 防护通过 |
| `S10-F5` | CLOSED | 个人事实 veto、非公网 URL、六字段 citation、搜索事务/额度/降级与正负 RAG 阈值通过 |
| `S10-F6` | CLOSED | 初诊、首次邀请码、两轮故障/恢复、统一安全事件 key、飞书卡片业务应答与 Outbox retry 通过；真实 webhook 仍按外部证据表阻塞 |
| `S10-F7` | CLOSED | stop/abort/断线只写 10 天 interaction、不扣额度、不写 runtime assistant；12 小时 history 仅恢复已完成会话；事务、补偿与 orphan retry 测试通过 |
| `S10-F8` | CLOSED | `revolution-pgvector` healthy；491/491、0 fail、0 skip；RAG top1 18/20、top3 20/20，0.45 正负阈值均通过 |

## Progress Ledger

- 2026-07-15：S10 worktree 基于 `master@c81e2e8` 建立，`npm ci` 成功。
- 2026-07-15：基线 `npm test` 为 216 total / 201 pass / 15 PostgreSQL skip / 0 fail；`npm run build` PASS，12/12 路由。DB 零 skip 仍是最终硬门。
- 2026-07-15：完成代码、UI 与 CRITICAL challenge 三路只读审查。确认复用 S8 主链，不建第二套聊天服务；合同需覆盖旧蓝图冲突、拆分 12h/10d 数据、additive migration、独立 admin、snippet-only 搜索与事务 Outbox。
- 2026-07-15：中转 `/models` PASS；Responses 与 Chat Completions 共 2 次极短探测均无 HTTP 响应，按预算停止。真实 GPT 当前 `BLOCKED_EXTERNAL`。
- 2026-07-15：`S10-CS-0` PASS / `S10-CS-1` START。合同测试 5/5；compliance 与 quality/safety delta review 均 PASS，72h/12h、migration bootstrap、incident/outbox、GitHub 分类、push 边界和九组安全条件已冻结。
- 2026-07-16：`S10-CS-1` PASS / `S10-CS-2` START。001-only 本地项目库经哨兵验证 baseline 登记并升级到 002，原 9 条知识文档保全。迁移 15/15、retention 3/3、完整 PostgreSQL suite 236/236、0 skip；spec 与 quality/safety 双审查全部 PASS。旧 S9 current-pointer 契约已修为历史 closeout 保留，S9/S10 focused 25/25。
- 2026-07-16：`S10-CS-2` PASS / `S10-CS-3` START。完成显式 Responses/Chat Completions 双协议、贯穿 request/Embedding/Provider/SSE 的同一取消链、独立超时与并发、15 秒 heartbeat、终态流清理、同 Session 单飞、幂等 replay/orphan 恢复、事务配额补偿和 12 小时 history。控制器复验 PostgreSQL 全套 308/308、0 skip，`npm run build` 13/13；compliance 与 quality/safety 审查均 PASS。真实 GPT 未调用，仍按外部证据表保持 `BLOCKED_EXTERNAL`。
- 2026-07-16：`S10-CS-3` PASS / `S10-CS-4` START。完成确定性 SearchRouter、Bocha one-shot Mock、搜索 claim/finalize 与五次额度、严格公网 HTTPS/六字段 citation、失败/禁用诚实降级和个人事实 veto；`0.45` 本地充分性阈值由冻结的 20 正例/10 负例共同硬门，实测最低正例 `0.4822101`、最高负例 `0.4209749`。`DATABASE_URL=local npm test` 355/355、0 skip，build 13/13，CRITICAL compliance 与 quality/safety correction-cycle-2 均 PASS；真实 Bocha 未调用，保持 `BLOCKED_EXTERNAL`。
- 2026-07-16：`S10-CS-4` PASS / `S10-CS-5` START。完成 `chat / jd_match / diagnosis` 同主链、2,000/12,000 字合同、跨 turn 五字段合并、受控 prompt 与 workflow/replay 隔离；首次邀请码和初诊通过同事务幂等 Outbox 入队。诊断稳定 id 的 FK 与 deadline 始终推进并复用最新成功 interaction turn；Embedding/实际搜索使用合并摘要，SearchRouter 仅判断字段值，避免“当前状态”标签误触联网。focused 80/80、`DATABASE_URL=local npm test` 383/383、0 skip，build 13/13，CRITICAL compliance correction-cycle-2 与 quality/safety correction-cycle-3 均 PASS。未调用真实 GPT、博查或飞书，未 push/部署。
- 2026-07-16：`S10-CS-5` PASS / `S10-CS-6` START。完成独立 Admin scrypt+RFC6238 TOTP、全局 counter 防重放、30 分钟 DB idle TTL + 浏览器 Session cookie、Origin/权限矩阵、10 天筛选详情、badcase、fresh-TOTP JSON/CSV 流式导出与公式防护；邀请码来源 abuse、管理员锁定、Provider/Search incident 和事务 Outbox 统一稳定 key。飞书 custom webhook 改为白名单 `interactive` 卡片并按官方 `code === 0` 判断业务成功，HTTP 200 业务错误、畸形响应、timeout、lease 和 bounded retry 均覆盖；投递边界诚实冻结为至少一次。Task 5 affected 130/130、`DATABASE_URL=local npm test` 444/444、0 skip，build 16/16，diff/secret scan 与 CRITICAL compliance、quality/safety 双审查 PASS。真实 GPT、博查、飞书均未调用，未 push/部署。
- 2026-07-16：`S10-CS-6` 进入 VERIFY BLOCKED。完成访客三 workflow、真实 Abort stop、原位 retry、12 小时 history、阶段状态、来源分组、独立 `/admin` 壳与双端管理 UI；离线 `chat:eval` 53/53、externalCalls 0；本地 CPU BGE 重摄取 9 documents/10 chunks、第二轮 9/9 skip，RAG top1 18/20、top3 20/20，最低正例 0.460884、最高负例 0.420975；Task 6 无子进程合同 74/74、PostgreSQL RAG 3/3、Mock production API 主链和 Admin 操作 PASS，build 17/17，diff/secret scan PASS。CRITICAL quality/safety 审查发现并修复 browser harness 在移动授权截图前提前过期 Session 的 blocker，新顺序合同 8/8。当前沙箱禁止 Node/Python 子进程，且内置浏览器拒绝本地验收 URL，故 `visual:s10`、四张截图、console/overflow 与当前 Task 6 零 skip 全套仍未验收；未 commit、未 push、未部署。
- 2026-07-17：`visual:s10` 在一次性 production + Mock OpenAI/Bocha + disposable pgvector 环境通过 17/17，生成四张授权态 1440/390 截图，overflow、console error、page error 均为 0；内置浏览器实页复验三 workflow 与双宽布局通过。CRITICAL compliance 发现并关闭 Admin CSV 落入证据目录的 blocker，下载改用受控系统临时目录并在 `finally` 清理；两份空的 ignored E2E 日志一并精确删除。第三次真实 GPT 集成 smoke 搜索关闭，在 interaction 预留前失败并记为 `BLOCKED_CONFIG`，三次预算耗尽；未调用真实博查/飞书。恢复既有 `revolution-pgvector` 后，显式本地 `DATABASE_URL` 的全量测试为 491/491、0 fail、0 skip；CPU BGE `rag:eval` 为 top1 18/20、top3 20/20，最低正例 0.460884、最高负例 0.420975，0.45 正负阈值均通过。结合 `chat:eval` 53/53、externalCalls 0、build 17/17、diff/secret scan 与 CRITICAL 双审查，S10 达到 `LOCAL_READY` 并完成 `KNOWLEDGE_RECONCILED`；未 push、未部署。
- 2026-07-17：用户重新授权合并与真实 API 调用。隔离端口关闭搜索后完成 1 次真实 `gpt-5.4-mini` Responses 集成：HTTP 200、SSE 正常到 `done`、5 个站内来源、消息额度 30→29；数据库记录 `completed`、9872ms、`used_search=false`。中转没有返回 token usage，成本保持未知；回答未遵守“一句话”长度要求，作为真实 badcase 观察点保留。联调同时发现 `/api/health` 将 Provider readiness 错绑到可选成本单价，已用失败测试拆分为 `configured` 与 `costConfigured`。

## Preauthorization Matrix

| Action | State |
|---|---|
| 本地文件/测试/构建 | allowed |
| 本地 PostgreSQL 既有项目容器 | inspect/start/migrate/test allowed；只清理本轮测试行 |
| 本地 BGE | 复用既有环境，loopback start/eval allowed；禁止安装新包 |
| 中转 GPT | 用户于 2026-07-17 重新授权 1 次真实集成调用；已使用并 PASS，不再自动追加调用 |
| 博查 / 飞书 | 凭据缺失，真实调用 forbidden；Mock allowed |
| 依赖安装 | forbidden；本轮零新增依赖 |
| Git commit | allowed，必须精确 stage，排除 AGENTS.md 与未知文件 |
| 本地 merge | 用户于 2026-07-17 明确允许，完成验证和收口后执行 |
| Push / PR / deploy | forbidden |
| 外部资产四目录 | read-only；本轮实现不需要继续读取 |
| 破坏性数据库/文件操作 | forbidden；disposable test database 除外 |

## Closeout Policy

- 所有行为变更严格 RED → GREEN；机械文档/配置验证精确内容。
- 每个阶段完成后先 spec/compliance review，再 quality/safety review；阻塞项关闭后推进。
- Mock、本地 pgvector、真实 GPT、真实博查和真实飞书证据不可互相替代。
- 最终必须同步蓝图、run-state、本文件、验证证据和 continuation state；不部署、不 push。
