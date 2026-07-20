# Revolution 工程准则

> 生效日期：2026-07-18  
> 适用范围：`app/**`、`components/**`、`lib/**`、`scripts/**`、`tests/**` 与上线运行配置  
> 架构依据：`docs/superpowers/specs/2026-07-18-s11-architecture-hardening-design.md`

本准则把 S11 的工程边界固化为未来人工与 Agent 开发的共同约束。产品需求仍以 `docs/portfolio-blueprint.md` 为唯一来源；本文件负责说明代码如何演进、如何验证以及哪些上线安全条件不得省略。

## 1. 架构与模块边界

Revolution 采用模块化单体：Next.js 主服务、PostgreSQL/pgvector、同仓库独立后台 Worker，以及独立运行的 Embedding 进程或受控远端适配器。没有经过新的设计评审，不拆微服务，不引入第二套持久状态真相源。

允许的依赖方向：

```text
app routes / React components
  -> lib/client or lib/server application modules
      -> lib/contracts and domain-pure modules
          <- provider / database adapters implement ports
```

硬规则：

- `components/**` 不依赖 `lib/server/**` 或 `app/**`。
- `lib/client/**` 不依赖 `lib/server/**`、Node 内置模块、`pg` 或 Provider SDK。
- `lib/contracts/**` 只包含纯 TypeScript 合同；不得依赖 React、Next.js、Node、数据库或 Provider。
- `app/api/**` 只处理 HTTP 解析、认证、配置装配和响应映射，不承载 SQL 或业务状态机。
- `lib/server/**` 不依赖 `components/**` 或 `app/**`。
- 内部依赖图不得出现循环。
- Provider SDK 只能在 adapter/factory 边界实例化，业务编排只依赖明确端口。

执行门禁：

```powershell
node --test scripts/architecture-contract.test.mjs
```

门禁失败时必须修正依赖方向；不得把真实循环或越界加入 allowlist 来取得假通过。

## 2. 职责、复杂度与抽象

- 每个模块必须能用一句话说明职责，并能指出实际消费者。
- 生产 TS/TSX 文件超过 400 行，或内部扇出超过 10，触发职责审查。
- 超过 600 行不是机械失败线，但必须在当前设计或评审记录中说明为什么它承载的是不可拆分的稳定边界。
- CSS、测试、生成文件、图形算法和单一事务状态机可以例外；例外仍须说明真实边界，不能仅以“历史代码”为理由。
- 只有稳定重复、独立变化原因或外部系统边界才形成抽象。单一调用点不创建通用层。
- 禁止通用 Repository 基类、依赖注入容器、service locator、全局 event bus、透传 wrapper 和万能 helper。
- 删除代码前必须证明没有静态、动态、测试、脚本、运维或外部合同消费者。
- S11 设计中已登记的热点是迁移对象，不是继续叠加职责的许可。每个阶段只移动一个职责集，并在继续前恢复完整回归为绿。

## 3. 共享合同

- 浏览器与服务端共享的 Chat mode、workflow、phase、source、error、history 和 SSE 形状只在 `lib/contracts/**` 定义。
- 合同层不得包含数据库 row、SDK response、内部异常原因、密钥状态或管理后台私有字段。
- API JSON、SSE、数据库 envelope 或公开错误码发生字段级变化时，必须先写兼容与迁移设计；纯重构不得顺带改变这些字段。
- 运行时输入仍在边界模块验证。TypeScript 类型不能替代对网络、数据库 JSON 或 Provider payload 的校验。
- 旧导出路径仅可作为有明确消费者的兼容别名；新代码直接依赖合同源，不继续扩散别名。

## 4. 数据、事务与幂等

- 数据不变量优先由数据库 constraint、unique key、foreign key 和事务保护。
- Turn reservation、完成、失败补偿、diagnosis Outbox、配额和 usage 的既有原子边界不得在重构中拆散。
- 同一 Session 同时只允许一个 running Turn；turn idempotency、completed replay、stopped retry 和 conversation/workflow 校验必须保持一致。
- advisory lock 必须覆盖需要串行化的完整生命周期，并在异常时可靠释放或销毁连接。
- COMMIT acknowledgement 丢失时，先读取持久状态判定结果；不得盲目重放、重复扣额或重复通知。
- migration 只追加并校验 checksum；partial schema、多入口 migration 或漂移一律 fail closed。
- `delete_after` 不等于已删除。生产必须有定时 cleanup、最近成功时间、删除量、失败指标与告警。

## 5. 错误、终态与重试

