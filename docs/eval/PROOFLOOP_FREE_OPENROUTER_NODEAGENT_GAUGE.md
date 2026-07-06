# ProofLoop Free OpenRouter NodeAgent Gauge

Generated: 2026-07-06T02:30:32.660Z
Harness version: `nodeagent-tool-loop-free-model-gauge-v1`
Official benchmark score claim: no

This is a zero-dollar capability gauge for current OpenRouter free tool-capable models running through NodeAgent's tool loop. It is not a SpreadsheetBench/BTB/Finch official score.

## Summary

- Total models: 6
- Passed tool-loop gauge: 3
- Failed: 3
- Skipped: 0
- Estimated cost: $0.000000

## Rows

| Model | Status | Resolved | Context | In | Out | Cost | Duration | Error |
|---|---:|---|---:|---:|---:|---:|---:|---|
| `cohere/north-mini-code:free` | passed | `cohere/north-mini-code:free` | 256000 | 137 | 110 | $0.000000 | 1s |  |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | passed | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1000000 | 434 | 78 | $0.000000 | 5s |  |
| `nvidia/nemotron-3-super-120b-a12b:free` | passed | `nvidia/nemotron-3-super-120b-a12b:free` | 1000000 | 434 | 75 | $0.000000 | 1s |  |
| `qwen/qwen3-coder:free` | failed | `` | 1048576 | 0 | 0 | $0.000000 | 59s | Failed after 3 attempts. Last error: Provider returned error |
| `google/gemma-4-26b-a4b-it:free` | failed | `` | 262144 | 0 | 0 | $0.000000 | 6s | Failed after 3 attempts. Last error: Provider returned error |
| `qwen/qwen3-next-80b-a3b-instruct:free` | failed | `` | 262144 | 0 | 0 | $0.000000 | 54s | Failed after 3 attempts. Last error: Provider returned error |

