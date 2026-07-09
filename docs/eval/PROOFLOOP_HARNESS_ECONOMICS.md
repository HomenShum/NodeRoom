# Proof Loop Harness Economics

Generated: 2026-07-08T21:36:23.501Z

This ledger records harness/config versions and cheaper model routes for Proof Loop product gates while preserving official scorer boundaries.

## Summary

- Package version: 0.1.1
- Git commit: 8ef3fd5a2961b431118f5ff94132d4d0ee8ab8b2 (dirty)
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

- `scripts/proofloop.mjs`: 3f6008055f124098d6c28aed469aff2165583dc44d4275854bea5f91826ba3f9
- `scripts/proofloop-runner.ts`: c4be8ba68615eabc03144a2ff93b39b1d42916b82ae372d99d4f6eda2d851f0a
- `scripts/live-proofloop-runner.ts`: 76e00595a762ad80bf60ee4d13a0eb8c3ca7b0548e77cb98a34643379fd8d411
- `proofloop/live-browser-proof.spec.ts`: 2d86a7229a14a890d685633db3555ff3faef3880e19935fff9b599110d9b072b
- `proofloop/cockpit/playwrightOverlay.ts`: 08516b60f3fa088ef87a9233d898fda3f9f0e7f4134220866c2c7425816637a7
- `proofloop/suites/proximitty-underwriting-pr0.json`: 77d5c2987a6eb504f99c96698eee63070a645494a0b5579fc9673c5ae2f5df23
- `proofloop/accounting/proofloop.accounting.config.json`: 2d08079aed2c2d4631c4cd91f62d85f35eb3aaf698e0d80e3ac5b81dc00d241d
- `proofloop/accounting/live.accounting.config.json`: 02f7c6c4447948e6f8baaaddafe78d16580c79113ed1409a006e24780341472f
- `proofloop/notion/proofloop.notion.config.json`: 6400e479c17267842288ecb16139da07924744cf2aef70f8a80343fd1e860354
- `proofloop/notion/live.notion.config.json`: 48f3b060db525f38ccbe1dfacf97ecd8c08915e46b50cf08c2c10e53ea0d5077
- `proofloop/benchmarks/finch/adapter.json`: 9cb926196b3ee226476bdf06297f6aa612476f392ea39894846fba1c4b0c0055
- `proofloop/benchmarks/finauditing/adapter.json`: 1dcd4fbeb7a8186bf58c58c9fac976d73a406aa62087a6dda3502de978c6f7b4
- `proofloop/benchmarks/workstreambench/adapter.json`: 3b09da01743a7a1db85e2c415a9e07ca474c9b725c9aec5f42580a3aad9059be
- `scripts/proofloop-company-task-coverage.ts`: 66eb7e8dd23b3a3eca2d363cfde287260af8604859be047ece606ef101342a5a
- `scripts/proofloop-harness-economics.ts`: 88af3482e8bc8d8ed15a8df44756e2498159b3682d350a404c86be063b1fb53c
- `src/eval/proofloopGoalSupervisor.ts`: 928a1ec86f5cee7ced97a5ec6eaddd1a07a3a3fa35436eefdfe902864cb6cd1a
- `src/eval/proofloopBlockerSolver.ts`: e840ede52b09036a5c28427238eef1457930133a6841cd8e12d3983e932c8538
- `src/eval/proofloopModelTracking.ts`: 5c0fc9e9daa64add3c40833546a2b5bbd86a2fac14801c86302d3a1434f65bc2
- `src/eval/proofloopBenchmarkNormalization.ts`: 6b50358571a4b978e7b72e4c969f1399e446b3f87aa714c1e2dd5ee51fb46aec
- `src/eval/proofloopBenchmarkBoard.ts`: 7942b9b1290149a2cdc1dca12f5eb8f869f97953da2f67c77c1d54ec603d3c66
- `src/eval/proofloopCompanyTaskCoverage.ts`: 5ba36a4bf91555d4144c5ee709e0dc1d8c37fa7f8f95be63516987b93652e800
- `src/eval/proofloopHarnessEconomics.ts`: fde021345bf656bcd7c4c6a328bafeae1918e0bd2cc9ec34a024d3029d0cca55
- `src/eval/proofloopLiveBrowserPrompt.ts`: 930b20ce976736bf2b8be2a6bb2b308d1756015c1cde5f83f1fed950e67f2ac7

## Recommendations

- Run proxy judge comparisons as Proof Loop product gates before spending on official scorer reruns.
- Keep official score receipts separate: proxy routes can triage and improve outputs, but cannot replace official scorer imports for leaderboard claims.
- Do not block product iteration on Azure/OpenAI judge credentials; block only official-score promotion when no accepted scorer receipt exists.
- Add deepseek/deepseek-v4-pro to the proxy judge matrix: current snapshot shows 1048576 context and $0.435/M input, $0.87/M output.
- Use deepseek/deepseek-v4-flash as the first cheap structured proxy judge candidate, then require task-level Proof Loop pass before promotion.
