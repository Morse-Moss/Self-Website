# Ops hardening production closeout

> Date: 2026-07-26
> Mode: `STAGED / CRITICAL / DEPLOYED`
> Status: `PRODUCTION_OBSERVED / OPS_HARDENING_APPLIED`
> Runtime release: `95a85ea feat: harden ops resilience, invite attribution, chat throttling and engineering chain`
> Public entry: `https://aimorse.tech`

## Release

- `95a85ea` was committed on `master`, pushed to `origin/master` (via authorized push), and archived from that exact Git commit.
- Immutable archive size: 19,170,813 bytes. SHA-256: `34693e1ce8f0451df0ff827ded3b3da1aedc9dd89f56b1f919c5551b3f01fa0f`; local and server hashes matched before extraction.
- `.github/workflows/ci.yml` exists locally but is excluded from the pushed commit: the OAuth token lacks `workflow` scope. The CI workflow ships in a later push once the token gains that scope.
- The release reused the existing restricted environment, Secret, PostgreSQL TLS, and private-resume volume links (`deploy/secrets`, `deploy/postgres/tls`, `.env.production` symlinked to `/opt/revolution/shared/...`) without printing their contents.
- `/opt/revolution/current`, Web, and Worker point to `/opt/revolution/releases/95a85ea/revolution`.
- Previous Web and Worker images are tagged `rollback-b80a728`.

## What This Release Changes In Production

- Worker heartbeat + healthcheck (`find -mmin -3` on `/tmp/worker-heartbeat`); edge healthcheck (`nc -z` 80/443). All five containers now report healthy.
- Per-service resource limits (db 768m/1.0, embedding 1g/1.0, web 1g/1.0, worker 512m/0.5, edge 256m/0.5; verified on web: 1073741824 bytes / 1.0 NanoCpus).
- Log rotation json-file 10m x 3 on all services (verified on web).
- `MORSE_INVITE_TRUSTED_PROXY_HOPS=1` injected into web; production preflight now fails closed without it (`PRODUCTION_INVITE_PROXY_HOPS_REQUIRED`).
- Chat per-session window throttle active by default: 60s / 10 user messages, guided retry copy, no quota deduction on rejection.
- Admin sessions now carry an absolute 12h lifetime cap clamping sliding renewal.

## Honest Boundary: DB/Embedding Recreation

`up -d web worker edge` recreated the DB and Embedding containers because this release adds resource limits and logging config to those services — compose treats that as a config change. This deviates from the "switching app release must not implicitly rebuild dependency containers" boundary. Root cause: the config change itself targets those services, so recreation was unavoidable for the limits to apply; it was not planned explicitly beforehand.

- Data volumes `revolution_pgdata` and `revolution_embedding_models` were untouched; both containers restarted with count 0 and reached healthy.
- Post-recreation proof: migration re-run reports `Database migrations current through 007`; ingest re-run is idempotent (0 updated, 41 documents skipped); public ready returns `{"ok":true}`.
- Follow-up rule recorded in the runbook: releases that change db/embedding service config must plan the recreation window explicitly.

## Observation

- All five containers healthy (including worker and edge, newly instrumented). DB restart count 0, Embedding restart count 0.
- Public live, ready, root, works, admin routes return HTTP 200; unauthenticated resume file returns 401.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- Web, Worker, Edge, and DB produced zero `error|exception|panic|fatal|unhandled` keyword matches in the observed ten-minute window.

## Exclusions

- No administrator login; no invite creation; no real Chat, Bocha, or Feishu call; no private-resume access; no cleanup of old releases or persistent volumes; no remote security-config mutation beyond the compose-declared services.
