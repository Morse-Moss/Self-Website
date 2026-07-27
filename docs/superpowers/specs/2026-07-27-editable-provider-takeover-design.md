# Environment Provider 可编辑接管设计

日期：2026-07-27
状态：产品设计已确认，尚未实施

## 1. 背景

`/admin/api` 当前同时展示两类 Chat Provider：

- 数据库 Provider：由管理员手动创建，支持编辑、测试、激活、回退和删除；
- Environment Provider：由服务器 `OPENAI_*` 环境配置生成，只支持测试和加入路由，不支持编辑或删除。

截图中的 `Environment primary` 和 `Environment fallback 1` 不能编辑，不是权限或按钮故障，而是旧规格刻意设置的只读边界。该边界不适合 API 地址、Key、模型和推理参数频繁变化的使用场景。

本设计将后台中的日常 Provider 统一为可编辑的数据库配置。Environment Provider 第一次编辑时由服务端安全“接管”为数据库 Provider；原环境配置不被网页修改，只保留为隐藏的启动和紧急恢复来源。

本设计取代 `2026-07-21-admin-api-management-design.md` 中“环境目标不能编辑”和“环境目标永久作为普通只读路由候选”的规则。未被本设计明确修改的版本化、加密、测试门、路由快照、回退和审计规则继续有效。

## 2. 目标

- `Environment primary`、`Environment fallback 1` 和未来存在的 `Environment fallback 2` 均提供编辑入口。
- 管理员可以修改 Base URL、API Key、显示名称、User-Agent、模型 ID、协议、推理强度、输出上限和价格元数据。
- 首次接管后，Environment Provider 与手动创建的数据库 Provider 使用同一套版本、测试、激活、回退和删除机制。
- 保存草稿不调用真实 Provider，不改变线上活动路由。
- 只有管理员显式测试时才产生 Provider 请求；测试失败后可以继续手动测试。
- API Key 不进入浏览器响应、日志、审计详情、构建产物或 Git。
- 接管、测试或激活失败时，当前活动线路保持不变。

## 3. 非目标

- 不允许后台直接写入 `.env.production`、容器环境变量或 Docker Secret。
- 不因保存、打开编辑器、页面刷新或部署而自动调用 Provider。
- 不自动接管现有环境目标；每个目标都由管理员显式发起。
- 不改变 Embedding、RAG、搜索 Provider 或其他非 Chat 配置。
- 不在本功能中改变现有主线路加最多五条备用线路的路由上限。
- 不回显、下载或导出任何已有 API Key。

## 4. 方案选择

### 4.1 采用：数据库接管

首次编辑 Environment Provider 时，服务端读取该环境目标的非敏感参数和 API Key，在单个事务中创建数据库连接版本、模型版本、接管关系和审计事件。API Key 在服务端内存中直接加密后写入数据库，不经过浏览器。

接管结果先作为草稿存在。管理员显式测试并激活后，新请求使用数据库版本；接管前已经开始的请求继续使用其请求级配置快照。

### 4.2 不采用：数据库覆盖层

保留 Environment 身份，再用数据库字段逐项覆盖环境值，会形成两个同时有效的配置源。管理员难以判断空值表示“继承”还是“清空”，运行摘要、回退和故障排查也更复杂。

### 4.3 不采用：网页修改服务器环境

直接修改环境文件或 Secret 通常需要额外主机权限、重启或重新部署，无法与数据库路由原子切换，也容易造成多实例配置漂移，因此不作为管理后台能力。

## 5. 管理端体验

### 5.1 首次编辑

Environment Provider 卡片新增“编辑”操作。首次点击时打开“接管并编辑”表单，并预填：

- 环境目标显示名称；
- Base URL；
- User-Agent；
- 模型显示名称和模型 ID；
- `responses` 或 `chat_completions` 协议；
- reasoning effort；
- `max_output_tokens`；
- 已有价格元数据，若环境来源没有价格则保持空值。

API Key 输入框为空且显示“将安全沿用当前服务器 Key”。管理员输入新 Key 时，新 Key 取代环境 Key。任何情况下都不显示原 Key 或其尾号。

