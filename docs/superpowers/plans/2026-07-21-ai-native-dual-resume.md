# AI Native Dual Resume Revision 2 Implementation Plan

> Absorption note (2026-07-25): This historical plan was imported from the retired `codex/dual-resume` worktree. Checkbox state and fixed local paths below are not current execution state. Any continuation must start from a fresh branch, re-check current evidence, and preserve the Git-ignored private-data boundary.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the two private Chinese one-page resumes into a portrait-enabled, recruiter-friendly and ATS-safe Revision 2 while preserving necessary evidence, placing education first, and adding a verified QR entry to Digital Morse.

**Architecture:** Keep one Git-ignored JSON fact source and one shared Python generator. Prepare the portrait and QR as private local assets, render both DOCX and PDF from the same ordered content model, and enforce Revision 2 with automated text/order/media/privacy checks plus fresh visual inspection.

**Tech Stack:** Python 3, python-docx, ReportLab, pypdf, pypdfium2, Pillow, qrcode, OpenCV QRCodeDetector, Windows Microsoft YaHei fonts, PowerShell, Git

---

## Authority And Execution Boundary

- Design authority: `docs/superpowers/specs/2026-07-21-ai-native-dual-resume-design.md`, Revision 2.
- Read-only resume guidance: `E:\AI-OSS-Reference\tech-interview-handbook\apps\website\contents\resume.md` and `E:\AI-OSS-Reference\tech-interview-handbook\apps\website\blog\2021-08-29-resume-improvement-case-study.md`.
- Handbook rules applied here: one page; standard headings; selectable plain-text reading order; no Word header/footer content; education first for an early-career candidate; explain project context and ownership; retain useful links; tailor truthful keywords to the target JD without stuffing.
- Worktree: `E:\Revolution\.worktrees\dual-resume` on `codex/dual-resume`.
- Private output root: `output/resume/`, covered by `.gitignore:12:output/`.
- Bundled document runtime: `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`.
- Existing system runtime for QR preparation and decoding: `E:\AI\Python\python.exe`.
- Do not install dependencies. `qrcode` and `cv2` are available only in the existing system runtime; the document libraries are available in both runtimes.
- Do not publish, upload, deploy, push, ingest into RAG, or enable private-resume access.
- Do not stage or commit anything under `output/resume/`. These files contain or process private data.
- The old generated resumes are replaceable private artifacts; the historical source PDF is read-only.

## File Map

- Modify: `output/resume/private-resume-data.json` - Revision 2 ordered content, capability lines, exact credentials, and private asset references.
- Create: `output/resume/prepare_resume_assets.py` - extract/crop the historical portrait and generate the Digital Morse QR code.
- Create: `output/resume/assets/portrait.jpg` - private 5:6 portrait crop.
- Create: `output/resume/assets/digital-morse-qr.png` - QR code for `https://aimorse.tech`.
- Modify: `output/resume/build_resumes.py` - shared Revision 2 content validation, visual tokens, DOCX renderer, and PDF renderer.
- Modify: `output/resume/qa_resumes.py` - Revision 2 content, order, media, QR, page-count, parity, keyword, and privacy checks.
- Replace: `output/resume/AI-Agent-Builder-Resume.docx`.
- Replace: `output/resume/AI-Agent-Builder-Resume.pdf`.
- Replace: `output/resume/Cross-Border-Vibe-Coding-Resume.docx`.
- Replace: `output/resume/Cross-Border-Vibe-Coding-Resume.pdf`.
- Replace: `output/resume/qa/general-page-1.png`.
- Replace: `output/resume/qa/targeted-page-1.png`.
- Keep for comparison until final cleanup: `output/resume/qa/source-photo.jpg` and `output/resume/qa/source-resume-page-1.png`.

### Task 1: Convert Revision 2 Into A Failing QA Contract

**Files:**
- Modify: `output/resume/qa_resumes.py:18-278`
- Read: `docs/superpowers/specs/2026-07-21-ai-native-dual-resume-design.md`

- [ ] **Step 1: Replace the imports, section order, and content contract**

Define the final formal section order locally in the QA script so the test does not depend on generator constants:

```python
from xml.etree import ElementTree as ET

from build_resumes import DATA_PATH, load_data


SECTION_EDUCATION = "教育背景"
SECTION_EXPERIENCE = "工作经历"
SECTION_PROJECTS = "项目经历"
SECTION_SKILLS = "专业技能"
SECTION_CREDENTIALS = "语言与荣誉"

SECTION_HEADINGS = [
    SECTION_EDUCATION,
    SECTION_EXPERIENCE,
    SECTION_PROJECTS,
    SECTION_SKILLS,
    SECTION_CREDENTIALS,
]

REQUIRED_SHARED = [
    "第一届全国大学生数据分析大赛（Python组）省级一等奖",
    "大学英语六级（CET-6）",
    "雅思（IELTS）6.0",
    "AI应用工程师",
    "WorkBuddy",
    "Claude Code、Codex、WorkBuddy",
]

FORBIDDEN_SHARED = [
    "职业概述",
    "RAG 46/46",
    "top-3 命中 46/46",
    "Lighthouse 99",
    "Lighthouse Performance 均为 99",
    "两项大学生创新创业大赛省级项目负责人并结项",
    "两次大学生创新创业大赛省级项目负责人成功结项",
]

TARGETED_REQUIRED = [
    "跨境业务需求",
    "SOP",
    "全栈开发",
    "Claude Code、Codex、WorkBuddy",
]
TARGETED_FORBIDDEN = ["GPT", "Cursor"]
```

Remove the imported `SECTION_*` constants, including `SECTION_SUMMARY`, from the existing `from build_resumes import (...)` block. Replace `expected_fragments` so value line, capability sequence, exact portfolio URL, and QR label participate in DOCX/PDF parity:

```python
def expected_fragments(data: dict, variant: str) -> list[str]:
    variant_data = data[variant]
    person = data["person"]
    fragments = [
        person["name"],
        person["phone"],
        person["email"],
        person["location"],
        person["github_label"],
        person["portfolio_label"],
        person["portfolio_url"],
        person["portfolio_qr_label"],
        variant_data["headline"],
        variant_data["value_line"],
        " → ".join(variant_data["capability_steps"]),
        *SECTION_HEADINGS,
    ]

    for employment in data["employment"][:2]:
        fragments.extend(
            [
                employment["company"],
                employment["location"],
                employment["title"],
                employment["dates"],
            ]
        )
    fragments.extend(variant_data["experience_bullets"])
    fragments.extend(variant_data["prior_experience_bullets"])

    for project in variant_data["projects"]:
        fragments.extend([project["name"], project["meta"], *project["bullets"]])
        if project.get("url"):
            fragments.append(project["url"])

    for label, value in variant_data["skill_groups"].items():
        fragments.extend([label, value])

    for education in data["education"]:
        fragments.extend([education["school"], education["degree"], education["dates"]])
    fragments.extend(data["credentials"])
    return fragments
```

