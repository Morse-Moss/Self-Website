# Homepage Capability Matrix Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage's project-feature list with five fixed, reusable personal capability cards that match the site's dark-space visual language.

**Architecture:** Add a typed `profile.capabilityMatrix` content source that is independent from project capabilities. Render it as static semantic cards in `MorseHomeSections`, style it with the existing token system, and extend the existing S9 raw-CDP browser gate to prove the two-column desktop and one-column mobile layouts.

**Tech Stack:** Next.js App Router, React 19, TypeScript, JSON content, CSS Modules, Node test runner, raw Chrome DevTools Protocol visual harness.

---

## Scope And File Map

Implementation should run in a dedicated authorized worktree because the root checkout contains unrelated untracked files. Worktree creation remains approval-gated.

**Modify:**

- `content/site-content.json` — canonical five-card capability content.
- `lib/site-content.ts` — `ProfileCapability` and `SiteContent.profile.capabilityMatrix` types.
- `tests/site-content.test.ts` — exact content and forbidden project-feature contract.
- `components/home/MorseHomeSections.tsx` — semantic static card rendering.
- `components/home/MorseHomeSections.module.css` — restrained two-column card design.
- `app/styles/tokens.css` — one reusable compact card-radius token.
- `tests/routes-contract.test.ts` — component and CSS source contracts.
- `scripts/s9-visual-smoke.mjs` — desktop/mobile capability-card geometry assertions.
- `scripts/s9-contract.test.mjs` — visual-harness marker contract.

**Create during visual verification:**

- `docs/verify/capability-matrix/capability-matrix-desktop-1440.png`
- `docs/verify/capability-matrix/capability-matrix-mobile-390.png`
- `docs/verify/capability-matrix/capability-matrix-mobile-390-reduced.png`

**Do not modify:**

- Project `capabilities`, project detail copy, project media, development facts, FAQ, chat, resume mode, favicon candidates, production configuration, or deployment assets.

### Task 1: Add The Independent Capability Content Model

**Files:**

- Modify: `tests/site-content.test.ts`
- Modify: `content/site-content.json`
- Modify: `lib/site-content.ts`

- [ ] **Step 1: Write the failing content contract**

Add this test after `keeps the approved global copy and four FAQ topics` in `tests/site-content.test.ts`:

```ts
test("publishes five reusable profile capabilities instead of project features", () => {
  assert.deepEqual(siteContent.profile.capabilityMatrix, [
    {
      id: "agent-application-development",
      title: "Agent 应用开发",
      description: "把对话、工具调用、任务状态和人工确认串成可运行的 Agent 流程。",
    },
    {
      id: "full-stack-development-deployment",
      title: "全栈开发与部署",
      description: "独立完成前端、后端、数据库、异步任务、权限和服务器部署。",
    },
    {
      id: "rag-knowledge-base",
      title: "RAG 与知识库",
      description: "完成知识整理、向量检索、来源展示、内容更新和检索效果验证。",
    },
    {
      id: "multi-model-multimodal-integration",
      title: "多模型与多模态接入",
      description: "接入文本、图片和视频模型，处理不同模型的参数、素材与任务状态。",
    },
    {
      id: "ai-programming-collaboration",
      title: "AI 编程协作",
      description: "结合 Codex、Claude Code、WorkBuddy 完成需求拆解、代码实现、测试与审查，加快复杂项目交付。",
    },
  ]);

  const serialized = JSON.stringify(siteContent.profile.capabilityMatrix);
  for (const projectFeature of [
    "横纵研究",
    "证据台账",
    "论断映射",
    "缺口修复",
    "发布审批",
    "三类对话工作流",
    "BGE + pgvector",
    "停止与恢复",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(projectFeature.replace("+", "\\+")));
  }
});
```

