# S8 智能客服对话可用性闭环

> 准备日期:2026-07-13
> 分支基线:`codex/s7-multipage-portfolio@91fca44`
> Profile:`CRITICAL`
> 状态:`EXECUTION COMPLETE · MAINLINE PASS`
> 主线:S8 commit `71a6213` 已通过 merge commit `9ca4895` 吸收到本地与远端 `master`
> Implementation plan:`docs/superpowers/plans/2026-07-14-s8-customer-service-conversation.md`

## Outcome

把已经存在的数字摩斯技术 MVP 变成受控访客真正可用的智能客服对话闭环。招聘方、潜在合作方和同行输入短期邀请码后,可以选择来访目的或直接提问,获得基于审核公开知识的实时流式回答、可访问的站内来源和明确下一步;失败时能恢复,回答质量能被持续评测。

这不是从零建设 Chat/RAG。M3 已有短期码、HttpOnly 会话、SSE、OpenAI Provider、PostgreSQL + pgvector、短期记忆、来源和预算门;S8 只补当前用户体验与可靠性缺口。

## Approach Decision

| 方案 | 收益 | 风险 | 结论 |
|---|---|---|---|
| A. 只接通真实 GPT | 最快得到一次回答 | 不解决半截流、失败扣额度、不可导航来源和质量不可量化 | 不采用 |
| B. 在 M3 上补可用性闭环 | 复用现有架构,能形成真实可验收产品路径 | 需要同时覆盖服务端失败补偿、前端状态和评测 | **采用** |
| C. 直接加入联网搜索 Agent | 可回答实时外部问题 | 引入工具权限、提示注入、事实时效、引用和成本治理 | Parked |

设计原则:YAGNI。访客意图采用显式选择和规则化上下文,本阶段不为意图分类再调用一个模型;继续使用 pgvector,不部署 Milvus/Qdrant;不把数字人、语音或联网搜索混进首个对话闭环。

## Current Capability And Gap

| 能力 | 当前证据 | S8 缺口 |
|---|---|---|
| 受控访问 | `/api/access`,短期码,HttpOnly cookie,过期与额度 | 保留;补完整端到端验收 |
| 实时对话 | `/api/chat` 输出 `meta/delta/done/error` | 补中断、失败与重试状态 |
| GPT 接入 | OpenAI Responses Provider 抽象 | 用当前配置做最多 3 次真实 smoke,不能用 Mock 冒充 |
| RAG | 本地 BGE + pgvector,top-3 gold 通过 | S7 改为 `site-content.json` 后尚未重摄取 |
| 短期记忆 | PostgreSQL conversation history | Provider/Embedding 失败会留下 user message 并消耗消息额度 |
| 来源 | SSE 返回 title/sourcePath | UI 仅显示标题,不能进入对应公开页面;不应向客户端暴露内部内容路径 |
| 访客分流 | 招人的/找人做事的/同行交流快捷入口 | 只预填问题;缺少稳定的 audience intent 与回答结构 |
| 质量评测 | 9 条 retrieval gold questions | 缺少三类访客、拒答、注入、错误恢复和真实 GPT 分层证据 |

## Product And Interaction Contract

- 目标用户优先级:招聘方/面试官第一,潜在客户或合作方第二,Agent/RAG 同行第三。
- 主路径:打开全站唯一“对话”入口 -> 输入短期码 -> 选择“招人的 / 找人做事的 / 同行交流”或直接提问 -> 流式回答 -> 查看来源 -> 继续追问或进入对应案例。
- 三个快捷入口设置显式 `audienceIntent`: `recruiter`、`collaboration`、`peer`;自由输入默认为 `general`。`recruiter` 继续使用面试官模式,其余使用普通模式。
- 快捷入口只预填可编辑问题,不自动调用 Provider,避免误耗额度。
- 桌面继续使用固定右侧对话面板;390 移动端继续使用全屏对话。S8 不重设计作品集视觉,只修对话主流程和状态。
- 回答结构:先直接回答,再给事实证据,信息不足时明确边界,最后给一个可执行下一步。不得为凑完整度编造履历、数字、客户、联系方式或未公开能力。
- 来源只返回公开 `href`、标题和稳定文档 ID;项目来源进入 `/works/<slug>`,个人/FAQ 来源进入相应公开页。内部 JSON path 和本地路径不进入浏览器协议。
- 失败状态必须区分:访问过期、消息额度耗尽、月预算耗尽、检索失败、Provider 失败、流中断。每种状态都给下一步;可恢复错误提供“重试本次问题”。
- Provider 或 Embedding 在完成前失败时,本次 turn 不得永久占用消息额度,不得留下一条孤立 user history;部分输出不能作为已完成回答保存。
- 当前公开知识不足以回答的问题必须诚实拒答并记录为评测缺口;S8 不读取 `content/drafts/**` 或外部本地仓库补答案。

