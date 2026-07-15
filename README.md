# Revolution

数字生命摩斯个人作品集正式站。项目使用 Next.js App Router + TypeScript，样式采用 CSS Modules 与全局设计 token。

## 当前状态

- S3 滚动叙事、系统展厅、杠杆账本与简历模式已完成。
- S4 本地统计管线已完成，真实数字来自 `content/stats.json`。
- S5 安全内容基线已完成；S7 已将内容缺口和联系占位退出 live 页面。
- `content/drafts/` 仍是待摩斯终审的草稿，未终审内容不得导入线上内容。
- S6 上线前验收已完成：测试、生产构建、1440/390 双宽、触控、减弱动画、简历打印与 Lighthouse 均已通过。
- S7 多页作品集已完成：首页、作品索引、四个项目案例、共享导航/页脚/简历入口和唯一公开内容源均已进入正式站。
- S8 智能客服文字对话闭环已完成并进入 `origin/master`：三类访客意图、失败补偿、幂等重放、公开来源、可恢复重试、双宽浏览器验证和分层评测均已通过。
- S9 Morse 作品集重设计已完成并进入 `origin/master`：首页以 `Morse` 为主身份，作品集改为四项目单页折叠，企业内部项目只保留脱敏文字案例；全视口首屏、1440/390 双宽、减弱动画和 Lighthouse 门禁均已通过。
- M3-RAG 基础能力继续复用短期邀请码、PostgreSQL + pgvector、OpenAI 适配层、SSE、短期会话和费用门；本地 BGE 语义向量已接入。S8 的 3 次正式 `runChat` 未完成，真实 Provider 证据保持 `BLOCKED`，不能由 Mock 替代。
- 部署和域名操作尚未执行，仍由摩斯决定并操作。

## 本地运行

```powershell
npm ci
npm run dev
```

开发服务默认位于 `http://localhost:3000`。

## M3-RAG 本地运行

先按 `.env.example` 准备 `.env.local`。`OPENAI_CHAT_MODEL` 使用 API 项目实际可用的模型 ID；费用单价必须按所选模型当前价格填写，不能把 ChatGPT/Codex 订阅当作 API 额度。

Chat 与 Embeddings 可使用不同的 base URL 和密钥。本地 Embeddings 服务复用现有 Python 环境中的 `torch`、`sentence-transformers` 和 `numpy`，首次启动只下载 `BAAI/bge-small-zh-v1.5`：

```powershell
$env:MORSE_EMBEDDING_DEVICE = 'auto'
E:\AI\Python\python.exe scripts\local-embedding-server.py
```

服务只监听 `127.0.0.1:18091`。`auto` 仅在当前 PyTorch 支持 CUDA 时使用显卡，否则明确降级为 CPU；可通过 `http://127.0.0.1:18091/health` 核对实际设备。若本机无法直连 Hugging Face，首次下载可临时设置 `HF_ENDPOINT=https://hf-mirror.com`，模型进入本地缓存后不再依赖镜像运行。

```powershell
npm run db:up
$env:DATABASE_URL = 'postgresql://revolution@127.0.0.1:55432/revolution'
npm run db:migrate
npm run knowledge:ingest
npm run rag:eval
npm run dev
```

创建一个 72 小时、最多 3 个会话的短期码。脚本只保存哈希，也不会回显邀请码：

```powershell
$env:MORSE_NEW_INVITE_CODE = Read-Host '输入短期邀请码'
npm run invite:create -- --label '2026-07 activity' --hours 72 --max-sessions 3
Remove-Item Env:MORSE_NEW_INVITE_CODE
```

定期清理过期短期会话：

```powershell
npm run session:cleanup
```

`MORSE_ALLOW_TEST_EMBEDDINGS=true` 只用于本地 pgvector 集成验证，生产环境禁止开启。它能验证迁移、摄取、幂等和 top-k 查询，但不能作为语义召回质量证据。

当前受控访问、低并发和小规模知识库继续使用 PostgreSQL + pgvector，不额外部署 Milvus/Qdrant。只有基准测试证明检索延迟或写入吞吐不达标，或出现独立扩缩容、多租户强隔离、专用混合检索需求时，才评估外置向量库。

## 验证

```powershell
npm test
npm run chat:eval
npm run rag:eval
npm run build
```

UI 改动还需检查 1440 与 390 双宽、浏览器控制台、横向溢出和 `prefers-reduced-motion`。Lighthouse 性能分数需在上线前达到 90 以上。

S6 最终验收证据位于 `docs/verify/v1/s6-*`；桌面 Lighthouse 性能分数为 100。
S8 最终验收与真实/Mock 证据边界位于 `docs/verify/s8/s8-closeout.md`。
S9 最终验收、公开内容边界与主线吸收记录位于 `docs/verify/s9/s9-closeout.md`。

## 目录

- `app/`：路由、页面入口与全局样式
- `components/`：正式站组件与 CSS Modules
- `content/site-content.json`：当前页面与 RAG 的唯一公开内容源
- `content/drafts/`：待人工终审内容，不直接上线
- `scripts/`：统计、测试与视觉冒烟脚本
- `db/migrations/`：M3-RAG PostgreSQL + pgvector schema
- `docs/portfolio-blueprint.md`：唯一需求源
- `docs/task-center/`：阶段状态与交接记录
- `prototype/`：冻结的静态原型，仅供参照

## 内容边界

- 缺失事实进入“内容缺口台账”，不补造联系方式、履历或量化效果。
- 真实数字必须来自可追溯的数据管线；占位内容必须明确标注状态。
- 不引入外部运行时字体、脚本或 CDN 资源。
- 不自动 push 或部署。