- [ ] **Step 2: Make DOCX extraction include body tables and media metadata**

Replace paragraph-only extraction with document-order XML text while keeping paragraph objects for heading and bullet structure checks:

```python
def docx_visible_text(document: Document) -> str:
    return "".join(node.text or "" for node in document.element.body.iter(qn("w:t")))


def extract_docx(path: Path) -> tuple[Document, list[str], str]:
    with zipfile.ZipFile(path) as archive:
        require(archive.testzip() is None, f"DOCX ZIP integrity failed: {path.name}")
        required_members = {
            "[Content_Types].xml",
            "word/document.xml",
            "word/styles.xml",
            "word/numbering.xml",
            "word/_rels/document.xml.rels",
        }
        missing = required_members.difference(archive.namelist())
        require(not missing, f"DOCX package is missing members in {path.name}: {missing}")
        media = [name for name in archive.namelist() if name.startswith("word/media/")]
        require(len(media) >= 2, f"DOCX must embed portrait and QR: {path.name}")
        document_xml = archive.read("word/document.xml").decode("utf-8")
        require("候选人证件照" in document_xml, f"Portrait alt text missing: {path.name}")
        require("数字摩斯作品集二维码" in document_xml, f"QR alt text missing: {path.name}")
    document = Document(path)
    paragraphs = [docx_paragraph_text(paragraph) for paragraph in document.paragraphs]
    return document, paragraphs, docx_visible_text(document)
```

- [ ] **Step 3: Add asset and QR checks**

Add these paths and a decoder that reuses the existing system Python without installing anything:

```python
ASSET_DIR = BASE_DIR / "assets"
PORTRAIT_PATH = ASSET_DIR / "portrait.jpg"
QR_PATH = ASSET_DIR / "digital-morse-qr.png"
QR_DECODER_PYTHON = Path(r"E:\AI\Python\python.exe")
PORTFOLIO_URL = "https://aimorse.tech"

QR_DECODE_CODE = (
    "import cv2,sys; "
    "img=cv2.imread(sys.argv[1]); "
    "value,points,_=cv2.QRCodeDetector().detectAndDecode(img); "
    "print(value); raise SystemExit(0 if value else 2)"
)


def decode_qr(path: Path) -> str:
    result = subprocess.run(
        [str(QR_DECODER_PYTHON), "-c", QR_DECODE_CODE, str(path)],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return result.stdout.strip()


def check_prepared_assets() -> None:
    for path in (PORTRAIT_PATH, QR_PATH):
        require(path.is_file(), f"Missing prepared asset: {path.name}")
        require(path.stat().st_size > 1_000, f"Prepared asset is too small: {path.name}")
    require(decode_qr(QR_PATH) == PORTFOLIO_URL, "Prepared QR target is incorrect")


def pdf_link_targets(reader: PdfReader) -> set[str]:
    targets: set[str] = set()
    for page in reader.pages:
        for reference in page.get("/Annots", []):
            annotation = reference.get_object()
            action = annotation.get("/A")
            if action and action.get("/URI"):
                targets.add(str(action["/URI"]))
    return targets


def docx_link_targets(path: Path) -> set[str]:
    namespace = {"rel": "http://schemas.openxmlformats.org/package/2006/relationships"}
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
    return {
        relationship.attrib["Target"]
        for relationship in root.findall("rel:Relationship", namespace)
        if relationship.attrib.get("TargetMode") == "External"
    }
```

Call `check_prepared_assets()` at the start of `main`. In `check_variant`, require both `PORTFOLIO_URL in docx_link_targets(paths["docx"])` and `PORTFOLIO_URL in pdf_link_targets(reader)`. After `render_pdf(...)`, require `decode_qr(ARTIFACTS[variant]["image"]) == PORTFOLIO_URL` so the QR is verified from each complete rendered page, not only from its source asset.

- [ ] **Step 4: Add Revision 2 order and copy assertions**

Add the body-size guard and run the following contract for each DOCX and PDF:

```python
def check_docx_body_floor(document: Document, filename: str) -> None:
    body_styles = {"List Bullet", "Resume Compact"}
    for paragraph in document.paragraphs:
        if paragraph.style.name not in body_styles:
            continue
        for run in paragraph.runs:
            if not run.text.strip():
                continue
            size = run.font.size or paragraph.style.font.size
            require(size is not None, f"Unknown DOCX body font size: {filename}")
            require(size.pt >= 10.5, f"DOCX body font below 10.5 pt: {filename}")


def check_revision_copy(text: str, filename: str, variant: str) -> None:
    check_heading_order(text, filename)
    require("职业概述" not in text, f"Legacy summary section remains: {filename}")
    for term in REQUIRED_SHARED:
        require(term in text, f"Missing Revision 2 term {term}: {filename}")
    for term in FORBIDDEN_SHARED:
        require(term not in text, f"Forbidden Revision 1 term {term}: {filename}")

    if variant == "targeted":
        normalized = normalize_text(text)
        require(
            normalize_text("跨境业务需求 → SOP → 全栈开发") in normalized,
            f"Targeted capability line is incorrect: {filename}",
        )
        for term in TARGETED_REQUIRED:
            require(term in text, f"Missing targeted term {term}: {filename}")
        for term in TARGETED_FORBIDDEN:
            require(term not in text, f"Forbidden targeted term {term}: {filename}")


```

Immediately after the existing DOCX/PDF extraction lines inside `check_variant`, insert:

```python
check_docx_body_floor(document, paths["docx"].name)
require(
    PORTFOLIO_URL in docx_link_targets(paths["docx"]),
    f"DOCX portfolio URL is not clickable: {paths['docx'].name}",
)
require(
    PORTFOLIO_URL in pdf_link_targets(reader),
    f"PDF portfolio URL is not clickable: {paths['pdf'].name}",
)
check_revision_copy(docx_text, paths["docx"].name, variant)
check_revision_copy(pdf_text, paths["pdf"].name, variant)
```

Keep the existing checks for one-page PDFs, selectable text, complete expected fragments, DOCX/PDF parity, project keywords, banned KYC/payment/circumvention claims, and Git isolation. Replace `main` with the exact order below so the first Revision 1 run fails before rendering and the final run decodes each QR from the complete page image:

```python
def main() -> None:
    data = load_data(str(DATA_PATH))
    check_prepared_assets()
    check_artifacts_and_git()
    for variant in ("general", "targeted"):
        check_variant(data, variant)
        render_pdf(ARTIFACTS[variant]["pdf"], ARTIFACTS[variant]["image"])
        require(
            decode_qr(ARTIFACTS[variant]["image"]) == PORTFOLIO_URL,
            f"Rendered-page QR is unreadable: {variant}",
        )
    print(
        "PASS: Revision 2, 4 artifacts, 2 one-page PDFs, portrait, QR, "
        "text parity, order, keywords, privacy"
    )
```

- [ ] **Step 5: Run the revised QA against Revision 1 artifacts**

