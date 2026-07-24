# 智能客服、RAG 与数字人开源项目选型报告

> Status note (2026-07-25): Historical research material only. It does not override `docs/portfolio-blueprint.md`, current code, or release evidence; revalidate external facts before reuse.

> 研究时间：2026-07-12 | 所属领域：Agent、RAG、实时语音、数字人 | 项目对象：Revolution 数字生命摩斯

## 执行摘要

这轮调研的结论不是“选一个开源平台装起来”，而是确定哪些项目值得进入 Revolution 的生产依赖，哪些只应该成为学习和评测基线。

**推荐的生产主链是：Next.js + Vercel AI SDK + 直接模型 Provider + PostgreSQL 全文检索 + pgvector + 自有评测集。** 这条路线保留了网站的产品控制权，也能真正积累知识发布、分块、向量化、混合召回、重排、引用、拒答、工具安全和 Agent 状态管理经验。

Dify、FastGPT、RAGFlow、AnythingLLM、Flowise 和 Open WebUI 都值得研究，但不应直接成为 Revolution 的产品内核。它们分别适合作为工作流运营、中文端到端 RAG、复杂文档解析、本地助手、Agent 编排和联网语音能力的对照组。把平台 iframe 嵌入作品集，最快能得到一个聊天框，却会跳过本项目最有价值的工程部分。

向量库现在可以上，但选择 **PostgreSQL + pgvector**，而不是立刻部署 Qdrant。原因不是当前公开知识已经大到非向量检索不可，而是你的明确目标包含积累 RAG 项目经验。正确做法是同时保留 `full-context` 和 `hybrid-rag` 两条路径，用同一套 gold set 测出检索收益、成本和错误类型。这样向量库是一个可验证的工程选择，而不是为了简历堆名词。

实时语音首选 LiveKit Agents 作为生产候选，Pipecat 作为帧流水线与取消语义的独立学习 PoC。数字人实验优先 OpenAvatarChat，MuseTalk 只作为可替换的口型渲染后端。数字人必须是独立 Python/GPU sidecar，不能进入 Next.js 进程，也不能成为第二套知识和会话权威。

最终实施顺序应是：可信文本客服 -> 混合 RAG -> 受控联网 -> 实时语音 -> 数字人实验。任何后续层失败时，前一层仍应可独立工作。

## 一、研究问题与判定标准

本报告回答五个问题：

1. 哪些开源项目适合直接用于 Revolution，哪些只适合参考？
2. 为了积累 Agent 和 RAG 经验，现在是否值得引入向量库？
3. 智能客服、知识库、联网搜索、实时语音和数字人应如何分层？
4. 哪些许可证、部署负担和安全问题会阻止项目上线？
5. S7 应如何拆成可以逐阶段验收的工程任务？

调研以 GitHub 仓库 README、LICENSE、Release、提交时间和官方文档为主要证据。星标与 fork 只表示社区规模，不直接代表架构质量。许可证判断也不能只看仓库页上的 SPDX 标签：代码、模型权重、训练数据和输入肖像必须分开审计。

选型采用六个维度：

- **学习价值**：能否让你亲手实现并解释核心机制。
- **产品控制**：前端、数据、会话、引用和权限是否由 Revolution 掌握。
- **运行复杂度**：需要多少服务、数据库、队列、GPU 和升级工作。
- **可替换性**：模型、向量层、语音和头像是否能独立更换。
- **许可证**：能否商用、能否去品牌、是否限制多租户 SaaS。
- **安全边界**：是否便于实现拒答、引用、最小权限、审计和失败降级。

## 二、纵向观察：开源 AI 应用正在从“大平台”回到“可组合薄栈”

### 2.1 第一阶段：聊天 UI 与文档问答

最早一批生成式 AI 应用解决的是“让模型能读我的文件”。典型产品将上传、文本切分、embedding、向量检索和聊天界面封装在一起。AnythingLLM 和 Open WebUI 延续了这条路线：它们的核心定位是可私有部署的 AI 工作台，RAG、模型切换和联网能力围绕工作区体验展开。

这类项目的价值在于快速验证。启动一个容器、导入几份文档，就能观察引用、模型切换、会话存储和权限的基本形态。但它们的默认用户是内部使用者，而不是访问作品集的匿名访客。客服真正需要的限流、来源合同、公开与私有知识隔离、品牌化交互、人工接管和 SLA，并不会因为“已经有聊天界面”自动出现。

### 2.2 第二阶段：RAG 变成内容管线

RAGFlow、FastGPT 和 Dify 的演进说明，可靠知识问答的重心已经从“有没有向量库”移动到“数据如何进入、如何被版本化、如何被召回和验证”。

