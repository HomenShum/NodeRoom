# ProofLoop Standalone Runner Dogfood

Generated: 2026-07-05T08:11:53.101Z
Plan ID: `proofloop-standalone-runner-dogfood-2026-07-05T08-11-53-101Z`
Schema: `proofloop-runner-plan-v1`

This file is the NodeRoom handoff for dogfooding the standalone ProofLoop durable runner on the not-done proxy and benchmark work. It is generated from the existing prod proxy long-run queue and external adapter blocker receipts.

No paid model sweeps were run to generate this plan. The plan references the merged standalone package interface and does not vendor ProofLoop into NodeRoom.

Registry note: npm `proofloop@0.2.0` predates the durable runner. Until the package is published with a runner-capable version, this dogfood plan uses `npx --yes github:HomenShum/proofloop` so the command resolves to the merged main branch.

## Run Or Resume

- Generate/refresh plan: `npm run benchmark:proofloop:standalone-runner-plan -- --budget-usd 100`
- Run with standalone runner: `npx --yes github:HomenShum/proofloop runner run --plan docs/eval/proofloop-standalone-runner-dogfood-plan.json --budget-usd 100`
- Resume: rerun `npx --yes github:HomenShum/proofloop runner resume --run-id latest`; task IDs and evidence paths are stable for this plan file.
- Local long-run status: `npm run benchmark:proofloop:prod-proxy-longrun -- status`
- Local guarded live-attempt resume: `npm run benchmark:proofloop:prod-proxy-longrun -- resume --allow-spend --budget-usd 100 --max-attempts 1`

## Summary

- Runner tasks: 12
- Adapter-gap tasks: 0
- Guarded live-run batch tasks: 9
- Official-score gap tasks: 3
- Unique task targets: 1354
- Model-task attempts: 5416
- Queued runnable attempts: 3516
- Blocked adapter attempts: 0
- Queued product spend estimate: $99.960136
- Full current-model matrix estimate: $246.812536
- All-task winner: none
- Current adapter-smoke winner: poolside/laguna-xs-2.1

## Tasks

| ID | Kind | Status | Scope | Attempts | Est. product spend |
|---|---|---|---|---:|---:|
| `live-run.accounting-live-proofloop` | guarded-live-run-batch | guarded-spend | accounting-live-proofloop | 12 | $0.401912 |
| `live-run.bankertoolbench-full-100` | guarded-live-run-batch | guarded-spend | bankertoolbench-full-100 | 300 | $10.0478 |
| `live-run.finch-prod-proxy-task` | guarded-live-run-batch | guarded-spend | finch-prod-proxy-task | 1 | $0.023 |
| `live-run.noderoom-multi-user-conflict` | guarded-live-run-batch | guarded-spend | noderoom-multi-user-conflict | 18 | $0.602868 |
| `live-run.notion-live-proofloop` | guarded-live-run-batch | guarded-spend | notion-live-proofloop | 12 | $0.401912 |
| `live-run.proximitty-underwriting-pr0` | guarded-live-run-batch | guarded-spend | proximitty-underwriting-pr0 | 12 | $0.401912 |
| `live-run.spreadsheetbench-v1-full-912` | guarded-live-run-batch | guarded-spend | spreadsheetbench-v1-full-912 | 2518 | $77.143732 |
| `live-run.spreadsheetbench-v2-full-321` | guarded-live-run-batch | guarded-spend | spreadsheetbench-v2-full-321 | 642 | $10.914 |
| `live-run.workstreambench-prod-proxy-task` | guarded-live-run-batch | guarded-spend | workstreambench-prod-proxy-task | 1 | $0.023 |
| `official-score.finauditing` | official-score-gap | blocked-external | finauditing | 0 | $0.00 |
| `official-score.finch` | official-score-gap | blocked-external | finch | 0 | $0.00 |
| `official-score.workstreambench` | official-score-gap | blocked-external | workstreambench | 0 | $0.00 |

## Guardrails

- Keep certification-loop assets locked; adapter repair work must not weaken verifiers or immutable fixtures.
- Keep memory mode off for prod proxy attempts and require receipt evidence before promoting a pass.
- Do not claim an all-task model winner until every tracked task target has prod live-browser proof.
- Official benchmark scores require imported upstream scorer or judge receipts; proxy receipts are labeled as proxy proof only.
