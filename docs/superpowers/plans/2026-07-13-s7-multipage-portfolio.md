# S7 Multipage Portfolio Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有单页正式站改成可验收的多页作品集垂直切片，交付全局站点壳层、统一公开内容源、四个可达案例路由，以及首页、作品目录和自动运营完整案例页。

**Architecture:** `content/site-content.json` 是页面与 RAG 共用的唯一公开内容源，`lib/site-content.ts` 提供类型与查询边界。Next.js App Router 用共享 `SiteShell` 承载 Header、Footer、简历入口与唯一一份 `MorseChat`；作品详情由 `app/works/[slug]/page.tsx` 静态生成，自动运营案例消费经过裁剪审查的真实登录页截图，其余项目用诚实的无图状态。现有访问码、SSE、pgvector、预算门和 Provider 抽象保持不变。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 6、Node 24 test runner、CSS Modules、现有全局 tokens、现有 pgvector/RAG；零新增项目依赖。

---

## 执行边界

- 基线是 `codex/s7-multipage-portfolio` 上的 `a4eba23`；开始每个任务前先用 `git status --short --branch` 确认没有吸收用户的未跟踪研究、概念图、`output/` 或临时脚本。
- 只读资产为 `E:\Wiki`、`E:\demo2`、`E:\小红书`、`E:\多agent`；不得在这些目录写文件、启动有副作用的运行时或改数据库。
- 不调用真实 Provider，不改 `db/migrations/**`、`compose.yaml` 或任何数据库 schema，不 push、不部署、不绑定域名。
- 不引入 UI 框架、图标库、图片处理包或外部运行时资源。组件 CSS 禁止裸色值，新增视觉值只能先进入 `app/styles/tokens.css`；本切片优先复用现有 token，不扩色板。
- 页面不出现业务效果数字、示例数字、假联系方式、假 CTA、生成 UI、概念图或数字人图。测试/构建/评测数据只允许进入对应案例的工程证据段，并明确验证层级。
- CTA 固定为：内容创作仅案例；自动运营访问 `https://aitavix.com`；深度研究 GitHub `https://github.com/Morse-Moss/Deep-research-sys`；数字摩斯 GitHub `https://github.com/Morse-Moss/Self-Website`。
- 原始生产截图只能从 `output/system-captures/raw/auto-operations-railway-login-desktop-1440-2026-07-13.png` 读取；仅裁剪后的审查版本可进入 `public/works/auto-operations/`，原图不得复制进 `public/` 或提交。

## 文件结构锁定

**需求与运行事实**

- Modify: `docs/portfolio-blueprint.md` — 追加 S7 多页信息架构、事实/素材/CTA 边界。
- Create: `docs/task-center/s7-multipage-portfolio.md` — S7 阶段契约与完成定义。
- Modify: `docs/task-center/run-state.md` — 当前指针、阶段证据和收尾状态。
- Create: `scripts/s7-contract.test.mjs` — 防止需求源、阶段契约与运行事实漂移。

**公开内容与查询**

- Create: `content/site-content.json` — 页面与 RAG 的唯一公开内容源。
- Create: `lib/site-content.ts` — `SiteContent`/`Project` 类型、slug 查询、首页查询与静态参数。
- Create: `tests/site-content.test.ts` — 四项目、CTA、媒体、禁词、无假数字与查询契约。
- Retain unchanged: `content/s3-content.json`、`scripts/site-content.test.mjs` — 仅作为旧 S3 历史文件保留；S7 运行时、页面与 RAG 不再引用，删除另行授权。

**RAG 迁移**

- Modify: `lib/server/public-knowledge.ts` — 从新内容模型产生 profile、四项目、FAQ 文档。
- Modify: `scripts/ingest-knowledge.mjs` — 只读取 `content/site-content.json`。
- Modify: `content/rag-eval.json` — gold set 使用四项目的新稳定 document id。
- Modify: `tests/public-knowledge.test.ts`、`tests/rag-eval-contract.test.ts`、`tests/rag-integration.test.ts`、`tests/chat-core.test.ts`、`tests/knowledge.test.ts` — 新 source path 与新项目 id。

**全局壳层**

- Create: `components/site/SiteShell.tsx`、`SiteHeader.tsx`、`SiteHeader.module.css`、`SiteFooter.tsx`、`SiteFooter.module.css`、`ResumeSheet.tsx`、`ResumeSheet.module.css`。
- Modify: `app/layout.tsx`、`app/globals.css`、`components/ResumeMode.module.css`、`tests/chat-ui-contract.test.ts`。
- Create: `tests/site-shell-contract.test.ts`。

**作品页面**

- Create: `components/works/ProjectCard.tsx`、`ProjectCard.module.css`、`CaseStudy.tsx`、`CaseStudy.module.css`。
- Rewrite: `app/page.tsx`; Create: `app/page.module.css`。
- Create: `app/works/page.tsx`、`app/works/page.module.css`。
- Create: `app/works/[slug]/page.tsx`、`app/works/[slug]/page.module.css`。
- Create: `tests/routes-contract.test.ts`。
- Retain unchanged after route cutover: `components/S3Sections.tsx`、`components/S3Sections.module.css`、`app/styles/hero.module.css` — S7 页面不再 import，删除另行授权。

**真实素材与验收**

