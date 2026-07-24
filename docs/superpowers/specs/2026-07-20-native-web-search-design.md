# 数字摩斯原生联网搜索设计

> Absorption note (2026-07-25): This is a deferred replacement design, not current mainline behavior. Mainline still uses the separately called Bocha search-provider path; native Responses `web_search` has not been implemented or released. Revalidate Provider compatibility and the current chat contract before any implementation.

> 日期：2026-07-20
>
> 状态：用户已确认设计，待书面规格审阅
>
> Morse 控制：`STAGED / CRITICAL / LOCAL`
>
> 基线：`origin/master@b6ddad5`
>
> 目标分支：`codex/native-web-search`

## 1. 背景与证据

当前聊天主链使用 OpenAI-compatible Responses Provider，但联网仍是回答前独立调用 Bocha，再把标题、摘要和 URL 注入模型。生产配置保持 `MORSE_SEARCH_ENABLED=false`，没有 `BOCHA_API_KEY`，真实 Bocha 从未验收；现有 Bocha 证据仅覆盖 Mock 和合同测试。

主 Provider 已用生产兼容 `User-Agent` 对 `gpt-5.6-terra` 完成一次真实原生 `web_search` 探测：请求最终 `completed`，返回 `web_search_call` 和 `message`，延迟约 8279ms，usage 为 12821 input / 32 output tokens。这个证据只证明基础能力可达，不证明中文检索质量、多轮稳定性、完整来源、`tool_choice: required`、`max_tool_calls` 或所有流式事件均与官方实现兼容。未携带兼容 `User-Agent` 时出现过主节点 502 和备用节点 403，因此实现必须复用正式 Provider 客户端配置，不能另建裸请求。

OpenAI 官方 Responses 文档确认：

- 新接入使用 `{ type: "web_search" }`；模型在 `auto` 下可以不调用工具。
- 必须搜索时使用 `tool_choice: "required"` 或指定搜索工具。
- 输出包含 `web_search_call`、`message` 和 `url_citation` annotations；可通过 `include: ["web_search_call.action.sources"]` 获取完整来源。
- 面向用户展示联网结果时，行内引用必须可见且可点击。
- 搜索动作可能产生单独的工具调用费用；`search_context_size` 影响提供给模型的搜索上下文，但不是精确 Token 上限。

官方参考：

- https://developers.openai.com/api/docs/guides/tools-web-search
- https://developers.openai.com/api/docs/guides/tools

## 2. 目标与非目标

### 2.1 目标

1. 在不增加搜索账号、外部搜索服务或运行时依赖的前提下，为数字摩斯接入现有 Responses Provider 的原生 `web_search`。
2. 站内审核知识继续拥有个人事实、项目、履历和能力信息的唯一解释权。
3. 只在联网能够改变答案正确性时开放搜索，并控制每会话成本。
4. 保留现有来源展示、10 天审计、管理后台复盘、停止、重试和 Provider 故障转移能力。
5. 搜索失败时诚实降级，不以模型记忆冒充“最新”或“已核验”。
6. 生产可以通过独立 kill switch 立即关闭联网，不依赖数据库回滚。

### 2.2 非目标

- 不注册或真实调用 Bocha，不接入 SearXNG、Tavily、Serper、浏览器抓取或其他搜索项目。
- 不启用 hosted shell、Skills tool、MCP 或任意代码执行能力。
- 不做 deep research、后台长任务、多页面研究报告或图片搜索。
- 不向访客提供联网开关、域名过滤器或搜索次数配置。
- 不把搜索结果写回公开知识库。
- 本阶段不 push、不部署、不修改生产环境变量、不执行新的真实 Provider 调用。
- 不修改正在开发的私密简历 worktree。

## 3. 方案选择

### 3.1 采用：单次 Responses 内原生搜索

服务端先完成站内检索和确定性策略判断，再在同一次回答请求中按需提供 `web_search`。模型完成搜索、分析和回答，应用解析工具事件和引用。

优点：只有一次 LLM 请求；不增加账号和服务；原生引用与模型回答同源；总体延迟和成本低于两阶段方案。代价：原生搜索发生在 Provider 内部，应用只能在调用后看到实际查询；SSE、审计和故障转移必须理解工具事件。

### 3.2 不采用：先搜索、再第二次 LLM 回答

第一阶段单独请求搜索，第二阶段把结果交给 LLM。查询和引用容易控制，但会增加一次 Provider 往返、推高 Token 和延迟，并扩大失败组合。只有当单次 Responses 无法满足隐私或兼容性合同，才重新评估该方案。

