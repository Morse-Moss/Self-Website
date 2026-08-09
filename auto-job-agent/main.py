"""AI 求职助手 — 命令行入口。

用法：
    python main.py --dry-run      # 只打分不打招呼（推荐先跑这个）
    python main.py --collect-only --collect-target 3
    python main.py                # 正式运行
    python main.py --platform boss
"""

import argparse
import sys

from jobagent.config import load_config
from jobagent.ai import OpenAICompatibleClient
from jobagent.analysis import run_analysis
from jobagent.collection import CollectionStore
from jobagent.knowledge import create_provider
from jobagent.resume import ResumeManager
from jobagent.review_server import run_review_server
from jobagent.store import Store
from jobagent.platforms.boss import BossPlatform
from jobagent.platforms.boss_collector import BossCollector

PLATFORMS = {
    "boss": BossPlatform,
    # "liepin": LiepinPlatform,   # TODO: 猎聘
    # "zhilian": ZhilianPlatform, # TODO: 智联
}

BROWSER_RISK_WARNING = (
    "温馨提示：部分站点对浏览器自动化操作检测严格，存在账号封禁风险。"
    "已内置防护措施但无法完全避免，Agent 继续操作即视为接受。"
)


def _configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="backslashreplace")


def main() -> None:
    _configure_stdio()
    parser = argparse.ArgumentParser(description="AI 求职助手")
    parser.add_argument("--platform", default="boss", choices=list(PLATFORMS))
    parser.add_argument("--dry-run", action="store_true", help="只做 AI 打分，不实际打招呼")
    parser.add_argument("--collect-only", action="store_true", help="只采集岗位与 JD，不调用 AI 或沟通")
    parser.add_argument(
        "--review-jobs",
        action="store_true",
        help="启动本地岗位定位审阅台，不调用 AI 或浏览器",
    )
    parser.add_argument(
        "--review-port",
        type=int,
        default=8765,
        help="岗位定位审阅台本地端口，默认 8765",
    )
    parser.add_argument(
        "--analyze-collection",
        action="store_true",
        help="离线分析已采集 JD，不调用 AI 或沟通",
    )
    parser.add_argument(
        "--analysis-output",
        default="../output/analysis",
        help="离线分析 CSV 与报告输出目录",
    )
    parser.add_argument("--collect-target", type=int, help="采集库中的目标 JD 总数")
    parser.add_argument(
        "--collect-source",
        choices=("all", "favorites", "search"),
        default="all",
        help="采集来源，默认先收藏后搜索",
    )
    args = parser.parse_args()

    offline_only = args.collect_only or args.analyze_collection or args.review_jobs
    cfg = load_config(require_ai=not offline_only)
    if args.review_jobs:
        collection_cfg = cfg.get("collection") or {}
        run_review_server(
            collection_cfg.get("db_path", "../output/jobagent.db"),
            host="127.0.0.1",
            port=args.review_port,
        )
        return
    if args.analyze_collection:
        collection_cfg = cfg.get("collection") or {}
        result = run_analysis(
            collection_cfg.get("db_path", "../output/jobagent.db"),
            args.analysis_output,
        )
        print(f"分析完成：{result.total} 个岗位")
        print(f"明细：{result.csv_path}")
        print(f"报告：{result.report_path}")
        return

    if args.collect_only:
        collection_cfg = cfg.get("collection") or {}
        target = args.collect_target or int(collection_cfg.get("target", 300))
        collection_store = CollectionStore(
            collection_cfg.get("db_path", "../output/jobagent.db")
        )
        collector = BossCollector(cfg, collection_store)
        try:
            print(BROWSER_RISK_WARNING)
            if args.collect_source == "all":
                result = collector.run(target=target)
            else:
                result = collector.run(target=target, source=args.collect_source)
            print(
                f"采集结束：本轮新增 {result.collected}，库内共 {result.total}，"
                f"状态 {result.status}"
            )
            if getattr(result, "error", None):
                print(f"停止原因：{result.error}")
        finally:
            collection_store.close()
        return

    ai = OpenAICompatibleClient(cfg["ai"])
    resume_mgr = ResumeManager(cfg["resume"])
    store = Store()

    kb = create_provider(cfg.get("knowledge"))
    print(f"知识库模式: {kb.name}")
    if kb.name == "none":
        print("提示：未启用知识库（可选功能），打招呼与简历定制仅依据母版简历")

    if not (cfg.get("preferences") or "").strip():
        print("提示：config.yaml 未填写 preferences 求职要求，打分将仅按简历匹配度")

    platform = PLATFORMS[args.platform](cfg, ai, resume_mgr, store, kb=kb)
    try:
        print(BROWSER_RISK_WARNING)
        platform.run(dry_run=args.dry_run)
    finally:
        store.close()


if __name__ == "__main__":
    main()
