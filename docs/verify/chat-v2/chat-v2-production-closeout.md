# Digital Morse Chat v2 response reliability production closeout

> Date: 2026-07-23
> Mode: `CEO / STAGED / CRITICAL / DEPLOYED`
> Status: `PRODUCTION_OBSERVED / RESPONSE_RELIABILITY / CANARY_0`
> Runtime release: `e5f9210 fix: harden chat response reliability`
> Public entry: `https://aimorse.tech`

## Outcome

- `origin/master` and `origin/codex/chat-v2-release` reached `e5f9210` atomically before deployment.
- `/opt/revolution/current` points to `/opt/revolution/releases/e5f9210/revolution`; Web, Worker, Edge, and DB Compose working directories match that release. Embedding remained on its already healthy immutable image and was not rebuilt.
- Chat v2 remains enabled with canary `0`; the existing non-empty invite allowlist was preserved without exposing its values. Hedging and safe mode remain disabled.
- The historical `chat_provider_attempts` count remained `36` through deployment observation and active v2 Session count remained `0`; this deployment sent no real Chat Provider request.
- The private resume remained enabled with one current encrypted document. Unauthenticated `/api/resume/file` remains HTTP 401.

## Release And Data

- The immutable Git archive was 23,695,360 bytes with SHA-256 `2eca5624af1824670d988f89bc4c2a41366ed5a4523960fbb9695f82003cb122`; the server-side upload matched before extraction.
- The pre-migration database backup is `/opt/revolution/shared/backups/pre-e5f9210-20260723T031124Z.dump`, 289,211 bytes, SHA-256 `2f7c9fd881c74e7f2721aace21d1af933b25181ba3c45f2ddf4d1186e0863c0c`. A restricted environment backup was stored at `/opt/revolution/shared/.env.production.bak-e5f9210-20260723T031124Z`.
- Production migration registry contains 001 through 007. Migration 007 applied successfully; AI configuration and private-resume runtime privilege gates passed, and the migration role is not a superuser after grants.
- Production knowledge ingest rebuilt 40 documents / 47 chunks for the new metadata checksum; the immediate second ingest skipped all 40 unchanged documents.
- Provider configuration tables remain empty, so runtime continues to use the environment route without reading or echoing Provider URLs or keys.

## Recovery Incident

- Read-only preflight found that the running DB container still held TLS bind mounts while their host source files were missing. A plain `docker compose run migration` unexpectedly reconciled and recreated DB; the new container failed before migration with `could not load server certificate ... no start line`.
- The PostgreSQL volume and pre-migration backup were intact. A new restricted self-signed certificate/key pair was created at `/opt/revolution/shared/postgres/tls`, the release TLS directory now links to that durable path, and DB was force-recreated against the preserved volume.
- DB returned healthy with six registered migrations before 007 was applied; public live/ready recovered to HTTP 200 before deployment continued. Post-recovery DB is healthy with seven migrations and restart count 0.
- Upgrade one-shot containers must use `--no-deps` after explicit dependency health checks. A rollback image must contain the exact applied migration manifest; pre-007 `37fac31` is not a readiness-compatible rollback after registry 007 exists.

## Observation

- Public live, ready, compatibility health, root, works, admin, and admin API routes returned HTTP 200.
- Unauthenticated invite, Provider, runtime, turn-list, and resume-file APIs returned HTTP 401.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- DB, Embedding, and Web are healthy; Worker and Edge are running. Web, Worker, Edge, DB, and Embedding each report restart count 0 after final recreation, and Web/Worker/Edge/DB had zero `error|exception|panic|fatal` matches in the final two-minute observation window.
- Production contains seven migrations, 40 knowledge documents, 47 knowledge chunks, 36 historical Provider attempts, zero active v2 Sessions, and one current encrypted resume document.

## Boundaries And Recovery

- No review invite was created, no administrator Session was used, and the new fixed 20-round Provider review was not started during deployment.
- Provider keys, administrator credentials, allowlist values, invite plaintext, resume plaintext, Session values, raw prompts/answers, and Provider payloads were not read into evidence or committed.
- For application degradation, keep schema 007, first use the Chat v2/safe-mode/master Chat switches and verify live/ready. Image rollback requires a frozen image that includes migration 007; retain the database backup, previous releases, private volume, durable TLS, and Secrets.
- The fixed 20-round review was completed after this deployment and retained its original `15/20` score; all five failed cases later passed targeted regression. See `chat-v2-real-provider-review-2026-07-23.md` for the redacted receipt. The corrected candidate is not represented as deployed by this historical receipt.
- Hedging fault injection, 25% rollout, 100% rollout, and 24/48-hour observation remain separate approval gates.
