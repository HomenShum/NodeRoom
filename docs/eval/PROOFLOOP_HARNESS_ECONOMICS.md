# Proof Loop Harness Economics

Generated: 2026-07-03T22:15:26.303Z

This ledger records harness/config versions and cheaper model routes for Proof Loop product gates while preserving official scorer boundaries.

## Summary

- Package version: 0.1.1
- Git commit: 589cb13478dc9bae26436efa77d67fb6241a87af (dirty)
- Harness files tracked: 23
- Missing harness files: 0
- OpenRouter candidates: 25
- Proxy judge candidates: 8
- Cheaper proxy routes available: yes
- Accepted official scorer still required for official claims: yes
- Official judge credentials still required for official claims: no

## Policy

- Harness versioning is based on content hashes for runner, config, adapter, and supervisor files.
- Cheaper model discovery is live metadata evidence, not proof of task quality until a route passes the relevant Proof Loop task.
- Proxy judges can keep product Proof Loop moving when official scorer credentials or hosted judges are missing.
- Proxy judges must not be promoted as official leaderboard scores unless the benchmark accepts that judge/scorer path.
- Official score receipts and product proof receipts remain separate artifacts.
- Judge credentials are not intrinsically required when an accepted official scorer or accepted proxy-judge path exists.

## Best Proxy Judge Candidates

| Rank | Model | Context | Input $/M | Output $/M | Score | Reasons |
|---:|---|---:|---:|---:|---:|---|
| 1 | `deepseek/deepseek-v4-flash` | 1048576 | 0.089 | 0.18 | 20.2 | tools; tool_choice; structured_outputs; 1M context; finance/proxy-judge candidate family |
| 2 | `deepseek/deepseek-v4-pro` | 1048576 | 0.435 | 0.87 | 19.2 | tools; tool_choice; structured_outputs; 1M context; finance/proxy-judge candidate family |
| 3 | `xiaomi/mimo-v2.5-pro` | 1048576 | 0.435 | 0.87 | 19.2 | tools; tool_choice; structured_outputs; 1M context |
| 4 | `minimax/minimax-m3` | 1048576 | 0.3 | 1.2 | 19.0 | tools; tool_choice; structured_outputs; 1M context; finance/proxy-judge candidate family |
| 5 | `google/gemini-3.1-flash-lite` | 1048576 | 0.25 | 1.5 | 18.7 | tools; tool_choice; structured_outputs; 1M context |
| 6 | `qwen/qwen3.6-flash` | 1000000 | 0.1875 | 1.125 | 18.7 | tools; tool_choice; structured_outputs; 1M context; finance/proxy-judge candidate family |
| 7 | `qwen/qwen3.7-plus` | 1000000 | 0.32 | 1.28 | 18.4 | tools; tool_choice; structured_outputs; 1M context; finance/proxy-judge candidate family |
| 8 | `qwen/qwen3.5-plus-20260420` | 1000000 | 0.3 | 1.8 | 17.9 | tools; tool_choice; structured_outputs; 1M context; finance/proxy-judge candidate family |

## Cheapest Tool Routes

| Rank | Model | Context | Input $/M | Output $/M | Structured |
|---:|---|---:|---:|---:|---:|
| 1 | `ibm-granite/granite-4.1-8b` | 131072 | 0.05 | 0.1 | yes |
| 2 | `poolside/laguna-xs-2.1` | 262144 | 0.06 | 0.12 | no |
| 3 | `deepseek/deepseek-v4-flash` | 1048576 | 0.089 | 0.18 | yes |
| 4 | `tencent/hy3-preview` | 262144 | 0.063 | 0.21 | no |
| 5 | `poolside/laguna-xs.2` | 262144 | 0.1 | 0.2 | no |
| 6 | `poolside/laguna-m.1` | 262144 | 0.2 | 0.4 | no |
| 7 | `inclusionai/ling-2.6-1t` | 262144 | 0.075 | 0.625 | yes |
| 8 | `inclusionai/ring-2.6-1t` | 262144 | 0.075 | 0.625 | no |

## DeepSeek V4 Pro

- Model: `deepseek/deepseek-v4-pro`
- Context: 1048576
- Pricing: $0.435/M input, $0.87/M output
- Tool capable: yes
- Structured outputs: yes

## Official Score Boundaries

| Lane | Official requirement | Proxy allowed | Official claim with proxy | Recommended proxy |
|---|---|---:|---:|---|
| `spreadsheetbench-v1` | Full 912-task model-run outputs and SpreadsheetBench workbook scorer receipt. | yes | no | `deepseek/deepseek-v4-flash` |
| `spreadsheetbench-v2` | Full 321-task bundle, run artifacts, workbook scorer, and rendered chart-grader receipt. | yes | no | `deepseek/deepseek-v4-flash` |
| `finch` | Upstream Finch scorer imports Azure OpenAI judge output for official claim. | yes | no | `deepseek/deepseek-v4-flash` |
| `finauditing` | Official-format FinSM/FinRE/FinMR predictions and the accepted FinMR judge path. | yes | no | `deepseek/deepseek-v4-flash` |
| `workstreambench` | Upstream official task bundle, rubric, and scorer or author-provided package. | yes | no | `deepseek/deepseek-v4-flash` |

