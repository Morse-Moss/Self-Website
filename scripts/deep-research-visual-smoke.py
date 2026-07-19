from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import Page, Playwright, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "docs" / "verify" / "deep-research"
SUMMARY = (
    "本地优先的多 Agent 深度研究与报告系统，围绕研究问题完成方法发现、"
    "证据采集、横纵分析、质量审查与正式报告生成。"
)
CAPABILITIES = ["横纵研究", "证据台账", "论断映射", "缺口修复", "发布审批"]
DETAIL_HEADINGS = ["项目简介", "核心能力", "系统架构", "我的技术实现", "技术栈"]


def launch_browser(playwright: Playwright):
    try:
        return playwright.chromium.launch(headless=True)
    except Exception:
        try:
            return playwright.chromium.launch(headless=True, channel="msedge")
        except Exception:
            return playwright.chromium.launch(headless=True, channel="chrome")


def inspect_viewport(page: Page, base_url: str, name: str, width: int, height: int) -> dict:
    console_errors: list[str] = []
    page_errors: list[str] = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"{base_url.rstrip('/')}/works", wait_until="networkidle")

    card = page.locator('article[data-project-slug="deep-research"]')
    expect(card).to_be_visible()
    card.scroll_into_view_if_needed()
    expect(card).to_contain_text(SUMMARY)
    expect(card).to_contain_text("项目负责人 · 核心研究链可用")
    summary = card.locator("p").filter(has_text=SUMMARY).first
    summary_metrics = summary.evaluate(
        """
        element => {
          const styles = getComputedStyle(element);
          const lineHeight = Number.parseFloat(styles.lineHeight);
          return {
            clientHeight: element.clientHeight,
            lineHeight,
            lineClamp: styles.webkitLineClamp,
          };
        }
        """
    )
    if summary_metrics["lineClamp"] != "2" or summary_metrics["clientHeight"] > summary_metrics["lineHeight"] * 2.1:
        raise AssertionError(f"{name}: summary exceeds two lines {summary_metrics}")

    capability_items = card.locator('ul[aria-label="深度研究 Agent 系统能力"] li')
    expect(capability_items).to_have_count(5)
    actual_capabilities = capability_items.all_text_contents()
    if actual_capabilities != CAPABILITIES:
        raise AssertionError(f"{name}: unexpected capability tags {actual_capabilities}")

    image = card.locator("img").first
    expect(image).to_have_attribute("src", re.compile(r"operator-workbench-example\.png"))
    expect(card.get_by_text("运行界面 · 示例数据", exact=True)).to_be_visible()
    if not image.evaluate(
        "element => element.complete && element.naturalWidth > 0 && element.naturalHeight > 0"
    ):
        raise AssertionError(f"{name}: Operator Workbench image did not load")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    collapsed_path = OUTPUT_DIR / f"deep-research-{name}-collapsed.png"
    page.screenshot(path=str(collapsed_path), full_page=False)

    toggle = card.locator('button[aria-controls="project-details-deep-research"]')
    toggle.click()
    expect(toggle).to_have_attribute("aria-expanded", "true")
    expect(page).to_have_url(re.compile(r"#deep-research$"))
    for heading in DETAIL_HEADINGS:
        expect(card.get_by_role("heading", name=heading, exact=True)).to_be_visible()

    expect(card.get_by_role("button", name="问数字摩斯", exact=True)).to_be_visible()
    github = card.get_by_role("link", name="GitHub", exact=True)
    expect(github).to_have_attribute("href", "https://github.com/Morse-Moss/Deep-research-sys")
    expect(card).to_contain_text("Agent OS 内核")
    expect(card).to_contain_text("OpenAI-compatible Responses API")

    card.scroll_into_view_if_needed()
    page.wait_for_timeout(500)
    expanded_path = OUTPUT_DIR / f"deep-research-{name}-expanded.png"
    page.screenshot(path=str(expanded_path), full_page=False)

    layout = page.evaluate(
        """
        () => ({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          cardWidth: document.querySelector('[data-project-slug="deep-research"]')?.getBoundingClientRect().width ?? 0,
        })
        """
    )
    if layout["documentWidth"] > layout["viewportWidth"]:
        raise AssertionError(f"{name}: horizontal overflow {layout}")
    if layout["cardWidth"] > layout["viewportWidth"]:
        raise AssertionError(f"{name}: card exceeds viewport {layout}")
    if console_errors or page_errors:
        raise AssertionError(
            f"{name}: browser errors console={console_errors} page={page_errors}"
        )

    return {
        "viewport": {"width": width, "height": height},
        "collapsed": str(collapsed_path.relative_to(ROOT)),
        "expanded": str(expanded_path.relative_to(ROOT)),
        "horizontalOverflow": 0,
        "summary": summary_metrics,
        "consoleErrors": 0,
        "pageErrors": 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url", nargs="?", default="http://127.0.0.1:3023")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = launch_browser(playwright)
        desktop = browser.new_page()
        mobile = browser.new_page(is_mobile=True, has_touch=True)
        result = {
            "desktop": inspect_viewport(desktop, args.base_url, "desktop-1440x900", 1440, 900),
            "mobile": inspect_viewport(mobile, args.base_url, "mobile-390x844", 390, 844),
        }
        browser.close()

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