Run:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'output\resume\qa_resumes.py'
```

Expected: FAIL before content assertions with `Missing prepared asset: portrait.jpg` or `DOCX must embed portrait and QR`. This is the required RED result.

- [ ] **Step 6: Confirm the test edit remains private**

Run:

```powershell
git check-ignore -v 'output\resume\qa_resumes.py'
git status --short
```

Expected: `.gitignore:12:output/`; no `output/resume/` path in Git status. Do not commit.

### Task 2: Prepare The Portrait And Digital Morse QR

**Files:**
- Create: `output/resume/prepare_resume_assets.py`
- Create: `output/resume/assets/portrait.jpg`
- Create: `output/resume/assets/digital-morse-qr.png`
- Read: `output/resume/qa/source-photo.jpg`

- [ ] **Step 1: Write the private asset preparation script**

Create the complete script:

```python
from __future__ import annotations

from pathlib import Path

import qrcode
from PIL import Image, ImageOps
from qrcode.constants import ERROR_CORRECT_M


BASE_DIR = Path(__file__).resolve().parent
ASSET_DIR = BASE_DIR / "assets"
SOURCE_PORTRAIT = BASE_DIR / "qa" / "source-photo.jpg"
PORTRAIT_PATH = ASSET_DIR / "portrait.jpg"
QR_PATH = ASSET_DIR / "digital-morse-qr.png"
PORTFOLIO_URL = "https://aimorse.tech"


def prepare_portrait(source_path: Path) -> None:
    if not source_path.is_file():
        raise RuntimeError(f"Missing extracted historical portrait: {source_path}")
    with Image.open(source_path) as source:
        portrait = ImageOps.fit(
            source.convert("RGB"),
            (500, 600),
            method=Image.Resampling.LANCZOS,
            centering=(0.5, 0.48),
        )
    portrait.save(PORTRAIT_PATH, format="JPEG", quality=95, optimize=True)


def prepare_qr() -> None:
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=12,
        border=4,
    )
    qr.add_data(PORTFOLIO_URL)
    qr.make(fit=True)
    image = qr.make_image(fill_color="#1F2A37", back_color="white").convert("RGB")
    image.save(QR_PATH, format="PNG", optimize=True)


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    prepare_portrait(SOURCE_PORTRAIT)
    prepare_qr()
    print("Prepared portrait and Digital Morse QR")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Confirm the extracted portrait source remains private**

Run:

```powershell
Get-Item -LiteralPath 'output\resume\qa\source-photo.jpg' | Select-Object Name,Length
git check-ignore -v 'output\resume\qa\source-photo.jpg'
```

Expected: the image exists and resolves to `.gitignore:12:output/`. Do not copy it into a tracked path.

- [ ] **Step 3: Generate both assets with the existing system runtime**

Run:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
& 'E:\AI\Python\python.exe' 'output\resume\prepare_resume_assets.py'
```

Expected: `Prepared portrait and Digital Morse QR`; portrait is 500 x 600 and QR is non-empty.

- [ ] **Step 4: Decode the source QR and validate the portrait**

Run:

```powershell
& 'E:\AI\Python\python.exe' -c "import cv2; from PIL import Image; p='output/resume/assets/portrait.jpg'; q='output/resume/assets/digital-morse-qr.png'; assert Image.open(p).size==(500,600); value,points,_=cv2.QRCodeDetector().detectAndDecode(cv2.imread(q)); assert value=='https://aimorse.tech', value; print('PASS: portrait 5:6, QR=https://aimorse.tech')"
```

Expected: `PASS: portrait 5:6, QR=https://aimorse.tech`.

### Task 3: Migrate The Private Content Source To Revision 2

**Files:**
- Modify: `output/resume/private-resume-data.json`

- [ ] **Step 1: Add private asset references and exact credentials**

Add to `person`:

```json
"portrait_path": "assets/portrait.jpg",
"portfolio_qr_path": "assets/digital-morse-qr.png",
"portfolio_qr_label": "数字摩斯 · AI 作品集"
```

Replace `credentials` with exactly:

```json
[
  "第一届全国大学生数据分析大赛（Python组）省级一等奖",
  "大学英语六级（CET-6）",
  "雅思（IELTS）6.0"
]
```

Do not retain the vague innovation-competition line until both official event names are supplied.
Delete the unused top-level `shared_skills` object; each version's `skill_groups` is the rendered authority, and keeping a second stale copy would reintroduce tool-name drift.

- [ ] **Step 2: Replace the general summary with a value line and capability steps**

Use:

```json
"headline": "AI Agent Builder｜AI Native 产品工程师",
"value_line": "从企业 LLM 中转与模型接入，到 Agent 工作流、全栈开发和部署维护，独立完成 AI 产品的完整技术实现。",
"capability_steps": [
  "AI 开发环境",
  "LLM 中转与模型接入",
  "Agent 工作流",
  "全栈产品",
  "部署与持续迭代"
]
```

Replace the general current-role method bullet with:

```text
使用 Claude Code、Codex、WorkBuddy 和多 Agent 工作流完成需求拆解、实现与审查；以状态机、失败恢复、权限隔离、健康检查和人工确认保障交付。
```

Replace the Digital Morse metrics bullet with:

```text
系统已上线并持续维护，支持带来源 RAG、流式响应、停止与重试、幂等恢复、事务补偿及管理后台治理。
```

Add `WorkBuddy` to the general AI/Agent skills. Remove the legacy `summary` key after both new keys are present.

- [ ] **Step 3: Replace the targeted summary with the approved SOP positioning**

Use:

```json
"headline": "AI Product Builder｜跨境电商 · Vibe Coding",
"value_line": "把跨境获客与运营需求沉淀为可执行 SOP，再独立实现为可运行、可维护的全栈 AI 产品。",
"capability_steps": ["跨境业务需求", "SOP", "全栈开发"]
```

Use these three current-role bullets:

```json
[
  "对接外贸获客、内容运营与电商创作需求，将线索入池、官网富化、AI 评分、协同跟进、内容生成和发布校验沉淀为包含步骤、角色、状态、异常与人工确认的 SOP，并实现为可操作工作台。",
  "搭建企业内部 LLM 中转，维护官方 Claude 账号与多上游 Provider 通道，统一承接模型访问与应用接入；完成 AI 开发电脑的调研、选型与组装。",
  "使用 Claude Code、Codex、WorkBuddy 完成需求分析、架构、Python / FastAPI + TypeScript / React 全栈实现、测试和持续维护；独立交付 2 套已投入使用或部署运行的企业 AI 系统。"
]
```

Replace targeted `业务与 AI` skills with:

```text
跨境获客、SOP、业务流程拆解、Prompt、Agent 工作流、Claude Code、Codex、WorkBuddy、Provider 接入
```

Remove `GPT` from the targeted summary, current-role bullets, and skills. Keep `OpenAI API` only in the AI lead-generation project stack because it describes an actual integration.

- [ ] **Step 4: Validate JSON and forbidden wording**

