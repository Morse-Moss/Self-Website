# Revolution — 数字生命摩斯 · 作品集项目根

## 目录约定
- `docs/` — 需求与决策文档。`docs/portfolio-blueprint.md` 是唯一需求源,所有开发以它为准;`docs/verify/` 为验收证据
- `prototype/` — 静态 UI 原型 v0.1(**已冻结,只读参照,不再迭代**)
- 正式站(Next.js)在本根:`app/`(路由与全局样式)、`components/`(组件)、`public/`(静态资源)、`scripts/`(构建期脚本)、`content/`(站点内容;`content/drafts/` 为待摩斯终审的草稿,未终审不得上线)

## 正式站约束
- 技术栈:Next.js(App Router)+ TypeScript;不用 Tailwind,样式用 CSS Modules + 全局 token
- 设计 token 只在 `app/styles/tokens.css` 定义(源自原型,唯一 token 源);组件样式禁用裸色值
- 禁外部运行时资源:字体/脚本自托管,无 CDN 引用;文案中的外链(GitHub 等)允许
- 占位与真实分明:占位内容必须带「示例数据 / 筹备中」标注;真实数字必须可溯源(数据管线产出)
- `prefers-reduced-motion` 下无持续动画;移动端动画轻量化
- 数字人区域组件化:视频源为配置项,素材就绪仅替换资源文件

## 验证标准
- `npm run build` 必过;`npm run dev` 冒烟
- 1440 与 390 双宽各过一轮,控制台零报错
- Lighthouse 性能 ≥ 90(上线前验收)

## 生产运行边界
- `docs/runbooks/production.md` 是平台无关的生产合同,`docs/runbooks/tencent-lighthouse.md` 是当前腾讯云实例运行源;2026-07-20 已到 `PRODUCTION_OBSERVED / LIMITED_LAUNCH`,但不得写成已完成全部 `ONLINE_READY` 硬化
- 同一 Node 24 非 root 应用镜像提供 Web、Worker、Migration、Ingest 四个显式角色;Node 镜像不包含 PostgreSQL、BGE、TLS edge 或托管备份
- `/api/health/live` 无依赖;`/api/health/ready` 与 `/api/health` 只返回通用 `{ ok }`,并要求配置、数据库、migration checksum 与公开知识就绪
- 当前生产 Web release 为 `44ed094`,域名为 `aimorse.tech`;首页 Warp Tunnel 已完成生产双宽观察,生产 Lighthouse 移动端与桌面端 Performance 均为 99;管理员使用密码登录并可管理邀请码,私有导出时重新输入密码;五项目页面统一使用“项目负责人”并保留独立完成全部技术实现口径,五张正式主图均已上线;生产 RAG 为 40 documents / 47 chunks,46/46 gold 进入 top-3;其余工作区改动不属于生产,再次部署、push、清理旧 release 或远端安全配置变更仍需明确授权
- 生产数据库 001/002 migration 与 checksum 已验证;历史长期本地主库的 checksum 漂移仍是本地边界,未经明确破坏性授权不得改登记或重建

## 红线
- git:本地 init/commit 已授权(2026-07-08);push 仅跨设备同步且等摩斯指令;不自动部署
- 依赖安装仅限阶段契约列明的包
- `E:\Wiki`、`E:\demo2`、`E:\小红书`、`E:\多agent` 为外部资产,只读,禁止写入
- 密钥、token、密码不进代码
