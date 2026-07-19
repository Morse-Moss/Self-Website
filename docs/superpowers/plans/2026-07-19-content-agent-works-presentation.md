# Content Agent Works Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the verbose works presentation with a concise project-resume layout and publish the approved Content Agent story and knowledge facts without changing the Content Agent product itself.

**Architecture:** Add an optional five-section `details` contract to each portfolio project. The Content Agent receives the complete approved contract now; projects owned by other threads temporarily map their existing `caseStudy` facts into the same five visible headings. Public knowledge extraction prefers `details` and never includes legacy evidence or boundary arrays in the default project document.

**Tech Stack:** Next.js App Router, React 19, TypeScript, CSS Modules, JSON content, Node test runner, Python Playwright.

---

## Scope And Ownership

This thread owns:

- `app/(portfolio)/works/`
- `components/works/ProjectCard*`
- `components/works/CaseStudy*`
- `components/works/ProjectGallery.module.css`
- shared portfolio types and public-knowledge normalization
- the `content-agent` entry in `content/site-content.json`
- Content Agent contract and visual tests

This thread does not rewrite `auto-operations`, `deep-research`, or `digital-morse`. Their existing data must continue to render through the compatibility mapping until their dedicated threads supply approved `details` data.

Do not stage the existing unknown-owner changes in `app/(portfolio)/page.module.css`, `AGENTS.md`, research reports, or unrelated verification images.

## File Map

- `lib/site-content.ts`: public project types, including the optional five-section detail contract.
- `content/site-content.json`: works title, approved Content Agent card copy, detail copy, stack, media badge, CTA prompt, and knowledge topics.
- `lib/server/public-knowledge.ts`: converts approved project details into retrievable public documents and excludes legacy audit sections.
- `app/(portfolio)/works/page.tsx`: one-line “代表作品” page heading.
- `app/(portfolio)/works/page.module.css`: centered compact heading and first-project viewport rhythm.
- `components/works/ProjectGallery.module.css`: one project row per line.
- `components/works/ProjectCard.tsx`: image, short summary, tags, status, icon-only expansion control, and detail presence lifecycle.
- `components/works/ProjectCard.module.css`: horizontal desktop row, single-column mobile row, media badge, two-line clamp, and stable icon control.
- `components/works/CaseStudy.tsx`: new five-section detail renderer and detail-footer actions.
- `components/works/CaseStudy.module.css`: unframed numbered sections, architecture flow/modules, implementation block, stack, and actions.
- `tests/works-presentation.test.ts`: current live presentation contract.
- `tests/site-content.test.ts`: exact Content Agent public facts.
- `tests/public-knowledge.test.ts`: knowledge extraction order and exclusion rules.
- `content/rag-eval.json`: retrieval questions aligned to the approved model and deployment wording.
- `scripts/s7-contract.test.mjs`: approved black-gold media contract without visible evidence prose.
- `scripts/s9-visual-smoke.mjs`: current gallery privacy/media expectation and Content Agent screenshot target.
- `scripts/content-agent-visual-smoke.py`: focused 1440/390 Content Agent layout, copy, CTA, image, overflow, and console acceptance.

### Task 1: Freeze The New Live Contract

**Files:**

- Create: `tests/works-presentation.test.ts`

- [ ] **Step 1: Add the failing presentation contract**

Create the test with these exact assertions:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getProjectBySlug, siteContent } from "../lib/site-content.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("works page exposes only the concise representative-work heading", () => {
  const source = read("app/(portfolio)/works/page.tsx");
  assert.equal(siteContent.works.title, "代表作品");
  assert.match(source, /<h1>\{siteContent\.works\.title\}<\/h1>/);
  assert.doesNotMatch(source, /WORK INDEX|works\.intro/);
});

test("content agent uses the approved compact card and five-section detail contract", () => {
  const project = getProjectBySlug("content-agent") as any;
  assert.equal(project.summary, "面向企业的多模态内容创作系统，通过 GPT 式对话生成图片和视频，并持续沉淀 Prompt、Skill 与数字资产。");
  assert.equal(project.status, "唯一开发者 · 企业局域网已投入使用");
  assert.deepEqual(project.capabilities, [
    "GPT 式创作",
    "Prompt 沉淀",
    "Skill 复用",
    "多模型接入",
    "数字资产",
  ]);
  assert.equal(project.media.label, "界面设计稿 · 示例数据");
  assert.equal(project.details.overview.length, 2);
  assert.equal(project.details.coreCapabilities.length, 6);
  assert.equal(project.details.architecture.modules.length, 5);
  assert.equal(project.details.implementation.contributions.length, 6);
});

