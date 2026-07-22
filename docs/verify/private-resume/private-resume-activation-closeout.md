# Private Resume Activation Closeout

- 日期：2026-07-22
- 模式：`STAGED / CRITICAL / DEPLOYED`
- 状态：`OBSERVED / FEATURE_ENABLED / LIMITED_LAUNCH`
- 生产运行提交：`292a24b fix: show provider endpoint sources`
- 运行路径：`/opt/revolution/releases/292a24b/revolution`

## Scope

本轮没有发布新代码或镜像。变更仅包括启用既有私密简历能力、通过认证后台上传经确认的定向版最终 PDF，以及执行一次创建、兑换、文件核验、停用和失效验证闭环。通用版简历未触碰。

最终 PDF 仅进入生产私有密文卷，不进入 Git、`public/`、RAG、日志、截图或本文档；本文档不记录管理员密码、邀请码明文、Cookie、Session token、加密材料或简历正文。

## Production Actions

1. 确认 `/admin` 管理会话有效，启用前公网状态为 `enabled=false`、`authorized=false`、`documentAvailable=false`，文件接口为 404。
2. 原子备份受限环境文件，并只将 `MORSE_RESUME_ENABLED=false` 改为 `true`；备份路径为 `/opt/revolution/shared/.env.production.bak-resume-20260722T065827Z`，变更后权限保持 `0600 / 1000:1001`。
3. 使用现有 `292a24b` release 强制重建 Web/Worker；DB、Embedding 和 Edge 保持运行。
4. 验证启用但无文件阶段：live/ready 为 HTTP 200，访问状态为 `enabled=true`、`authorized=false`、`documentAvailable=false`，文件接口为 401。
5. 通过认证 `/admin` 上传定向版最终 PDF，未使用 SCP 或公开目录。
6. 创建一次性上线验收码，在独立 HTTP 会话中兑换并读取 PDF；核验完成后立即停用该访问码。

## Verification Receipt

- 上传后未授权 `/api/resume/access` 返回 401，正文为 `enabled=true`、`authorized=false`、`documentAvailable=true`；未授权 `/api/resume/file` 返回 401。
- 独立会话兑换返回 HTTP 200，授权状态为 200；授权文件返回 HTTP 200、299,762 bytes，SHA-256 与本地最终 PDF 一致。
- 文件响应保持 `Content-Type: application/pdf`、`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff` 和内联 disposition。
- 验收码停用后，同一会话的状态与文件接口均返回 401，授权状态为 false。
- 公开首页“简历模式”显示邀请码输入框与“查看简历”，未授权访客看不到 PDF 链接。
- 公网 live/ready 均为 HTTP 200；`MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` 返回 `{"ok":true}`。
- DB、Embedding、Edge、Web、Worker 均为运行状态；Web 为 healthy，Web、Worker、Edge 最近 10 分钟错误关键词计数均为 0。

## Recovery

异常时恢复 `MORSE_RESUME_ENABLED=false`，并使用当前 release 的 `compose.production.yaml` 强制重建 Web/Worker。保留 migration `003`、私有卷、Secret、密文和审计记录；不执行 down migration，不删除 PDF 密文或历史事件。

## Boundary

- 未轮换加密密钥，未执行隔离恢复演练或托管备份。
- 未删除旧 release、持久卷、密文或审计记录。
- 未调用 Chat、Search、Embedding、Bocha、Feishu 或其他真实 Provider。
- 上线验收码已停用，不存在可继续使用的验收 Session；真实访客访问仍需管理员按人创建新码。