- [ ] **Step 2: Run the focused content test and confirm RED**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/site-content.test.ts
```

Expected: FAIL because `siteContent.profile.capabilityMatrix` is undefined.

- [ ] **Step 3: Add the five canonical cards to the JSON source**

In `content/site-content.json`, add `capabilityMatrix` immediately after `profile.capabilities`:

```json
"capabilityMatrix": [
  {
    "id": "agent-application-development",
    "title": "Agent 应用开发",
    "description": "把对话、工具调用、任务状态和人工确认串成可运行的 Agent 流程。"
  },
  {
    "id": "full-stack-development-deployment",
    "title": "全栈开发与部署",
    "description": "独立完成前端、后端、数据库、异步任务、权限和服务器部署。"
  },
  {
    "id": "rag-knowledge-base",
    "title": "RAG 与知识库",
    "description": "完成知识整理、向量检索、来源展示、内容更新和检索效果验证。"
  },
  {
    "id": "multi-model-multimodal-integration",
    "title": "多模型与多模态接入",
    "description": "接入文本、图片和视频模型，处理不同模型的参数、素材与任务状态。"
  },
  {
    "id": "ai-programming-collaboration",
    "title": "AI 编程协作",
    "description": "结合 Codex、Claude Code、WorkBuddy 完成需求拆解、代码实现、测试与审查，加快复杂项目交付。"
  }
]
```

- [ ] **Step 4: Add the explicit TypeScript type**

In `lib/site-content.ts`, add:

```ts
export type ProfileCapability = {
  id: string;
  title: string;
  description: string;
};
```

Then extend `SiteContent.profile`:

```ts
profile: {
  kicker: string;
  title: string;
  role: string;
  summary: string;
  capabilities: string[];
  capabilityMatrix: ProfileCapability[];
  principles: string[];
};
```

- [ ] **Step 5: Run the focused content test and confirm GREEN**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/site-content.test.ts
```

Expected: PASS with no failed tests.

- [ ] **Step 6: Commit the content boundary**

```powershell
git add -- content/site-content.json lib/site-content.ts tests/site-content.test.ts
git commit -m "feat: define reusable profile capabilities"
```

### Task 2: Render Static Semantic Capability Cards

**Files:**

- Modify: `tests/routes-contract.test.ts`
- Modify: `components/home/MorseHomeSections.tsx`

- [ ] **Step 1: Replace the old component contract with a failing card contract**

In `tests/routes-contract.test.ts`, rename the home-section test to:

```ts
test('home sections render two public projects, reusable capability cards, and non-null facts', () => {
```

After `const sections = readSource(files.homeSections);`, add:

```ts
const capabilityStart = sections.indexOf('aria-labelledby="capabilities-title"');
const capabilityEnd = sections.indexOf('aria-labelledby="facts-title"', capabilityStart);
assert.notEqual(capabilityStart, -1);
assert.notEqual(capabilityEnd, -1);
const capabilitySection = sections.slice(capabilityStart, capabilityEnd);
```

Replace the old `featuredProjects.flatMap` and linked-project matrix assertions with:

```ts
assert.match(capabilitySection, /CAPABILITY PROFILE/);
assert.match(capabilitySection, /从多个真实项目中沉淀的可复用开发能力/);
assert.match(capabilitySection, /content\.profile\.capabilityMatrix\.map/);
assert.match(capabilitySection, /data-capability-section/);
assert.match(capabilitySection, /data-capability-matrix/);
assert.match(capabilitySection, /data-capability-card/);
assert.match(capabilitySection, /capability\.id/);
assert.match(capabilitySection, /capability\.title/);
assert.match(capabilitySection, /capability\.description/);
assert.doesNotMatch(capabilitySection, /featuredProjects|project\.|projectHashHref|<Link/);
assert.doesNotMatch(sections, /const capabilityMatrix = featuredProjects\.flatMap/);
```

Keep the existing assertions for the two featured projects, metrics, tool usage, number formatting, and absence of fake zero values.

