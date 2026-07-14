# S9 Morse Portfolio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the current homepage and works catalog around the approved Morse identity, persistent Morse-signal motion, expandable single-page case studies, privacy-safe project evidence, and traceable Codex/Claude Code development statistics while preserving the existing text-chat backend.

**Architecture:** Keep `content/site-content.json` as the only public factual source and extend its typed project records instead of duplicating copy in components. Put the persistent background and compact navigation in the root layout, render the text chat once per route tree, and use a client-owned `/works` gallery for accessible Hash-synchronized expansion. Extend the existing build-time stats script with schema-specific, aggregate-only parsers for Claude Code and Codex JSONL records; never emit prompt text, response text, project paths, or session identifiers.

**Tech Stack:** Next.js App Router, React 19, TypeScript, CSS Modules, global design tokens, Canvas 2D, IntersectionObserver, Node test runner, build-time JSON aggregation, existing raw-CDP visual harness, existing Lighthouse 13.4.0 npm cache.

---

## Execution Constraints

- Start implementation from the approved `master` baseline in a dedicated `codex/s9-morse-portfolio-redesign` branch/worktree; do not implement directly on `master`.
- Do not push, deploy, rewrite Git history, call a paid Provider, migrate the database, or write to `E:\Wiki`, `E:\demo2`, `E:\小红书`, or `E:\多agent`.
- The only database write in S9 is idempotent reingestion of sanitized public knowledge into the existing loopback project database; schema and production data remain untouched.
- No new package dependency. `gsap` may remain installed for compatibility, but S9 motion code must not import it.
- Keep `AGENTS.md`, user research files, existing untracked screenshots, `output/**`, and `.tmp-*` scripts unstaged.
- Real internal-project UI is forbidden unless Morse later supplies an explicitly approved redacted asset. S9 must remove the currently published internal-project image and external action.
- Do not print raw JSONL lines during stats work. Tests use synthetic fixtures; production collection writes aggregate output only.
- Each task ends with a focused commit after its tests pass. Final merge/push remains a separate closeout decision.

## File Map

- `content/site-content.json`: public identity, featured projects, project disclosure level, technical stacks, capabilities, evidence, boundaries, and allowed actions.
- `lib/site-content.ts`: typed contract for public content and Hash helpers.
- `lib/server/public-knowledge.ts`: RAG document extraction and new `/works#slug` public hrefs.
- `scripts/collect-stats.mjs`: privacy-limited Claude Code/Codex JSONL aggregation.
- `content/stats.json`: generated aggregate facts only.
- `components/site/MorseSignalCanvas.tsx` and `.module.css`: persistent Canvas background with reduced-motion/static fallback.
- `components/site/SiteHeader.tsx` and `SiteShell.module.css`: brandless fixed navigation and chat/resume controls.
- `app/layout.tsx`: persistent visual shell, footer, resume sheet, and background.
- `app/page.tsx`, `app/styles/hero.module.css`, `components/home/MorseHomeSections.tsx`, and `.module.css`: approved homepage composition.
- `components/MorseChat.tsx` and `.module.css`: existing chat state machine plus embedded homepage presentation; no API behavior change.
- `components/works/ProjectGallery.tsx` and `.module.css`: one-open-at-a-time expansion and Hash synchronization.
- `components/works/ProjectCard.tsx` and `.module.css`: collapsed project summary and external actions.
- `components/works/CaseStudy.tsx` and `.module.css`: embedded expanded content, grouped stack, decisions, evidence, and boundaries.
- `app/works/page.tsx` and `.module.css`: compact works intro and gallery host.
- `app/works/[slug]/page.tsx`: compatibility redirect to `/works#slug`.
- `scripts/s9-visual-smoke.mjs` and `package.json`: repeatable 1440/390/reduced-motion/interaction gate.
- `tests/*.test.ts` and `scripts/*.test.mjs`: content, privacy, stats, shell, route, chat, and visual contracts.
- `docs/verify/s9/**`: fresh screenshots, Lighthouse JSON, and closeout evidence created only during verification.

### Task 1: Lock the S9 Public Content and Privacy Contract

**Files:**
- Modify: `tests/site-content.test.ts`
- Modify: `tests/public-knowledge.test.ts`
- Modify: `tests/work-asset.test.ts`
- Modify: `scripts/s7-contract.test.mjs`
- Modify: `content/site-content.json`
- Modify: `lib/site-content.ts`
- Modify: `lib/server/public-knowledge.ts`
- Delete: `public/works/auto-operations/login-workbench-2026-07-13.png`

- [ ] **Step 1: Write failing S9 content and privacy assertions**

Add assertions that describe the new public boundary without embedding any forbidden company domain:

