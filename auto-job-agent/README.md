# auto-job-agent

Boss直聘 AI 求职助手：自动搜索岗位 → GPT 等 OpenAI-compatible 模型结合你的求职要求打分筛选 → 按 JD 定制简历 → 自动发送个性化打招呼语。

## 流程

```
搜索关键词岗位 → 黑名单硬过滤（外包/驻场等，不花 API 钱）
      ↓
抓取 JD 全文 → AI 打分【依据 = 求职要求 preferences + 母版简历 + JD】
  · 命中「坚决排除」→ 直接 0-20 分
  · 不满足「硬性要求」→ 最高 40 分
      ↓
低于阈值 → 跳过并记录 ｜ 高分岗位 ↓
知识库检索（可选：none / local / rag）
      ↓
AI 生成定制简历（存 output/tailored/）+ 打招呼语【依据 = 简历 + 知识片段 + JD】
      ↓
自动点击「立即沟通」发送 → SQLite 记录防重复
```

## 快速开始

```bash
# 1. Python 3.10+，安装依赖
pip install -r requirements.txt
playwright install chromium

# 2. 配置
cp config.example.yaml config.yaml          # 填 API 地址、key、模型、求职要求和关键词
cp resume/master_resume.example.md resume/master_resume.md   # 写你的简历

# 3. 试运行（只打分不投递，务必先跑这个）
python main.py --dry-run

# 4. 正式运行
python main.py
```

## 只读岗位采集

准备阶段可以只收集列表与 JD，不调用 GPT、不生成简历、不投递、不发送沟通消息：

```bash
python main.py --collect-only --collect-target 3 --collect-source favorites
python main.py --collect-only --collect-target 300
```

采集优先读取“感兴趣”收藏，再按 FDE、AI Agent、AI 应用、RAG、解决方案与交付方向补充搜索结果。记录保存在 `../output/jobagent.db`，每条 JD 增量去重；检测到 Boss 安全校验会立即停止，下一次运行从已保存记录继续。

采集完成后可以运行可解释的离线定位分析，不调用 GPT：

```bash
python main.py --analyze-collection
```

分析结果回写到同一数据库的 `job_positioning_analysis` 表，并导出到 `../output/analysis/job-positioning.csv` 与 `job-positioning-summary.md`。分层会区分技术相关度与实际可投性，单独标记经验、薪资、第三方招聘、外包/派遣、长期驻场、产品/销售错位、应届资格和海外派驻风险。

## 岗位定位审阅台

在恢复 AI 评分或自动投递前，先用本地审阅台校准一批岗位：

```bash
python main.py --review-jobs
```

打开 `http://127.0.0.1:8765`。默认样本固定为 60 条：收藏 20、核心 15、挑战 15、排除 10。页面会从 JD 原文提取技术匹配、业务/FDE 价值、风险与用工关系线索；明显不合适的岗位可以直接放弃，不需要填写完整评分。人工判断保存在同一个本地 SQLite 数据库的 `job_reviews` 表中，刷新页面不会丢失。审阅台不会访问 Boss、调用模型或发送沟通消息。

首次运行会打开浏览器，用 Boss App 扫码登录，Cookie 会保存到 `.state/` 复用。

## 个人知识库（可选）

打招呼语与定制简历可以基于你的个人知识库生成，`config.yaml` 的 `knowledge.provider` 支持三种模式：

| 模式 | 说明 | 适合 |
|---|---|---|
| `none` | 不使用，仅依据母版简历（默认） | 没有知识库，开箱即用 |
| `local` | 读取本地 `knowledge/` 目录的 .md/.txt | 想快速补充项目复盘、量化成果 |
| `rag` | 按岗位 JD 实时调用外部检索接口，每个岗位只注入最相关的知识片段 | 已有知识库系统（如个人数字分身、向量库） |

`rag` 模式的 HTTP 接口契约见 [docs/rag-api.md](docs/rag-api.md)，实现该契约的任何系统都能接入。

## 目录结构

```
main.py                      # 入口（--platform boss / --dry-run）
config.example.yaml          # 配置模板（求职要求、知识库、平台参数）
jobagent/
  config.py                  # 配置加载
  ai.py                      # OpenAI-compatible：打分 / 打招呼语 / 定制简历
  knowledge.py               # 知识提供者：none / local / rag
  resume.py                  # 母版简历与定制简历落盘
  store.py                   # SQLite 投递记录（防重复）
  platforms/
    base.py                  # 平台抽象基类
    boss.py                  # Boss直聘（SELECTORS 在文件头部，改版时先查这里）
knowledge/                   # local 模式知识库目录（内容不提交仓库）
docs/rag-api.md              # rag 模式接口契约
```

## 常见问题

- **脚本跑着跑着不动了 / 抓不到岗位**：大概率是 Boss 前端改版或触发验证码。改版时用 F12 检查页面元素并更新 `jobagent/platforms/boss.py` 头部的 `SELECTORS`；验证码需手动在浏览器窗口完成。
- **打分不准**：优先完善 `preferences` 的四个分类（期望/硬性/加分/排除），再调 `match.min_score`。

## 风险提示

浏览器自动化可能违反招聘平台用户协议，存在账号限流、封禁风险。请务必先 `--dry-run` 验证效果，控制 `max_apply_per_run` 和投递频率，风险自负。
