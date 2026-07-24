# 数字分身 AI 智能客服横纵分析报告

> Status note (2026-07-25): Historical research material only. It does not override `docs/portfolio-blueprint.md`, current code, or release evidence; revalidate external facts before reuse.

> 研究时间：2026-07-11 | 所属领域：生成式 AI、知识库问答、实时语音、数字人 | 研究对象：Revolution 个人作品集的数字摩斯

## 执行摘要

数字分身不是一张会动的脸，也不是在网页右下角放一个通用聊天框。对 Revolution 来说，它应该由四层共同组成：稳定的人格与边界、可追溯的摩斯知识、受控的外部工具，以及可替换的视觉与声音形象。

推荐路线是：**先做可信文本分身，再做语音，最后做实时头像**。

第一版使用 Next.js App Router、Vercel AI SDK 和 OpenAI Responses API。浏览器通过 `useChat` 连接同源 `/api/chat`，服务端完成限流、输入审核、知识加载、模型调用、联网权限决策和引用整理。回答默认只使用经过摩斯终审的公开知识库；只有用户主动允许或问题明确需要时效信息时，服务端才向模型暴露只读 `web_search`。知识库证据和网页证据必须在 UI 中分开显示。

当前最重要的边界来自本地事实：`E:\Wiki` 约有 7,976 个文件、101MB，其中 Markdown 3,821 个，还混有代码和资源。它不是可以直接上传或塞进 prompt 的公开知识库。运行时只能使用从中人工审核、脱敏、版本化发布的 5-6 份公开知识文件。私有原始库和公开回答库必须物理隔离。

在公开语料仍小于约 50k tokens 时，全量上下文加 prompt caching 比向量数据库更简单，也更容易证明“没有漏掉一段关键自述”。但从第一天起，接口就应返回统一的 `answer + evidence[] + route + confidence/abstain_reason`。未来语料变大或更新频繁时，后端可以无损切换到混合 RAG，不必重做前端。

联网搜索可以实现，但不应被描述成“数字分身自己随便浏览互联网”。网页内容可能包含间接提示注入。安全设计必须让搜索代理只接触最小化查询和公开上下文，不能接触系统提示、私有知识、其他访客对话或任何有副作用的工具。公开站首版只允许读，不允许发邮件、改数据库、运行命令或替用户提交表单。

视觉层建议继续使用当前预渲染数字人/待机动画形成在场感。语音第二阶段采用“按住说话 -> STT -> 同一个文本代理 -> 流式 TTS”，这样字幕、引用、审核和故障定位都保留。OpenAI Realtime WebRTC、LiveAvatar LITE、Tavus CVI 应作为独立 PoC 比较，而不是和 S7 第一版一起上线。面向中国大陆访客时，OpenAI 和海外实时数字人链路的可达性均不能假设成立，文本降级必须一直可用。

## 一、一句话定义

数字摩斯是一个以摩斯公开知识为事实边界、能实时对话、在授权时检索互联网、始终展示证据来源，并通过文字、声音和数字人形象表达同一人格的个人 AI 服务。

它和传统客服的区别不是“回答更像人”，而是回答对象就是摩斯本人。它不能用通用常识补写摩斯的经历，也不能把联网搜到的第三方内容变成摩斯的个人事实。

## 二、纵向分析：从 FAQ 机器人到有边界的数字分身

### 2.1 第一阶段：脚本、关键词与固定答案

早期网站客服解决的是路由问题。用户输入关键词，系统返回预先写好的 FAQ，或把人引到人工客服。优点是确定性强、成本低、容易审计；缺点是语言稍微变化就匹配失败，也无法组合多个知识点。

这套思路今天仍有价值。数字摩斯不应抛弃固定内容，而应把经终审的履历、项目状态、联系方式和能力边界视为不可由模型自由改写的 canonical facts。生成模型负责理解问题和组织表达，不负责发明事实。

### 2.2 第二阶段：搜索与检索成为外部记忆

2020 年的 RAG 论文把参数化模型与非参数化外部记忆结合起来，核心动机包括知识更新、来源追踪和减少只依赖模型参数的事实错误。[1] 这一步改变了客服系统的基本结构：答案不再只来自模型内部，而是由“检索什么”和“如何基于证据回答”共同决定。

