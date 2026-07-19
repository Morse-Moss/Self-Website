# S10 管理员邀请码管理本地验收账本

> 日期：2026-07-19
> 状态：`LOCAL_READY / AWAITING_MAINLINE_ABSORPTION`
> Worktree：`E:\Revolution\.worktrees\admin-invite-management`
> 分支：`codex/admin-invite-management`
> 基线：`master@1211252`
> 功能提交：`50a7663 feat: add admin invite management`

## 用户入口与行为

- 管理员固定从 `/admin` 进入；入口不出现在公开导航，但安全不依赖隐藏 URL。
- 使用独立管理员密码和 TOTP 登录后，顶部“邀请码”打开管理工具。
- 管理员可填写名称、有效小时数和最大会话数，并用新的 6 位 TOTP 生成邀请码；创建后可复制一次性明文。
- 列表展示有效、已过期、已耗尽和已停用状态，以及有效期和会话用量；停用有二次确认。
- 停用只阻止新兑换，已登录 HR 的 Session 和后续聊天保持可用。

## 服务端与安全边界

- 新增 `GET /api/admin/invites`、`POST /api/admin/invites` 和 `PATCH /api/admin/invites/[inviteId]`。
- 读取需要有效管理员 Session；创建需要 Session、精确 Origin 和未使用的 fresh TOTP；停用需要 Session 与精确 Origin。
- 邀请码由服务端生成，格式为 `morse_` + 24 字节随机值的 Base64URL 表示，即 192-bit 随机熵。
- 数据库只保存 SHA-256。明文只存在于创建响应和当前前端内存，关闭工具后清空且不可恢复。
- 没有 schema migration、没有新增依赖，也没有改变既有邀请码兑换表结构。

## 验证证据

- Focused tests：77/77 PASS，覆盖输入边界、管理员认证、Origin、fresh TOTP、防重放、哈希存储、状态派生、停用语义和 UI 合同。
- `npm run build`：PASS；Next.js 已收录新增管理 API 路由。
- 最终 `npm run visual:s10` Mock E2E：20 个场景全部 PASS。
- 视口：1440x900、390x844；横向溢出、console error、page error 均为 0。
- 本地 ignored 截图：`tmp/admin-invite-e2e-final/s10-admin-invites-desktop-1440x900.png`、`tmp/admin-invite-e2e-final/s10-admin-invites-mobile-390x844.png`。
- 全量测试：568 total / 506 pass / 7 fail / 55 skip。7 个失败与进入 worktree 时的基线完全相同：6 个作品集精简线合同漂移，1 个因本 worktree 没有 `.env.local` 而缺少 `DATABASE_URL`；本轮没有新增全量回归失败。
- 合规审计与质量/安全审计均 PASS，开放 blocker 为 0。

## 交付边界

- 一次性数据库已销毁；`.next/`、`node_modules/`、`tmp/` 均受 Git ignore 保护。
- 本轮没有读取或修改生产密钥，没有生成生产邀请码，没有调用真实 Provider。
- 功能提交尚未进入 `master`，未 push、未部署。当前腾讯云 release `b15be68` 的 `/admin` 仍只有既有复盘、badcase 和导出能力。
- 只有在主线吸收并部署冻结 release 后，才能按 `docs/runbooks/tencent-lighthouse.md` 将生产邀请码管理标记为已观察。