```ts
test('S9 publishes Morse identity and only public featured projects', () => {
  assert.equal(siteContent.profile.title, 'Morse');
  assert.equal(siteContent.profile.role, 'Agent 系统开发者 × AI Native 实践者');
  assert.deepEqual(siteContent.home.featuredSlugs, ['deep-research', 'digital-morse']);
  assert.deepEqual(siteContent.site.nav.map((item) => item.label), ['首页', '作品集']);
  assert.deepEqual(siteContent.site.footer.links, [
    { label: 'GitHub', href: 'https://github.com/Morse-Moss' },
  ]);
});

test('internal projects have no public media or external action', () => {
  for (const slug of ['content-agent', 'auto-operations']) {
    const project = getProjectBySlug(slug);
    assert.ok(project);
    assert.equal(project.disclosure, 'internal-redacted');
    assert.equal(project.media, null);
    assert.deepEqual(project.actions, []);
  }
});

test('every project has grouped stack and capability evidence', () => {
  for (const project of getAllProjects()) {
    assert.ok(project.techStack.length >= 2);
    assert.ok(project.techStack.every((group) => group.items.length > 0));
    assert.ok(project.capabilities.length >= 2);
  }
});
```

Update `tests/public-knowledge.test.ts` to expect project hrefs such as `/works#deep-research`, and update `tests/work-asset.test.ts` to assert the internal-project asset no longer exists.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test tests/site-content.test.ts tests/public-knowledge.test.ts tests/work-asset.test.ts scripts/s7-contract.test.mjs
```

Expected: FAIL for the old title, old featured project, missing disclosure/stack fields, `/works/<slug>` hrefs, and the still-present internal screenshot.

- [ ] **Step 3: Extend the typed content contract**

Add these exact types in `lib/site-content.ts` and remove `case` from public actions because expansion is UI state, not content-owned navigation:

```ts
export type ProjectDisclosure = 'public' | 'internal-redacted';

export type TechStackGroup = {
  label: '前端' | '后端' | '数据' | 'AI / Agent' | '工程与部署';
  items: string[];
};

export type ProjectAction = {
  kind: 'external';
  label: 'GitHub';
  href: string;
};

export type Project = {
  slug: ProjectSlug;
  name: string;
  type: string;
  status: string;
  summary: string;
  featured: boolean;
  disclosure: ProjectDisclosure;
  capabilities: string[];
  techStack: TechStackGroup[];
  media: ProjectMedia | null;
  actions: ProjectAction[];
  caseStudy: CaseStudy;
};

export type SiteFooterLink = {
  label: 'GitHub';
  href: string;
};

export const projectHashHref = (slug: ProjectSlug): `/works#${ProjectSlug}` =>
  `/works#${slug}`;
```

- [ ] **Step 4: Replace public content with the approved facts**

Set `profile.title` to `Morse`, `profile.role` to `Agent 系统开发者 × AI Native 实践者`, `site.nav` labels to `首页 / 作品集`, `site.footer.links` to the real Morse-Moss GitHub profile, and `home.featuredSlugs` to `deep-research` plus `digital-morse`. Add the following verified stack groups:

```json
{
  "content-agent": {
    "disclosure": "internal-redacted",
    "capabilities": ["内容生产工作流", "异步任务治理", "素材与版本管理"],
    "techStack": [
      { "label": "前端", "items": ["React", "TypeScript", "Vite", "Ant Design", "TanStack Query"] },
      { "label": "后端", "items": ["FastAPI", "SQLAlchemy", "Pydantic", "Alembic"] },
      { "label": "数据", "items": ["MySQL", "Redis"] },
      { "label": "AI / Agent", "items": ["Provider 适配", "ARQ", "LangGraph"] }
    ]
  },
  "auto-operations": {
    "disclosure": "internal-redacted",
    "capabilities": ["受控运营工作流", "任务状态治理", "人工发布闸门"],
    "techStack": [
      { "label": "前端", "items": ["React", "TypeScript", "Vite", "Ant Design", "dnd-kit"] },
      { "label": "后端", "items": ["FastAPI", "SQLAlchemy", "Pydantic", "Alembic"] },
      { "label": "数据", "items": ["MySQL"] },
      { "label": "工程与部署", "items": ["APScheduler", "Docker"] }
    ]
  },
  "deep-research": {
    "disclosure": "public",
    "capabilities": ["多 Agent 研究链", "证据与质量门", "可恢复运行"],
    "techStack": [
      { "label": "前端", "items": ["React", "TypeScript", "Vite", "XYFlow"] },
      { "label": "后端", "items": ["Python", "FastAPI", "Pydantic", "HTTPX"] },
      { "label": "AI / Agent", "items": ["固定 hv_analysis 工作流", "证据审查", "人工发布审批"] },
      { "label": "工程与部署", "items": ["Pytest", "Docker local runtime"] }
    ]
  },
  "digital-morse": {
    "disclosure": "public",
    "capabilities": ["受控文字对话", "RAG 来源展示", "短期访问与预算治理"],
    "techStack": [
      { "label": "前端", "items": ["Next.js", "React", "TypeScript", "CSS Modules"] },
      { "label": "后端", "items": ["Next.js Route Handlers", "OpenAI Responses API", "SSE"] },
      { "label": "数据", "items": ["PostgreSQL", "pgvector"] },
      { "label": "AI / Agent", "items": ["RAG", "Embedding", "引用来源", "费用门"] }
    ]
  }
}
```

For both internal projects set `media` and `actions` to empty values, remove deployment/site/version claims from evidence, and use the status `企业内部项目 · 脱敏展示`. Keep only the two approved GitHub actions on public projects.

- [ ] **Step 5: Change public knowledge hrefs and remove the forbidden asset**

Implement:

```ts
export function publicKnowledgeHref(documentId: string): string {
  if (documentId === 'about' || documentId.startsWith('faq-')) return '/';
  if (documentId.startsWith('project-')) {
    return `/works#${documentId.slice('project-'.length)}`;
  }
  return '/';
}
```

Include `techStack` and `capabilities` in project knowledge extraction, then remove the tracked internal screenshot with `git rm -- public/works/auto-operations/login-workbench-2026-07-13.png`.

- [ ] **Step 6: Reingest sanitized knowledge into the local project database**

Use only the existing loopback PostgreSQL project database and configured local embedding service; do not use a paid Provider or any production database:

```powershell
$env:DATABASE_URL='postgresql://revolution@127.0.0.1:55432/revolution'
npm run knowledge:ingest
npm run knowledge:ingest
node --test tests/public-knowledge.test.ts tests/knowledge.test.ts tests/rag-integration.test.ts
```

Expected: the first ingestion updates documents changed by content and Hash hrefs; the second reports every document skipped. Integration tests confirm project sources use `/works#slug` and extracted documents exclude internal media, external actions, and deployment fields.

