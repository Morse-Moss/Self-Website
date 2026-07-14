# S6 Visual Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the S6 dark single-page homepage while retaining the verified S7 project routes and every S8 customer-service behavior.

**Architecture:** Remove `SiteShell` from the root layout, mount it only under `/works`, and compose the homepage from the original ambient hero plus a factual S6-style section renderer backed by `content/site-content.json` and `content/stats.json`. Keep `MorseChat.tsx` behavior unchanged and mount the current resume/chat surfaces once per route tree.

**Tech Stack:** Next.js App Router, React, TypeScript, CSS Modules, GSAP, Node test runner, PostgreSQL + pgvector for existing integration verification.

---

## File Map

- Modify `app/layout.tsx`: minimal document shell and resume boot script; no global `SiteShell`.
- Modify `app/page.tsx`: restored S6 hero and home-only global surfaces.
- Create `app/works/layout.tsx`: route-local `SiteShell` for the existing works pages.
- Create `components/home/RestoredHomeSections.tsx`: factual S6-style systems/about/evidence/FAQ/contact/footer flow.
- Modify `app/styles/hero.module.css`: add tokenized hero role and CTA styles; retain the original ambient layout.
- Modify `components/S3Sections.module.css`: add only the classes required by the restored factual renderer.
- Modify `content/site-content.json` and `lib/site-content.ts`: add the four verified hero capability labels.
- Modify `tests/routes-contract.test.ts`, `tests/site-shell-contract.test.ts`, `tests/chat-ui-contract.test.ts`, and `tests/site-content.test.ts`: replace the superseded S7-root-shell assumptions with the approved restoration contract.
- Create `scripts/s6-restoration-smoke.mjs`: dual-width browser acceptance for the restored home and retained works routes.
- Modify `package.json`: add `visual:s6-restore`.
- Modify `docs/portfolio-blueprint.md` and `docs/task-center/run-state.md`: record the approved S6 visual restoration without rewriting historical S7/S8 evidence.

### Task 1: Lock The Restoration Contract In Failing Tests

**Files:**
- Modify: `tests/routes-contract.test.ts`
- Modify: `tests/site-shell-contract.test.ts`
- Modify: `tests/chat-ui-contract.test.ts`
- Modify: `tests/site-content.test.ts`

- [ ] **Step 1: Replace the homepage route assertion with the restored contract**

Use this test body in `tests/routes-contract.test.ts`:

```ts
test('home restores the S6 identity surface while retaining verified projects and S8 chat', () => {
  const source = readSource(files.home);

  assert.match(source, /import DigitalHuman from ['"]@\/components\/DigitalHuman['"]/);
  assert.match(source, /import MorseChat from ['"]@\/components\/MorseChat['"]/);
  assert.match(source, /import RestoredHomeSections/);
  assert.match(source, /siteContent\.profile\.title/);
  assert.match(source, /siteContent\.profile\.role/);
  assert.match(source, /siteContent\.profile\.summary/);
  assert.match(source, /siteContent\.profile\.capabilities\.map/);
  assert.match(source, /<DigitalHuman\s*\/>/);
  assert.match(source, /<MorseChat\s*\/>/);
  assert.match(source, /href=['"]#systems['"]/);
  assert.doesNotMatch(source, /getFeaturedProjects|featured\.media|<ProjectCard/);
  assert.doesNotMatch(source, /1,200|480|示例数据|Email|WeChat/);
});
```

- [ ] **Step 2: Replace the root-shell ownership assertions**

Use these tests in `tests/site-shell-contract.test.ts`:

```ts
const worksLayoutPath = path.resolve('app/works/layout.tsx');

test('root layout is minimal and the works layout owns SiteShell', () => {
  const layout = readSource(layoutPath);
  const worksLayout = readSource(worksLayoutPath);

  assert.match(layout, /siteContent\.site\.resumeMode\.storageKey/);
  assert.match(layout, /siteContent\.site\.resumeMode\.bodyClass/);
  assert.doesNotMatch(layout, /import\s+SiteShell|<SiteShell/);
  assert.match(layout, /<body>\s*\{children\}\s*<\/body>/s);
  assert.match(worksLayout, /import SiteShell/);
  assert.match(worksLayout, /<SiteShell>\s*\{children\}\s*<\/SiteShell>/s);
});

test('home and works trees each mount resume and chat surfaces exactly once', () => {
  const shell = readSource(shellPath);
  const page = readSource(pagePath);

  assert.equal(count(shell, /<MorseChat\s*\/>/g), 1);
  assert.equal(count(page, /<MorseChat\s*\/>/g), 1);
  assert.equal(count(page, /<ResumeModeToggle\b/g), 1);
  assert.equal(count(page, /<ResumeSheet\b/g), 1);
  assert.equal(count(page, /data-standard-content/g), 1);
});
```