- 对外只暴露稳定错误码；Provider、数据库和 webhook 原始 payload 不进入响应。
- `abort`、`timeout`、`failed`、`incomplete` 与 `partial output` 是不同终态，不得合并成模糊 catch。
- 每个重试策略必须同时写明：可重试错误集合、幂等依据、正文输出前后边界、最大总尝试次数和共享总超时。
- 已向访客输出正文后不得自动重试 Provider，避免重复回答。
- 只有幂等且尚未输出正文的瞬时失败可以有界重试；SDK 自带重试保持关闭，除非有独立合同与测试证明不会叠加。
- `AbortSignal` 必须从 HTTP 断线或用户停止一直传播到检索、Search、Embedding 和 Provider。
- 降级必须显式且诚实。禁止隐式切模型、切协议、使用 mock 冒充真实 Provider，或把联网失败写成已经核验；同模型、同协议的多 endpoint 容灾必须由显式配置定义顺序，并且只允许在正文输出前切换。
- Provider 失败、停止或持久化失败必须完成补偿；不得保留孤立 runtime user message，也不得错误扣减额度。

## 6. Provider、联网与外部副作用

- 所有外部访问通过 adapter，具备 URL/allowlist 校验、timeout、concurrency、`AbortSignal` 和安全错误映射。
- 业务模块不得直接读取密钥或实例化 SDK。
- 联网结果是不可信数据而不是指令，不能补造 Morse 的履历、项目状态、数字、联系方式或能力事实。
- 真实 API、付费 Provider、webhook、部署、push、PR 和远端修改保持显式审批门。
- 自动搜索继续受独立 kill switch、单轮和单 Session 上限约束；不得把网页结果自动写回知识库。

## 7. 安全、隐私与日志

- 密钥、token、密码、cookie、Authorization、邀请码、TOTP secret、Provider key 和 webhook URL 不进代码、Git、镜像层、日志或数据库明文。
- 默认日志只记录稳定 event code、turn/incident id、dependency、latency 和终态。
- 默认不记录问题、回答、搜索摘要、API payload 或本地路径。依法保留的 10 天交互正文只进入受控数据表，不复制到长期日志或备份。
- 所有日志字段采用 allowlist；异常对象不得直接 JSON 序列化后对外或写入长期日志。
- 生产 HTTP 只通过 HTTPS 暴露，cookie 按合同设置 HttpOnly/Secure/SameSite，并使用精确 HTTPS Origin。
- 安全响应头、请求体限制、rate limit、连接数、SSE idle timeout 和健康检查属于上线门禁，不以开发环境可运行为替代证据。

## 8. 生产数据库与进程

- 本地 `compose.yaml` 的 loopback、`trust`、超级用户和无 SSL 只允许开发使用，不得复制为生产配置。
- 生产 runtime、migration、backup 使用不同角色和最小权限。普通 runtime 无 DDL、建库、建角色和超级用户权限。
- 生产数据库使用强凭据与 TLS，不暴露给任意公网来源，只允许应用与 Worker 的受控网络访问。
- Web、Worker、migration、ingest 是四种显式命令；migration 不随每个 Web replica 并发启动，ingest 使用受控 Embedding 与独立数据库权限边界。
- PostgreSQL pool 必须配置连接上限、连接/statement/idle timeout 和可识别的 `application_name`。
- Worker 的 Outbox 与 cleanup 必须具备 lease/idempotency，并能从进程崩溃中恢复。
- 上线前必须在隔离数据库完成空库 migration、公开知识重摄取、新邀请码与对话 smoke 的恢复演练。

## 9. 测试、评审与交付

- 新行为和 bug 先写会因目标缺失而失败的测试；行为保持重构先建立现有或 characterization coverage。
- 机械 import、纯文档和纯忽略规则不制造伪 RED，但必须检查准确产物。
- 验证顺序：focused -> affected integration -> full suite -> build -> browser/API smoke -> release security checks。
- 测试不得用 skip 掩盖环境缺失。外部证据单独标为 `PASS` 或 `BLOCKED_EXTERNAL`。
- UI 变化必须做 1440/390 真实渲染、控制台和溢出检查；纯后端重构复用已有视觉基线并做最小页面/API smoke。
- `FAST` 使用控制器或一次合并审查；`STANDARD` 每阶段一次独立综合审查；`CRITICAL` 在关注点真实不同的情况下拆合规与质量/安全审查。
- 每个 S11 阶段独立提交，禁止把行为修复、架构迁移与部署配置混成不可单独回滚的提交。
- 完成技术目标后必须通过 `closeout` 执行 `KNOWLEDGE_RECONCILED`，核对代码、蓝图、工程准则、任务状态和后续入口。

## 10. 变更前检查表

1. 变更职责是否能落在一个现有模块或一个有真实消费者的新边界？
2. 是否新增反向依赖、循环、客户端服务端越界或合同污染？
3. 是否改变 API、SSE、数据库 envelope、错误码、事务或重试语义？
4. 是否涉及密钥、权限、数据保留、外部调用、付费、部署或远端修改审批？
5. 哪个 focused 命令证明目标，哪个 stage-exit 命令证明没有回归？
6. 如何回滚该阶段，回滚是否会留下 partial schema、重复扣额或孤立状态？

任何一项无法回答时，先补设计或收窄阶段，不在热点文件中继续试探式叠加。
