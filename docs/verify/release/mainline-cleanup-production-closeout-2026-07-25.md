# Mainline cleanup production closeout

> Date: 2026-07-25
> Mode: `DIRECT / CRITICAL / DEPLOYED`
> Status: `PRODUCTION_OBSERVED / MAINLINE_CLEANUP`
> Runtime release: `1e34885 build: isolate ignored workspace sources`
> Public entry: `https://aimorse.tech`

## Scope

- `origin/master` was fast-forwarded from `b4f78b0` to `1e34885`.
- The release contains the safely absorbed design history, project rules, research notes, refreshed Digital Morse visual evidence, and the TypeScript exclusion for ignored `tmp/` and `.worktrees/` sources.
- Compared with the previous runtime `8c84ae7`, there is no migration, dependency declaration, production configuration, public knowledge, Provider routing, or private-resume data change.

## Release

- Immutable archive size: 19,101,015 bytes.
- SHA-256: `216d0c265a8869eebc75cbd936d08f2c330c0c1bf39f5fb78e3d69cc9390184f`.
- The local and server-side upload hashes matched before extraction.
- The release was extracted to `/opt/revolution/releases/1e34885/revolution`; restricted environment, Secret, resume-key, and PostgreSQL TLS paths were linked only after file-presence and permission checks.
- Compose configuration and the production Web/Worker image build passed with 30 routes.
- Only Web and Worker were recreated. DB, Embedding, and Edge container IDs were checked before and after cutover and remained unchanged.
- `/opt/revolution/current`, Web, and Worker now point to the `1e34885` release. Rollback images for `8c84ae7` remain tagged locally on the server.

## Observation

- Web, DB, and Embedding are healthy; Worker and Edge are running. All five containers report restart count `0`.
- Public live, ready, compatibility health, root, works, admin, and admin API routes return HTTP 200.
- Unauthenticated Provider runtime, turn list, resume file, and resume access routes return HTTP 401.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- Web, Worker, Edge, and DB produced zero `error|exception|panic|fatal` keyword matches in the final observation window.
- Deployment did not log in as administrator, create an invite, call a Chat/Search/Embedding Provider, run ingest, or access private resume content.

## Recovery Notes And Residual Risk

- The first remote build command was rejected before cutover because a PowerShell CRLF reached Bash as part of the `worker` argument. Uploading an LF-normalized script resolved the transport issue; runtime state was unchanged.
- The first rollback-tag attempt was rejected before cutover because the old running container image manifest was no longer taggable after the new build. The old frozen release was rebuilt and tagged as `rollback-8c84ae7` before the successful cutover.
- Repository-wide tests are not claimed green: the local PostgreSQL test service was not running, and the architecture contract still reports three dependency cycles already present in the previous mainline. The production build and 47 scoped non-database tests passed.
- Production `npm ci` reports 3 high-severity advisories. No unreviewed `npm audit fix` was run.
