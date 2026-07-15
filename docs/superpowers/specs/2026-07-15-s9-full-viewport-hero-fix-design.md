# S9 Full-Viewport Hero Fix

> Date: 2026-07-15
> Status: approved by Morse
> Selected direction: A, full-height hero at every viewport

## Problem

The S9 home hero currently uses `min(680px, ...)`, so a 1440x900 viewport ends the hero at roughly 744px including the fixed top bar. The section divider and the next heading therefore enter the first viewport and make the page look cut in half.

## Required Behavior

- At desktop, tablet, and mobile widths, the home hero must fill the viewport below the fixed top bar.
- The first pixel of the featured-work band must start at or below the bottom edge of the initial viewport.
- The identity, embedded text chat, actions, and fixed header must remain vertically centered and usable.
- Existing tablet and mobile stacking, spacing, and chat sizing remain unchanged.
- Content taller than the available viewport may expand the hero naturally; it must not be clipped to a fixed height.

## Scope

- Change `app/styles/hero.module.css` so one shared viewport-relative minimum applies at every width; remove the narrower rules that shorten it.
- Update `scripts/s9-visual-smoke.mjs` so every viewport requires the featured band below the fold.
- Update `scripts/s9-contract.test.mjs` with a source contract that fails on the old 680px cap.
- Refresh the five S9 screenshots and closeout evidence after browser acceptance passes.

## Similar-Case Audit

- `app/styles/hero.module.css` is the only live page rule combining a fixed pixel cap with viewport-relative hero height.
- `app/page.module.css` is not imported by the current home page and is outside this fix.
- `/works` has no equivalent capped first-screen hero.
- `MorseChat.module.css` height caps define internal panel scrolling and must not be changed as page-section fixes.

## Acceptance

- At 1440x900 and 390x844, the hero reaches the bottom of the viewport and the featured-work divider/title is not visible before scrolling.
- Existing mobile stacking and reduced-motion behavior remains functional.
- `npm run visual:s9` emits `failures: []`, with no overflow, console errors, page errors, external runtime requests, or owned browser residue.
- Focused tests, full tests, build, safety scans, and `git diff --check` pass.