## Architecture And Data Flow

1. `MorseChat` 生成受控请求:`message + mode + audienceIntent + conversationId`。
2. `/api/chat` 完成输入规范化和服务端会话鉴权,客户端不能直接接触 Provider key。
3. `runChat` 预留 turn,调用 configured embedding,从本地 pgvector 检索审核公开知识。
4. Prompt builder 组合 persona、audience intent、回答结构、历史和不可信知识证据。
5. Provider 通过 SSE 流式返回;完成后一次性固化 assistant、usage 和预算级别。
6. 任一完成前失败进入补偿路径,恢复消息额度与历史一致性,再输出稳定公开错误码。
7. 客户端把来源渲染为站内链接,把可恢复错误渲染为重试动作。

不得让 React 组件直接依赖 PostgreSQL、Provider SDK 或内部 source path。Provider、retrieval、turn lifecycle、SSE parser 与 UI state 保持独立可测边界。

## Definition Of Done

- 未持有效短期码时 `/api/chat` 拒绝,作品集所有公开页面仍可浏览。
- 三类快捷意图和自由提问可稳定进入正确 prompt context,不增加额外意图分类模型调用。
- 正常路径流式显示状态、正文、剩余额度和可点击公开来源;追问带上同一短期 conversation history。
- 访问过期、消息额度、预算、检索、Provider 和流中断均有稳定错误码、用户文案和下一步。
- Provider/Embedding 失败不产生孤立消息或永久扣减消息次数;重试成功只形成一个完成回答。
- S7 唯一公开知识源 `content/site-content.json` 以幂等方式重摄取到本地项目数据库;`content/s3-content.json` 与 `content/drafts/**` 不进入新索引。
- 评测集覆盖至少 20 个用例:三类访客问答、跨项目问题、证据不足拒答、prompt injection、off-topic、访问/预算/Provider 错误和来源导航。
- Retrieval 维持 top-3 全通过;真实 GPT smoke 覆盖 recruiter/collaboration/peer 各 1 问,总计最多 3 次,并逐项人工检查事实、引用、边界和下一步。
- Mock 浏览器闭环在 1440x900 与 390x844 通过:解锁、三类意图、流式文本、来源跳转、重试、过期、退出、无横向溢出、console/page error 为 0。
- `prefers-reduced-motion` 下无新增持续动画;对话入口不重复挂载。
- `npm test`、本地 PostgreSQL 集成、`npm run rag:eval`、`npm run build`、`git diff --check` 全部通过。
- 证据严格标记为 static analysis / local tests / local pgvector / loopback Mock / real Provider / human acceptance,不得互相冒充。

## Task Center

```yaml
source_of_truth: docs/portfolio-blueprint.md#12 + docs/task-center/s8-customer-service-conversation.md
current_pointer: docs/task-center/run-state.md#current_pointer
stage_package: docs/task-center/s8-customer-service-conversation.md#stage-package
next_allowed_pointer: docs/task-center/run-state.md#next_allowed_pointer
run_state_location: docs/task-center/run-state.md
failure_register: docs/task-center/s8-customer-service-conversation.md#failure-register
stage_contract_location: docs/task-center/s8-customer-service-conversation.md
progress_ledger: docs/task-center/s8-customer-service-conversation.md#progress-ledger
phase_registry: docs/task-center/s8-customer-service-conversation.md#phase-registry
closeout_policy: docs/task-center/s8-customer-service-conversation.md#closeout-policy
stale_pointer_scan: rg -n "S7 MULTIPAGE VERTICAL SLICE PASS|S8-CS-" docs/task-center docs/portfolio-blueprint.md
```

## Phase Registry

| Pointer | State | Exit evidence |
|---|---|---|
| `S7 MULTIPAGE VERTICAL SLICE` | PASS | `docs/task-center/s7-multipage-portfolio.md` |
| `S8-CS-0 INTAKE + RED` | PASS | inventory,98% confidence,expected failing tests |
| `S8-CS-1 TURN RELIABILITY` | PASS | failure compensation integration tests 10/10 |
| `S8-CS-2 INTENT + SOURCES` | PASS | prompt/source/API focused tests 15/15 |
| `S8-CS-3 CLIENT UX` | PASS | component tests,production build + dual-width browser evidence |
| `S8-CS-4 KNOWLEDGE + EVAL` | PASS | idempotent ingest 9/9 skip;20-case top-3 20/20 |
| `S8-CS-5 REAL E2E` | PASS / REAL PROVIDER BLOCKED | loopback Mock `failures: []`;3-call real limit exhausted without completed `runChat` |
| `S8-CS-6 CLOSEOUT` | PASS | full verification,CRITICAL reviews,evidence and task-center sync |

