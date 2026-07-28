# HR JD Context Production Closeout

> Date: 2026-07-29
> Mode: `GOAL / CRITICAL / DEPLOYED`
> Status: `THIRD_FIX_DEPLOYED / CURSOR_BOUNDARY_FAILURE_OBSERVED / FOURTH_FIX_LOCAL_VERIFIED / REDEPLOY_PENDING`

## Scope

- Baseline release at task intake: `acecafc`; current production release: `2440473` on `master` and `origin/master`.
- Owned implementation: explicit JD semantic control isolation, recruitment retrieval chunking, and readiness resolution of the active Provider runtime.
- Owned tests and operations knowledge: focused regressions, readiness/deployment contracts, two production runbooks, and the active Task Center pointer.
- Excluded and untouched: `.github/`, `revolution-bc27857.tar.gz`, the absorbed `codex/dynamic-context` worktree, external repositories, production secrets, raw Provider payloads, invite codes, and Session values.

## Root Causes And Correction

1. Explicit `jd_match` still ran the whole JD body through conversation correction, switch, completion, and clear classifiers. Normal negative wording in the job description could therefore suppress creation of the JD Task Frame.
2. A 682-character multi-topic JD remained below the default 1024-character partition threshold and produced one diluted embedding. No audited project crossed the calibrated `0.45` relevance gate, so the Context Packet reached the Provider with zero sources and zero evidence.
3. The resolver now treats explicit JD workflow text as data for those conversation-control checks. Recruitment/JD evidence queries use complete 256-character boundary chunks; concatenating every chunk reproduces the original input exactly. No relevance threshold or input, output, history, retrieval, attempt, context-window, or model-output limit was added.
4. Readiness now resolves the active Provider runtime and fails with `READINESS_AI_CONFIG_UNAVAILABLE` when an active route cannot be reconstructed. Both runbooks require every active target to be tested and activated as digest V2 before removing legacy digest inputs.

## Verification Receipt

- Focused affected boundary: `104/104` passed.
- Full unit suite: `900/900` passed.
- PostgreSQL integration: `343/343` passed.
- `npm run typecheck`: passed.
- `npm run build`: passed, 33 routes.
- Scoped ESLint over all changed TypeScript and test files: passed.
- `git diff --check`: passed; sensitive-pattern scan of the owned diff found no match.
- Full repository lint remains a pre-existing baseline failure: 20 errors and 3 warnings in React files not modified by this task.

## Production Preflight

- `/opt/revolution/current` resolves to `/opt/revolution/releases/acecafc/revolution`.
- Five production containers are healthy.
- Active Provider route revision 3 has two targets. Both use `config_digest_version=2`, `reasoning_effort=high`, and no configured context-window or max-output limit.
- Migration registry is exactly `001-013`; knowledge inventory is 41 documents / 48 chunks; long transactions over 30 seconds are zero.
- No deployment, traffic switch, new invite, or new production question had occurred when this predeploy receipt was written.

## First Deployment And Real Observation

- Commit `0c7f56a` was pushed to `origin/master`, archived with SHA-256 `d30184e81280a888caf16b48b1375a462d7b1a4e54020c48696d5d33070f7e02`, and deployed to `/opt/revolution/releases/0c7f56a/revolution` by rebuilding only Web and Worker.
- Public live, ready, compatibility health, root, works, admin, admin/api and `release:smoke` passed; unauthenticated private endpoints returned 401. Five containers were healthy with restart count 0, and DB/Embedding/Edge identities were unchanged.
- The one-shot explicit `JD 匹配` production turn passed: `context_packet_v22 / jd_match / new_task / create`, five sources and five evidence IDs, primary target success, and a direct evidence-based answer.
- The actual recruiter conversation then failed. After the recruiter starter, the same complete JD produced turn `222aeccb` as `chat / recruiter / jd_match / correction / wait`, with zero sources and zero evidence IDs. The answer incorrectly claimed that no audited project evidence was available.
- A separate browser transport attempt remained pending before reaching the application and created no interaction turn. A cache-busted fresh tab produced the completed failing turn above, so the product failure is independently distinguished from the discarded browser transport incident.

## Second Correction

- JD-data recognition now precedes conversation-control classification for every workflow. A complete recruiter-chat JD cannot be converted into correction, completion, or clear merely because ordinary job text contains negative or completion wording.
- Explicit task switching remains authoritative. Ordinary non-JD correction, clear, completion, and temporary-chat behavior retain their existing tests.
- Every turn resolved as `jd_match` stores the complete current input as the JD slot. This prevents a structured JD from being reduced to only the tail following its final requirement heading.
- The new production-shaped regression failed before the correction and passes after it with `jd_match / follow_up / continue`, the existing Task ID, and an exact full-text JD slot.
- Fresh verification after the second correction: affected boundary `44/44`, full unit suite passed, PostgreSQL integration `343/343`, typecheck passed, 33-route production build passed, scoped ESLint passed, and `git diff --check` passed.

## Second Deployment And Quality Observation

- Commit `e746ea4` was pushed to `origin/master`, archived as 19,654,200 bytes with SHA-256 `d533b568684eabfcbed8769d5ac2f7376d0109bec056d416164e92561415260c`, and deployed to `/opt/revolution/releases/e746ea4/revolution` by rebuilding only Web and Worker.
- Public health, protected 401 boundaries and `release:smoke` passed. Web and Worker point to the new release; DB, Embedding and Edge identities stayed unchanged; all five containers are healthy with restart count 0. Schema is `001-013`, knowledge is 41 documents / 48 chunks, active route revision 3 has two digest-V2 high-reasoning targets with no context-window or output limit, and fresh error/5xx counts are zero.
- A new three-hour, one-Session, exact-label `HR interview` invite was redeemed in a cache-busted Edge tab. The recruiter starter completed as `project_fit / new_task / create` with five sources and evidence. The exact 682-character JD completed as `jd_match / follow_up / continue`, retained the JD slot, and had five project sources and evidence.
- The routing defect is therefore closed, but answer-quality acceptance stopped on that JD turn. The answer incorrectly said the audited material did not disclose Claude Code, although the approved site content has direct resume evidence for Claude Code, Codex and WorkBuddy use.

