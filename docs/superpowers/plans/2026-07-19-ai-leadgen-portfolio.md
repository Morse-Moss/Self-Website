# AI Leadgen Portfolio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved AI foreign-trade lead-generation system to the portfolio, public knowledge source, and evaluation contracts, using the confirmed real Graphite dashboard image.

**Architecture:** Extend the existing five-section project detail model with optional per-project section titles, then add `ai-leadgen` as a fifth project through the same JSON-driven rendering and public-knowledge pipeline. Keep the current portfolio layout and interaction model; add one project-specific Playwright smoke for desktop and mobile acceptance.

**Tech Stack:** Next.js App Router, React 19, TypeScript, CSS Modules, JSON content, Node test runner, Python Playwright.

**Status:** Implemented and verified locally on 2026-07-19. Push, production knowledge ingestion, and deployment remain approval-gated.

---

## Scope And Boundaries

- Own `ai-leadgen` portfolio content, its public image, public knowledge topics, evaluation cases, and required shared contracts.
- Preserve the approved facts and presentation of the four existing projects.
- Read `E:\Two` only as an evidence and image source; do not edit its code, data, configuration, or runtime.
- Do not call OpenAI, Feishu, Alibaba Mail, SMTP, or IMAP providers.
- Stop at verified local acceptance. Push, production knowledge ingestion, and deployment remain separate approval gates.

### Task 1: Lock The Fifth-Project And Heading Contracts

**Files:**
- Modify: `tests/site-content.test.ts`
- Modify: `tests/works-presentation.test.ts`
- Modify: `tests/routes-contract.test.ts`

- [ ] **Step 1: Add failing project content assertions**

Assert that `projectSlugs` and the project collection include `ai-leadgen`, then verify the exact approved name, summary, status, five capability tags, image path, six knowledge topic IDs, prompt, five detail sections, and prohibited claims.

```ts
assert.equal(project.name, "AI 外贸获客系统");
assert.equal(project.status, "唯一开发者 · 本地 MVP 真实链路已验证");
assert.deepEqual(project.capabilities, [
  "线索数据归一化",
  "官网信息富化",
  "AI 线索评分",
  "飞书协同",
  "阿里邮箱 OpenAPI",
]);
assert.deepEqual(project.details?.sectionTitles, {
  overview: "为什么做",
  implementation: "技术实现",
});
```

- [ ] **Step 2: Add failing rendering-contract assertions**

Require `CaseStudy` to read optional section titles while retaining the defaults for all existing projects.

```ts
assert.match(source, /details\.sectionTitles\?\.overview \?\? ['"]项目简介['"]/);
assert.match(source, /details\.sectionTitles\?\.implementation \?\? ['"]我的技术实现['"]/);
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
node --test tests/site-content.test.ts tests/works-presentation.test.ts tests/routes-contract.test.ts
```

Expected: FAIL because `ai-leadgen` and `ProjectDetails.sectionTitles` do not exist yet.

### Task 2: Lock Public Knowledge And Evaluation Contracts

**Files:**
- Modify: `tests/public-knowledge.test.ts`
- Modify: `tests/rag-eval-contract.test.ts`
- Modify: `content/rag-eval.json`
- Modify: `content/chat-eval.json`

- [ ] **Step 1: Add failing public-knowledge assertions**

Require the aggregate document plus six independently retrievable topics at `/works#ai-leadgen`.

```ts
const expectedIds = [
  "project-ai-leadgen",
  "project-ai-leadgen-overview",
  "project-ai-leadgen-acquisition",
  "project-ai-leadgen-scoring",
  "project-ai-leadgen-collaboration",
  "project-ai-leadgen-outreach",
  "project-ai-leadgen-role",
];
```

- [ ] **Step 2: Add positive and negative evaluation cases**