## Stage Package

### S8-CS-0 INTAKE + RED

- Verify current checkout contains `a4eba23`,S7 HEAD `91fca44`,and no tracked user changes.
- Inspect only presence/health of configured env,project pgvector and local embedding;never print values.
- Confirm current database knowledge counts/source paths before any write.
- Write failing tests for audience intent,public source href,failure compensation,retry UI and expanded eval contract.
- If implementation confidence is below 96%,write `docs/task-center/decisions/s8-<topic>.md`;do not start GREEN.
- Exit:focused RED failures are attributable to missing S8 behavior,not broken baseline.

### S8-CS-1 TURN RELIABILITY

- Add a bounded turn lifecycle so Embedding/retrieval/Provider failure is compensated.
- Preserve session concurrency and message-limit enforcement;do not hold a database transaction open during Provider streaming.
- Emit stable public error codes without provider payloads or raw errors.
- Exit:database integration proves no orphan user message,no permanent quota decrement and no usage row on failed turns;successful turns retain current memory and cost behavior.

### S8-CS-2 INTENT + SOURCES

- Extend the request contract with four allow-listed audience intents and reject invalid values.
- Add intent-specific prompt guidance without an extra classifier call.
- Map knowledge documents to public href server-side;remove internal source paths from the public SSE payload.
- Exit:unit/API/integration tests cover all intents,injection boundaries,unknown-answer behavior and exact public routes.

### S8-CS-3 CLIENT UX

- Keep the existing panel visual language and token system;do not redesign the surrounding portfolio.
- Isolate SSE parsing/request state enough to test complete,partial,error,retry and expired-access flows.
- Add explicit retrieval/answering state,source links and retry for recoverable failures;preserve user input when sending fails.
- Verify keyboard focus,dialog labeling,44px controls,long text and mobile full-screen behavior.
- Exit:focused UI tests pass and no raw color value or external runtime asset is added.

### S8-CS-4 KNOWLEDGE + EVAL

- Idempotently reingest only audited `content/site-content.json` into the local project database.
- Expand retrieval/behavior evaluation to at least 20 cases with expected document,expected refusal or expected error behavior.
- Produce a coverage report that separates “system failure” from “public knowledge missing”;do not promote missing facts into live content.
- Exit:active indexed source paths contain only `content/site-content.json#...`;top-3 retrieval passes;all deterministic behavior cases pass.

### S8-CS-5 REAL E2E

- Run the complete loopback Mock browser path first at 1440 and 390.
- Only after Mock PASS,run at most 3 real GPT questions,one per primary audience,through the configured OpenAI-compatible endpoint.
- Do not store raw prompts,raw outputs,provider payloads,authorization headers or keys in evidence;record only redacted outcome and evidence label.
- Direct OpenAI or configured endpoint failure parks only real Provider evidence;it does not invalidate a passing local/Mock closeout.
- Exit:Mock E2E PASS;real Provider is PASS or explicitly BLOCKED with cause and no more than the allowed calls.

### S8-CS-6 CLOSEOUT

- Run focused tests,full tests with local PostgreSQL,RAG eval,build,diff-check,secret scan and dual-width browser verification.
- Run independent read-only review for correctness,security,scope and evidence labels;maximum 2 correction cycles.
- Sync blueprint,run-state,phase registry,progress ledger,failure register and evidence index.
- Local commit is allowed only after PASS with explicit staging;exclude all pre-existing untracked files.
- Exit:one honest closeout packet with changed files,commands/results,real-vs-Mock status,parked gaps and next pointer.

## Research Lane

- Local authority order:`AGENTS.md` -> `docs/portfolio-blueprint.md` -> current Task Center -> code/tests -> official SDK types/docs.
- Public web is allowed only for current official OpenAI Responses/Embeddings behavior that changes an implementation decision.
- Research must change scope,stage order,evidence,stop conditions,preauthorization or pointer;otherwise do not create research theater.
- Confidence `>=96%`:implementation allowed after explicit launch. `95%-96%`:only reversible test-first work if launch prompt explicitly accepts it. `80%-95%`:research/design only. `<80%`:park,rewrite or ask one blocking question.