RAGFlow 把复杂 PDF、DOCX、图片和扫描件解析放在核心位置，并允许用户查看、修改解析结果。FastGPT 强调中文知识导入、混合检索、重排、引用反馈和应用评测。Dify 则把父子分块、索引方式、检索配置和工作流运营统一到可视化后台。

共同趋势很清楚：向量相似度只是检索链中的一个环节。生产 RAG 还需要标准化、去重、文档版本、chunk 身份、全文检索、reranker、context packing、引用归一化和离线评测。只部署一个向量数据库，反而最容易制造“技术已经完成”的错觉。

### 2.3 第三阶段：工具调用与 Agent 工作流

Flowise、Dify Workflow、FastGPT 工作流和 LangGraph 把模型从问答器变成状态机。模型不再只检索一次，而是可能判断问题类型、调用知识库、联网搜索、验证结果、请求审批，再组织答案。

这让“AI 客服”看起来接近 Agent，但也带来新风险。工具调用不是一段 prompt，而是一套有副作用的分布式执行：请求可能被取消、重复、超时或在用户打断后继续运行。Pipecat 的公开 issue 中就有被打断生成的函数调用仍可能执行的报告。这不是某一个框架的偶发细节，而是所有语音 Agent 都必须处理的取消与幂等问题。

因此 Revolution 不应从多 Agent 图开始。第一版只需要清晰的路由和有限工具循环，等出现可恢复的长流程、人工审批或多角色协作，再引入 LangGraphJS。框架应由需求触发，而不是由“Agent 项目”这个标签触发。

### 2.4 第四阶段：语音与数字人被拆成媒体层

LiveKit Agents 与 Pipecat 代表了实时语音 Agent 的两种方向。LiveKit 以 WebRTC 房间、participant、track 和浏览器 SDK 为中心，适合上线实时产品；Pipecat 以 frame pipeline 为中心，适合研究 VAD、turn detection、打断、取消传播和多种 transport。

OpenAvatarChat 又往前走了一步，把 ASR、LLM、TTS、Avatar 和 WebRTC 组合成中文数字人参考系统。MuseTalk、Wav2Lip 和 SadTalker 则只解决图像或嘴型生成，它们不是客服系统。

这里最重要的架构变化是：头像不应该拥有知识。它只消费已经通过知识、工具和安全层生成的文本或音频，并发布视频轨。只要媒体层和事实层解耦，未来可以在预渲染视频、2D 嘴型、3D Avatar 和托管数字人之间切换，而不用重写客服大脑。

## 三、完整平台横向比较

以下数据为 2026-07-12 的 GitHub 快照，星标会持续变化。

### 3.1 基础矩阵

| 项目 | 快照与许可证 | 核心强项 | 主要代价 | Revolution 定位 |
|---|---|---|---|---|
| Dify | 148,522 stars；Dify Open Source License | Chatflow、Workflow、知识管线、日志、标注、LLMOps、嵌入发布 | 多服务栈重；多租户和去品牌受许可限制 | 工作流与运营基线 |
| FastGPT | 28,906 stars；FastGPT Open Source License | 中文知识导入、混合检索、重排、引用、评测、工作流 | 依赖 MongoDB、PG、Redis、MinIO 等；SaaS/品牌限制 | 中文端到端主基线 |
| RAGFlow | 84,831 stars；Apache-2.0 | 复杂文档解析、人工修订、多路召回、可追溯引用 | 官方最低 4C/16GB/50GB；运维和解析链重 | 复杂检索质量基线 |
| AnythingLLM | 63,129 stars；MIT | 单容器体验、本地模型、多向量库、网站 embed | 更像私人 ChatGPT；评测和检索控制较浅 | 本地快速体验基线 |
| Flowise | 54,536 stars；Apache-2.0 + 商业目录 | Chatflow/Agentflow、工具节点、可定制 widget | 内容治理弱；官方 CDN embed 不符合本项目自托管约束 | Agent 编排参考 |
| Open WebUI | 145,093 stars；自定义许可 | 私人助手、混合 RAG、联网、RBAC、语音/视频 | 不是网站 widget；超过许可阈值去品牌受限 | 私人助手能力对照 |

### 3.2 Dify：最完整的运营参考，不是本项目内核

Dify 的优势不是某一个检索算法，而是把应用生命周期放进同一套控制台。知识摄取、父子 chunk、向量/全文/混合检索、rerank、工作流、日志、标注和发布 API 都有成熟产品形态。对于研究“一个 AI 应用后台应该让运营者看到什么”，它是最好的参照之一。

代价也来自这种完整性。默认 Docker Compose 包含 API、web、worker、beat、Postgres、Redis、Weaviate、sandbox、plugin daemon、SSRF proxy 和 Nginx。即使文档给出 2 核 4GiB 的最低口径，真实生产还要考虑队列积压、插件升级、数据库备份、向量库迁移和跨版本兼容。

