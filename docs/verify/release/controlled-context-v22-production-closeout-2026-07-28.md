# Controlled Context V2.2 Production Closeout

> Date: 2026-07-28
> Mode: `STAGED / CRITICAL / DEPLOYED`
> Status: `PRODUCTION_OBSERVED / INVITE_CANARY_COMPLETE / PERCENT_0`

## Release Identity

- Runtime commit: `f02e9de7b2f1e089a6c6ec9e5a73a8e047393772` (`fix: prioritize direct controlled-context evidence`). The runtime commit reached `origin/master` before deployment.
- Production pointer: `/opt/revolution/releases/f02e9de/revolution`.
- Frozen archive: 19,577,725 bytes; SHA-256 `f2f22805fa1381fdc12a43cbae3755640d388ee69e3bf9d8c63daa3c8354f2a4`, matched locally and remotely before extraction.
- Runtime images: Web `sha256:549aa6a78b82c2040255d7184ea2dc07eee9698f5424859e736d1fb5d955b137`; Worker `sha256:22b6db3fd8a6b923c40f1c4a531b59f6b70bb43aca3dd9e92b32d734518ba65a`.
- Migration registry and release manifest both contain `001-012`.

## Deployment And Recovery

- Only Web and Worker were replaced. DB, Embedding and Edge retained their complete pre-release container identities. All five services are healthy with restart count 0.
- Context Packet finished enabled with canary percentage `0` and an empty allowlist. Chat v2, active Provider routing, safe mode, hedging, public RAG and private-resume state were not changed by the canary.
- The correction reused the verified forward-only migration `012`, grants, public knowledge and Web-only digest Secret. It did not rerun migration, grants or ingest and did not rebuild DB, Embedding or Edge.
- The final restricted environment backup is `/opt/revolution/shared/.env.production.bak-post-canary-f02e9de-20260727T231554Z`.
- The fixed-chain pre-Provider gate passed `1/1` against a temporary pgvector database on an internal Docker network. It made no external request and removed its temporary database, runner and network. The initial harness start inherited `NODE_ENV=production`; rerunning the same gate with explicit test mode and local non-TLS database settings passed.

## Invite Canary Observation

- Exactly the five messages in `tests/fixtures/controlled-context-failure-chain.ts` were sent once in one conversation. No other prompt and no more than the authorized five main answers were sent.
- All five main answers completed. Eight Provider attempts ran: turns 1-3 completed through fallback after the primary returned `PROVIDER_UNAVAILABLE`; turns 4-5 completed on the primary.
- The same conversation and Task Frame remained authoritative for all turns. The final frame is `completed / task_complete` with five completed turns.
- Redacted manifests contained no raw input or stale-marker leakage. Evidence identifiers remained aligned with their real retrieval scores. Packet and request HMAC values were stable across attempts, domain-separated and equal to their terminal mirrors; no HMAC value is retained in this evidence.
- After observation the test invite is inactive, its single Session is expired, and the conversation contains exactly five messages.

| Turn | Retrieved approved projects and scores |
| --- | --- |
| 1 | `digital-morse` 0.630541; `auto-operations` 0.622914; `content-agent` 0.621679 |
| 2 | `content-agent` 0.609469; `auto-operations` 0.597379; `ai-leadgen` 0.579221 |
| 3 | `digital-morse` 0.638527; `content-agent` 0.679705; `auto-operations` 0.639107 |
| 4 | `digital-morse` 0.634739; `content-agent` 0.679688; `ai-leadgen` 0.639682 |
| 5 | `digital-morse` 0.642856; `content-agent` 0.651242; `ai-leadgen` 0.637785 |

## Quality Adjudication

- The first canary validator falsely rejected turn 5 because it required every retrieved source title to appear verbatim. Read-only adjudication confirmed a non-empty, relevant answer with RAG/project/conclusion language, two approved project names, no unavailable-answer text and no stale marker. This meets the frozen requirement to name at least one approved project.
- None of the five answers emitted inline `[来源N]` markers. This is retained as nonblocking `missing_grounded_citation` quality debt because the frozen design makes post-completion content-quality labels observational rather than a reason to discard a valid Provider answer or start another paid attempt.

## Final Verification And Boundaries

- Public live, ready, compatibility health, root, works, admin and admin/api checks passed; unauthenticated protected routes retained their expected denial status. `release:smoke` returned `{"ok":true}`.
- A final read-only production check reconfirmed the exact pointer and image identities, unchanged dependency identities, five healthy zero-restart containers, enabled/0%/empty Context Packet state, Chat v2 at 100% with safe mode and hedging off, matching `001-012` registry/manifest, inactive/expired `5,8,5` canary aggregates, route boundaries and release smoke.
- Web, Worker, Edge and DB had zero fresh error-keyword matches after finalization and again in the final 15-minute read-only window.
- Local disposable database `revolution_verify_ctx_v22_20260728` had zero active connections, was dropped after verification and was confirmed absent.
- Evidence excludes raw questions, answers, invite plaintext, HMAC values, Provider payloads, credentials, Provider URLs and private-resume content.
- The release stops at the completed invite canary. No percentage traffic is active, and no 10% or broader rollout is authorized by this closeout.
