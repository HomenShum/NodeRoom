# ProofLoop Full Proxy Benchmark Sweep

Generated: 2026-07-05T01:19:04.062Z
Base URL required for prod proof: https://noderoom.live

This report is the no-shortcut ledger for adapting every tracked benchmark family to the live browser UI. It does not convert staged/offline evidence into prod live-browser proof.

## Summary

- Families tracked: 11
- Unique proxy task targets: 1354
- Official coverage ledger declared targets, including overlapping subsets/internal tracks: 1739
- Staged task targets: 1354
- Prod live-browser verified task targets: 3
- Local live-browser verified task targets: 105
- Official scored task targets: 100
- Full prod live-browser coverage ready: no

## Model Recommendation

- Status: current_prod_proxy_winner
- Current model: poolside/laguna-xs-2.1
- Basis: Cheapest model with 100% pass rate on the current prod live-browser external-adapter proxy sweep; not yet proven across SpreadsheetBench/BTB/accounting/Notion/Proximitty full task families.

| Model | Passes | Est. OpenRouter list cost | UI measured cost | Avg duration |
|---|---:|---:|---:|---:|
| `poolside/laguna-xs-2.1` | 3/3 | $0.0326 | $0.0330 | 107s |
| `qwen/qwen3.7-plus` | 3/3 | $0.1994 | $0.1990 | 191s |
| `z-ai/glm-5.2` | 3/3 | $0.2454 | $0.2450 | 129s |

## Families

| Family | Status | Targets | Staged | Prod browser | Local browser | Model cases | Official scored | Next blocker |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `spreadsheetbench-v1-full-912` | staged_not_prod_browser_run | 912 | 912 | 0 | 1 | 0/0 | 0 | Run all 912 tasks through the model runner or an approved chunked official-policy runner before claiming a model score. |
| `spreadsheetbench-v1-verified-400` | staged_not_prod_browser_run | 400 overlap | 400 | 0 | 1 | 3/15 | 0 | 397 verified task(s) still need model-run evidence; current N=5 smoke covers 3/400 cases. |
| `spreadsheetbench-v2-full-321` | staged_not_prod_browser_run | 321 | 321 | 0 | 0 | 3/3 | 0 | Run every staged V2 task through the model runner, static workbook scorer, and rendered/VLM chart grader where applicable. |
| `bankertoolbench-full-100` | official_scored_not_prod_browser | 100 | 100 | 0 | 100 | 100/100 | 100 | Existing BTB full-suite evidence is not a prod noderoom.live model matrix; prod receipts found 0/100. |
| `accounting-live-proofloop` | ready_to_run | 4 | 4 | 0 | 0 | 0/0 | 0 | Current live accounting runner uses Convex HTTP, not a browser-driven prod room model matrix. |
| `notion-live-proofloop` | ready_to_run | 4 | 4 | 0 | 0 | 0/0 | 0 | Current live Notion runner uses Convex HTTP, not a browser-driven prod room model matrix. |
| `proximitty-underwriting-pr0` | local_live_browser_verified | 4 | 4 | 0 | 4 | 0/0 | 0 | Latest Proximitty proof is deterministic/local; it is not a prod noderoom.live model matrix. |
| `finch-prod-proxy-task` | prod_live_browser_verified | 1 | 1 | 1 | 0 | 3/4 | 0 | none |
| `finauditing-prod-proxy-task` | prod_live_browser_verified | 1 | 1 | 1 | 0 | 4/4 | 0 | none |
| `workstreambench-prod-proxy-task` | prod_live_browser_verified | 1 | 1 | 1 | 0 | 3/4 | 0 | none |
| `noderoom-multi-user-conflict` | staged_not_prod_browser_run | 6 | 6 | 0 | 0 | 0/0 | 0 | none |

## Detail

### SpreadsheetBench V1 full benchmark

- Status: staged_not_prod_browser_run
- Task target: 912 (official published task count)
- Counted in unique total: yes
- Evidence: `docs/eval/spreadsheetbench-v1-912-stage.json`, `docs/eval/spreadsheetbench-v1-912-copy-input-baseline.json`, `docs/eval/official-benchmark-readiness.json`, `docs/eval/spreadsheetbench-live-room-proof.json`
- Commands: `npm run benchmark:spreadsheetbench:run-chunked`, `npm run benchmark:spreadsheetbench:score`, `npm run benchmark:official:ui-coverage`
- Blockers: Run all 912 tasks through the model runner or an approved chunked official-policy runner before claiming a model score.; No spreadsheetbench-v1-full-912 receipt proves every task through a fresh prod browser room on noderoom.live.

### SpreadsheetBench Verified 400 subset

- Status: staged_not_prod_browser_run
- Task target: 400 (overlapping verified SpreadsheetBench V1 subset)
- Counted in unique total: no
- Evidence: `docs/eval/spreadsheetbench-v1-full-stage-smoke.json`, `docs/eval/spreadsheetbench-v1-copy-input-full-smoke.json`, `docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json`, `docs/eval/spreadsheetbench-live-room-proof.json`
- Commands: `npm run benchmark:spreadsheetbench:run-chunked`, `npm run benchmark:spreadsheetbench:score`, `npm run benchmark:official:ui-coverage`
- Blockers: 397 verified task(s) still need model-run evidence; current N=5 smoke covers 3/400 cases.; Full verified-score promotion still needs official scoring parity, not only local workbook scoring.; No spreadsheetbench-v1-verified-400 receipt proves every task through a fresh prod browser room on noderoom.live.