test("live components render five concise sections and omit audit narration", () => {
  const page = read("app/(portfolio)/works/page.tsx");
  const card = read("components/works/ProjectCard.tsx");
  const caseStudy = read("components/works/CaseStudy.tsx");
  const headings = ["项目简介", "核心能力", "系统架构", "我的技术实现", "技术栈"];
  let cursor = -1;
  for (const heading of headings) {
    const next = caseStudy.indexOf(`>${heading}<`);
    assert.ok(next > cursor, `${heading} must appear in order`);
    cursor = next;
  }
  assert.doesNotMatch(page, /WORK INDEX|siteContent\.works\.intro/);
  assert.doesNotMatch(card, /project\.ownership|project\.futureDirection|mediaDisclosure/);
  assert.match(card, /mediaBadge/);
  assert.match(card, /aria-expanded=\{expanded\}/);
  assert.doesNotMatch(caseStudy, /验证证据|当前边界|采集时间|提交版本|运行方式|脱敏处理/);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/works-presentation.test.ts
```

Expected: FAIL because the works title is still `作品`, `details` is absent, and the old components still render audit-oriented content.

- [ ] **Step 3: Commit the failing contract**

```powershell
git add -- tests/works-presentation.test.ts
git commit -m "test: freeze concise works presentation"
```

### Task 2: Publish The Approved Content And Knowledge Contract

**Files:**

- Modify: `lib/site-content.ts`
- Modify: `content/site-content.json`
- Modify: `lib/server/public-knowledge.ts`
- Modify: `tests/site-content.test.ts`
- Modify: `tests/public-knowledge.test.ts`
- Modify: `content/rag-eval.json`
- Modify: `scripts/s7-contract.test.mjs`

- [ ] **Step 1: Add the optional five-section project type**

Add these types and the optional `details` field:

```ts
export type ProjectDetails = {
  overview: string[];
  coreCapabilities: string[];
  architecture: {
    flow?: string;
    modules: string[];
  };
  implementation: {
    summary: string;
    contributions: string[];
    futureDirection?: string;
  };
};

export type Project = {
  slug: ProjectSlug;
  name: string;
  type: string;
  status: string;
  summary: string;
  ownership?: string;
  futureDirection?: string;
  featured: boolean;
  disclosure: ProjectDisclosure;
  capabilities: string[];
  techStack: TechStackGroup[];
  media: ProjectMedia | null;
  actions: ProjectAction[];
  askMorse?: { label: string; prompt: string };
  knowledgeTopics?: ProjectKnowledgeTopic[];
  details?: ProjectDetails;
  caseStudy: CaseStudy;
};
```

Change `TechStackGroup.label` to `string`, because the approved Content Agent labels are `数据与任务` and `工程交付`. Change `SiteContent.works` to `{ title: string }`.

- [ ] **Step 2: Replace the Content Agent public card fields**

Set these exact values in `content/site-content.json`:

```json
{
  "status": "唯一开发者 · 企业局域网已投入使用",
  "summary": "面向企业的多模态内容创作系统，通过 GPT 式对话生成图片和视频，并持续沉淀 Prompt、Skill 与数字资产。",
  "capabilities": [
    "GPT 式创作",
    "Prompt 沉淀",
    "Skill 复用",
    "多模型接入",
    "数字资产"
  ],
  "media": {
    "src": "/works/content-agent/atelier-main-design-2026-07-18.jpg",
    "width": 1280,
    "height": 1486,
    "alt": "内容创作 Agent 系统黑金新版主页面设计图",
    "label": "界面设计稿 · 示例数据"
  }
}
```

Keep the existing non-rendered `caption` and `evidence` media fields for traceability and compatibility. They must not be rendered by either public component.

- [ ] **Step 3: Add the exact Content Agent detail data**

Add this `details` object to the Content Agent project:

```json
{
  "overview": [
    "为企业电商内容团队开发的 AI 图片与视频创作系统，已部署至企业局域网并投入使用。系统集中管理商品素材、参考图、Prompt、Skill、生成任务和结果资产。",
    "系统支持 GPT 式对话创作，统一适配 GPT Image 2、Seedance 2、Kling、Veo、Wan 等图像与视频模型，并提供异步任务追踪、失败恢复、版本管理和资产归档。"
  ],
  "coreCapabilities": [
    "对话式创作：多轮需求补充、参考图上传、方案确认、图片和视频生成。",
    "Prompt 与 Skill 管理：沉淀可复用提示词、创作流程和场景能力。",
    "多模型适配：GPT Image 2、Seedance 2、Kling、Veo、Wan 等。",
    "任务运行管理：排队、执行、恢复、完成、失败、重试。",
    "素材与版本管理：关联商品素材、参考图、任务、版本和资产。",
    "执行前校验：检查参考图、画幅、清晰度和模型输入组合。"
  ],
  "architecture": {
    "flow": "商品素材 / 参考图 -> 创作对话 -> Agent 决策与上下文编译 -> 模型网关 -> OperationRun 异步任务 -> 结果回挂 -> 数字资产库",
    "modules": ["创作层", "Agent 层", "模型层", "任务层", "资产层"]
  },
  "implementation": {
    "summary": "项目需求、产品方向和部分创意来自真实业务对接；我是项目唯一开发者，负责将这些需求完整实现为可运行系统。",
    "contributions": [
      "Agent 对话、决策路由、上下文编译。",
      "图片、视频和编辑模型 Provider 适配。",
      "前端、后端、数据模型和权限体系。",
      "OperationRun 生命周期、异步执行、重试和恢复。",
      "Prompt、Skill、素材、任务、版本和资产关联。",
      "Windows 交付包、单端口托管、企业局域网部署、健康检查和故障恢复。"
    ],
    "futureDirection": "基于历史任务、人工反馈和质量评估，优化 Prompt、Skill、模型选择与创作策略，逐步演进为可审核、可回退的自进化 Agent。"
  }
}
```

- [ ] **Step 4: Replace the Content Agent stack and CTA prompt**

Use these exact groups:

```json
[
  { "label": "前端", "items": ["React 18", "TypeScript", "Vite", "Ant Design 5", "TanStack Query"] },
  { "label": "后端", "items": ["FastAPI", "SQLAlchemy", "Pydantic", "Alembic"] },
  { "label": "数据与任务", "items": ["MySQL", "Redis", "ARQ"] },
  { "label": "AI / Agent", "items": ["LangGraph", "确定性决策路由", "Provider Adapter"] },
  { "label": "工程交付", "items": ["单端口静态托管", "Windows 交付包", "健康检查"] }
]
```

Set the prompt to:

```json
{
  "label": "问数字摩斯",
  "prompt": "请介绍内容创作 Agent 的对话式创作、多模型适配、异步任务与数字资产管理，以及摩斯独立完成的技术实现。"
}
```

- [ ] **Step 5: Align the six knowledge topics without changing their IDs**

Keep `overview`, `experience`, `models`, `engineering`, `role`, and `roadmap`. Use these exact topic values:

```json
[
  {
    "id": "overview",
    "title": "项目定位与企业价值",
    "content": "内容创作 Agent 是为企业电商内容团队开发的 AI 图片与视频创作系统，已部署至企业局域网并投入使用。系统集中管理商品素材、参考图、Prompt、Skill、生成任务和结果资产，让团队在持续创作中沉淀可复用的生产能力与数字资产。"
  },
  {
    "id": "experience",
    "title": "GPT 式对话创作",
    "content": "用户可以通过多轮对话补充商品信息和创作需求，上传参考图，确认方案后生成图片或视频。会话与素材、任务、版本和结果资产保持关联，便于继续修改、复用结果或恢复失败任务。"
  },
  {
    "id": "models",
    "title": "多模型统一适配",
    "content": "系统统一适配 GPT Image 2、Seedance 2、Kling、Veo、Wan 等图像与视频模型。Provider Adapter 隔离不同供应商的接口差异，Agent 根据创作目标、参考图、画幅和输入组合选择并编译模型请求。"
  },
  {
    "id": "engineering",
    "title": "异步任务与资产链路",
    "content": "执行前会校验参考图、画幅、清晰度和模型输入组合。OperationRun 记录任务排队、执行、恢复、完成、失败和重试状态；生成结果自动回挂到会话、任务版本与数字资产库。"
  },
  {
    "id": "role",
    "title": "业务协作与技术实现",
    "content": "项目需求、产品方向和部分创意来自真实业务对接。摩斯是项目唯一开发者，负责把这些输入完整实现为可运行系统，并独立完成 Agent 对话与决策路由、多模型适配、前后端、数据与权限、异步任务、Windows 交付包、企业局域网部署、健康检查和故障恢复。"
  },
  {
    "id": "roadmap",
    "title": "未来方向：自进化 Agent",
    "content": "下一阶段计划基于历史任务、人工反馈和质量评估，优化 Prompt、Skill、模型选择与创作策略，逐步演进为可审核、可回退的自进化 Agent。该能力属于未来方向，不作为当前已完成功能展示。"
  }
]
```

Update the RAG query `哪些图片和视频模型已经真实跑通，哪些只是完成适配？` to `内容创作 Agent 接入了哪些图片和视频模型，如何统一适配不同 Provider？` and keep its expected document ID as `project-content-agent-models`.

- [ ] **Step 6: Prefer approved details in public knowledge extraction**

Extend the local `SiteContent` interface with `details`, then add this helper:

```ts
function projectDetailParts(project: NonNullable<SiteContent["projects"]>[number]) {
  if (project.details) {
    return [
      ...project.details.overview,
      project.details.coreCapabilities.length
        ? `核心能力:\n${project.details.coreCapabilities.join("\n")}`
        : undefined,
      project.details.architecture.flow,
      project.details.architecture.modules.length
        ? `系统模块:\n${project.details.architecture.modules.join("\n")}`
        : undefined,
      project.details.implementation.summary,
      ...project.details.implementation.contributions,
      project.details.implementation.futureDirection,
    ];
  }

  return [
    project.caseStudy?.problem,
    project.caseStudy?.role,
    ...(project.caseStudy?.decisions ?? []),
    ...(project.caseStudy?.structure ?? []),
  ];
}
```

Replace the current direct `caseStudy` spread with `...projectDetailParts(project)`. Do not include legacy `evidence` or `boundaries` in default project documents.

- [ ] **Step 7: Update exact content and knowledge tests**

Update `tests/site-content.test.ts`, `tests/public-knowledge.test.ts`, and the black-gold test in `scripts/s7-contract.test.mjs` to require the approved summary, status, five tags, short media label, `details`, LAN deployment knowledge, and the unchanged image hash. Remove assertions that require the visible media caption or `caseStudy.boundaries`.

The privacy test must continue rejecting paths, credentials, URLs, runtime IDs, `RUNNING`, and production secrets, but it must no longer reject the approved fact that the system is deployed on an enterprise LAN.

- [ ] **Step 8: Run focused data and knowledge tests**

```powershell
node --env-file-if-exists=.env.local --test tests/works-presentation.test.ts tests/site-content.test.ts tests/public-knowledge.test.ts tests/rag-eval-contract.test.ts scripts/s7-contract.test.mjs
```

Expected: Content and knowledge assertions PASS; the component-source portion of `works-presentation.test.ts` remains RED until Task 3.

- [ ] **Step 9: Commit the content contract**

```powershell
git add -- content/site-content.json content/rag-eval.json lib/site-content.ts lib/server/public-knowledge.ts tests/site-content.test.ts tests/public-knowledge.test.ts scripts/s7-contract.test.mjs
git commit -m "content: publish concise content agent story"
```

### Task 3: Implement The Concise Works UI

**Files:**

- Modify: `app/(portfolio)/works/page.tsx`
- Modify: `app/(portfolio)/works/page.module.css`
- Modify: `components/works/ProjectGallery.module.css`
- Modify: `components/works/ProjectCard.tsx`
- Modify: `components/works/ProjectCard.module.css`
- Modify: `components/works/CaseStudy.tsx`
- Modify: `components/works/CaseStudy.module.css`

- [ ] **Step 1: Reduce the works header to one heading**

Use this page body:

```tsx
<main className={styles.main}>
  <header className={styles.header}>
    <h1>{siteContent.works.title}</h1>
  </header>
  <ProjectGallery projects={projects} />
</main>
```

Center the heading, use `var(--fs-h2)`, and keep enough bottom spacing for the first project row to remain visible in a 900px viewport.

- [ ] **Step 2: Make the gallery a one-column representative-work list**

Replace the gallery grid with:

```css
.gallery {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
}
```

- [ ] **Step 3: Simplify the Project Card markup**

The collapsed card must render this order:

```tsx
<div className={styles.media}>
  {project.media ? (
    <Image
      className={styles.image}
      src={project.media.src}
      width={project.media.width}
      height={project.media.height}
      alt={project.media.alt}
      sizes="(max-width: 640px) 100vw, 352px"
    />
  ) : (
    <div className={styles.mediaPlaceholder} role="img" aria-label={`${project.name}暂无可公开截图`}>
      截图待补
    </div>
  )}
  {project.media ? <span className={styles.mediaBadge}>{project.media.label}</span> : null}
</div>

<div className={styles.content}>
  <h2 id={titleId}>{project.name}</h2>
  <p className={styles.summary}>{project.summary}</p>
  <ul className={styles.capabilities} aria-label={`${project.name}能力`}>
    {project.capabilities.map((capability) => <li key={capability}>{capability}</li>)}
  </ul>
  <p className={styles.status}>{project.status}</p>
  <button
    className={styles.toggle}
    type="button"
    aria-expanded={expanded}
    aria-controls={detailsId}
    aria-label={`${expanded ? "收起" : "展开"}${project.name}详情`}
    title={expanded ? "收起详情" : "展开详情"}
    onClick={onToggle}
  >
    <span className={styles.toggleIcon} aria-hidden="true" />
  </button>
</div>
```

Remove the collapsed `type`, ownership paragraph, future-direction paragraph, media disclosure paragraph, CTA, external links, and text expand label. Keep the existing detail mount/unmount, Hash, and transition lifecycle unchanged.

- [ ] **Step 4: Implement stable responsive card styling**

Use these stable layout rules, then retain the existing detail transition rules below them:

```css
.card {
  display: grid;
  grid-template-columns: minmax(16rem, 22rem) minmax(0, 1fr);
  align-content: start;
  gap: var(--space-6);
  min-width: 0;
  padding: var(--space-6) 0;
  border-top: 1px solid var(--line-faint);
  cursor: pointer;
  scroll-margin-top: calc(var(--topbar-h) + var(--space-4));
}

.media {
  position: relative;
  min-width: 0;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.mediaBadge {
  position: absolute;
  bottom: var(--space-3);
  left: var(--space-3);
  max-width: calc(100% - 2 * var(--space-3));
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-glass);
  color: var(--ink);
  font-size: var(--fs-2xs);
}

.content {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 100%;
  padding-right: calc(44px + var(--space-4));
  flex-direction: column;
}

.summary {
  display: -webkit-box;
  margin-top: var(--space-3);
  overflow: hidden;
  color: var(--muted);
  line-height: 1.7;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.toggle {
  position: absolute;
  right: 0;
  bottom: 0;
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent);
}

.toggleIcon {
  width: var(--space-3);
  height: var(--space-3);
  border-right: 1px solid currentColor;
  border-bottom: 1px solid currentColor;
  transform: translateY(-25%) rotate(45deg);
}

.toggle[aria-expanded='true'] .toggleIcon {
  transform: translateY(25%) rotate(-135deg);
}

@media (max-width: 640px) {
  .card {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }

  .media {
    width: 100%;
    aspect-ratio: 16 / 10;
  }

  .content {
    min-height: 0;
    padding-right: 0;
    padding-bottom: calc(44px + var(--space-4));
  }
}

@media (prefers-reduced-motion: reduce) {
  .card,
  .media,
  .details,
  .toggle,
  .toggleIcon {
    transition: none;
  }
}
```

- [ ] **Step 5: Normalize legacy projects into the five visible sections**

In `CaseStudy.tsx`, use:

```ts
const details = project.details ?? {
  overview: [project.summary],
  coreCapabilities: project.capabilities,
  architecture: { modules: project.caseStudy.structure },
  implementation: {
    summary: project.caseStudy.role,
    contributions: project.caseStudy.decisions,
    futureDirection: project.futureDirection,
  },
};
```

This compatibility object is render-only. Do not write derived content back into the other projects.

- [ ] **Step 6: Render exactly five detail sections**

Render numbered sections in this order:

```tsx
<section>
  <p className={styles.sectionIndex}>01</p>
  <div>
    <h3>项目简介</h3>
    {details.overview.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
  </div>
</section>
<section>
  <p className={styles.sectionIndex}>02</p>
  <div>
    <h3>核心能力</h3>
    <ul>{details.coreCapabilities.map((item) => <li key={item}>{item}</li>)}</ul>
  </div>
</section>
<section>
  <p className={styles.sectionIndex}>03</p>
  <div>
    <h3>系统架构</h3>
    {details.architecture.flow ? (
      <p className={styles.architectureFlow}>{details.architecture.flow}</p>
    ) : null}
    <ul className={styles.architectureModules}>
      {details.architecture.modules.map((item) => <li key={item}>{item}</li>)}
    </ul>
  </div>
</section>
<section>
  <p className={styles.sectionIndex}>04</p>
  <div>
    <h3>我的技术实现</h3>
    <p>{details.implementation.summary}</p>
    <ul>{details.implementation.contributions.map((item) => <li key={item}>{item}</li>)}</ul>
    {details.implementation.futureDirection ? (
      <p className={styles.futureDirection}>{details.implementation.futureDirection}</p>
    ) : null}
  </div>
</section>
<section>
  <p className={styles.sectionIndex}>05</p>
  <div>
    <h3>技术栈</h3>
    <dl className={styles.stackGroups}>
      {project.techStack.map((group) => (
        <div key={group.label}>
          <dt>{group.label}</dt>
          <dd><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></dd>
        </div>
      ))}
    </dl>
  </div>
</section>
```

Delete the repeated project header, media figure, screenshot placeholder, evidence metadata, “验证证据”, and “当前边界”.

- [ ] **Step 7: Move actions to the detail footer**

Import `OpenChatButton` into `CaseStudy.tsx`. After the five sections, render `project.askMorse` first and external actions second inside one `.actions` footer. Keep `target="_blank"` and `rel="noreferrer"` for external links.

- [ ] **Step 8: Run the live contract and build**

```powershell
node --env-file-if-exists=.env.local --test tests/works-presentation.test.ts tests/site-content.test.ts tests/public-knowledge.test.ts
npm run build
```

Expected: all focused tests PASS and the Next.js production build exits 0.

- [ ] **Step 9: Commit the shared presentation**

```powershell
git add -- 'app/(portfolio)/works/page.tsx' 'app/(portfolio)/works/page.module.css' components/works/ProjectGallery.module.css components/works/ProjectCard.tsx components/works/ProjectCard.module.css components/works/CaseStudy.tsx components/works/CaseStudy.module.css tests/works-presentation.test.ts
git commit -m "feat: simplify portfolio project presentation"
```

### Task 4: Update Focused Browser Acceptance

**Files:**

- Modify: `scripts/content-agent-visual-smoke.py`
- Modify: `scripts/s9-visual-smoke.mjs`
- Modify: `scripts/s9-cdp.test.mjs` only if the optional evidence-directory contract requires a fixture update
- Update: `docs/verify/content-agent/portfolio-content-agent-desktop-1440x900.png`
- Update: `docs/verify/content-agent/portfolio-content-agent-mobile-390x844.png`
- Update: `docs/verify/content-agent/portfolio-content-agent-cta-desktop-1440x900.png`
- Update: `docs/verify/content-agent/portfolio-content-agent-cta-mobile-390x844.png`

- [ ] **Step 1: Rewrite the focused Playwright assertions**

The script must verify:

```text
H1 = 代表作品
card summary = approved compact summary
card status = 唯一开发者 · 企业局域网已投入使用
card tags = exactly five approved tags
media badge = 界面设计稿 · 示例数据
approved atelier image loads
expand button changes aria-expanded from false to true
expanded headings = 项目简介 / 核心能力 / 系统架构 / 我的技术实现 / 技术栈
page excludes 验证证据 / 当前边界 / 采集时间 / 提交版本 / 运行方式 / 脱敏处理
问数字摩斯 appears only in expanded content and prefills the approved prompt
horizontal overflow = 0
console errors = []
page errors = []
```

Keep the existing 1440x900 and 390x844 runs, delayed history fixture, CTA state reset, and screenshot names.

- [ ] **Step 2: Update the S9 gallery assertions**

Change the current privacy check so `content-agent` requires one approved image and zero external links, while `auto-operations` still requires zero images and zero external links. Capture the works screenshot with `content-agent` expanded instead of `deep-research`.

Allow `S9_EVIDENCE_DIR` to override the default screenshot directory:

```js
evidenceDir = path.resolve(
  env.S9_EVIDENCE_DIR
    || new URL('../docs/verify/s9/', import.meta.url).pathname.slice(1),
);
```

- [ ] **Step 3: Start the verified local build**

```powershell
npm run build
npm run start -- -p 3010
```

Keep the server session running until both visual commands finish.

- [ ] **Step 4: Run the focused Content Agent browser smoke**

Use the bundled workspace Python and Playwright runtime if the system Python lacks Playwright:

```powershell
python scripts/content-agent-visual-smoke.py http://127.0.0.1:3010
```

Expected: JSON reports two viewports, both with loaded image, zero overflow, empty console/page error lists, and no failures.

- [ ] **Step 5: Run the full current works interaction smoke without overwriting unrelated evidence**

```powershell
$env:S9_EVIDENCE_DIR = (Resolve-Path '.\tmp').Path + '\works-presentation-s9'
npm run visual:s9
Remove-Item Env:S9_EVIDENCE_DIR
```

Expected: `failures` is empty; all four slugs expand one at a time; Hash, redirect, keyboard, scroll, and reduced-motion checks pass.

- [ ] **Step 6: Inspect the four focused screenshots**

Visually verify the desktop and mobile card/detail screenshots against five bottom lines:

```text
the project is identifiable at first glance
collapsed content scans quickly
the approved black-gold main image is legible
expanded content has no repeated header or audit prose
mobile text, tags, image, and icon control do not overlap or overflow
```

If any line fails, correct the component/CSS and rerun Steps 4 through 6.

- [ ] **Step 7: Commit browser acceptance changes**

```powershell
git add -- scripts/content-agent-visual-smoke.py scripts/s9-visual-smoke.mjs scripts/s9-cdp.test.mjs docs/verify/content-agent/portfolio-content-agent-desktop-1440x900.png docs/verify/content-agent/portfolio-content-agent-mobile-390x844.png docs/verify/content-agent/portfolio-content-agent-cta-desktop-1440x900.png docs/verify/content-agent/portfolio-content-agent-cta-mobile-390x844.png
git commit -m "test: verify concise content agent presentation"
```

Only add `scripts/s9-cdp.test.mjs` if it actually changed.

### Task 5: Full Verification And Scoped Closeout

**Files:**

- Modify if reconciliation requires it: `docs/portfolio-blueprint.md`
- Modify if reconciliation requires it: `docs/task-center/run-state.md`
- Modify: `docs/verify/content-agent/content-agent-closeout.md`

- [ ] **Step 1: Run all contract tests**

```powershell
npm test
```

Expected: zero failing tests. PostgreSQL-dependent skips remain skips unless a configured local database is available.

- [ ] **Step 2: Run the final production build once**

```powershell
npm run build
```

Expected: exit code 0 with `/works` and all legacy redirect routes generated successfully.

- [ ] **Step 3: Verify the public knowledge artifacts without mutating a database**

```powershell
node --env-file-if-exists=.env.local --test tests/public-knowledge.test.ts tests/rag-eval-contract.test.ts
```

Expected: all six Content Agent topics remain independently retrievable, the LAN deployment and unique technical-developer facts are present, and media/evidence metadata remains excluded.

Do not run `knowledge:ingest`, paid embeddings, Provider calls, deployment, or production database mutation in this local delivery target.

- [ ] **Step 4: Reconcile canonical documentation**

Record the new live five-section contract in `docs/portfolio-blueprint.md` without deleting historical S7/S9 records. Update the Content Agent closeout note with the exact commits, test/build results, 1440/390 screenshot paths, and the explicit statement that production knowledge ingestion and deployment were not performed.

- [ ] **Step 5: Run scoped Git checks**

```powershell
git diff --check
git status --short
git diff --name-only HEAD~4..HEAD
```

Expected: no whitespace errors; unrelated dirty files remain unstaged; the commit range contains only the files named by this plan plus required closeout documentation.

- [ ] **Step 6: Commit knowledge reconciliation**

```powershell
git add -- docs/portfolio-blueprint.md docs/task-center/run-state.md docs/verify/content-agent/content-agent-closeout.md
git commit -m "docs: close content agent presentation round"
```

Only stage `docs/task-center/run-state.md` if reconciliation changed it.

- [ ] **Step 7: Stop at local delivery**

Report the local commit range, fresh verification, screenshot paths, remaining unrelated worktree changes, and that no push or deployment occurred. Push remains a separate approval gate.
