# Chat v2 answer relevance production observation

> Date: 2026-07-23
> Mode: `CEO / STAGED / CRITICAL / DEPLOYED`
> Release: `74be589 fix: improve chat answer relevance`
> Status: `PRODUCTION_OBSERVED / CANARY_0`

## Release

- `origin/master` and `origin/codex/chat-v2-release` reached `74be589` by normal fast-forward push. No force push or shared local `master` checkout was used.
- The immutable archive was 18,938,856 bytes with SHA-256 `dac319f44ee8945739bd83fe6279f99e666466c7fd010b78315414ced48d8b9f`; the server-side upload matched before extraction.
- The new release reused the restricted production environment, Secrets, and durable PostgreSQL TLS through validated symbolic links. The TLS private key remained a regular `0600` file and the certificate parsed successfully.
- The server build completed TypeScript and all 30 Next.js routes. The previous Web and Worker images were retained under the `e5f9210` rollback tag before the new images were built and tagged `74be589`.

## Deployment

- `/opt/revolution/current` was atomically switched to `/opt/revolution/releases/74be589/revolution`.
- Only Web, Worker, and Edge were force-recreated with `--no-deps`. DB remained healthy on the `e5f9210` Compose working directory and Embedding remained healthy on `e56e457`; neither was recreated.
- This correction changed no migration, knowledge source, dependency, or production configuration. Migration, grants, ingest, resume initialization, and DB mutation were intentionally skipped.

## Observation

- Public live, ready, compatibility health, root, works, admin, and admin API pages returned HTTP 200.
- Unauthenticated Provider list/runtime, turn list, and resume-file APIs returned HTTP 401.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- Web and DB were healthy; Worker and Edge were running; Embedding remained healthy. All five containers reported restart count 0.
- Web, Worker, Edge, and DB had zero `error|exception|panic|fatal` matches in the final three-minute observation window.
- Production remained at migrations `001`-`007`, 40 knowledge documents, 47 knowledge chunks, 36 historical Provider attempts, zero active v2 Sessions, and one current encrypted resume document.
- Chat v2 remained enabled with canary `0`; hedging and safe mode remained disabled. Deployment observation added no Provider attempt.

## Boundaries And Recovery

- No chat message, search, invite, administrator Session, or real Provider request was created during deployment or observation.
- Provider keys and URLs, allowlist values, invite plaintext, Session values, raw prompts/answers, Provider payloads, and private resume content were neither read into evidence nor committed.
- The prior `e5f9210` release, tagged Web/Worker images, database backup, persistent volumes, durable TLS, and Secrets were retained. Application rollback must keep schema `007` and use a migration-compatible image.
- Canary expansion, hedging fault injection, and 24/48-hour traffic observation remain separate approval gates.