## Allowed Scope

- `app/api/chat/**`,existing access/health routes only where the chat contract requires it
- `components/MorseChat*` and focused client helpers/components
- `lib/server/chat-*`,`rag.ts`,`public-knowledge.ts`,`knowledge.ts`,`sse.ts`,provider interfaces as required
- `db/migrations/**` only if S8-CS-1 proves compensation cannot be correct without schema support;requires pointer update and approval before creation
- `content/rag-eval.json` and a dedicated S8 chat eval dataset
- `scripts/ingest-knowledge.mjs`,`rag-eval.mjs`,focused S8 browser/eval scripts
- `tests/**`,`docs/task-center/**`,`docs/portfolio-blueprint.md`,`docs/verify/s8/**`

## Forbidden Scope And Non-goals

- 不生成或接入数字人形象;不做语音、TTS、口型或自动播放带声视频。
- 不做联网搜索、网页浏览、MCP 工具调用或 autonomous Agent。
- 不部署 Milvus/Qdrant;不更换 PostgreSQL + pgvector 架构。
- 不做长期访客画像、长期自主记忆、知识自动发布、管理后台或通知渠道集成。
- 不读取或上线 `content/drafts/**`;不写 `E:\Wiki`、`E:\demo2`、`E:\小红书`、`E:\多agent`。
- 零新增 npm/Python 依赖;不修改外部或远程数据库;不部署、不绑定域名、不 push、不创建 PR。
- S8 实现阶段不创建新的功能分支或 worktree;阶段完成后摩斯于 2026-07-14 显式授权 merge 与 push,主线吸收已完成。
- 不 stage `AGENTS.md`、现有 `docs/research/**` 用户文件、`docs/verify/concepts/**`、`output/**` 或旧临时脚本。

## Preauthorization Matrix

以下 `allowed` 仅在摩斯明确发送“执行 S8”或运行本阶段 Automation Launcher 后生效;当前准备动作不继承执行授权。

| Action | State |
|---|---|
| Provider | allowed after Mock PASS;最多 3 次 GPT smoke;同类失败 2 次即停 |
| Browser CDP | allowed;仅 loopback 本站 1440/390,不得操作用户登录态外部标签页 |
| Public Web | allowed;仅官方 OpenAI/SDK 一手资料且必须改变决策;运行时联网搜索 forbidden |
| Docker | allowed;只 inspect/start 既有项目 pgvector,绑定 `127.0.0.1:55432`;不得新建其他服务 |
| External APIs | allowed;仅已配置 OpenAI-compatible Responses smoke,不得调用其他外部 API |
| Network install | forbidden;零新增依赖 |
| Database or migration | local project DB ingest/test rows allowed;远程 DB forbidden;schema migration approval-required |
| Secrets | env-only;不得打印、写入、提交或进入证据 |
| Cost and retry budget | 3 real calls total;max output 受现有配置限制;同类失败 2 次停止 |
| Commit | allowed after all required verification;explicit staging only;不 merge |
| Push/deploy/PR | forbidden |
| Destructive operations | forbidden;测试只能清理自己创建且可精确定位的行 |
| Automation creation | forbidden;本轮只准备 launcher,不创建后台自动化 |

## Failure Register

| ID | Current state | Route |
|---|---|---|
| `S8-F1` | CLOSED:精确补偿与幂等重放覆盖失败、空白完成和 lost-done | 113/113 local tests |
| `S8-F2` | CLOSED:公开 SSE 只返回 `documentId/title/href/score` | source contract + browser navigation PASS |
| `S8-F3` | CLOSED:`site-content.json` 已幂等重摄取 | 9 documents/9 chunks;invalid source 0 |
| `S8-F4` | PARKED:公开知识仍不覆盖全部 Agent/Memory 面试深度 | 保持诚实边界;不得从草稿或外部仓库自动补写 |
| `S8-F5` | BLOCKED:3 次正式 `runChat` 未完成,调用预算耗尽 | 禁止第 4 次;不伪造 `ChatServiceError` 之外的根因 |
| `S8-F6` | CLOSED:S8 已并入本地与远端 `master` | merge commit `9ca4895`;未部署 |

## Progress Ledger

