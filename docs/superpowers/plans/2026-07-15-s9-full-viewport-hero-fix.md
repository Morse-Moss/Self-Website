# S9 Full-Viewport Hero Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the S9 home hero fill the viewport below the fixed top bar at desktop, tablet, and mobile widths without compressing its content.

**Architecture:** Keep the existing home component structure. Replace the desktop cap and narrower viewport deductions with one shared minimum height, then make the raw-CDP acceptance gate require below-fold placement at every viewport.

**Tech Stack:** Next.js App Router, TypeScript, CSS Modules, Node test runner, raw CDP browser harness.

---

### Task 1: Lock the Full-Viewport Contract

**Files:**
- Modify: `scripts/s9-contract.test.mjs`

- [ ] **Step 1: Write the failing contract test**

Read `app/styles/hero.module.css` and the `inspectHome` slice of `scripts/s9-visual-smoke.mjs`. Require one `min-height: calc(100svh - var(--topbar-h));`, reject `min(680px`, the narrower `var(--space-9)` deduction, and the mobile `align-items: flex-start`; require the next band below the fold for every viewport.

- [ ] **Step 2: Run RED**

```powershell
node --test scripts/s9-contract.test.mjs
```

Expected: FAIL because the CSS still caps the desktop hero at 680px, shortens the mobile hero, and the harness still requires the next band to be visible.

- [ ] **Step 3: Commit only after Task 2 turns the test green**

The test and implementation belong in one focused commit so the branch never retains an intentionally failing contract.

### Task 2: Fill Every First Viewport

**Files:**
- Modify: `app/styles/hero.module.css`
- Modify: `scripts/s9-visual-smoke.mjs`
- Test: `scripts/s9-contract.test.mjs`

- [ ] **Step 1: Implement the desktop CSS**

Replace the base hero height with:

```css
min-height: calc(100svh - var(--topbar-h));
```

Remove the `min-height: auto` and `align-items: flex-start` overrides at 900px and the `var(--space-9)` height deduction at 640px so every width inherits the shared minimum and vertical centering. Keep all other responsive layout and spacing declarations unchanged.

- [ ] **Step 2: Update browser geometry checks**

Record whether the featured band begins at or below `innerHeight - 1` and require that state for desktop, mobile, and mobile-reduced.

- [ ] **Step 3: Run GREEN and static checks**

```powershell
node --test scripts/s9-contract.test.mjs scripts/s9-cdp.test.mjs
node --check scripts/s9-visual-smoke.mjs
git diff --check
```

Expected: all focused tests pass and all static checks exit 0.

- [ ] **Step 4: Commit the focused fix**

```powershell
git add app/styles/hero.module.css scripts/s9-contract.test.mjs scripts/s9-visual-smoke.mjs docs/superpowers/specs/2026-07-15-s9-full-viewport-hero-fix-design.md docs/superpowers/plans/2026-07-15-s9-full-viewport-hero-fix.md
git commit -m "fix: fill the Morse viewport"
```

### Task 3: Refresh Visual and Closeout Evidence

**Files:**
- Modify: `docs/verify/s9/s9-home-desktop-1440x900.png`
- Modify if regenerated: `docs/verify/s9/s9-home-mobile-390x844.png`
- Modify if regenerated: `docs/verify/s9/s9-home-mobile-390-reduced.png`
- Modify if regenerated: `docs/verify/s9/s9-works-desktop-1440x900.png`
- Modify if regenerated: `docs/verify/s9/s9-works-mobile-390x844.png`
- Modify: `docs/verify/s9/s9-closeout.md`

- [ ] **Step 1: Run production browser acceptance**

```powershell
npm run build
$env:PORT='3010'; npm run start
npm run visual:s9
```

Expected: `failures: []`; the 1440x900 and 390x844 screenshots contain only the hero in the first viewport.

- [ ] **Step 2: Inspect all five screenshots**

Confirm desktop and mobile full-height hero, 390px fit, reduced-motion stability, works expansion, and absence of overlap or generated product imagery.

- [ ] **Step 3: Run final gates**

```powershell
npm test
npm run build
git diff --check
```

Repeat the structured internal-project check and both live safety scans from the S9 closeout.

- [ ] **Step 4: Update evidence and commit**

Record the reopened full-viewport hero fix, fresh visual result, screenshot inspection, test/build totals, and unchanged no-Provider/no-DB-write/no-push/no-merge/no-deploy boundaries.

```powershell
git add docs/verify/s9/s9-home-desktop-1440x900.png docs/verify/s9/s9-home-mobile-390x844.png docs/verify/s9/s9-home-mobile-390-reduced.png docs/verify/s9/s9-works-desktop-1440x900.png docs/verify/s9/s9-works-mobile-390x844.png docs/verify/s9/s9-closeout.md
git commit -m "test: refresh S9 full-height hero evidence"
```
