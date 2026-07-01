# Proof Loop Benchmark Board

Generated: 2026-07-01T23:18:32.742Z

This board keeps fast product proof separate from official benchmark score claims.

## Policy

- Product-path completion is useful proof: real UI, visible progress, artifacts, verifier receipts, trace, memory, and browser evidence.
- Official semantic score is only claimed when the benchmark's official scorer/verifier result is imported.
- Docker/Harbor isolation can block official score promotion; it must not block product-path Proof Loop runs.
- Registered external adapters are backlog inventory until their live browser scenario and verifier implementation exist.

## Summary

- Benchmarks tracked: 9
- Product-path proven: 4
- Product-path ready to run: 2
- External adapters registered: 3
- Official scores claimed: 0
- Official scores blocked/not claimed: 9

## Benchmarks

| Benchmark | Family | Product path | Official score | Evidence | Next blocker |
|---|---|---|---|---|---|
| `spreadsheetbench` | official_style | proven | blocked | `docs/eval/spreadsheetbench-live-room-proof.json`<br>`docs/eval/official-benchmark-task-coverage.json`<br>`docs/eval/official-benchmark-readiness.json` | Full official SpreadsheetBench task coverage and scorer import are not ready. |
| `openrouter-convex` | model_route_harness | proven | blocked | `docs/eval/openrouter-convex-benchmark.json` | Official benchmark promotion remains separate from the product route harness. |
| `proximitty-underwriting-pr0` | product_suite | proven | not_claimed | `.proofloop/runs/latest/run-result.json`<br>`.proofloop/runs/2026-07-01T22-40-30`<br>`proofloop/suites/proximitty-underwriting-pr0.json` | Synthetic underwriting suite; do not label as an official finance benchmark score. |
| `accounting` | product_suite | ready_to_run | not_claimed | `proofloop/accounting/proofloop.accounting.config.json`<br>`proofloop/accounting/benchmarks/benchmark-registry.json` | Accounting suite pins external benchmark families, but local proof-loop runs are product-path evidence. |
| `notion-sdr-bdr` | product_suite | ready_to_run | not_claimed | `proofloop/notion/proofloop.notion.config.json` | Product workflow benchmark, not an official public benchmark score. |
| `bankertoolbench` | external_adapter | proven | blocked | `proofloop/benchmarks/bankertoolbench/adapter.json`<br>`docs/eval/bankertoolbench-live-room-proof.json`<br>`docs/eval/bankertoolbench-official-contract.json` | Record BankerToolBench dataset revision plus a manifest lockfile with per-file hashes. |
| `finch` | external_adapter | registered | not_claimed | `proofloop/benchmarks/finch/adapter.json` | finch: missing implementation file proofloop/benchmarks/finch/load-tasks.ts |
| `finauditing` | external_adapter | registered | not_claimed | `proofloop/benchmarks/finauditing/adapter.json` | finauditing: missing implementation file proofloop/benchmarks/finauditing/load-tasks.ts |
| `workstreambench` | external_adapter | registered | not_claimed | `proofloop/benchmarks/workstreambench/adapter.json` | workstreambench: missing implementation file proofloop/benchmarks/workstreambench/load-tasks.ts |

## Interpretation

- `proven` product path means Proof Loop has evidence for the app workflow; it is not an official leaderboard score.
- `registered` means the benchmark is tracked and has an adapter contract, but it should not be sold as live-proofed yet.
- `blocked` official score means the scorer/verifier path is not imported, even if product-path proof exists.