更关键的是许可证。Dify 的开源许可证基于 Apache-2.0 修改，对多租户服务和前端品牌移除有额外限制。Revolution 没有必要为了一个作品集客服，把产品身份、升级节奏和运行拓扑绑定到 Dify。

正确用法：在本地构建一套相同知识样本，观察 Dify 的知识配置、日志、标注和 Chatflow 体验，把有价值的字段和运营动作吸收进自己的设计；不把它的 UI 或 API 合同设为正式站的长期边界。

### 3.3 FastGPT：中文 RAG 的主对照组

FastGPT 更贴近本项目的中文资料场景。它支持多种文档与表格格式、直接分段和 QA 导入、多知识库混用、混合检索、重排、检索测试、引用反馈和应用评测。工作流、MCP、分享和 iframe 也比较完整。

它特别适合做基线：将同一份 approved KB 与同一组问题同时跑在 FastGPT 和 Revolution 自研管线上，比较召回、引用、延迟与拒答。这样学习不是“看过源码”，而是拥有可复现的差异报告。

但 FastGPT 的当前 compose 已包含 pgvector、MongoDB、Redis、MinIO、应用、code sandbox、MCP server、plugin、AIProxy 及额外数据库。它的许可同样对类似 FastGPT 的多租户 SaaS 和控制台品牌有条件。作为生产依赖，它会让你花大量时间维护平台边界；作为中文端到端 RAG 评测基线，它很有价值。

### 3.4 RAGFlow：复杂文档实验室

RAGFlow 的核心是把文档真正解析成可检查的知识，而不是把 PDF 抽成一段未知质量的文本。对于表格、图片、扫描件和长 PDF，它的深度解析、模板 chunk、人工修订、可追溯引用和 ingestion pipeline 值得重点研究。

它的硬件和服务成本不适合当前 Revolution。官方最低口径达到 4 核、16GB 内存和 50GB 磁盘，默认还涉及 MySQL、Redis、MinIO 与 Elasticsearch 或 Infinity。当前 approved 公共知识预计以 Markdown 和结构化项目事实为主，没有必要为尚不存在的复杂文档需求支付这套运维成本。

正确用法：当未来要处理大量简历附件、报告或扫描资料时，用 RAGFlow 对同一批复杂文档做解析质量基线；只有自研解析链明确达不到目标，才考虑把它作为可替换 sidecar。

### 3.5 AnythingLLM、Flowise 与 Open WebUI

AnythingLLM 的 MIT 许可和单容器路径适合快速体验。它可以帮助确认本地 embedding、不同向量库、来源引用、网站 embed 和隐私开关的最低可用形态。但它更像面向个人或小团队的 AI 工作区，无法替代本项目的证据合同和评测系统。

Flowise 擅长可视化 Agentflow 和工具节点。它的 chat widget 支持消息观察、source docs、feedback 和自定义样式，适合研究嵌入 SDK 如何暴露事件。不过官方示例从 jsDelivr 加载脚本，与 Revolution “无外部运行时资源”的约束冲突；若借鉴只能自托管或继续使用自有 UI。

Open WebUI 已经覆盖多种向量库、BM25 + vector hybrid、rerank、联网搜索、RBAC、语音、视频和可观测性。它适合作为“私人 AI 工作台能做到什么”的对照，但不适合匿名作品集前台。其自定义许可证对超过一定最终用户规模后的去品牌有约束，也增加了不必要的不确定性。

### 3.6 完整平台的共同缺口

这六个项目都不能自动变成完整客服系统。它们通常不以坐席排班、人工接管、工单 SLA、CRM、渠道统一、质检和投诉升级为核心。Revolution 当前做的是“个人数字分身式咨询”，可以先不实现传统呼叫中心，但报告和 UI 不能把一个 RAG chatbot 宣称成完整客服平台。

## 四、组件与 Agent 框架比较

### 4.1 组件矩阵

| 项目 | 快照与许可证 | 适合解决的问题 | 当前判断 |
|---|---|---|---|
| Vercel AI SDK | 25,493 stars；Apache-2.0 | Next.js 流式 UI、消息 parts、工具状态、provider 抽象 | 生产依赖 |
| LangGraph / LangGraphJS | 37,064 / 3,112 stars；MIT | 可恢复状态图、长流程、人工审批、多 Agent | 后期按需引入 |
| LlamaIndex Python | 50,787 stars；MIT | ingestion、index、retrieval 的架构参考 | 学习参考 |
| LlamaIndexTS | 已归档、停止维护 | 曾提供 TS 数据框架 | 明确不用 |
| Haystack | 25,871 stars；Apache-2.0 | Python RAG pipeline 与评测架构 | 参考或独立服务 |
| LiteLLM | 53,290 stars；核心开源，企业目录另计 | 多模型网关、配额、路由、统一日志 | 两个以上 provider 后再引入 |
| pgvector | 22,155 stars；PostgreSQL License | 在 Postgres 内完成向量检索 | 当前推荐 |
| Qdrant | 33,161 stars；Apache-2.0 | 独立向量服务、复杂过滤、多向量与扩展 | 延后 |
| Ragas | 14,793 stars；Apache-2.0 | 离线 RAG 指标与实验辅助 | 离线辅助，不作唯一门禁 |
| Phoenix | 10,510 stars；Elastic License 2.0 | 本地/测试 trace 与实验观察 | 可选，托管前审许可 |