- [ ] **Step 7: Run GREEN and commit**

Run the Step 2 command plus the three knowledge tests from Step 6, then:

```powershell
git add content/site-content.json lib/site-content.ts lib/server/public-knowledge.ts tests/site-content.test.ts tests/public-knowledge.test.ts tests/work-asset.test.ts scripts/s7-contract.test.mjs public/works/auto-operations/login-workbench-2026-07-13.png
git commit -m "fix: enforce S9 public project boundaries"
```

Expected: focused tests PASS and the commit contains no unrelated untracked file.

### Task 2: Build Aggregate-Only Codex and Claude Code Statistics

**Files:**
- Modify: `scripts/collect-stats.test.mjs`
- Modify: `scripts/collect-stats.mjs`
- Modify: `content/stats.json`
- Create: `lib/stats.ts`

- [ ] **Step 1: Add synthetic RED fixtures for both known JSONL schemas**

Use fake records only. The fixture must cover Claude Code message usage and Codex `event_msg/token_count` usage:

```js
const claudeRecord = {
  type: 'assistant',
  sessionId: 'cc-1',
  timestamp: '2026-07-10T10:00:00.000Z',
  cwd: 'C:\\private\\alpha',
  message: {
    usage: {
      input_tokens: 100,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 40,
      output_tokens: 30,
    },
  },
};

const codexRecord = {
  timestamp: '2026-07-11T10:00:00.000Z',
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      last_token_usage: {
        input_tokens: 200,
        cached_input_tokens: 50,
        output_tokens: 60,
        reasoning_output_tokens: 10,
        total_tokens: 260,
      },
    },
  },
};
```

Assert historical and 30-day totals, duplicate Codex session suppression across active/archive directories, normalized project union, active-day union, malformed-line skipping, missing-usage coverage counts, and serialized output that excludes `cwd`, session IDs, usernames, drive paths, and raw content.

- [ ] **Step 2: Run stats tests and verify RED**

Run:

```powershell
node --test scripts/collect-stats.test.mjs
```

Expected: FAIL because the current collector performs metadata-only counting and has no token or cross-tool aggregate contract.

- [ ] **Step 3: Add stable aggregate types**

Create `lib/stats.ts` with the public generated shape:

```ts
export type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type ToolActivity = {
  sessions: number | null;
  projects: number | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  allTime: TokenTotals | null;
  last30Days: TokenTotals | null;
  recordsWithoutUsage: number;
};

export type DevelopmentStats = {
  generatedAt: string;
  methodology: string;
  totals: { sessions: number | null; projects: number | null; activeDaysLast90: number | null };
  claudeCode: ToolActivity;
  codex: ToolActivity;
};
```

- [ ] **Step 4: Implement schema-specific parsers and aggregation**

Implement exported pure functions `parseClaudeRecord`, `parseCodexRecord`, `aggregateToolActivity`, and `mergeActivityTotals`. Claude Code totals sum each assistant message usage. Codex totals sum `last_token_usage`, never `total_token_usage`, so repeated cumulative events do not double count. For Codex session identity/project identity read `session_meta.payload.id` and `session_meta.payload.cwd`; for Claude Code read top-level `sessionId` and `cwd`.

Use this normalization before set union, but never serialize the normalized values:

```js
export function normalizeProjectIdentity(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return path.resolve(value).replaceAll('\\', '/').toLowerCase();
}

export function withinDays(timestampMs, nowMs, days) {
  return timestampMs <= nowMs && nowMs - timestampMs <= days * DAY_MS;
}
```

