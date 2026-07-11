# Revolution

数字生命摩斯个人作品集正式站。项目使用 Next.js App Router + TypeScript，样式采用 CSS Modules 与全局设计 token。

## 当前状态

- S3 滚动叙事、系统展厅、杠杆账本与简历模式已完成。
- S4 本地统计管线已完成，真实数字来自 `content/stats.json`。
- S5 安全内容基线已完成：关于、FAQ、内容缺口台账和联系占位已经上线到站点内容。
- `content/drafts/` 仍是待摩斯终审的草稿，未终审内容不得导入线上内容。
- S6 上线前验收、Lighthouse、部署和域名操作尚未执行。

## 本地运行

```powershell
npm ci
npm run dev
```

开发服务默认位于 `http://localhost:3000`。

## 验证

```powershell
npm test
npm run build
```

UI 改动还需检查 1440 与 390 双宽、浏览器控制台、横向溢出和 `prefers-reduced-motion`。Lighthouse 性能分数需在上线前达到 90 以上。

## 目录

- `app/`：路由、页面入口与全局样式
- `components/`：正式站组件与 CSS Modules
- `content/s3-content.json`：当前站点公开内容
- `content/drafts/`：待人工终审内容，不直接上线
- `scripts/`：统计、测试与视觉冒烟脚本
- `docs/portfolio-blueprint.md`：唯一需求源
- `docs/task-center/`：阶段状态与交接记录
- `prototype/`：冻结的静态原型，仅供参照

## 内容边界

- 缺失事实进入“内容缺口台账”，不补造联系方式、履历或量化效果。
- 真实数字必须来自可追溯的数据管线；占位内容必须明确标注状态。
- 不引入外部运行时字体、脚本或 CDN 资源。
- 不自动 push 或部署。
