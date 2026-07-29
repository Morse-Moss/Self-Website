# Pointer Envelope: NIGHT_STABILITY_20260730 / SOAK_CLOSEOUT

Task: `docs/task-center/night-stability-2026-07-30/task.md`

Next pointer: `CLOSEOUT`

```yaml
stage: night-stability-soak-closeout
outcome: production remains healthy without new calls for at least 60 minutes, test resources are removed and tomorrow's promotion decision is evidence-backed
controls:
  execution: GOAL
  risk: CRITICAL
  delivery: DEPLOYED
state: CONTRACT
preset: null
goal_state_ref: docs/task-center/night-stability-2026-07-30/
scope:
  owned:
    - read-only production health, logs and bounded test aggregates
    - dedicated invite and test Session cleanup
    - scoped production receipt and authority reconciliation
  forbidden:
    - deletion of unrelated data, releases, archives or worktrees
  unrelated_or_unknown:
    - all non-test production traffic
dod:
  - at least 60 minutes pass with stable live/ready, five healthy zero-restart containers and no fresh 5xx or fatal errors
  - Provider attempt and terminal turn totals remain stable after the final test wave
  - dedicated invite is inactive and every dedicated access Session is removed
  - release smoke passes after cleanup
  - production receipt states PROMOTION_READY, PROMOTION_LIMITED or PROMOTION_BLOCKED with residual risks
approvals:
  - reuse NIGHT-DATA-01 and NIGHT-DELIVERY-01 within their original bounds
verification:
  focused:
    - periodic public and remote read-only snapshots
  stage_exit:
    - post-cleanup release smoke, Git identity and production pointer checks
  real_observation:
    - at least 60-minute no-request soak
review:
  shape: split
  correction_budget: 3
knowledge_impact:
  - production receipt
  - task center, blueprint and runbooks only if current truth changes
non_goals:
  - 24-hour statistical SLA claim
```
