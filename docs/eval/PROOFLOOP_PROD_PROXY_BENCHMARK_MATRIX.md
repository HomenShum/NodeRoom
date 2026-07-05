# ProofLoop Prod Proxy Benchmark Matrix

Generated: 2026-07-05T20:36:56.832Z
Base URL: https://noderoom.live
Production HTML: https://noderoom.live/eval/proofloop-prod-proxy-benchmark-matrix.html
Production JSON: https://noderoom.live/eval/proofloop-prod-proxy-benchmark-matrix.json

This is the execution matrix for the real prod-browser goal. It keeps the full task denominator visible and refuses to collapse the run into the existing 3-task external-adapter smoke.

## Summary

- Unique task targets: 1354
- Models in matrix: 4
- Model-task attempt targets: 5416
- Prod live-browser verified task targets: 4
- Local live-browser only task targets: 101
- Runnable prod-browser task targets today: 1354
- Blocked task targets needing a browser adapter: 0
- Prod live-browser passed attempts recorded: 10
- All tasks prod verified: no

## Recommendation

- All-task winner: none yet
- Current prod adapter-smoke winner: poolside/laguna-xs-2.1
- Basis: No all-task model winner is claimed until every tracked task target is run through the prod browser matrix. Current winner is limited to the completed external-adapter prod smoke.

## Models

| Model | Prod adapter smoke | Est. OpenRouter list cost | UI measured cost | Avg duration |
|---|---:|---:|---:|---:|
| `z-ai/glm-5.2` | 3/3 | $0.2454 | $0.2450 | 129s |
| `deepseek/deepseek-v4-flash` | 1/3 | $0.0683 | $0.0690 | 476s |
| `poolside/laguna-xs-2.1` | 3/3 | $0.0326 | $0.0330 | 107s |
| `qwen/qwen3.7-plus` | 3/3 | $0.1994 | $0.1990 | 191s |

## Families

| Family | Tasks | Prod passed | Local only | Runnable now | Blocked |
|---|---:|---:|---:|---:|---:|
| `spreadsheetbench-v1-full-912` | 912 | 0 | 1 | 912 | 0 |
| `spreadsheetbench-v2-full-321` | 321 | 0 | 0 | 321 | 0 |
| `bankertoolbench-full-100` | 100 | 0 | 100 | 100 | 0 |
| `accounting-live-proofloop` | 4 | 0 | 0 | 4 | 0 |
| `notion-live-proofloop` | 4 | 0 | 0 | 4 | 0 |
| `proximitty-underwriting-pr0` | 4 | 0 | 0 | 4 | 0 |
| `finch-prod-proxy-task` | 1 | 1 | 0 | 1 | 0 |
| `finauditing-prod-proxy-task` | 1 | 1 | 0 | 1 | 0 |
| `workstreambench-prod-proxy-task` | 1 | 1 | 0 | 1 | 0 |
| `noderoom-multi-user-conflict` | 6 | 1 | 0 | 6 | 0 |

## Not Done

- spreadsheetbench-v1-full-912: 912 task target(s) still lack prod live-browser proof. First blocker: Existing SpreadsheetBench receipt is local live-browser only; rerun against https://noderoom.live.
- spreadsheetbench-v2-full-321: 321 task target(s) still lack prod live-browser proof. First blocker: SpreadsheetBench task is ready for the generic prod browser workbook adapter but lacks a passing prod receipt.
- bankertoolbench-full-100: 100 task target(s) still lack prod live-browser proof. First blocker: Existing BTB receipt is local live-browser only; rerun against https://noderoom.live.
- accounting-live-proofloop: 4 task target(s) still lack prod live-browser proof. First blocker: Committed receipt docs/eval/proofloop-live-accounting-free-smoke.json must set officialScoreClaim:false before it can count as proxy proof.
- notion-live-proofloop: 4 task target(s) still lack prod live-browser proof. First blocker: Notion live proof-loop has no passing prod live-browser receipt for this task/model yet.
- proximitty-underwriting-pr0: 4 task target(s) still lack prod live-browser proof. First blocker: model_route_mismatch: route_integrity=model_route_mismatch; requested=qwen/qwen3-coder:free; actual=z-ai/glm-4.7-flash; cost=$0.0120; failures=model_route_mismatch,free_route_used_paid_model,free_route_billed_nonzero_cost.
- noderoom-multi-user-conflict: 5 task target(s) still lack prod live-browser proof. First blocker: Multi-user conflict has a prod browser adapter, but no passing prod live-browser receipt is recorded for this task/model yet.

## Runnable Command Shapes

- `BENCH_BASE_URL=https://noderoom.live PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 SPREADSHEETBENCH_TRACK=spreadsheetbench-v1 SPREADSHEETBENCH_STAGE_ROOT=.tmp/official-benchmarks/staged-v1-912 SPREADSHEETBENCH_TASK_ID=102-20 BENCH_AGENT_MODEL_MODE=specific BENCH_AGENT_MODEL_POLICY=z-ai/glm-5.2 PROOFLOOP_REAL_USER_MODE=1 PROOFLOOP_NODEAGENT_RUNTIME_PROFILE= npm run proofloop:live:spreadsheetbench-v1`
- `BENCH_BASE_URL=https://noderoom.live PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 SPREADSHEETBENCH_TRACK=spreadsheetbench-v2 SPREADSHEETBENCH_STAGE_ROOT=.tmp/official-benchmarks/staged-v2-full SPREADSHEETBENCH_TASK_ID=Debugging/01_01 BENCH_AGENT_MODEL_MODE=specific BENCH_AGENT_MODEL_POLICY=z-ai/glm-5.2 PROOFLOOP_REAL_USER_MODE=1 PROOFLOOP_NODEAGENT_RUNTIME_PROFILE= npm run proofloop:live:spreadsheetbench-v2`
- `BENCH_BASE_URL=https://noderoom.live PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 BTB_LIVE_ROOM_E2E=1 BTB_UI_BUNDLE_ROOT=.tmp/official-benchmarks/bankertoolbench-repo/btb-data BTB_UI_TASK_ID=707cba99-59a7-47bd-bc4d-7f36212e99f3 BENCH_AGENT_MODEL_MODE=specific BENCH_AGENT_MODEL_POLICY=z-ai/glm-5.2 npm run proofloop:live:btb`
- `BENCH_BASE_URL=https://noderoom.live PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 PROOFLOOP_TASKS_JSON=proofloop/accounting/live.accounting.config.json PROOFLOOP_TASK_IDS=variance-calc PROOFLOOP_REAL_USER_MODE=1 PROOFLOOP_FOCUS_MODE=0 PROOFLOOP_NODEAGENT_RUNTIME_PROFILE= npm run proofloop:live:accounting:browser`
- `BENCH_BASE_URL=https://noderoom.live PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 PROOFLOOP_TASKS_JSON=proofloop/notion/live.notion.config.json PROOFLOOP_TASK_IDS=company-research PROOFLOOP_REAL_USER_MODE=1 PROOFLOOP_FOCUS_MODE=0 PROOFLOOP_NODEAGENT_RUNTIME_PROFILE= npm run proofloop:live:notion:browser`
- `BENCH_BASE_URL=https://noderoom.live PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 PROOFLOOP_TASK_IDS=proximitty-intake PROOFLOOP_REAL_USER_MODE=1 PROOFLOOP_FOCUS_MODE=0 PROOFLOOP_NODEAGENT_RUNTIME_PROFILE= npm run proofloop:proximitty:browser`

