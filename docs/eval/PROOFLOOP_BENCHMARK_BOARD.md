# Proof Loop Benchmark Board

Generated: 2026-07-08T21:36:38.196Z

This board keeps fast product proof separate from official benchmark score claims.

## Policy

- Product-path completion is useful proof: real UI, visible progress, artifacts, verifier receipts, trace, memory, and browser evidence.
- Official semantic score is only claimed when the benchmark's official scorer/verifier result is imported.
- Docker/Harbor isolation can block official score promotion; it must not block product-path Proof Loop runs.
- External benchmark adapters can prove local app-agnostic product paths before official score promotion; the two claims must stay separate.
- Proof Loop may not call a lane external-blocked until setup, research, scaffold, doctor, resume, model, and harness receipts exist.

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
| `spreadsheetbench` | official_style | proven | needs_scaffold_or_run | `docs/eval/spreadsheetbench-live-room-proof.json`<br>`docs/eval/official-benchmark-task-coverage.json`<br>`docs/eval/official-benchmark-readiness.json`<br>`.proofloop/lanes/spreadsheetbench-v1/blocker-analysis.json` | Run all 912 tasks through the model runner or an approved chunked official-policy runner before claiming a model score.<br>397 verified task(s) still need model-run evidence; current N=5 smoke covers 3/400 cases.<br>Full verified-score promotion still needs official scoring parity, not only local workbook scoring.<br>Run every staged V2 task through the model runner, static workbook scorer, and rendered/VLM chart grader where applicable. |
| `openrouter-convex` | model_route_harness | proven | not_applicable | `docs/eval/openrouter-convex-benchmark.json` | Model-route harness; not a public official benchmark score lane. |
| `proximitty-underwriting-pr0` | product_suite | proven | not_applicable | `.proofloop/runs/latest/run-result.json`<br>`.proofloop/runs/2026-07-02T20-31-20`<br>`proofloop/suites/proximitty-underwriting-pr0.json` | Synthetic underwriting suite; do not label as an official finance benchmark score. |
| `accounting` | product_suite | ready_to_run | not_applicable | `proofloop/accounting/proofloop.accounting.config.json`<br>`proofloop/accounting/benchmarks/benchmark-registry.json` | Accounting suite pins external benchmark families, but local proof-loop runs are product-path evidence. |
| `notion-sdr-bdr` | product_suite | ready_to_run | not_applicable | `proofloop/notion/proofloop.notion.config.json` | Product workflow benchmark, not an official public benchmark score. |
| `bankertoolbench` | external_adapter | proven | proven | `proofloop/benchmarks/bankertoolbench/adapter.json`<br>`docs/eval/bankertoolbench-live-room-proof.json`<br>`docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json`<br>`docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json` | none |
| `finch` | external_adapter | proven | needs_scaffold_or_run | `proofloop/benchmarks/finch/adapter.json`<br>`docs/eval/proofloop-external-adapter-live-room-runs/finch.json`<br>`docs/eval/proofloop-external-adapter-runs/finch.json`<br>`docs/eval/proofloop-adapter-blockers/finch.json` | missing official scorer remains before external-blocked can be claimed<br>missing judge credentials remains before official score can be claimed<br>finch: official scorer receipt docs/eval/proofloop-official-scores/finch.json is blocked_external; scored receipt is still required before claiming score.<br>finch: official task bundle lock docs/eval/proofloop-official-task-bundles/finch.json is staged and NodeRoom model-output artifacts are complete in docs/eval/proofloop-official-outputs/finch.json; upstream content_parts rendering and an accepted Azure judge/scorer receipt are still required before claiming an official score. Cheaper OpenRouter proxy judges are product-gate evidence only unless accepted upstream.<br>next: complete upstream Finch content_parts rendering, run/import the accepted Finch Azure scorer or judge output, use npm run benchmark:proofloop:harness-economics for proxy triage, then npm run benchmark:proofloop:adapter-blockers -- --id finch --strict |
| `finauditing` | external_adapter | proven | needs_scaffold_or_run | `proofloop/benchmarks/finauditing/adapter.json`<br>`docs/eval/proofloop-external-adapter-live-room-runs/finauditing.json`<br>`docs/eval/proofloop-external-adapter-runs/finauditing.json`<br>`docs/eval/proofloop-adapter-blockers/finauditing.json` | missing official scorer remains before external-blocked can be claimed<br>missing judge credentials remains before official score can be claimed<br>finauditing: official scorer receipt docs/eval/proofloop-official-scores/finauditing.json is blocked_external; scored receipt is still required before claiming score.<br>next: run/import FinAuditing scorer output with an accepted FinMR judge path, use npm run benchmark:proofloop:harness-economics for proxy triage, then npm run benchmark:proofloop:adapter-blockers -- --id finauditing --strict |
| `workstreambench` | external_adapter | proven | blocked | `proofloop/benchmarks/workstreambench/adapter.json`<br>`docs/eval/proofloop-external-adapter-live-room-runs/workstreambench.json`<br>`docs/eval/proofloop-external-adapter-runs/workstreambench.json`<br>`docs/eval/proofloop-adapter-blockers/workstreambench.json` | missing official scorer remains before official score can be claimed<br>missing task bundle remains before official score can be claimed<br>no public upstream release remains before official score can be claimed<br>workstreambench: official scorer receipt docs/eval/proofloop-official-scores/workstreambench.json is blocked_external; scored receipt is still required before claiming score.<br>workstreambench: no public official task bundle lock docs/eval/proofloop-official-task-bundles/workstreambench.json is staged because no public official bundle/scorer/rubric URL was found.<br>next: obtain the official WorkstreamBench task bundle and scorer/rubric from an upstream release or authors, lock it in docs/eval/proofloop-official-task-bundles/workstreambench.json, use npm run benchmark:proofloop:harness-economics for proxy triage, import a scored receipt, then npm run benchmark:proofloop:adapter-blockers -- --id workstreambench --strict |

## Interpretation

- `proven` product path means Proof Loop has evidence for the app workflow; it is not an official leaderboard score.
- `registered` means the benchmark is tracked and has an adapter contract, but it should not be sold as live-proofed yet.
- `not_applicable` official score means the lane is an internal/product harness, not a public official benchmark score lane.
- `blocked` official score means the scorer/verifier path is not imported, even if product-path proof exists.
- `needs_scaffold_or_run` means Proof Loop found local exporter, model-run, or harness work that must be attempted before external-blocked is allowed.
- `proxy_only` means local product/proxy evidence exists, but the lane still cannot claim an official score.