如果管理员修改 Base URL 且新旧 URL 的 origin 不同，同时 API Key 留空，必须明确勾选“将当前服务器 Key 用于新域名”；未勾选时拒绝保存。

### 5.2 接管后的展示

接管成功后，普通 Provider 列表展示新建的数据库 Provider，并提供与手动创建 Provider 相同的编辑能力。原 Environment 目标从普通 Provider 候选中隐藏，移入折叠的“系统应急配置”区域，只用于显示服务器启动来源和可用性诊断。

接管本身不改变活动路由。若原 Environment 目标仍在线上路由中，页面显示“已接管草稿，线上仍使用环境版本”。

### 5.3 测试与激活

页面分别显示三组互不覆盖的状态：

- 生命周期：`草稿` 或 `线上使用中`；
- 激活资格：`未测试`、`30 分钟内测试通过` 或 `测试已过期`；
- 最近一次真实测试：`成功` 或具体的稳定失败类别。

这样可以准确表达“30 分钟内曾成功，但最近一次因波动失败”，不会用单个状态掩盖另一条事实。修改任何运行参数都会产生新配置摘要，新版本的激活资格回到 `未测试`；旧摘要的测试结果只保留在历史记录中。

测试失败不会锁定、归档或删除 Provider。“再次测试”始终可用，但继续受现有管理员全局操作频率限制。频率限制单独显示等待提示，不记作 Provider 测试失败。

系统不自动重试。每次真实测试都由管理员点击触发，并分别记录结果。对于同一配置摘要，30 分钟内存在成功结果即可满足激活测试门；之后出现一次波动失败不会抹掉该成功证据，但界面必须同时显示最近失败和仍有效的成功时限，由管理员决定是否激活。

### 5.4 替换原线路

接管后的数据库模型测试通过时：

- 原 Environment 目标仍在当前路由中：提供“替换并激活”，在相同位置替换为数据库模型，其他目标和顺序不变；
- 原 Environment 目标不在当前路由中：提供“加入路由”，由管理员选择位置；
- 当前路由已被其他页面修改：返回冲突并刷新，不覆盖新路由。

“替换并激活”仍创建新的不可变 route revision，不修改旧 revision。回退继续引用之前真实运行过的精确版本快照。

## 6. 数据模型

新增 `ai_environment_takeovers`，用于稳定关联环境目标与接管后的数据库系列。建议字段如下：

- `id uuid PRIMARY KEY`；
- `environment_target_key varchar(32) NOT NULL`，仅允许 `primary`、`fallback-1`、`fallback-2`；
- `source_config_digest char(64) NOT NULL`，记录接管时环境配置摘要；
- `initial_connection_version_id uuid NOT NULL REFERENCES ai_connections(id) ON DELETE RESTRICT`；
- `initial_model_version_id uuid NOT NULL REFERENCES ai_model_presets(id) ON DELETE RESTRICT`；
- `created_at timestamptz NOT NULL DEFAULT now()`；
- `released_at timestamptz`，仅在接管后的数据库 Provider 已完成不可逆删除时设置。

使用部分唯一索引保证同一 `environment_target_key` 同时最多只有一条 `released_at IS NULL` 的接管关系。系列 ID 通过初始版本行解析，避免把没有唯一约束的 `series_id` 当作外键。

正常编辑只创建新的 `ai_connections` 和 `ai_model_presets` 版本，不修改接管关系。若接管后的 Provider 被不可逆删除，接管关系进入 released 状态；管理员之后可以重新接管仍存在的环境目标，并生成新的接管记录和数据库系列。

该迁移是纯新增，不改写现有 Provider、活动路由或历史 attempt。实现时使用下一个可用且无冲突的迁移编号，不吸收工作区中既有的无关迁移文件。

## 7. 管理 API

### 7.1 读取运行状态

扩展 `GET /api/admin/providers/runtime`：

- Environment 目标增加 `takeoverStatus`；
- 已接管时返回脱敏的数据库 connection/model series ID；
- 返回接管时摘要与当前环境摘要是否一致；
- 不返回环境 API Key、密文、认证标签或 Key 尾号。

