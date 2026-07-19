from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import Page, Playwright, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "docs" / "verify" / "digital-morse"
PUBLIC_ASSET = (
    ROOT
    / "public"
    / "works"
    / "digital-morse"
    / "digital-morse-main-local-2026-07-19.png"
)
PROMPT = (
    "请介绍数字摩斯的三种对话流程、RAG 与可靠性设计，"
    "以及摩斯独立完成的技术实现。"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture and verify the Digital Morse portfolio story."
    )
    parser.add_argument(
        "base_url",
        nargs="?",
        default="http://127.0.0.1:3022",
        help="Origin of an already running local Revolution server.",
    )
    return parser.parse_args()


def launch_browser(playwright: Playwright):
    try:
        return playwright.chromium.launch(headless=True)
    except Exception:
        return playwright.chromium.launch(headless=True, channel="msedge")


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
                    "remainingMessages": 30,
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
                    "remainingMessages": 30,
                    "workflow": None,
                    "conversationId": None,
                    "messages": [],
                }
            ),
        ),
    )


def track_errors(page: Page) -> tuple[list[str], list[str], list[dict]]:
    console_errors: list[str] = []
    page_errors: list[str] = []
    http_errors: list[dict] = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on(
        "response",
        lambda response: http_errors.append(
            {
                "status": response.status,
                "path": urlsplit(response.url).path,
            }
        )
        if response.status >= 400
        else None,
    )
    return console_errors, page_errors, http_errors


def capture_public_asset(playwright: Playwright, base_url: str) -> dict:
    browser = launch_browser(playwright)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    console_errors, page_errors, http_errors = track_errors(page)
    authorize_chat(page)

    page.goto(base_url.rstrip("/"), wait_until="networkidle")
    panel = page.get_by_test_id("morse-chat-panel")
    expect(panel).to_be_visible()
    expect(panel.get_by_role("button", name="自由对话")).to_be_visible()
    expect(panel.locator("#morse-message")).to_be_visible()

    box = panel.bounding_box()
    if box is None:
        raise AssertionError("Digital Morse panel has no screenshot bounds")
    size = [round(box["width"]), round(box["height"])]
    if size != [576, 648]:
        raise AssertionError(f"Digital Morse public asset is {size}, expected [576, 648]")

    PUBLIC_ASSET.parent.mkdir(parents=True, exist_ok=True)
    panel.screenshot(path=PUBLIC_ASSET)
    result = {
        "size": size,
        "consoleErrors": console_errors,
        "pageErrors": page_errors,
        "httpErrors": http_errors,
    }
    browser.close()
    return result


