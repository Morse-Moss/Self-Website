# HR Interview Context Recovery Production Closeout

> Date: 2026-07-28
> Mode: `STAGED / CRITICAL / DEPLOYED`
> Status: `DEPLOYED_UNOBSERVED / HR_TARGETED / PERCENT_0`

## Release

- Runtime commit: `bc27857` (`fix: recover HR interview context routing`), pushed to `origin/master`.
- Production pointer: `/opt/revolution/releases/bc27857/revolution`.
- Frozen archive SHA-256: `0ae33b0d74dc88983a60afedc4a81b8ce811c0d7b8f4375ffa27d70f2987734c` (local and remote match).
- Only Web was rebuilt. Worker, DB, Embedding and Edge retained their running containers.

## Runtime Configuration

- `MORSE_CHAT_CONTEXT_PACKET_ENABLED=true`.
- `MORSE_CHAT_CONTEXT_CANARY_PERCENT=0`.
- `MORSE_CHAT_CONTEXT_CANARY_INVITE_LABELS=HR interview` (exact, case-sensitive); the existing UUID allowlist was retained.
- No migration, grants, ingest, invite creation, Provider call or real interview question was performed.

## Verification

- Web and all five containers healthy; restart counts remained `0`.
- Public live, ready, compatibility health and root returned HTTP `200`.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- Fresh five-container error-keyword checks returned `0` in the post-cutover window.
- Local verification receipt reused: unit `842/842`, affected route/semantic `60/60`, Context PostgreSQL `29/29`, production contract `12/12`, typecheck/build and diff checks passed.

## Boundary

Deployment and configuration are observed. Real answer quality remains unobserved until the user asks through an eligible HR invite; the agent did not send interview questions or call a paid Provider.