### 4.2 为什么 Vercel AI SDK 适合当前站点

Revolution 已经是 Next.js App Router。Vercel AI SDK 能提供流式文本、结构化消息 parts、停止/重试、工具状态和 provider 抽象，直接适配现有前端。它不会替你决定知识边界、检索策略或联网权限，这恰好是本项目应该自己实现的部分。

生产层应再包一层本地接口，避免业务代码直接依赖某个 SDK 类型：

```ts
interface ModelProvider {
  stream(request: ModelRequest): Promise<ModelStream>;
}

interface Retriever {
  retrieve(query: RetrievalQuery): Promise<RetrievalResult>;
}

interface AgentTool {
  name: string;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}
```

AI SDK 负责传输和事件，Revolution 的接口负责事实、权限和测试。未来替换模型 provider 时，引用 UI 和评测集不应变化。

### 4.3 LangGraphJS 的引入阈值

第一版客服流程只是“分类 -> 检索 -> 可能搜索 -> 回答”，普通服务端状态机足够。只有出现以下需求时，LangGraphJS 才有明显收益：

- 一个任务跨多个请求持续数分钟，需要恢复执行。
- 流程需要暂停并等待人工批准。
- 多个角色拥有不同工具与上下文。
- 工具失败后需要从 checkpoint 重跑部分节点。
- JD 匹配、项目诊断或研究报告成为正式产品能力。

在这些条件出现前，引入图框架会让日志、类型和部署更复杂，却不会提升答案正确率。

### 4.4 LiteLLM、Qdrant 与 Phoenix 的边界

LiteLLM 适合团队统一管理两个以上模型供应商、共享 key、配额、重试和路由。当前单站点可以直接使用 provider package，减少一个网关故障点。

Qdrant 的独立服务在百万级 chunk、高 QPS、复杂 metadata filter、多向量或专用扩缩容时更有价值。当前公开知识远小于这个量级，Postgres 已经承担会话、知识元数据和评测记录，pgvector 可以减少一次网络跳转和一套备份系统。

Phoenix 可以在开发环境展示 trace、检索结果和评测实验，但 Elastic License 2.0 不应被忽略。Revolution 的核心验收仍应是可在 CI 运行的确定性测试与固定 gold set，不能依赖一个观测 UI 才知道系统是否正确。

## 五、现在是否需要向量库

答案是：**需要实现向量检索，但不需要独立向量数据库服务。**

如果目标只有把当前几份公开内容答出来，full-context 足以更快上线，甚至可能在小语料上更稳定。现在引入 pgvector 的理由来自学习目标和未来接口，而不是假装当前数据规模已经很大。

### 5.1 双基线设计

同一套 API 保留两种模式：

```text
full-context
  -> 载入全部 approved KB
  -> 生成带 source_id 的答案

hybrid-rag
  -> PostgreSQL FTS 召回
  -> pgvector 语义召回
  -> RRF 融合与去重
  -> 可选 rerank
  -> context packing
  -> 生成带 chunk_id 的答案
```

每次知识、prompt、embedding 或模型更新，都用相同 gold set 比较：

- 检索 Recall@k、MRR 或 nDCG。
- 事实正确率和 faithfulness。
- citation precision、coverage 与 source 可打开率。
- 应拒答问题的正确拒答率。
- p50/p95 首 token、总延迟和单次成本。

如果 hybrid-rag 在小语料上没有胜过 full-context，应保留这个事实。一个成熟的项目经验不是证明 RAG 永远更好，而是能解释它何时更好、何时更差。

### 5.2 建议数据模型

```sql
knowledge_documents(
  id, slug, title, version, visibility,
  source_path, content_hash, approved_at, superseded_at
)

knowledge_chunks(
  id, document_id, ordinal, heading_path,
  content, token_count, content_hash,
  embedding, metadata_json, created_at
)

retrieval_runs(
  id, session_id, query, mode, kb_version,
  lexical_hits, vector_hits, fused_hits,
  latency_ms, created_at
)
```

`visibility` 只允许线上查询 `public_approved`。`document_id + version + ordinal + content_hash` 共同保证引用可追溯。文档更新时创建新版本，不在原 chunk 上静默覆盖。

### 5.3 分块与召回起点