### SpreadsheetBench 2 full workflow benchmark

- Status: staged_not_prod_browser_run
- Task target: 321 (official published task count)
- Counted in unique total: yes
- Evidence: `docs/eval/spreadsheetbench-v2-full-ingest.json`, `docs/eval/spreadsheetbench-v2-full-stage.json`, `docs/eval/spreadsheetbench-v2-stage-smoke.json`, `docs/eval/spreadsheetbench-v2-run-smoke.json`, `docs/eval/spreadsheetbench-chart-visual-probe.json`, `docs/eval/spreadsheetbench-live-room-proof.json`
- Commands: `npm run benchmark:spreadsheetbench:run-chunked`, `npm run benchmark:spreadsheetbench:score`, `npm run benchmark:official:ui-coverage`
- Blockers: Run every staged V2 task through the model runner, static workbook scorer, and rendered/VLM chart grader where applicable.; No spreadsheetbench-v2-full-321 receipt proves every task through a fresh prod browser room on noderoom.live.

### BankerToolBench full investment-banking benchmark

- Status: official_scored_not_prod_browser
- Task target: 100 (official BankerToolBench task count)
- Counted in unique total: yes
- Evidence: `docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json`, `docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json`, `docs/eval/bankertoolbench-stage-smoke.json`, `docs/eval/bankertoolbench-run-positive-smoke.json`, `docs/eval/bankertoolbench-official-contract.json`, `docs/eval/fresh-room/FR-020/tasks`, `docs/eval/bankertoolbench/live-room`
- Commands: `npm run proofloop:live:btb`, `npm run benchmark:bankertoolbench:livesuite-gate -- --write --assert`, `npm run benchmark:bankertoolbench:fullsuite-gate`
- Blockers: Existing BTB full-suite evidence is not a prod noderoom.live model matrix; prod receipts found 0/100.

### Accounting live proof-loop

- Status: ready_to_run
- Task target: 4 (configured live accounting product tasks)
- Counted in unique total: yes
- Evidence: `proofloop/accounting/live.accounting.config.json`, `proofloop/accounting/benchmarks/benchmark-registry.json`
- Commands: `npm run proofloop:live:accounting`
- Blockers: Current live accounting runner uses Convex HTTP, not a browser-driven prod room model matrix.

### Notion SDR/BDR live proof-loop

- Status: ready_to_run
- Task target: 4 (configured live Notion/SDR product tasks)
- Counted in unique total: yes
- Evidence: `proofloop/notion/live.notion.config.json`
- Commands: `npm run proofloop:live:notion`
- Blockers: Current live Notion runner uses Convex HTTP, not a browser-driven prod room model matrix.

### Proximitty underwriting PR0

- Status: local_live_browser_verified
- Task target: 4 (configured underwriting proof-loop scenarios)
- Counted in unique total: yes
- Evidence: `proofloop/suites/proximitty-underwriting-pr0.json`, `.proofloop/runs/latest/run-result.json`
- Commands: `npm run proofloop:proximitty`
- Blockers: Latest Proximitty proof is deterministic/local; it is not a prod noderoom.live model matrix.

### finch prod live-browser proxy task

- Status: prod_live_browser_verified
- Task target: 1 (local live-browser proxy task count, not upstream official task count)
- Counted in unique total: yes
- Evidence: `proofloop/benchmarks/finch/adapter.json`, `docs/eval/proofloop-external-adapter-live-room-runs/finch.json`, `docs/eval/proofloop-proxy-model-sweep.json`
- Commands: `npm run benchmark:proofloop:external-adapter-live-room -- --prod --id finch --real-user`
- Blockers: none

### finauditing prod live-browser proxy task

- Status: prod_live_browser_verified
- Task target: 1 (local live-browser proxy task count, not upstream official task count)
- Counted in unique total: yes
- Evidence: `proofloop/benchmarks/finauditing/adapter.json`, `docs/eval/proofloop-external-adapter-live-room-runs/finauditing.json`, `docs/eval/proofloop-proxy-model-sweep.json`
- Commands: `npm run benchmark:proofloop:external-adapter-live-room -- --prod --id finauditing --real-user`
- Blockers: none

### workstreambench prod live-browser proxy task

- Status: prod_live_browser_verified
- Task target: 1 (local live-browser proxy task count, not upstream official task count)
- Counted in unique total: yes
- Evidence: `proofloop/benchmarks/workstreambench/adapter.json`, `docs/eval/proofloop-external-adapter-live-room-runs/workstreambench.json`, `docs/eval/proofloop-proxy-model-sweep.json`
- Commands: `npm run benchmark:proofloop:external-adapter-live-room -- --prod --id workstreambench --real-user`
- Blockers: none

### NodeRoom multi-user conflict suite

- Status: staged_not_prod_browser_run
- Task target: 6 (internal deterministic NodeRoom conflict scenarios)
- Counted in unique total: yes
- Evidence: `docs/eval/multi-user-coordination-proof.json`, `evals/multiUserCoordinationProof.ts`
- Commands: `npm run eval:multiuser-coordination -- --strict`
- Blockers: none

