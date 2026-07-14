# S6 Visual Restoration With S8 Retention

> Date: 2026-07-14  
> Decision: Morse approved option A  
> Baseline visual: `a4eba23` (S6/M3 single-page portfolio)  
> Current functional baseline: `ff51e54` (S8 mainline)

## Problem

S7 replaced the established dark single-page portfolio with a global navigation shell, a large product screenshot in the hero, and a multipage card grid. That changed the site's identity and made the homepage feel like a generic portfolio template. The requested outcome is to restore the S6 visual language without rolling back the S8 customer-service implementation or deleting the useful project detail routes.

## Goals

- Restore the S6 dark single-page experience: ambient digital-human stage, compact identity hero, system exhibition, profile/method sections, evidence ledger, FAQ, contact close, resume mode, and floating chat.
- Keep the four verified project records and their `/works/*` detail pages.
- Keep all S8 chat behavior: invite access, audience intent, streaming states, public sources, recoverable retry, turn idempotency, quota display, and logout.
- Keep `content/site-content.json` as the public factual source used by live pages and RAG.
- Preserve desktop and mobile behavior, reduced motion, CSS token discipline, and local-only assets.

## Non-goals

- Do not restore S6 example metrics (`3`, `1,200+`, `480+`) or fake contact links.
- Do not restore outdated project names, invented screenshots, or unverified claims from old presentation content.
- Do not remove the S7 project detail routes or the sanitized real operations screenshot.
- Do not change chat APIs, database schema, RAG retrieval, Provider configuration, deployment, or secrets.
- Do not introduce a new visual direction; this is a controlled restoration.

## Information Architecture

### Home `/`

The homepage returns to the S6 single-page reading flow:

1. Identity hero with `数字生命摩斯`, the verified role and summary, compact capability chips, the ambient digital-human placeholder, and two actions: view systems and open chat.
2. System exhibition using the four verified projects from `content/site-content.json`; each project links to its existing case-study route and exposes external/GitHub links only where already approved.
3. About and working principles using verified public copy.
4. Evidence ledger showing only pipeline-backed statistics; unavailable metrics are omitted rather than replaced by examples.
5. FAQ sourced from the current public content.
6. Contact close with only real public actions; missing contact channels remain absent.
7. Resume mode and the S8 floating chat remain available.

### Works `/works` And `/works/[slug]`

The multipage case studies remain. Their existing site header, footer, resume entry, and chat entry move into a route-local `app/works/layout.tsx`, so the homepage can use the restored S6 composition without losing navigation on project pages.

## Component Boundary

- `app/layout.tsx` becomes a minimal global document shell and retains the resume-mode boot script.
- `app/page.tsx` owns the restored single-page homepage and mounts the current `MorseChat` directly.
- A focused home component/CSS module may adapt verified `siteContent` records into the S6 section structure; it must not duplicate factual JSON.
- `app/works/layout.tsx` wraps works routes with the current `SiteShell`.
- `MorseChat.tsx` keeps the S8 state machine and request behavior. Only its visual presentation may be aligned with the pre-S7 panel.
- Existing S6 visual components (`DigitalHuman`, `Lifeform`, `ScrollEffects`, and resume controls) are reused where their behavior remains valid.

## Visual Rules

- Restore the deep-space background, cyan system indicators, restrained blue/cyan ambient light, thin borders, compact mono labels, and editorial spacing from S6.
- The hero identity, not a project screenshot, is the first-viewport signal.
- The ambient digital-human placeholder stays unframed and non-interactive; no invented avatar image is added.
- Project evidence appears lower in the page and never overwhelms the identity hero.
- No nested cards, oversized marketing copy, decorative blobs, fake dashboards, or generated project images.
- All component colors use `app/styles/tokens.css`; no new raw color values in CSS modules.

## Responsive And Motion

- At 1440px, the hero uses the S6 left identity/right ambient-stage balance and shows a hint of the next section.
- At 390px, content becomes one column, the identity copy remains readable, controls do not overlap, and the chat panel fits the viewport.
- `prefers-reduced-motion` disables continuous ambient motion and scroll reveals while preserving all content and navigation.
- Long project names, status text, source links, and error messages must wrap without horizontal overflow.

## Error And Access States

- Locked chat clearly asks for a short-term invite code.
- Missing Provider configuration remains an honest recoverable/unavailable state; Mock behavior is never presented as real GPT.
- Failed or interrupted turns reuse the same assistant bubble and S8 retry snapshot.
- Project routes and the public homepage remain usable when chat is unavailable.

## Acceptance

- The homepage visually matches the S6/M3 evidence direction rather than the S7 screenshot-led layout.
- `/`, `/works`, and all four `/works/[slug]` routes return 200 after a production build.
- S8 contract, API, integration, SSE, and UI tests continue to pass.
- Browser verification passes at 1440x900 and 390x844 with no unexpected console/page errors, no horizontal overflow, and no overlapping controls.
- Reduced-motion verification passes on mobile.
- No fake metrics, fake contact links, draft content, local paths, secrets, or generated project evidence appears in the live page.
- The existing untracked user files remain unstaged and unchanged.

## Implementation Constraint

This restoration is a frontend-only compatibility layer over the current S8 tree. It must be implemented by selective edits from `ff51e54`; an entire-commit or entire-tree revert is forbidden because it would remove current chat and content contracts.
