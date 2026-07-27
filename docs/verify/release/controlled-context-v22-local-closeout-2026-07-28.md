# Controlled Context V2.2 Local Closeout

> Date: 2026-07-28
> Mode: `STAGED / CRITICAL / DEPLOYED`
> Status: `LOCAL_READY / PRODUCTION_PREFLIGHT_COMPLETE / DEPLOYMENT_PENDING`

## Scope

- Replace route-filtered history with a bounded, database-authoritative Context Packet for multi-turn recruitment, project, capability and JD questions.
- Keep task continuity in a structured Task Frame; use RAG only to select audited public evidence for the current semantic intent.
- Persist redacted manifests and enforce same-turn packet/request HMAC integrity before every Provider attempt.
- Add forward-only migration `012`, independent Context Packet kill switch/canary, 12k/24k budgets and a Web-only digest Secret.

## Verification Receipt

- Disposable PostgreSQL applied migrations `001-012`; deterministic ingest produced 41 documents / 48 chunks.
- Complete isolated test collection: `1156/1156`, zero failures and zero skips. The affected Context/Provider/Chat/SSE boundary passed `191/191`; the planner plus V2.2 PostgreSQL boundary passed `31/31`.
- `npm run chat:eval`: `96/96`, `externalCalls=0`.
- `npm run rag:eval`: top-3 `46/46`; positive and negative thresholds passed with local BGE/pgvector.
- `npm run typecheck`, changed-file ESLint, `git diff --check`, and `npm run build` passed; the build generated 33 routes.
- The 24-file production-sensitive scan had zero findings. Full ESLint has 20 pre-existing errors in untouched frontend files and is not claimed clean.
- Independent CRITICAL compliance/spec and quality/safety review returned PASS after the final bounded corrections.

## Production Preflight

- Current pointer is `/opt/revolution/releases/9c13490/revolution`; all five containers are healthy with restart count 0.
- Migration registry is `001-012`; public RAG has 41 documents / 48 chunks; no transaction older than five seconds was present.
- Active Provider route is revision 2 with two database targets followed by two environment targets. Chat v2 is enabled at 100%; hedging and safe mode are disabled.
- Context Packet is disabled, percentage is `0`, and the allowlist is empty. Its digest Secret is mounted read-only only in Web with owner `1001:1001` and mode `0600`; PostgreSQL TLS key is `999:999` and mode `0600`.
- DB `cdd60bc525be...`, Embedding `1a37c91fe1b5...`, Edge `b2c4293eec67...`, Web `c41b02a4c08f...` and Worker `4958ef4fef2e...` are the pre-deployment identities.
- Backup `pre-9c13490-20260727T204827Z.dump` is readable, 348,183 bytes, mode `0600`, and SHA-256 `b0d3fb7b9dc1d97fff12c9ec85ae5cd5e42a44a76f05f56ebecdd0fe9eedc6cd`; the current runtime-grant assertion script returned `DO`. Public live/ready and `release:smoke` pass, and Web/Worker/Edge/DB have zero error-keyword matches in the fresh 20-minute window.

## Delivery Boundary

- Closeout scope excludes the main worktree's untracked `.github/` directory and all unrelated worktrees.
- No code from a dirty worktree may be deployed. The release must be committed, absorbed into `master`, pushed, archived from the frozen commit and SHA-256 verified locally/remotely first.
- This correction contains no migration or public-knowledge change. Production must keep registry `001-012`, reuse the verified existing backup, skip database writes/migration/grants/ingest, and rebuild only Web/Worker while Context Packet is disabled.
- Production stops at one invite and at most five real Provider main answers. Context Packet percentage remains `0`; no 10% or broader rollout is authorized.
- Raw prompts, answers, Provider payloads, invite plaintext, credentials, URLs and private resume content are excluded from evidence.
