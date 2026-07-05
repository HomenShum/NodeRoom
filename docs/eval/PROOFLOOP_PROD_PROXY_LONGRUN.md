# ProofLoop Prod Proxy Long-Run Plan

Generated: 2026-07-05T07:49:36.562Z
Run ID: `prod-proxy-longrun-2026-07-05T07-49-36-562Z`
Base URL: https://noderoom.live

This is the durable attempt queue for the full prod-browser proxy benchmark matrix. It tracks model-task attempts, not only task families, and it keeps blocked adapters in the denominator.

## Summary

- Unique task targets: 1354
- Models: 4
- Model-task attempts: 5416
- Existing prod browser attempt passes: 10
- Queued runnable attempts: 3501
- Blocked by missing browser adapters: 40
- Blocked by budget: 1865
- Failed attempts: 0
- All-task winner: none
- Current adapter-smoke winner: poolside/laguna-xs-2.1

## Budget

- Budget cap: $100.0000
- Historical measured spend already recorded: $0.5020
- Queued new spend estimate: $99.9525
- Full current-model matrix estimate if every adapter existed: $246.8125
- Runnable queue fits budget: yes
- Full current-model matrix fits budget: no

## Model Costs

| Model | Smoke pass | Est. cost / attempt | Runnable queue est. | Full matrix est. | Basis |
|---|---:|---:|---:|---:|---|
| `z-ai/glm-5.2` | 3/3 | $0.0818 | $0.000000 | $110.7653 | measured_and_estimated_smoke |
| `deepseek/deepseek-v4-flash` | 1/3 | $0.0230 | $30.8890 | $31.1420 | measured_and_estimated_smoke |
| `poolside/laguna-xs-2.1` | 3/3 | $0.0110 | $14.7510 | $14.8940 | measured_and_estimated_smoke |
| `qwen/qwen3.7-plus` | 3/3 | $0.0665 | $54.3125 | $90.0112 | measured_and_estimated_smoke |

## Adapter Gaps

| Family | Tasks | Attempts | Adapter status | Adapter version | Required adapter | First blocker |
|---|---:|---:|---|---:|---|---|
| `proximitty-underwriting-pr0` | 4 | 16 | local_only | 0.1.0 | proximitty-underwriting-prod-browser-room | Proximitty suite is deterministic/local; no prod browser room model matrix exists for these scenarios. |
| `noderoom-multi-user-conflict` | 6 | 24 | missing_generic_browser_adapter | 0.1.0 | noderoom-multi-user-conflict-prod-browser-room | Internal deterministic conflict suite has not been promoted to prod browser model matrix tasks. |

## Commands

- Plan without spend: `npm run benchmark:proofloop:prod-proxy-longrun -- plan`
- Resume/status: `npm run benchmark:proofloop:prod-proxy-longrun -- status`
- Execute guarded live attempts: `npm run benchmark:proofloop:prod-proxy-longrun -- run --execute --allow-spend --budget-usd 100 --max-attempts <n>`

