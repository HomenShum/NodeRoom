# Proof Loop Harness Economics

Generated: 2026-07-02T15:46:02.462Z

This ledger records harness/config versions and cheaper model routes for Proof Loop product gates while preserving official scorer boundaries.

## Summary

- Package version: 0.1.1
- Git commit: a904e2636c50cc793574e16e181b57c9df11bad6 (dirty)
- Harness files tracked: 21
- Missing harness files: 0
- OpenRouter candidates: 20
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
| 1 | `deepseek/deepseek-v4-pro` | 1048576 | 0.435 | 0.87 | 19.2 | tools; tool_choice; structured_outputs; 1M context; finance/proxy-judge candidate family |
| 2 | `minimax/minimax-m3` | 1048576 | 0.3 | 1.2 | 19.0 | tools; tool_choice; structured_outputs; 1M context; finance/proxy-judge candidate family |
| 3 | `google/gemini-3.1-flash-lite` | 1048576 | 0.25 | 1.5 | 18.7 | tools; tool_choice; structured_outputs; 1M context |
| 4 | `qwen/qwen3.6-flash` | 1000000 | 0.1875 | 1.125 | 18.7 | tools; tool_choice; structured_outputs; 1M context; finance/proxy-judge candidate family |
| 5 | `qwen/qwen3.7-plus` | 1000000 | 0.32 | 1.28 | 18.4 | tools; tool_choice; structured_outputs; 1M context; finance/proxy-judge candidate family |
| 6 | `qwen/qwen3.5-plus-20260420` | 1000000 | 0.3 | 1.8 | 17.9 | tools; tool_choice; structured_outputs; 1M context; finance/proxy-judge candidate family |
| 7 | `z-ai/glm-5.2` | 1048576 | 0.93 | 3 | 17.6 | tools; tool_choice; structured_outputs; 1M context; finance/proxy-judge candidate family |
| 8 | `nvidia/nemotron-3-ultra-550b-a55b` | 1000000 | 0.5 | 2.2 | 17.3 | tools; tool_choice; structured_outputs; 1M context; finance/proxy-judge candidate family |

## Cheapest Tool Routes

| Rank | Model | Context | Input $/M | Output $/M | Structured |
|---:|---|---:|---:|---:|---:|
| 1 | `ibm-granite/granite-4.1-8b` | 131072 | 0.05 | 0.1 | yes |
| 2 | `poolside/laguna-xs.2` | 262144 | 0.1 | 0.2 | no |
| 3 | `poolside/laguna-m.1` | 262144 | 0.2 | 0.4 | no |
| 4 | `inclusionai/ring-2.6-1t` | 262144 | 0.075 | 0.625 | no |
| 5 | `qwen/qwen3.6-35b-a3b` | 262144 | 0.14 | 1 | yes |
| 6 | `deepseek/deepseek-v4-pro` | 1048576 | 0.435 | 0.87 | yes |
| 7 | `qwen/qwen3.6-flash` | 1000000 | 0.1875 | 1.125 | yes |
| 8 | `stepfun/step-3.7-flash` | 256000 | 0.2 | 1.15 | yes |

## DeepSeek V4 Pro

- Model: `deepseek/deepseek-v4-pro`
- Context: 1048576
- Pricing: $0.435/M input, $0.87/M output
- Tool capable: yes
- Structured outputs: yes

## Official Score Boundaries

| Lane | Official requirement | Proxy allowed | Official claim with proxy | Recommended proxy |
|---|---|---:|---:|---|
| `spreadsheetbench-v1` | Full 912-task model-run outputs and SpreadsheetBench workbook scorer receipt. | yes | no | `deepseek/deepseek-v4-pro` |
| `spreadsheetbench-v2` | Full 321-task bundle, run artifacts, workbook scorer, and rendered chart-grader receipt. | yes | no | `deepseek/deepseek-v4-pro` |
| `finch` | Upstream Finch scorer imports Azure OpenAI judge output for official claim. | yes | no | `deepseek/deepseek-v4-pro` |
| `finauditing` | Official-format FinSM/FinRE/FinMR predictions and the accepted FinMR judge path. | yes | no | `deepseek/deepseek-v4-pro` |
| `workstreambench` | Upstream official task bundle, rubric, and scorer or author-provided package. | yes | no | `deepseek/deepseek-v4-pro` |

## Harness File Hashes

- `scripts/proofloop.mjs`: 95aec6cc8e95fa03a45904081f01150202473050e6defbec38dd9c6d0ff55fc9
- `scripts/proofloop-runner.ts`: ddfa9e8620e51d395a3b150fbad2353b44a72a4f0822ef8c9f3be9e7b889d3bf
- `scripts/live-proofloop-runner.ts`: 76e00595a762ad80bf60ee4d13a0eb8c3ca7b0548e77cb98a34643379fd8d411
- `proofloop/live-browser-proof.spec.ts`: 8cd38b605de661a8d028a1b164db0a48617f29c721a1b1977987f6d1820565d7
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
- `src/eval/proofloopGoalSupervisor.ts`: 064545291e526e3879147b2c9b8532743b50a97d9eccaa7164509f78cd6ce1a4
- `src/eval/proofloopBenchmarkNormalization.ts`: a32eb66ea33976a98b6fadcf741f1f2bf6e783d70b10e1b02ee5ed9f7d58823f
- `src/eval/proofloopBenchmarkBoard.ts`: ecad3528bcd067e3115fb4de64a7a67f8c3ba6c15e73a0dd702f78c8c9be2c22
- `src/eval/proofloopCompanyTaskCoverage.ts`: 50268bb77d08101f83b844dc7a8a34e4a867d35fce3d7cbf32f8f662338b5d6f
- `src/eval/proofloopHarnessEconomics.ts`: 8695753594190d60d2a764097a24c40bdfba9a986601c4707a7b1ad11f868ea8
- `src/eval/proofloopLiveBrowserPrompt.ts`: 930b20ce976736bf2b8be2a6bb2b308d1756015c1cde5f83f1fed950e67f2ac7

## Recommendations

- Run proxy judge comparisons as Proof Loop product gates before spending on official scorer reruns.
- Keep official score receipts separate: proxy routes can triage and improve outputs, but cannot replace official scorer imports for leaderboard claims.
- Do not block product iteration on Azure/OpenAI judge credentials; block only official-score promotion when no accepted scorer receipt exists.
- Add deepseek/deepseek-v4-pro to the proxy judge matrix: current snapshot shows 1048576 context and $0.435/M input, $0.87/M output.
- Use deepseek/deepseek-v4-pro as the first cheap structured proxy judge candidate, then require task-level Proof Loop pass before promotion.
