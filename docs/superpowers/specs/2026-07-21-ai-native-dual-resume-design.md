# AI Native Dual Resume Design

Date: 2026-07-21
Status: Approved in conversation; written specification pending user review

## 1. Objective

Create two Chinese, one-page resumes from one evidence-controlled fact base:

1. A general AI Agent Builder resume.
2. A resume tailored to the supplied cross-border e-commerce / Vibe Coding job description.

Both resumes must communicate the candidate's unusual end-to-end ownership without sacrificing ATS readability or making claims that cannot be verified.

## 2. Source Hierarchy

Resume claims will use this precedence:

1. Facts explicitly confirmed by the candidate in the current resume discussion.
2. Current approved public facts in `content/site-content.json`.
3. The candidate's previous resume, used for identity, contact, education, earlier experience, language ability, awards, and historical projects.
4. Project documentation and verification evidence when a current claim needs confirmation.

Older drafts must not override newer confirmed facts or current project status.

## 3. Core Positioning

The shared differentiation model is:

> Complete problem ownership x cross-layer technical breadth x AI-native delivery system x verifiable products

The candidate should be presented as someone who can move from AI development infrastructure and model access through workflow design, full-stack implementation, deployment, recovery, and iteration.

`AI Native` must be demonstrated through work practices and system evidence, not used as an unsupported slogan. The official employment title remains unchanged in work history; market-facing positioning belongs in the resume headline.

## 4. Shared Resume Architecture

Each resume uses a single-column A4 layout with these standard sections:

1. Name, positioning headline, contact links, location.
2. Short professional summary.
3. Work Experience.
4. Selected Projects.
5. Skills.
6. Education and selected awards / language credentials.

The current role is the main narrative. Earlier experience is compressed. Projects that are already part of current employment must not be presented as unrelated duplicate achievements.

## 5. General Version

Working identity: `AI Agent Builder | AI Native Product Engineer`.

The general version emphasizes:

- End-to-end delivery from AI infrastructure and an internal LLM relay to deployed Agent products.
- Product judgment, architecture, front end, back end, data, model integration, testing, deployment, and iteration.
- Agent workflows, RAG, multi-model and multimodal integration, recoverable task execution, human approval gates, and evidence-based completion.
- Repeatable delivery across content production, operations, research, lead generation, and conversational knowledge products.

Primary project evidence:

- Enterprise content creation Agent.
- Digital Morse.
- Deep research Agent, used only if it fits the one-page density after stronger employment evidence.

## 6. Tailored Version

Working identity: `AI Product Builder | Vibe Coding` with cross-border business relevance.

The tailored version emphasizes:

- Translating complex cross-border business requirements into prompts, workflows, and runnable products.
- Rapid product loops using Claude Code, Codex, GPT-class models, and related AI development tools.
- Maintaining and iterating deployed systems rather than stopping at a prototype.
- Official Claude access, an internal LLM relay, and multiple upstream Provider integrations, described as model-access and reliability engineering.
- Cross-border lead generation, controlled operations workflows, and enterprise content production.

Primary project evidence is ordered as:

1. AI lead generation for foreign trade.
2. Automated operations Agent, including external customer requirement discovery and pilot status.
3. Enterprise content creation Agent.

The resume must not claim possession, resale, or circumvention of KYC accounts, payment instruments, or platform controls. Official-account usage and legitimate Provider integration are separate claims.

## 7. Content Selection Rules

- Keep each resume to one page.
- Prefer a few high-signal achievements over a complete project inventory.
- Use action, scope, resulting product state, and verified outcomes where available.
- Do not invent adoption, revenue, time savings, user counts, or production status.
- Do not use token counts, session counts, AI-generated code percentages, or similar vanity metrics.
- Name relevant technologies where they improve ATS matching or technical credibility.
- Preserve honest status labels: deployed, in use, pilot, local MVP verified, core chain usable, or live.
- State complete technical ownership without implying that every business idea originated solely from the candidate.

## 8. ATS And Visual Design

- One column, no portrait, charts, progress bars, text boxes, or decorative sidebars.
- Standard section headings and selectable text.
- Readable Chinese system font with a minimum equivalent of 10 pt body text.
- Restrained black, white, and one neutral accent color.
- URLs remain visible or embedded in descriptive link text.
- The PDF must preserve reading order when copied to plain text.

The visual distinction comes from hierarchy and evidence density, not unconventional formatting.

## 9. Deliverables And Privacy

Create four private local artifacts:

- General AI Agent Builder DOCX.
- General AI Agent Builder PDF.
- Cross-border / Vibe Coding tailored DOCX.
- Cross-border / Vibe Coding tailored PDF.

Final files belong under a Git-ignored private output directory. Personal contact details, employer details, account information, and the resume files themselves must not be committed, published, ingested into RAG, or added to public site content.

## 10. Verification

Before handoff:

- Confirm both PDFs are exactly one page.
- Confirm DOCX and PDF text is selectable and has the same content.
- Run a plain-text extraction check for section order and missing characters.
- Render both PDFs and inspect clipping, spacing, line breaks, and link visibility.
- Check that every current project state matches the approved evidence source.
- Check that the targeted version contains the main JD keywords without keyword stuffing.
- Scan the output directory for accidental extra copies and public-repository exposure.

## 11. Out Of Scope

- Publishing or deploying either resume.
- Uploading a resume to the private resume service.
- Enabling resume access on the public site.
- Creating or sourcing Claude accounts, payment cards, or KYC identities.
- Changing public portfolio copy during resume production.