For Claude Code, total input is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`; cached input reports cache reads, and cache creation remains a separate field. For Codex, `cached_input_tokens` is a subset of `input_tokens`, so `totalTokens` remains the reported `total_tokens` or `input_tokens + output_tokens` and does not add cached tokens twice.

- [ ] **Step 5: Generate and inspect aggregate output**

Run:

```powershell
npm run stats
Get-Content -Raw -Encoding utf8 content/stats.json
```

Expected: output contains only `generatedAt`, `methodology`, `totals`, `claudeCode`, and `codex` aggregates. It includes coverage dates and no project/session identity or local path.

- [ ] **Step 6: Run GREEN and commit**

Run:

```powershell
node --test scripts/collect-stats.test.mjs
git add scripts/collect-stats.mjs scripts/collect-stats.test.mjs content/stats.json lib/stats.ts
git commit -m "feat: aggregate Codex and Claude Code usage"
```

Expected: stats tests PASS; generated values are treated as a dated local snapshot, not hard-coded UI facts.

### Task 3: Establish the Persistent Morse Visual Shell

**Files:**
- Modify: `tests/site-shell-contract.test.ts`
- Modify: `app/layout.tsx`
- Modify: `components/site/SiteHeader.tsx`
- Modify: `components/site/SiteFooter.tsx`
- Modify: `components/site/SiteShell.module.css`
- Modify: `components/ResumeMode.tsx`
- Modify: `components/ResumeMode.module.css`
- Modify: `app/works/layout.tsx`
- Create: `components/site/MorseSignalCanvas.tsx`
- Create: `components/site/MorseSignalCanvas.module.css`
- Delete: `components/site/SiteShell.tsx`

- [ ] **Step 1: Write the failing global-shell contract**

Require one persistent background, brandless two-link navigation, header chat/resume controls, global footer/resume sheet, and no `gsap` import in S9 components:

```ts
assert.match(layout, /<MorseSignalCanvas\s*\/>/);
assert.match(layout, /<ScrollEffects\s*\/>/);
assert.match(layout, /<SiteHeader/);
assert.match(header, /首页/);
assert.match(header, /作品集/);
assert.doesNotMatch(header, /className=\{styles\.brand\}|site\.name/);
assert.match(header, /<OpenChatButton/);
assert.match(header, /<ResumeModeToggle/);
assert.doesNotMatch(canvas, /gsap|three|requestAnimationFrame\([^)]*while/i);
```

- [ ] **Step 2: Run RED**

```powershell
node --test tests/site-shell-contract.test.ts
```

Expected: FAIL because the shell is route-local, the header still renders the brand, and the Canvas component does not exist.

- [ ] **Step 3: Implement the persistent root shell**

Restructure `app/layout.tsx` so the persistent background survives App Router navigation:

```tsx
<body>
  <MorseSignalCanvas />
  <ScrollEffects />
  <div className={shellStyles.standardContent} data-standard-content>
    <SiteHeader site={siteContent.site} />
    {children}
    <SiteFooter footer={siteContent.site.footer} />
  </div>
  <ResumeSheet
    printLabel={siteContent.site.resumeMode.printLabel}
    profile={siteContent.profile}
    projects={siteContent.projects}
  />
</body>
```

Move `ResumeModeToggle` into `SiteHeader`, add an `inline` prop that removes its fixed positioning, add `OpenChatButton` beside it, and delete the obsolete `SiteShell.tsx` wrapper.

Update `SiteFooter` to map `footer.links` as real external anchors with `target="_blank"` and `rel="noreferrer"`; do not add placeholder contact channels.

Replace the works route-local shell with the existing overlay chat only, because header/footer/resume/background now come from the root layout:

```tsx
import type { ReactNode } from 'react';
import MorseChat from '@/components/MorseChat';

export default function WorksLayout({ children }: { children: ReactNode }) {
  return <>{children}<MorseChat /></>;
}
```

- [ ] **Step 4: Implement a bounded native Canvas loop**

`MorseSignalCanvas` must use `ResizeObserver`, cap device pixel ratio at 1.5, stop drawing while the page is hidden, and cancel the frame on cleanup:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import styles from './MorseSignalCanvas.module.css';

const GLYPHS = ['.', '-', 'M', 'O', 'R', 'S', 'E', '0', '1', '/', '>'];

export default function MorseSignalCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let frame = 0;
    let running = !document.hidden;
    let width = 0;
    let height = 0;
    let lastPaint = 0;
    let columns = [] as Array<{ x: number; y: number; speed: number; glyph: string }>;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.font = `${window.innerWidth <= 640 ? 12 : 14}px ui-monospace, monospace`;
      context.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim();
      context.globalAlpha = 0.16;
      const gap = window.innerWidth <= 640 ? 64 : 52;
      columns = Array.from({ length: Math.ceil(width / gap) }, (_, index) => ({
        x: index * gap + gap / 2,
        y: (index * 83) % Math.max(height, 1),
        speed: window.innerWidth <= 640 ? 0.22 + (index % 3) * 0.08 : 0.3 + (index % 4) * 0.09,
        glyph: GLYPHS[index % GLYPHS.length],
      }));
    };

    const draw = (time: number) => {
      if (!running) return;
      const interval = window.innerWidth <= 640 ? 1000 / 24 : 1000 / 30;
      if (time - lastPaint < interval) {
        frame = requestAnimationFrame(draw);
        return;
      }
      lastPaint = time;
      context.clearRect(0, 0, width, height);
      for (const column of columns) {
        context.fillText(column.glyph, column.x, column.y);
        column.y = column.y > height + 20 ? -20 : column.y + column.speed;
      }
      frame = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      running = !document.hidden;
      cancelAnimationFrame(frame);
      if (running) frame = requestAnimationFrame(draw);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    document.addEventListener('visibilitychange', onVisibility);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.canvas} data-testid="morse-signal-canvas" aria-hidden="true" />;
}
```

