# ProofLoop Prod Proxy Long-Run Plan

Generated: 2026-07-05T07:20:52.134Z
Run ID: `prod-proxy-free-spreadsheetbench-102-20-20260705`
Base URL: https://noderoom.live

This is the durable attempt queue for the full prod-browser proxy benchmark matrix. It tracks model-task attempts, not only task families, and it keeps blocked adapters in the denominator.

## Summary

- Unique task targets: 1354
- Models: 4
- Model-task attempts: 5416
- Existing prod browser attempt passes: 0
- Queued runnable attempts: 5372
- Blocked by missing browser adapters: 40
- Blocked by budget: 0
- Failed attempts: 4
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
| `proximitty-underwriting-pr0` | 4 | 16 | local_only | 0.1.0 | proximitty-underwriting-prod-browser-room | Proximitty suite is deterministic/local; no prod browser room model matrix exists for these scenarios. |
| `noderoom-multi-user-conflict` | 6 | 24 | missing_generic_browser_adapter | 0.1.0 | noderoom-multi-user-conflict-prod-browser-room | Internal deterministic conflict suite has not been promoted to prod browser model matrix tasks. |

## Failed Attempts

| Attempt | Family | Task | Model | Exit | First blocker |
|---|---|---|---|---:|---|
| `spreadsheetbench-v1-full-912--102-20--cohere_north-mini-code_free--0a13d22f5d` | `spreadsheetbench-v1-full-912` | `102-20` | `cohere/north-mini-code:free` | 1 | Live command exited 1 |
| `spreadsheetbench-v1-full-912--102-20--nvidia_nemotron-3-ultra-550b-a55b_free--610ec95133` | `spreadsheetbench-v1-full-912` | `102-20` | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1 | Live command exited 1 |
| `spreadsheetbench-v1-full-912--102-20--nvidia_nemotron-3-super-120b-a12b_free--2d566b3b2f` | `spreadsheetbench-v1-full-912` | `102-20` | `nvidia/nemotron-3-super-120b-a12b:free` | 1 | Live command exited 1 |
| `spreadsheetbench-v1-full-912--102-20--qwen_qwen3-coder_free--f878fa4625` | `spreadsheetbench-v1-full-912` | `102-20` | `qwen/qwen3-coder:free` | 1 | Live command exited 1 |

## Commands

- Plan without spend: `npm run benchmark:proofloop:prod-proxy-longrun -- plan`
- Resume/status: `npm run benchmark:proofloop:prod-proxy-longrun -- status`
- Execute guarded live attempts: `npm run benchmark:proofloop:prod-proxy-longrun -- run --execute --allow-spend --budget-usd 100 --max-attempts <n>`

