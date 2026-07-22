# Digital Morse Chat v2 disabled-first production closeout

> Date: 2026-07-22
> Mode: `DIRECT / CRITICAL / DEPLOYED`
> Status: `PRODUCTION_OBSERVED / DISABLED_FIRST / LIMITED_LAUNCH`
> Runtime release: `e56e457 fix: preserve partial provider telemetry`
> Public entry: `https://aimorse.tech`

## Outcome

- `origin/master` and `origin/codex/chat-v2-release` reached `e56e457` before deployment.
- `/opt/revolution/current` points to `/opt/revolution/releases/e56e457/revolution`.
- The server-side flags are `MORSE_CHAT_V2_ENABLED=true`, canary `0`, an empty invite allowlist, hedging disabled, and safe mode disabled.
- No Session entered v2 and no row was written to `chat_provider_attempts`; this deployment made no real Chat Provider call.
- The existing private resume remained enabled. One current encrypted resume record remains present, and unauthenticated `/api/resume/file` stays HTTP 401.

## Release And Data

- The immutable Git archive was 23,367,680 bytes with SHA-256 `6d7c3e2166cf364076c2347232056d9309a6c9e12a2231766501fd29502f5b16`; the server-side upload matched before extraction.
- The pre-migration database backup is `/opt/revolution/shared/backups/pre-e56e457-20260722T102951Z.dump`, 267,227 bytes, SHA-256 `bace5c1b7e94df94542c0e686e885d9dcd50549a4162f7dff16fa784daf998b7`. A restricted environment backup was stored beside it.
- Production migration registry contains 001 through 006. Migration 005 and 006 applied successfully; the migration role is not a superuser after grants.
- AI configuration and private-resume runtime privilege gates passed. Runtime has the required CRUD privileges on `chat_provider_attempts`.
- Deterministic knowledge ingest updated 0 documents and 0 chunks and skipped all 40 unchanged documents.

## Observation

- Public live, ready, compatibility health, root, works, admin, and admin API routes returned HTTP 200.
- Unauthenticated invite, Provider, runtime, event, turn-detail, and resume-file APIs returned HTTP 401.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- DB, Embedding, and Web were healthy; Worker and Edge were running. Web, Worker, and Edge each had restart count 0 and zero `error|exception|panic|fatal` matches in the post-release 10-minute window.
- Production counters were `v2_sessions=0` and `provider_attempts=0`.

## Boundaries And Recovery

- No review invite was created, no administrator Session was used, and the real Provider 20-round review was not started.
- Provider keys, administrator credentials, invite plaintext, resume plaintext, Session values, and raw Provider payloads were not read into evidence or committed.
- Migration 005/006 are additive and are not rolled back. For application rollback, first restore the five Chat v2 flags to the disabled state, verify live/ready, and only then switch to a compatible frozen image; retain schema, database backup, private volume, and Secrets.
- Canary allowlisting, the 20-round real Provider review, hedging fault injection, 25% rollout, 100% rollout, and 24/48-hour observation remain separate approval gates.