Add gold queries for project positioning, lead acquisition and enrichment, AI scoring, Feishu collaboration, Alibaba Mail outreach and reply handling, and personal technical scope. Add boundary questions that explicitly challenge unsupported Apify, Apollo, WhatsApp, AI-written outreach, AI-generated customer replies, and production deployment claims; keep the unrelated-query calibration set unchanged.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
node --test tests/public-knowledge.test.ts tests/rag-eval-contract.test.ts
```

Expected: FAIL because the new public documents and allowlisted project hash do not exist.

### Task 3: Implement The Shared Detail Heading Extension

**Files:**
- Modify: `lib/site-content.ts`
- Modify: `components/works/CaseStudy.tsx`

- [ ] **Step 1: Add the optional type**

```ts
export type ProjectDetails = {
  sectionTitles?: {
    overview?: string;
    implementation?: string;
  };
  overview: string[];
  // existing fields remain unchanged
};
```

- [ ] **Step 2: Render project-specific titles with stable defaults**

```ts
const overviewTitle = details.sectionTitles?.overview ?? "项目简介";
const implementationTitle = details.sectionTitles?.implementation ?? "我的技术实现";
```

Use these values only for sections 01 and 04. Keep sections 02, 03, and 05 unchanged.

- [ ] **Step 3: Run the rendering contract**

Run:

```powershell
node --test tests/works-presentation.test.ts tests/routes-contract.test.ts
```

Expected: PASS for the heading extension; content tests remain RED until the new project is added.

### Task 4: Add The Approved AI Leadgen Project And Image

**Files:**
- Modify: `content/site-content.json`
- Modify: `lib/site-content.ts`
- Create: `public/works/ai-leadgen/graphite-dashboard-real-2026-07-19.png`

- [ ] **Step 1: Copy the confirmed image without modifying pixels**

Copy `E:\Two\tmp\portfolio-review\leadgen-desktop.png` to the public asset path. Verify width `1440`, height `1272`, and SHA256 `026404371270ECAB10313A9F505677740A7621910DDCF33DDA180D6F5C3310D7`.

- [ ] **Step 2: Add `ai-leadgen` to the canonical slug order**

Place it after `auto-operations` so the business systems stay grouped before research and Digital Morse.

- [ ] **Step 3: Add the exact approved project object**

Use the content from `docs/superpowers/specs/2026-07-19-ai-leadgen-works-content-design.md`, including:

- exact collapsed summary, status, and five tags;
- `真实运行界面` image label;
- `为什么做`, `核心能力`, `系统架构`, `技术实现`, `技术栈` detail order;
- six knowledge topics: `overview`, `acquisition`, `scoring`, `collaboration`, `outreach`, `role`;
- chat prefill `我想了解 AI 外贸获客系统`;
- no unsupported Apify, Apollo, WhatsApp, AI-written outreach, AI-generated customer reply, or production-deployment claim.

- [ ] **Step 4: Update five-project global copy**

Change public references from four systems to five systems or neutral “这些项目” wording without altering the four existing project stories.

- [ ] **Step 5: Run content and route contracts**

Run:

```powershell
node --test tests/site-content.test.ts tests/works-presentation.test.ts tests/routes-contract.test.ts tests/work-asset.test.ts
```

Expected: PASS.

### Task 5: Wire Public Knowledge And Chat Evaluation Sources

**Files:**
- Modify: `lib/server/public-knowledge.ts`
- Modify: `scripts/chat-eval.mjs`
- Modify: `content/chat-eval.json`

- [ ] **Step 1: Add the public project slug**

Add `ai-leadgen` to `publicProjectSlugs` so aggregate and topic document IDs resolve to `/works#ai-leadgen`.

- [ ] **Step 2: Add the deterministic chat-eval source**

```js
'ai-leadgen': {
  chunkId: 'eval-ai-leadgen',
  documentId: 'project-ai-leadgen',
  title: 'AI 外贸获客系统',
  sourcePath: 'content/site-content.json#projects.ai-leadgen',
  href: '/works#ai-leadgen',
  content: 'AI 外贸获客系统连接线索获取、官网富化、AI 评分、飞书协同、邮件触达与回信跟进。',
  score: 1,
},
```

- [ ] **Step 3: Run public knowledge and evaluation contracts**

Run:

```powershell
node --test tests/public-knowledge.test.ts tests/rag-eval-contract.test.ts
npm run chat:eval
```

Expected: PASS with all five project hashes represented.

### Task 6: Add Desktop And Mobile Visual Acceptance

**Files:**
- Create: `scripts/ai-leadgen-visual-smoke.py`
- Modify: `package.json`
- Modify: `scripts/s9-visual-smoke.mjs`
- Create: `docs/verify/ai-leadgen/portfolio-ai-leadgen-desktop-1440x900.png`
- Create: `docs/verify/ai-leadgen/portfolio-ai-leadgen-mobile-390x844.png`

- [ ] **Step 1: Add a Playwright smoke based on the existing project scripts**

Verify the `ai-leadgen` card, exact collapsed copy, five tags, real image badge, detail headings, hash synchronization, image load, chat prefill, zero horizontal overflow, zero console errors, and zero page errors at `1440x900` and `390x844`.

- [ ] **Step 2: Add the fifth slug to the shared S9 interaction smoke**

Update `SAFE_SLUGS` and the ordered `slugs` array so global expand, collapse, hash, keyboard, scroll, and reduced-motion coverage includes `ai-leadgen`.

- [ ] **Step 3: Start a local production server and run both smokes**

Run:

```powershell
npm run build
npm run start -- --hostname 127.0.0.1 --port 3010
py -X utf8 scripts/ai-leadgen-visual-smoke.py http://127.0.0.1:3010
npm run visual:s9 -- http://127.0.0.1:3010
```

Expected: both viewports pass and write fresh screenshots under `docs/verify/ai-leadgen/`.

### Task 7: Full Local Verification And Knowledge Reconciliation

**Files:**
- Modify: `docs/portfolio-blueprint.md`
- Create: `docs/verify/ai-leadgen/ai-leadgen-closeout.md`

- [ ] **Step 1: Run the full suite and production build**

```powershell
npm test
npm run build
```

Expected: all tests and all production routes pass.

- [ ] **Step 2: Inspect the final scoped diff and workspace status**

Confirm only the approved implementation files and generated `ai-leadgen` evidence are included. Leave existing untracked `AGENTS.md`, research files, and unrelated screenshots untouched.

- [ ] **Step 3: Record local evidence**

Write the exact test counts, build result, image hash, browser checks, screenshots, and remaining external gates in `docs/verify/ai-leadgen/ai-leadgen-closeout.md`.

- [ ] **Step 4: Stop at local acceptance**

Present the local URL and evidence to the user. Do not push, ingest production knowledge, or deploy until the user explicitly approves those actions.
