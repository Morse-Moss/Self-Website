# AI Native Dual Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce two private, one-page Chinese resumes as matching DOCX and PDF files: a general AI Agent Builder version and a cross-border e-commerce / Vibe Coding version.

**Architecture:** Extract personal facts from the supplied historical PDF and project facts from approved Revolution sources into one Git-ignored structured data file. Generate DOCX and PDF artifacts from that single source with shared typography and section rules, then verify page count, text extraction, JD keyword coverage, visual layout, privacy, and Git isolation.

**Tech Stack:** Python 3, python-docx, ReportLab, pypdf, pypdfium2, Windows Microsoft YaHei fonts, PowerShell, Git

---

## File Map

- Create: `output/resume/private-resume-data.json` - private structured facts and final section copy for both versions.
- Create: `output/resume/build_resumes.py` - deterministic DOCX and PDF generator reading the private data file.
- Create: `output/resume/qa_resumes.py` - structural, page-count, text-extraction, keyword, and privacy checks.
- Create: `output/resume/AI-Agent-Builder-Resume.docx` - editable general resume.
- Create: `output/resume/AI-Agent-Builder-Resume.pdf` - application-ready general resume.
- Create: `output/resume/Cross-Border-Vibe-Coding-Resume.docx` - editable targeted resume.
- Create: `output/resume/Cross-Border-Vibe-Coding-Resume.pdf` - application-ready targeted resume.
- Create: `output/resume/qa/general-page-1.png` - rendered general PDF for visual inspection.
- Create: `output/resume/qa/targeted-page-1.png` - rendered targeted PDF for visual inspection.
- Modify: none outside `output/resume/`; this plan file is the only tracked implementation artifact.

### Task 1: Build The Private Fact Base

**Files:**
- Create: `output/resume/private-resume-data.json`
- Read: the supplied historical resume PDF under `C:/Users/Administrator/Downloads/`, resolved by its verified file size and `*-AI应用.pdf` suffix without recording the private filename in Git
- Read: `content/site-content.json`
- Read: `docs/superpowers/specs/2026-07-21-ai-native-dual-resume-design.md`

- [ ] **Step 1: Create the ignored output directory**

Run:

```powershell
New-Item -ItemType Directory -Force -Path 'E:\Revolution\output\resume\qa'
git check-ignore -v 'output\resume\private-resume-data.json'
```

Expected: the directory exists and Git reports `.gitignore:12:output/`.

- [ ] **Step 2: Extract the historical resume facts**

Use pypdf to read the two-page source PDF. Capture the exact name, phone, email, education, earlier employment, language credentials, awards, and historical project facts. Do not copy the old professional summary or its outdated skill wording.

Run:

```powershell
$sourceResume = Get-ChildItem -LiteralPath 'C:\Users\Administrator\Downloads' -Filter '*-AI应用.pdf' | Where-Object { $_.Length -eq 227745 } | Select-Object -First 1
$env:SOURCE_RESUME = $sourceResume.FullName
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -c "import os; from pypdf import PdfReader; r=PdfReader(os.environ['SOURCE_RESUME']); print('pages=' + str(len(r.pages))); print(''.join((p.extract_text() or '') for p in r.pages))"
```

Expected: `pages=2`, followed by selectable Chinese text containing the candidate's education and experience.

- [ ] **Step 3: Build the structured JSON source**

Create UTF-8 JSON with the exact top-level keys `person`, `employment`, `education`, `credentials`, `shared_skills`, `general`, and `targeted`. Both variant objects contain `headline`, `summary`, `experience_bullets`, and `projects`. Populate every field from the confirmed discussion facts and current project states in `content/site-content.json`; keep all private values only in this ignored file.

- [ ] **Step 4: Validate fact boundaries**

Check the JSON against these rules:

- Current official employment title remains `AI应用工程师`.
- General positioning is `AI Agent Builder | AI Native 产品工程师`.
- Targeted positioning is `AI Product Builder | Vibe Coding` with cross-border relevance.
- Content creation Agent is marked enterprise intranet in use.
- Automated operations Agent is marked deployed; external-customer work is described as requirement discovery and pilot, not production customer delivery.
- AI lead generation is marked local MVP with a verified real workflow, not scaled acquisition.
- Deep research is marked core research chain usable.
- Digital Morse is marked live and continuously improved.
- Official Claude access and multiple upstream Provider integrations are described separately from KYC, payment instruments, and account sourcing.

