# Chat context routing production closeout

> Date: 2026-07-25
> Mode: `STAGED / CRITICAL / DEPLOYED`
> Status: `PRODUCTION_OBSERVED / USER_CONVERSATION_NOT_RERUN`
> Runtime release: `7ea1de8 fix: preserve chat context routing`
> Public entry: `https://aimorse.tech`

## Scope

- Complete technical questions now default to `conversation` when no higher-confidence route matches.
- `clarify` is limited to short prompts with a missing referent, no inheritable controlled topic, and no usable Provider message history.
- Project, JD, and capability follow-ups retain controlled route anchors. General conversation follow-ups depend on actual prior messages instead of treating a route anchor as semantic history.
- No schema, dependency, production configuration, public knowledge, Provider preset, or private-resume data changed.

## Verification

- Adjacent route and service tests passed `54/54`; offline evaluation passed `83/83` with no external calls.
- `npm run build` passed and generated 30 routes; independent review and `git diff --check` passed.
- Local PostgreSQL was not running, so 76 database integration cases skipped. Repository-wide green is not claimed; three pre-existing dependency cycles remain outside this change.

## Release

- `7ea1de8` was fast-forwarded to local `master` and `origin/master`.
- Immutable archive size: 19,106,795 bytes.
- SHA-256: `4e8c9898254104cbf93c625f226d84385586240657038d1e71da7f65048107b0`.
- Local and server upload hashes matched before extraction to `/opt/revolution/releases/7ea1de8/revolution`.
- Shared environment, Secret, resume-key, and PostgreSQL TLS paths were linked after presence and permission checks. Compose configuration and the production Web/Worker build passed.
- Only Web and Worker were recreated with `--no-deps --force-recreate`. DB remained at `e5f9210`, Embedding at `e56e457`, and Edge at `b7e24f6`; their container IDs did not change.
- `/opt/revolution/current`, Web, and Worker point to the `7ea1de8` release. Rollback images for `1e34885` remain tagged on the server.

## Observation

- Web, DB, and Embedding are healthy; Worker and Edge are running. All five containers report restart count `0`.
- Public live, ready, compatibility health, root, works, admin, and admin API routes return HTTP 200.
- Unauthenticated Provider, runtime, turn list, resume file, and resume access routes return HTTP 401.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- Web, Worker, Edge, and DB produced zero `error|exception|panic|fatal` keyword matches in the final five-minute window.
- Deployment did not log in as administrator, create an invite, call a Chat/Search/Embedding Provider, run migration/grants/ingest, or access private resume content.

## Residual Observation

- No real chat was sent during deployment. The user-facing multi-turn behavior remains the next authorized observation; this closeout proves deployment and non-Provider runtime health, not the semantic quality of a fresh production answer.
