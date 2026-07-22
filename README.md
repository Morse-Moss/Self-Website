# Morse

AI 原生个人独立站与数字分身系统。

Morse 将个人主页、项目作品集和可追溯 AI 对话整合在一个站点中。访客既可以浏览结构化内容，也可以通过自由问答、岗位匹配和需求初诊等工作流，与基于审核知识构建的数字分身进行交互。

![Morse 当前首页](docs/assets/morse-home.png)

## 核心能力

- **个人独立站**：以统一内容源组织身份信息、项目案例和公开知识，并适配桌面与移动端。
- **AI 数字分身**：提供自由问答、JD 匹配和需求初诊三种对话工作流，用对话代替静态信息检索。
- **可追溯回答**：使用本地 BGE Embeddings、PostgreSQL 与 pgvector 检索审核后的公开知识，回答附带服务端确认的来源。
- **作品展示**：以结构化案例承载个人作品的背景、流程、技术实现、当前状态和公开边界。
- **完整治理链路**：包含访问额度、会话恢复、停止与重试、Provider 故障切换、管理后台、异步 Worker 和健康检查。
- **受控内容访问**：私密内容使用独立邀请与 Session、加密存储和审计清理，不进入公开内容、RAG 或模型输入。

## 作品集

![Morse 当前作品集](docs/assets/morse-works.png)

Morse 只负责个人独立站、作品呈现、AI 数字分身和访问治理。站内展示的其他系统均为维护者独立开发的个人作品，不属于本仓库的组成模块，也不是 Morse 的运行依赖。

## 系统架构

```mermaid
flowchart LR
    Visitor[访客] --> Web[Next.js 个人独立站]
    Web --> Portfolio[作品与公开内容]
    Web --> Chat[数字分身对话]
    Web --> Private[受控私密内容]

    Chat --> Workflow[对话工作流]
    Workflow --> RAG[RAG 检索]
    Workflow --> Search[受控联网搜索]
    Workflow --> Gateway[模型网关与故障切换]

    RAG --> Knowledge[审核知识源]
    RAG --> Vector[BGE + pgvector]
    Gateway --> Provider[OpenAI-compatible Provider]

    Admin[管理后台] --> Access[邀请码与访问治理]
    Admin --> ProviderConfig[Provider 管理]
    Worker[异步 Worker] --> Cleanup[会话、审计与任务清理]
```

站点页面和 RAG 共用同一份审核后的公开内容源。模型不能自行生成可点击来源，也不能从草稿、私密简历或企业内部资料中补全事实。

## 技术栈

- Next.js App Router、React、TypeScript
- CSS Modules、全局设计 Token、Three.js、GSAP
- PostgreSQL、pgvector、本地 BGE Embeddings
- OpenAI-compatible Responses、SSE、Provider 故障切换
- Node.js Worker、Docker Compose、Caddy

## 本地运行

安装依赖并启动基础站点：

```powershell
npm ci
npm run dev
```

完整数字分身需要按 `.env.example` 配置环境，并启动 PostgreSQL 与本地 Embedding 服务：

```powershell
npm run db:up
$env:MORSE_EMBEDDING_DEVICE = 'auto'
E:\AI\Python\python.exe scripts\local-embedding-server.py
```

随后初始化数据库和公开知识：

```powershell
$env:DATABASE_URL = 'postgresql://revolution@127.0.0.1:55432/revolution'
npm run db:migrate
npm run knowledge:ingest
npm run dev
```

本地 BGE 服务只监听 `127.0.0.1:18091`。生产环境的完整配置、角色划分、健康检查、备份与恢复边界见 [`docs/runbooks/production.md`](docs/runbooks/production.md)。

## 验证

```powershell
npm test
npm run chat:eval
npm run rag:eval
npm run build
```

UI 改动还需检查 1440 与 390 双宽、浏览器控制台、横向溢出和 `prefers-reduced-motion`。上线前 Lighthouse Performance 需达到 90 以上。

## 安全与内容边界

- `content/site-content.json` 是页面与 RAG 的唯一公开内容源；`content/drafts/` 不直接上线。
- 企业内部项目只展示获批的脱敏事实与示例媒体，不提供内部系统、源码或生产数据。
- 私密简历使用独立邀请、独立 Session 和 AES-256-GCM 加密存储，不写入 Git、公开目录、RAG、Provider 输入、截图或日志。
- Provider 密钥、管理员凭据和生产配置只保留在服务端，不进入代码仓库。
- 健康接口只返回通用就绪状态，不公开 Provider、费用、表名或知识库规模。

## 项目状态

项目已经完成生产部署，个人独立站、数字分身、管理后台和私密内容访问均已进入运行状态。当前仍持续完善监控、备份恢复、边缘限流和外部服务验收。

详细设计、决策和验收记录：

- [`docs/portfolio-blueprint.md`](docs/portfolio-blueprint.md)：产品需求与决策源
- [`docs/runbooks/production.md`](docs/runbooks/production.md)：生产部署与运维边界
- [`docs/verify/`](docs/verify/)：功能、视觉、评测与发布证据

## 目录

- `app/`：路由、页面入口与全局样式
- `components/`：正式站组件与 CSS Modules
- `content/site-content.json`：页面与 RAG 的唯一公开内容源
- `content/drafts/`：待人工终审内容
- `db/migrations/`：PostgreSQL 与 pgvector 数据结构
- `scripts/`：运行、摄取、评测、测试与视觉检查
- `docs/`：产品决策、运行手册和验收记录
- `prototype/`：冻结的静态原型，仅供参照