### 3.3 不采用：只向 Provider 透传工具

仅增加 `tools: [{ type: "web_search" }]`，不解析事件、不保存审计、不改引用和故障转移。改动最小，但无法证明是否搜索、来源是否安全、是否重复计费，也不满足管理后台和官方可点击引用要求。

## 4. 第一性原理搜索策略

联网不是默认能力，而是证据路由。`search-router.ts` 继续作为确定性服务端策略，不增加第二次意图分类模型调用。

| 问题类型 | 模式 | 行为 |
|---|---|---|
| Morse 本人、作品、履历、能力、联系方式、站内统计 | `disabled` | 只查审核知识，个人事实 veto 优先级最高 |
| 私密简历、Cookie、凭据、联系方式、明显 PII | `disabled` | 不向搜索工具开放该轮输入 |
| 用户粘贴的 JD、需求或长文 | `disabled` | 默认只做用户输入与站内证据分析 |
| 外部稳定概念且站内证据充分 | `disabled` | 直接回答，不为“可能更好”而联网 |
| 外部稳定概念但证据不足 | `auto` | 提供工具，由模型判断是否必须检索 |
| 最新版本、价格、政策、安全公告、当前状态 | `required` | 必须搜索；失败则拒绝声称最新 |
| 用户明确要求联网、查证、核验或官方来源 | `required` | 必须搜索；使用额外核验额度 |
| 个人事实与外部事实混合 | 分拆 | 个人部分只用站内证据；仅为外部部分生成最小搜索指令 |

策略输出统一为：

```ts
type WebSearchMode = 'disabled' | 'auto' | 'required';

interface SearchRouteDecision {
  mode: WebSearchMode;
  reason: SearchRouteReason;
  minimalQuery: string | null;
  quotaLimit: 1 | 2;
}
```

`minimalQuery` 是服务端从当前问题生成的短查询提示，不包含完整历史、JD、站内检索片段或身份数据。内置搜索工具最终查询由模型生成，单次 Responses 架构无法在执行前硬拦截，因此实现还必须：

1. 对敏感输入完全不提供工具，而不是只依赖提示词。
2. 在 instructions 中要求仅搜索 `minimalQuery` 所表达的外部主题。
3. 从 `web_search_call.action` 记录实际查询，供后台复盘偏离。
4. 对查询偏离不宣称事前强制阻断；如需硬性查询代理，必须重新评估两阶段方案。

## 5. 配置与启动合同

`MORSE_SEARCH_ENABLED` 继续是唯一联网 kill switch。启用时新增两种 Provider 值：

```text
MORSE_SEARCH_PROVIDER=native | bocha
```

- `native`：要求 `OPENAI_CHAT_PROTOCOL=responses`；不读取 `BOCHA_API_KEY` 或 `BOCHA_BASE_URL`。
- `bocha`：保留现有配置合同和适配器，便于历史兼容，但本阶段不启用、不验证、不推荐。
- 搜索关闭：`searchProvider=null`，不得因为遗留的 Provider 值或空 Bocha 变量启动失败。
- `native + chat_completions`：生产配置校验直接失败，禁止静默退回无搜索回答。
- 默认会话预算从 5 收紧为 2；自动搜索使用阈值 1，明确核验使用阈值 2。

生产发布仍先保持：

```text
MORSE_SEARCH_ENABLED=false
```

只有单独授权的真实兼容 smoke 通过后，才允许设置：

```text
MORSE_SEARCH_ENABLED=true
MORSE_SEARCH_PROVIDER=native
MORSE_MAX_SEARCHES_PER_SESSION=2
```

## 6. Provider 接口与请求合同

### 6.1 应用接口

`AnswerRequest` 增加可选搜索配置：

```ts
interface NativeWebSearchRequest {
  mode: 'auto' | 'required';
  minimalQuery: string;
  routeReason: SearchRouteReason;
}
```

`AnswerEvent` 在现有 `delta / done` 外增加 Provider 无关事件：

```ts
type AnswerEvent =
  | { type: 'delta'; text: string }
  | { type: 'web_search_started'; callId: string }
  | { type: 'web_search_completed'; callId: string; queries: string[]; sources: SearchResult[] }
  | { type: 'citation'; startIndex: number; endIndex: number; url: string; title: string }
  | { type: 'done'; usage: TokenUsage | null };
```

事件是应用内部归一化合同，不把 OpenAI SDK 类型泄漏给 `chat-service`、SSE 或客户端。

### 6.2 Responses 请求

