# 私密简历本地里程碑 Closeout

## Outcome

- 日期：2026-07-21
- 模式：`STAGED / CRITICAL / LOCAL`
- 状态：`LOCAL_READY / NOT_PUSHED / NOT_MERGED / NOT_DEPLOYED`
- 分支：`codex/private-resume-access`
- 基线：`8e3d4df`
- 实现与安全门禁已提交至：`f4cb64b test: prove private resume isolation`
- Task 11 验收脚本与知识收口：由包含本文的最终本地提交交付

Task 1-11 已在专用 worktree 完成本地开发。生产 release 仍为不含私密简历的 `b6ddad5`；本里程碑没有修改生产、上传真实 PDF、创建真实邀请码、调用 Chat/Search/Embedding Provider、push 或合并主线。

## Delivered Contract

- 简历授权与聊天/管理员授权使用独立 Cookie、邀请码、Session、滥用 scope 和数据库表。
- 邀请码 7 天内一次性兑换；简历 Session 最长 72 小时；停用邀请后关联 Session 下一次请求立即失效。
- 当前 PDF 使用 AES-256-GCM 密文封装、原子写入、SHA-256/认证标签/PDF 头校验；生产密钥只允许文件型 Secret。
- 管理员可上传唯一当前 PDF、创建/停用简历邀请码并查看受控审计元数据；真实正文和邀请码明文不进入持久化证据。
- 原始访问审计保留 30 天；Worker 清理过期授权、审计和确认无引用的旧密文，并对失败写入 `storage_recovery`。
- Chat、RAG、Embedding、Search、JD、公开知识、浏览器构建产物和运行镜像均不得读取或携带私密简历。
- 四阶段密钥轮换支持 `prepare / activate / rollback / finalize`，并处理提交确认丢失和清理失败。

## Verification Receipt

- `npm test`：`702/702` PASS，0 fail，0 skip。
- `npm run build`：PASS，25 个页面/路由生成完成。
- 私密简历隔离套件：`86/86` PASS；最终运行镜像 rootfs 扫描 18,436 个文件，无 Secret canary、PDF 起始字节、私密标记、`.env*`、`.morsepdf` 或有数据的私密目录命中。
- `node scripts/private-resume-visual-smoke.mjs http://127.0.0.1:3010`：`27/27` PASS，内含 fresh 本地 production service 和真实 `npm run release:smoke`。
- 浏览器覆盖 1440x900 与 390x844：锁定、无效码、兑换、授权文件、退出、过期、撤销、无文档、管理员上传、邀请码创建/停用、溢出和最小 44px 控件全部通过。
- 浏览器 `consoleErrors=0`、`pageErrors=0`、意外外部 origin 为 0、横向溢出为 0；锁定状态截图人工检查无重叠或裁切，未捕获 PDF 画面。
- 授权文件响应：HTTP 200、`application/pdf`、`private, no-store`、`nosniff`、inline disposition；退出/过期/撤销后的文件请求均拒绝。
- migration `003_private_resume.sql` 规范化 SHA-256：`6acd5ca32728e6c7ee962d7e8a91beaca52dba36efaa0ad4e96fb9cb3aad3ee7`。
- 一次性数据库、测试密钥、合成 PDF、浏览器 profile、Next 进程和本地监听均已清理。

## Review Verdict

- 合规审查：PASS。产品规则、独立授权域、无真实数据、无外部调用、Secret/构建/镜像隔离和 disabled-first 发布边界无 blocker。
- 质量与安全审查：PASS。事务回滚、并发一次性兑换、文件恢复、密钥轮换、请求限制、统一错误、Cookie/Origin、保留期、移动端状态和测试真实性无开放 blocker。
- 非本次 blocker：镜像依赖安装报告 2 个既有 moderate advisory；未执行未经评估的自动修复。

## Codex 崩溃与接管结论

前两条接力任务的直接故障均发生在本机中转的上游账号路由：可用账号先后返回模型不可用、并发/限流或 502，SSE 在 `response.completed` 前断开，最终没有健康账号可切换。两条任务都没有耗尽上下文窗口；长历史只放大请求体、延迟和重试成本，不是直接根因。

后续按以下规则防止第三次重复：一个 Codex 任务只承载一个里程碑；每个里程碑以 worktree、分支、HEAD、Task 号和 VerificationReceipt 交接；首次出现同类 502 后停止重试旧任务；审查只携带 StagePacket、Git range 和必要证据，不复用跨项目长历史。

## External Authorization Gate

以下动作尚未授权且均未执行：

1. 将 `codex/private-resume-access` 吸收最新 `origin/master`，解决当前分支落后 1 个提交的关系。
2. push 私密简历分支或更新远端主线。
3. 生成并校验生产数据库备份，创建私密卷和部署 Secret。
4. 发布冻结提交，执行 migration `003` 与 runtime grants，并先以 `MORSE_RESUME_ENABLED=false` 观察。
5. 启用私密简历、重启 Web/Worker并完成公网锁定入口、健康和安全头观察。
6. 通过 `/admin` 上传真实最终 PDF。
7. 创建、传递或兑换真实简历邀请码。
8. 执行生产密钥轮换、恢复演练或任何清理旧 release/卷/密钥的破坏性动作。

回滚顺序：先关闭 `MORSE_RESUME_ENABLED` 并只重启 Web/Worker；保留 migration `003`、密文卷和 Secret。只有确认旧冻结镜像忽略新增 schema 后才切回 `b6ddad5`，不执行 down migration，不删除私密数据。
