# Recruitment Bare Recheck Production Closeout

> Date: 2026-07-28
> Mode: `STAGED / CRITICAL / DEPLOYED`
> Status: `DEPLOYED_UNOBSERVED / HR_TARGETED / PERCENT_0`

## Release Identity

- Runtime commit: `22207597a2fcb8745d9c4121e976d8ae314eeb20` (`fix: scope bare recruitment rechecks`). It reached `origin/master` before deployment.
- Production pointer: `/opt/revolution/releases/2220759/revolution`.
- Frozen archive: 19,579,605 bytes; SHA-256 `349883d721ac4b33b6d8b461f8191ca00b2bd740f42567f0a31f3a38616d9836`, matched locally and remotely before extraction.
- Web image: `sha256:97e9488299793cfb05580b31e88850b0965488f8b6c1a2b77886c8c03cf35089`.

## Behavior And Verification

- A bare recheck such as `你再去查一下` or `重新确认一下` continues recruitment project matching only when the current recruitment Task is active and the adjacent completed turn has the same Task scope.
- Standalone input, a recheck after a temporary topic, and a Task waiting for JD input remain general conversation and do not inherit the recruitment Task.
- Resolver tests passed `16/16`; Controlled Context PostgreSQL integration passed `20/20`; typecheck, the 33-route production build and `git diff --check` passed.
- The temporary acceptance predicate self-test rejects the exact wrong-answer examples `没有相关项目经验` and `请把岗位职责再发一次`. No real interview replay was run in this release.

## Deployment And Recovery

- Only Web was replaced. Worker remained on `sha256:22b6db3fd8a6b923c40f1c4a531b59f6b70bb43aca3dd9e92b32d734518ba65a`; Worker, DB, Embedding and Edge container identities were unchanged.
- The first cutover started and validated the new Web but lacked permission to create the final `/opt/revolution/current` link. The rollback restored the previous Web and the still-old pointer was verified before retrying. The retry used `sudo` only for the atomic pointer update and passed.
- The first targeted-activation attempt stopped before environment mutation because a PostgreSQL `SELECT DISTINCT` ordering expression was invalid. The query was corrected to order by its selected alias, validated read-only, and then activation passed.
- The final restricted environment backup is `/opt/revolution/shared/.env.production.bak-hr-v22-targeted-20260728T040058Z`.

## Targeted HR State

- Context Packet is enabled and percentage remains `0`.
- The runtime allowlist exactly equals the union of active, unexpired, capacity-eligible invites whose label is exactly `HR interview`, and invite IDs with an unexpired Session whose invite label is exactly `HR interview`.
- Capacity-eligible count is 6; unexpired-Session invite count is 2; both Session invite IDs are already in the capacity set, so the exact union and runtime allowlist count are 6.
- No UUID, invite plaintext, personal label, Session token or raw conversation content was retained in evidence.

## Final Observation And Boundary

- All five containers are healthy with restart count 0. Public live, ready, compatibility health, root, works, admin and admin/api passed; unauthenticated protected routes returned 401; `release:smoke` passed.
- Web, Worker, Edge and DB had zero fresh error-keyword matches after the final Web restart. No running turn or active temporary acceptance invite remained.
- The agent did not create an acceptance invite, send an interview question, or call a real Chat/Embedding/Search/Provider path. The deployment and targeted configuration are observed; answer behavior remains intentionally unobserved until the user asks through an existing HR invite.
- Untracked `.github/` content remained untouched.
