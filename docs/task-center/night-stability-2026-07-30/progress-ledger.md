# Night Stability Progress Ledger

- `2026-07-30T00:18:00+08:00` INTAKE: user authorized real production stability testing for tomorrow's promotion decision.
- `2026-07-30T00:20:00+08:00` CHALLENGE `READY_TO_CONTRACT`: isolate public API Sessions with independent cookie jars; bind production evidence to the dedicated invite ID; cap concurrency at three across Sessions; do not infer behavior from health alone.
- `2026-07-30T00:26:00+08:00` BASELINE PREFLIGHT PASS: public live/ready and release smoke passed; production pointer and Web/Worker images matched `d223afe`; five containers were healthy with zero restarts; recent Web/Worker/Edge/DB error count and Edge 5xx count were zero; no turn was running.
- `2026-07-30T00:31:00+08:00` CONTROL RECOVERY `NS-CONTROL-001`: removed two zero-use orphan test invites under an exact guarded transaction. No Session or Provider call existed. Continued with a single-process protected-data design.
- `2026-07-30T00:37:00+08:00` BASELINE STOP `NS-HARNESS-002`: corrected the entry-turn attempt contract; cleaned the dedicated invite and Session.
- `2026-07-30T00:39:00+08:00` BASELINE STOP `NS-HARNESS-003`: corrected workflow/conversation ownership to match the production UI contract; cleaned the dedicated invite and Session.
- `2026-07-30T00:42:00+08:00` BASELINE STOP `NS-HARNESS-004`: removed the arbitrary answer-length quality proxy while retaining relevance and safety gates; cleaned the dedicated invite and Session.
- `2026-07-30T00:44:00+08:00` BASELINE PRODUCT STOP `NS-PRODUCT-005`: isolated one natural recruiter evidence request that failed to continue the active JD Task. The valid turn completed with one winner attempt, then the gate stopped and cleanup completed.
- `2026-07-30T01:00:00+08:00` CORRECTION 1 LOCAL PASS: expanded only the existing adjacent recruiter-evaluation grounded-route allowance. A synthetic equivalent regression failed under the old condition and passed under the correction; affected checks, `chat:eval 111/111`, typecheck, full `1262/1262` suite and 33-route build passed. Production remains `d223afe` until the scoped release completes.