后来工程实践发现，单纯向量相似度并不够。语义检索擅长同义表达，BM25/全文检索擅长项目名、错误码和专有名词；融合检索再加 reranker，通常比只用一种检索稳健。[2][3] 这也解释了为什么“接一个向量库”不是知识库质量的同义词。分块、元数据、更新版本、访问权限、重排和引用合同都比数据库品牌更重要。

### 2.3 第三阶段：模型开始使用工具

ReAct 在 2022 年系统化展示了推理与行动交替的路径：模型可以在回答过程中调用外部知识源，根据结果继续判断。[4] Toolformer 随后证明，模型可以学习何时调用搜索、计算器和其他 API。[5] 客服由此从“检索后生成”演进为“根据问题选择工具”。

这一演进带来新的产品能力：模型可以先查摩斯知识库，发现问题涉及当前新闻或最新技术时再联网；也可以为 JD 匹配调用结构化分析工具。但工具能力越强，越不能只靠 system prompt 约束。服务端必须决定模型能看到哪些工具、每个工具能做什么、最多走几步、何时需要人工确认。

### 2.4 第四阶段：流式、多模态与实时语音

Responses API 使用 SSE 和类型化语义事件流式返回文本、工具调用、完成与错误事件。[6] 浏览器不必等待整段答案生成，就能看到文字逐步出现。Vercel AI SDK 的 `useChat`、`streamText` 和 UI message parts 把这些状态包装成适合 Next.js 的交互模型，包括停止、重试、错误和工具结果。[7]

语音又分成两条路线。链式语音把 STT、文本代理和 TTS 串起来，延迟更高，但每一步可观察、可缓存、可展示字幕和引用；端到端 Realtime speech-to-speech 更自然，支持打断和低首音延迟，但会话成本、故障定位和供应商耦合更高。OpenAI 官方建议浏览器实时语音使用 WebRTC，并通过服务端统一接口或临时凭证建立会话，标准 API key 不能进入浏览器。[8]

### 2.5 第五阶段：风险从“答错”扩展到“被外部内容操纵”

当模型读取网页或上传文档时，数据和指令的边界会模糊。间接提示注入论文展示了攻击者可以在网页或文档中植入指令，诱导模型泄露数据或错误调用工具。[9] OWASP 明确指出，RAG 和微调并不能彻底消除提示注入；缓解依赖最小权限、外部内容隔离、结构化工具参数、人工审批和持续红队测试。[10]

所以，数字分身“能联网”不是简单加一个搜索 API。真正的能力是：它知道何时搜索、只带什么信息出去、如何把网页当不可信证据、如何显示来源，以及哪些动作无论模型怎么请求都不会执行。

## 三、横向分析：四种实现路线

### 3.1 路线 A：完全自研 Next.js + Vercel AI SDK + OpenAI Responses

这是最适合 Revolution 的主路线。

Vercel AI SDK 负责前端聊天状态、流协议、provider 抽象和工具消息；OpenAI Responses API 负责模型、托管文件搜索和网页搜索。应用自己的服务端仍掌握会话、权限、日志、知识版本和 UI 引用合同。[7][11]

优势是与现有 Next.js App Router 直接衔接，产品体验可完全定制，未来可替换模型 provider。OpenAI 的 `file_search` 能托管分块、embedding 和检索，并返回文件引用；`web_search` 能返回 inline citations、完整 sources、domain filters 和实时访问控制。[12][13]

短板是工程责任仍在自己：限流、审核、会话存储、评测、隐私声明、数据删除和失败降级都要实现。Vercel AI SDK 的本地 `toolApproval` 也不能拦截 provider 侧执行的托管工具。真正的搜索权限必须由服务端决定本次请求是否把 `web_search` 提供给模型。[14]

适用判断：最符合“网站本身就是作品”的定位。它展示的是摩斯对产品、安全和证据链的判断，不只是接入一个 SaaS 小组件。

### 3.2 路线 B：低代码/开源平台，如 Dify、FastGPT

这类平台把知识库、工作流、模型选择、日志和发布 API 做成控制台，能更快搭出可用问答。自托管版本还能控制一部分数据面。

