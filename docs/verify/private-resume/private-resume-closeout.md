# 私密简历本地与 disabled-first 生产 Closeout

## Outcome

- 日期：2026-07-21
- 模式：`STAGED / CRITICAL / DEPLOYED`
- 状态：`OBSERVED / FEATURE_DISABLED / LIMITED_LAUNCH`
- 分支：`codex/private-resume-access`
- 生产运行提交：`233a3a5 test: scope works disclosure checks`
- 运行路径：`/opt/revolution/releases/233a3a5/revolution`

Task 1-11 已在专用 worktree 完成本地开发、审查和合成数据验收。`233a3a5` 已进入 `origin/master` 并从精确 Git 归档部署；后续知识收口提交只更新文档，不改变生产运行 release。

本轮只完成 disabled-first 基础设施与代码发布。`MORSE_RESUME_ENABLED=false`，没有上传真实 PDF、创建或兑换真实简历邀请码，也没有调用 Chat/Search/Embedding Provider。

## Delivered Contract

- 简历授权与聊天/管理员授权使用独立 Cookie、邀请码、Session、滥用 scope 和数据库表。
- 邀请码 7 天内一次性兑换；简历 Session 最长 72 小时；停用邀请后关联 Session 下一次请求立即失效。
- 当前 PDF 使用 AES-256-GCM 密文封装、原子写入、SHA-256/认证标签/PDF 头校验；生产密钥只允许文件型 Secret。
- 管理员可上传唯一当前 PDF、创建/停用简历邀请码并查看受控审计元数据；真实正文和邀请码明文不进入持久化证据。
- 原始访问审计保留 30 天；Worker 清理过期授权、审计和确认无引用的旧密文，并对失败写入 `storage_recovery`。
- Chat、RAG、Embedding、Search、JD、公开知识、浏览器构建产物和运行镜像均不得读取或携带私密简历。
- 四阶段密钥轮换支持 `prepare / activate / rollback / finalize`，并处理提交确认丢失和清理失败。

## Local Verification Receipt

- failure-first 回归修复后 focused suite：`24/24` PASS。
- `npm test`：`703/703` PASS，0 fail，0 skip。
- `npm run build`：PASS，25 个页面/路由生成完成。
- 私密简历隔离套件：`86/86` PASS；最终运行镜像 rootfs 扫描 18,436 个文件，无 Secret canary、PDF 起始字节、私密标记、`.env*`、`.morsepdf` 或有数据的私密目录命中。
- `node scripts/private-resume-visual-smoke.mjs http://127.0.0.1:3010`：`27/27` PASS，覆盖 1440x900 与 390x844 的锁定、无效码、兑换、文件、退出、过期、撤销、无文档、管理员上传和邀请码管理。
- migration `003_private_resume.sql` 规范化 SHA-256：`6acd5ca32728e6c7ee962d7e8a91beaca52dba36efaa0ad4e96fb9cb3aad3ee7`。

## Production Verification Receipt

- Git：`origin/master` 与 `origin/codex/private-resume-access` 在部署时均为 `233a3a51271a061932e37961057ba446ea05102c`。
- 冻结归档：17,132,692 bytes；本地与远端 SHA-256 均为 `580651def3c19bc66ca8e7f215ba9ea4f0dfcdcb585b9c8482e0a331f158df7e`。
- migration 前数据库备份：`/opt/revolution/shared/backups/pre-75f621a-20260721T101836Z.dump`，195,999 bytes，SHA-256 `488b4af882e679cbb434cf86d31cbb3c34b9d4e7e20909d01de06a982333f588`；环境备份与旧 releases 保留。
- 生产镜像构建 PASS，Next.js 生成 25 routes；migration 幂等复验显示 current through `003`，runtime grants PASS，migration 角色无超级权限。
- 四张私密表存在且总行数为 0。私有卷权限为 `0700`、owner `1001:1001`；Secret 权限为 `0600`、owner `1001:1001`；Web 可读取 Secret，Worker 不挂载 Secret。
- `/opt/revolution/current`、Web、Worker、Edge working directory 均指向 `233a3a5`；旧 release `75f621a`、更早 release、数据库备份和持久卷均保留。
- 公网 live/ready/root/works/admin 均为 HTTP 200；`release:smoke` 返回 `{"ok":true}`；`/api/resume/file` 为 404，`/api/resume/access` 返回 `enabled=false`、`authorized=false`、`documentAvailable=false`。
- 部署后 `node scripts/s9-visual-smoke.mjs https://aimorse.tech` PASS：1440x900、390x844、390x844 reduced-motion 的五个项目均可展开；旧路由 307 -> 200；failures、console errors、page errors、外部运行时请求和横向溢出均为 0。
- Web、Worker、Edge 发布窗口错误关键词计数均为 0；未发现 `storage_recovery`。

## Review Verdict

- 合规审查：PASS。push 与部署均有用户明确授权；发布只来自冻结 Git 提交；共享根工作区和其他任务 worktree 未改动；Secret、数据库凭据、私密数据和真实邀请码未进入输出或 Git。
- 质量与安全审查：PASS。备份、migration checksum、最小 grants、角色权限、Secret/卷隔离、默认关闭、健康、release smoke、三视口浏览器与日志均有生产证据，无开放 blocker。
- 非本次 blocker：镜像依赖安装报告 2 个既有 moderate advisory；未执行未经评估的自动修复。

## Codex 崩溃与接管结论

前两条接力任务的直接故障均发生在本机中转的上游账号路由：可用账号先后返回模型不可用、并发/限流或 502，SSE 在 `response.completed` 前断开，最终没有健康账号可切换。两条任务都没有耗尽上下文窗口；长历史只放大请求体、延迟和重试成本，不是直接根因。

后续按以下规则防止第三次重复：一个 Codex 任务只承载一个里程碑；每个里程碑以 worktree、分支、HEAD、Task 号和 VerificationReceipt 交接；首次出现同类 502 后停止重试旧任务；审查只携带 StagePacket、Git range 和必要证据，不复用跨项目长历史。

## Remaining Authorization Gates

以下动作未授权且未执行：

1. 设置 `MORSE_RESUME_ENABLED=true` 或重启 Web/Worker 以启用功能。
2. 通过 `/admin` 上传真实最终 PDF。
3. 创建、传递、兑换或停用真实简历邀请码。
4. 执行生产密钥轮换、隔离恢复演练、托管备份或清理旧 release/卷/密钥。

回滚顺序：先确认 `MORSE_RESUME_ENABLED=false` 并只重启 Web/Worker；保留 migration `003`、密文卷和 Secret。当前运行代码异常且 schema 兼容时可切回已观察的 `75f621a`；不执行 down migration，不删除私密数据。