第一轮可按 Markdown 标题和语义段落切分，目标 400-800 tokens，重叠 10%-15%。这是实验起点，不是固定最佳实践。项目名、技术名、日期和专有名词通常更依赖全文检索；自然语言改写更依赖向量检索。两路各取候选后用 RRF 融合，再根据评测决定是否添加 reranker。

不要直接把 `E:\Wiki` 接入线上 ingestion。它仍是私有原始源，只能通过“本地提炼 -> 脱敏 -> review -> 人工批准 -> approved manifest”发布。线上数据库只接收经过批准的版本化内容。

## 六、实时语音与数字人开源项目比较

### 6.1 实时语音与头像矩阵

| 项目 | 快照与许可证 | 能解决什么 | 不能解决什么 | 判断 |
|---|---|---|---|---|
| LiveKit Agents | 11,326 stars；Apache-2.0 | WebRTC、实时语音、打断、浏览器 SDK、STT/LLM/TTS 插件 | 不负责 RAG 与向量库 | 生产语音首选 |
| Pipecat | 13,360 stars；BSD-2-Clause | 音视频 frame pipeline、transport、中文 provider 集成 | 取消和工具副作用需应用兜底 | 独立学习 PoC |
| OpenAvatarChat | 3,616 stars；Apache-2.0 | 中文 ASR/LLM/TTS/Avatar/WebRTC 完整参考 | 依赖重、GPU 口径不统一 | 数字人实验首选 |
| MuseTalk | 6,155 stars；代码 MIT | 音频驱动嘴型与实时推理实验 | 无会话、RAG、STT/TTS、WebRTC 产品链 | 可替换渲染后端 |
| Wav2Lip | 13,087 stars；权重非商业 | 批处理口型同步研究 | 商业使用被禁止；栈老 | 不使用 |
| SadTalker | 13,946 stars；主体自定义 Apache-2.0 | 单图加音频生成视频 | 非实时、维护停滞、公开命令注入 issue | 不使用 |

### 6.2 LiveKit Agents：网站可上线的语音主链

LiveKit Agents 把 Agent 视为 WebRTC 房间中的可编程 participant，可混用 STT、LLM、TTS 和 Realtime API，并通过浏览器、React、移动端和 SIP SDK 接入。框架本身不需要 GPU；只有自托管语音或模型时才需要按模型配置算力。

它适合 Revolution 的原因是会话媒体路径清晰：浏览器只和 LiveKit 房间交互，Python Agent 调用现有知识与工具服务。文本、音频和未来视频都作为可观察的 track 或 data event 传递。生产仍要部署 TURN、会话调度、重连和可观测性，不能把“用了 WebRTC”当成实时性已经解决。

LiveKit 代码采用 Apache-2.0，但其 turn detector 模型使用单独的 LiveKit Model License；所选 STT、TTS 和模型 provider 也有各自条款。上线前必须做依赖级许可证表。

### 6.3 Pipecat：用于理解实时 Agent 的内部机制

Pipecat 的价值在 frame pipeline。音频、转写、LLM token、TTS、打断和 transport 都被表达为可组合帧，适合深入研究 VAD、turn strategy、取消传播、背压和多 provider。它列出了 FunASR、Qwen、DeepSeek、MiniMax TTS、Fish 等中文生态集成，对国内链路实验也更直接。

但生产第一版不能同时让 LiveKit Agents 和 Pipecat拥有会话状态。可以建立一个独立实验：Pipecat 使用 LiveKit transport，对同一套中文测试集测首音、打断和工具取消；正式站只保留一个状态权威。

### 6.4 OpenAvatarChat 与 MuseTalk

OpenAvatarChat 已提供 VAD、ASR、LLM、TTS、Avatar 和 WebRTC 的完整中文参考，0.6 版本完成前后端分离，并支持手动或双工打断。它适合建立“数字人实验室”，观察音频分块、头像推理、视频发布和长对话同步。

它不适合直接塞进当前 Next.js 服务。当前依赖固定 Python 3.11、Torch 2.8、CUDA 12.8 和 `onnxruntime-gpu`，实际显存由 LiteAvatar、LAM、MuseTalk、FlashHead 及本地语音模型共同决定。项目自报的平均响应时间不能替代 Revolution 在目标硬件上的 p50/p95 测试。公开 issue 还报告了长对话音频缓冲增长和音视频不同步，这正是独立 PoC 必须覆盖的场景。

MuseTalk 只是嘴型模型。官方称在 Tesla V100 上可以超过 30fps，但低端 4GB 显卡的公开测试远达不到实时。其代码 LICENSE 为 MIT，README 称权重可商用，但 Hugging Face 模型卡仍出现 `creativeml-openrail-m` 标识，许可口径需要在上线前解决。它可以是 OpenAvatarChat 后面的 renderer adapter，不应被当成客服框架。