优势是搭建快、运营界面成熟、非开发人员也能调整工作流。短板是前端体验、流协议、工具审批和知识证据格式会受平台约束；自托管并不等于低运维，仍要维护数据库、向量库、队列、对象存储和升级。对于 Revolution，这种路线会削弱“作品本身展示工程判断”的价值。

适用判断：可以作为内部知识编排或快速验证工具，但不建议直接把默认聊天组件嵌入正式站。若采用，应把它放在后端，通过自己定义的 `/api/chat` 合同接入，避免前端与平台绑定。

### 3.3 路线 C：Agent 框架，如 LangGraph

LangGraph 适合长流程、可恢复执行、复杂状态、人工审批和多代理协作。它能精确表达“检索 -> 评估 -> 搜索 -> 验证 -> 回答”的图，并保存中间状态。

但数字摩斯第一版的核心流程只有一到三个受控步骤。过早引入图编排会增加运行时、调试和部署复杂度。只有在 JD 报告、需求初诊、长时间研究或人工审核流程成为主功能后，它才比简单的 Responses/AI SDK tool loop 更划算。

适用判断：作为 S8 以后复杂能力的候选，不作为 S7 文本客服的起点。

### 3.4 路线 D：托管实时数字人，如 LiveAvatar、Tavus

LiveAvatar 和 Tavus 把 WebRTC、STT、TTS、轮次控制、头像渲染和口型统一托管。最快可以通过 iframe、React SDK 或平台会话进入网页。[15][16]

它们解决的是“形象如何实时说话”，不自动解决摩斯知识边界、网页搜索安全、引用、日志和评测。LiveAvatar LITE 允许自己保留 STT/LLM/TTS，只使用音频驱动视频，对本项目比 FULL 更合适；Tavus CVI 功能完整，但成本和第三方数据面更大。

短板包括按分钟付费、弱网和企业网络下的 WebRTC/TURN 依赖、第三方数据留存、移动端兼容和中国大陆可达性。Tavus 官方只给出低延迟方向性描述，没有可核验的固定端到端毫秒 SLA，必须实测。[16]

适用判断：只做 S7D PoC，不作为知识客服大脑。托管头像失败时必须无缝退回文本和字幕。

### 3.5 路线对比

| 维度 | 自研 AI SDK + Responses | Dify/FastGPT | LangGraph | LiveAvatar/Tavus |
|---|---|---|---|---|
| 与现有 Next.js 融合 | 最好 | 中等 | 中等 | 视觉接入快，业务融合中等 |
| 知识与引用控制 | 高 | 中到高 | 高 | 取决于外接大脑 |
| 联网搜索控制 | 高 | 中 | 高 | 取决于外接大脑 |
| 第一版开发速度 | 中 | 快 | 慢 | 视觉快、整体并不快 |
| 运维复杂度 | 中 | SaaS 低/自托管高 | 高 | 平台侧低、供应商风险高 |
| 产品差异化 | 高 | 低到中 | 中 | 视觉高但容易同质化 |
| 适合当前 Revolution | 推荐主线 | 原型/后台候选 | 后期复杂流程 | 后期增强层 |

## 四、横纵交汇：适合 Revolution 的目标架构

### 4.1 四层必须解耦

```text
形象层：预渲染视频 / talking loop / Realtime avatar
                         |
交互层：文字流、字幕、麦克风、来源卡片、停止与降级
                         |
代理层：人格规则、路由、会话状态、工具权限、审核与预算
                         |
知识层：approved public KB / web evidence / canonical facts
```

形象层可以更换而不改变回答；模型 provider 可以更换而不改变前端消息合同；知识库升级成 RAG 时不改变引用 UI。这三个“不改变”是架构健康度的标准。

### 4.2 推荐请求流

```text
访客输入
  -> 同源 /api/chat
  -> 请求校验、匿名限流、input moderation
  -> 路由：kb_verified / web_current / unknown / blocked
  -> 加载 approved public KB 或执行只读搜索
  -> Responses API 流式生成
  -> 服务端整理 answer + evidence + route + usage
  -> 客户端渲染文字、状态、引用和降级提示
  -> 脱敏 trace、反馈与 eval 回流
```

推荐的 UI 消息合同：