- Create generated asset: `public/works/auto-operations/login-workbench-2026-07-13.png` — 原图裁剪为 510×580，不含品牌区、账号、任务或业务数据。
- Create: `tests/work-asset.test.ts`。
- Create: `scripts/s7-visual-smoke.mjs`; Modify: `package.json`; retain historical `scripts/s3-visual-smoke.mjs` and `visual:s3` unchanged。
- Create final evidence: `docs/verify/s7/s7-home-{desktop-1440,mobile-390,mobile-390-reduced}.png`、`s7-works-{desktop-1440,mobile-390}.png`、`s7-auto-operations-{desktop-1440,mobile-390}.png`、`s7-lighthouse-desktop.json`。

---

### Task 1: RED/GREEN for S7 requirement and Task Center synchronization

**Files:**
- Create: `scripts/s7-contract.test.mjs`
- Modify: `docs/portfolio-blueprint.md`
- Create: `docs/task-center/s7-multipage-portfolio.md`
- Modify: `docs/task-center/run-state.md`
- Modify: `docs/superpowers/plans/2026-07-13-s7-multipage-portfolio.md`
- Include unchanged fact sources: `docs/research/portfolio-reference-analysis-2026-07-13.md`、`docs/research/project-evidence-matrix-2026-07-13.md`

- [ ] **Step 1: Write the failing contract test**

Create `scripts/s7-contract.test.mjs` with at least three tests. Read all files with UTF-8, assert the stage contract exists, and assert the requirement source, stage contract and run-state contain:

```js
const routes = ['/', '/works', '/works/auto-operations'];
const links = [
  'https://aitavix.com',
  'https://github.com/Morse-Moss/Deep-research-sys',
  'https://github.com/Morse-Moss/Self-Website',
];

assert.match(blueprint, /S7 多页作品集垂直切片/);
assert.match(stage, /零新增依赖/);
assert.match(stage, /不调用 Provider/);
assert.match(stage, /不修改数据库 schema/);
for (const route of routes) assert.ok(stage.includes(`\`${route}\``));
for (const link of links) assert.ok(stage.includes(link));
assert.match(stage, /内容创作 Agent 系统.*仅案例/s);
assert.match(stage, /裁剪.*脱敏.*public\/works\/auto-operations/s);
assert.match(runState, /S7 MULTIPAGE VERTICAL SLICE ACTIVE/);
```

- [ ] **Step 2: Run the test and prove RED**

Run: `node --test scripts/s7-contract.test.mjs`

Expected: FAIL because the blueprint has no S7 decision section and the draft stage contract lacks required exact sections or strings.

- [ ] **Step 3: Add the exact S7 decision to the blueprint**

Append `## 11. S7 多页作品集垂直切片(2026-07-13)` to `docs/portfolio-blueprint.md` with these decisions:

```markdown
- 信息架构：全局 Header / Footer / 简历入口 / 数字摩斯；首个可验收路由为 `/`、`/works`、`/works/auto-operations`，其余三个项目建立可达静态案例路由。
- 首页：首页 H1 固定为“数字生命摩斯”，说明摩斯是 Agent 系统开发者；首屏同时出现身份和至少一张真实系统图，底部露出下一段作品内容；不显示业务效果数字。
- 作品目录：仅列内容创作 Agent 系统、自动运营 Agent 系统、深度研究 Agent 系统、数字摩斯；卡片只保留真实状态、名称、一句话、真实截图或“截图待补”和最多两个可用操作。
- 案例结构：问题 -> 我的角色 -> 关键判断 -> 真实结构 -> 验证证据 -> 当前边界。
- CTA：内容创作仅案例；自动运营访问 `https://aitavix.com`；深度研究 GitHub `https://github.com/Morse-Moss/Deep-research-sys`；数字摩斯 GitHub `https://github.com/Morse-Moss/Self-Website`。
- 内容源：新增 `content/site-content.json` 作为页面和 RAG 的唯一公开内容源；`content/drafts/**`、外部资产与旧 `content/s3-content.json` 不再作为运行时公开来源。
- 素材：仅使用经核验、裁剪和脱敏的真实截图；生成 UI、概念图、蓝图、数字人图和原始登录截图不得进入作品证据位。
- 技术与操作：零新增依赖；不调用 Provider、不修改数据库 schema、不部署、不 push，四个外部项目保持只读。
```

- [ ] **Step 4: Create the stage contract and align run-state**

`docs/task-center/s7-multipage-portfolio.md` must include `Outcome`、`Definition of Done`、`Allowed Scope`、`Forbidden Scope`、`Non-goals`、`Verification`、`Review`、`Approvals` and `Current Result` sections. `Definition of Done` must enumerate six reachable routes (`/`、`/works` and four `/works/<slug>` routes), exact CTAs, global chat mounted once, new knowledge source, image provenance, 1440/390/reduced-motion/console/Lighthouse gates, and the explicit no-Provider/no-schema/no-deploy boundary. Keep `Current Result` as `ACTIVE; implementation not started` until Task 8.

Update `run-state.md` only enough to make the stage contract the active pointer; do not rewrite M3 evidence.

- [ ] **Step 5: Verify GREEN and commit only the contract slice**

Run: `node --test scripts/s7-contract.test.mjs`

Expected: all contract tests PASS.

Run: `git diff --check`

Expected: exit 0 with no whitespace errors.

Commit:

```bash
git add docs/portfolio-blueprint.md docs/task-center/run-state.md docs/task-center/s7-multipage-portfolio.md docs/superpowers/plans/2026-07-13-s7-multipage-portfolio.md scripts/s7-contract.test.mjs docs/research/portfolio-reference-analysis-2026-07-13.md docs/research/project-evidence-matrix-2026-07-13.md
git commit -m "docs: define S7 multipage portfolio slice"
```

---

### Task 2: RED/GREEN for the typed single public content source

**Files:**
- Create: `tests/site-content.test.ts`
- Create: `content/site-content.json`
- Create: `lib/site-content.ts`

- [ ] **Step 1: Write the failing content tests**

The tests must import `getAllProjects`, `getFeaturedProjects`, `getProjectBySlug`, `getProjectStaticParams`, and `siteContent` from `lib/site-content.ts`, then assert:

```ts
assert.deepEqual(
  getAllProjects().map((project) => project.slug),
  ['content-agent', 'auto-operations', 'deep-research', 'digital-morse'],
);
assert.deepEqual(getProjectStaticParams(), [
  { slug: 'content-agent' },
  { slug: 'auto-operations' },
  { slug: 'deep-research' },
  { slug: 'digital-morse' },
]);
assert.equal(getFeaturedProjects()[0].slug, 'auto-operations');
assert.equal(getProjectBySlug('missing'), undefined);