当模式不是 `disabled` 时，请求增加：

```ts
tools: [{
  type: 'web_search',
  search_context_size: 'low',
}]
tool_choice: mode === 'required' ? 'required' : 'auto'
max_tool_calls: 1
include: ['web_search_call.action.sources']
```

继续保持 `store:false`、现有 model、reasoning、超时、并发和生产兼容 `User-Agent`。省略与默认行为相同的 `return_token_budget`，避免给中转增加无收益的兼容字段；绝不设置 `unlimited`，也不启用图片、位置或深度研究。

主节点只验证过基础 `web_search`。`search_context_size`、`max_tool_calls`、`include` 和 `required` 在当前中转上的兼容性均属于后续真实 smoke 的明确验收项；Mock 通过不能替代该证据。

### 6.3 流式解析

Provider 解析以下 SDK 事件及最终 response output：

- `response.web_search_call.in_progress`
- `response.web_search_call.searching`
- `response.web_search_call.completed`
- `response.output_text.annotation.added`
- `response.output_text.delta / done`
- `response.completed / incomplete / failed / error`

实际 query、完整 sources 或 annotations 如果只在 output item 或最终 response 中完整出现，Provider 在 `response.completed` 时补齐归一化事件。相同 call、source 和 citation 必须去重。

## 7. 主链数据流

```text
访客问题
  -> 认证、额度和单飞检查
  -> 站内 RAG
  -> SearchRouter：disabled / auto / required
     -> disabled：现有回答主链
     -> auto|required：原子预留搜索槽位
        -> Responses + native web_search
        -> 搜索事件、正文 delta、annotations
        -> 来源安全过滤与引用映射
        -> 最终正文引用回填
        -> interaction_searches 完成或失败
  -> 保存回答、来源和 usage
  -> SSE done
```

原生工具与 Bocha 前置搜索不能在同一轮同时启用。配置与 `chat-service` 分支必须保证每轮只有一个搜索后端。

## 8. 引用、SSE 与前端

当前 UI 通过正文 `[来源N]` 标记和 `ChatSource[]` 生成可点击行内引用及底部来源列表。原生 annotations 往往晚于正文 delta 到达，因此采用“流式正文 + 完成前一次替换”：

1. `delta` 按现有行为实时显示，避免等待完整搜索回答。
2. 服务端累计完整正文、`url_citation` 范围和安全来源。
3. 完成前按 annotation 范围把引用转换为稳定的 `[来源N]`，相邻重复引用合并。
4. SSE 新增 `replace` 事件，用最终带标记正文原子替换已流式显示的文本。
5. SSE `meta.sources` 允许在任意 delta 之后再次到达，客户端按 source id 合并而不是覆盖或忽略。
6. 最终 `done` 只能在 `replace` 和最后一次 sources meta 之后发送。

引用转换必须覆盖中文、Emoji、代理对、重复 URL、重叠/越界 annotation 和 Provider 返回错误索引。索引无法安全对应时，不把 URL 插入正文；保留已过滤的底部来源并记录 `NATIVE_SEARCH_INVALID_CITATION`。所有外链继续使用新标签页和 `noopener noreferrer`。

原生来源只接受经现有安全规则规范化后的 HTTPS URL，拒绝凭据 URL、localhost、私网、元数据地址和无效协议。官方/GitHub/普通网页等级继续由服务端域名与 owner 配置判断，模型不能自报可信等级。

## 9. 搜索额度与持久化

不增加数据库迁移。继续复用：

- `access_sessions.search_count`
- `interaction_turns.used_search`
- `interaction_searches(query, route_reason, status, results, error_code)`
- `interaction_turns.knowledge_sources`

每轮仍由 `interaction_searches.interaction_turn_id UNIQUE` 保证最多一条搜索审计。流程如下：

1. 在 Provider 请求前锁定 `access_sessions` 和当前 running turn，原子创建 `pending` 搜索并增加 `search_count`，防止并发超额。
2. `auto` 使用 `maxSearches=1`；`required` 使用 `maxSearches=2`。总量最多 2 次。若明确核验先占用第一槽，后续自动搜索将被禁止，但仍可再进行一次明确核验；这是保守预算，不保证两个槽按类别各自独占。
3. 若 `auto` 最终没有出现 `web_search_call`，在事务中删除仍为 pending 的记录、递减 `search_count`、恢复该 turn 的 `used_search=false`。释放操作必须幂等且只作用于该 session/turn 所有者。
4. 若 `required` 没有出现工具调用，同样释放预留，但回答按 `NATIVE_SEARCH_NOT_USED` 失败，不能输出“已核验”。
5. 一旦出现工具调用，额度永久消耗；停止、超时或 Provider 失败只改变审计状态，不退还可能已经产生费用的调用。
6. 完成时以实际 query 替换预留 query，并把过滤后的来源数组写入 `results`；继续保持现有数组形状，避免破坏管理后台。

