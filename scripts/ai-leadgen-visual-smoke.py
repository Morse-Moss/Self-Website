from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import Page, Playwright, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "docs" / "verify" / "ai-leadgen"
PROMPT = "我想了解 AI 外贸获客系统"
SUMMARY = (
    "面向外贸销售团队的 AI 获客运营系统，打通线索入池、官网信息补全、AI 价值评分、"
    "飞书协同、邮件触达与回信跟进，将分散的获客动作整合为可追踪、可协作的销售流程。"
)
CAPABILITIES = [
    "线索数据归一化",
    "官网信息富化",
    "AI 线索评分",
    "飞书协同",
    "阿里邮箱 OpenAPI",
]
DETAIL_HEADINGS = ["为什么做", "核心能力", "系统架构", "技术实现", "技术栈"]
ARCHITECTURE_DESCRIPTION = (
    "系统以统一线索状态串联评分记录、飞书提醒、发信任务和客户回信。"
    "触达前经过人工确认、邮箱健康检查和 Safe Send 校验，"
    "回信自动关联原始发信记录并进入后续跟进流程。"
)
FORBIDDEN_COPY = [
    "验证证据",
    "当前边界",
    "采集时间",
    "提交版本",
    "运行方式",
    "脱敏处理",
]


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
        description="Verify the AI leadgen portfolio card and Digital Morse prefill."
    )
    parser.add_argument(
        "base_url",
        nargs="?",
        default="http://127.0.0.1:3010",
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

    page.goto(f"{base_url.rstrip('/')}/works", wait_until="networkidle")
    expect(page.get_by_role("heading", name="代表作品", exact=True)).to_be_visible()

    card = page.locator('article[data-project-slug="ai-leadgen"]')
    expect(card).to_be_visible()
    expect(card.locator("#project-title-ai-leadgen")).to_be_visible()
    expect(card).to_contain_text(SUMMARY)
    expect(card).to_contain_text("项目负责人 · 本地 MVP 真实链路已验证")
    expect(card.get_by_text("真实运行界面", exact=True)).to_be_visible()

    capability_items = card.locator('ul[aria-label="AI 外贸获客系统能力"] li')
    expect(capability_items).to_have_count(5)
    if capability_items.all_text_contents() != CAPABILITIES:
        raise AssertionError(
            f"{name}: unexpected capability tags {capability_items.all_text_contents()}"
        )

    toggle = card.locator('button[aria-controls="project-details-ai-leadgen"]')
    expect(toggle).to_have_attribute("aria-label", "展开AI 外贸获客系统详情")
    expect(toggle).to_have_attribute("aria-expanded", "false")

    image = card.locator("img").first
    expect(image).to_have_attribute(
        "src", re.compile(r"graphite-dashboard-real-2026-07-19\.png")
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
        raise AssertionError(f"{name}: confirmed Graphite dashboard did not load")

    toggle.click()
    expect(toggle).to_have_attribute("aria-expanded", "true")
    expect(toggle).to_have_attribute("aria-label", "收起AI 外贸获客系统详情")
    expect(page).to_have_url(re.compile(r"/works#ai-leadgen$"))
    for heading in DETAIL_HEADINGS:
        expect(card.get_by_role("heading", name=heading, exact=True)).to_be_visible()

    expect(card).to_contain_text(ARCHITECTURE_DESCRIPTION)
    expect(card).to_contain_text("外部企业数据 -> 数据归一化 -> 官网富化")
    expect(card).to_contain_text("接入 OpenAI、飞书与阿里邮箱 OpenAPI")
    expect(card).to_contain_text("React")
    expect(card).to_contain_text("FastAPI")

    card_text = card.inner_text()
    for forbidden in FORBIDDEN_COPY:
        if forbidden in card_text:
            raise AssertionError(f"{name}: forbidden public copy is visible: {forbidden}")

    card.evaluate("element => element.scrollIntoView({ block: 'start', behavior: 'auto' })")
    page.wait_for_timeout(200)

    horizontal_overflow = page.evaluate(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    if horizontal_overflow > 0:
        raise AssertionError(f"{name}: horizontal overflow is {horizontal_overflow}px")

    page.screenshot(
        path=OUTPUT_DIR / f"portfolio-ai-leadgen-{name}-{width}x{height}.png"
    )

    cta = card.get_by_role("button", name="问数字摩斯", exact=True)
    expect(cta).to_be_visible()
    cta.click()
    panel = page.get_by_test_id("morse-chat-panel")
    expect(panel).to_be_visible()
    composer = page.locator("#morse-message")
    expect(composer).to_have_value(PROMPT)
    expect(composer).to_be_focused()

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