const actions = Object.fromEntries(
  getAllProjects().map((project) => [project.slug, project.actions]),
);
assert.deepEqual(actions['content-agent'], [
  { kind: 'case', label: '查看案例', href: '/works/content-agent' },
]);
assert.deepEqual(actions['auto-operations'], [
  { kind: 'case', label: '查看案例', href: '/works/auto-operations' },
  { kind: 'external', label: '访问系统', href: 'https://aitavix.com' },
]);
assert.equal(actions['deep-research'][1].href, 'https://github.com/Morse-Moss/Deep-research-sys');
assert.equal(actions['digital-morse'][1].href, 'https://github.com/Morse-Moss/Self-Website');
```

Also serialize the JSON and reject `href="#"`, fake contact labels, `content/drafts`, Windows absolute paths, `output/system-captures`, `imagegen`, `Mock Provider` as a public capability, and the business-result phrases `节省工时`、`增长率`、`产能提升`. Assert only `auto-operations` has media and its path is `/works/auto-operations/login-workbench-2026-07-13.png`.

- [ ] **Step 2: Run the test and prove RED**

Run: `node --test tests/site-content.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/site-content.ts`.

- [ ] **Step 3: Create the exact type/query boundary**

Implement `lib/site-content.ts` with these public shapes and functions:

```ts
import contentJson from '../content/site-content.json' with { type: 'json' };

export const projectSlugs = [
  'content-agent',
  'auto-operations',
  'deep-research',
  'digital-morse',
] as const;

export type ProjectSlug = (typeof projectSlugs)[number];
export type ProjectAction = {
  kind: 'case' | 'external';
  label: '查看案例' | '访问系统' | 'GitHub';
  href: string;
};
export type ProjectMedia = {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  evidence: {
    capturedAt: string;
    commit: string;
    runMode: string;
    sanitization: string;
  };
};
export type CaseStudy = {
  problem: string;
  role: string;
  decisions: string[];
  structure: string[];
  evidence: string[];
  boundaries: string[];
};
export type Project = {
  slug: ProjectSlug;
  name: string;
  type: string;
  status: string;
  summary: string;
  featured: boolean;
  media: ProjectMedia | null;
  actions: ProjectAction[];
  caseStudy: CaseStudy;
};
export type SiteContent = {
  site: {
    name: string;
    description: string;
    nav: Array<{ label: string; href: '/' | '/works' }>;
    resumeMode: { storageKey: string; bodyClass: string; toggleLabel: string; printLabel: string };
    footer: { morse: string; statement: string; copyright: string };
  };
  profile: {
    kicker: string;
    title: string;
    role: string;
    summary: string;
    principles: string[];
  };
  home: { worksIntro: string; featuredSlugs: ProjectSlug[] };
  works: { title: string; intro: string };
  projects: Project[];
  faq: Array<{ question: string; answer: string }>;
};

export const siteContent = contentJson as SiteContent;
export const getAllProjects = (): Project[] => siteContent.projects;
export const getFeaturedProjects = (): Project[] =>
  siteContent.home.featuredSlugs.map((slug) => getProjectBySlug(slug)).filter((value): value is Project => Boolean(value));
export const getProjectBySlug = (slug: string): Project | undefined =>
  siteContent.projects.find((project) => project.slug === slug);
export const getProjectStaticParams = (): Array<{ slug: ProjectSlug }> =>
  projectSlugs.map((slug) => ({ slug }));