Wav2Lip 的开源代码与 LRS2 权重明确限个人、研究和非商业使用，不满足网站上线。SadTalker 不是实时系统，维护明显停滞，且公开 issue 给出了上传文件名经 `os.system` 进入 FFmpeg 的命令注入 PoC。这两者不进入 Revolution 依赖清单。

## 七、推荐目标架构

```text
Next.js UI
  |-- 文本流、来源、停止、重试、联网开关
  |-- 麦克风与音频播放（后续）
  |-- 数字人视频轨（实验）
  |
  v
同源 Chat API / Session Gateway
  |-- 限流、审核、预算、会话、事件流
  |
  v
Agent Runtime
  |-- route: kb_verified / web_current / mixed / unknown / blocked
  |-- ModelProvider adapter
  |-- Retriever adapter
  |-- Tool registry + policy
  |
  +--> PostgreSQL FTS + pgvector
  |      approved documents / chunks / versions / traces
  |
  +--> controlled web_search
  |      最小化 query / 域名与网络边界 / 只读 / 引用
  |
  +--> LiveKit Agents Python（S7 后期）
           STT / TTS / WebRTC / interruption
             |
             +--> avatar-renderer adapter
                    OpenAvatarChat / MuseTalk GPU sidecar
```

系统只有一个事实权威和一个工具权限权威。语音层不能私自改 prompt，数字人层不能访问知识库，前端不能持有 provider key。

### 7.1 回答合同

```ts
type AnswerEnvelope = {
  answer: string;
  route: 'kb_verified' | 'web_current' | 'mixed' | 'unknown' | 'blocked';
  evidence: Array<{
    id: string;
    kind: 'knowledge' | 'web';
    title: string;
    documentVersion?: string;
    chunkId?: string;
    url?: string;
    quote?: string;
    accessedAt?: string;
  }>;
  retrievalMode: 'full-context' | 'hybrid-rag' | 'none';
  confidence: 'high' | 'medium' | 'low';
  abstainReason?: string;
};
```

UI 只消费这个归一化合同，不直接渲染某个 provider 的原始 citation。这样模型、检索器和联网实现都可以替换。

### 7.2 受控联网

联网搜索应是一个受限工具，而不是任意浏览器。服务端决定本轮是否暴露该工具，默认只处理最新技术、行业变化和用户明确要求的外部信息。摩斯个人履历、项目事实和联系方式只允许查询 approved KB。

搜索 query 只能包含完成问题所需的最少公开信息。工具返回结构化标题、URL、摘要、原文引句、发布日期和访问时间。网页内容是 untrusted data，不能改变系统指令，也不能直接触发第二个工具。

如果未来实现任意 URL 抓取，必须防 SSRF：仅允许 `http/https`，规范化 URL，阻断 localhost、RFC1918、link-local、云 metadata 与 IPv6 私网；每次重定向重新验证；限制 DNS、响应体、MIME、超时和重定向次数；通过独立 egress policy 出网。

首版工具全部只读，不提供发邮件、运行 shell、写数据库、支付、表单提交或浏览器控制。未来出现有副作用的动作时，需要幂等键、取消语义、审批和执行后核对。

## 八、S7 实施路线

### S7.0：契约与公开知识发布

目标是先把“允许说什么”写成代码和数据。

- 建立 `content/knowledge/review/` 与 `approved/`。
- 定义 manifest、document、chunk、citation 和 answer schema。
- 为每份 approved 文档生成版本和内容 hash。
- 建立 60-100 条中文 gold set，覆盖事实、同义问法、跨文档、无答案、越权、提示注入和是否联网。
- 添加构建测试，禁止草稿、私有路径、未终审内容和敏感字段进入线上 bundle。

完成标准：线上运行时无法读取 `E:\Wiki`，只有 approved manifest 内的内容可被加载；所有知识答案可以回到具体 document version。

### S7.1：可信文本客服与 full-context 基线

- 新增同源 `/api/chat` 和自有消息合同。
- 接入 Vercel AI SDK 的流式 UI、停止、重试和错误状态。
- 先用 full-context 跑通公开知识问答。
- 实现引用、拒答、匿名限流、输入长度、预算和超时。
- 默认不保存长期记忆，provider key 只在服务端。

完成标准：gold set 的事实、拒答、引用和跨访客隔离达到预设门槛；provider 故障时界面明确降级，不伪造回答。

### S7.2：PostgreSQL + pgvector 混合 RAG

- 建 ingestion CLI：normalize、chunk、hash、embedding、upsert、supersede。
- 建 PostgreSQL FTS 与 pgvector 两路召回。
- 用 RRF 融合、去重和 context packing。
- 保存 retrieval trace，不保存不必要的访客明文。
- 在同一 gold set 上对比 full-context 与 hybrid-rag。
- 用 FastGPT 做中文端到端基线，用 RAGFlow 做复杂文档实验基线。