- 2026-07-13:`S8-CS-0` 合同准备完成;implementation not started;Provider/DB/Browser 未执行。
- 2026-07-14:`S8-CS-0` START;摩斯已显式授权执行 Goal。Profile 因 auth/secret/Provider/数据库风险提升为 CRITICAL。只读 intake 确认本地项目 pgvector healthy;当前进程仅确认 `OPENAI_API_KEY` 存在,其他 Provider/Embedding/DB 配置未设置,未读取或记录任何值。失败补偿可通过精确 user-message ID + 同事务额度回退实现,不需要 schema migration;实现置信 98%。
- 2026-07-14:`S8-CS-0` PASS / `S8-CS-1` START;local PostgreSQL RED 为 2 pass / 2 expected fail。两条新增测试分别在 raw Provider error 与 raw Embedding error 处失败,原成功流与消息上限保持 PASS;未修改 schema、Provider 或数据库结构。
- 2026-07-14:`S8-CS-1` PASS / `S8-CS-2` START;精确 user-message ID 补偿在短事务中删除失败 turn 并仅在删除成功时回退一次 message_count。Provider/Embedding 两类失败、成功流、额度上限、API/core focused tests 为 10/10 PASS;无 schema migration。
- 2026-07-14:`S8-CS-2` PASS / `S8-CS-3` START;四类 allow-list audience intent、直接回答/证据/边界/下一步 prompt 契约、公开 href 和内部 sourcePath 分离、href checksum 与旧 metadata fallback 完成;local PostgreSQL focused 15/15 PASS。
- 2026-07-14:`S8-CS-3` CODE PASS / `S8-CS-4` START;快捷 intent、两段流式状态、公开来源链接、recoverable-only retry 与复用 assistant bubble 完成;UI adjacent 17/17 与 production build PASS。真实双宽交互未冒充静态证据,移入 S8-CS-5 browser gate。
- 2026-07-14:`S8-CS-4` PASS / `S8-CS-5` START;公开知识仅从 `content/site-content.json` 重摄取,final second ingest 9/9 skip。local BGE + pgvector 20-case semantic eval 为 top-1 17/20、top-3 20/20;DB 为 9 documents/9 chunks,invalid source 0,missing public href 0。
- 2026-07-14:`S8-CS-5` PASS / `S8-CS-6` START;隔离 production + fail-first Mock 在 1440x900/390x844 均 `failures: []`,quota 30→29,非预期 console/page error 0,来源分别导航到 `/works/digital-morse` 与 `/`。真实 Provider 3 次 `runChat` 未完成,按上限停止并标 BLOCKED。
- 2026-07-14:`S8-CS-6` PASS;local PostgreSQL `npm test` 113/113,chat eval 24/24,RAG top-1 17/20/top-3 20/20,build/diff/secret/source scan PASS;CRITICAL compliance 与 quality/safety review 均 PASS,BLOCKER 0。证据:`docs/verify/s8/s8-closeout.md`。
- 2026-07-14:摩斯显式授权 closeout merge + push;S8 commit `71a6213` 经双父 merge commit `9ca4895` 吸收到本地与远端 `master`,合并树与已验证 S8 tree 完全一致;未部署。
- 后续每个 stage 只追加 `START/PASS/BLOCKED`,证据类型和下一指针;聊天摘要不更新状态。

## Minimal LOOP Contract

- State source:`docs/task-center/run-state.md` + 本合同,不从聊天记忆恢复指针。
- Previous evidence:S7 closeout,M3 closeout,当前 failure register,最近一次 stage verification/review。
- Next cycle selection:当前指针的最高价值安全任务;阻塞时登记并切换到下一独立 stage。
- Research fallback:低于 96% 时先写 Decision Note,再 implement/split/park;不能用猜测补齐。
- Pointer update rule:只有 `run-state.md` 能推进;每次推进同时更新 phase registry/progress ledger 和 stale-pointer scan。
- Stop/escalate:低置信、越权、密钥风险、费用/重试耗尽、数据库/部署破坏风险、Critical/Important review blocker、无法区分 Mock 与真实证据、无独立安全任务。
- Next LOOP packet:最新指针、已关闭证据、失败登记、未决缺口、real-vs-Mock 状态和 continue/pause 建议。

## Closeout Policy

- Behavior changes follow RED -> GREEN;不得先写实现再补契约。
- 每个非平凡代码 stage 需要独立只读 review;最终 controller 亲自检查桌面/移动关键截图。
- `git diff --check` 与精确 staged-file 审计是提交前硬门。
- S8 完成只表示本地智能客服文字对话闭环可用,不表示已经部署、公开上线、具备联网搜索或数字人能力。
- 任何未通过的 real Provider 证据必须保留为 BLOCKED/PARTIAL,不能被 Mock 或本地测试覆盖。
- 最终证据索引:`docs/verify/s8/s8-closeout.md`;merge/push 已完成,部署和下一阶段仍需要新授权。
