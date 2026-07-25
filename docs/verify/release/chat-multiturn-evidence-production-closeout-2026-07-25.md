# Chat multi-turn evidence production closeout

> Date: 2026-07-25
> Mode: `STAGED / CRITICAL / DEPLOYED`
> Status: `PRODUCTION_OBSERVED / USER_CONVERSATION_NOT_RERUN`
> Runtime release: `43cbcf6 fix: restore grounded multi-turn context`
> Public entry: `https://aimorse.tech`

## Scope

- A legacy `personal_scope_ambiguous` clarification is eligible only when it is the immediately previous completed turn, its answer exactly matches the old fixed clarification, and it is no more than ten minutes old.
- Selecting “具体经历” restores the controlled capability from the original question. Multi-Agent evidence is explicitly bound to the public `deep-research` project, and a capability implementation follow-up can enter project retrieval only when exactly one public project is mapped.
- Explicitly named public projects use their exact project evidence. Unknown system categories such as payment or medical systems remain unavailable and cannot borrow semantically similar project evidence.
- No schema, dependency, production configuration, Provider preset, private-resume data, or ingested public knowledge changed.

## Verification

- Non-database Chat boundary tests passed `175/175`; focused routing, evidence, capability, and persistence tests passed `57/57` before the final named-project correction, whose route suite passed `37/37`.
- Offline adversarial evaluation passed `90/90` with `externalCalls=0`.
- `npm run build` passed locally and in the production Web/Worker image build, generating 30 routes. `git diff --check`, sensitive-pattern scanning, and independent correction review passed.

## Release

- `43cbcf6` was committed on `master`, pushed to `origin/master`, and archived from that exact Git commit.
- Immutable archive size: 19,111,958 bytes. SHA-256: `a709997884aa204f9e484f6ba2aa6a74f4c53ac6fd2fda8737a5baabae37c0cc`; local and server hashes matched before extraction.
- Shared environment, Secret, resume-key, and PostgreSQL TLS paths were linked after presence, certificate, and permission checks. Compose configuration and the production Web/Worker build passed.
- Only Web and Worker were recreated with `--no-deps --force-recreate`. DB remained at `e5f9210`, Embedding at `e56e457`, and Edge at `b7e24f6`; their container IDs did not change.
- `/opt/revolution/current`, Web, and Worker point to `/opt/revolution/releases/43cbcf6/revolution`. Rollback images for `7ea1de8` remain tagged on the server.

## Observation

- Web, DB, and Embedding are healthy; Worker and Edge are running. All five containers report restart count `0`.
- Public live, ready, compatibility health, root, works, admin, and admin API routes return HTTP 200.
- Unauthenticated Provider, runtime, turn list, resume file, and resume access routes return HTTP 401.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- Web, Worker, Edge, and DB produced zero `error|exception|panic|fatal` keyword matches in the observed ten-minute window.
- Deployment did not log in as administrator, create an invite, call a Chat/Search/Embedding Provider, run migration/grants/ingest, or access private resume content.

## Residual Observation

- No real chat was sent during deployment. The deployed routing and evidence state machine is proven by deterministic evaluation and runtime health; the user-facing wording and multi-turn semantic result still require the authorized user test.