```ts
type AnswerEnvelope = {
  answer: string;
  route: 'kb_verified' | 'web_current' | 'mixed' | 'unknown' | 'blocked';
  evidence: Array<{
    id: string;
    kind: 'knowledge' | 'web';
    title: string;
    version?: string;
    section?: string;
    url?: string;
    quote?: string;
    accessedAt?: string;
  }>;
  confidence: 'high' | 'medium' | 'low';
  abstainReason?: string;
};
```

模型输出不一定直接生成整个结构，但服务端最终必须把 provider 的 file citations、URL annotations 和内部 source IDs 归一化成这个合同。

### 4.3 知识发布管线

`E:\Wiki` 是私有原始库，不应成为线上运行时依赖。建议建立显式发布链：

```text
E:\Wiki 和项目资料（只读、私有）
  -> 本地提炼与脱敏
  -> content/knowledge/review/（待摩斯终审）
  -> 人工批准
  -> content/knowledge/approved/（唯一线上知识源）
  -> manifest.json（版本、hash、source_id、visibility）
  -> 构建期 prompt bundle 或 vector store sync
```

聊天记录不能自动回灌 approved 库。thumbs-down、未回答问题和访客新线索只进入 review 队列，经人工确认后发布新版本。

### 4.4 全量上下文还是 RAG

建议把 50k tokens 作为 Revolution 的工程触发点，不是行业硬标准。

- 小于 50k：全量 approved 知识前置，静态前缀保持逐字节稳定，利用 prompt caching；用户问题和会话放在后面。[17]
- 50k-150k：用 gold set 做全量上下文与轻量 RAG A/B。长上下文对“信息位于中间”存在退化，窗口能装下不代表稳定利用。[18]
- 大于 150k，或文档频繁更新、权限复杂、必须精确引用：采用混合 RAG。

混合 RAG 的起始配置可以是：按标题和语义边界切 400-800 token 块，10%-15% overlap；BM25 与 embedding 并行召回 30-80 块，RRF 融合去重，再 rerank 到 6-10 块。所有数字必须由本项目 eval 调整，不能当固定最佳值。

若只有 approved 公共知识，OpenAI hosted file search 是最快路径。若未来需要私有/公开权限、多 provider 和自有数据治理，PostgreSQL full-text + pgvector 更合适，避免额外维护一个独立向量数据库。

### 4.5 联网搜索的权限模型

联网分三档：

1. 默认关闭：摩斯个人事实、项目经历、联系方式只查 approved KB。
2. 用户选择“允许联网”：用于最新技术、行业现状和外部资料。
3. 服务端自动路由：只在 gold set 证明路由可靠后启用。

OpenAI 当前 `web_search` 能返回 URL citations、完整 sources、domain filters、search context size 和 live access 控制。[13] UI 展示网页事实时，引用必须清晰、可点击。搜索 query 只能包含解决问题所需的最少公开信息，不能拼接系统 prompt、完整对话、邮箱、私有文档片段或其他访客信息。

网页内容必须被标记为 untrusted data。搜索节点只输出结构化事实、原文引句、URL、发布日期和访问时间，不能直接触发第二个工具。第一版不提供任意 URL 抓取器，也不提供任何写操作。

### 4.6 会话记忆

记忆分三层：

- 当前会话：最近 4-8 轮原文加滚动摘要，页面关闭或超时后删除。
- 长期偏好：只有访客明确同意后才保存，并提供查看、修改、删除和 TTL。
- canonical KB：经摩斯审核的公开事实，不能由模型或聊天自动修改。

匿名作品集首版只需要当前会话。业务数据库应是自己的事实源，不建议把 OpenAI Conversations 当唯一数据库。官方数据说明显示 Conversations 和 vector stores 等应用状态可能保存到删除为止；Responses 默认也存在应用状态与滥用监控留存差异，需按 `store:false`、删除策略和隐私声明配置。[19]

## 五、语音与数字人实现

### 5.1 S7A：预渲染形象 + 文本对话

当前 DigitalHuman 区域继续播放静音 idle loop。模型回复时切换 talking loop，停止时回 idle，并明确这不是逐字口型。它几乎没有实时视频推理成本，也不要求摄像头或麦克风。