- [ ] **Step 3: Update chat mounting and content assertions**

In `tests/chat-ui-contract.test.ts`, assert one chat in `SiteShell` and one on the home route, because they are in separate route trees:

```ts
test('MorseChat is mounted once per route tree and keeps tokenized mobile full-screen mode', () => {
  const shell = fs.readFileSync(shellPath, 'utf8');
  const page = fs.readFileSync(pagePath, 'utf8');
  const styles = fs.readFileSync(stylePath, 'utf8');

  assert.equal((shell.match(/<MorseChat \/>/g) ?? []).length, 1);
  assert.equal((page.match(/<MorseChat \/>/g) ?? []).length, 1);
  assert.match(styles, /var\(--z-chat\)/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /inset:\s*0/);
  assert.match(styles, /100dvh/);
  assert.match(styles, /html\.morse-chat-open/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|rgba?\(/i);
});
```

Add this assertion to `tests/site-content.test.ts`:

```ts
assert.deepEqual(siteContent.profile.capabilities, [
  'Agent 系统',
  'RAG',
  '多 Agent',
  '全栈开发',
]);
```

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```powershell
node --test tests/routes-contract.test.ts tests/site-shell-contract.test.ts tests/chat-ui-contract.test.ts tests/site-content.test.ts
```

Expected: FAIL because `app/works/layout.tsx`, `profile.capabilities`, `RestoredHomeSections`, and the restored homepage composition do not exist yet.

- [ ] **Step 5: Commit the RED contract**

```powershell
git add -- tests/routes-contract.test.ts tests/site-shell-contract.test.ts tests/chat-ui-contract.test.ts tests/site-content.test.ts
git commit -m "test: define S6 visual restoration contract"
```

### Task 2: Split The Root And Works Route Shells

**Files:**
- Modify: `app/layout.tsx`
- Create: `app/works/layout.tsx`

- [ ] **Step 1: Make the root layout minimal**

