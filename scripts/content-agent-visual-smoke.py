from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import Page, Playwright, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "docs" / "verify" / "content-agent"
PROMPT = (
    "我想了解内容创作 Agent 系统：它如何通过对话生成图片和视频，"
    "哪些模型已经真实验证，以及摩斯独立完成了哪些技术实现？"
)


def launch_browser(playwright: Playwright):
    try:
        return playwright.chromium.launch(headless=True)
    except Exception:
        return playwright.chromium.launch(headless=True, channel="chrome")


def authorize_chat(page: Page) -> list:
    pending_history: list = []
    page.route(
        "**/api/access",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "authorized": True,
                    "expiresAt": "2026-07-18T23:59:59.000Z",
                    "remainingMessages": 12,
                }
            ),
        ),
    )
    page.route(
        "**/api/chat/history",
        lambda route: pending_history.append(route),
    )
    return pending_history


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify the content-agent portfolio card and Digital Morse CTA."
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
    pending_history = authorize_chat(page)

    page.goto(
        f"{base_url.rstrip('/')}/works#content-agent",
        wait_until="domcontentloaded",
    )

    card = page.locator('article[data-project-slug="content-agent"]')
    expect(card).to_be_visible()
    cta = card.get_by_role("button", name="问数字摩斯")
    expect(cta).to_be_visible()

    for _ in range(40):
        if pending_history:
            break
        page.wait_for_timeout(50)
    if not pending_history:
        raise AssertionError(f"{name}: history request did not reach the delayed fixture")

    cta.click()
    panel = page.get_by_test_id("morse-chat-panel")
    expect(panel).to_be_visible()
    expect(panel.get_by_text("正在恢复会话...")).to_be_visible()
    pending_history[0].fulfill(
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
    )
    page.wait_for_load_state("networkidle")
    composer = page.locator("#morse-message")
    expect(composer).to_have_value(PROMPT)
    delayed_history_prefilled = composer.input_value() == PROMPT
    panel.get_by_role("button", name="关闭对话").click()

    expect(card.locator("#project-title-content-agent")).to_be_visible()
    expect(card).to_contain_text("GPT Image 2 / Seedance 2")
    expect(card).to_contain_text("均由摩斯独立完成")
    expect(card).to_contain_text("未来将向自进化 Agent 演进")
    expect(card.get_by_text("设计图 · 示例数据 · 非生产运行截图")).to_be_visible()

    image = card.locator("img").first
    expect(image).to_have_attribute(
        "src", re.compile(r"atelier-main-design-2026-07-18\.jpg")
    )
    image_loaded = image.evaluate(
        "element => element.complete && element.naturalWidth > 0 && element.naturalHeight > 0"
    )
    if not image_loaded:
        raise AssertionError(f"{name}: approved design image did not load")

    card.scroll_into_view_if_needed()
    page.wait_for_timeout(350)
    page.screenshot(
        path=OUTPUT_DIR / f"portfolio-content-agent-{name}-{width}x{height}.png"
    )

    horizontal_overflow = page.evaluate(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    if horizontal_overflow > 0:
        raise AssertionError(f"{name}: horizontal overflow is {horizontal_overflow}px")

    page.get_by_role("button", name="问摩斯", exact=True).click()
    expect(panel).to_be_visible()
    panel.get_by_role("button", name="JD 匹配").click()
    expect(panel.get_by_role("button", name="JD 匹配")).to_have_attribute(
        "aria-pressed", "true"
    )
    panel.get_by_role("button", name="关闭对话").click()

    cta.click()
    expect(panel).to_be_visible()
    expect(panel.get_by_role("button", name="自由对话")).to_have_attribute(
        "aria-pressed", "true"
    )
    expect(composer).to_have_value(PROMPT)
    expect(composer).to_be_focused()
    page.screenshot(
        path=OUTPUT_DIR / f"portfolio-content-agent-cta-{name}-{width}x{height}.png"
    )

    result = {
        "viewport": name,
        "size": [width, height],
        "imageLoaded": image_loaded,
        "horizontalOverflow": horizontal_overflow,
        "delayedHistoryPrefilled": delayed_history_prefilled,
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
        or not result["delayedHistoryPrefilled"]
        or not result["promptPrefilled"]
        or result["horizontalOverflow"] > 0
    ]
    print(json.dumps({"results": results, "failures": failures}, ensure_ascii=False))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