这是最合理的首发，因为访客首先看到的是答案质量、证据和人格。文字模式也是所有后续语音/视频失败时的最终降级路径。

### 5.2 S7B：链式语音

采用“按住说话 -> STT -> 文本代理 -> 流式 TTS”。按住说话比一开始启用 VAD 更可控，不会因环境噪声误触。文本代理仍走同一个知识库、搜索、安全和引用流程；屏幕同步显示字幕与来源。

浏览器只请求麦克风，不请求摄像头。`getUserMedia` 要求 HTTPS 和用户显式授权；有声自动播放通常要求用户先交互，因此入口必须是“点击开始对话”，并提供静音、停止和文本模式。[20]

### 5.3 S7C：OpenAI Realtime WebRTC PoC

Realtime 适合更自然的打断与低延迟语音。浏览器建立 WebRTC peer connection，后端使用标准 API key 创建统一会话或临时 client secret；浏览器永远不接触标准 key。[8]

知识库和搜索仍通过后端 function/MCP 工具执行。Realtime 不能成为绕过 `/api/chat` 权限的第二条无审计链路。PoC 应测首音、完整轮次、打断、弱网重连、上下文增长后的成本和字幕/引用同步。

### 5.4 S7D：LiveAvatar 与 Tavus PoC

使用同一套 20 条中文场景分别测试 LiveAvatar LITE sandbox 与 Tavus free plan。评分项包括连接成功率、首帧、首音、打断、口型、知识正确率、引用完整度、移动端兼容和每 10 分钟成本。

LiveAvatar LITE 更符合本项目，因为知识、搜索、日志和防护仍由自己的后端掌握；Tavus 更适合视觉效果优先的完整托管试点。无论哪家胜出，都只能作为可关闭的形象层。

自托管 MuseTalk/Wav2Lip 类方案需要 GPU 常驻、音频分块、A/V 同步、WebRTC/SFU/TURN、背压和断线恢复。MuseTalk 的实时表现高度依赖 GPU；Wav2Lip 开源权重存在非商业限制。除非“自研数字人基础设施”本身成为作品主角，否则不值得作为当前主线。[21][22]

## 六、安全、隐私与成本护栏

### 6.1 首版硬边界

- API key 只在服务端。
- 单条输入最多 500 字，每匿名设备/会话每天 20 条。
- 每次最多 3 个工具步骤，设置请求超时、输出 token 上限和日/月预算熔断。
- 默认只提供 knowledge tool；是否提供 web search 由服务端策略决定。
- 不提供邮件、支付、数据库写入、shell、浏览器控制或任意 URL 工具。
- 用户输入先审核；低风险作品集场景可流式显示，但要承认完整输出审核只能在生成结束后得到，不能宣称流式片段已完整审核。[6][23]
- 使用稳定、隐私保护的匿名 `safety_identifier`，记录异常但不保存明文身份。[24]
- 日志默认不存原始音频和完整消息；需要抽样时先脱敏并设置保留期。

### 6.2 提示注入防线

任何网页、上传文档和检索块都属于数据，不属于指令。系统提示中声明这一点有帮助，但不能替代代码控制。真正有效的是：

- 私有与公开知识物理隔离。
- 工具最小权限、参数 schema 校验和固定返回 schema。
- 搜索代理不持有其他工具，也看不到私有上下文。
- 高风险动作必须人工批准；公开客服第一版没有高风险动作。
- 保留来源与工具 trace，建立提示注入测试集。
- 对外部内容做长度、MIME、HTML 清洗和来源过滤。

如果未来自建网页抓取器，还必须处理 SSRF：限制 `http/https`，规范化 URL，阻断 localhost、RFC1918、link-local、云 metadata 和 IPv6 私网，每次重定向重新验证，限制响应大小、MIME 和超时，并通过独立 egress proxy。[25]

### 6.3 成本模型

不要把“模型单价”当总成本。真实成本由五部分组成：输入上下文、输出 token、搜索/文件工具调用、语音分钟/音频 token、实时头像分钟。

控制成本的优先级：小模型处理日常问答；稳定知识前缀命中缓存；只在必要时联网；限制工具步数；长会话摘要与截断；语音按需开启；头像按区域和网络能力启用。高能力模型只用于 JD 匹配、需求初诊或复杂研究。