Use this structure in `app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import Script from 'next/script';
import { siteContent } from '@/lib/site-content';
import './globals.css';

export const metadata: Metadata = {
  title: siteContent.site.name,
  description: siteContent.site.description,
};

const resumeModeBootScript = `
(() => {
  try {
    const key = ${JSON.stringify(siteContent.site.resumeMode.storageKey)};
    const rootClass = ${JSON.stringify(siteContent.site.resumeMode.bodyClass)};
    if (window.localStorage && window.localStorage.getItem(key) === 'true') {
      document.documentElement.classList.add(rootClass);
    }
  } catch (_) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <Script
          id="resume-mode-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: resumeModeBootScript }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Add the route-local works shell**

Create `app/works/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import SiteShell from '@/components/site/SiteShell';

export default function WorksLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
```

- [ ] **Step 3: Run the shell tests**

Run:

```powershell
node --test tests/site-shell-contract.test.ts tests/chat-ui-contract.test.ts
```

Expected: shell ownership assertions PASS; homepage composition assertions remain RED.

- [ ] **Step 4: Commit the route split**

```powershell
git add -- app/layout.tsx app/works/layout.tsx
git commit -m "refactor: isolate the works route shell"
```

### Task 3: Restore The Factual S6 Homepage

**Files:**
- Modify: `content/site-content.json`
- Modify: `lib/site-content.ts`
- Create: `components/home/RestoredHomeSections.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Add verified hero capabilities to the public content source**

Add this field beside `profile.summary` in `content/site-content.json`:

```json
"capabilities": ["Agent 系统", "RAG", "多 Agent", "全栈开发"]
```

Add the corresponding type in `lib/site-content.ts`:

```ts
capabilities: string[];
```

- [ ] **Step 2: Create the factual S6 section renderer**

Create `components/home/RestoredHomeSections.tsx`. It must:

```tsx
import Link from 'next/link';
import OpenChatButton from '@/components/site/OpenChatButton';
import type { SiteContent } from '@/lib/site-content';
import styles from '@/components/S3Sections.module.css';

type Stats = {
  generatedAt: string;
  methodology: string;
  claudeCode: { sessions: number | null; projects: number | null; activeDaysLast90: number | null };
};

export default function RestoredHomeSections({
  content,
  stats,
}: {
  content: SiteContent;
  stats: Stats;
}) {
  const metrics = [
    ['AI 协作会话', stats.claudeCode.sessions],
    ['项目覆盖', stats.claudeCode.projects],
    ['近 90 天活跃', stats.claudeCode.activeDaysLast90],
  ] as const;

  return (
    <>
      <section className={styles.section} id="systems" aria-labelledby="systems-title">
        <div className={styles.container}>
          <header className={styles.sectionHeader} data-reveal>
            <span className={styles.sectionIndex}>SEC.01</span>
            <div><p className={styles.sectionCaption}>SELECTED SYSTEMS</p><h2 id="systems-title">系统展厅</h2><p className={styles.sectionIntro}>{content.home.worksIntro}</p></div>
          </header>
          <div className={styles.galleryGrid}>
            {content.projects.map((project, index) => (
              <article className={styles.systemCard} key={project.slug} data-reveal>
                <header className={styles.cardHeader}><span className={styles.cardKicker}>SYS-{String(index + 1).padStart(2, '0')}</span><span className={styles.stateBadge}>{project.status}</span></header>
                <h3>{project.name}</h3>
                <dl className={styles.cardFacts}><div><dt>类型</dt><dd>{project.type}</dd></div><div><dt>说明</dt><dd>{project.summary}</dd></div></dl>
                <div className={styles.projectActions}>
                  {project.actions.map((action) => action.kind === 'case'
                    ? <Link className={styles.projectAction} href={action.href} key={action.href}>{action.label}</Link>
                    : <a className={styles.projectAction} href={action.href} target="_blank" rel="noreferrer" key={action.href}>{action.label}</a>)}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} id="about" aria-labelledby="about-title">
        <div className={styles.container}>
          <header className={styles.sectionHeader} data-reveal><span className={styles.sectionIndex}>SEC.02</span><div><p className={styles.sectionCaption}>ONE PERSON + AI SYSTEMS</p><h2 id="about-title">关于摩斯</h2><p className={styles.sectionIntro}>{content.profile.summary}</p></div></header>
          <div className={styles.principleGrid}>{content.profile.principles.map((principle, index) => <article className={styles.principle} key={principle} data-reveal><span>0{index + 1}</span><h3>{principle}</h3></article>)}</div>
        </div>
      </section>

      <section className={styles.section} id="ledger" aria-labelledby="ledger-title">
        <div className={styles.container}>
          <header className={styles.sectionHeader} data-reveal><span className={styles.sectionIndex}>SEC.03</span><div><p className={styles.sectionCaption}>VERIFIED ACTIVITY</p><h2 id="ledger-title">杠杆账本</h2><p className={styles.sectionIntro}>只展示本地统计管线可以追溯的聚合数据。</p></div></header>
          <div className={styles.ledgerGrid}>{metrics.map(([label, value]) => value === null ? null : <article className={styles.ledgerMetric} key={label} data-reveal><span className={styles.realTag}>真实统计</span><strong>{value}</strong><span>{label}</span></article>)}</div>
          <p className={styles.methodology} data-reveal>统计生成于 {new Date(stats.generatedAt).toLocaleDateString('zh-CN')}。{stats.methodology}</p>
        </div>
      </section>

      <section className={styles.section} id="faq" aria-labelledby="faq-title">
        <div className={styles.container}>
          <header className={styles.sectionHeader} data-reveal><span className={styles.sectionIndex}>SEC.04</span><div><p className={styles.sectionCaption}>ASK MORSE</p><h2 id="faq-title">高频问题</h2></div></header>
          <div className={styles.faqGrid}>{content.faq.map((item) => <article className={styles.faqItem} key={item.question} data-reveal><h3>{item.question}</h3><p>{item.answer}</p></article>)}</div>
        </div>
      </section>

      <section className={styles.contactSection} aria-labelledby="contact-title">
        <div className={styles.container}><div className={styles.contactPanel} data-reveal><p className={styles.sectionCaption}>NEXT STEP</p><h2 id="contact-title">继续了解</h2><p>查看完整项目证据，或者直接向数字摩斯提问。</p><div className={styles.contactActions}><Link className={styles.projectAction} href="/works">查看全部作品</Link><OpenChatButton className={styles.projectAction}>问数字摩斯</OpenChatButton></div></div></div>
      </section>

      <footer className={styles.footer} data-site-footer><div className={styles.container}><p className={styles.footerMorse}>{content.site.footer.morse}</p><p>{content.site.footer.statement}</p><small>{content.site.footer.copyright}</small></div></footer>
    </>
  );
}
```

- [ ] **Step 3: Compose the restored homepage**

`app/page.tsx` must mount the original ambient surface and the current resume/chat components:

```tsx
import Link from 'next/link';
import DigitalHuman from '@/components/DigitalHuman';
import MorseChat from '@/components/MorseChat';
import { ResumeModeToggle } from '@/components/ResumeMode';
import ScrollEffects from '@/components/ScrollEffects';
import RestoredHomeSections from '@/components/home/RestoredHomeSections';
import OpenChatButton from '@/components/site/OpenChatButton';
import ResumeSheet from '@/components/site/ResumeSheet';
import stats from '@/content/stats.json';
import { siteContent } from '@/lib/site-content';
import styles from './styles/hero.module.css';

export default function Home() {
  return (
    <>
      <ResumeModeToggle config={siteContent.site.resumeMode} />
      <ScrollEffects />
      <div data-standard-content>
        <main>
          <section className={styles.hero} aria-labelledby="home-title">
            <DigitalHuman />
            <div className={styles.container}><div className={styles.content}>
              <p className={styles.eyebrow}>{siteContent.profile.kicker}</p>
              <h1 className={styles.title} id="home-title">{siteContent.profile.title}</h1>
              <p className={styles.role}>{siteContent.profile.role}</p>
              <p className={styles.sub}>{siteContent.profile.summary}</p>
              <ul className={styles.chips}>{siteContent.profile.capabilities.map((capability) => <li className={styles.chip} key={capability}>{capability}</li>)}</ul>
              <div className={styles.actions}><Link className={styles.primaryAction} href="#systems">查看系统</Link><OpenChatButton className={styles.secondaryAction}>问数字摩斯</OpenChatButton></div>
            </div></div>
          </section>
          <RestoredHomeSections content={siteContent} stats={stats} />
        </main>
      </div>
      <ResumeSheet printLabel={siteContent.site.resumeMode.printLabel} profile={siteContent.profile} projects={siteContent.projects} />
      <MorseChat />
    </>
  );
}
```

- [ ] **Step 4: Run focused content and route tests**

Run:

```powershell
node --test tests/routes-contract.test.ts tests/site-shell-contract.test.ts tests/chat-ui-contract.test.ts tests/site-content.test.ts
```

Expected: component/content assertions PASS; style assertions remain RED until Task 4.

- [ ] **Step 5: Commit the restored structure**

```powershell
git add -- app/page.tsx components/home/RestoredHomeSections.tsx content/site-content.json lib/site-content.ts
git commit -m "feat: restore the factual S6 homepage"
```

### Task 4: Restore S6 Styling Without Regressing S8

**Files:**
- Modify: `app/styles/hero.module.css`
- Modify: `components/S3Sections.module.css`
- Modify: `tests/routes-contract.test.ts`

- [ ] **Step 1: Add tokenized hero role and actions**

Add to `app/styles/hero.module.css`:

```css
.role {
  margin-top: var(--space-3);
  color: var(--status-amber);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  letter-spacing: 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-6);
}

.primaryAction,
.secondaryAction {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 var(--space-5);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  letter-spacing: 0;
}

.primaryAction { background: var(--accent); color: var(--accent-ink); font-weight: 700; }
.secondaryAction { background: var(--surface-glass); color: var(--ink); }
.primaryAction:hover, .secondaryAction:hover { border-color: var(--accent); }
```

- [ ] **Step 2: Add factual project/contact action styles**

Add to `components/S3Sections.module.css`:

```css
.projectActions,
.contactActions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-5);
}

.projectAction {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 var(--space-4);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent);
  font: inherit;
  letter-spacing: 0;
  cursor: pointer;
}

