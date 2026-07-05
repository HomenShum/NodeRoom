# ProofLoop Prod Proxy Long-Run Plan

Generated: 2026-07-05T08:11:53.015Z
Run ID: `prod-proxy-longrun-2026-07-05T08-11-53-015Z`
Base URL: https://noderoom.live

This is the durable attempt queue for the full prod-browser proxy benchmark matrix. It tracks model-task attempts, not only task families, and it keeps blocked adapters in the denominator.

## Summary

- Unique task targets: 1354
- Models: 4
- Model-task attempts: 5416
- Existing prod browser attempt passes: 10
- Queued runnable attempts: 3516
- Blocked by missing browser adapters: 0
- Blocked by budget: 1890
- Failed attempts: 0
- All-task winner: none
- Current adapter-smoke winner: poolside/laguna-xs-2.1

## Budget

- Budget cap: $100.0000
- Historical measured spend already recorded: $0.5020
- Queued new spend estimate: $99.9601
- Full current-model matrix estimate if every adapter existed: $246.8125
- Runnable queue fits budget: yes
- Full current-model matrix fits budget: no

## Model Costs

| Model | Smoke pass | Est. cost / attempt | Runnable queue est. | Full matrix est. | Basis |
|---|---:|---:|---:|---:|---|
| `z-ai/glm-5.2` | 3/3 | $0.0818 | $0.000000 | $110.7653 | measured_and_estimated_smoke |
| `deepseek/deepseek-v4-flash` | 1/3 | $0.0230 | $31.1190 | $31.1420 | measured_and_estimated_smoke |
| `poolside/laguna-xs-2.1` | 3/3 | $0.0110 | $14.8610 | $14.8940 | measured_and_estimated_smoke |
| `qwen/qwen3.7-plus` | 3/3 | $0.0665 | $53.9801 | $90.0112 | measured_and_estimated_smoke |

## Adapter Gaps

| Family | Tasks | Attempts | Adapter status | Adapter version | Required adapter | First blocker |
|---|---:|---:|---|---:|---|---|

## Commands

- Plan without spend: `npm run benchmark:proofloop:prod-proxy-longrun -- plan`
- Resume/status: `npm run benchmark:proofloop:prod-proxy-longrun -- status`
- Execute guarded live attempts: `npm run benchmark:proofloop:prod-proxy-longrun -- run --execute --allow-spend --budget-usd 100 --max-attempts <n>`