- [ ] **Step 2: Run the focused routes contract and confirm RED**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/routes-contract.test.ts
```

Expected: FAIL because the component still derives the matrix from `featuredProjects` and renders links.

- [ ] **Step 3: Render the approved content source**

Change the component parameter destructuring to:

```tsx
export default function MorseHomeSections({
  content,
  featuredProjects,
  stats,
}: {
  content: SiteContent;
  featuredProjects: Project[];
  stats: DevelopmentStats;
}) {
```

Delete:

```ts
const capabilityMatrix = featuredProjects.flatMap((project) =>
  project.capabilities.map((capability) => ({ project, capability })),
);
```

Replace the current capability section with:

```tsx
<section className={styles.band} aria-labelledby="capabilities-title" data-capability-section>
  <div className={styles.container}>
    <header className={`${styles.sectionHeader} ${styles.capabilityHeader}`} data-reveal>
      <p className={styles.kicker}>CAPABILITY PROFILE</p>
      <h2 id="capabilities-title">能力矩阵</h2>
      <p>从多个真实项目中沉淀的可复用开发能力。</p>
    </header>

    <ul className={styles.matrix} data-capability-matrix>
      {content.profile.capabilityMatrix.map((capability, index) => (
        <li key={capability.id} data-capability-card data-reveal>
          <span className={styles.matrixIndex} aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className={styles.matrixBody}>
            <h3>{capability.title}</h3>
            <p>{capability.description}</p>
          </div>
        </li>
      ))}
    </ul>
  </div>
</section>
```

- [ ] **Step 4: Run the focused routes contract and confirm GREEN**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/routes-contract.test.ts
```

Expected: PASS with no failed tests.

- [ ] **Step 5: Commit the semantic rendering change**

```powershell
git add -- components/home/MorseHomeSections.tsx tests/routes-contract.test.ts
git commit -m "feat: render reusable capability cards"
```

### Task 3: Apply The Site-Aligned Card Design

**Files:**

- Modify: `tests/routes-contract.test.ts`
- Modify: `app/styles/tokens.css`
- Modify: `components/home/MorseHomeSections.module.css`

- [ ] **Step 1: Add a failing CSS contract**

Add this test to `tests/routes-contract.test.ts`:

```ts
test('capability cards use the approved restrained responsive layout', () => {
  const styles = readSource(files.homeSectionStyles);
  const tokens = readSource(files.tokens);

  assert.match(tokens, /--radius-card:\s*6px;/);
  assert.match(styles, /\.capabilityHeader[\s\S]*?\.kicker::after/);
  assert.match(
    styles,
    /\.matrix\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
  );
  assert.match(styles, /\.matrix li:last-child\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;/);
  assert.match(styles, /border-radius:\s*var\(--radius-card\);/);
  assert.match(styles, /background:\s*var\(--surface-glass\);/);
  assert.match(styles, /box-shadow:\s*inset 0 1px 0 var\(--edge-highlight\);/);
  assert.match(
    styles,
    /@media \(max-width:\s*760px\)[\s\S]*?\.matrix\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*760px\)[\s\S]*?\.matrix li:last-child\s*\{[\s\S]*?grid-column:\s*auto;/,
  );
  assert.doesNotMatch(styles, /matrix[^}]*transform:\s*(?:translate|scale)/s);
});
```

If `files.tokens` does not yet exist in the test fixture, add:

```ts
tokens: path.resolve('app/styles/tokens.css'),
```

- [ ] **Step 2: Run the focused CSS contract and confirm RED**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/routes-contract.test.ts
```

Expected: FAIL because the compact card token and card-grid rules do not exist.

- [ ] **Step 3: Add the card-radius token**

Under the radius section in `app/styles/tokens.css`, add:

```css
--radius-card: 6px;
```

- [ ] **Step 4: Replace the old matrix row styles**

In `MorseHomeSections.module.css`, replace `.matrix` through `.matrixProject` with:

```css
.capabilityHeader .kicker::after {
  display: block;
  width: var(--space-7);
  height: 1px;
  margin-top: var(--space-2);
  background: var(--accent);
  content: "";
  opacity: .72;
}

.matrix {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}

.matrix li {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 176px;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-5);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface-glass);
  box-shadow: inset 0 1px 0 var(--edge-highlight);
  transition:
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.matrix li::before {
  position: absolute;
  top: -1px;
  left: var(--space-5);
  width: var(--space-7);
  height: 1px;
  background: var(--accent);
  content: "";
  opacity: .62;
}

@media (hover: hover) {
  .matrix li:hover {
    border-color: var(--line-strong);
    background: var(--elevated-glass);
  }
}

.matrix li:last-child {
  grid-column: 1 / -1;
  min-height: 136px;
}

.matrixIndex {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
}

.matrixBody {
  display: grid;
  gap: var(--space-3);
  margin-top: auto;
}

.matrixBody h3 {
  margin: 0;
  color: var(--ink);
  font-size: var(--fs-h3);
  letter-spacing: 0;
}

.matrixBody p {
  max-width: 42rem;
  margin: 0;
  color: var(--muted);
  line-height: 1.8;
}

.matrix li:last-child .matrixBody {
  grid-template-columns: minmax(200px, .42fr) minmax(0, 1fr);
  align-items: start;
  gap: var(--space-6);
}
```

Replace the current mobile matrix rules inside `@media (max-width: 760px)` with:

```css
.matrix {
  grid-template-columns: 1fr;
}