The Canvas CSS is `position: fixed; inset: 0; pointer-events: none;` with a background token fallback on its parent. The component reads `--accent`; no raw CSS color is added outside `tokens.css`.

- [ ] **Step 5: Run GREEN and commit**

```powershell
node --test tests/site-shell-contract.test.ts
git add app/layout.tsx app/works/layout.tsx components/site/SiteHeader.tsx components/site/SiteFooter.tsx components/site/SiteShell.module.css components/site/MorseSignalCanvas.tsx components/site/MorseSignalCanvas.module.css components/ResumeMode.tsx components/ResumeMode.module.css components/site/SiteShell.tsx
git commit -m "feat: add persistent Morse visual shell"
```

Expected: shell contract PASS; the deleted wrapper is staged explicitly.

### Task 4: Recompose the Homepage Around Morse, Public Work, and Development Facts

**Files:**
- Modify: `tests/routes-contract.test.ts`
- Modify: `tests/chat-ui-contract.test.ts`
- Modify: `tests/site-shell-contract.test.ts`
- Modify: `app/page.tsx`
- Modify: `app/styles/hero.module.css`
- Modify: `components/MorseChat.tsx`
- Modify: `components/MorseChat.module.css`
- Modify: `components/ScrollEffects.tsx`
- Create: `components/home/MorseHomeSections.tsx`
- Create: `components/home/MorseHomeSections.module.css`
- Delete: `components/home/RestoredHomeSections.tsx`

- [ ] **Step 1: Write failing homepage structure assertions**

```ts
assert.match(home, /Morse/);
assert.match(home, /siteContent\.profile\.role/);
assert.match(home, /getFeaturedProjects/);
assert.match(home, /MorseHomeSections/);
assert.doesNotMatch(home, /DigitalHuman|RestoredHomeSections|系统展厅|高频问题|杠杆账本/);
assert.match(sections, /能力矩阵/);
assert.match(sections, /开发事实/);
assert.match(sections, /projectHashHref/);
assert.match(chat, /variant\?: 'overlay' \| 'embedded'/);
assert.match(home, /<MorseChat variant="embedded"\s*\/>/);
assert.doesNotMatch(chat, /video|audio|speech|tts|lipSync/i);
```

Also assert that only two featured cards render and that null stats are omitted rather than rendered as zero.

- [ ] **Step 2: Run RED**

```powershell
node --test tests/routes-contract.test.ts tests/chat-ui-contract.test.ts tests/site-shell-contract.test.ts
```

Expected: FAIL against the current DigitalHuman/S6 section composition and the missing embedded chat variant.

- [ ] **Step 3: Add the embedded chat presentation without changing request behavior**

Add this prop and initial-state rule in `MorseChat.tsx`; leave access, intent, SSE, source, retry, quota, and logout functions unchanged:

```tsx
type MorseChatProps = { variant?: 'overlay' | 'embedded' };

export default function MorseChat({ variant = 'overlay' }: MorseChatProps) {
  const embedded = variant === 'embedded';
  const [open, setOpen] = useState(embedded);
}
```

Embedded mode renders the existing panel as a labelled `section` in normal document flow and omits launcher/close controls. Overlay mode retains the current dialog and floating launcher. Embedded CSS has stable hero dimensions, `min-width: 0`, no fixed positioning, and mobile full-width behavior.

- [ ] **Step 4: Implement the approved hero**

Use this semantic structure in `app/page.tsx`:

```tsx
<main>
  <section className={styles.hero} aria-labelledby="home-title">
    <div className={styles.heroInner}>
      <div className={styles.identity} data-reveal>
        <p className={styles.kicker}>AGENT SYSTEM DEVELOPER</p>
        <h1 id="home-title"><span>Morse</span></h1>
        <p className={styles.role}>{siteContent.profile.role}</p>
        <p className={styles.summary}>{siteContent.profile.summary}</p>
        <div className={styles.actions}>
          <Link href="/works">查看作品</Link>
          <OpenChatButton>问数字摩斯</OpenChatButton>
        </div>
      </div>
      <MorseChat variant="embedded" />
    </div>
  </section>
  <MorseHomeSections
    content={siteContent}
    featuredProjects={getFeaturedProjects()}
    stats={stats}
  />
</main>
```

Do not add a portrait, generated avatar, fake contact, career timeline, or FAQ section.
Remove the route-local `ResumeModeToggle`, `ResumeSheet`, overlay chat, and footer imports because the root shell owns shared controls and the hero owns the single embedded chat instance.