### 7.2 创建接管草稿

新增：

`POST /api/admin/providers/runtime/environment/[targetKey]/takeover`

请求包含：

- 管理员密码复验；
- `expectedConfigDigest`；
- 连接表单字段；
- 模型表单字段；
- 可选新 API Key；
- 跨 origin 沿用环境 Key 的显式确认。

服务端必须重新读取目标并比对 `expectedConfigDigest`。环境配置已变化时返回稳定冲突，不使用页面中的旧快照创建 Provider。

成功响应只返回接管 ID、connection/model series ID、版本号和脱敏摘要，并设置 `Cache-Control: no-store`。

### 7.3 后续编辑与测试

接管完成后继续使用现有接口：

- `PATCH /api/admin/providers/[connectionId]`；
- `PATCH /api/admin/providers/models/[modelId]`；
- `POST /api/admin/providers/models/[modelId]/test`；
- `POST /api/admin/providers/routes/activate`。

原环境测试接口保留给“系统应急配置”诊断，但不会自动触发，也不再承担日常 Provider 编辑能力。

## 8. 接管事务

接管请求依次完成：

1. 验证管理员 Session、Origin、密码复验和请求格式；
2. 读取 Environment 目标并比对 `expectedConfigDigest`；
3. 验证 Base URL 出站策略和跨 origin Key 规则；
4. 为目标获取事务级互斥，防止重复提交；
5. 若存在有效接管关系，返回冲突并附带现有脱敏目标 ID；
6. 选择管理员提交的新 Key，或读取当前环境 Key；
7. 使用现有 AES-256-GCM 配置密钥加密 API Key；
8. 创建连接首版本和模型首版本；
9. 创建接管关系；
10. 写入 `environment_takeover_created` 脱敏审计事件；
11. 提交事务并清理内存中的明文引用。

第 7 至第 10 步任一步失败，整个数据库事务回滚。现有活动路由不在接管事务中修改。

## 9. 密钥和安全边界

- 所有新接口沿用管理员 Session、允许 Origin、密码复验、请求大小限制和 `no-store` 合同。
- 环境 Key 只在服务端配置对象、加密函数和显式测试运行时短暂存在。
- API Key 不写入应用日志、错误详情、审计 metadata 或 Provider 错误正文。
- 新 Key 为空表示在首次接管时沿用环境 Key，在后续数据库编辑时沿用当前加密 Key。
- Base URL origin 变化时，沿用旧 Key 必须显式确认；输入新 Key 不需要该确认。
- 接管后的数据库密文继续受 `MORSE_PROVIDER_CONFIG_KEY` 或 key file 保护。
- 配置密钥不可用、摘要不一致或解密失败时，禁止测试和激活，不静默降级到环境线路。

## 10. 并发、失败和恢复

- 重复点击接管：事务级互斥和唯一约束保证最多创建一条有效接管关系。
- Environment 配置在表单打开后变化：摘要冲突，要求刷新后重新编辑。
- 接管失败：不留下连接、模型或接管关系，当前路由不变。
- 测试失败：保留草稿并允许继续手动测试。
- 激活失败：重新读取 `ai_runtime_state`，只按服务端确认结果更新页面。
- 多管理页冲突：使用现有 `expectedActiveRevision`，后提交方不得覆盖先提交方。
- 编辑活动 Provider：旧精确版本继续服务，直到新版本测试并激活。
- 删除活动 Provider：继续返回 `AI_CONFIG_IN_USE`，必须先从路由移除。
- 服务器环境目标后来丢失：已接管的数据库 Provider 继续工作，应急区域显示环境来源不可用。
- 服务器环境目标后来变化：不覆盖数据库版本，应急区域显示摘要已变化。

建议新增稳定错误码：

- `AI_CONFIG_ENVIRONMENT_CHANGED`：页面摘要与服务器环境摘要不一致；
- `AI_CONFIG_ENVIRONMENT_UNAVAILABLE`：目标不存在或服务器环境配置不完整；
- `AI_CONFIG_TAKEOVER_EXISTS`：目标已有有效接管关系。