Run:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -c "import json,pathlib; p=pathlib.Path('output/resume/private-resume-data.json'); d=json.loads(p.read_text(encoding='utf-8')); text=p.read_text(encoding='utf-8'); assert 'shared_skills' not in d; assert all('value_line' in d[v] and 'capability_steps' in d[v] for v in ('general','targeted')); assert 'RAG 46' not in text and 'Lighthouse' not in text; assert 'WorkBuddy' in text; assert 'GPT' not in text; print('PASS: Revision 2 private data')"
```

Expected: `PASS: Revision 2 private data`.

### Task 4: Add Revision 2 Shared Layout Primitives

**Files:**
- Modify: `output/resume/build_resumes.py:35-284`

- [ ] **Step 1: Replace section and color constants**

Use:

```python
COLOR_TEXT = "1F2933"
COLOR_HEADING = "1F2A37"
COLOR_MUTED = "64748B"
COLOR_ACCENT = "3B82F6"
COLOR_ACCENT_LIGHT = "EFF6FF"

SECTION_EDUCATION = "教育背景"
SECTION_EXPERIENCE = "工作经历"
SECTION_PROJECTS = "项目经历"
SECTION_SKILLS = "专业技能"
SECTION_CREDENTIALS = "语言与荣誉"
```

Delete `SECTION_SUMMARY`. Body order must be driven by the five constants above.

- [ ] **Step 2: Update `load_data` for Revision 2**

Require `portrait_path`, `portfolio_qr_path`, and `portfolio_qr_label` in `person`. Require `headline`, `value_line`, `capability_steps`, `experience_bullets`, `prior_experience_bullets`, `projects`, and `skill_groups` in both variants. Reject a targeted capability sequence other than `['跨境业务需求', 'SOP', '全栈开发']`.

Use this validation shape:

```python
required = {
    "person",
    "employment",
    "education",
    "credentials",
    "general",
    "targeted",
}
missing = required.difference(data)
if missing:
    raise ValueError(f"Resume data is missing top-level keys: {sorted(missing)}")

person_required = {
    "name", "phone", "email", "location",
    "github_label", "github_url", "portfolio_label", "portfolio_url",
    "portrait_path", "portfolio_qr_path", "portfolio_qr_label",
}
missing_person = person_required.difference(data["person"])
if missing_person:
    raise ValueError(f"Resume person data is missing keys: {sorted(missing_person)}")

variant_required = {
    "headline", "value_line", "capability_steps", "experience_bullets",
    "prior_experience_bullets", "projects", "skill_groups",
}
for variant in ("general", "targeted"):
    missing_variant = variant_required.difference(data[variant])
    if missing_variant:
        raise ValueError(
            f"Resume variant {variant!r} is missing keys: {sorted(missing_variant)}"
        )

if data["targeted"]["capability_steps"] != ["跨境业务需求", "SOP", "全栈开发"]:
    raise ValueError("Targeted capability line must be 跨境业务需求 -> SOP -> 全栈开发")
```

Use this asset resolver:

```python
def resolve_private_asset(relative_path: str) -> Path:
    path = (BASE_DIR / relative_path).resolve()
    if BASE_DIR.resolve() not in path.parents or not path.is_file():
        raise ValueError(f"Invalid or missing private resume asset: {relative_path}")
    return path
```

- [ ] **Step 3: Define shared content helpers**

Add:

```python
def capability_text(variant_data: dict) -> str:
    return " → ".join(variant_data["capability_steps"])


def project_meta(project: dict) -> str:
    value = project["meta"]
    return f"{value}｜{project['url']}" if project.get("url") else value
```

Both DOCX and PDF renderers must call these helpers rather than constructing different text.

- [ ] **Step 4: Raise the typography floor and redistribute DOCX spacing**

Add the shared size constants, make hyperlinks respect the same type scale, and replace the DOCX style/helper sizes so no hard-coded 10 pt run overrides the 10.5 pt body floor:

```python
NAME_SIZE = 20.5
HEADLINE_SIZE = 12.0
VALUE_SIZE = 10.5
BODY_SIZE = 10.5
SECTION_SIZE = 11.7
ENTRY_SIZE = 10.8
META_SIZE = 9.3
CONTACT_SIZE = 9.4
BODY_LEADING = 13.0
```

```python
def _add_text(
    paragraph,
    text: str,
    size: float = BODY_SIZE,
    bold: bool = False,
    color: str | None = None,
):
    run = paragraph.add_run(text)
    _set_run_font(run, size=size, bold=bold)
    if color:
        run.font.color.rgb = RGBColor.from_string(color)
    return run


def _add_hyperlink(
    paragraph,
    text: str,
    url: str,
    color: str = COLOR_ACCENT,
    size: float = CONTACT_SIZE,
) -> None:
    relationship_id = paragraph.part.relate_to(
        url,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        is_external=True,
    )
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), relationship_id)
    run = OxmlElement("w:r")
    run_properties = OxmlElement("w:rPr")

    run_fonts = OxmlElement("w:rFonts")
    for namespace in ("w:ascii", "w:hAnsi", "w:eastAsia"):
        run_fonts.set(qn(namespace), FONT_REGULAR)
    run_properties.append(run_fonts)

    run_color = OxmlElement("w:color")
    run_color.set(qn("w:val"), color)
    run_properties.append(run_color)

    half_points = str(int(round(size * 2)))
    for tag in ("w:sz", "w:szCs"):
        element = OxmlElement(tag)
        element.set(qn("w:val"), half_points)
        run_properties.append(element)

    text_element = OxmlElement("w:t")
    text_element.text = text
    run.append(run_properties)
    run.append(text_element)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)


