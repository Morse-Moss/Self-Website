# HR JD Context Production Closeout

> Date: 2026-07-29
> Mode: `GOAL / CRITICAL / DEPLOYED`
> Status: `LOCAL_VERIFIED / PREDEPLOY`

## Scope

- Baseline and current production release before deployment: `acecafc` on `master` and `origin/master`.
- Owned implementation: explicit JD semantic control isolation, recruitment retrieval chunking, and readiness resolution of the active Provider runtime.
- Owned tests and operations knowledge: focused regressions, readiness/deployment contracts, two production runbooks, and the active Task Center pointer.
- Excluded and untouched: `.github/`, `revolution-bc27857.tar.gz`, the absorbed `codex/dynamic-context` worktree, external repositories, production secrets, raw Provider payloads, invite codes, and Session values.

## Root Causes And Correction

1. Explicit `jd_match` still ran the whole JD body through conversation correction, switch, completion, and clear classifiers. Normal negative wording in the job description could therefore suppress creation of the JD Task Frame.
2. A 682-character multi-topic JD remained below the default 1024-character partition threshold and produced one diluted embedding. No audited project crossed the calibrated `0.45` relevance gate, so the Context Packet reached the Provider with zero sources and zero evidence.
3. The resolver now treats explicit JD workflow text as data for those conversation-control checks. Recruitment/JD evidence queries use complete 256-character boundary chunks; concatenating every chunk reproduces the original input exactly. No relevance threshold or input, output, history, retrieval, attempt, context-window, or model-output limit was added.
4. Readiness now resolves the active Provider runtime and fails with `READINESS_AI_CONFIG_UNAVAILABLE` when an active route cannot be reconstructed. Both runbooks require every active target to be tested and activated as digest V2 before removing legacy digest inputs.

## Verification Receipt

- Focused affected boundary: `104/104` passed.
- Full unit suite: `900/900` passed.
- PostgreSQL integration: `343/343` passed.
- `npm run typecheck`: passed.
- `npm run build`: passed, 33 routes.
- Scoped ESLint over all changed TypeScript and test files: passed.
- `git diff --check`: passed; sensitive-pattern scan of the owned diff found no match.
- Full repository lint remains a pre-existing baseline failure: 20 errors and 3 warnings in React files not modified by this task.

## Production Preflight

- `/opt/revolution/current` resolves to `/opt/revolution/releases/acecafc/revolution`.
- Five production containers are healthy.
- Active Provider route revision 3 has two targets. Both use `config_digest_version=2`, `reasoning_effort=high`, and no configured context-window or max-output limit.
- Migration registry is exactly `001-013`; knowledge inventory is 41 documents / 48 chunks; long transactions over 30 seconds are zero.
- No deployment, traffic switch, new invite, or new production question had occurred when this predeploy receipt was written.

## Review Gate

- Independent CRITICAL quality and compliance agents repeatedly failed at the shared Responses gateway with HTTP 502 before returning a verdict.
- This is recorded as degraded independent assurance, not as a PASS. Controller inspection found no known blocker.
- Final acceptance requires fresh production health gates plus 11 real HR turns beginning with the complete JD. Any irrelevant, unsupported, fabricated, refused, or failed answer stops the sequence for turn-level diagnosis.

## Next Action

Create an explicit scoped commit, push `master`, deploy the frozen commit to Web and Worker, then perform the fresh isolated HR conversation and update this receipt to `PRODUCTION_OBSERVED` only if every turn passes.
