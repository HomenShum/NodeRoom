# ProofLoop Free OpenRouter NodeAgent Gauge

Generated: 2026-07-11T01:18:33.910Z
Harness version: `nodeagent-tool-loop-free-model-gauge-v1`
Official benchmark score claim: no

This is a zero-dollar capability gauge for current OpenRouter free tool-capable models running through NodeAgent's tool loop. It is not a SpreadsheetBench/BTB/Finch official score.

## Summary

- Total models: 8
- Passed tool-loop gauge: 5
- Failed: 3
- Skipped: 0
- Estimated cost: $0.000000
- Attempted requests: 8
- Completed requests: 5

## Rows

| Rank | Model | Status | Resolved | Context | In | Out | Cost | Duration | Requests | Error |
|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---|
| 1 | `openai/gpt-oss-120b:free` | failed | `` | 131072 | 0 | 0 | $0.000000 | 7s | 0/1 | Failed after 3 attempts. Last error: Provider returned error |
| 2 | `tencent/hy3:free` | passed | `tencent/hy3:free` | 262144 | 320 | 81 | $0.000000 | 3s | 1/1 |  |
| 4 | `cohere/north-mini-code:free` | passed | `cohere/north-mini-code:free` | 256000 | 137 | 109 | $0.000000 | 2s | 1/1 |  |
| 5 | `nvidia/nemotron-3-ultra-550b-a55b:free` | passed | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1000000 | 434 | 77 | $0.000000 | 2s | 1/1 |  |
| 6 | `nvidia/nemotron-3-super-120b-a12b:free` | passed | `nvidia/nemotron-3-super-120b-a12b:free` | 1000000 | 434 | 71 | $0.000000 | 1s | 1/1 |  |
| 7 | `qwen/qwen3-coder:free` | failed | `` | 1048576 | 0 | 0 | $0.000000 | 37s | 0/1 | Failed after 3 attempts. Last error: Provider returned error |
| 8 | `google/gemma-4-26b-a4b-it:free` | failed | `` | 262144 | 0 | 0 | $0.000000 | 7s | 0/1 | Failed after 3 attempts. Last error: Provider returned error |
| 9 | `qwen/qwen3-next-80b-a3b-instruct:free` | passed | `qwen/qwen3-next-80b-a3b-instruct:free` | 262144 | 420 | 68 | $0.000000 | 25s | 1/1 |  |