def _configure_docx_styles(document: Document) -> None:
    styles = document.styles

    normal = styles["Normal"]
    _set_style_font(normal, BODY_SIZE)
    normal.font.color.rgb = RGBColor.from_string(COLOR_TEXT)
    normal.paragraph_format.space_after = Pt(0)
    normal.paragraph_format.line_spacing = Pt(BODY_LEADING)

    heading = styles["Heading 1"]
    _set_style_font(heading, SECTION_SIZE, bold=True)
    heading.font.color.rgb = RGBColor.from_string(COLOR_HEADING)
    heading.paragraph_format.space_before = Pt(6)
    heading.paragraph_format.space_after = Pt(2.5)
    heading.paragraph_format.keep_with_next = True
    heading.paragraph_format.keep_together = True

    list_bullet = styles["List Bullet"]
    _set_style_font(list_bullet, BODY_SIZE)
    list_bullet.font.color.rgb = RGBColor.from_string(COLOR_TEXT)
    list_bullet.paragraph_format.left_indent = Mm(4.2)
    list_bullet.paragraph_format.first_line_indent = Mm(-2.4)
    list_bullet.paragraph_format.space_after = Pt(1.5)
    list_bullet.paragraph_format.line_spacing = Pt(BODY_LEADING)
    list_bullet.paragraph_format.keep_together = True

    for style_name, size, bold in (
        ("Resume Meta", META_SIZE, False),
        ("Resume Entry", ENTRY_SIZE, True),
        ("Resume Compact", BODY_SIZE, False),
        ("Resume Capability", BODY_SIZE, True),
    ):
        if style_name not in styles:
            styles.add_style(style_name, WD_STYLE_TYPE.PARAGRAPH)
        _set_style_font(styles[style_name], size, bold=bold)

    meta = styles["Resume Meta"]
    meta.font.color.rgb = RGBColor.from_string(COLOR_MUTED)
    meta.paragraph_format.space_after = Pt(1.5)
    meta.paragraph_format.keep_with_next = True
    meta.paragraph_format.keep_together = True

    entry = styles["Resume Entry"]
    entry.font.color.rgb = RGBColor.from_string(COLOR_HEADING)
    entry.paragraph_format.space_before = Pt(3)
    entry.paragraph_format.space_after = Pt(0)
    entry.paragraph_format.keep_with_next = True
    entry.paragraph_format.keep_together = True

    compact = styles["Resume Compact"]
    compact.font.color.rgb = RGBColor.from_string(COLOR_TEXT)
    compact.paragraph_format.space_after = Pt(1.5)
    compact.paragraph_format.line_spacing = Pt(BODY_LEADING)
    compact.paragraph_format.keep_together = True

    capability = styles["Resume Capability"]
    capability.font.color.rgb = RGBColor.from_string(COLOR_ACCENT)
    capability.paragraph_format.space_before = Pt(3)
    capability.paragraph_format.space_after = Pt(3)
    capability.paragraph_format.line_spacing = Pt(BODY_LEADING)
    capability.paragraph_format.keep_together = True


def add_section_heading(document, title: str) -> None:
    paragraph = document.add_paragraph(style="Heading 1")
    _add_text(paragraph, title, size=SECTION_SIZE, bold=True, color=COLOR_HEADING)
    _set_cell_free_bottom_border(paragraph, COLOR_ACCENT, size=5)


def add_entry(document, heading: str, meta: str, bullets: list[str]) -> None:
    heading_paragraph = document.add_paragraph(style="Resume Entry")
    _add_text(heading_paragraph, heading, size=ENTRY_SIZE, bold=True, color=COLOR_HEADING)
    if meta:
        meta_paragraph = document.add_paragraph(style="Resume Meta")
        _add_text(meta_paragraph, meta, size=META_SIZE, color=COLOR_MUTED)
    for bullet in bullets:
        paragraph = document.add_paragraph(style="List Bullet")
        _add_text(paragraph, bullet, size=BODY_SIZE, color=COLOR_TEXT)


def _add_docx_skill_group(document: Document, label: str, value: str) -> None:
    paragraph = document.add_paragraph(style="Resume Compact")
    _add_text(paragraph, f"{label}：", size=BODY_SIZE, bold=True, color=COLOR_HEADING)
    _add_text(paragraph, value, size=BODY_SIZE, color=COLOR_TEXT)
```

Keep A4 portrait. In `build_docx`, set 12.5 mm left/right margins and 10.5 mm top/bottom margins. Reduce content only after using the page's vertical whitespace; never drop body text below 10.5 pt.

- [ ] **Step 5: Run a syntax and data-contract check**

Run:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m py_compile 'output\resume\build_resumes.py'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -c "import sys; sys.path.insert(0,'output/resume'); from build_resumes import load_data; load_data('output/resume/private-resume-data.json'); print('PASS: generator contract')"
```

Expected: `PASS: generator contract`.

### Task 5: Redesign The DOCX Renderer

**Files:**
- Modify: `output/resume/build_resumes.py:185-371`
- Test: `output/resume/qa_resumes.py`

- [ ] **Step 1: Add a borderless identity header with portrait**

Implement this interface:

```python
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT


def set_table_widths(table, widths: list) -> None:
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    properties = table._tbl.tblPr
    layout = properties.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        properties.append(layout)
    layout.set(qn("w:type"), "fixed")

    table_width = properties.find(qn("w:tblW"))
    if table_width is None:
        table_width = OxmlElement("w:tblW")
        properties.append(table_width)
    table_width.set(qn("w:type"), "dxa")
    table_width.set(qn("w:w"), str(sum(width.twips for width in widths)))

    for column, width in zip(table.columns, widths):
        column.width = width
    for row in table.rows:
        for cell, width in zip(row.cells, widths):
            cell.width = width


def remove_table_borders(table) -> None:
    properties = table._tbl.tblPr
    existing = properties.find(qn("w:tblBorders"))
    if existing is not None:
        properties.remove(existing)
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        element = OxmlElement(f"w:{edge}")
        element.set(qn("w:val"), "nil")
        borders.append(element)
    properties.append(borders)


def set_picture_alt_text(picture, text: str) -> None:
    picture._inline.docPr.set("name", text)
    picture._inline.docPr.set("title", text)
    picture._inline.docPr.set("descr", text)


def add_identity_text(cell, person: dict, variant_data: dict) -> None:
    name = cell.paragraphs[0]
    name.paragraph_format.space_after = Pt(0)
    _add_text(name, person["name"], size=NAME_SIZE, bold=True, color=COLOR_HEADING)

    headline = cell.add_paragraph()
    headline.paragraph_format.space_after = Pt(2)
    _add_text(
        headline,
        variant_data["headline"],
        size=HEADLINE_SIZE,
        bold=True,
        color=COLOR_ACCENT,
    )

    value = cell.add_paragraph()
    value.paragraph_format.space_after = Pt(2)
    _add_text(value, variant_data["value_line"], size=VALUE_SIZE, color=COLOR_TEXT)

    contact = cell.add_paragraph()
    contact.paragraph_format.space_after = Pt(0)
    _add_text(
        contact,
        f"{person['phone']}  |  {person['email']}  |  {person['location']}",
        size=CONTACT_SIZE,
        color=COLOR_MUTED,
    )

    links = cell.add_paragraph()
    _add_text(links, "GitHub: ", size=CONTACT_SIZE, color=COLOR_MUTED)
    _add_hyperlink(links, person["github_label"], person["github_url"], COLOR_ACCENT)
    _add_text(links, "  |  作品集: ", size=CONTACT_SIZE, color=COLOR_MUTED)
    _add_hyperlink(links, person["portfolio_label"], person["portfolio_url"], COLOR_ACCENT)


def add_identity_header(document: Document, person: dict, variant_data: dict) -> None:
    portrait_path = resolve_private_asset(person["portrait_path"])
    table = document.add_table(rows=1, cols=2)
    table.autofit = False
    set_table_widths(table, [Mm(145), Mm(39)])
    remove_table_borders(table)

    left, right = table.rows[0].cells
    left.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.TOP
    right.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.TOP
    add_identity_text(left, person, variant_data)
    paragraph = right.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run()
    picture = run.add_picture(str(portrait_path), width=Mm(30), height=Mm(36))
    set_picture_alt_text(picture, "候选人证件照")
```

