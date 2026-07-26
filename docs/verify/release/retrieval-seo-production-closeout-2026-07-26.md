# Retrieval and SEO production closeout

> Date: 2026-07-26
> Mode: `STAGED / CRITICAL / DEPLOYED`
> Status: `PRODUCTION_OBSERVED / RETRIEVAL_AND_SEO_APPLIED`
> Runtime release: `3ec952a perf: HNSW-friendly retrieval, cache-stable prompt prefix, retention gaps, SEO surface`
> Public entry: `https://aimorse.tech`

## Release

- `3ec952a` was committed on `master`, pushed to `origin/master`, and archived from that exact Git commit.
- Immutable archive SHA-256: `5c431bac78313ef4ad7fc4802d9883ebe7d5447db2d56c232860576818b709f4`; local and server hashes matched before extraction.
- The release reused the existing restricted environment, Secret, PostgreSQL TLS, and private-resume volume links without printing their contents.
- `/opt/revolution/current`, Web, and Worker point to `/opt/revolution/releases/3ec952a/revolution`.
- Previous Web and Worker images are tagged `rollback-95a85ea`.
- No schema change: this release ships migrations 001-007 only. Workspace migrations 008 (another in-progress thread) and 009 (growth indexes, coupled to 008's test fixtures) are intentionally excluded and remain uncommitted locally.

## What This Release Changes In Production

- RAG retrieval rewritten as two-stage: inner ANN scan `ORDER BY embedding <=> $1 LIMIT 40` (aligned with pgvector default `hnsw.ef_search`) so the HNSW index becomes usable as the corpus grows; outer per-document dedup. Gold-set re-run: 46/46 top-3, positive/negative threshold checks pass.
- System prompt block order: stable blocks (persona, evidence policy) now precede per-turn blocks (response contract, evidence, question) to enable provider prompt-prefix caching. Zero copy changes verified block-by-block in review; deterministic chat-eval 91/91.
- Worker cleanup now covers `usage_events` (10-day retention) and recovered `service_incidents` (90-day) — previously unbounded tables; the 10-day interaction retention claim now holds for usage telemetry.
- `/sitemap.xml` (7 URLs from site content) and `/robots.txt` (disallow /admin, /api) are live and verified over the public origin; openGraph/twitter metadata added.
- Admin turn-list `page` parameter capped at 500.

## Honest Boundary: DB/Embedding Recreation Is Structural

DB and Embedding containers were recreated again even though the compose file is identical to the previous release. Root cause confirmed via container mount inspection: the db service bind-mounts `postgresql.conf`, init scripts, TLS material, and secrets from the release directory, so the mount source paths change on every release switch and compose treats that as a config change. Under the current layout, every release switch necessarily recreates db/embedding. Data volumes (`revolution_pgdata`, `revolution_embedding_models`) are untouched; both containers restarted with count 0 and reached healthy; migration re-run reports `Database migrations current through 007`; ingest is idempotent (0 updated, 41 documents skipped). Eliminating this would require moving those bind sources to fixed `/opt/revolution/shared/` paths — a remote security-config change requiring separate authorization.

## Observation

- All five containers healthy; db/embedding restart count 0; five named volumes present.
- Public live and ready return `{"ok":true}`; root/works/admin 200; unauthenticated resume file 401.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- `sitemap.xml` serves the expected urlset; `robots.txt` allows `/`, disallows `/admin` and `/api`, and references the sitemap.
- Web, Worker, Edge, and DB produced zero `error|exception|panic|fatal|unhandled` keyword matches in the observed ten-minute window.

## Exclusions

- No administrator login; no invite creation; no real Chat, Bocha, or Feishu call; no private-resume access; no cleanup of old releases or persistent volumes; migrations 008/009 not deployed.
