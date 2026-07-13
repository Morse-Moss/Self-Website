# Revolution

数字生命摩斯个人作品集正式站。项目使用 Next.js App Router + TypeScript，样式采用 CSS Modules 与全局设计 token。

## 当前状态

- S3 滚动叙事、系统展厅、杠杆账本与简历模式已完成。
- S4 本地统计管线已完成，真实数字来自 `content/stats.json`。
- S5 安全内容基线已完成：关于、FAQ、内容缺口台账和联系占位已经上线到站点内容。
- `content/drafts/` 仍是待摩斯终审的草稿，未终审内容不得导入线上内容。
- S6 上线前验收已完成：测试、生产构建、1440/390 双宽、触控、减弱动画、简历打印与 Lighthouse 均已通过。
- M3-RAG MVP 本地闭环已通过：短期邀请码、PostgreSQL + pgvector、GPT 适配层、流式对话、来源、短期会话和费用门已进入正式站代码；真实 OpenAI 冒烟仍需可达的 API/base URL。
- 部署和域名操作尚未执行，仍由摩斯决定并操作。

## 本地运行

```powershell
npm ci
npm run dev
```

开发服务默认位于 `http://localhost:3000`。

## M3-RAG 本地运行

先按 `.env.example` 准备 `.env.local`。`OPENAI_CHAT_MODEL` 使用 API 项目实际可用的模型 ID；费用单价必须按所选模型当前价格填写，不能把 ChatGPT/Codex 订阅当作 API 额度。

```powershell
npm run db:up
$env:DATABASE_URL = 'postgresql://revolution@127.0.0.1:55432/revolution'
npm run db:migrate
npm run knowledge:ingest
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

## 验证

```powershell
npm test
npm run build
```

UI 改动还需检查 1440 与 390 双宽、浏览器控制台、横向溢出和 `prefers-reduced-motion`。Lighthouse 性能分数需在上线前达到 90 以上。

S6 最终验收证据位于 `docs/verify/v1/s6-*`；桌面 Lighthouse 性能分数为 100。

## 目录

- `app/`：路由、页面入口与全局样式
- `components/`：正式站组件与 CSS Modules
- `content/s3-content.json`：当前站点公开内容
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
