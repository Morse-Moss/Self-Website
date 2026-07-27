# Provider Takeover And Migration Chain Production Closeout

## Release Identity

- Release commit: `c2d575c71fba9bf1ecd73eea0c3923686e5294d6` (`fix: repair migration chain`).
- Previous production application release: `4a039ab`.
- Runtime commit `c2d575c` reached GitHub `master` before deployment. The follow-up production-evidence commit is `0426eaf`; it does not change the deployed application image.
- Production pointer: `/opt/revolution/releases/c2d575c/revolution`.
- Frozen archive: 19,503,454 bytes; SHA-256 `45ff9cba30e7f884302f81fb8f32373c004edcb091d109b07517cd40e36a0c2b`, matched locally and remotely before extraction.

## Data And Recovery

- Pre-migration backup: `/opt/revolution/shared/backups/pre-c2d575c-20260727T155358Z.dump`, 349,213 bytes, SHA-256 `d321aecccaca660cadbba7984255b121ca06e2f4d721d258b9c1e3a633a8db75`.
- Web and Worker were stopped before index construction; the database reported zero transactions older than five seconds.
- Migrations `009`, `010`, and `011` applied in order. A second migration run was idempotent and reported current through `011`.
- Registry versions are `001-011`; production already had the canonical `008` Task Frame, so `011` performed no historical-row conversion. `conversation_task_state` remains at zero rows with the canonical 13 columns.
- All ten expected growth/Task Frame indexes exist. `ai_environment_takeovers` exists. Grants and `verify-ai-config-runtime.sql` passed; the migration role is not a superuser.
- Rollback application images `revolution-web:rollback-4a039ab` and `revolution-worker:rollback-4a039ab` are retained. The database migration is forward-only; application rollback must use an image that recognizes manifest `001-011`.

## Runtime Observation

- The production image build completed with 33 Next.js page-data entries.
- Only Web and Worker were recreated. DB `cdd60bc525be...`, Embedding `1a37c91fe1b5...`, and Edge `b2c4293eec67...` retained their complete container identities. All five services are healthy with restart count 0.
- Public live, ready, compatibility health, root, works, admin, and admin/api returned HTTP 200.
- Unauthenticated Provider runtime, turn list, and private resume file requests returned HTTP 401.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- The planned maintenance stop produced two Edge upstream-unavailable keyword matches. From the new Web container start onward, Web, Worker, Edge, and DB error-keyword counts were 0 and Edge 5xx count was 0.

## Boundaries

- Public knowledge did not change, so ingest did not run. DB, Embedding, and Edge were not rebuilt.
- No production environment value, secret, Provider route, invitation, resume document, or administrator Session was read or changed.
- No real Chat, Embedding, Search, Bocha, Feishu, or Provider test call ran.
- The Environment Provider takeover UI, API, persistence, and permissions are deployed. Authenticated takeover, real Provider testing, and activation remain explicit administrator actions and were not claimed as observed by this release.