完成标准：能够展示一次回答命中的 lexical/vector/fused chunks、版本和耗时；任何模型、chunk 或 embedding 变更都有回归结果。

### S7.3：受控联网 Agent

- UI 提供“允许联网”显式开关和来源状态。
- 服务端路由决定是否提供 `web_search`。
- 网页来源与个人知识来源分开展示。
- 加入间接提示注入、恶意网页、错误来源和 SSRF 测试。
- 每轮限制工具步数、超时、结果长度和预算。

完成标准：应联网问题的召回率、非时效问题的误联网率、引用 precision 和提示注入防护均有量化结果；搜索失败时返回未知，不把模型常识伪装成最新事实。

### S7.4：实时语音

- 使用 LiveKit Agents 建 Python voice worker。
- 先实现按住说话，再评估 VAD 和自动 turn detection。
- STT 后仍调用同一 Agent Runtime，TTS 只消费已审核回答。
- 支持字幕、停止、静音、重连和文本降级。
- 单独用 Pipecat 做取消、打断和中文 provider 对照实验。

完成标准：测量 p50/p95 首转写、首 token、首音、完整轮次、打断恢复和弱网重连；用户打断后，未批准的工具副作用不得继续执行。

### S7.5：数字人实验室

- 独立部署 OpenAvatarChat，先用 LiteAvatar 跑通。
- 在相同音频上切换 MuseTalk renderer，记录显存、首帧、稳定帧率、音画同步和长会话漂移。
- 通过 adapter 接收音频或 viseme，不直接访问知识和工具。
- 视频失败时保留音频，音频失败时保留文本。

完成标准：数字人 PoC 不影响文本/RAG 主链发布；只有在目标硬件和目标网络下通过可量化验收，才进入正式站。

## 九、评测与作品集证据

要把这轮开发变成真正的项目经验，仓库里需要留下可以复跑的证据，而不是只有最终页面。

建议产出：

- `docs/architecture/ai-assistant.md`：边界、组件和 ADR。
- `content/knowledge/approved/manifest.json`：公开知识版本。
- `evals/gold-set.jsonl`：问题、期望路由、允许来源、关键事实、是否拒答。
- `scripts/ingest-knowledge.*`：可重入 ingestion。
- `scripts/eval-rag.*`：full-context 与 hybrid-rag 对照。
- `docs/verify/s7/`：检索、引用、注入、断网、语音与数字人证据。

最值得在作品集中展示的不是“使用了 15 个开源库”，而是这些具体判断：

- 为什么小语料仍保留 full-context 基线。
- 为什么采用 Postgres FTS + pgvector 而不是单纯向量召回。
- 一次错误回答究竟来自召回、重排、context packing 还是生成。
- 如何证明私有 Wiki 没有进入公开运行时。
- 搜索工具如何做到只读、最小上下文和可审计。
- 用户打断语音后，取消如何传播到工具和 TTS。
- 数字人服务崩溃时，为什么文本客服仍然可用。

这些内容比平台截图更能证明 Agent 系统开发能力。

## 十、最终选型

### 直接进入生产候选

- Vercel AI SDK：Next.js 流式交互与工具消息。
- PostgreSQL + pgvector：知识元数据、全文检索和向量检索。
- 直接模型 provider：首版减少网关复杂度。
- 自有 gold set 与确定性测试：真正的发布门禁。
- LiveKit Agents：文本/RAG 稳定后的实时语音候选。

### 作为对照与学习参考

- FastGPT：中文端到端 RAG 主基线。
- RAGFlow：复杂文档解析与检索质量基线。
- Dify：工作流、运营与可观测性基线。
- AnythingLLM：本地快速体验与 adapter 参考。
- Flowise：Agentflow 和 embed 事件参考。
- Open WebUI：私人助手、联网和语音对照。
- LangGraphJS：出现可恢复长流程后引入。
- Pipecat：实时帧、打断和取消语义实验。
- OpenAvatarChat / MuseTalk：独立数字人实验。
- Ragas / Phoenix：离线评测辅助和开发观测。

### 当前延后

- LiteLLM：至少两个 provider、共享配额和统一网关需求出现后。
- Qdrant：百万级 chunk、高 QPS、复杂过滤或多向量需求出现后。
- Haystack / LlamaIndex Python：只有独立 Python RAG 服务确有必要时。

### 明确避免

- LlamaIndexTS：已归档并停止维护。
- Wav2Lip：开源权重禁止商业使用。
- SadTalker：非实时、栈老化且存在未解决命令注入报告。
- 平台 iframe 作为最终产品：无法体现本项目的证据、安全和体验边界。
- 同时上线 LiveKit Agents、Pipecat 和 OpenAvatarChat 三套会话状态：会造成多个状态权威。

## 十一、最终判断

