# Proof Loop Benchmark Board

Generated: 2026-07-02T08:58:45.054Z

This board keeps fast product proof separate from official benchmark score claims.

## Policy

- Product-path completion is useful proof: real UI, visible progress, artifacts, verifier receipts, trace, memory, and browser evidence.
- Official semantic score is only claimed when the benchmark's official scorer/verifier result is imported.
- Docker/Harbor isolation can block official score promotion; it must not block product-path Proof Loop runs.
- External benchmark adapters can prove local app-agnostic product paths before official score promotion; the two claims must stay separate.

## Summary

- Benchmarks tracked: 9
- Product-path proven: 7
- Product-path ready to run: 2
- External adapters registered: 0
- Official scores claimed: 1
- Official scores not applicable: 4
- Official scores blocked/not claimed: 4

## Benchmarks

| Benchmark | Family | Product path | Official score | Evidence | Next blocker |
|---|---|---|---|---|---|
| `spreadsheetbench` | official_style | proven | blocked | `docs/eval/spreadsheetbench-live-room-proof.json`<br>`docs/eval/official-benchmark-task-coverage.json`<br>`docs/eval/official-benchmark-readiness.json` | Full official SpreadsheetBench task coverage and scorer import are not ready. |
| `openrouter-convex` | model_route_harness | proven | not_applicable | `docs/eval/openrouter-convex-benchmark.json` | Model-route harness; not a public official benchmark score lane. |
| `proximitty-underwriting-pr0` | product_suite | proven | not_applicable | `.proofloop/runs/latest/run-result.json`<br>`.proofloop/runs/2026-07-01T22-40-30`<br>`proofloop/suites/proximitty-underwriting-pr0.json` | Synthetic underwriting suite; do not label as an official finance benchmark score. |
| `accounting` | product_suite | ready_to_run | not_applicable | `proofloop/accounting/proofloop.accounting.config.json`<br>`proofloop/accounting/benchmarks/benchmark-registry.json` | Accounting suite pins external benchmark families, but local proof-loop runs are product-path evidence. |
| `notion-sdr-bdr` | product_suite | ready_to_run | not_applicable | `proofloop/notion/proofloop.notion.config.json` | Product workflow benchmark, not an official public benchmark score. |
| `bankertoolbench` | external_adapter | proven | proven | `proofloop/benchmarks/bankertoolbench/adapter.json`<br>`docs/eval/bankertoolbench-live-room-proof.json`<br>`docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json`<br>`docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json` | none |
| `finch` | external_adapter | proven | blocked | `proofloop/benchmarks/finch/adapter.json`<br>`docs/eval/proofloop-external-adapter-runs/finch.json`<br>`docs/eval/proofloop-adapter-blockers/finch.json` | finch: official scorer receipt docs/eval/proofloop-official-scores/finch.json is not imported yet. |
| `finauditing` | external_adapter | proven | blocked | `proofloop/benchmarks/finauditing/adapter.json`<br>`docs/eval/proofloop-external-adapter-runs/finauditing.json`<br>`docs/eval/proofloop-adapter-blockers/finauditing.json` | finauditing: official scorer receipt docs/eval/proofloop-official-scores/finauditing.json is not imported yet. |
| `workstreambench` | external_adapter | proven | blocked | `proofloop/benchmarks/workstreambench/adapter.json`<br>`docs/eval/proofloop-external-adapter-runs/workstreambench.json`<br>`docs/eval/proofloop-adapter-blockers/workstreambench.json` | workstreambench: official scorer receipt docs/eval/proofloop-official-scores/workstreambench.json is not imported yet. |

## Interpretation

- `proven` product path means Proof Loop has evidence for the app workflow; it is not an official leaderboard score.
- `registered` means the benchmark is tracked and has an adapter contract, but it should not be sold as live-proofed yet.
- `not_applicable` official score means the lane is an internal/product harness, not a public official benchmark score lane.
- `blocked` official score means the scorer/verifier path is not imported, even if product-path proof exists.