审计继续保留 10 天。不得存储原始 Provider payload、完整网页正文、推理内容、凭据或搜索结果缓存。`results` 只存标题、规范 URL、域名、类型、可选短摘要和实际 query 关联信息。

## 10. 故障转移、停止与重试

### 10.1 Provider 故障转移

- 在任何正文 delta 或 `web_search_started` 之前失败：保持现有节点切换和 outputless retry。
- 一旦出现 `web_search_started`：该请求进入不可重放状态，同一 Provider 内部不得 outputless retry，`FailoverAiProvider` 也不得切到下一节点。
- 失败节点已返回 usage 时继续累计；没有 usage 时保持 `NULL`，不以 0 冒充。

### 10.2 失败降级

| 场景 | 行为 | 审计错误码 |
|---|---|---|
| `auto` 未调用工具 | 正常使用模型回答，释放预留 | 无搜索记录 |
| `required` 未调用工具 | 不输出已核验结论，返回可恢复错误 | `NATIVE_SEARCH_NOT_USED` |
| 搜索开始后超时 | 中止，保留已发生费用的额度 | `SEARCH_TIMEOUT` |
| 搜索失败或流不完整 | `required` 不猜最新；`auto` 只保留明确非时效内容 | `SEARCH_FAILED` / Provider 稳定码 |
| 有调用但无有效引用 | 不宣称已核验，来源不展示 | `NATIVE_SEARCH_NO_CITATIONS` |
| citation 索引无效 | 不插入危险链接，保留安全底部来源 | `NATIVE_SEARCH_INVALID_CITATION` |
| 访客停止 | 立即 abort；已开始搜索则消耗额度 | `CLIENT_ABORTED` |

搜索要求是 `required` 时，搜索开始后的无引用、失败或不完整正文不得作为正常 assistant history 保存。分析日志保留部分输出和错误码，现有消息额度规则保持不变。

### 10.3 重试

- 搜索尚未开始即失败：现有同轮重试可以重新进入策略和预留流程。
- 搜索已经开始：同轮自动重试禁止再次搜索。访客需要明确发起新的核验请求，并使用剩余的核验额度。
- 同一个 turn 的预留、释放、完成和失败操作必须幂等，解决提交确认丢失时不得重复增减计数。

## 11. 安全边界

1. 搜索策略先于工具暴露，个人事实 veto 先于时效词和显式核验词。
2. 私密简历模块未来即使合并，也不得被公共聊天、RAG、搜索策略或 Provider adapter 导入；命中私密简历语义时联网 fail closed。
3. Prompt injection 不能修改模式、预算、允许域、来源可信等级或 kill switch。
4. 不把完整 conversation history、RAG chunk、JD 或站内文档拼入 `minimalQuery`。
5. 模型生成的 URL 不直接信任；只有 annotation/source 中通过服务端过滤的 URL 才能成为可点击链接。
6. 搜索不启用 shell、Skills、MCP、浏览器或网页代码执行。
7. Provider 仍会收到当前回答所需的聊天上下文，这与现有 LLM 调用一致；本设计只限制进入搜索查询的内容，不声称第三方 Provider 内部具备应用无法验证的数据隔离。

## 12. 实现边界

预计修改范围：

- `lib/server/search-router.ts`：模式、敏感 veto、最小查询和 1+1 阈值。
- `lib/server/ai-provider.ts`：搜索请求与归一化事件合同。
- `lib/server/openai-provider.ts`：Responses 工具参数和流式事件解析。
- `lib/server/failover-ai-provider.ts`：工具开始后的不可重放边界。
- `lib/server/chat-service.ts`：预留/释放、事件累计、引用回填、审计和降级。
- `lib/server/interaction-search.ts`：幂等释放与实际 query 完成。
- `lib/server/config.ts`、`production-config.ts`、`provider.ts`：`native` 配置与 fail-closed 校验。
- `lib/server/sse.ts`、`lib/client/chat-sse.ts`、`components/chat/useMorseChat.ts`：迟到 sources 和 `replace`。
- `components/chat/ChatMessageContent.tsx`、`ChatSources.tsx`：只做兼容性修正；不重新设计聊天 UI。
- 管理查询、导出和相关合同测试：保持原有搜索审计可见。
- `.env.example`、生产 runbook、task-center/blueprint：实现完成时按实际合同更新，生产开关仍关闭。

