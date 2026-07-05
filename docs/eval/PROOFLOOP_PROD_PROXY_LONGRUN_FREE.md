# ProofLoop Prod Proxy Long-Run Plan

Generated: 2026-07-05T08:12:15.277Z
Run ID: `prod-proxy-longrun-2026-07-05T08-12-15-277Z`
Base URL: https://noderoom.live

This is the durable attempt queue for the full prod-browser proxy benchmark matrix. It tracks model-task attempts, not only task families, and it keeps blocked adapters in the denominator.

## Summary

- Unique task targets: 1354
- Models: 4
- Model-task attempts: 5416
- Existing prod browser attempt passes: 0
- Queued runnable attempts: 5416
- Blocked by missing browser adapters: 0
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

## Commands

- Plan without spend: `npm run benchmark:proofloop:prod-proxy-longrun -- plan`
- Resume/status: `npm run benchmark:proofloop:prod-proxy-longrun -- status`
- Execute guarded live attempts: `npm run benchmark:proofloop:prod-proxy-longrun -- run --execute --allow-spend --budget-usd 100 --max-attempts <n>`

