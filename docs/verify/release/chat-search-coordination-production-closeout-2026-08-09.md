# Chat search coordination production closeout (2026-08-09)

## Scope

- Source commit: `5e438cf` (`refactor: extract chat search coordination`).
- Changed runtime files: `lib/server/chat-dependency-monitor.ts`, `lib/server/chat-search-coordinator.ts`, and the corresponding `lib/server/chat-service.ts` delegation plus the architecture contract test.
- The frozen archive was `19,749,964` bytes with SHA-256 `570b408a84d6e1d3881399465c8912322b0ab9b69cc6c479a01de652db2a6231`; local and remote hashes matched.
- Job-system assets (`auto-job-agent/`, `boss-helper-main/`, `get_jobs/`, and `.worktrees/`) were excluded from the archive and are absent from the deployed release.

## Deployment

- Previous pointer: `/opt/revolution/releases/8a42df7/revolution`.
- Current pointer: `/opt/revolution/releases/5e438cf/revolution`.
- Only `web` and `worker` were recreated. Rollback tags `revolution-web:rollback-8a42df7` and `revolution-worker:rollback-8a42df7` remain available.
- New image digests: Web `sha256:595483c6ed66727cd2139e66b4ebe6de234351ef9d2ac1dae7e121b16b81ce57`; Worker `sha256:4d1f6af6a9b79e9afb6bce657881cbaec8038bfa7f2cdc39fd730c44c692d0ca`.
- No migration, grants, ingest, secret, provider, embedding, edge, or public-knowledge operation was run.

## Verification

- Remote production build completed successfully; the image architecture contract passed `13/13` checks.
- All five containers were healthy with restart count `0`; DB, Embedding, and Edge container identities were unchanged.
- Migration registry is exactly `001-014`; long transactions are `0`.
- `https://aimorse.tech/api/health/live` and `/api/health/ready` returned `{"ok":true}`.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- Unauthenticated `POST /api/internal/rag/search` returned `401` with `Cache-Control: no-store`; the root page returned `200` with CSP, HSTS, X-Frame-Options, and related security headers.

## Observation boundary

- This is a deployed, health-verified release. No real Provider, Embedding, Search, Chat, or authenticated Admin workflow was called, so Provider-backed answer quality remains unobserved.
- The local untracked job-system assets were left untouched. The deployment temporary archive and scripts are removed after this closeout; historical releases, rollback images, secrets, and persistent data remain.
