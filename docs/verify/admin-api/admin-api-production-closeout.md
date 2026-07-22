# Admin API Management Production Closeout

## Outcome

- 日期：2026-07-22
- 模式：`STAGED / CRITICAL / DEPLOYED`
- 状态：`PRODUCTION_OBSERVED / LIMITED_LAUNCH`
- 功能提交：`299289c`；merge commit：`d8d1fa2`；来源显示修复与当前生产 release：`292a24b`。本文件所在知识收口提交晚于运行 release，不改变生产镜像。
- 生产路径：`/opt/revolution/releases/292a24b/revolution`
- 冻结归档 SHA-256：`f3ad7526d74f4eeb072ca7e6abc44b562bc3f90f32bd16658ec6695efd4b1af9`

## Data And Security

- migration `001`-`004` checksum 完整；`004` 为 `4003b42c5b240fc0d56cb05ae7a6b32dcb83cdcd62316644072fc319dfe2f17a`。
- `deploy/postgres/verify-ai-config-runtime.sql` PASS；migration 角色为非超级用户、无 create role/database 与 bypass RLS 权限。
- Provider 配置主密钥文件为 `0600 / 1001:1001`，只挂载给 Web；Worker、Migration、Ingest 和 Edge 均不可见。
- 配置表发布后计数为 connections `0`、models `0`、route revisions `0`、runtime state `1`、events `0`；当前 Chat 继续使用只读环境目标。
- migration 前数据库备份：`/opt/revolution/shared/backups/pre-68c114c-20260722T014946Z.dump`，SHA-256 `5069ee6c3c8c7888a16b455cb8c91ef0d274f6ba32fd258c805963d129597675`；生产环境文件另有受限备份。旧 releases、数据库备份和持久卷保留。

## Verification

- 本地全量测试 `769/769`、0 fail、0 skip；`npm run build` 生成 30 个静态/动态页面与 API 路由。受控 production-build 浏览器 smoke 在 1440x900 与 390x844 均确认中转主机名可见、无横向溢出，console/page error 与外部请求均为 0。
- 生产构建完成；migration 幂等复验通过，连续两次 ingest 均为 0 更新、40 documents 跳过。
- 公网 live、ready、root、works、`/admin`、`/admin/api` 均为 HTTP 200；未登录 Provider 列表、runtime 与 events API 均为 HTTP 401。
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` 返回 `{"ok":true}`。
- DB、Embedding、Web 为 healthy，Worker 与 Edge 为 running；DB、Web、Worker、Edge restart count 均为 0，发布后 Web/Worker/Edge 错误关键词计数均为 0。
- 当前主线路、环境备用和数据库动态活动线路都返回并显示脱敏 `endpointHost`；数据库线路按不可变模型版本读取对应连接版本。回归测试确认响应不包含 Key、Authorization、Base URL 路径或查询参数。
- 生产 `npm ci` 报告 1 个 moderate、2 个 high dependency advisory；本轮未执行未经评估的自动修复，保留为有限发布余项。

## Boundary

- 本轮没有读取生产管理员密码，没有创建、发现、测试、激活、回退或删除数据库 Provider 配置，没有调用真实 Chat、Bocha 或 Feishu Provider。
- 生产发布证明代码、schema、权限、Secret 隔离、公开入口和未认证边界已上线；本地认证态双宽证据证明来源展示，不证明已使用生产管理员 Session 观察真实环境主机名。
- 私密简历继续保持 disabled-first；未上传 PDF、创建邀请码、轮换密钥或清理旧 release/持久卷。