模型 ID 和价格会变化，落地时应通过环境变量配置，并用真实 gold set 比较质量、首 token 延迟和单次成本。当前官方最新模型指南把 GPT-5.6 Luna 定位为高吞吐、Terra 定位为成本与能力平衡、Sol 定位为旗舰能力；这可以作为评测起点，不应未经评测直接锁死。[26]

### 6.4 中国大陆可达性

OpenAI 官方支持地区列表当前不包含中国大陆，并提示在未支持地区提供或访问 API 可能导致账号受限。[27] LiveAvatar/Tavus 官方资料也没有给出可核验的大陆节点或 SLA，且实时媒体依赖国际域名、UDP/TURN。

因此产品必须 fail closed：海外链路失败时回退文本；部署前用移动、联通、电信与 iOS/Android 实测。若主要受众在大陆，需要另做国内 LLM、STT、TTS 和数字人 provider 评测，保持同一消息与证据合同，不让前端绑定供应商。

## 七、实施路线图

### S7A：可信文本分身

目标：先证明它像摩斯、只说有证据的话。

- 新增 `app/api/chat/route.ts`，服务端流式调用 Responses API。
- 新增 `components/DigitalMorseChat.*`，包含开场分流、流式文本、停止、重试、错误和引用。
- 新增 `lib/ai/`：provider、policy、knowledge、citations、moderation、budget。
- 建立 `content/knowledge/review/` 与 `approved/`，只允许 approved 进入构建。
- 第一版使用全量 approved KB + stable prompt prefix；显式 `store:false`。
- 只做 session memory；不保存长期个人记忆。
- 建 60-100 条 gold set，覆盖事实、同义问法、跨文档、无答案、越权和提示注入。

完成标准：20 个预设问题只是下限。还要做到引用覆盖、无证据拒答、跨访客隔离、限流和故障降级全部通过。

### S7B：受控联网

目标：能查新信息，但不能把互联网变成指令源。

- 增加“允许联网”开关和清晰的联网状态。
- 服务端按 route 决定是否提供 `web_search`。
- 搜索 query 脱敏；网页来源和 KB 来源分栏显示。
- 记录完整 sources、访问时间、工具成本与路由原因。
- 加入间接提示注入、恶意网页、无来源和错误来源测试。

完成标准：应联网问题的召回率、非时效问题的误联网率、引用 precision 和提示注入防护达到预设门槛。

### S7C：链式语音

目标：让访客能说话，同时不牺牲字幕、引用和可审计性。

- 按住说话、STT、同一文本代理、流式 TTS。
- 默认不开麦，明确授权与隐私提示。
- 字幕、停止、静音、文本降级和网络错误恢复。
- 不保存原始音频；记录匿名延迟与错误指标。

### S7D：实时数字人 PoC

目标：证明实时头像的体验收益大于成本和可达性风险。

- OpenAI Realtime、LiveAvatar LITE、Tavus 三条路线用同一测试集比较。
- 海外/大陆、桌面/移动、Wi-Fi/蜂窝网络分别测试。
- 只有胜出方案进入正式站，且必须保持文本 fallback。

## 八、评测与可观测性

gold set 每条至少记录：问题、expected route、允许的 source IDs、关键事实、是否应拒答、是否允许联网。指标分四类：

- 检索：Recall@k、MRR/nDCG。
- 生成：事实正确率、faithfulness、citation precision/coverage、拒答正确率。
- 路由：联网触发 precision/recall、工具步数、越权率。
- 运营：p50/p95 首 token、总延迟、token/搜索/语音成本、错误率和用户反馈。

每次改模型、prompt、chunk、embedding 或知识版本都跑同一套回归。生产 trace 至少包含匿名 session、route、model/prompt/KB 版本、检索 query、top chunks/scores、网页 domains、最终 citations、工具调用、token/成本、TTFT、总延迟、错误与安全标记。OpenTelemetry GenAI semantic conventions 可作为字段命名基线。[28]

## 九、最终判断

Revolution 的优势不在于比 SaaS 厂商更快做出一张会说话的脸，而在于把“一个人 + 一套 AI 操作系统”做成访客可以验证的产品。

