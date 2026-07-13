# S7 多页作品集垂直切片

> 启动日期:2026-07-13
> 分支:`codex/s7-multipage-portfolio`
> Profile:`STANDARD`
> Delivery priority:视觉质量 + 真实证据优先

## Outcome

把旧单页 S6 重构为一个可运行、可扩展的多页作品集垂直切片。首轮完整打通首页、作品目录和自动运营案例页,并让另外三个项目通过同一内容与页面结构拥有可达的站内案例。

## Definition of Done

- `/` 首屏 H1 为“数字生命摩斯”,具体说明摩斯是 Agent 系统开发者,且首屏底部露出作品内容。
- `/works` 只展示四个真实项目:内容创作 Agent 系统、自动运营 Agent 系统、深度研究 Agent 系统、数字摩斯。
- `/works/content-agent`、`/works/auto-operations`、`/works/deep-research`、`/works/digital-morse` 均可达,并按“问题、我的角色、关键判断、真实结构、验证证据、当前边界”组织案例。
- 全局 Header、Footer、简历入口和数字摩斯在六个公开路由均可达。
- 内容创作 Agent 系统只提供站内案例,不提供公开外链。
- 自动运营 Agent 系统的“访问系统”精确指向 `https://aitavix.com`。
- 深度研究 Agent 系统的 GitHub 精确指向 `https://github.com/Morse-Moss/Deep-research-sys`。
- 数字摩斯的 GitHub 精确指向 `https://github.com/Morse-Moss/Self-Website`。
- 自动运营案例只使用裁剪或脱敏后的真实 Railway 登录页截图;公开版本只能进入 `public/works/auto-operations/`,原始截图不进入 `public/`。
- `content/site-content.json` 是 S7 页面与 RAG 的唯一新运行时公开源;旧 `content/s3-content.json` 只保留、不删除,且不再被 S7 页面、RAG 或知识摄取入口引用。
- `MorseChat` 由共享站点壳挂载一次,在所有页面可达;现有访问码、RAG、SSE、来源、短期会话和预算行为不回归。
- 对话空态提供“招人的 / 找人做事的 / 同行交流”三个快捷入口;只预填问题并选择现有模式,不自动调用 Provider。
- 公开页面不出现示例数字、假联系方式、生成 UI、内容缺口台账、内部路径、公司/客户/账号/Provider 信息。
- `content/drafts/**` 不进入页面或 RAG 索引。
- 新行为先有失败测试;阶段结束 `npm test`、`npm run build`、`git diff --check` 通过。
- 1440 与 390 视口完成首页、作品目录、案例页、导航和聊天入口验收;控制台零 error/warn、无横向溢出;`prefers-reduced-motion` 无持续动画。

## Allowed Scope

- `app/**` 页面、布局、全局样式与 token
- `components/**` 共享站点壳、作品组件、案例组件与现有聊天 UI
- `content/site-content.json` 及公开内容读取 helper
- `lib/server/public-knowledge.ts` 与知识摄取入口的内容源迁移
- `public/works/auto-operations/**` 脱敏真实截图
- `tests/**`、`scripts/site-content.test.mjs` 与 S7 浏览器验收脚本
- `docs/portfolio-blueprint.md`、`docs/research/portfolio-reference-analysis-2026-07-13.md`、`docs/research/project-evidence-matrix-2026-07-13.md`
- `docs/task-center/**`、`docs/superpowers/plans/**`、`docs/verify/s7/**`

## Forbidden Scope

- 不改 `db/**`、访问控制、费用门、Provider 请求、Embedding/RAG 查询算法和现有 API 协议。
- 不读取或上线 `content/drafts/**`。
- 不改写 `E:\Wiki`、`E:\demo2`、`E:\小红书`、`E:\多agent`。
- 零新增依赖;不调用 Provider,不部署,不绑定域名,不 push,不创建 PR。
- 不修改数据库 schema;不删除旧文件。旧 S3 文件只停止新的运行时与公开知识路径引用,清理另行授权。
- 不执行知识库重摄取或其他持久化数据写入;本阶段用纯函数和内容契约测试证明 RAG 来源迁移。
- 不生成数字人、假系统截图或作品证据图。
- `AGENTS.md`、`output/**`、`docs/verify/concepts/**` 和旧临时脚本不 stage。

## Non-goals

- 语音、TTS、口型、数字人形象、联网搜索 Agent。
- 深度研究试驾回放。
- Milvus/Qdrant 或数据库迁移。
- 公开业务效果数字和完整简历终审。
- S7 首轮之外的视觉扩写与部署。

## Verification

- Focused:`node --test scripts/site-content.test.mjs tests/public-knowledge.test.ts tests/chat-ui-contract.test.ts`
- Adjacent:`npm test`
- Stage exit:`npm run build`;`git diff --check`;本地生产构建 1440/390 浏览器验收;Lighthouse 性能不低于 90。

## Review

- Combined independent reviewer at stage exit。
- 最多 2 个 correction cycles;修复后只做 finding delta re-review。
- Controller 必须亲自检查最终桌面和移动截图,reviewer 报告不能替代视觉验收。

## Approvals

- 本地分支与本地 commit 已授权。
- 新依赖、额外 worktree、删除、Provider、部署、push、PR 均需摩斯另行授权。

## Current Result

ACTIVE; implementation not started
