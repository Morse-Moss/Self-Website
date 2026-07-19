# 数字摩斯作品集资料草稿

**内容已同步至本地展示 - 待终审，未经上线授权不得部署**

## 折叠展示

### 项目名称

数字摩斯

### 项目简介

嵌入个人作品集的 AI 数字分身系统，通过自由对话、JD 匹配和需求初诊，帮助访客快速了解项目与能力，并获得带来源的可追溯回答。

### 能力短词

`三类对话工作流` `BGE + pgvector` `可追溯来源` `受控联网` `停止与恢复`

### 真实状态

唯一开发者 · 已上线 · 持续完善中

### 推荐主图

数字摩斯对话主界面，三类工作流入口与提问区同屏。以 `public/works/digital-morse/digital-morse-main-local-2026-07-19.png` 为基线，裁去底部会话有效期信息后使用。

## 展开详情

### 01 项目简介

数字摩斯是一套嵌入个人作品集的 AI 数字分身系统，面向招聘方、潜在客户和同行。访客可以通过对话了解摩斯的项目、能力和技术判断，也可以提交 JD 或结构化业务需求，获得带来源的匹配分析与初步诊断。

系统将作品集内容、RAG 检索、工作流编排、流式生成和后台治理连接为完整产品链路，已上线并持续完善。

### 02 核心能力

- 自由对话：围绕项目经历、技术实现和工程判断进行多轮问答。
- JD 匹配：拆解岗位要求，关联公开项目与能力，输出匹配点和诚实缺口。
- 需求初诊：逐步收集问题、目标、现状、约束和时间预期，形成初步判断与下一步。
- 可追溯 RAG：使用 BGE Embeddings 和 pgvector 检索审核后的公开知识，并返回具名来源。
- 受控联网：通过确定性 SearchRouter 判断是否补充外部资料，个人履历和项目事实始终以站内知识为准。
- 可靠对话：支持 SSE 流式输出、真实停止、原位重试、会话恢复、幂等重放和失败补偿。

### 03 系统架构

主流程：

> 访客问题 / JD / 需求字段 -> 访问与工作流编排 -> BGE + pgvector 检索 -> SearchRouter 按需补充资料 -> OpenAI-compatible Responses 生成 -> SSE 流式返回 -> 交互记录与后台回看

模块：`交互层` `工作流层` `知识层` `生成层` `治理层`

### 04 我的技术实现

数字摩斯由我发起；需求判断、产品方向和部分创意也会吸收招聘方、潜在客户、同行及真实业务沟通中的输入。我是项目唯一开发者，负责全部技术实现。

- 作品集前端、对话工作区、响应式界面和私有管理后台。
- 自由对话、JD Match 和 Diagnosis State Machine 三类工作流。
- BGE 知识向量化、pgvector 检索、来源映射和 SearchRouter。
- OpenAI-compatible Responses 适配、SSE、停止、超时、有界重试和幂等恢复。
- PostgreSQL 数据模型、短期访问、用量治理、badcase、导出和 Transactional Outbox。
- Docker、Caddy、HTTPS、Worker、数据库迁移、健康检查和发布冒烟。

未来方向：语音与视频表达、经用户授权且可撤销的长期记忆、人工审核的知识更新工作流。

### 05 技术栈

- 前端：Next.js 16、React 19、TypeScript、CSS Modules。
- 服务端：Next.js Route Handlers、Node.js Worker、OpenAI SDK、SSE。
- AI / Agent：OpenAI-compatible Responses、BGE Embeddings、RAG、SearchRouter、JD Match、Diagnosis State Machine。
- 数据：PostgreSQL 16、pgvector。
- 工程：Docker Compose、Caddy、HTTPS、Transactional Outbox、Health Check、Release Smoke。

## 知识库

### 项目定位与价值

数字摩斯将个人作品集扩展为可对话的数字分身入口。招聘方、潜在客户和同行可以直接询问项目、能力与技术决策，也可以通过 JD 匹配和需求初诊完成更具体的交流。

### 使用流程

访客进入站内对话并完成短期访问授权，选择自由对话、JD 匹配或需求初诊。系统检索公开知识，按需补充外部资料，再以流式方式返回带来源回答；对话支持停止、重试和继续恢复。

### 核心架构

Next.js 承载作品集、对话工作区和管理后台；Chat Service 编排工作流、BGE Embedding、pgvector 检索、SearchRouter 和 OpenAI-compatible Responses；PostgreSQL 保存知识、会话和交互记录；Worker 处理 Outbox 与清理任务；Caddy 负责 HTTPS 入口。

### 关键技术实现

使用 BGE Embeddings 生成知识向量，以 pgvector 完成语义检索；通过确定性 SearchRouter 控制联网；三类工作流分别约束输入和输出；SSE、Abort、幂等 Turn、事务补偿和有界重试保障对话可靠性。

### 个人技术贡献

我是项目唯一开发者，独立完成前端、服务端、RAG、模型适配、工作流、数据模型、访问治理、管理后台、Worker 和生产交付。业务需求、产品方向和部分创意也会吸收真实沟通中的输入。

### 未来方向

未来将增加语音与视频表达；建设经用户授权、可查看、可撤销的跨会话长期记忆；建立人工审核的知识更新流程；继续完善数字分身的持续工作能力。
