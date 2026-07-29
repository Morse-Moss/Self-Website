# Night Stability Failure Register

## NS-CONTROL-001 - Closed

- Time: `2026-07-30T00:31:00+08:00`
- Scope: pre-test invite creation control plane; no Chat Provider call and no Session was created.
- Failure: two create attempts reached PostgreSQL while the wrapper failed to retain the atomic plaintext-to-ID receipt.
- Evidence: both rows had the exact test label, six-Session bound, zero session count and the current attempt time window; a guarded query found exactly two rows and no associated Access Session.
- Disposition: both rows were deleted in one guarded transaction (`candidate_count=2`, `deleted_count=2`). Invite handling is moved into one long-lived process so plaintext, ID and cleanup ownership cannot separate again.
- Product impact: none observed; this is a test-harness control failure, not an application answer or stability failure.

## NS-HARNESS-002 - Closed

- Time: `2026-07-30T00:37:00+08:00`
- Scope: first real Edge turn; one completed/winning Provider attempt.
- Failure: the harness treated recruiter entry as required zero-Provider behavior. The natural entry wording legitimately took the direct answer path, so the harness stopped after otherwise passing HTTP, SSE, nonblank-answer and durable-terminal checks.
- Disposition: the dedicated invite was deactivated and its only Session was removed. The entry contract now accepts either the deterministic no-Provider path or exactly one completed/winning direct attempt; all later HR turns retain the strict single-attempt gate.
- Product impact: no answer-quality or service failure was observed. This run does not count as a completed baseline.

## NS-HARNESS-003 - Closed

- Time: `2026-07-30T00:39:00+08:00`
- Scope: second real Edge run; recruiter entry passed, then JD request returned public `CONVERSATION_INVALID` semantics before a durable second turn.
- Failure: the harness reused a `chat` conversation ID while sending the JD through `jd_match`. The UI deliberately clears conversation state when workflow changes, and the server deliberately rejects workflow mismatch.
- Evidence: current UI `setWorkflow()` calls `clearConversation()`; current server `validateConversation()` requires exact workflow equality; the production Web/Edge window had zero matching error or 5xx log signals.
- Disposition: send the complete JD as a `chat` message, matching the existing HR-chain contract and allowing the semantic planner to retain one conversation and one Task. The invite and its only Session were cleaned; post-cleanup release smoke passed.
- Product impact: none. This was a request-contract violation by the harness, not a production conversation failure.

## NS-HARNESS-004 - Closed

- Time: `2026-07-30T00:42:00+08:00`
- Scope: valid same-workflow Edge chain; entry, complete JD and first natural question passed, then the second natural answer was shorter than the harness's arbitrary 60-character floor.
- Failure: answer length was incorrectly used as a quality proxy before the question-specific relevance rubric. The production contract requires a nonblank relevant answer, not padded prose.
- Evidence: the short turn was durable `completed` with one completed/winning attempt; no HTTP, SSE, Task/JD, container or release-smoke failure occurred before cleanup.
- Disposition: reduce the floor to a nonblank sanity threshold and retain the stronger relevance, refusal, leakage, unsupported-quantity, Task/JD/evidence and attempt gates.
- Product impact: none established. Concision alone is not a bad answer.

## NS-PRODUCT-005 - Corrected Locally, Deployment Pending

- Time: `2026-07-30T00:44:00+08:00`
- Scope: valid same-workflow Edge chain with an active recruiter Task and complete JD.
- Failure: a natural recruiter-perspective request for several capability claims and their project evidence was classified as deterministic recruitment intake instead of continuing the active JD evaluation.
- Root cause: the adjacent recruiter-evaluation gate accepted grounded `project_fact_query` but excluded the semantically equivalent `portfolio_evidence_query`; the downstream resolver therefore fell through to the generic recruitment-material branch.
- Correction: under the existing strict recruiter, active-JD, adjacent-scope and evaluation-question constraints, admit both grounded evidence reason codes. No slot extraction, Task identity, evidence policy, Provider attempt policy, schema, configuration or feature surface changed.
- Verification: a synthetic equivalent regression produces `recruitment_intake` under the old condition and `jd_match / recruitment_evaluation_follow_up` under the correction. Affected semantic, PostgreSQL, SSE and route-policy checks passed; deterministic chat evaluation passed `111/111` with zero external calls; typecheck, full `1262/1262` suite and 33-route production build passed.
- Disposition: first authorized correction cycle; commit, push and Web/Worker-only deployment are pending. Fresh production testing must restart from a clean invite and Session.
