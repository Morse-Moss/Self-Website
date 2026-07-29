# Pointer Envelope: NIGHT_STABILITY_20260730 / RESILIENCE

Task: `docs/task-center/night-stability-2026-07-30/task.md`

Next pointer: `NIGHT_STABILITY_20260730 / SOAK_CLOSEOUT`

```yaml
stage: night-stability-resilience
outcome: bounded cross-Session concurrency and one client disconnect recover without duplicate answers, charges, task drift or service instability
controls:
  execution: GOAL
  risk: CRITICAL
  delivery: DEPLOYED
state: CONTRACT
preset: null
goal_state_ref: docs/task-center/night-stability-2026-07-30/
scope:
  owned:
    - three existing isolated test Sessions
    - one controlled client disconnect and same-turn recovery observation
  forbidden:
    - same-Session parallel mutation
    - more than three concurrent requests
    - Provider fault injection or production configuration changes
  unrelated_or_unknown:
    - real visitor traffic and unrelated production records
dod:
  - three concurrent cross-Session turns finish or fail with their documented public contract
  - no Session receives another Session's conversation, Task, evidence or answer state
  - one disconnected request reaches a single durable terminal state and does not create duplicate completed attempts
  - subsequent normal requests remain healthy
approvals:
  - reuse NIGHT-PAID-01, NIGHT-DATA-01 and NIGHT-DELIVERY-01 within their original bounds
verification:
  focused:
    - per-turn attempt and durable terminal-state inspection
  stage_exit:
    - health, restart, error and 5xx gates after resilience probes
  real_observation:
    - one three-way concurrency wave and one disconnect recovery
review:
  shape: split
  correction_budget: 3
knowledge_impact:
  - append-only stability progress receipt
non_goals:
  - upstream Provider outage simulation
  - rate-limit exhaustion
```
