# HR Provider Timeout Production Receipt

> Date: 2026-07-29
> Mode: `GOAL / CRITICAL / DEPLOYED`
> Status: `LOCAL_READY / DEPLOY_PENDING`

## Incident Evidence

- The production complete-JD turn stayed in `context_packet_v22 / jd_match / follow_up / continue`, retained the same conversation and context scope, and assembled `6 sources / 6 evidence`.
- The turn failed after `80,214 ms` with `PROVIDER_TOTAL_TIMEOUT`; this was not a routing, evidence, refusal, or content-guard failure.
- Primary attempt 1 produced no protocol event before the internal `20,008 ms` first-byte timeout and was aborted as `PROVIDER_FIRST_BYTE_TIMEOUT`.
- Fallback attempt 2 started model text, but the remaining shared 80-second provider-stage budget expired before completion.
- User-supplied main-API control-plane evidence for the corresponding long request reports first text at `24.52s`, total duration `50.27s`, approximately `6,554` input tokens and `2,675` output tokens at `2026-07-29 10:14:04`.

## Root Cause

The production first-byte deadline was earlier than the observed healthy main API by about 4.5 seconds. The service therefore aborted a request that the upstream completed successfully, switched to a fallback, and then forced that fallback to share an 80-second absolute deadline that was too short for a high-reasoning answer. The visible rejection was a local timeout policy error, not a model refusal.

## Correction

- Default first-byte timeout: `40,000 ms`.
- Coordinated protocol-event timeout: `35,000 ms`.
- Model-text activity timeout: `70,000 ms`.
- Provider total and shared stage timeout: `300,000 ms`.
- Complete chat-turn timeout: `330,000 ms`.
- Startup now rejects configurations that violate `first byte >= protocol event < model text <= provider stage < chat turn`.
- Serial failover, one shared absolute deadline, no hedging, fixed attempt count, and unlimited output-token configuration remain unchanged. A silent node still fails at the protocol/activity gate; a request that starts producing a high-reasoning answer has enough time to finish.

## Local Verification

- Config regression: `31/31`.
- Provider, failover, and timeout focused regression: `101/101`.
- Full repository suite: `1258/1258` with the project-local PostgreSQL service available.
- PostgreSQL integration suite: `347/347` after restoring the existing project-local pgvector test service. The initial run failed uniformly with `ECONNREFUSED 127.0.0.1:55432`; no product assertion failed before the dependency was restored.
- `npm run typecheck`, scoped ESLint for the changed TypeScript files, the 33-route production build, and `git diff --check` passed.

## Deployment And Observation Boundary

This receipt does not yet claim deployment or answer quality. Deployment must back up the shared production environment file, set the six timeout values above, rebuild only Web and Worker, and leave Database, Embedding, Edge, migrations, grants, and ingestion untouched. Health, readiness, protected-route behavior, release smoke, release pointer, image identity, and restart counts must be rechecked.

`OBSERVED` requires a new exact-label `HR interview` invite and isolated Session to complete the recruitment entry, full JD, and ten adjacent evaluation questions. Every answer must be relevant, use audited sources/evidence, preserve the original Task and JD frame, and finish with SSE `done`. Any irrelevant answer, missing evidence, fabrication, refusal, 5xx, or Task switch stops the run for turn-level diagnosis.