## Harness File Hashes

- `scripts/proofloop.mjs`: 95aec6cc8e95fa03a45904081f01150202473050e6defbec38dd9c6d0ff55fc9
- `scripts/proofloop-runner.ts`: c4be8ba68615eabc03144a2ff93b39b1d42916b82ae372d99d4f6eda2d851f0a
- `scripts/live-proofloop-runner.ts`: 76e00595a762ad80bf60ee4d13a0eb8c3ca7b0548e77cb98a34643379fd8d411
- `proofloop/live-browser-proof.spec.ts`: c5848a8e704e7b4d955257d3b6eb0496ed99aaad72be2568a3dc1883f7fad203
- `proofloop/cockpit/playwrightOverlay.ts`: 08516b60f3fa088ef87a9233d898fda3f9f0e7f4134220866c2c7425816637a7
- `proofloop/suites/proximitty-underwriting-pr0.json`: 77d5c2987a6eb504f99c96698eee63070a645494a0b5579fc9673c5ae2f5df23
- `proofloop/accounting/proofloop.accounting.config.json`: 2d08079aed2c2d4631c4cd91f62d85f35eb3aaf698e0d80e3ac5b81dc00d241d
- `proofloop/accounting/live.accounting.config.json`: 94a2ea9b6a797340d766dbf7b0a9ccbf3446f61bc18e5222a00714f6660c2e55
- `proofloop/notion/proofloop.notion.config.json`: 6400e479c17267842288ecb16139da07924744cf2aef70f8a80343fd1e860354
- `proofloop/notion/live.notion.config.json`: 48f3b060db525f38ccbe1dfacf97ecd8c08915e46b50cf08c2c10e53ea0d5077
- `proofloop/benchmarks/finch/adapter.json`: d878402cf74c5bbf9548978e12b2a4bb7ebd753ad05b93f5ca120bc82116c387
- `proofloop/benchmarks/finauditing/adapter.json`: a36a06fadf1d9e3bcb5e2c60d0b71cd7f6053d89fb13d1fb4f603d822192dca6
- `proofloop/benchmarks/workstreambench/adapter.json`: e3655f8b4b04c2c670d645b4d70901cee2cf3b02e69f3d2bd2aa3dc8276eab1f
- `scripts/proofloop-company-task-coverage.ts`: 66eb7e8dd23b3a3eca2d363cfde287260af8604859be047ece606ef101342a5a
- `scripts/proofloop-harness-economics.ts`: 88af3482e8bc8d8ed15a8df44756e2498159b3682d350a404c86be063b1fb53c
- `src/eval/proofloopGoalSupervisor.ts`: 394db83b3cb3192ff67ce854096a76a9427ce5af49f9c69765f8ea020885b06b
- `src/eval/proofloopBlockerSolver.ts`: 919b26821754bc6d88d49e98c028b1dd10cd64ec3b1ffebec11f46fb8a2cec5f
- `src/eval/proofloopModelTracking.ts`: 7ea29d78b38dc9234f7c6e0994ef359b65b72e229185598a3f49e9f2941580e7
- `src/eval/proofloopBenchmarkNormalization.ts`: a32eb66ea33976a98b6fadcf741f1f2bf6e783d70b10e1b02ee5ed9f7d58823f
- `src/eval/proofloopBenchmarkBoard.ts`: 4f9ad6a04a2b2aea077d6a0e1096f83a24148cf3b4f14e04c64007d460ba1a15
- `src/eval/proofloopCompanyTaskCoverage.ts`: 50268bb77d08101f83b844dc7a8a34e4a867d35fce3d7cbf32f8f662338b5d6f
- `src/eval/proofloopHarnessEconomics.ts`: fde021345bf656bcd7c4c6a328bafeae1918e0bd2cc9ec34a024d3029d0cca55
- `src/eval/proofloopLiveBrowserPrompt.ts`: 930b20ce976736bf2b8be2a6bb2b308d1756015c1cde5f83f1fed950e67f2ac7

## Recommendations

- Run proxy judge comparisons as Proof Loop product gates before spending on official scorer reruns.
- Keep official score receipts separate: proxy routes can triage and improve outputs, but cannot replace official scorer imports for leaderboard claims.
- Do not block product iteration on Azure/OpenAI judge credentials; block only official-score promotion when no accepted scorer receipt exists.
- Add deepseek/deepseek-v4-pro to the proxy judge matrix: current snapshot shows 1048576 context and $0.435/M input, $0.87/M output.
- Use deepseek/deepseek-v4-flash as the first cheap structured proxy judge candidate, then require task-level Proof Loop pass before promotion.
