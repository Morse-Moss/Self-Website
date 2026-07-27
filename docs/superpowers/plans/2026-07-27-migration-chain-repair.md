# Migration Chain Repair Plan

## StagePacket

```yaml
stage: migration-chain-repair
outcome: migration 009 becomes an owned ordered performance migration and databases registered with the historical 008 task-state schema upgrade safely to the canonical Task Frame
controls:
  execution: STAGED
  risk: CRITICAL
  delivery: LOCAL
state: CLOSE
scope:
  owned:
    - db/migrations/009_db_growth_indexes.sql
    - db/migrations/011_conversation_task_state_repair.sql
    - scripts/migrate-db.mjs
    - tests/migration-integration.test.ts
    - focused deployment/readiness contracts if affected
    - migration closeout knowledge
  excluded:
    - .github/
    - db/migrations/008_conversation_task_state.sql
    - production database and services
    - Provider, Embedding, ingest, and Edge behavior
dod:
  - 009 is tracked with exact index definitions and sorts between 008 and 010
  - canonical 008 remains byte-for-byte unchanged
  - only the known historical 008 checksum is repairable
  - historical 008 checksum canonicalization is atomic with successful 011 repair
  - representable historical task rows and their latest successful turn link are preserved
  - non-task or ambiguous historical rows become no active task instead of invented context
  - canonical 008 databases accept 011 as a no-op
  - migration reruns are idempotent on historical and clean databases
  - the current local development database migrates and the affected database-backed suite passes
approvals:
  - local code, tests, disposable PostgreSQL, and migration of the configured local development database are in scope
  - no push, deployment, production mutation, or real Provider call
verification:
  focused:
    - node --test --test-name-pattern="migration 009|historical 008|migration 011" tests/migration-integration.test.ts
  stage_exit:
    - node --test tests/migration-integration.test.ts tests/readiness.test.ts tests/provider-deployment-contract.test.ts
    - npm run typecheck
    - npm test
review:
  shape: split
  correction_budget: 3
knowledge_impact:
  - docs/portfolio-blueprint.md
  - docs/verify/admin-api/editable-provider-takeover-closeout.md
```

## Resume Pointer

Current stage and state: `CLOSE / PRODUCTION_OBSERVED / KNOWLEDGE_RECONCILED`.

Last completed verified step: release `c2d575c` was pushed and deployed; production backup and controlled write quiescence preceded migrations `009-011`, grants and runtime permission verification passed, the registry is `001-011`, all five containers are healthy, public checks and release smoke passed, and post-Web-start error/5xx counts are zero.

Exact next action: none for migration-chain repair; authenticated Environment Provider takeover/testing remains an explicit administrator observation, not part of this no-Provider deployment.