```

- [ ] **Step 4: Create `content/site-content.json` with approved facts**

Use the exact four-project mapping below. Every project must fill all six case sections; `evidence` contains engineering evidence, not business outcomes.

| slug | status | summary | evidence boundary |
|---|---|---|---|
| `content-agent` | `内网已部署` | `把商品素材、提示词、Provider 任务、生成结果与审核收进可追踪的电商内容生产工作台。` | 只写素材包、OperationRun、异步状态、失败恢复、版本归档；不得写客户、雇主、品牌、内网地址、源码或效果数字。 |
| `auto-operations` | `生产环境运行中` | `围绕已授权账号，把内容沉淀、草稿处理、素材、发布校验和人工确认连接成受控运营工作流。` | 写明 Railway 登录页只读采集、部署 commit `16f16ba`；不得声称无人值守发布、规避风控或增长效果。 |
| `deep-research` | `已接受能力持续扩展中` | `用可观察工件、证据覆盖、受限缺口修复和人工发布审批约束深度研究报告。` | 明确固定 `hv_analysis` 报告链已接受，Agent OS、分布式运行时和 Production Memory 仍为实验性/开发中。 |
| `digital-morse` | `本地闭环已验证 · 尚未部署` | `让个人作品集与 AI 分身共用同一份审核公开知识、来源展示和受控对话入口。` | 明确本地 pgvector/RAG/邀请码/SSE 已验证，真实 Provider 仅部分通过；没有“访问系统”按钮。 |

Set global content exactly as follows:

```json
{
  "site": {
    "name": "数字生命摩斯",
    "description": "摩斯的多页 AI 原生作品集与数字分身。",
    "nav": [
      { "label": "首页", "href": "/" },
      { "label": "作品", "href": "/works" }
    ],
    "resumeMode": {
      "storageKey": "morse.resumeMode",
      "bodyClass": "resume-mode",
      "toggleLabel": "简历模式",
      "printLabel": "打印 / 存 PDF"
    },
    "footer": {
      "morse": "-- --- .-. ... .",
      "statement": "数字摩斯在场，真人摩斯验收。",
      "copyright": "© 2026 数字生命摩斯"
    }
  },
  "profile": {
    "kicker": "AGENT SYSTEM DEVELOPER",
    "title": "数字生命摩斯",
    "role": "Agent 系统开发者",
    "summary": "我把研究、内容生产、运营协作和个人知识入口做成可验证、可恢复、有人负责最终判断的系统。",
    "principles": [
      "先定义事实与安全边界，再让 AI 加速。",
      "把重复工作沉淀为可检查、可恢复的流程。",
      "用测试、运行证据和人工验收约束完成状态。"
    ]
  },
  "home": {
    "worksIntro": "四个系统，分别处理内容生产、运营协作、深度研究和公开知识对话。",
    "featuredSlugs": ["auto-operations"]
  },
  "works": {
    "title": "作品",
    "intro": "这里展示真实状态、可公开证据和当前边界；没有证据的能力不会被包装成成果。"
  }
}
```

Add four FAQ entries that answer：摩斯的技术栈、AI native 的含义、摩斯在项目中的职责、如何快速了解作品。答案只使用 evidence matrix 已确认事实，并说明未知信息不会推断。

For `auto-operations.media`, use exactly:

```json
{
  "src": "/works/auto-operations/login-workbench-2026-07-13.png",
  "width": 510,
  "height": 580,
  "alt": "自动运营 Agent 系统经裁剪后的生产登录工作台",
  "caption": "生产登录页只读截取，2026-07-13；未登录、未执行业务操作，已裁去品牌区域。",
  "evidence": {
    "capturedAt": "2026-07-13",
    "commit": "16f16ba",
    "runMode": "Railway 生产登录页，只读",
    "sanitization": "裁去品牌区域；画面不含账号、任务、业务数据或 Provider 配置"
  }
}
```

- [ ] **Step 5: Verify GREEN**

Run: `node --test tests/site-content.test.ts`

Expected: all content/query tests PASS; exact four slugs and four CTA policies match.

Commit:

```bash
git add content/site-content.json lib/site-content.ts tests/site-content.test.ts
git commit -m "feat: add typed portfolio content source"
```

---

### Task 3: RED/GREEN for RAG migration to `site-content.json`

**Files:**
- Modify: `tests/public-knowledge.test.ts`
- Modify: `tests/rag-eval-contract.test.ts`
- Modify: `tests/rag-integration.test.ts`
- Modify: `tests/chat-core.test.ts`
- Modify: `tests/knowledge.test.ts`
- Modify: `content/rag-eval.json`
- Modify: `lib/server/public-knowledge.ts`
- Modify: `scripts/ingest-knowledge.mjs`
- Retain unchanged: `content/s3-content.json`
- Retain unchanged: `scripts/site-content.test.mjs`

- [ ] **Step 1: Change tests to the new public knowledge contract**

Set the stable approved document ids to:

```ts
new Set([
  'about',
  'project-content-agent',
  'project-auto-operations',
  'project-deep-research',
  'project-digital-morse',
  'faq-1',
  'faq-2',
  'faq-3',
  'faq-4',
])
```

Update every expected source prefix to `/^content\/site-content\.json#/`. Assert extracted documents never contain media paths, sanitization metadata, `截图待补`, `content/drafts`, absolute paths, or the forbidden operational claims from Task 2.

Update `content/rag-eval.json` to nine non-empty queries, one per approved document. Rename the operations expectation to `project-auto-operations` and add `数字摩斯为什么还没有访问系统按钮?` -> `project-digital-morse`.

- [ ] **Step 2: Run focused tests and prove RED**

Run:

```bash
node --test tests/public-knowledge.test.ts tests/rag-eval-contract.test.ts tests/chat-core.test.ts tests/knowledge.test.ts
```

Expected: FAIL because extractor and ingestion still reference `content/s3-content.json`, and the digital-morse document is absent.

- [ ] **Step 3: Implement extraction from the new model**

`extractPublicKnowledge(content)` must produce:

- `about`: `profile.role`、`profile.summary` and all `profile.principles`.
- one `project-<slug>` document for every project, using `status`、`summary`、`caseStudy.problem`、`role`、`decisions`、`structure`、`evidence` and `boundaries`.
- `faq-1` through `faq-4` from `siteContent.faq`.

Use `content/site-content.json#profile`、`#projects.<slug>` and `#faq.<index>` source paths. Do not include `media`, `actions`, image captions or evidence provenance in embedded text; those fields support the website, not model claims.

Change only the file read in `scripts/ingest-knowledge.mjs`:

```js
const liveContent = JSON.parse(
  await fs.readFile(path.join(repoRoot, 'content', 'site-content.json'), 'utf8'),
);
```

Keep checksum, embedding signature, transaction ownership, stale-document deletion and DB schema unchanged.

- [ ] **Step 4: Prove the old source is absent from every S7 live consumer**