### Task 2: Write The Two One-Page Content Variants

**Files:**
- Modify: `output/resume/private-resume-data.json`

- [ ] **Step 1: Write the general professional summary**

Keep it to no more than three short Chinese sentences. It must establish complete problem ownership, the infrastructure-to-product span, and the verified delivery states without using token counts, AI-generated code percentages, or unsupported business metrics.

- [ ] **Step 2: Write the general work-experience bullets**

Use three bullets with distinct jobs:

1. Scope: AI development hardware research, internal LLM relay, and end-to-end AI product delivery.
2. Delivery: independently complete product judgment, architecture, full-stack implementation, model integration, testing, deployment, and iteration across the approved systems.
3. Operating method: use Codex, Claude Code, multi-Agent workflows, tests, recoverable runtime design, and human approval gates to deliver safely.

Each bullet must include a concrete system state or technical scope and must not repeat a selected-project description verbatim.

- [ ] **Step 3: Select the general projects**

Use two project entries to preserve one-page density:

1. Enterprise content creation Agent.
2. Digital Morse.

Each project gets one compact problem/value sentence and one compact implementation/evidence sentence. Deep research appears only as a short capability reference in the current-employment scope bullet.

- [ ] **Step 4: Write the targeted professional summary**

Make the first screen match the supplied JD language: rigorous logic, complex business decomposition, Prompt translation, Claude Code / Codex / GPT-assisted delivery, runnable products, and ongoing maintenance.

- [ ] **Step 5: Write the targeted work-experience bullets**

Use three bullets with this order:

1. Translate cross-border and operations requirements into prompts, workflows, data models, and runnable tools.
2. Maintain official Claude access, an internal LLM relay, and multiple upstream Provider integrations for model availability.
3. Independently deliver and iterate full-stack AI products using Claude Code, Codex, GPT-class models, Python, FastAPI, TypeScript, React, and databases.

Do not mention physical cards, KYC identities, account resale, or ban circumvention.

- [ ] **Step 6: Select the targeted projects**

Use two primary entries:

1. AI lead generation for foreign trade.
2. Automated operations Agent.

Reference the enterprise content creation Agent in work experience as deployed-system and maintenance evidence instead of adding a third full project block.

- [ ] **Step 7: Compress supporting history**

Keep the previous software-development internship to one bullet. Keep the bachelor's degree, CET-6, IELTS 6.0, and the provincial Python data-analysis award. Omit the stock-prediction project and early studio role from both one-page versions.

### Task 3: Implement The Shared Resume Generator

**Files:**
- Create: `output/resume/build_resumes.py`
- Read: `output/resume/private-resume-data.json`

- [ ] **Step 1: Define deterministic styles**

Use A4 portrait, 13 mm side margins, 11 mm top/bottom margins, Microsoft YaHei, black body text, dark charcoal headings, and one restrained teal accent. Use 16-18 pt for the name, 10.5-11 pt for the headline, 10-10.5 pt for body text, and 10.5-11 pt for section headings. Do not use a portrait, charts, columns, text boxes, or icons.

- [ ] **Step 2: Implement the DOCX renderer**

Implement these exact interfaces:

- `load_data(path: str) -> dict` reads and validates UTF-8 JSON.
- `build_docx(data: dict, variant: str, output_path: str) -> None` creates one complete resume.
- `add_contact_line(document, person: dict) -> None` adds selectable contact and portfolio text.
- `add_section_heading(document, title: str) -> None` creates a standard heading paragraph.
- `add_entry(document, heading: str, meta: str, bullets: list[str]) -> None` creates one work or project entry with real bullet paragraphs.

Set both Latin and East Asian fonts in the DOCX XML. Use real bullet paragraphs and standard headings so Word and ATS preserve reading order.

- [ ] **Step 3: Implement the PDF renderer**

Implement these exact interfaces from the same data source:

- `register_fonts() -> None` registers Microsoft YaHei regular and bold font faces.
- `build_pdf(data: dict, variant: str, output_path: str) -> None` creates one complete selectable-text PDF.
- `fit_story_to_one_page(story, output_path: str) -> None` builds the PDF, checks the page count with pypdf, and raises a descriptive error when content exceeds one page.

Register `C:/Windows/Fonts/msyh.ttc` and `C:/Windows/Fonts/msyhbd.ttc`. Use ReportLab Platypus paragraphs and lists so all text remains selectable. Reduce spacing before reducing font size; never go below 10 pt body text.

- [ ] **Step 4: Generate all four artifacts**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'E:\Revolution\output\resume\build_resumes.py'
```

Expected: four non-empty DOCX/PDF files with the exact filenames in the File Map.

### Task 4: Add Automated Resume QA

**Files:**
- Create: `output/resume/qa_resumes.py`
- Read: four generated resume files

- [ ] **Step 1: Check artifact existence and privacy**

Assert all four files exist, are non-empty, and are ignored by Git. Assert no resume file appears in `git status --short`.

- [ ] **Step 2: Check PDF page count and selectable text**

Use pypdf to assert each PDF has exactly one page and extracted text contains these standard headings:

```text
工作经历
项目经历
专业技能
教育背景
```

- [ ] **Step 3: Check variant-specific keywords**

General PDF must contain `Agent`, `RAG`, `全栈`, `部署`, and `AI Native`.

Targeted PDF must contain `跨境`, `Vibe Coding`, `Claude Code`, `Codex`, `Prompt`, and `Provider` or `模型中转`.

The targeted PDF must not contain `实体卡`, `KYC`, `代实名`, `账号出售`, or `绕过封禁`.

- [ ] **Step 4: Check DOCX structure and text parity**

Use python-docx to extract paragraph text. Normalize whitespace and assert that every section heading and every bullet from the corresponding JSON variant appears in both DOCX and PDF text.

- [ ] **Step 5: Run automated QA**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'E:\Revolution\output\resume\qa_resumes.py'
```

Expected: `PASS: 4 artifacts, 2 one-page PDFs, text parity, keywords, privacy`.

### Task 5: Render And Visually Inspect Both PDFs

**Files:**
- Create: `output/resume/qa/general-page-1.png`
- Create: `output/resume/qa/targeted-page-1.png`

- [ ] **Step 1: Render both PDFs at 150 DPI**

Use pypdfium2 to render page 1 of each PDF to the exact PNG paths in the File Map.

Expected dimensions are approximately 1240 x 1754 pixels for A4 at 150 DPI.

- [ ] **Step 2: Inspect the rendered images**

Open both images and verify:

- No clipping, overlap, or content below the page boundary.
- Name and positioning are the strongest first-viewport signals.
- Section hierarchy remains scannable at normal zoom.
- Lines are not crowded and the smallest text is readable.
- URLs and dates do not wrap incoherently.
- Both pages look related while their targeted emphasis is visibly different.

- [ ] **Step 3: Iterate from the shared data or styles**

If content overflows, remove lower-priority history or tighten paragraph spacing. Do not silently remove required facts, shrink body text below 10 pt, or alter only one artifact format.

Regenerate all four artifacts and rerun Task 4 after every content or style change.

### Task 6: Final Privacy And Handoff Check

**Files:**
- Inspect: `output/resume/`
- Inspect: Git status

- [ ] **Step 1: Confirm exact private output set**

List `output/resume/` recursively. Keep the four deliverables, the private data and build/QA scripts, and the two QA images. Remove only transient files created by this implementation whose exact paths are known.

- [ ] **Step 2: Confirm repository isolation**

Run:

```powershell
git status --short
git check-ignore -v 'output\resume\AI-Agent-Builder-Resume.pdf'
git check-ignore -v 'output\resume\Cross-Border-Vibe-Coding-Resume.pdf'
```

Expected: pre-existing unrelated worktree entries remain unchanged; both PDFs resolve to `.gitignore:12:output/` and do not appear in Git status.

- [ ] **Step 3: Handoff**

Provide direct local links to all four deliverables. Report the one-page, text-extraction, keyword, visual, and privacy checks. Do not upload, publish, deploy, enable private-resume access, or call external services.