`set_table_widths` must set fixed cell widths, and `remove_table_borders` must write `w:val="nil"` for all six borders. The left cell contains name, headline, value line, phone/email/location, GitHub, and the visible portfolio URL. Do not place contact data in a Word header/footer.

- [ ] **Step 2: Add the capability line**

Implement:

```python
def add_docx_capability_line(document: Document, variant_data: dict) -> None:
    paragraph = document.add_paragraph(style="Resume Capability")
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    properties = paragraph._p.get_or_add_pPr()
    shading = OxmlElement("w:shd")
    shading.set(qn("w:val"), "clear")
    shading.set(qn("w:color"), "auto")
    shading.set(qn("w:fill"), COLOR_ACCENT_LIGHT)
    properties.append(shading)
    _set_cell_free_bottom_border(paragraph, COLOR_ACCENT, size=4)
    _add_text(
        paragraph,
        capability_text(variant_data),
        size=BODY_SIZE,
        bold=True,
        color=COLOR_ACCENT,
    )
```

The `Resume Capability` style defined in Task 4 supplies 3 pt vertical spacing. Do not use a multi-column diagram or floating shapes.

- [ ] **Step 3: Render education first and credentials last**

Add the two section-body helpers:

```python
def add_education(document: Document, education: dict) -> None:
    paragraph = document.add_paragraph(style="Resume Compact")
    paragraph.paragraph_format.tab_stops.add_tab_stop(Mm(184), WD_TAB_ALIGNMENT.RIGHT)
    _add_text(
        paragraph,
        f"{education['school']}｜{education['degree']}",
        size=BODY_SIZE,
        bold=True,
        color=COLOR_HEADING,
    )
    _add_text(paragraph, f"\t{education['dates']}", size=META_SIZE, color=COLOR_MUTED)


def add_credentials(document: Document, credentials: list[str]) -> None:
    paragraph = document.add_paragraph(style="Resume Compact")
    _add_text(paragraph, "｜".join(credentials), size=BODY_SIZE, color=COLOR_TEXT)
```

The `build_docx` body order must be exactly:

```python
current_heading = f"{current_role['company']}｜{current_role['title']}"
current_meta = f"{current_role['location']}｜{current_role['dates']}"
prior_heading = f"{prior_role['company']}｜{prior_role['title']}"
prior_meta = f"{prior_role['location']}｜{prior_role['dates']}"

add_identity_header(document, person, variant_data)
add_docx_capability_line(document, variant_data)

add_section_heading(document, SECTION_EDUCATION)
add_education(document, data["education"][0])

add_section_heading(document, SECTION_EXPERIENCE)
add_entry(document, current_heading, current_meta, variant_data["experience_bullets"])
add_entry(document, prior_heading, prior_meta, variant_data["prior_experience_bullets"])

add_section_heading(document, SECTION_PROJECTS)
for project in variant_data["projects"]:
    add_entry(document, project["name"], project_meta(project), project["bullets"])

add_section_heading(document, SECTION_SKILLS)
for label, value in variant_data["skill_groups"].items():
    _add_docx_skill_group(document, label, value)

add_section_heading(document, SECTION_CREDENTIALS)
add_credentials(document, data["credentials"])
add_docx_portfolio_entry(document, person)
```

There must be no `职业概述` paragraph.

- [ ] **Step 4: Add the QR portfolio entry**

Implement a borderless two-cell row: left cell contains `数字摩斯 · AI 作品集` and the visible clickable `https://aimorse.tech`; right cell contains the 16 mm QR image. Add alt text `数字摩斯作品集二维码` to the picture. Keep this after credentials so `语言与荣誉` remains the final formal section.

```python
def add_docx_portfolio_entry(document: Document, person: dict) -> None:
    qr_path = resolve_private_asset(person["portfolio_qr_path"])
    table = document.add_table(rows=1, cols=2)
    set_table_widths(table, [Mm(160), Mm(24)])
    remove_table_borders(table)
    left, right = table.rows[0].cells

    label = left.paragraphs[0]
    _add_text(
        label,
        person["portfolio_qr_label"],
        size=BODY_SIZE,
        bold=True,
        color=COLOR_HEADING,
    )
    url = left.add_paragraph()
    _add_hyperlink(url, person["portfolio_url"], person["portfolio_url"], COLOR_ACCENT)

    qr_paragraph = right.paragraphs[0]
    qr_paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    qr_picture = qr_paragraph.add_run().add_picture(str(qr_path), width=Mm(16), height=Mm(16))
    set_picture_alt_text(qr_picture, "数字摩斯作品集二维码")
```

- [ ] **Step 5: Generate one DOCX directly and validate OOXML**

Run:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -c "import sys,json; sys.path.insert(0,'output/resume'); from build_resumes import load_data,build_docx; d=load_data('output/resume/private-resume-data.json'); build_docx(d,'general','output/resume/AI-Agent-Builder-Resume.docx'); print('PASS: general DOCX generated')"
$env:PYTHONUTF8='1'
& 'E:\AI\Python\python.exe' 'C:\Users\Administrator\.codex\skills\docx\scripts\office\validate.py' 'output\resume\AI-Agent-Builder-Resume.docx'
```

Expected: `PASS: general DOCX generated` and `All validations PASSED!`.

### Task 6: Redesign The PDF Renderer And Regenerate All Artifacts

**Files:**
- Modify: `output/resume/build_resumes.py:373-653`
- Replace: four resume artifacts

- [ ] **Step 1: Replace PDF colors, styles, and header**

Use a two-column ReportLab `Table` only for the identity header. The left cell contains a list of `Paragraph` objects for identity text; the right cell contains `Image(portrait_path, 30*mm, 36*mm)`. Set `VALIGN=TOP`, no visible grid, zero left/right padding at the page edge, and a 6 pt gap between columns.

Implement:

```python
from reportlab.platypus import Image, Table, TableStyle