.matrix li,
.matrix li:last-child {
  grid-column: auto;
  min-height: 0;
}

.matrix li:last-child .matrixBody {
  grid-template-columns: 1fr;
  gap: var(--space-3);
}
```

- [ ] **Step 5: Run the focused contract and confirm GREEN**

Run:

```powershell
node --env-file-if-exists=.env.local --test tests/routes-contract.test.ts
```

Expected: PASS with no failed tests.

- [ ] **Step 6: Commit the visual system change**

```powershell
git add -- app/styles/tokens.css components/home/MorseHomeSections.module.css tests/routes-contract.test.ts
git commit -m "style: redesign homepage capability matrix"
```

### Task 4: Extend Browser Acceptance And Capture Evidence

**Files:**

- Modify: `scripts/s9-contract.test.mjs`
- Modify: `scripts/s9-visual-smoke.mjs`
- Create: `docs/verify/capability-matrix/capability-matrix-desktop-1440.png`
- Create: `docs/verify/capability-matrix/capability-matrix-mobile-390.png`
- Create: `docs/verify/capability-matrix/capability-matrix-mobile-390-reduced.png`

- [ ] **Step 1: Add failing harness markers to the S9 contract**

Add these entries to the marker array in `S9 raw-CDP harness contains the complete route, viewport, and event contract`:

```js
'data-capability-section',
'data-capability-matrix',
'data-capability-card',
'capabilityCardCount',
'capabilityLayoutValid',
```

- [ ] **Step 2: Run the focused S9 contract and confirm RED**

Run:

```powershell
node --test scripts/s9-contract.test.mjs
```

Expected: FAIL because the browser harness does not inspect capability-card geometry.

- [ ] **Step 3: Extend `inspectHome` with exact geometry checks**

Inside the `client.evaluate` block in `inspectHome`, after the `facts` query, add:

```js
const capabilityMatrix = document.querySelector('[data-capability-matrix]');
const capabilityCards = Array.from(document.querySelectorAll('[data-capability-card]'));
const capabilityMatrixRect = capabilityMatrix?.getBoundingClientRect();
const capabilityCardRects = capabilityCards.map((card) => card.getBoundingClientRect());
const capabilityTolerance = 2;
const desktopCapabilityLayout = Boolean(
  capabilityMatrixRect
  && capabilityCardRects.length === 5
  && Math.abs(capabilityCardRects[0].top - capabilityCardRects[1].top) <= capabilityTolerance
  && capabilityCardRects[0].right < capabilityCardRects[1].left
  && Math.abs(capabilityCardRects[4].width - capabilityMatrixRect.width) <= capabilityTolerance
);
const mobileCapabilityLayout = Boolean(
  capabilityMatrixRect
  && capabilityCardRects.length === 5
  && capabilityCardRects.every(
    (rect) => Math.abs(rect.width - capabilityMatrixRect.width) <= capabilityTolerance,
  )
  && capabilityCardRects.every(
    (rect, index) => index === 0 || rect.top > capabilityCardRects[index - 1].top,
  )
);
```

Add to the returned state:

```js
capabilityCardCount: capabilityCardRects.length,
capabilityLayoutValid: innerWidth > 760 ? desktopCapabilityLayout : mobileCapabilityLayout,
```

After the existing `capabilityVisible` assertion, add:

```js
check(state.capabilityCardCount === 5, `${viewportName}:home:capability-card-count`);
check(state.capabilityLayoutValid, `${viewportName}:home:capability-layout`);
```

Extend `SAFE_SCREENSHOTS` and `screenshotFiles` with the isolated capability evidence names:

```js
'capability-matrix-desktop-1440.png',
'capability-matrix-mobile-390.png',
'capability-matrix-mobile-390-reduced.png',
```

```js
desktop: {
  home: 's9-home-desktop-1440x900.png',
  works: 's9-works-desktop-1440x900.png',
  capabilities: 'capability-matrix-desktop-1440.png',
},
mobile: {
  home: 's9-home-mobile-390x844.png',
  works: 's9-works-mobile-390x844.png',
  capabilities: 'capability-matrix-mobile-390.png',
},
'mobile-reduced': {
  home: 's9-home-mobile-390-reduced.png',
  capabilities: 'capability-matrix-mobile-390-reduced.png',
},
```

Add this helper after `captureScreenshot`:

```js
async function captureElementScreenshot(client, viewportName, kind, selector) {
  const fileName = screenshotFiles[viewportName]?.[kind];
  if (!fileName) return;

  const clip = await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: window.scrollX + rect.left,
      y: window.scrollY + rect.top,
      width: rect.width,
      height: rect.height,
    };
  })()`);
  if (!clip) throw new HarnessError(`${viewportName}:home:capability-screenshot-target`);

  const result = await client.send('Page.captureScreenshot', {
    captureBeyondViewport: true,
    clip: { ...clip, scale: 1 },
    format: 'png',
    fromSurface: true,
  }, SCREENSHOT_TIMEOUT_MS);
  writeFileSync(path.join(evidenceDir, fileName), Buffer.from(result.data, 'base64'));
  screenshotByName.set(fileName, `docs/verify/capability-matrix/${fileName}`);
}
```