如果目标只是最快得到“能聊天的网页”，AnythingLLM、Dify 或 FastGPT 都能缩短时间。但你的目标不是完成一次组件集成，而是借 Revolution 形成 Agent、RAG、语音和数字人的可证明经验。这个目标决定了选型必须刻意保留那些最有学习价值、也最接近生产风险的部分。

所以 Revolution 应自建薄栈，并把开源平台变成镜子。

FastGPT 告诉你中文 RAG 的成熟体验是什么，RAGFlow 告诉你复杂解析能做到多深，Dify 告诉你运营后台需要哪些反馈，LiveKit 告诉你实时媒体如何进入浏览器，OpenAvatarChat 告诉你数字人链路有哪些真实硬件和同步问题。Revolution 自己要回答的是：如何把这些能力缩成一个有明确知识边界、能引用、会拒答、能联网但不越权、可以从文字逐步升级到声音和形象的数字摩斯。

下一步应进入 S7.0，而不是先部署一整套平台：定义公开知识 schema、回答合同、gold set 和 pgvector 双基线实验。等文本和检索有证据，再开启联网、语音和数字人。

## 十二、信息来源

以下资料均于 2026-07-12 访问。GitHub stars 为当日快照，后续会变化。

### 完整平台

1. Dify repository and license: https://github.com/langgenius/dify ; https://raw.githubusercontent.com/langgenius/dify/main/LICENSE
2. Dify embedding and retrieval docs: https://docs.dify.ai/en/self-host/use-dify/publish/webapp/embedding-in-websites.md ; https://docs.dify.ai/en/self-host/use-dify/knowledge/create-knowledge/setting-indexing-methods.md
3. FastGPT repository and license: https://github.com/labring/FastGPT ; https://raw.githubusercontent.com/labring/FastGPT/main/LICENSE
4. FastGPT Docker Compose: https://doc.fastgpt.io/deploy/docker/v4.15/global/docker-compose.pg.yml
5. RAGFlow repository and README: https://github.com/infiniflow/ragflow ; https://raw.githubusercontent.com/infiniflow/ragflow/main/README.md
6. AnythingLLM repository and Docker guide: https://github.com/Mintplex-Labs/anything-llm ; https://raw.githubusercontent.com/Mintplex-Labs/anything-llm/master/docker/HOW_TO_USE_DOCKER.md
7. Flowise repository, license and embed docs: https://github.com/FlowiseAI/Flowise ; https://raw.githubusercontent.com/FlowiseAI/Flowise/main/LICENSE.md ; https://docs.flowiseai.com/using-flowise/embed.md
8. Open WebUI repository and license: https://github.com/open-webui/open-webui ; https://raw.githubusercontent.com/open-webui/open-webui/main/LICENSE

### Agent、RAG 与评测组件

9. Vercel AI SDK: https://github.com/vercel/ai
10. LangGraph Python and JS: https://github.com/langchain-ai/langgraph ; https://github.com/langchain-ai/langgraphjs
11. LlamaIndex Python and archived TypeScript repository: https://github.com/run-llama/llama_index ; https://github.com/run-llama/LlamaIndexTS
12. Haystack: https://github.com/deepset-ai/haystack
13. LiteLLM: https://github.com/BerriAI/litellm
14. pgvector: https://github.com/pgvector/pgvector
15. Qdrant: https://github.com/qdrant/qdrant
16. Ragas: https://github.com/vibrantlabsai/ragas
17. Phoenix: https://github.com/Arize-ai/phoenix

### 实时语音与数字人

18. LiveKit Agents: https://github.com/livekit/agents
19. LiveKit tool latency issue #5826: https://github.com/livekit/agents/issues/5826
20. Pipecat: https://github.com/pipecat-ai/pipecat
21. Pipecat interrupted function-call issue #4997: https://github.com/pipecat-ai/pipecat/issues/4997
22. OpenAvatarChat and WebUI: https://github.com/HumanAIGC-Engineering/OpenAvatarChat ; https://github.com/HumanAIGC-Engineering/OpenAvatarChat-WebUI
23. OpenAvatarChat long-session sync issue #292: https://github.com/HumanAIGC-Engineering/OpenAvatarChat/issues/292
24. MuseTalk: https://github.com/TMElyralab/MuseTalk
25. Wav2Lip: https://github.com/Rudrabha/Wav2Lip
26. SadTalker and command-injection issue #1043: https://github.com/OpenTalker/SadTalker ; https://github.com/OpenTalker/SadTalker/issues/1043

## 方法论说明

本报告使用横纵分析法：纵向观察开源 AI 应用从文档问答、RAG 管线、Agent 工具调用到实时语音和数字人的演进；横向比较完整平台、组件框架与媒体项目；再把这些项目与 Revolution 的 Next.js 技术栈、私有 Wiki 边界、作品集目标和阶段验收要求交叉，形成具体选型与实施顺序。
