# Chat v2 reasoning configuration production closeout

> Date: 2026-07-24
> Mode: `DIRECT / CRITICAL / DEPLOYED`
> Status: `PRODUCTION_OBSERVED / REAL_PROVIDER_NOT_RERUN`
> Runtime release: `8c84ae7 fix: honor active chat v2 model settings`
> Public entry: `https://aimorse.tech`

## Outcome

- The administrator model-save and route-activation flow was working. The active production preset was already `gpt-5.6-terra / responses / high / max_output_tokens 30000`.
- The defect was a V2 request override: `adaptV2Route()` assigned `reasoningEffort: low` to `conversation` and `jd`, while `OpenAIProvider` gives request-level values priority over the active model preset.
- V2 now leaves request-level reasoning unset for every route, so the active model preset is authoritative. V1 retains its existing low-reasoning policy.
- The release also keeps short multi-turn follow-ups anchored to the latest route, avoids repeated clarification prompts, and prevents the internal `response_contract` from reaching user-visible output.
- `max_output_tokens` remains `30000`; this release did not change it to `1200`.

## Verification

- Focused route/reasoning/anchor tests: `29/29` PASS.
- Affected non-database behavior tests: `84/84` PASS.
- PostgreSQL integration: `80/80` PASS, zero skips.
- `npm run chat:eval`: `76/76` PASS with `externalCalls=0`.
- Local build and production image build: PASS, 30 routes.
- `git diff --check`: PASS.
- The repository-wide architecture contract still reports three pre-existing dependency cycles. This change added no import edge.

## Release

- `origin/master` and `origin/codex/chat-v2-release` reached code commit `8c84ae7` before deployment.
- The immutable archive was 18,954,355 bytes with SHA-256 `64002a6eff12ad9591753f56f303a0bdda360b1bbd23a3c1114eef496af44e38`; the server-side upload matched before extraction.
- Restricted shared Secret, PostgreSQL TLS, and production environment paths were linked into the new release only after confirming the tracked placeholder directories contained only `.gitkeep`.
- Compose configuration validation and Web/Worker image build passed before cutover.
- `/opt/revolution/current`, Web, and Worker point to `/opt/revolution/releases/8c84ae7/revolution`.
- DB, Embedding, and Edge container IDs, start times, and restart counts remained unchanged. No migration, grant, ingest, DB rebuild, Embedding rebuild, or Edge rebuild ran.

## Production Observation

- The active database route remained `gpt-5.6-terra / responses / high / 30000` after cutover.
- Web, DB, and Embedding were healthy; Worker and Edge were running. All five running containers had restart count `0`.
- Public live, ready, compatibility health, root, works, and admin routes returned HTTP 200.
- Unauthenticated Provider, runtime, turn-list, resume-file, and resume-access routes returned HTTP 401.
- `MORSE_RELEASE_BASE_URL=https://aimorse.tech npm run release:smoke` returned `{"ok":true}`.
- Web, Worker, Edge, and DB had zero `error|exception|panic|fatal` matches in the final five-minute observation window.

## Provider Boundary And Recovery

- This deployment and its smoke checks made no Chat, Embedding, or Search Provider request and did not create a Provider attempt.
- Production contained 42 historical `chat_provider_attempts` and one unexpired V2 access Session at observation. The six attempts newer than the prior closeout all occurred between 17:13 and 17:32 China Standard Time, before the new containers started at 20:20; only safe timestamps, route kinds, status, and latency metadata were inspected.
- No question, answer, raw Provider payload, key, administrator credential, invite value, Session value, allowlist value, or private resume content was read into evidence.
- A new real request showing `high` in the administrator attempt view remains unobserved because the user explicitly bounded deployment to no real Chat Provider call. The next user test is the final behavior observation.
- For application rollback, retain the unchanged database schema and persistent services, rebuild Web/Worker from `/opt/revolution/releases/b7e24f6/revolution`, then atomically restore `/opt/revolution/current`. All prior releases remain present.