其余情况继续复用 `AI_CONFIG_INVALID`、`AI_CONFIG_CONFLICT`、`AI_CONFIG_RATE_LIMITED`、`AI_CONFIG_SECRET_UNAVAILABLE` 和 `AI_CONFIG_IN_USE`。

## 11. 审计与成本

新增或扩展以下脱敏事件：

- `environment_takeover_created`；
- `environment_takeover_conflict`；
- `environment_takeover_released`；
- 现有 `provider_test`、`environment_test`、版本编辑、激活和回退事件。

审计可以记录 target key、配置摘要、数据库系列 ID、结果码和时间，但不得记录完整 Base URL、API Key、请求头或 Provider 响应正文。

接管、编辑、激活和回退不产生 Provider 调用。只有显式发现模型或显式测试会调用 Provider；测试继续使用受控的短输出上限。自动化测试全部使用模拟 transport。

## 12. 兼容与上线顺序

1. 先应用新增接管表的数据库迁移；
2. 部署兼容旧环境路由和新接管关系的服务端代码；
3. 部署管理页编辑入口；
4. 不自动接管、不自动测试、不自动激活任何 Provider；
5. 管理员逐个接管目标，显式测试后替换活动路由；
6. 数据库路由稳定后，原环境来源继续作为隐藏应急信息保留；
7. 需要真实 Provider 验收、生产迁移或部署时，另行获得明确授权。

本功能不要求重建 Embedding，不要求重新 ingest RAG 知识库，也不改变 Edge 配置。

## 13. 验证计划

### 13.1 单元测试

- Environment 预填字段和 target key 校验；
- 空 Key 沿用环境 Key、新 Key 替换和跨 origin 显式确认；
- 环境摘要变化检测；
- 测试状态、30 分钟成功门和配置修改后的过期状态；
- 手动重复测试与频率限制的状态区分；
- “替换并激活”保持原位置和其他路由目标不变。

### 13.2 数据库集成测试

- 连接、模型、接管关系和审计事件原子写入；
- 任一步失败时完整回滚；
- 并发接管只产生一条有效关系；
- 接管后的版本编辑沿用现有不可变版本链；
- 不可逆删除后释放关系并允许重新接管；
- 历史 route revision 和 provider attempt 仍可解释。

### 13.3 API 合同测试

- Session、Origin、密码复验和 `no-store`；
- 不返回 API Key、密文、认证标签或 Key 尾号；
- 稳定错误码和 HTTP 状态；
- 重复提交、摘要冲突和活动路由并发冲突；
- 测试失败后可以再次请求测试。

### 13.4 UI 与回归测试

- 1440px 和 390px 均可从 Environment 卡片完成接管编辑；
- 草稿、测试通过、测试失败、测试过期和线上使用状态清晰；
- 测试失败后按钮仍可操作；
- 接管后普通列表不再出现不可编辑的重复 Environment 卡片；
- 手动 Provider 的创建、编辑、删除、路由排序和回退不回归；
- `npx tsc --noEmit`、相关测试、`npm test` 和 `npm run build` 通过；
- 本地数据库迁移从当前已提交基线和全新数据库两条路径通过。

真实 Provider 测试不属于自动化验证。实施完成后如需线上观察，必须由用户再次明确授权，并限制调用次数和输出长度。

## 14. 验收标准

- 截图中的两个 Environment Provider 都有可用的编辑入口。
- 管理员能够修改并实际激活 Base URL、API Key、模型、协议、reasoning effort 和 `max_output_tokens`。
- 保存草稿不会产生 Provider 请求，也不会改变当前活动线路。
- 测试失败后可以持续手动重测；后续成功可以满足激活门。
- 未测试、测试过期或配置摘要不匹配的版本不能激活。
- 接管和激活失败时，原线路继续可用。
- API Key 不出现在浏览器响应、日志或审计中。
- 接管后的 Provider 与手动创建 Provider 具有一致的编辑、测试、激活、回退和删除能力。
- 桌面端和移动端均不存在被遮挡、不可点击或文本溢出问题。
- 不影响 Chat 请求级路由快照、历史归因、Embedding 和 RAG。