def inspect_viewport(
    playwright: Playwright,
    base_url: str,
    name: str,
    width: int,
    height: int,
) -> dict:
    browser = launch_browser(playwright)
    page = browser.new_page(viewport={"width": width, "height": height})
    console_errors, page_errors, http_errors = track_errors(page)
    authorize_chat(page)

    page.goto(
        f"{base_url.rstrip('/')}/works",
        wait_until="networkidle",
    )
    card = page.locator('article[data-project-slug="digital-morse"]')
    expect(card).to_be_visible()
    expect(card.locator("#project-title-digital-morse")).to_be_visible()
    expect(card).to_contain_text(
        "嵌入个人作品集的 AI 数字分身系统，通过自由对话、JD 匹配和需求初诊"
    )
    expect(card).to_contain_text("唯一开发者 · 已上线 · 持续完善中")
    badge = card.get_by_text("产品界面 · 示例会话")
    expect(badge).to_be_visible()
    media = badge.locator("..")
    badge_box = badge.bounding_box()
    media_box = media.bounding_box()
    if badge_box is None or media_box is None:
        raise AssertionError(f"{name}: Digital Morse media badge has no bounds")
    if badge_box["y"] >= media_box["y"] + media_box["height"] / 3:
        raise AssertionError(f"{name}: Digital Morse media badge obscures the image content")

    tags = card.locator('ul[aria-label="数字摩斯能力"] li')
    expect(tags).to_have_count(5)
    if tags.all_text_contents() != [
        "三类对话工作流",
        "BGE + pgvector",
        "可追溯来源",
        "受控联网",
        "停止与恢复",
    ]:
        raise AssertionError(f"{name}: Digital Morse capability tags drifted")

    cta = card.get_by_role("button", name="问数字摩斯")
    expect(cta).to_have_count(0)

    toggle = card.locator('button[aria-controls="project-details-digital-morse"]')
    expect(toggle).to_have_attribute("aria-label", "展开数字摩斯详情")
    expect(toggle).to_have_attribute("aria-expanded", "false")
    toggle.click()
    expect(toggle).to_have_attribute("aria-expanded", "true")
    expect(toggle).to_have_attribute("aria-label", "收起数字摩斯详情")
    expect(page).to_have_url(re.compile(r"/works#digital-morse$"))

    details = card.locator("#project-details-digital-morse")
    expect(details).to_be_visible()
    headings = details.locator("h3")
    if headings.all_text_contents() != [
        "项目简介",
        "核心能力",
        "系统架构",
        "我的技术实现",
        "技术栈",
    ]:
        raise AssertionError(f"{name}: Digital Morse detail headings drifted")
    expect(details).to_contain_text("交互层")
    expect(details).to_contain_text("模型 Provider 生成")
    expect(details).to_contain_text("我是项目唯一开发者，负责全部技术实现")
    expect(details).to_contain_text("语音与视频表达")

    visible_copy = page.locator("body").inner_text()
    if re.search(
        r"验证证据|当前边界|采集时间|提交版本|运行方式|脱敏处理|腾讯云|GPT-5\.4",
        visible_copy,
        re.IGNORECASE,
    ):
        raise AssertionError(f"{name}: visible copy contains forbidden audit or vendor text")

    image = card.locator("img").first
    expect(image).to_have_attribute(
        "src", re.compile(r"digital-morse-main-local-2026-07-19\.png")
    )
    image_loaded = image.evaluate(
        "element => element.complete && element.naturalWidth > 0 && element.naturalHeight > 0"
    )
    if not image_loaded:
        raise AssertionError(f"{name}: Digital Morse screenshot did not load")

    card.scroll_into_view_if_needed()
    page.wait_for_timeout(350)
    page.screenshot(
        path=OUTPUT_DIR / f"portfolio-digital-morse-{name}-{width}x{height}.png"
    )

    horizontal_overflow = page.evaluate(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    if horizontal_overflow > 0:
        raise AssertionError(f"{name}: horizontal overflow is {horizontal_overflow}px")

    cta = card.get_by_role("button", name="问数字摩斯")
    expect(cta).to_be_visible()
    cta.click()
    panel = page.get_by_test_id("morse-chat-panel")
    expect(panel).to_be_visible()
    expect(panel.get_by_role("button", name="自由对话")).to_have_attribute(
        "aria-pressed", "true"
    )
    composer = panel.locator("#morse-message")
    expect(composer).to_have_value(PROMPT)
    expect(composer).to_be_focused()
    prompt_fits = composer.evaluate(
        "element => element.scrollHeight <= element.clientHeight + 1"
    )
    page.screenshot(
        path=OUTPUT_DIR / f"portfolio-digital-morse-cta-{name}-{width}x{height}.png"
    )

    result = {
        "viewport": name,
        "size": [width, height],
        "imageLoaded": image_loaded,
        "horizontalOverflow": horizontal_overflow,
        "promptPrefilled": composer.input_value() == PROMPT,
        "promptFits": prompt_fits,
        "consoleErrors": console_errors,
        "pageErrors": page_errors,
        "httpErrors": http_errors,
    }
    browser.close()
    return result


def main() -> None:
    args = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        public_asset = capture_public_asset(playwright, args.base_url)
        results = [
            inspect_viewport(playwright, args.base_url, "desktop", 1440, 900),
            inspect_viewport(playwright, args.base_url, "mobile", 390, 844),
        ]

    failures = [
        result
        for result in results
        if result["consoleErrors"]
        or result["pageErrors"]
        or result["httpErrors"]
        or not result["imageLoaded"]
        or not result["promptPrefilled"]
        or not result["promptFits"]
        or result["horizontalOverflow"] > 0
    ]
    if (
        public_asset["consoleErrors"]
        or public_asset["pageErrors"]
        or public_asset["httpErrors"]
    ):
        failures.append({"publicAsset": public_asset})

    print(
        json.dumps(
            {"publicAsset": public_asset, "results": results, "failures": failures},
            ensure_ascii=False,
        )
    )
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