- [ ] **Step 5: Implement the four homepage bands**

`MorseHomeSections` 只渲染两个公开代表项目、可回指证据的能力矩阵、开发事实和对话引导。项目导航使用 `projectHashHref(project.slug)`。开发事实展示总会话数、项目覆盖、活跃天数，以及每个工具的历史累计 Token 与最近 30 天 Token，并附 `generatedAt` 和覆盖日期。大 Token 数使用 `Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })` 格式化；可访问文本和 `title` 保留完整整数。

Build visible metrics from non-null values only:

```tsx
const metrics = [
  { label: 'AI 协作会话', value: stats.totals.sessions },
  { label: '项目覆盖', value: stats.totals.projects },
  { label: '近 90 天活跃', value: stats.totals.activeDaysLast90, suffix: '天' },
].flatMap((metric) => metric.value === null ? [] : [{ ...metric, value: metric.value }]);

const toolUsage = [
  { label: 'Codex', activity: stats.codex },
  { label: 'Claude Code', activity: stats.claudeCode },
].filter(({ activity }) => activity.allTime !== null || activity.last30Days !== null);
```

Each capability item uses a real anchor such as `/works#digital-morse` or `/works#deep-research`; do not render an unlinked logo/technology wall.

- [ ] **Step 6: Replace GSAP scroll reveal with native observation**

Modify `ScrollEffects.tsx` to use one IntersectionObserver and remove its `gsap` imports:

```tsx
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    (entry.target as HTMLElement).dataset.revealed = 'true';
    observer.unobserve(entry.target);
  }
}, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
```

Keep reduced-motion immediate reveal and cleanup every observed node.

- [ ] **Step 7: Run GREEN and commit**

```powershell
node --test tests/routes-contract.test.ts tests/chat-ui-contract.test.ts tests/site-shell-contract.test.ts tests/chat-core.test.ts tests/chat-sse.test.ts
git add app/page.tsx app/styles/hero.module.css components/MorseChat.tsx components/MorseChat.module.css components/home/MorseHomeSections.tsx components/home/MorseHomeSections.module.css components/home/RestoredHomeSections.tsx components/ScrollEffects.tsx
git commit -m "feat: rebuild the Morse homepage"
```

Expected: homepage contract PASS with no static FAQ, timeline, full gallery, or fake visual.

### Task 5: Replace Detail Navigation With an Accessible Expandable Works Gallery

**Files:**
- Modify: `tests/routes-contract.test.ts`
- Modify: `app/works/page.tsx`
- Modify: `app/works/page.module.css`
- Create: `components/works/ProjectGallery.tsx`
- Create: `components/works/ProjectGallery.module.css`
- Modify: `components/works/ProjectCard.tsx`
- Modify: `components/works/ProjectCard.module.css`
- Modify: `components/works/CaseStudy.tsx`
- Modify: `components/works/CaseStudy.module.css`
- Modify: `app/works/[slug]/page.tsx`
- Delete: `app/works/[slug]/page.module.css`

- [ ] **Step 1: Write failing gallery, accessibility, and redirect assertions**

Require `aria-expanded`, `aria-controls`, one-open state, Hash handling, external-link propagation isolation, grouped stack content, and compatibility redirect:

```ts
assert.match(gallery, /useState<ProjectSlug \| null>/);
assert.match(gallery, /window\.location\.hash/);
assert.match(gallery, /history\.replaceState/);
assert.match(card, /aria-expanded=\{expanded\}/);
assert.match(card, /aria-controls=\{detailsId\}/);
assert.match(card, /event\.stopPropagation\(\)/);
assert.match(caseStudy, /project\.techStack\.map/);
assert.match(caseRoute, /redirect\(`\/works#\$\{slug\}`\)/);
```

- [ ] **Step 2: Run RED**

```powershell
node --test tests/routes-contract.test.ts
```

Expected: FAIL because cards still navigate to independent case pages and no gallery state exists.

- [ ] **Step 3: Implement Hash-synchronized single-open state**

Create `ProjectGallery.tsx` with this state contract:

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  projectSlugs,
  type Project,
  type ProjectSlug,
} from '@/lib/site-content';
import ProjectCard from './ProjectCard';

export default function ProjectGallery({ projects }: { projects: Project[] }) {
  const [openSlug, setOpenSlug] = useState<ProjectSlug | null>(null);

  useEffect(() => {
    const syncFromHash = () => {
      const slug = window.location.hash.slice(1);
      setOpenSlug(projectSlugs.includes(slug as ProjectSlug) ? slug as ProjectSlug : null);
    };
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  function toggle(slug: ProjectSlug) {
    const next = openSlug === slug ? null : slug;
    setOpenSlug(next);
    history.replaceState(null, '', next ? `/works#${next}` : '/works');
    if (next) requestAnimationFrame(() => {
      document.getElementById(`project-${next}`)?.scrollIntoView({
        block: 'start',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    });
  }

  return (
    <div>
      {projects.map((project) => (
        <ProjectCard
          key={project.slug}
          project={project}
          expanded={openSlug === project.slug}
          onToggle={() => toggle(project.slug)}
        />
      ))}
    </div>
  );
}
```

The listener restores the open item on browser back/forward; an invalid Hash produces the all-collapsed state.

- [ ] **Step 4: Implement the controlled card and embedded detail**

Use a real button for expansion, put `data-project-slug={project.slug}` on the article, keep external anchors separate, and render `<CaseStudy>` inside the same article only when expanded. `CaseStudy` changes its project heading from `h1` to `h2`, adds grouped tech stacks after role, and keeps problem, decisions, structure, evidence, and boundaries. The expanded article uses `grid-column: 1 / -1`; mobile remains one column. CSS uses token-only 300ms card and 450ms detail transitions.

- [ ] **Step 5: Replace independent pages with redirects**

Keep `generateStaticParams`, validate the slug with `getProjectBySlug`, then call `redirect(`/works#${slug}`)`. Delete the route-local CSS file and update public-source tests to expect Hash destinations.

- [ ] **Step 6: Run GREEN and commit**

```powershell
node --test tests/routes-contract.test.ts tests/public-knowledge.test.ts tests/site-content.test.ts
git add app/works/page.tsx app/works/page.module.css components/works/ProjectGallery.tsx components/works/ProjectGallery.module.css components/works/ProjectCard.tsx components/works/ProjectCard.module.css components/works/CaseStudy.tsx components/works/CaseStudy.module.css app/works/[slug]/page.tsx app/works/[slug]/page.module.css
git commit -m "feat: add expandable single-page project cases"
```

Expected: focused tests PASS; old URLs remain reachable only as redirects.

### Task 6: Add Repeatable S9 Browser and Performance Gates

**Files:**
- Create: `scripts/s9-visual-smoke.mjs`
- Create: `scripts/s9-contract.test.mjs`
- Modify: `package.json`
- Create during verification: `docs/verify/s9/s9-home-desktop-1440x900.png`
- Create during verification: `docs/verify/s9/s9-home-mobile-390x844.png`
- Create during verification: `docs/verify/s9/s9-home-mobile-390-reduced.png`
- Create during verification: `docs/verify/s9/s9-works-desktop-1440x900.png`
- Create during verification: `docs/verify/s9/s9-works-mobile-390x844.png`
- Create during verification: `docs/verify/s9/s9-lighthouse-desktop.json`

- [ ] **Step 1: Write the failing harness contract**

`scripts/s9-contract.test.mjs` reads `package.json` and the harness source and requires these exact markers:

```js
assert.equal(packageJson.scripts['visual:s9'], 'node scripts/s9-visual-smoke.mjs http://127.0.0.1:3010');
for (const marker of [
  "'/'", "'/works'", 'content-agent', 'auto-operations',
  'deep-research', 'digital-morse', '1440', '900', '390', '844',
  'prefers-reduced-motion', 'morse-signal-canvas', 'data-project-slug',
  'aria-expanded', 'horizontalOverflow', 'canvasPixelVariance',
  'Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Network.responseReceived',
]) {
  assert.ok(harness.includes(marker), `missing S9 harness marker: ${marker}`);
}
```

- [ ] **Step 2: Run RED**

```powershell
node --test scripts/s9-contract.test.mjs
```

Expected: FAIL because `visual:s9` and the harness do not exist.

- [ ] **Step 3: Implement the raw-CDP harness**

Add `"visual:s9": "node scripts/s9-visual-smoke.mjs http://127.0.0.1:3010"` to `package.json`. Use the existing bounded WebSocket connection/timeout helpers from `scripts/s6-restoration-smoke.mjs`, then drive these exact cases:

```js
const viewports = [
  { name: 'desktop', width: 1440, height: 900, reducedMotion: false },
  { name: 'mobile', width: 390, height: 844, reducedMotion: false },
  { name: 'mobile-reduced', width: 390, height: 844, reducedMotion: true },
];
const slugs = ['content-agent', 'auto-operations', 'deep-research', 'digital-morse'];
```

For every viewport, inspect `document.documentElement.scrollWidth <= innerWidth`, header/content/chat rectangles, and console/page/network errors. On `/works`, click each unique `[data-project-slug="<slug>"] button[aria-expanded]`, assert exactly one `aria-expanded="true"`, assert `location.hash === '#<slug>'`, and verify the expanded element has `grid-column-start: 1`. Navigate each legacy `/works/<slug>` URL and assert final URL `/works#<slug>`. Compute Canvas pixel variance from a bounded 160x90 screenshot clip; reduced-motion expects a static Canvas with no active animations, normal desktop/mobile expects variance above zero. Emit only:

```js
const summary = {
  failures,
  screenshots,
  routeStatuses,
  canvasPixelVariance,
  expandedSlugs,
  horizontalOverflow,
  consoleErrors: consoleErrors.length,
  pageErrors: pageErrors.length,
  externalRuntimeRequests,
};
console.log(JSON.stringify(summary, null, 2));
```

Never log invite codes, DOM text, request bodies, response bodies, or page content.

- [ ] **Step 4: Run production browser verification**