After every `[data-reveal]` node has been revealed and before sampling the homepage Canvas, add:

```js
await captureElementScreenshot(
  client,
  viewportName,
  'capabilities',
  '[data-capability-section]',
);
```

- [ ] **Step 4: Run the focused S9 contract and confirm GREEN**

Run:

```powershell
node --test scripts/s9-contract.test.mjs
```

Expected: PASS with no failed tests.

- [ ] **Step 5: Run the complete test and production build gates**

Run:

```powershell
npm test
npm run build
```

Expected: all tests pass with zero skips, and the Next.js production build exits 0 with the current route count.

- [ ] **Step 6: Start the production preview**

In terminal A:

```powershell
npm run start -- --hostname 127.0.0.1 --port 3010
```

Expected: Next.js reports ready on `http://127.0.0.1:3010`.

- [ ] **Step 7: Run the real desktop/mobile browser gate into an isolated evidence directory**

In terminal B:

```powershell
New-Item -ItemType Directory -Force docs/verify/capability-matrix | Out-Null
$env:S9_EVIDENCE_DIR = (Resolve-Path 'docs/verify/capability-matrix').Path
npm run visual:s9
Remove-Item Env:S9_EVIDENCE_DIR
```

Expected: exit 0 with `failures: []`, capability layout checks passing on desktop, mobile, and reduced motion, console/page errors 0, external runtime requests 0, and horizontal overflow 0.

- [ ] **Step 8: Inspect all three capability-section screenshots**

Open the three generated capability-section screenshots and verify:

- 1440x900: two columns, first four cards paired, fifth card full width with title left and description right.
- 390x844: one column, readable title and body text, fifth card visually equal to the others.
- 390x844 reduced motion: same layout, no hidden or overlapping content.
- All sizes: dark-space glass treatment, no green matrix styling, no oversized glow, no card nesting, no truncated WorkBuddy text.

- [ ] **Step 9: Commit browser acceptance and evidence**

```powershell
git add -- scripts/s9-contract.test.mjs scripts/s9-visual-smoke.mjs docs/verify/capability-matrix/capability-matrix-desktop-1440.png docs/verify/capability-matrix/capability-matrix-mobile-390.png docs/verify/capability-matrix/capability-matrix-mobile-390-reduced.png
git commit -m "test: verify capability matrix across viewports"
```

### Task 5: Final Local Closeout

**Files:**

- Verify only; knowledge changes are limited to the already approved spec and this plan unless `neat-freak` finds a concrete current-state conflict.

- [ ] **Step 1: Run final scoped checks**

```powershell
git diff --check
npm test
npm run build
git status --short --branch
```

Expected: diff check exits 0, tests and build pass, and status contains only the intended branch state plus pre-existing unrelated untracked files.

- [ ] **Step 2: Run scoped knowledge reconciliation**

Invoke `closeout`, which must route the changed paths and receipts through `neat-freak`. Expected verdict: `checked-no-change` unless the implementation reveals a concrete mismatch in README, `CLAUDE.md`, blueprint, or task-center state.

- [ ] **Step 3: Record the local delivery boundary**

Report:

```text
Controls: DIRECT / STANDARD / LOCAL
State: LOCAL_READY / KNOWLEDGE_RECONCILED
Push: not performed
Deployment: not performed
Excluded: favicon candidates and all pre-existing unrelated untracked files
```

Do not push, merge, deploy, or alter production until the user explicitly authorizes that external boundary.
