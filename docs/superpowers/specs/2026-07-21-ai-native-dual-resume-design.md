# AI Native Dual Resume Design

> Absorption note (2026-07-25): This document is retained as approved design history. It is not an active task pointer and does not prove that any private artifact was generated, uploaded, or deployed. Current private-resume runtime and release status is owned by `docs/verify/private-resume/`.

Date: 2026-07-21
Revision: 2
Status: Approved by the candidate on 2026-07-21

The existing Revision 1 implementation is superseded by this revision. The replacement implementation plan at `docs/superpowers/plans/2026-07-21-ai-native-dual-resume.md` must implement this approved specification.

## 1. Objective

Create two Chinese, one-page resumes from one evidence-controlled fact base:

1. A general `AI Agent Builder | AI Native 产品工程师` resume.
2. A `AI Product Builder | 跨境电商 · Vibe Coding` resume tailored to the first supplied job description.

Both versions must work for direct recruiter review and ATS ingestion. They should look recognizably designed without turning into a graphic poster, preserve necessary career information, and make the candidate's unusual cross-layer ownership understandable within a short scan.

## 2. Source Hierarchy

Resume claims use this precedence:

1. Facts and wording decisions explicitly confirmed by the candidate in the current resume discussion.
2. Current approved public facts in `content/site-content.json`.
3. The candidate's previous resume, used for identity, contact, education, earlier experience, language ability, awards, and the original portrait.
4. Project documentation and verification evidence when a current claim needs confirmation.
5. The local Tech Interview Handbook resume guide and improvement case study for structure, prioritization, and ATS constraints.

Older drafts must not override newer confirmed facts or current project status. Missing official names, metrics, or outcomes must not be reconstructed from guesswork.

## 3. Core Positioning

The shared differentiation model is:

> Complete problem ownership x business-to-system translation x cross-layer engineering x verifiable product delivery

The candidate is not positioned as someone who merely uses AI coding tools. The resume must show the ability to understand a business problem, define an executable process, implement the product across front end, back end, data and model layers, and carry it through deployment and maintenance.

The official employment title remains `AI应用工程师`. Market-facing positioning belongs in the resume headline and must not be presented as a company-granted title.

AI development tools and model access are separate categories:

- AI development tools: `Claude Code`, `Codex`, and `WorkBuddy`.
- Model access and reliability: official Claude access, the enterprise LLM relay, and multiple upstream Provider integrations.
- `GPT` must not be listed beside Codex as a separate AI development tool. `OpenAI API` may appear only in a project stack where it was actually integrated.

## 4. Shared Information Architecture

The page uses one ATS-safe body column. Only the identity header may use a simple left-text/right-photo arrangement.

The scan order is:

1. **Identity header**: name, market-facing headline, one concise value line, contact information, portfolio URL, and portrait.
2. **Capability line**: one short visual sequence that communicates the version's end-to-end delivery path. It is part of the header, not a separate resume section.
3. **教育背景**: the first formal section, containing university, major, degree, and dates only.
4. **工作经历**: current role first, followed by the earlier software-development internship.
5. **项目经历**: two version-specific representative systems.
6. **专业技能**: three horizontally scannable groups rather than one dense keyword paragraph.
7. **语言与荣誉**: full competition names and language credentials at the end.
8. **Portfolio entry**: a visible clickable URL plus a small QR code that resolves directly to `https://aimorse.tech`.

There is no standalone multi-line `职业概述` section. Its useful content is divided between the headline, one value line, the capability line, and the current-role evidence.

## 5. Visual System

The selected direction is a hybrid evidence-first design: visually distinctive for a human reviewer while retaining standard headings and plain-text reading order for ATS.

### 5.1 Page And Typography

- A4 portrait, one page.
- Approximately 12-13 mm side margins and 10-12 mm top/bottom margins.
- Microsoft YaHei or an equivalent ATS-safe Chinese system font.
- Candidate name: approximately 20-21 pt.
- Market headline: approximately 12 pt.
- Section headings: approximately 11.5-12 pt.
- Body text: approximately 10.5 pt, never reduced to solve overflow.
- Metadata and contact text may be smaller than body text but must remain comfortably readable.
- Increase line spacing, section spacing, and project separation so content is distributed through the page instead of being compressed into the upper portion.

### 5.2 Color And Hierarchy

- White background, dark navy-charcoal body text, and one cool blue accent compatible with the portrait's blue background.
- No teal from Revision 1.
- Use font weight, spacing, a restrained rule, and muted metadata to create hierarchy.
- Do not use large color blocks, timelines, progress bars, rating charts, decorative sidebars, or repeated card containers.

### 5.3 Portrait

- Restore the portrait embedded in the historical resume.
- Place it at the upper right at approximately 30 x 36 mm.
- Use a professional rectangular crop; do not convert it into a circular avatar.
- Crop and resize only. Do not alter facial features or invent a replacement portrait.

### 5.4 QR Code

- Add a small functional QR code near the visible portfolio URL.
- Encode the exact URL `https://aimorse.tech`; do not use a redirect or tracking service.
- Label it `数字摩斯 · AI 作品集` so its purpose is clear.
- Keep the URL selectable and clickable because a QR code is inconvenient when the resume is viewed on the same phone.

## 6. General Version

Headline:

> AI Agent Builder | AI Native 产品工程师

Capability line:

> AI 开发环境 -> LLM 中转与模型接入 -> Agent 工作流 -> 全栈产品 -> 部署与持续迭代

The general version emphasizes:

- AI development workstation research, selection, and assembly.
- Enterprise LLM relay construction, official Claude access, and multiple upstream Provider integrations.
- Product judgment, architecture, front end, back end, data, model integration, testing, deployment, recovery, and iteration.
- Repeatable delivery across content production, operations, foreign-trade lead generation, deep research, and conversational knowledge products.
- AI-native engineering through executable workflows, recoverable state, tests, review, and human confirmation, not through unsupported productivity claims.

Primary project evidence:

1. Enterprise content creation Agent.
2. Digital Morse.

RAG may remain as a technical capability where relevant. The strings `RAG 46/46`, `top-3 46/46`, `Lighthouse 99`, and `Lighthouse 99/99` must not appear anywhere in either resume.

## 7. Tailored Version

Headline:

> AI Product Builder | 跨境电商 · Vibe Coding

Primary capability line:

> 跨境业务需求 -> SOP -> 全栈开发

The tailored version emphasizes:

- Understanding cross-border lead-generation, content, and operations requirements.
- Turning a business requirement into an executable SOP covering steps, roles, state transitions, prompts, data models, exception handling, and human confirmation points.
- Turning the SOP into a runnable full-stack product and maintaining it after delivery.
- Using Claude Code, Codex, and WorkBuddy as development tools without making tool names the core value proposition.
- Maintaining official Claude access, an enterprise LLM relay, and multiple upstream Provider integrations as a separate model-access capability.

Primary project evidence:

1. AI lead generation for foreign trade, described as a local MVP with a verified real workflow.
2. Automated operations Agent, described as deployed with external-customer requirement discovery and pilot activity.

The enterprise content creation Agent appears in work experience as evidence of enterprise adoption and continued maintenance. It does not become a third full project block.

The resume must not claim possession, resale, or circumvention of KYC accounts, payment instruments, identities, or platform controls. Official-account usage and legitimate Provider integration are separate claims.

## 8. Content Retention And Compression

The redesign is primarily a layout and hierarchy correction, not an aggressive deletion exercise.

- Preserve necessary facts from the current role, selected projects, earlier internship, education, skills, and credentials.
- Remove duplicated explanations when the same system appears in both work experience and project experience.
- Keep the current role to three differentiated evidence bullets: responsibility span, delivered system states, and AI-native delivery method.
- Keep the earlier internship concise but retain its concrete CSV, SQL, Java, database, and Git work.
- Keep two representative projects per version. Each project retains business context, ownership, implementation scope, stack, and honest current state.
- Keep three skill groups with concrete technologies, but avoid repeating the same tool across the headline, capability line, work bullets, projects, and skills without a role-specific reason.
- Preserve approximately 80-90% of useful factual information while improving scan speed through typography, spacing, grouping, and de-duplication.

Do not invent adoption, revenue, time savings, user counts, production status, or customer outcomes. Do not use token counts, session counts, AI-generated code percentages, RAG benchmark counts, Lighthouse scores, or similar vanity metrics.

## 9. Education, Language, And Honors

`教育背景` is the first formal section and includes only:

- University.
- Major and degree.
- Attendance dates.

`语言与荣誉` is the final section. Use official full names rather than shorthand:

- `第一届全国大学生数据分析大赛（Python组）省级一等奖`.
- `大学英语六级（CET-6）`.
- `雅思（IELTS）6.0`.

The historical resume only says `两次大学生创新创业大赛省级项目负责人成功结项` and does not identify the two events. Do not include that vague line in the generated resumes unless the candidate supplies both official full names.

## 10. Deliverables And Privacy

Create four private local artifacts:

- General AI Agent Builder DOCX.
- General AI Agent Builder PDF.
- Cross-border / Vibe Coding tailored DOCX.
- Cross-border / Vibe Coding tailored PDF.

The four artifacts continue to use one private structured source. Final files, the extracted portrait, personal contact details, employer details, and the generated QR asset remain under a Git-ignored private output directory. They must not be committed, published, uploaded, ingested into RAG, or added to public site content.

## 11. Verification

Before handoff:

- Confirm both PDFs are exactly one page.
- Confirm DOCX and PDF text is selectable and has matching visible content.
- Confirm plain-text section order is identity, education, work experience, projects, skills, language and honors.
- Confirm education is the first formal section and language/honors is the final formal section.
- Confirm the body font remains approximately 10.5 pt and visual spacing is distributed through the page.
- Confirm the portrait is present, proportionally cropped, and not distorted.
- Decode the QR code and confirm the exact result is `https://aimorse.tech`.
- Confirm the visible portfolio URL remains selectable and clickable.
- Confirm the full competition name appears and shorthand forms do not.
- Confirm `Claude Code`, `Codex`, and `WorkBuddy` are the development-tool trio; `GPT` is not listed as a peer development tool.
- Confirm the targeted capability line reads `跨境业务需求 -> SOP -> 全栈开发`.
- Confirm the removed RAG and Lighthouse metrics do not appear.
- Render both PDFs and inspect clipping, overlap, line breaks, density, visual hierarchy, portrait quality, and QR readability.
- Confirm every current project state matches the approved evidence source.
- Confirm all private outputs remain ignored by Git and no private field enters a tracked diff.

## 12. Out Of Scope

- Publishing or deploying either resume.
- Uploading a resume to the private resume service.
- Enabling resume access on the public site.
- Replacing or generatively altering the candidate portrait.
- Creating or sourcing Claude accounts, payment cards, KYC identities, or other access materials.
- Changing public portfolio copy during resume production.
