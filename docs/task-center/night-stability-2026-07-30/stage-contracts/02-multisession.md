# Pointer Envelope: NIGHT_STABILITY_20260730 / MULTISESSION

Task: `docs/task-center/night-stability-2026-07-30/task.md`

Next pointer: `NIGHT_STABILITY_20260730 / RESILIENCE`

```yaml
stage: night-stability-multisession
outcome: independent public API Sessions preserve answer quality and isolation across varied recruiter phrasing and long follow-up chains
controls:
  execution: GOAL
  risk: CRITICAL
  delivery: DEPLOYED
state: CONTRACT
preset: null
goal_state_ref: docs/task-center/night-stability-2026-07-30/
scope:
  owned:
    - the dedicated invite and up to five additional isolated test Sessions
    - E:/RevolutionDeploy/night-stability-* temporary harnesses
  forbidden:
    - unrelated Sessions, production configuration and all baseline non-goals
  unrelated_or_unknown:
    - root untracked files and other worktrees
dod:
  - at least three independent Sessions complete distinct natural-language HR chains
  - at least 24 additional Provider-backed turns pass relevance, safety, Task/JD/evidence and attempt gates
  - no cross-Session conversation, Task, answer or evidence leakage is observed
  - one chain reaches at least 18 completed turns without drift or history truncation
approvals:
  - reuse NIGHT-PAID-01, NIGHT-DATA-01 and NIGHT-DELIVERY-01 within their original bounds
verification:
  focused:
    - per-turn SSE, answer rubric and bounded metadata gates
  stage_exit:
    - aggregate Session, turn, attempt, error and latency distribution checks
  real_observation:
    - three or more real isolated Sessions
review:
  shape: split
  correction_budget: 3
knowledge_impact:
  - append-only stability progress receipt
non_goals:
  - benchmark throughput or denial-of-service behavior
```