## Third Correction

- Root cause: the V2.2 ranked-project planner discarded capability evidence without a `projectSlug`. Capability matching correctly classified Claude Code as direct and Cursor as unavailable, but the approved resume fact never reached `<approved_evidence>`. The legacy V2 JD path already supplemented this evidence; V2.2 did not.
- Correction: preserve the existing semantic relevance gate for projects, then merge only non-project approved capability sources matched by the JD. Sources are grouped by audited document and topic to avoid duplication, and the same source survives zero qualified projects, embedding degradation, or retrieval degradation. Missing Cursor evidence remains missing and cannot be promoted from Claude Code.
- Failure-first planner regressions failed because `resume-facts` was absent, then passed after the correction both with ranked projects and with no threshold-qualified project. A production-shaped PostgreSQL integration proves a recruiter-chat JD projects the Claude Code resume fact into V2.2 while excluding Cursor from its evidence topics.
- Fresh exit evidence: planner `14/14`, targeted PostgreSQL integration `1/1`, full unit suite `903/903`, PostgreSQL integration `344/344`, typecheck, scoped ESLint, 33-route production build, `git diff --check`, and the owned-diff sensitive-pattern scan all passed.

## Third Deployment And Cursor Boundary Observation

- Commit `2440473` was pushed to `origin/master`, archived as 19,656,329 bytes with SHA-256 `464eda6ab9f345ebc47b83a76544478bc911f41f36b770ac4c7f688a6f66b0a5`, and deployed to `/opt/revolution/releases/2440473/revolution` by rebuilding only Web and Worker.
- Public health, protected 401 boundaries and `release:smoke` passed. All five containers stayed healthy with restart count 0; DB, Embedding and Edge identities were unchanged. Schema remained `001-013`, knowledge remained 41 documents / 48 chunks, and both active digest-V2 Provider targets retained `reasoning=high` with no context-window or output limit.
- A new exact-label `HR interview` test Session completed recruiter entry turn `0a653ee5` as `project_fit / new_task / create` with five sources and evidence. The exact 682-character JD completed turn `1f270664` as `jd_match / follow_up / continue` with six sources and evidence and one Provider attempt.
- Claude Code, Codex and WorkBuddy were correctly represented as direct evidence, closing the third defect. Acceptance stopped because the answer omitted Cursor entirely even though the same JD explicitly named it. No remaining follow-up question was sent on that failed history.

## Fourth Correction

- Root cause: when one capability had evidence, the planner emitted admissions only for the admitted knowledge sources and discarded `evidenceClass=none` assessments from the same query. `chat-service.ts` also never consumed unavailable admissions. The Provider therefore received direct Claude Code evidence but no trusted instruction that Cursor required an explicit evidence-boundary disclosure.
- Correction: preserve unavailable capability admissions alongside direct or transferable evidence in normal and degraded JD planning. The service extracts only non-null unavailable capability IDs and passes them to a structured `<capability_evidence_boundaries>` block in trusted instructions. Every named ID must be disclosed as “当前审核资料无证据，建议面试核验”, may not be omitted, and may not be rewritten as “从未使用”. Cursor remains absent from `<approved_evidence>` and is not promoted into a synthetic source.
- Failure-first evidence: planner, Context Packet and production-shaped PostgreSQL regressions each failed on the missing unavailable admission or boundary block, then passed after the correction. The Context Packet regression also proves duplicate IDs are canonicalized and that adding the boundary changes the signed generation request.
- Fresh exit evidence: planner `14/14`, Context Packet `13/13`, targeted production-shaped PostgreSQL integration `1/1`, full unit suite `904/904`, PostgreSQL integration `344/344`, typecheck, scoped ESLint, 33-route production build, `git diff --check`, and the owned-diff sensitive scan all passed.
- One initial full-unit run performed concurrently with typecheck and ESLint exposed a load-sensitive 10 ms/25 ms timeout-classification race in an untouched failover test. The exact test, its full file, and the serial full unit command all passed; neither failover code nor its tests were changed in this correction.

## Review Gate

- Independent CRITICAL quality and compliance agents repeatedly failed at the shared Responses gateway with HTTP 502 before returning a verdict.
- This is recorded as degraded independent assurance, not as a PASS. Controller inspection found no known blocker.
- Controller quality review confirmed unavailable admissions survive normal and degraded planning without affecting unrelated intents. Controller compliance review confirmed the IDs originate only from the audited capability ledger, are escaped as structured data, are not persisted as evidence, and enter the HMAC-protected trusted-instruction layer.
- Final acceptance requires fresh production health gates plus 12 real HR turns: recruiter entry, the complete JD, and ten follow-up questions. Any irrelevant, omitted, unsupported, fabricated, refused, or failed answer stops the sequence for turn-level diagnosis.

## Next Action

Commit and push the fourth correction's exact scope, redeploy the frozen commit to Web and Worker, expire the current test invite/session, then run a fresh isolated recruiter conversation with the complete JD and ten follow-up questions. Update this receipt to `PRODUCTION_OBSERVED` only if every answer and its turn metadata pass.