.projectAction:hover { border-color: var(--accent); color: var(--ink); }
```

Ensure existing mobile rules keep `.galleryGrid`, `.principleGrid`, `.ledgerGrid`, and `.faqGrid` single-column at 760px or below, with `min-width: 0` and `overflow-wrap: anywhere` on cards.

- [ ] **Step 3: Update the route style contract**

Make `tests/routes-contract.test.ts` inspect `app/styles/hero.module.css` and `components/S3Sections.module.css`, asserting no raw colors, 44px actions, mobile media rules, `min-width: 0`, and `overflow-wrap: anywhere`.

- [ ] **Step 4: Run the focused tests and build**

```powershell
node --test tests/routes-contract.test.ts tests/site-shell-contract.test.ts tests/chat-ui-contract.test.ts tests/site-content.test.ts
npm run build
```

Expected: focused tests PASS and Next.js production build exits 0.

- [ ] **Step 5: Commit the visual restoration**

```powershell
git add -- app/styles/hero.module.css components/S3Sections.module.css tests/routes-contract.test.ts
git commit -m "style: restore the S6 portfolio language"
```

### Task 5: Add Dual-Width Restoration Smoke And Verify The Full Product

**Files:**
- Create: `scripts/s6-restoration-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create a browser smoke derived from the existing CDP harness**