Run:

```bash
rg -n "s3-content" app/layout.tsx app/page.tsx app/works components/site components/works lib/server/public-knowledge.ts scripts/ingest-knowledge.mjs tests/public-knowledge.test.ts tests/rag-eval-contract.test.ts
```

Expected: no matches. The historical JSON and old S3 contract test remain untouched and outside all S7 live consumers.

- [ ] **Step 5: Verify GREEN without a database**

Run:

```bash
node --test tests/public-knowledge.test.ts tests/rag-eval-contract.test.ts tests/chat-core.test.ts tests/knowledge.test.ts
```

Expected: all focused tests PASS and public knowledge count is exactly 9.

Run: `npm test`

Expected: all non-database tests PASS; database integration tests may report SKIP only when `DATABASE_URL` is unset.

Commit:

```bash
git add content/site-content.json content/rag-eval.json lib/server/public-knowledge.ts scripts/ingest-knowledge.mjs tests
git commit -m "refactor: migrate public RAG knowledge source"
```

---

### Task 4: RED/GREEN for the global SiteShell, Header, Footer, resume entry, and MorseChat

**Files:**
- Create: `tests/site-shell-contract.test.ts`
- Modify: `tests/chat-ui-contract.test.ts`
- Create: `components/site/SiteShell.tsx`
- Create: `components/site/SiteHeader.tsx`
- Create: `components/site/SiteHeader.module.css`
- Create: `components/site/SiteFooter.tsx`
- Create: `components/site/SiteFooter.module.css`
- Create: `components/site/ResumeSheet.tsx`
- Create: `components/site/ResumeSheet.module.css`
- Modify: `components/ResumeMode.module.css`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing shell tests**

Assert `app/layout.tsx` imports and renders exactly one `<SiteShell>`, imports no old content JSON, and builds metadata from `siteContent.site`. Assert `SiteShell.tsx` renders exactly one each of `SiteHeader`, `SiteFooter`, `ResumeModeToggle`, `ResumeSheet`, and `MorseChat`, with normal content inside `data-standard-content` and resume content inside `data-resume-section`.

Update `tests/chat-ui-contract.test.ts` so its mount assertion reads `components/site/SiteShell.tsx`, not `app/page.tsx`. Add a contract for the exact labels `招人的`、`找人做事的`、`同行交流`; assert the first selects `interviewer`, the other two select `general`, and clicking only updates mode/draft without calling `sendMessage`.

- [ ] **Step 2: Run tests and prove RED**

Run: `node --test tests/site-shell-contract.test.ts tests/chat-ui-contract.test.ts`

Expected: FAIL because the `components/site` files do not exist and chat is still mounted in the homepage.

- [ ] **Step 3: Implement the global shell**

Use this ownership shape:

```tsx
export default function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ResumeModeToggle config={siteContent.site.resumeMode} />
      <div data-standard-content>
        <SiteHeader />
        {children}
        <SiteFooter />
      </div>
      <ResumeSheet content={siteContent} />
      <MorseChat />
    </>
  );
}
```

`SiteHeader` is a client component using `next/link` and `usePathname`; it renders the brand link plus only 首页/作品, and marks the matching link with `aria-current="page"`. At 390px it stays a single compact row with stable hit targets and no hamburger state.

`SiteFooter` renders only the three strings from `site.footer`; it contains no contact links.

`ResumeSheet` contains title, role, summary, the three principles, all four project names/statuses, and the existing `ResumePrintButton`. It contains no stats or contact placeholders.

Replace the old starter question array in `MorseChat` with this structured intent list:

```ts
const starterIntents = [
  {
    label: '招人的',
    mode: 'interviewer',
    prompt: '请从招聘方视角介绍最匹配的项目、能力证据和仍需补充的信息。',
  },
  {
    label: '找人做事的',
    mode: 'general',
    prompt: '我想了解摩斯会如何分析并推进一个 AI 系统需求。',
  },
  {
    label: '同行交流',
    mode: 'general',
    prompt: '请介绍摩斯在 Agent、RAG 和多 Agent 系统上的关键工程判断。',
  },
] as const;
```

The click handler sets `mode` and `draft` only. Sending remains an explicit visitor action, so this UI change cannot trigger a Provider call by itself.

Move the pre-hydration resume boot script in `app/layout.tsx` to read `siteContent.site.resumeMode`. Wrap `{children}` with `SiteShell`; remove chat and resume toggle from `app/page.tsx` in Task 6.

