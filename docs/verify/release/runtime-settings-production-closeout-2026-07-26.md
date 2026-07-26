# Runtime settings production closeout

> Date: 2026-07-26
> Mode: `STAGED / CRITICAL / DEPLOYED`
> Status: `PRODUCTION_OBSERVED / MAX_OUTPUT_PENDING_ADMIN_ACTIVATION`
> Runtime release: `b80a728 fix: align chat runtime with admin settings`
> Public entry: `https://aimorse.tech`

## Release

- `b80a728` was committed on `master`, pushed to `origin/master`, and archived from that exact Git commit.
- Immutable archive size: 19,123,456 bytes. SHA-256: `db4eaf79129008b5698427e396b7ef41e8fdfc927fec40d6d93f437ce845c8ae`; local and server hashes matched before extraction.
- The release reused the existing restricted environment, Secret, PostgreSQL TLS, and private-resume volume links without printing their contents.
- `/opt/revolution/current`, Web, and Worker point to `/opt/revolution/releases/b80a728/revolution`. Only Web and Worker were recreated. DB `74c365fb4f00...`, Embedding `1d156d6ffd16...`, and Edge `df8eba464f76...` retained their container identities.
- Previous Web and Worker images are tagged as `rollback-11ce329`.

## Data And Knowledge

- Production migration `001–007`, grants, and the AI runtime permission gate passed.
- Production knowledge contains 41 documents and 48 chunks. All 48 chunks contain both `projectSlug` and `topicIds` metadata keys.
- Two production ingest runs each updated 0 documents and skipped all 41 documents. DB and Embedding container identities remained unchanged.

## Observation

- Web, DB, and Embedding are healthy; Worker and Edge are running. All five containers report restart count `0`.
- Public live, ready, compatibility health, root, works, admin, and admin API routes return HTTP 200.
- Unauthenticated Provider runtime, turn list, resume file, and resume access routes return HTTP 401.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- Public `/favicon.ico` matches the committed ICO SHA-256. Public `/icon.svg` matches the exact `b80a728:app/icon.svg` Git blob.
- Web, Worker, Edge, and DB produced zero `error|exception|panic|fatal|unhandled` keyword matches in the observed ten-minute window.

## Runtime Parameter Boundary

- The Web environment is configured for reasoning `high`, max output `1200`, Chat v2 enabled at 100% canary, hedging disabled, and safe mode disabled.
- The active route has one database primary followed by two environment targets. The database primary still carries reasoning `high` and max output `30000`, so it overrides the environment max-output default for actual primary calls.
- The release now exposes the active route's real reasoning and max-output values in the administrator runtime summary. It does not bypass immutable model versions or the mandatory real Provider test before activation.
- No real Chat Provider test was authorized or performed in this release. Activating `1200` on the database primary remains an administrator workflow: create the new model version, run its controlled real test, then activate a new route revision.

## Exclusions

- No DB, Embedding, or Edge rebuild; no production environment mutation; no administrator login; no invite creation; no real Chat, Bocha, or Feishu call; no private-resume access; and no cleanup of old releases or persistent volumes occurred.
