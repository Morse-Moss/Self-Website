# Architecture Governance Ratchet

> Status: decided and implemented locally on 2026-08-09

## Problem

Revolution already had strong written engineering rules and a passing dependency contract, but no staged or CI enforcement. Generic 400-line checks produced high noise, while foreign job-system assets remained reachable by build and release tooling. The shortest path for a new feature could therefore still be the wrong owner.

## Decision

Keep `docs/engineering-standards.md` as the only engineering-rule source. Reuse the Vibe scaffold's index-aware tripwire mechanism, not its generic architecture model. Enforce three levels:

- hard scope and dependency invariants;
- advisory size/fan-out signals with a no-growth ratchet for legacy hotspots;
- exact-path, versioned, expiring waivers for review signals only.

Local pre-commit checks the Git index. CI checks the exact commit dependency graph and the diff from its base. Foreign job-system paths are excluded from compilation, lint, Docker context, and Git archives without deleting their legacy tracked copies.

## Invariants

- Scope, dependency, private-data, contract, data, and side-effect boundaries are not waivable.
- Existing oversized modules do not block unrelated development, but cannot grow while over their limit.
- `chat-service.ts` remains orchestration-only; new domain rules, SQL, Provider details, or compensation logic require an owned boundary.
- Agent entry files link to the canonical engineering rules instead of becoming competing sources.
- Hook success alone is never release evidence.

## Non-goals

- No business behavior, Provider configuration, migration, production runtime, deployment, push, or dependency change.
- No deletion or history rewrite of job-system assets.
- No broad refactor of current architecture hotspots.

## Verification

- `npm test` in `E:\vibe-starter`.
- `npm run check:architecture` and `npm run check:tripwire` in Revolution.
- Focused governance tests deliberately fail before the integration and pass afterward.