不新增 npm/Python 依赖，不改设计 token，不新增页面，不修改公共知识内容。

## 13. 测试与验收

### 13.1 单元与合同测试

- SearchRouter：个人事实、私密/PII、JD、站内充分、外部不足、时效、显式核验、混合问题和额度阈值。
- Config：disabled、native Responses、native Chat Completions 拒绝、Bocha 历史合同、缺失变量。
- Provider：全部 web search 事件、去重、最终补齐、`required/auto`、`max_tool_calls:1`、无调用、无引用、失败和 usage。
- 引用：中文、Emoji、重复 URL、相邻引用、重叠/越界索引、恶意 URL。
- Failover：工具前切换、正文后禁止、工具开始后禁止、内部 outputless retry 同样受限。
- SSE：delta 后到 sources、最终 replace、done 顺序、断流和重复 meta。

### 13.2 数据库集成

- 自动/核验阈值、并发预留、未调用释放、调用后不退还。
- 同 turn claim/release/finalize 幂等和 commit acknowledgement 丢失。
- 所有权校验、completed turn 拒绝、10 天清理和管理后台查询。
- 旧数组格式 search results 与新增原生结果同时可读。

### 13.3 应用与浏览器验收

- Mock Responses 覆盖：不联网、auto 未调用、required 成功、搜索失败、无引用、停止、工具后 Provider 失败。
- 1440x900 与 390x844：流式正文不跳位失控，迟到引用可点击，来源分组正确，停止/重试可理解。
- 控制台和 page error 为 0，无横向溢出；键盘和读屏状态保持现有合同。
- `npm test`、相关集成、chat smoke、`npm run build`、`git diff --check` 和密钥扫描通过。

### 13.4 真实证据门

本地 Mock 和构建不能证明中转完整兼容。只有用户单独授权付费 Provider 调用后，才执行最小真实 smoke，并逐项记录：

1. 正式 Provider 客户端和兼容 `User-Agent`。
2. `auto` 与 `required` 是否被接受。
3. `max_tool_calls:1` 是否生效。
4. sources include、annotations、查询和 usage 是否返回。
5. 延迟、工具调用次数、输入/输出 Token 和中转可见错误。
6. 主节点成功前不探测备用；主节点失败且仍未出现工具调用时，才按既定故障转移顺序验证。

真实调用仍只证明受测样本，不替代中文事实集质量评测。生产上线前应使用少量、不含个人信息的固定题集验证：最新版本、官方政策、安全公告、中文当前事实、无需联网的稳定概念和个人事实 veto。

## 14. 发布与回滚

本设计交付目标为 `LOCAL_READY`。实现、验证和独立审查完成后，通过 `closeout` 与 `KNOWLEDGE_RECONCILED` 收口；push 和部署均是单独审批边界。

未来获批上线时采用两步发布：

1. 部署包含原生搜索代码但保持 `MORSE_SEARCH_ENABLED=false`，验证 live/ready、普通聊天和管理后台无回归。
2. 完成受控真实 smoke 后设置 `MORSE_SEARCH_PROVIDER=native` 并开启搜索，观察命中率、失败率、延迟、usage 和搜索调用数。

回滚优先把 `MORSE_SEARCH_ENABLED=false` 并重启 Web；无 schema 变化，不需要 down migration。若普通聊天也受影响，再回滚应用镜像。不得通过填入虚假 Bocha key、放宽 URL 安全规则或跳过引用来维持表面可用。

## 15. 完成定义

只有同时满足以下条件，才可声称本地实现完成：

- 原生搜索策略、Provider 事件、引用、SSE、审计、预算和失败边界全部有失败优先测试并通过。
- 普通不联网聊天与现有 RAG 行为没有回归。
- 工具开始后不存在内部重试或跨节点重复搜索路径。
- 行内引用可见、可点击，恶意或无效 URL 不可进入 DOM。
- 1+1 保守预算和未调用释放由数据库集成证明。
- 生产配置仍关闭搜索，未调用真实 Provider，未 push，未部署。
- `npm run build`、1440/390 浏览器验收和规定检查通过。
- closeout 与知识对账达到 `KNOWLEDGE_RECONCILED`。

真实 Provider 兼容性和生产效果只有在后续获得明确授权并取得实时证据后，才能从“未验证”升级为 PASS。
