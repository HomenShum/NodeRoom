# ProofLoop Standalone Runner Dogfood

Generated: 2026-07-05T19:48:29.628Z
Plan ID: `proofloop-standalone-runner-dogfood-2026-07-05T19-48-29-628Z`
Schema: `proofloop-runner-plan-v1`
Mode: `two-layer-certification-v1`

This file is the NodeRoom handoff for dogfooding the standalone ProofLoop durable runner on the not-done proxy and benchmark work. It keeps the existing prod proxy long-run queue and external adapter blocker receipts, then adds the two-layer split recommended for long-running proof work.

No paid model sweeps were run to generate this plan. The plan references the standalone package interface and does not vendor ProofLoop into NodeRoom.

Registry note: until the package release with the two-layer `this-repo --write-runner-plan` path is published, this dogfood plan uses `npx --yes github:HomenShum/proofloop` so the command resolves to the merged main branch.

## Run Or Resume

- Generate/refresh plan: `npm run benchmark:proofloop:standalone-runner-plan -- --budget-usd 100`
- Run with standalone runner: `npx --yes github:HomenShum/proofloop runner run --plan docs/eval/proofloop-two-layer-certification-runner-plan.json --budget-usd 100`
- Resume: rerun `npx --yes github:HomenShum/proofloop runner resume --run-id latest`; task IDs and evidence paths are stable for this plan file.
- Local long-run status: `npm run benchmark:proofloop:prod-proxy-longrun -- status`
- Local guarded live-attempt resume: `npm run benchmark:proofloop:prod-proxy-longrun -- resume --allow-spend --budget-usd 100 --max-attempts 1`

## Two-Layer Contract

- Capability/headless lane runs harnesses, denominator refreshes, readiness ledgers, free-model planning, and deterministic multi-user checks without forcing every benchmark row through the browser.
- Browser/UI certification lane runs the real prod UI with memory mode off and verifier receipts for product responsiveness, room creation/join flows, and representative benchmark adapters.
- Official-scoring lane remains separate: proxy proof cannot be relabeled as an official benchmark score without the upstream scorer or judge contract.
- Browser required for every capability task: false

## Summary

- Runner tasks: 19
- Capability/headless tasks: 7
- Browser-certification tasks: 9
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

| ID | Layer | Kind | Status | Scope | Attempts | Est. product spend |
|---|---|---|---|---|---:|---:|
| `capability.official-readiness-ledger` | capability-headless | capability-headless | ready | repo | 0 | $0.00 |
| `capability.prod-proxy-denominator` | capability-headless | capability-headless | ready | repo | 0 | $0.00 |
| `capability.prod-browser-adapters` | capability-headless | capability-headless | ready | repo | 0 | $0.00 |
| `capability.free-openrouter-longrun-plan` | capability-headless | capability-headless | ready | repo | 0 | $0.00 |
| `capability.accounting-proofloop` | capability-headless | capability-headless | ready | repo | 0 | $0.00 |
| `capability.notion-proofloop` | capability-headless | capability-headless | ready | repo | 0 | $0.00 |
| `capability.multi-user-coordination` | capability-headless | capability-headless | ready | repo | 0 | $0.00 |
| `live-run.accounting-live-proofloop` | browser-certification | guarded-live-run-batch | guarded-spend | accounting-live-proofloop | 12 | $0.401912 |
| `live-run.bankertoolbench-full-100` | browser-certification | guarded-live-run-batch | guarded-spend | bankertoolbench-full-100 | 300 | $10.0478 |
| `live-run.finch-prod-proxy-task` | browser-certification | guarded-live-run-batch | guarded-spend | finch-prod-proxy-task | 1 | $0.023 |
| `live-run.noderoom-multi-user-conflict` | browser-certification | guarded-live-run-batch | guarded-spend | noderoom-multi-user-conflict | 18 | $0.602868 |
| `live-run.notion-live-proofloop` | browser-certification | guarded-live-run-batch | guarded-spend | notion-live-proofloop | 12 | $0.401912 |
| `live-run.proximitty-underwriting-pr0` | browser-certification | guarded-live-run-batch | guarded-spend | proximitty-underwriting-pr0 | 12 | $0.401912 |
| `live-run.spreadsheetbench-v1-full-912` | browser-certification | guarded-live-run-batch | guarded-spend | spreadsheetbench-v1-full-912 | 2518 | $77.143732 |
| `live-run.spreadsheetbench-v2-full-321` | browser-certification | guarded-live-run-batch | guarded-spend | spreadsheetbench-v2-full-321 | 642 | $10.914 |
| `live-run.workstreambench-prod-proxy-task` | browser-certification | guarded-live-run-batch | guarded-spend | workstreambench-prod-proxy-task | 1 | $0.023 |
| `official-score.finauditing` | official-scoring | official-score-gap | blocked-external | finauditing | 0 | $0.00 |
| `official-score.finch` | official-scoring | official-score-gap | blocked-external | finch | 0 | $0.00 |
| `official-score.workstreambench` | official-scoring | official-score-gap | blocked-external | workstreambench | 0 | $0.00 |

## Guardrails

- Keep certification-loop assets locked; adapter repair work must not weaken verifiers or immutable fixtures.
- Keep memory mode off for prod proxy attempts and require receipt evidence before promoting a pass.
- Do not claim an all-task model winner until every tracked task target has prod live-browser proof.
- Official benchmark scores require imported upstream scorer or judge receipts; proxy receipts are labeled as proxy proof only.
