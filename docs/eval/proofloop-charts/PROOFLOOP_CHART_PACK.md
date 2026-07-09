# Proof Loop Chart Pack

Generated: 2026-07-09T06:24:23.287Z
Run: `2026-07-02T20-31-20`
Suite: `proximitty-underwriting-pr0`

## Summary

- Lanes: 6
- Runs: 1
- Model rows: 38
- Failure categories: 8
- Workflow items: 7
- Charts: 8
- Unavailable charts: 1

## Chart Artifacts

| Chart | Kind | Spec | Data | Source bindings |
|---|---|---|---|---|
| Model Performance | `model_performance` | `docs/eval/proofloop-charts/model-performance.vl.json` | `docs/eval/proofloop-charts/data/model-performance.data.json` | `model-comparison.json:policies[].score`<br>`model-matrix.json:models[].qualityScore`<br>`meta.json:model` | |
| Cost Per Pass | `cost_per_pass` | `docs/eval/proofloop-charts/cost-per-pass.vl.json` | `docs/eval/proofloop-charts/data/cost-per-pass.data.json` | `cost-ledger.json:policies[].costUsd`<br>`meta.json:model.costUsd` | |
| Failure Categories | `failure_categories` | `docs/eval/proofloop-charts/failure-categories.vl.json` | `docs/eval/proofloop-charts/data/failure-categories.data.json` | `blocker-analysis.json:classes[]`<br>`node-eval.json:reward.failureCategories[]`<br>`model-comparison.json:policies[].failureLayer` | |
| Harness Version Trend | `harness_version` | `docs/eval/proofloop-charts/harness-version-trend.vl.json` | `docs/eval/proofloop-charts/data/harness-version-trend.data.json` | `harness-version.json:harnessVersion`<br>`meta.json:harnessVersion` | |
| Evidence Grounding | `evidence_score` | `docs/eval/proofloop-charts/evidence-score.vl.json` | `docs/eval/proofloop-charts/data/evidence-score.data.json` | `node-eval.json:reward.evidenceGrounding`<br>`model-comparison.json:policies[].evidenceQuality` | |
| Latency / Cost Frontier | `latency_cost` | `docs/eval/proofloop-charts/latency-cost-frontier.vl.json` | `docs/eval/proofloop-charts/data/latency-cost-frontier.data.json` | `cost-ledger.json:policies[].durationMs`<br>`model-matrix.json:models[].latencyMs`<br>`meta.json:durationMs` | |
| Accounting Workpaper (The selected proof target did not include accounting workpaper metrics.) | `accounting_workpaper` | `docs/eval/proofloop-charts/accounting-workpaper.vl.json` | `docs/eval/proofloop-charts/data/accounting-workpaper.data.json` | `node-eval.json:reward.taskCompletion`<br>`verifier-receipt.json:accounting`<br>`run-result.json:accounting` | |
| Workflow Completion | `workflow_timeline` | `docs/eval/proofloop-charts/workflow-completion.vl.json` | `docs/eval/proofloop-charts/data/workflow-completion.data.json` | `blocker-analysis.json:status`<br>`meta.json:passed`<br>`node-eval.json:verifier.hardPass` | |

## Source Refs

```json
{
  "nodeTraceV2": ".proofloop/runs/latest/node-trace-v2.json",
  "nodeEval": ".proofloop/runs/latest/node-eval.json",
  "costLedger": ".proofloop/runs/latest/cost-ledger.json",
  "modelComparison": ".proofloop/runs/latest/model-comparison.json",
  "runResult": ".proofloop/runs/latest/run-result.json",
  "memory": ".proofloop/memory.jsonl",
  "laneAnalyses": [
    ".proofloop/lanes/bankertoolbench/blocker-analysis.json",
    ".proofloop/lanes/finauditing/blocker-analysis.json",
    ".proofloop/lanes/finch/blocker-analysis.json",
    ".proofloop/lanes/spreadsheetbench-v1/blocker-analysis.json",
    ".proofloop/lanes/spreadsheetbench-v2/blocker-analysis.json",
    ".proofloop/lanes/workstreambench/blocker-analysis.json"
  ],
  "laneCostLedgers": [
    ".proofloop/lanes/bankertoolbench/cost-ledger.json",
    ".proofloop/lanes/finauditing/cost-ledger.json",
    ".proofloop/lanes/finch/cost-ledger.json",
    ".proofloop/lanes/spreadsheetbench-v1/cost-ledger.json",
    ".proofloop/lanes/spreadsheetbench-v2/cost-ledger.json",
    ".proofloop/lanes/workstreambench/cost-ledger.json"
  ],
  "laneModelMatrices": [
    ".proofloop/lanes/bankertoolbench/model-matrix.json",
    ".proofloop/lanes/finauditing/model-matrix.json",
    ".proofloop/lanes/finch/model-matrix.json",
    ".proofloop/lanes/spreadsheetbench-v1/model-matrix.json",
    ".proofloop/lanes/spreadsheetbench-v2/model-matrix.json",
    ".proofloop/lanes/workstreambench/model-matrix.json"
  ],
  "laneHarnessVersions": [
    ".proofloop/lanes/bankertoolbench/harness-version.json",
    ".proofloop/lanes/finauditing/harness-version.json",
    ".proofloop/lanes/finch/harness-version.json",
    ".proofloop/lanes/spreadsheetbench-v1/harness-version.json",
    ".proofloop/lanes/spreadsheetbench-v2/harness-version.json",
    ".proofloop/lanes/workstreambench/harness-version.json"
  ],
  "failureTaxonomy": ".proofloop/lanes/bankertoolbench/blocker-analysis.json"
}
```

> Chart values are generated only from proof artifacts. Empty charts must be explicitly marked unavailable.
