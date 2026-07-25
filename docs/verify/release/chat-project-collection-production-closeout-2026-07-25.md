# Chat project collection production closeout

> Date: 2026-07-25
> Mode: `STAGED / CRITICAL / DEPLOYED`
> Status: `PRODUCTION_OBSERVED / USER_CONVERSATION_NOT_RERUN`
> Runtime release: `11ce329 fix: ground portfolio collection questions`
> Public entry: `https://aimorse.tech`

## Root Cause And Scope

- “你做过” was evaluated before the generic project matcher, so “你做过的其他项目有哪些” entered `personal_fact / personal_history_query / unavailable`.
- With no admitted project evidence, the Provider could continue the previous multi-Agent topic. The old output guard did not require a complete portfolio catalog.
- The fix adds `portfolio_project_collection_query`, injects the five approved portfolio summaries directly, and skips Embedding, RAG, and Search. The final answer must name all five projects and cite all five admitted sources.
- Evidence, ranking, comparison, project-management experience, named-project, and unknown-system questions retain their existing controlled routes.

## Verification

- Failure-first route, evidence, prompt, and output-guard regressions were observed before implementation.
- Non-database Chat boundary tests passed `186/186`.
- Offline adversarial evaluation passed `91/91` with `externalCalls=0`.
- `npm run build` passed locally and in the production Web/Worker image build, generating 30 routes.
- Independent CRITICAL challenge and final delta review passed. `git diff --check` passed.

## Release

- `11ce329` was committed on `master`, pushed to `origin/master`, and archived from that exact Git commit.
- Immutable archive size: 19,115,703 bytes. SHA-256: `3055b710accfbad71685b280f0af182ed6d1f2abbf10d6f020501cf2a3eb3936`; local and server hashes matched before extraction.
- Shared environment, Secret, and PostgreSQL TLS paths were linked without reading their contents.
- Only Web and Worker were recreated. `/opt/revolution/current` points to `/opt/revolution/releases/11ce329/revolution`.
- DB container `74c365fb4f00...`, Embedding `1d156d6ffd16...`, and Edge `df8eba464f76...` remained unchanged. Previous Web/Worker images are tagged `rollback-43cbcf6`.

## Observation

- Web, DB, and Embedding are healthy; Worker and Edge are running. All five containers report restart count `0`.
- Public live, ready, compatibility health, root, works, admin, and admin API routes return HTTP 200.
- Unauthenticated Provider, runtime, turn list, resume file, and resume access routes return HTTP 401.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- Web, Worker, Edge, and DB produced zero `error|fatal|panic|exception|unhandled` keyword matches in the observed ten-minute window.
- No real chat was sent during deployment. User-facing wording and the exact multi-turn scenario remain for the authorized user test.

## Exclusions

- No migration, grants, ingest, database rebuild, Embedding rebuild, Edge rebuild, production configuration change, administrator login, invite creation, Provider call, or private-resume access occurred.