The script must visit `/`, `/works`, and all four detail routes at 1440x900 and 390x844; assert the homepage contains `数字生命摩斯`, `系统展厅`, `杠杆账本`, and `高频问题`; open/close the chat; verify every route has `scrollWidth <= innerWidth`; record console and page exceptions; capture desktop/mobile homepage screenshots under `docs/verify/s6-restore/`; and run the 390px homepage once with `prefers-reduced-motion: reduce`.

Add this package script:

```json
"visual:s6-restore": "node scripts/s6-restoration-smoke.mjs http://127.0.0.1:3010"
```

- [ ] **Step 2: Run the full automated verification**

```powershell
$env:DATABASE_URL='postgresql://revolution@127.0.0.1:55432/revolution'
npm test
npm run build
git diff --check
```

Expected: all tests PASS, build exits 0, and diff check emits no errors.

- [ ] **Step 3: Restart the production server on 3010 with the fresh build**

Stop only the process listening on port 3010, then start `npm run start -- -p 3010` with `DATABASE_URL` set to the local project database. Do not configure or call a real Provider in this restoration task.

- [ ] **Step 4: Run browser acceptance**

```powershell
npm run visual:s6-restore
```

Expected: desktop, mobile, and reduced-motion checks report zero failures; all six routes return 200; screenshots show the S6 identity hero rather than the S7 screenshot-led hero.

- [ ] **Step 5: Inspect the two final screenshots**

Open `docs/verify/s6-restore/home-desktop-1440x900.png` and `docs/verify/s6-restore/home-mobile-390x844.png`. Reject the result if text, controls, chat, project status, or footer overlap, if the hero does not hint at the next section, or if the ambient stage obscures the identity copy.

### Task 6: Synchronize The Product Record And Commit The Restoration

**Files:**
- Modify: `docs/portfolio-blueprint.md`
- Modify: `docs/task-center/run-state.md`
- Add: `docs/verify/s6-restore/home-desktop-1440x900.png`
- Add: `docs/verify/s6-restore/home-mobile-390x844.png`

- [ ] **Step 1: Record the restoration decision**

Append a dated amendment that states: S6 visual language restored, S7 case routes retained, S8 functionality retained, current Provider still unconfigured/BLOCKED, no deployment performed, and factual content remains sourced from `content/site-content.json`.

- [ ] **Step 2: Run stale-pointer and content-safety checks**

```powershell
rg -n "S8 CUSTOMER SERVICE CONVERSATION MAINLINE PASS|S6 visual|S7 multipage|Real Provider BLOCKED" docs/task-center/run-state.md docs/portfolio-blueprint.md
rg -n "1,200|480|href=\"#\"|content/drafts|[A-Z]:\\" app components content/site-content.json
```

Expected: historical S7/S8 records remain; no forbidden live-content match is introduced.

- [ ] **Step 3: Stage only the restoration files**

Use explicit paths. Confirm `AGENTS.md`, existing research documents, concepts, `output/**`, temporary scripts, and non-final screenshots are absent from `git diff --cached --name-only`.

- [ ] **Step 4: Run final verification from the staged tree**

```powershell
$env:DATABASE_URL='postgresql://revolution@127.0.0.1:55432/revolution'
npm test
npm run build
git diff --cached --check
```

Expected: complete test suite and build PASS; staged diff check emits no errors.

- [ ] **Step 5: Commit**

```powershell
git commit -m "feat: restore the S6 portfolio experience"
```

Do not push or deploy without a new explicit instruction from Morse.
