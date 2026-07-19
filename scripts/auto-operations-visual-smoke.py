from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import Page, Playwright, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "docs" / "verify" / "auto-operations"
PROMPT = (
    "请介绍自动运营 Agent 的账号矩阵、内容资产、AI 生产、任务编排与受控发布，"
    "以及摩斯独立完成的技术实现。"
)
SUMMARY = (
    "面向企业运营团队的小红书智能运营系统，将数据发现、内容沉淀、AI 内容生产、"
    "发布校验和任务追踪连接成受控运营工作流。"
)
CAPABILITIES = ["账号矩阵", "内容资产化", "AI 内容生产", "任务编排", "受控发布"]
DETAIL_HEADINGS = ["项目简介", "核心能力", "系统架构", "我的技术实现", "技术栈"]
FORBIDDEN_COPY = ["验证证据", "当前边界", "采集时间", "提交版本", "运行方式", "脱敏处理"]
SPECIFIC_MODEL_PATTERN = re.compile(
    r"doubao|豆包|gpt-?\d|seed|kling|veo|wan",
    re.IGNORECASE,
)


def launch_browser(playwright: Playwright):
    try:
        return playwright.chromium.launch(headless=True)
    except Exception:
        try:
            return playwright.chromium.launch(headless=True, channel="msedge")
        except Exception:
            return playwright.chromium.launch(headless=True, channel="chrome")


def authorize_chat(page: Page) -> None:
    page.route(
        "**/api/access",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "authorized": True,
                    "expiresAt": "2026-07-19T23:59:59.000Z",
                    "remainingMessages": 12,
                }
            ),
        ),
    )
    page.route(
        "**/api/chat/history",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "ok": True,
                    "remainingMessages": 12,
                    "workflow": None,
                    "conversationId": None,
                    "messages": [],
                }
            ),
        ),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify the auto-operations portfolio card and knowledge-facing CTA."
    )
    parser.add_argument(
        "base_url",
        nargs="?",
        default="http://127.0.0.1:3020",
        help="Origin of an already running local Revolution server.",
    )
    return parser.parse_args()


def inspect_viewport(
    playwright: Playwright,
    base_url: str,
    name: str,
    width: int,
    height: int,
) -> dict:
    browser = launch_browser(playwright)
    page = browser.new_page(viewport={"width": width, "height": height})
    console_errors: list[str] = []
    page_errors: list[str] = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    authorize_chat(page)

    page.goto(f"{base_url.rstrip('/')}/works", wait_until="domcontentloaded")
    expect(page.get_by_role("heading", name="代表作品", exact=True)).to_be_visible()

    card = page.locator('article[data-project-slug="auto-operations"]')
    expect(card).to_be_visible()
    expect(card.locator("#project-title-auto-operations")).to_be_visible()
    expect(card).to_contain_text(SUMMARY)
    expect(card).to_contain_text("项目负责人 · 已部署运行")
    expect(card.get_by_text("界面设计稿 · 示例数据", exact=True)).to_be_visible()

    capability_items = card.locator(
        'ul[aria-label="自动运营 Agent 系统能力"] li'
    )
    expect(capability_items).to_have_count(5)
    if capability_items.all_text_contents() != CAPABILITIES:
        raise AssertionError(
            f"{name}: unexpected capability tags {capability_items.all_text_contents()}"
        )

    toggle = card.locator(
        'button[aria-controls="project-details-auto-operations"]'
    )
    expect(toggle).to_have_attribute("aria-label", "展开自动运营 Agent 系统详情")
    expect(toggle).to_have_attribute("aria-expanded", "false")

    image = card.locator("img").first
    expect(image).to_have_attribute(
        "src", re.compile(r"operations-workbench-design-2026-07-19\.png")
    )
    image.scroll_into_view_if_needed()
    expect(image).to_be_visible()
    image_loaded = image.evaluate(
        """
        element => {
          const loaded = () => (
            element.complete && element.naturalWidth > 0 && element.naturalHeight > 0
          );
          if (element.complete) return loaded();
          return new Promise((resolve) => {
            element.addEventListener('load', () => resolve(loaded()), { once: true });
            element.addEventListener('error', () => resolve(false), { once: true });
          });
        }
        """
    )
    if not image_loaded:
        raise AssertionError(f"{name}: approved design image did not load")

    toggle.click()
    expect(toggle).to_have_attribute("aria-expanded", "true")
    expect(toggle).to_have_attribute("aria-label", "收起自动运营 Agent 系统详情")
    for heading in DETAIL_HEADINGS:
        expect(card.get_by_role("heading", name=heading, exact=True)).to_be_visible()

    expect(card).to_contain_text("AutoTask 与 PublishJob")
    expect(card).to_contain_text("我是项目负责人")
    expect(card).to_contain_text("可审核、可回退的运营策略 Agent")

    card_text = card.inner_text()
    for forbidden in FORBIDDEN_COPY:
        if forbidden in card_text:
            raise AssertionError(f"{name}: forbidden public copy is visible: {forbidden}")
    if SPECIFIC_MODEL_PATTERN.search(card_text):
        raise AssertionError(f"{name}: a specific model name is visible in auto-operations")

    card.evaluate("element => element.scrollIntoView({ block: 'start', behavior: 'auto' })")
    page.wait_for_timeout(150)
    page.screenshot(
        path=OUTPUT_DIR / f"portfolio-auto-operations-{name}-{width}x{height}.png"
    )

    cta = card.get_by_role("button", name="问数字摩斯", exact=True)
    expect(cta).to_be_visible()
    cta.click()
    panel = page.get_by_test_id("morse-chat-panel")
    expect(panel).to_be_visible()
    composer = page.locator("#morse-message")
    expect(composer).to_have_value(PROMPT)
    expect(composer).to_be_focused()

    horizontal_overflow = page.evaluate(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    if horizontal_overflow > 0:
        raise AssertionError(f"{name}: horizontal overflow is {horizontal_overflow}px")

    page.screenshot(
        path=OUTPUT_DIR / f"portfolio-auto-operations-cta-{name}-{width}x{height}.png"
    )
    result = {
        "viewport": name,
        "size": [width, height],
        "imageLoaded": image_loaded,
        "horizontalOverflow": horizontal_overflow,
        "promptPrefilled": composer.input_value() == PROMPT,
        "consoleErrors": console_errors,
        "pageErrors": page_errors,
    }
    browser.close()
    return result


def main() -> None:
    args = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        results = [
            inspect_viewport(playwright, args.base_url, "desktop", 1440, 900),
            inspect_viewport(playwright, args.base_url, "mobile", 390, 844),
        ]

    failures = [
        result
        for result in results
        if result["consoleErrors"]
        or result["pageErrors"]
        or not result["imageLoaded"]
        or not result["promptPrefilled"]
        or result["horizontalOverflow"] > 0
    ]
    print(json.dumps({"results": results, "failures": failures}, ensure_ascii=False))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