最可能成功的路径是：S7A 文本知识分身，S7B 受控联网，S7C 链式语音，S7D 实时头像 PoC。每一层都建立在上一层已经可信的基础上，也都能在下一层失败时独立工作。

最危险的路径是把整个私有 Wiki 上传给模型、默认每问都联网、让搜索结果和个人知识混写，再叠加一个按分钟付费的实时头像。它看上去最像“数字人”，却最容易泄露信息、答错身份事实、失控烧钱，并在大陆网络下直接不可用。

最乐观的路径是把同一套人格、证据和工具合同复用到文本、语音和头像，让访客看到的不是四个拼起来的供应商组件，而是一个无论用哪种介质都保持一致边界的数字摩斯。

下一步不应立即购买数字人套餐。应该先为 S7A 写阶段契约：公开知识 schema、回答与引用合同、60-100 条 gold set、隐私/留存策略、模型与预算基线。契约通过后再进入实现。

## 十、信息来源

以下资料均于 2026-07-11 访问。

1. Lewis et al., Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks: https://arxiv.org/abs/2005.11401
2. BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models: https://arxiv.org/abs/2104.08663
3. Anthropic, Contextual Retrieval: https://www.anthropic.com/news/contextual-retrieval
4. ReAct: Synergizing Reasoning and Acting in Language Models: https://arxiv.org/abs/2210.03629
5. Toolformer: Language Models Can Teach Themselves to Use Tools: https://arxiv.org/abs/2302.04761
6. OpenAI, Streaming API responses: https://developers.openai.com/api/docs/guides/streaming-responses
7. Vercel AI SDK, Chatbot: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot
8. OpenAI, Realtime API with WebRTC: https://developers.openai.com/api/docs/guides/realtime-webrtc
9. Greshake et al., Indirect Prompt Injection: https://arxiv.org/abs/2302.12173
10. OWASP, LLM Prompt Injection Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
11. Vercel AI SDK, Next.js App Router Quickstart: https://ai-sdk.dev/docs/getting-started/nextjs-app-router
12. OpenAI, File Search: https://developers.openai.com/api/docs/guides/tools-file-search
13. OpenAI, Web Search: https://developers.openai.com/api/docs/guides/tools-web-search
14. Vercel AI SDK, Tools and Tool Calling: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
15. LiveAvatar Documentation: https://docs.liveavatar.com/index.md
16. Tavus Conversational Video Interface: https://docs.tavus.io/sections/conversational-video-interface/overview.md
17. OpenAI, Prompt Caching: https://developers.openai.com/api/docs/guides/prompt-caching
18. Lost in the Middle: How Language Models Use Long Contexts: https://arxiv.org/abs/2307.03172
19. OpenAI, Data Controls: https://developers.openai.com/api/docs/guides/your-data
20. MDN, MediaDevices.getUserMedia and Autoplay Guide: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia ; https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
21. MuseTalk: https://github.com/TMElyralab/MuseTalk
22. Wav2Lip: https://github.com/Rudrabha/Wav2Lip
23. OpenAI, Moderation: https://developers.openai.com/api/docs/guides/moderation
24. OpenAI, Safety Best Practices: https://developers.openai.com/api/docs/guides/safety-best-practices
25. OWASP, SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
26. OpenAI, Latest Model Guidance: https://developers.openai.com/api/docs/guides/latest-model
27. OpenAI API Supported Countries and Territories: https://help.openai.com/en/articles/5347006-openai-api-supported-countries-and-territories
28. OpenTelemetry, GenAI Semantic Conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/
29. RAG or Long-Context LLMs? A Comprehensive Study and Hybrid Approach: https://arxiv.org/abs/2407.16833
30. RAGAS: Automated Evaluation of Retrieval Augmented Generation: https://arxiv.org/abs/2309.15217

## 方法论说明

本报告使用横纵分析法：纵向追踪网站智能客服从规则问答、RAG、工具调用到实时多模态的演进；横向比较自研 AI SDK、低代码平台、Agent 框架和托管数字人；最终把历史形成的能力与当前 Revolution 的代码、知识规模、公开边界和部署约束交叉，形成项目级实施判断。
