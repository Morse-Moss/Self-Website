# Agent-Ready Q&A MVP Production Closeout

> Date: 2026-07-29
> Controls: `STAGED / CRITICAL / DEPLOYED`
> Status: `OBSERVED / HR_QA_MVP_ACCEPTED / PERCENT_0`

## Release Identity

- Runtime commit: `d223afeec2470b2ffb0a79f08eaee67e75a86484`; local `master`, `origin/master` and `codex/agent-ready-qa-mvp` resolved to this commit before observation.
- Production pointer and Web/Worker Compose working directory: `/opt/revolution/releases/d223afe/revolution`.
- Frozen archive: 19,727,911 bytes; SHA-256 `b3d07876cdaf15e620fd5a1ddd4a1168d29e32c0696f3e2bf05079aea98ab787`.
- Web image: `sha256:8c3131f04f0c758a8a3c0de73c22c479a89b19ac7461b5647f7014065d670b18`; Worker image: `sha256:7b707a1743f5f0401f6cb485e7ec458186ff98d80941786e6bf621d5ced714cb`.
- DB `cdd60bc525be...`, Embedding `1a37c91fe1b5...` and Edge `b2c4293eec...` retained their pre-release container identities. No migration, grants or ingest operation ran for this release.

## Verification Before Observation

- Typecheck passed. The full suite passed `1262/1262` with zero skips. The production build generated 33 routes.
- Deterministic chat evaluation passed `111/111` with `externalCalls=0` before the real run.
- `git diff --check` passed. Compliance and quality/safety CRITICAL review views passed with no blocker.
- Public live/ready/pages and authentication boundaries passed; `release:smoke` returned `{"ok":true}`. Five containers were healthy with restart count `0`.

## Real HR Acceptance

- One fresh exact-label `HR interview` Session carried one recruiter entry, one complete JD and ten formal evaluation questions in order. No second conversation or Task was created.
- All 12 turns returned HTTP 200, exactly one `meta` and exactly one `done`, with nonblank answers. All ten formal answers passed their question-specific relevance groups and the checks for refusal, private/Secret leakage and unsupported quantitative claims.
- All turns used `context_packet_v22`. The recruiter entry used `recruitment_intake` and no Provider call. The remaining 11 turns used one Provider attempt each; all 11 attempts completed, won and had no failed or duplicate attempt.
- The JD plus ten formal turns retained one Task scope and one stable JD slot. Each Provider-backed turn used the direct executor, exact five approved project IDs and exact nine approved evidence IDs; no search was used.
- The validator recorded nonblocking `warn / missing_evidence_coverage` on the generated chain. This did not remove or regenerate a completed answer. The accepted answers still passed the independent relevance and evidence gates, so the warning remains measured quality debt rather than a release blocker.
- One lexical evidence-denial signal occurred on the first formal question. Read-only adjudication confirmed it was an honest disclosure of missing cross-border and quantified outcome evidence, not a denial of projects, experience or Vibe/tool evidence; the turn remained relevant and passed. No false evidence denial or other zero-tolerance stop signal occurred: no irrelevant answer, refusal, fabricated quantity, private/Secret exposure, Task/JD drift, 5xx, missing/duplicate `done`, quality block or duplicate Provider charge.

## Stability Window And Cleanup

- The final read-only window ran from `2026-07-29T11:47:05Z` through `2026-07-29T12:02:33Z` (`15.53` minutes). Checks at 0.07, 5.77, 10.66 and 15.53 minutes all passed.
- At every checkpoint public live/ready returned 200; the release pointer stayed exact; all five containers stayed healthy with restart count `0`; Web/Worker/Edge/DB error-keyword count and Edge 5xx count stayed `0`; the Session stayed at 12 completed, 0 running and 0 failed turns with 11 completed/winning and 0 failed Provider attempts.
- The agent-owned CDP tab had already disappeared before cleanup, so cookie-based `DELETE /api/access` was no longer possible. A guarded production transaction instead required the newest exact-label invite to be active, exhausted and associated with exactly one Session before deleting that Session and deactivating the invite. Post-cleanup state was inactive invite, `1/1` Session capacity used and zero remaining Access Sessions, conversations or turns.
- Post-cleanup `release:smoke` again returned `{"ok":true}`. The exact release pointer, container identities, health, restart counts and zero-error window remained unchanged.

## Release Boundary

- The basic HR Q&A MVP is now behaviorally `OBSERVED`; targeted HR launch may begin. Context Packet remains enabled at percent `0`, so this acceptance does not widen uncontrolled public traffic.
- This is one fixed-JD, ten-question acceptance chain, not a statistical guarantee for all recruiter wording. The main residual product risk is natural-language coverage outside the frozen set, including the persistent `missing_evidence_coverage` warning; collect real badcases and change routing or evidence only from reproduced failures.
- Broader operational readiness remains `LIMITED_LAUNCH`: independent edge rate/connection controls, centralized monitoring, managed backup/restore evidence, wider mainland reachability and current dependency-advisory disposition remain separate runbook items.
- Skills, tool execution, Agent loops and automatic web search remain deferred. Their future mount point is the executor boundary behind the frozen TurnPlan contract; they are not part of this observed MVP.
- Evidence excludes the raw JD, questions, answers, invite plaintext, Session values, HMACs, Provider payloads, credentials, private-resume content and exact test invite identifiers.