def _pdf_styles() -> dict[str, ParagraphStyle]:
    return {
        "name": ParagraphStyle(
            "ResumeName",
            fontName=PDF_FONT_BOLD,
            fontSize=NAME_SIZE,
            leading=22.5,
            textColor=colors.HexColor(f"#{COLOR_HEADING}"),
            alignment=TA_LEFT,
            spaceAfter=0,
        ),
        "headline": ParagraphStyle(
            "ResumeHeadline",
            fontName=PDF_FONT_BOLD,
            fontSize=HEADLINE_SIZE,
            leading=14.5,
            textColor=colors.HexColor(f"#{COLOR_ACCENT}"),
            alignment=TA_LEFT,
            spaceAfter=2,
        ),
        "value": ParagraphStyle(
            "ResumeValue",
            fontName=PDF_FONT_REGULAR,
            fontSize=VALUE_SIZE,
            leading=BODY_LEADING,
            textColor=colors.HexColor(f"#{COLOR_TEXT}"),
            alignment=TA_LEFT,
            spaceAfter=2,
        ),
        "contact": ParagraphStyle(
            "ResumeContact",
            fontName=PDF_FONT_REGULAR,
            fontSize=CONTACT_SIZE,
            leading=11.5,
            textColor=colors.HexColor(f"#{COLOR_MUTED}"),
            alignment=TA_LEFT,
            spaceAfter=0,
        ),
        "capability": ParagraphStyle(
            "ResumeCapability",
            fontName=PDF_FONT_BOLD,
            fontSize=BODY_SIZE,
            leading=BODY_LEADING,
            textColor=colors.HexColor(f"#{COLOR_ACCENT}"),
            alignment=TA_CENTER,
            spaceAfter=0,
        ),
        "section": ParagraphStyle(
            "ResumeSection",
            fontName=PDF_FONT_BOLD,
            fontSize=SECTION_SIZE,
            leading=14,
            textColor=colors.HexColor(f"#{COLOR_HEADING}"),
            alignment=TA_LEFT,
            spaceBefore=6,
            spaceAfter=0,
            keepWithNext=True,
        ),
        "entry": ParagraphStyle(
            "ResumeEntry",
            fontName=PDF_FONT_BOLD,
            fontSize=ENTRY_SIZE,
            leading=13,
            textColor=colors.HexColor(f"#{COLOR_HEADING}"),
            alignment=TA_LEFT,
            spaceBefore=3,
            spaceAfter=0,
            keepWithNext=True,
        ),
        "meta": ParagraphStyle(
            "ResumeMeta",
            fontName=PDF_FONT_REGULAR,
            fontSize=META_SIZE,
            leading=11.2,
            textColor=colors.HexColor(f"#{COLOR_MUTED}"),
            alignment=TA_LEFT,
            spaceAfter=1.5,
            keepWithNext=True,
        ),
        "bullet": ParagraphStyle(
            "ResumeBullet",
            fontName=PDF_FONT_REGULAR,
            fontSize=BODY_SIZE,
            leading=BODY_LEADING,
            textColor=colors.HexColor(f"#{COLOR_TEXT}"),
            alignment=TA_LEFT,
            spaceAfter=1.5,
        ),
        "compact": ParagraphStyle(
            "ResumeCompact",
            fontName=PDF_FONT_REGULAR,
            fontSize=BODY_SIZE,
            leading=BODY_LEADING,
            textColor=colors.HexColor(f"#{COLOR_TEXT}"),
            alignment=TA_LEFT,
            spaceAfter=1.5,
        ),
    }


def pdf_contact_paragraph(person: dict, styles: dict) -> Paragraph:
    github = html_escape(person["github_url"], quote=True)
    portfolio = html_escape(person["portfolio_url"], quote=True)
    text = (
        _pdf_text(f"{person['phone']} | {person['email']} | {person['location']}")
        + "<br/>GitHub: "
        + f'<link href="{github}" color="#{COLOR_ACCENT}">{_pdf_text(person["github_label"])}</link>'
        + " | 作品集: "
        + f'<link href="{portfolio}" color="#{COLOR_ACCENT}">{_pdf_text(person["portfolio_label"])}</link>'
    )
    return Paragraph(text, styles["contact"])


def identity_table_style() -> TableStyle:
    return TableStyle(
        [
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (0, 0), 6),
            ("RIGHTPADDING", (1, 0), (1, 0), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ]
    )


def pdf_identity_header(person: dict, variant_data: dict, styles: dict) -> Table:
    left = [
        Paragraph(_pdf_text(person["name"]), styles["name"]),
        Paragraph(_pdf_text(variant_data["headline"]), styles["headline"]),
        Paragraph(_pdf_text(variant_data["value_line"]), styles["value"]),
        pdf_contact_paragraph(person, styles),
    ]
    portrait = Image(str(resolve_private_asset(person["portrait_path"])), width=30*mm, height=36*mm)
    return Table([[left, portrait]], colWidths=[145*mm, 39*mm], style=identity_table_style())
```

In `fit_story_to_one_page`, set `leftMargin=12.5 * mm`, `rightMargin=12.5 * mm`, `topMargin=10.5 * mm`, and `bottomMargin=10.5 * mm`; keep the existing one-page `PdfReader` gate unchanged.

- [ ] **Step 2: Add the PDF capability line and final portfolio row**

Render `capability_text(variant_data)` as one centered paragraph in a one-cell light-blue band with 4 pt vertical padding. Render the final portfolio entry as a borderless row with visible/clickable URL on the left and a 16 mm QR image on the right.

```python
def pdf_capability_band(variant_data: dict, styles: dict) -> Table:
    value = Paragraph(_pdf_text(capability_text(variant_data)), styles["capability"])
    return Table(
        [[value]],
        colWidths=[185 * mm],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(f"#{COLOR_ACCENT_LIGHT}")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(f"#{COLOR_ACCENT}")),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        ),
    )


def pdf_portfolio_entry(person: dict, styles: dict) -> Table:
    url = html_escape(person["portfolio_url"], quote=True)
    text = Paragraph(
        f'<b>{_pdf_text(person["portfolio_qr_label"])}</b><br/>'
        f'<link href="{url}" color="#{COLOR_ACCENT}">{_pdf_text(person["portfolio_url"])}</link>',
        styles["compact"],
    )
    qr = Image(
        str(resolve_private_asset(person["portfolio_qr_path"])),
        width=16 * mm,
        height=16 * mm,
    )
    return Table(
        [[text, qr]],
        colWidths=[161 * mm, 24 * mm],
        style=TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ]
        ),
    )
```

- [ ] **Step 3: Match the DOCX section order exactly**

The PDF story order must be identity header, capability line, education, work experience, projects, skills, language/honors, and portfolio entry. Remove the summary section. Continue using the same `add_entry` data, `project_meta`, and credentials as DOCX.

```python
def pdf_education(education: dict, styles: dict) -> Paragraph:
    school_and_degree = _pdf_text(f"{education['school']}｜{education['degree']}")
    dates = _pdf_text(education["dates"])
    return Paragraph(
        f'<b>{school_and_degree}</b>'
        f'　<font color="#{COLOR_MUTED}">{dates}</font>',
        styles["compact"],
    )


current_heading = f"{current_role['company']}｜{current_role['title']}"
current_meta = f"{current_role['location']}｜{current_role['dates']}"
prior_heading = f"{prior_role['company']}｜{prior_role['title']}"
prior_meta = f"{prior_role['location']}｜{prior_role['dates']}"

story.append(pdf_identity_header(person, variant_data, styles))
story.append(pdf_capability_band(variant_data, styles))

_pdf_section(story, SECTION_EDUCATION, styles)
story.append(pdf_education(data["education"][0], styles))

_pdf_section(story, SECTION_EXPERIENCE, styles)
_pdf_entry(story, current_heading, current_meta, variant_data["experience_bullets"], styles)
_pdf_entry(story, prior_heading, prior_meta, variant_data["prior_experience_bullets"], styles)

