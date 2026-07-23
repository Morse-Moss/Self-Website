# Digital Morse Chat v2 real Provider review

> Date: 2026-07-23
> Mode: `CEO / STAGED / CRITICAL / DEPLOYED`
> Scope: fixed 20-case review plus failed-case targeted regression
> Rollout: canary remained `0`; hedging remained disabled

## Baseline Result

- The original fixed review remains recorded as `15/20`; targeted regressions do not rewrite that score.
- Failed cases were Q4, Q7, Q11, Q17, and Q20.
- No privacy disclosure, fabricated scale experience, missing-JD conclusion, or conversation-to-RAG zero-tolerance violation was observed.

## Corrections

- Q4: the conversation guard now requires an explicit opinion topic to be addressed in the opening paragraph.
- Q7: anaphoric project retrieval now combines the persisted project topic with the current follow-up.
- Q11: internal evidence labels are forbidden in user-visible text and personal-history boundaries use natural first-person language.
- Q17: direct capability answers must name at least one supporting public project.
- Q20: JD evidence combines semantic retrieval with ledger-backed capability sources, requires every recognized capability to be addressed, and keeps Kubernetes at the transferable boundary.
- JD generation now uses `low` reasoning and requests an 800-900-character answer. Complete-answer guarding remains enabled.
- Short ASCII capability aliases use token boundaries, preventing text such as `server agent` from being misread as `RAG`.

## Targeted Real Regression

| Case | Result | Total latency | Sources | Provider outcome |
|---|---:|---:|---:|---|
| Q4 | PASS | 7.58 s | 0 | primary completed |
| Q7 | PASS | 11.93 s | 4 | primary completed |
| Q11 | PASS | 5.34 s | 0 | primary completed |
| Q16 boundary companion | PASS | 5.10 s | not retained | primary completed |
| Q17 | PASS | 4.00 s | not retained | primary completed |
| Q20 | PASS | 35.37 s | 6 | primary completed |

- Each failed follow-up was tested with one fresh predecessor control turn; only the failed case was adjudicated.
- Q4 directly addressed reliability rather than repeating the previous Agent-value answer.
- Q7 inherited the `digital-morse` topic, returned four admitted sources, and gave one consistent design rationale.
- Q11 stated that specific past conflict history could not be confirmed, then answered naturally without `none`, `direct`, `transferable`, scores, or audit-template fields.
- Q17 named public supporting projects. Q20 covered RAG, PostgreSQL, Docker Compose, and the Kubernetes evidence boundary.
- The local review session contains 29 turns and 33 Provider attempts in total, including the original review, predecessor controls, targeted regressions, and rejected candidates. Of these attempts, 24 completed and 9 failed. This stayed below the previously authorized 80-attempt bound.

## Performance Finding

- In the three final regressions, first protocol events arrived at 6.44 s, 7.10 s, and 4.58 s. Most visible wait therefore occurred before model output reached the application, not in database persistence or frontend rendering.
- Q7 additionally paid the expected embedding/retrieval cost. Q20 remained the slowest because complete release waits for the fully guarded JD candidate.
- The new JD `low` reasoning and concise-output contract passed focused integration tests. The real Q20 call was not repeated after that tuning, per the instruction not to rerun the completed review.

## Verification And Boundaries

- Related route, evidence, persona, output-guard, and answer-runner tests: 84/84 PASS before review correction; the short-alias correction then passed 70/70 focused tests.
- Related service integration: 18/18 PASS after the final correction.
- `npm run build`: PASS; TypeScript and all 30 Next.js routes completed.
- `git diff --check`: PASS. Secret-like diff scan found zero Provider keys, bearer credentials, or configured relay domains.
- This document stores no raw prompt, answer, Cookie, invite token, Provider key, Provider URL, private resume content, or Provider payload.
- Production remained on the prior release during review. Canary expansion and hedging are not part of this milestone.
