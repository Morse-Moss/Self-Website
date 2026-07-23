# Digital Morse Chat v2 production closeout

> Date: 2026-07-23
> Mode: `CEO / STAGED / CRITICAL / DEPLOYED`
> Status: `PRODUCTION_OBSERVED / RESUME_FACTS / CANARY_0`
> Runtime release: `b7e24f6 fix: ground chat identity in sanitized resume facts`
> Public entry: `https://aimorse.tech`

## Outcome

- `origin/master` and `origin/codex/chat-v2-release` reached `b7e24f6` by normal fast-forward push before deployment.
- `/opt/revolution/current` points to `/opt/revolution/releases/b7e24f6/revolution`; Web, Worker, and Edge Compose working directories match that release. DB remained on the healthy `e5f9210` Compose definition and Embedding remained on its healthy `e56e457` image; neither dependency was rebuilt.
- Chat v2 remains enabled with canary `0`; the existing non-empty invite allowlist was preserved without exposing its values. Hedging and safe mode remain disabled.
- The historical `chat_provider_attempts` count remained `36` through deployment observation and active v2 Session count remained `0`; this deployment sent no real Chat Provider request.
- The private resume remained enabled with one current encrypted document. Unauthenticated `/api/resume/file` remains HTTP 401.

## Release And Data

- The base `e5f9210` immutable Git archive was 23,695,360 bytes with SHA-256 `2eca5624af1824670d988f89bc4c2a41366ed5a4523960fbb9695f82003cb122`.
- The answer-relevance correction archive was 18,938,856 bytes with SHA-256 `dac319f44ee8945739bd83fe6279f99e666466c7fd010b78315414ced48d8b9f`; the server-side upload matched before extraction.
- The sanitized-resume-facts archive was 18,950,608 bytes with SHA-256 `434f7b38bbd1597f7382e56c4169d240b90f79ce4048e266966b241a7e7af873`; the server-side upload matched before extraction.
- The latest pre-ingest database backup is `/opt/revolution/shared/backups/pre-b7e24f6-20260723T110159Z.dump`, 305,031 bytes, SHA-256 `a0027e9464c32df32428d8da31ecc095a9e3dd76db32ef43f88bef50635fa20b`.
- Production migration registry contains 001 through 007. Migration 007 applied successfully; AI configuration and private-resume runtime privilege gates passed, and the migration role is not a superuser after grants.
- The latest production ingest indexed one `resume-facts` document and one chunk, skipped 40 unchanged documents, and reached 41 documents / 48 chunks.
- Provider configuration tables remain empty, so runtime continues to use the environment route without reading or echoing Provider URLs or keys.
- `b7e24f6` changed no migration, dependency, or production configuration. The deployment skipped migration, grants, resume initialization, and DB/Embedding rebuild; it backed up the database and ran only the required public-knowledge ingest. All prior releases and backups were retained.

## Recovery Incident

- Read-only preflight found that the running DB container still held TLS bind mounts while their host source files were missing. A plain `docker compose run migration` unexpectedly reconciled and recreated DB; the new container failed before migration with `could not load server certificate ... no start line`.
- The PostgreSQL volume and pre-migration backup were intact. A new restricted self-signed certificate/key pair was created at `/opt/revolution/shared/postgres/tls`, the release TLS directory now links to that durable path, and DB was force-recreated against the preserved volume.
- DB returned healthy with six registered migrations before 007 was applied; public live/ready recovered to HTTP 200 before deployment continued. Post-recovery DB is healthy with seven migrations and restart count 0.
- Upgrade one-shot containers must use `--no-deps` after explicit dependency health checks. A rollback image must contain the exact applied migration manifest; pre-007 `37fac31` is not a readiness-compatible rollback after registry 007 exists.
- The first `b7e24f6` Web recreate was rejected before a valid replacement started because tracked placeholder directories remained at `deploy/secrets` and `deploy/postgres/tls`; `ln -sfn` had created nested links instead of replacing those directories. The release placeholders were removed, the directory paths themselves were linked to the restricted shared Secret/TLS directories, and Web then reached healthy. DB and Embedding were not changed.

## Observation

- Public live, ready, compatibility health, root, works, admin, and admin API routes returned HTTP 200.
- Unauthenticated invite, Provider, runtime, turn-list, and resume-file APIs returned HTTP 401.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- DB, Embedding, and Web are healthy; Worker and Edge are running. Web, Worker, Edge, DB, and Embedding each report restart count 0, and Web/Worker/Edge/DB had zero `error|exception|panic|fatal` matches in the final three-minute observation window.
- Production contains seven migrations, 41 knowledge documents, 48 knowledge chunks, 36 historical Provider attempts, zero active v2 Sessions, and one current encrypted resume document.

## Boundaries And Recovery

- No review invite was created, no administrator Session was used, and the new fixed 20-round Provider review was not started during deployment.
- Provider keys, administrator credentials, allowlist values, invite plaintext, resume plaintext, Session values, raw prompts/answers, and Provider payloads were not read into evidence or committed.
- For application degradation, keep schema 007, first use the Chat v2/safe-mode/master Chat switches and verify live/ready. Image rollback requires a frozen image that includes migration 007; retain the database backup, previous releases, private volume, durable TLS, and Secrets.
- The fixed 20-round review retained its original `15/20` score; all five failed cases later passed targeted regression. The sanitized resume-facts candidate is now deployed as `b7e24f6` at canary `0`; no new real Provider review was run for this deployment. See `chat-v2-real-provider-review-2026-07-23.md` and `chat-v2-answer-relevance-production-observation-2026-07-23.md`.
- Hedging fault injection, 25% rollout, 100% rollout, and 24/48-hour observation remain separate approval gates.