Run in separate terminals:

```powershell
npm run build
$env:PORT='3010'; npm run start
npm run visual:s9
```

Expected: `failures: []`; fresh screenshots show `Morse`, the embedded text chat, two featured public projects, ability matrix, development facts, and works expansion at both widths.

- [ ] **Step 5: Run Lighthouse from the existing offline cache**

```powershell
npm exec --offline --yes --package=lighthouse@13.4.0 -- lighthouse http://127.0.0.1:3010/ --chrome-path="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --preset=desktop --only-categories=performance --output=json --output-path=docs/verify/s9/s9-lighthouse-desktop.json --chrome-flags="--headless --no-sandbox"
$report = Get-Content -Raw -Encoding utf8 'docs/verify/s9/s9-lighthouse-desktop.json' | ConvertFrom-Json
if ($report.categories.performance.score -lt 0.90) { throw 'Lighthouse performance below 0.90' }
```

Expected: performance score is `0.90` or higher without adding Lighthouse to project dependencies.

- [ ] **Step 6: Commit the repeatable gate and evidence**

```powershell
git add package.json scripts/s9-visual-smoke.mjs scripts/s9-contract.test.mjs docs/verify/s9
git commit -m "test: add S9 visual acceptance gate"
```

### Task 7: Full Regression, Safety Review, and Closeout Evidence

**Files:**
- Create: `docs/verify/s9/s9-closeout.md`
- Modify: `scripts/s6-restoration.test.mjs`
- Modify: `scripts/s7-contract.test.mjs`

- [ ] **Step 1: Run the full claim-proving suite**

First update the historical S6/S7 contract tests so they preserve old evidence checks but assert that §14 S9 supersedes the old live-page title, route, FAQ, screenshot, and CTA requirements. The tests must require `Morse`, `/works#slug`, `企业内部脱敏案例`, and the S9 spec path.

```powershell
npm run stats
npm test
npm run build
git diff --check
```

Expected: zero failures. Database-dependent tests may retain their documented skip when `DATABASE_URL` is absent; S9 does not require a database write or Provider call.

- [ ] **Step 2: Run final public-content safety scans**

Run the structured internal-project check:

```powershell
node -e "const c=require('./content/site-content.json'); for (const s of ['content-agent','auto-operations']) { const p=c.projects.find(x=>x.slug===s); if (!p || p.media!==null || p.actions.length!==0 || p.disclosure!=='internal-redacted') process.exit(1) }"
rg -n -S "RUNNING|login-workbench|生产环境运行中|部署 commit|访问系统" content public app components lib
rg -n -S "[A-Za-z]:\\\\|content[/\\\\]drafts|sk-[A-Za-z0-9]{16,}" content public app components lib
```

Expected: Node exits `0`; both `rg` commands return no matches. If a generic forbidden word appears in non-public implementation code, narrow the scan to the generated/live surface and document the exact reason rather than deleting unrelated server behavior.

- [ ] **Step 3: Inspect the five fresh screenshots**

Confirm: identity is `Morse`; no fake avatar; only two public featured projects on home; no FAQ/career/full gallery on home; works has four collapsed cards; one expanded detail shows grouped stack; internal projects have no screenshot or external action; 390px text and controls fit; reduced motion is static.

- [ ] **Step 4: Write exact closeout evidence**

Record baseline/HEAD commits, changed files, generated stats cutoff/coverage, test totals/skips, build routes, visual summary, Lighthouse score, privacy scan result, retained S8 chat behavior, and explicit no-video/no-voice/no-Provider/no-deploy/no-push boundaries in `docs/verify/s9/s9-closeout.md`.

- [ ] **Step 5: Commit only closeout-owned files**

```powershell
git add docs/verify/s9/s9-closeout.md scripts/s6-restoration.test.mjs scripts/s7-contract.test.mjs
git diff --cached --check
git commit -m "docs: close S9 portfolio redesign"
```

Omit unchanged optional files from `git add`. Do not stage `AGENTS.md`, research files, old untracked screenshots, `output/**`, or `.tmp-*` scripts. Do not push or merge until Morse explicitly requests closeout integration.

## Plan Self-Review

- Spec coverage: Tasks 1-7 cover public-content redaction, exact project stacks, Hash-only project details, Morse identity, persistent Canvas, brandless navigation, embedded text chat, two featured works, capability matrix, cross-tool sessions/projects/activity/Token statistics, reduced motion, mobile behavior, safety gates, Lighthouse, and closeout.
- Scope: video, voice, lip sync, career history, blog, course, static FAQ, Provider changes, web search, vector-database migration, deployment, and push remain excluded.
- Type consistency: `ProjectDisclosure`, `TechStackGroup`, `projectHashHref`, `DevelopmentStats`, `ToolActivity`, `TokenTotals`, and the `overlay | embedded` chat variant use the same names in content, components, tests, and browser gates.
- Privacy: internal projects have no public media/actions; stats serialize aggregates only; known external repository paths are read-only evidence sources and never enter generated JSON.
- Order: content safety and data contracts land before the UI consumes them; visual work precedes full browser and performance evidence.
