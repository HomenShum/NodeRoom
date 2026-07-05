# ProofLoop Prod Proxy Long-Run Plan

Generated: 2026-07-05T04:29:50.942Z
Run ID: `prod-proxy-longrun-2026-07-05T04-29-50-942Z`
Base URL: https://noderoom.live

This is the durable attempt queue for the full prod-browser proxy benchmark matrix. It tracks model-task attempts, not only task families, and it keeps blocked adapters in the denominator.

## Summary

- Unique task targets: 1354
- Models: 4
- Model-task attempts: 5416
- Existing prod browser attempt passes: 0
- Queued runnable attempts: 412
- Blocked by missing browser adapters: 5004
- Blocked by budget: 0
- Failed attempts: 0
- All-task winner: none
- Current adapter-smoke winner: none

## Budget

- Budget cap: $0.000000
- Historical measured spend already recorded: $0.000000
- Queued new spend estimate: $0.000000
- Full current-model matrix estimate if every adapter existed: $0.000000
- Runnable queue fits budget: yes
- Full current-model matrix fits budget: yes

## Model Costs

| Model | Smoke pass | Est. cost / attempt | Runnable queue est. | Full matrix est. | Basis |
|---|---:|---:|---:|---:|---|
| `cohere/north-mini-code:free` | 0/0 | $0.000000 | $0.000000 | $0.000000 | estimated_smoke |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 0/0 | $0.000000 | $0.000000 | $0.000000 | estimated_smoke |
| `nvidia/nemotron-3-super-120b-a12b:free` | 0/0 | $0.000000 | $0.000000 | $0.000000 | estimated_smoke |
| `qwen/qwen3-coder:free` | 0/0 | $0.000000 | $0.000000 | $0.000000 | estimated_smoke |

## Adapter Gaps

| Family | Tasks | Attempts | Adapter status | Adapter version | Required adapter | First blocker |
|---|---:|---:|---|---:|---|---|
| `spreadsheetbench-v1-full-912` | 912 | 3648 | local_only | 0.1.0 | spreadsheetbench-v1-official-workbook-prod-browser | Generic SpreadsheetBench official workbook upload -> agent edit -> export -> scorer browser adapter is not implemented for staged tasks. |
| `spreadsheetbench-v2-full-321` | 321 | 1284 | missing_generic_browser_adapter | 0.1.0 | spreadsheetbench-v2-workflow-chart-prod-browser | Generic SpreadsheetBench official workbook upload -> agent edit -> export -> scorer browser adapter is not implemented for staged tasks. |
| `accounting-live-proofloop` | 4 | 16 | http_only | 0.1.0 | accounting-live-config-to-prod-browser-room | Current accounting live runner is Convex HTTP, not a prod browser room model matrix. |
| `notion-live-proofloop` | 4 | 16 | http_only | 0.1.0 | notion-live-config-to-prod-browser-room | Current Notion live runner is Convex HTTP, not a prod browser room model matrix. |
| `proximitty-underwriting-pr0` | 4 | 16 | local_only | 0.1.0 | proximitty-underwriting-prod-browser-room | Proximitty suite is deterministic/local; no prod browser room model matrix exists for these scenarios. |
| `noderoom-multi-user-conflict` | 6 | 24 | missing_generic_browser_adapter | 0.1.0 | noderoom-multi-user-conflict-prod-browser-room | Internal deterministic conflict suite has not been promoted to prod browser model matrix tasks. |

## Commands

- Plan without spend: `npm run benchmark:proofloop:prod-proxy-longrun -- plan`
- Resume/status: `npm run benchmark:proofloop:prod-proxy-longrun -- status`
- Execute guarded live attempts: `npm run benchmark:proofloop:prod-proxy-longrun -- run --execute --allow-spend --budget-usd 100 --max-attempts <n>`

