# Revolution — 数字生命摩斯 · 作品集项目根

## 目录约定
- `docs/` — 需求与决策文档。`docs/portfolio-blueprint.md` 是唯一需求源,所有开发以它为准
- `prototype/` — 纯静态 UI 原型(零依赖、零构建、file:// 直开)
- 正式站(Next.js)未来在本根初始化,届时更新本文件

## 原型硬约束
- 禁止包安装、构建步骤、外部网络资源(字体/脚本/图片全部本地或系统内置;代码中不得出现外部 URL,文案与注释除外)
- 文件所有权三域:`index.html + css/**`(结构与样式)/ `js/lifeform.js`(形体视觉)/ `js/app.js`(交互与 mock 数据)。跨域修改必须先更新接口契约
- 设计 token 只在 `css/tokens.css` 定义;组件样式禁用裸色值
- 所有 mock 数据必须带「示例数据」标注,防止日后被当成真实数字
- 命名:kebab-case 文件名;class 语义化,保持全站一致

## 验证标准
- Edge/Chrome 打开 `prototype/index.html`:控制台零报错
- 1440 宽与 390 宽各过一轮:速览层不滚动可见、简历模式开关可用、分身抽屉可用、形体动画运行或优雅降级
- `prefers-reduced-motion` 下无持续动画

## 红线
- 不自动 git init/commit/push;不部署;不装依赖
- `E:\Wiki`、`E:\demo2`、`E:\小红书`、`E:\多agent` 为本项目外部资产,禁止写入
