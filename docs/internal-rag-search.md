# Internal RAG search endpoint

`POST /api/internal/rag/search` 为受信任的本地工具（如 auto-job-agent）提供纯检索能力：
复用现有 BGE Embeddings + pgvector 链路（`lib/server/rag.ts` 的 `retrieveKnowledge`），
不走对话工作流、不创建访客会话、不消耗额度。

## 启用

默认关闭。在 `.env` 中设置一个随机 token 后生效：

```
MORSE_INTERNAL_RAG_TOKEN=<openssl rand -hex 32>
```

token 为空时接口永远返回 401。token 仅通过环境变量注入，不进仓库；
不要复用任何 Provider key。生产环境建议配合 Caddy 将该路径限制为仅内网/本机访问。

## 契约

请求：

```
POST /api/internal/rag/search
Authorization: Bearer <MORSE_INTERNAL_RAG_TOKEN>
Content-Type: application/json

{ "query": "岗位名 公司名 + JD 摘要", "top_k": 6 }
```

响应：

```
200 { "results": [{ "text": "知识片段", "source": "标题或来源路径", "score": 0.87 }] }
401 未授权 / 未启用｜400 参数错误｜502 检索失败｜503 未配置数据库
```

`top_k` 默认 6，只接受 1 到 15 的整数；其他值返回 `400 top_k_invalid`。
查询上限 4000 字符。结果已按 `LOCAL_EVIDENCE_MIN_SCORE` 过滤并按文档去重，
可能少于 `top_k` 条。所有响应均带 `Cache-Control: no-store`。

## 安全边界

- 检索范围仅限 `knowledge_chunks`（即 `content/site-content.json` 审核后的公开知识）。
  私密简历与 `content/drafts/` 从未入库，因此不可能出现在结果中。
- 使用 `DATABASE_URL_RUNTIME`（回退 `DATABASE_URL`），与 web 运行时同权限。
- Embeddings 走 `OPENAI_EMBEDDING_BASE_URL` 配置的回环 BGE 服务；
  `MORSE_ALLOW_TEST_EMBEDDINGS=true` 时用确定性测试向量（仅限本地测试）。

## 验证

```bash
curl -s -X POST http://127.0.0.1:3010/api/internal/rag/search \
  -H "Authorization: Bearer $MORSE_INTERNAL_RAG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "Python 后端 RAG 项目经验", "top_k": 6}' | jq
```

Windows PowerShell 应通过 stdin 传递 UTF-8 JSON，避免原生命令行转义破坏请求体：

```powershell
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$body = @{ query = 'Python 后端 RAG 项目经验'; top_k = 6 } | ConvertTo-Json -Compress
$body | curl.exe -sS -X POST http://127.0.0.1:3010/api/internal/rag/search `
  -H "Authorization: Bearer $env:MORSE_INTERNAL_RAG_TOKEN" `
  -H "Content-Type: application/json" --data-binary '@-'
```

对应 auto-job-agent 的配置（`config.yaml`）：

```yaml
knowledge:
  provider: "rag"
  rag:
    endpoint: "http://127.0.0.1:3010/api/internal/rag/search"
    api_key: "<MORSE_INTERNAL_RAG_TOKEN>"
    top_k: 6
```
