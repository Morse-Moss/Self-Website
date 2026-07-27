# Chat V2.1 Output Guard Production Closeout

## Release

- Application commit: `4a039ab`
- Previous application release: `c971979`
- Production pointer: `/opt/revolution/releases/4a039ab/revolution`
- Archive bytes: `19,210,438`
- Archive SHA-256: `395f87d164f29ae1075ce994658f43c497dc7f8e163afd30c8fe438675565c33`
- GitHub push: pending at deployment time because local TCP access to `github.com:443` timed out

## Verification

- Focused route, guard, and answer-runner tests: `88/88`
- `npx tsc --noEmit`: passed
- `npm run build`: passed
- Independent review: PASS after two rejected boundary variants were covered
- Public live and ready: HTTP 200 with `{"ok":true}`
- Public root, works, admin, and admin API: HTTP 200
- `release:smoke`: `{"ok":true}`
- Web, Worker, DB, Embedding, Edge: healthy
- DB, Embedding, and Edge container IDs: unchanged across release
- Ten-minute Web, Worker, Edge, and DB error-keyword counts: 0

No migration, grants, or ingest command ran for this code-only release. Production schema remains current through migration `008`; public knowledge did not change.

## Real Provider Observation

One current-user-path request was sent after deployment. It routed to `grounded / project_fact_query / project / digital-morse`, proving the routing and project lock were correct. The active V1 primary and first serial fallback both failed before any protocol event with `PROVIDER_UNAVAILABLE`; no answer, usage, input-token, or output-token record was produced. The first turn ended after about 3.3 seconds. The conditional second turn was not sent.

No-generation HEAD probes reached the three configured origins with HTTP 200, 200, and 403. This narrows the remaining incident to the authenticated model/protocol Responses chain, not general server egress or the output guard. V1 remains active at `version 1 / high / 30000`. V2 remains inactive at `version 2 / medium / 1200` because its required real test has not passed.

The temporary invite was deactivated and its Session expired. No invite plaintext, credential, raw answer, Provider payload, or private resume data was retained in this evidence.