_pdf_section(story, SECTION_PROJECTS, styles)
for project in variant_data["projects"]:
    _pdf_entry(story, project["name"], project_meta(project), project["bullets"], styles)

_pdf_section(story, SECTION_SKILLS, styles)
for label, value in variant_data["skill_groups"].items():
    story.append(Paragraph(f"<b>{_pdf_text(label)}：</b>{_pdf_text(value)}", styles["compact"]))

_pdf_section(story, SECTION_CREDENTIALS, styles)
story.append(Paragraph(_pdf_text("｜".join(data["credentials"])), styles["compact"]))
story.append(pdf_portfolio_entry(person, styles))
```

- [ ] **Step 4: Generate all four artifacts**

Change the final `main()` status line to:

```python
print("Generated 4 Revision 2 resume artifacts")
```

Run:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'output\resume\build_resumes.py'
```

Expected: `Generated 4 Revision 2 resume artifacts`; each PDF page-count gate reports or implies exactly one page.

- [ ] **Step 5: Validate both DOCX files**

Run:

```powershell
$env:PYTHONUTF8='1'
& 'E:\AI\Python\python.exe' 'C:\Users\Administrator\.codex\skills\docx\scripts\office\validate.py' 'output\resume\AI-Agent-Builder-Resume.docx'
& 'E:\AI\Python\python.exe' 'C:\Users\Administrator\.codex\skills\docx\scripts\office\validate.py' 'output\resume\Cross-Border-Vibe-Coding-Resume.docx'
```

Expected: `All validations PASSED!` twice.

### Task 7: Complete Automated And Visual Acceptance

**Files:**
- Modify if a real defect is found: `output/resume/private-resume-data.json`
- Modify if a real defect is found: `output/resume/build_resumes.py`
- Modify if a contract defect is found: `output/resume/qa_resumes.py`
- Replace: `output/resume/qa/general-page-1.png`
- Replace: `output/resume/qa/targeted-page-1.png`

- [ ] **Step 1: Run the complete automated QA**

Run:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'output\resume\qa_resumes.py'
```

Expected:

```text
PASS: Revision 2, 4 artifacts, 2 one-page PDFs, portrait, QR, text parity, order, keywords, privacy
```

- [ ] **Step 2: Decode the QR from both full rendered pages**

Run:

```powershell
& 'E:\AI\Python\python.exe' -c "import cv2; paths=['output/resume/qa/general-page-1.png','output/resume/qa/targeted-page-1.png']; detector=cv2.QRCodeDetector(); values=[]; [values.append(detector.detectAndDecode(cv2.imread(p))[0]) for p in paths]; assert values==['https://aimorse.tech','https://aimorse.tech'], values; print('PASS: both rendered QR codes')"
```

Expected: `PASS: both rendered QR codes`.

- [ ] **Step 3: Inspect both rendered pages at original resolution**

Open both PNGs and verify:

- Portrait is sharp, proportional, and visually aligned with identity text.
- Name and role are the strongest first-view signals.
- Education is the first formal section.
- Capability line is readable but does not overpower work evidence.
- Work and project blocks preserve necessary detail without becoming a wall of text.
- Body text is approximately 10.5 pt with visibly improved line and section spacing.
- Content uses the page vertically; the final quarter is not completely empty or populated only by a detached QR code.
- Language/honors is the final formal section and the competition name is complete.
- QR and visible URL are legible and do not collide with credentials.
- No clipping, overlap, distorted glyphs, awkward one-word wraps, or content below the page boundary.
- General and targeted versions visibly share one design system while presenting different capability lines and projects.

- [ ] **Step 4: Iterate only from a diagnosed cause**

If a page overflows, adjust in this order:

1. Remove duplicated phrasing between work and project entries.
2. Tighten metadata or section spacing slightly.
3. Reduce portrait/QR size within their approved ranges.
4. Reduce low-priority technology repetition.

Do not remove necessary facts, move education away from first position, move credentials away from the end, restore deleted metrics, or reduce body font below 10.5 pt. Regenerate all four artifacts and rerun the complete QA after every correction.

### Task 8: Final Private Inventory And Handoff

**Files:**
- Inspect: `output/resume/`
- Inspect: Git status

- [ ] **Step 1: Remove only known transient implementation files**

Remove a task-created `output/resume/__pycache__/` only after resolving and listing its exact files. Keep the four deliverables, JSON, generator, QA script, asset-preparation script, two private assets, and two final QA renders. The historical comparison images may remain in `qa/` because they are private and useful for the user's review.

- [ ] **Step 2: Confirm exact artifact and privacy state**

Run:

```powershell
Get-ChildItem -LiteralPath 'output\resume' -Recurse -Force | Select-Object FullName,Length
git status --short --branch
git ls-files -- 'output/resume'
git check-ignore -v 'output\resume\AI-Agent-Builder-Resume.pdf'
git check-ignore -v 'output\resume\Cross-Border-Vibe-Coding-Resume.pdf'
```

Expected: all required private files exist; `git ls-files` returns nothing; both PDFs resolve to `.gitignore:12:output/`; no private output appears in Git status.

- [ ] **Step 3: Record the known DOCX rendering limitation**

Check for Microsoft Word, LibreOffice, or WPS. If none is installed, report that both DOCX packages passed OOXML validation and share content/layout rules with the verified one-page PDFs, but Office-engine pagination could not be freshly rendered on this machine. Do not claim an Office-rendered page count without evidence.

- [ ] **Step 4: Handoff**

Provide direct local links to the four deliverables. Report PDF page count, DOCX OOXML validation, text parity, formal section order, portrait inspection, QR decode, visual inspection, banned-metric/tool checks, and Git isolation. Report no commit, push, upload, deployment, or private-resume access change for the private artifacts.

---

## Final Verification Command Sequence

Run once after the final correction:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'output\resume\build_resumes.py'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$env:PYTHONUTF8='1'
& 'E:\AI\Python\python.exe' 'C:\Users\Administrator\.codex\skills\docx\scripts\office\validate.py' 'output\resume\AI-Agent-Builder-Resume.docx'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& 'E:\AI\Python\python.exe' 'C:\Users\Administrator\.codex\skills\docx\scripts\office\validate.py' 'output\resume\Cross-Border-Vibe-Coding-Resume.docx'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'output\resume\qa_resumes.py'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& 'E:\AI\Python\python.exe' -c "import cv2; paths=['output/resume/qa/general-page-1.png','output/resume/qa/targeted-page-1.png']; d=cv2.QRCodeDetector(); values=[d.detectAndDecode(cv2.imread(p))[0] for p in paths]; assert values==['https://aimorse.tech','https://aimorse.tech'], values; print('PASS: rendered QR decode')"
```

Expected terminal lines include:

```text
Generated 4 Revision 2 resume artifacts
All validations PASSED!
All validations PASSED!
PASS: Revision 2, 4 artifacts, 2 one-page PDFs, portrait, QR, text parity, order, keywords, privacy
PASS: rendered QR decode
```
