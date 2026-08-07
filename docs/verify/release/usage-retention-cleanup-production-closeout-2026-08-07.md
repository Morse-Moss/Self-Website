# Usage retention cleanup production closeout (2026-08-07)

## Release

- Production source release: `8a42df7` (`fix: unblock usage retention cleanup`).
- `/opt/revolution/current` points to `/opt/revolution/releases/8a42df7/revolution`.
- Frozen archive SHA-256: `dac584c3c0515b67328fde5a18a80884c9b5da200e855b7deaf30983b9acab71` (local and remote match).
- `feat/internal-rag-search` was already absorbed by `master`; this release did not change Provider, RAG, token, public knowledge, secret, DB/Embedding or Edge configuration.

## Database

- Pre-release custom-format backup: `/opt/revolution/shared/backups/pre-8a42df7-20260807T153129Z.dump`.
- Backup size: `702937` bytes; SHA-256: `926681a74586ef9f56cffec4fec9baf6b573b5bafaf518315addd1ee8d4a9120`; `pg_restore --list` passed before migration.
- The preflight registry was exactly `001-013` and long transactions over 30 seconds were zero.
- Migration `014` applied once. Two subsequent migration runs were no-ops and reported current through `014`; the final registry is exactly `001-014`.
- `usage_events_interaction_turn_id_fkey` is absent. `usage_events_provider_attempt_fk` and `usage_events_attempt_pair_check` remain present.

## Cleanup

- First explicit Worker-role cleanup succeeded: 54 expired interaction turns, 4 expired usage events, 21 expired alert outbox rows and 22 expired access attempts were deleted; 2 expired invites were deactivated. All other cleanup counters were zero.
- The second explicit cleanup succeeded with every counter at zero.
- The new Worker then completed startup without cleanup errors; its heartbeat age was 2 seconds at final verification.

## Verification

- Local: focused PostgreSQL migration/retention/Worker/readiness/production-contract tests passed; scoped TypeScript and ESLint passed; full suite passed `1289/1289` with zero skipped; a clean production build from `8a42df7` passed.
- Public: `/api/health/live` and `/api/health/ready` returned `200`; `npm run release:smoke` returned `{ "ok": true }`.
- Protected boundaries: unauthenticated admin turns, chat history and internal RAG search returned `401`.
- DB, Embedding, Web, Worker and Edge were healthy with restart count `0`; DB, Embedding and Edge container identities were unchanged.
- Fresh Worker cleanup errors, Web errors and Edge 5xx counts were all zero at final verification.

## Recovery boundary

Migration `014` is forward-only. Application rollback requires an image that recognizes registry `001-014`; do not restore the obsolete single-column foreign key or edit the migration registry. The verified pre-release backup is the recovery artifact for a database-level incident.