Use existing CSS variables only. `ResumeModeToggle` may remain fixed, but desktop header must reserve enough right padding that the control does not overlap navigation; at 390px the control sits below the header or uses a dedicated stable slot. Keep the toggle outside `data-standard-content` so users can exit resume mode.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/site-shell-contract.test.ts tests/chat-ui-contract.test.ts`

Expected: all tests PASS; shell source contains exactly one `<MorseChat />`.

Run: `npm run build`

Expected: PASS with `/` statically prerendered; no TypeScript errors.

Commit:

```bash
git add app/layout.tsx app/globals.css components/ResumeMode.module.css components/site tests/site-shell-contract.test.ts tests/chat-ui-contract.test.ts
git commit -m "feat: add global portfolio shell"
```

---

### Task 5: RED/GREEN for the sanitized real auto-operations asset

**Files:**
- Create: `tests/work-asset.test.ts`
- Create generated: `public/works/auto-operations/login-workbench-2026-07-13.png`
- Read only: `output/system-captures/raw/auto-operations-railway-login-desktop-1440-2026-07-13.png`

- [ ] **Step 1: Write the failing asset test**

Read the PNG IHDR directly and assert width 510, height 580. Assert `public/works/auto-operations/` contains exactly the approved filename and no name matching `/raw|railway|desktop-1440|拓效|tavix/i`. Assert the source file is not under `public/`.

- [ ] **Step 2: Run the test and prove RED**

Run: `node --test tests/work-asset.test.ts`

Expected: FAIL with `ENOENT` for the approved public PNG.

- [ ] **Step 3: Produce the crop without adding a dependency**

From PowerShell in `E:\Revolution`, run this exact block. It removes the entire left brand/marketing area and keeps only the production login workbench panel; it does not blur or invent pixels.

```powershell
Add-Type -AssemblyName System.Drawing
$sourcePath = (Resolve-Path 'output/system-captures/raw/auto-operations-railway-login-desktop-1440-2026-07-13.png').Path
$destinationDir = 'public/works/auto-operations'
$destinationPath = Join-Path $destinationDir 'login-workbench-2026-07-13.png'
New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
$source = [System.Drawing.Bitmap]::FromFile($sourcePath)
$crop = New-Object System.Drawing.Rectangle 760,200,510,580
$result = New-Object System.Drawing.Bitmap 510,580
$graphics = [System.Drawing.Graphics]::FromImage($result)
$graphics.DrawImage($source, (New-Object System.Drawing.Rectangle 0,0,510,580), $crop, [System.Drawing.GraphicsUnit]::Pixel)
$result.Save((Join-Path (Resolve-Path $destinationDir).Path 'login-workbench-2026-07-13.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$result.Dispose()
$source.Dispose()
```

- [ ] **Step 4: Review the output as an image, then verify GREEN**

Open the generated PNG and confirm it shows only the login panel; `TAVIX`、`拓效`、账号值、任务、业务内容 and Provider configuration must all be absent. If any forbidden region remains, do not redact with a decorative overlay; tighten the crop rectangle and preserve 510×580 output dimensions.

Run: `node --test tests/work-asset.test.ts`

Expected: PASS; IHDR is 510×580 and the public directory contains one approved image.

Run: `git status --short public output`

Expected: the public crop is new; the raw `output/` tree remains untracked/unstaged.

Commit:

```bash
git add public/works/auto-operations/login-workbench-2026-07-13.png tests/work-asset.test.ts
git commit -m "assets: add sanitized operations login evidence"
```

---

### Task 6: RED/GREEN for home, works index, and four reachable case routes

**Files:**
- Create: `tests/routes-contract.test.ts`
- Create: `components/works/ProjectCard.tsx`
- Create: `components/works/ProjectCard.module.css`
- Create: `components/works/CaseStudy.tsx`
- Create: `components/works/CaseStudy.module.css`
- Rewrite: `app/page.tsx`
- Create: `app/page.module.css`
- Create: `app/works/page.tsx`
- Create: `app/works/page.module.css`
- Create: `app/works/[slug]/page.tsx`
- Create: `app/works/[slug]/page.module.css`
- Retain unchanged: `components/S3Sections.tsx`
- Retain unchanged: `components/S3Sections.module.css`
- Retain unchanged: `app/styles/hero.module.css`

- [ ] **Step 1: Write failing route/component tests**

Assert the dynamic page exports `generateStaticParams`, calls `getProjectBySlug`, calls `notFound()` for an unknown slug, and renders `CaseStudy`. Assert static params are exactly the four slugs. Assert homepage and works index query `lib/site-content.ts`, not JSON directly. Assert `ProjectCard` uses `next/link` for case actions, plain `<a>` with `target="_blank" rel="noreferrer"` for external actions, and `next/image` only when `project.media` is present.

Scan all new CSS modules and reject `#[0-9a-f]` and `rgb(`/`rgba(`. Scan all new TSX and reject `imagegen`、`DigitalHuman`、`Lifeform`、fake contact labels and hard-coded business metrics.

- [ ] **Step 2: Run tests and prove RED**

Run: `node --test tests/routes-contract.test.ts`

Expected: FAIL because `/works` and project components do not exist.

- [ ] **Step 3: Implement reusable project presentation**

`ProjectCard` renders status, name, type, summary, optional real image, and at most two actions. For `media === null`, render a restrained `<div role="img" aria-label="<项目名>暂无可公开截图">截图待补</div>`; do not render an abstract illustration, generated UI or CSS workflow diagram.

`CaseStudy` renders exactly these ordered sections from data:

1. `问题`
2. `我的角色`
3. `关键判断`
4. `真实结构`
5. `验证证据`
6. `当前边界`

For automatic operations, place the approved image before the sections and show its caption plus commit/date/run-mode/sanitization as a compact evidence definition list. For other projects, show the same honest no-image state used by `ProjectCard`.

- [ ] **Step 4: Implement the homepage**

The first viewport must contain:

- H1 `数字生命摩斯`.
- visible role `Agent 系统开发者` and the profile summary.
- one primary `查看作品` link to `/works` and one `问数字摩斯` button that opens the existing global chat through a small custom browser event (`morse-chat:open`). Add the event listener to `MorseChat` without changing access/RAG behavior; include this event in `tests/chat-ui-contract.test.ts`.
- the auto-operations real screenshot in a stable 510/580 aspect-ratio media column.
- a visible hint of the next works section at the bottom of 1440×900 and 390×844 viewports.

Below the hero, render the four projects in an editorial grid. Do not render stats, technology chips, fake contact controls, DigitalHuman, Lifeform or continuous animation.

- [ ] **Step 5: Implement `/works` and the static case route**

`/works` renders the works title/intro and all four `ProjectCard`s without filter UI.

`app/works/[slug]/page.tsx` must include:

```tsx
export function generateStaticParams() {
  return getProjectStaticParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = getProjectBySlug(slug);
  return project
    ? { title: `${project.name} | 数字生命摩斯`, description: project.summary }
    : {};
}

export default async function ProjectPage({ params }: PageProps) {
  const { slug } = await params;
  const project = getProjectBySlug(slug);
  if (!project) notFound();
  return <CaseStudy project={project} />;
}
```

Use the Next 16 async `params` shape in `PageProps`. All four routes must build: `/works/content-agent`、`/works/auto-operations`、`/works/deep-research`、`/works/digital-morse`.

- [ ] **Step 6: Stop importing superseded single-page sections and verify GREEN**

Do not delete the three historical files. Remove all imports from live S7 routes and shell; cleanup remains outside this stage until separately authorized.

Run:

```bash
node --test tests/routes-contract.test.ts tests/chat-ui-contract.test.ts tests/site-content.test.ts
npm run build
```

Expected: tests PASS; build output lists `/`, `/works`, and `/works/[slug]` with four static params; no TypeScript or prerender error.

Run:

```bash
rg -n "S3Sections|s3-content|DigitalHuman|Lifeform" app/layout.tsx app/page.tsx app/works components/site components/works lib/server/public-knowledge.ts scripts/ingest-knowledge.mjs tests/routes-contract.test.ts tests/site-shell-contract.test.ts
```

Expected: no live route, shell, works component, content/RAG or S7 contract reference. Unused legacy component files remain unmodified and unimported.

Commit:

```bash
git add app components lib/site-content.ts tests/routes-contract.test.ts tests/chat-ui-contract.test.ts
git commit -m "feat: add multipage portfolio routes"
```

---

### Task 7: RED/GREEN for repeatable 1440/390, reduced-motion, console, CTA, and Lighthouse acceptance

**Files:**
- Create: `scripts/s7-visual-smoke.mjs`
- Modify: `package.json`
- Retain unchanged: `scripts/s3-visual-smoke.mjs`
- Create evidence: `docs/verify/s7/s7-*.png`
- Create evidence: `docs/verify/s7/s7-lighthouse-desktop.json`

- [ ] **Step 1: Replace the obsolete visual contract with a failing S7 harness test**

Add to `scripts/s7-contract.test.mjs` assertions that `package.json` contains:

```json
"visual:s7": "node scripts/s7-visual-smoke.mjs http://127.0.0.1:3010"
```

and leaves the historical `visual:s3` entry unchanged. Assert `scripts/s7-visual-smoke.mjs` contains all six routes, `Page.captureScreenshot`, `Runtime.consoleAPICalled`, `Runtime.exceptionThrown`, `prefers-reduced-motion`, `document.getAnimations`, `naturalWidth`, `horizontalOverflow`, and `Page.close`.

Run: `node --test scripts/s7-contract.test.mjs`

Expected: FAIL because `visual:s7` and the harness do not exist.

- [ ] **Step 2: Implement the multi-route CDP smoke**

Adapt the existing CDP client, but change the assertions to:

- Routes `/`, `/works`, `/works/content-agent`, `/works/auto-operations`, `/works/deep-research`, `/works/digital-morse` all return/render and have `document.title`.
- Header, Footer, resume toggle and one `[data-testid="morse-chat"]` exist on every route.
- All internal case links navigate to the expected pathname; exact external hrefs match Task 2 and carry `target="_blank" rel="noreferrer"`.
- Auto-operations `<img>` has `complete === true`, `naturalWidth === 510`, `naturalHeight === 580`; the other three cases show `截图待补`.
- `scrollWidth - clientWidth <= 1`, console errors 0, page exceptions 0 at 1440×900 and 390×844.
- At 390 reduced motion, `matchMedia('(prefers-reduced-motion: reduce)').matches === true`, no running infinite animation exists, and two screenshots 1400ms apart are byte-identical.
- Clicking `问数字摩斯` opens the global dialog; closing returns focusable page state. Do not redeem an invite or call `/api/chat`.
- Evidence output goes to `process.env.S7_EVIDENCE_DIR || path.join(os.tmpdir(), 'revolution-s7-smoke')`.

- [ ] **Step 3: Verify the harness contract is GREEN**

Run: `node --test scripts/s7-contract.test.mjs`

Expected: all contract tests PASS.

- [ ] **Step 4: Run dev smoke and production browser acceptance**

Terminal A:

```powershell
$env:PORT='3010'
npm run dev
```

Terminal B:

```powershell
curl.exe -I http://127.0.0.1:3010/
curl.exe -I http://127.0.0.1:3010/works
curl.exe -I http://127.0.0.1:3010/works/auto-operations
```

Expected: each response is HTTP 200. Stop dev, then run `npm run build`; expected PASS.

Start `npm run start` on port 3010. With the shared Edge CDP endpoint available:

```powershell
$env:CDP_BASE='http://127.0.0.1:9222'
$env:S7_EVIDENCE_DIR='docs/verify/s7'
npm run visual:s7
```

Expected: JSON result has `failures: []`; all seven named screenshots are written; console/page error arrays are empty; reduced-motion stillness is true.

- [ ] **Step 5: Run Lighthouse from the existing npm cache, not as a project dependency**

Keep the production server on port 3010 and run:

```powershell
npm exec --offline --yes --package=lighthouse@13.4.0 -- lighthouse http://127.0.0.1:3010/ --chrome-path="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --preset=desktop --only-categories=performance --output=json --output-path=docs/verify/s7/s7-lighthouse-desktop.json --chrome-flags="--headless --no-sandbox"
```

Expected: command exits 0. Verify the threshold:

```powershell
$report = Get-Content -Raw -Encoding utf8 'docs/verify/s7/s7-lighthouse-desktop.json' | ConvertFrom-Json
if ($report.categories.performance.score -lt 0.90) { throw "Lighthouse performance below 0.90" }
$report.categories.performance.score
```

Expected: output is `0.9` or higher. Do not add Lighthouse to `package.json` or `package-lock.json`.

- [ ] **Step 6: Commit code and reviewed evidence**

```bash
git add package.json scripts/s7-visual-smoke.mjs scripts/s7-contract.test.mjs docs/verify/s7/s7-*.png docs/verify/s7/s7-lighthouse-desktop.json
git commit -m "test: add S7 multipage acceptance gates"
```

---

### Task 8: Full verification, Task Center evidence, and scoped closeout

**Files:**
- Modify: `docs/task-center/s7-multipage-portfolio.md`
- Modify: `docs/task-center/run-state.md`
- Modify: `scripts/s7-contract.test.mjs`

- [ ] **Step 1: Run the full non-mutating local suite**

Run `npm test` with `DATABASE_URL` unset, then `npm run build`.

Expected: all non-database tests PASS; the existing six PostgreSQL integration checks may report SKIP and must be reported honestly. This stage does not claim a database integration run because it did not change database, access, retrieval or chat-service behavior.

- [ ] **Step 2: Verify the new public source without writing persistent data**

Run:

```powershell
node --test tests/public-knowledge.test.ts tests/rag-eval-contract.test.ts tests/knowledge.test.ts
rg -n "site-content\.json" scripts/ingest-knowledge.mjs lib/server/public-knowledge.ts
rg -n "s3-content\.json" scripts/ingest-knowledge.mjs lib/server/public-knowledge.ts
```

Expected: pure extraction/chunk/eval contract tests PASS; both live consumers reference `site-content.json`; the final scan has no matches. Do not run `knowledge:ingest`, migrations or any command that changes PostgreSQL rows.

- [ ] **Step 3: Run final safety and scope scans**

```powershell
rg -n "content/drafts|E:\\Wiki|E:\\demo2|E:\\小红书|E:\\多agent|output/system-captures/raw|imagegen" app components content lib public scripts tests
rg -n "href=.?['\"]#|示例数据|1,200|480|节省工时|增长率|产能提升" app components content lib public
rg -n "#[0-9a-fA-F]{3,8}|rgba?\(" app components -g "*.module.css"
git diff --check
git status --short --branch
```

Expected: first two scans have no live-content matches; CSS scan has no new module-level naked colors; diff check exits 0. Git status contains only intended S7 changes plus pre-existing user-owned untracked files, none staged accidentally.

- [ ] **Step 4: Review exact public behavior**

Confirm from browser evidence:

- `/`, `/works`, `/works/auto-operations` and the other three case URLs are reachable at both widths.
- Header/Footer/resume/chat are present globally; chat still requires a short code and works without changing API/database contracts.
- Content creation has no public external CTA.
- Auto operations has exactly `https://aitavix.com`; deep research and digital Morse have only their approved GitHub links.
- No fake number/contact, generated UI, digital-human image, external runtime request, text overlap or horizontal overflow exists.
- The auto-operations public image is the cropped 510×580 asset, not the raw capture.

- [ ] **Step 5: Close the stage records only after evidence passes**

Change `Current Result` in `docs/task-center/s7-multipage-portfolio.md` to `PASS` and record: exact commit baseline, changed-file scope, test count and skips, build result, six route checks, 1440/390/reduced-motion/console result, Lighthouse score, screenshot crop provenance, pure RAG source/extraction contract result, and explicit no database write/no Provider/no schema/no deploy/no push boundaries.

Advance `run-state.md` from `S7 MULTIPAGE VERTICAL SLICE ACTIVE` to `S7 MULTIPAGE VERTICAL SLICE PASS`; preserve all historical M3 evidence. Update `scripts/s7-contract.test.mjs` to assert the PASS pointer and rerun it.

Run: `node --test scripts/s7-contract.test.mjs`

Expected: PASS with the final pointer.

- [ ] **Step 6: Commit the closeout without touching user-owned files**

```bash
git add docs/task-center/s7-multipage-portfolio.md docs/task-center/run-state.md scripts/s7-contract.test.mjs
git diff --cached --name-only
git commit -m "docs: close S7 multipage portfolio slice"
```

Expected staged list: exactly the two Task Center documents and the contract test. Do not push or deploy.

---

## Self-review checklist

- [ ] Every S7 requirement maps to a task: docs/task center (Task 1), content/types (Task 2), RAG migration (Task 3), shell (Task 4), real sanitized image (Task 5), routes (Task 6), visual/performance gates (Task 7), closeout (Task 8).
- [ ] Project slugs, document ids, CTA labels/URLs, media dimensions and route params are identical across content, helpers, tests and pages.
- [ ] The plan contains no unspecified implementation gap; every RED command names the expected failure and every GREEN command names the passing contract.
- [ ] No task installs a project dependency, calls a Provider, changes a DB schema, writes an external asset, pushes or deploys.
- [ ] The original screenshot remains outside `public/` and staging; only the visually reviewed crop is public.
- [ ] Final success cannot be claimed before full tests, build, six-route browser checks, 1440/390/reduced-motion, zero console errors and Lighthouse performance >= 0.90 all have fresh evidence.
