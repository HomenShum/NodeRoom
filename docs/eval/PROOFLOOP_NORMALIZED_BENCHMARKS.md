# Proof Loop Benchmark Normalization

Generated: 2026-07-11T01:31:19.154Z

This ledger answers whether each benchmark is shaped for the current NodeRoom codebase while preserving its official scorer boundary.

## Summary

- Benchmarks normalized/tracked: 9
- Product fit proven: 4
- Product fit ready: 2
- Product fit partial: 3
- Product fit blocked: 0
- Official scores claimed: 5
- Official scores blocked: 0
- Official scores not applicable: 4
- Every benchmark has a NodeRoom shape: yes

## Policy

- Normalize benchmark tasks into NodeRoom product-facing manifests and run specs before routing work through the current codebase.
- Do not normalize away official scorer semantics: official rubrics, judges, output schemas, and credentials stay benchmark-specific.
- A local product-path proof can be proven while official task expansion, submission export, or official scorer import remains blocked.
- Every blocker must name the missing stage: official bundle, product manifest, NodeRoom run spec, artifact export, official submission, or official scorer.

## Normalized Benchmarks

| Benchmark | Product fit | Official fit | Product manifest | NodeRoom run | Export | Official submission | Next blocker |
|---|---:|---:|---:|---:|---:|---:|---|
| `spreadsheetbench` | proven | claimed | proven | proven | proven | proven | none |
| `bankertoolbench` | proven | claimed | proven | proven | proven | proven | none |
| `openrouter-convex` | proven | not_applicable | proven | proven | proven | not_applicable | none |
| `proximitty-underwriting-pr0` | proven | not_applicable | proven | proven | proven | not_applicable | none |
| `accounting` | ready | not_applicable | ready | ready | ready | not_applicable | none |
| `notion-sdr-bdr` | ready | not_applicable | ready | ready | ready | not_applicable | none |
| `finch` | partial | claimed | partial | proven | proven | proven | Expand all 172 official Finch task ids into ProductTaskManifest rows. |
| `finauditing` | partial | claimed | partial | proven | proven | proven | Expand FinSM, FinRE, and FinMR test rows into ProductTaskManifest rows. |
| `workstreambench` | partial | claimed | partial | proven | proven | proven | Expand the 38 locked public MBABench ModelOff task ids into ProductTaskManifest rows before claiming an official score. |

## Stage Detail

### SpreadsheetBench

- Source: SpreadsheetBench V1, SpreadsheetBench Verified, and SpreadsheetBench V2
- Product surface: NodeRoom
- Task shape: official spreadsheet task -> agent/evaluator-isolated workbook manifest -> NodeRoom workbook run -> candidate workbook export -> official scorer
- Official scorer semantics: preserved

- officialTaskBundle: proven - Official bundles must be staged with agent-visible inputs separated from evaluator answer workbooks and scorer metadata.
  Evidence: `docs/eval/spreadsheetbench-v1-912-stage.json`, `docs/eval/spreadsheetbench-v1-912-copy-input-baseline.json`, `docs/eval/spreadsheetbench-v1-912-model-run.json`, `docs/eval/spreadsheetbench-v1-912-local-proxy-output-receipts.json`, `docs/eval/official-benchmark-readiness.json`, `docs/eval/spreadsheetbench-v1-full-stage-smoke.json`, `docs/eval/spreadsheetbench-v1-copy-input-full-smoke.json`, `docs/eval/spreadsheetbench-v1-verified-400-model-run.json`, `docs/eval/spreadsheetbench-v2-full-ingest.json`, `docs/eval/spreadsheetbench-v2-full-stage.json`, `docs/eval/spreadsheetbench-v2-stage-smoke.json`, `docs/eval/spreadsheetbench-v2-321-model-run.json`, `docs/eval/spreadsheetbench-v2-321-local-proxy-output-receipts.json`, `docs/eval/spreadsheetbench-chart-visual-probe.json`
- productTaskManifest: proven - Product manifest covers 1633/1633 staged task targets with agent/evaluator isolation.
  Evidence: `docs/eval/spreadsheetbench-v1-912-stage.json`, `docs/eval/spreadsheetbench-v2-full-stage.json`, `docs/eval/spreadsheetbench-v2-stage-smoke.json`, `docs/eval/spreadsheetbench-v1-full-stage-smoke.json`
- nodeRoomRunSpec: proven - NodeRoom runner must execute every staged task before official score promotion.
  Evidence: `docs/eval/spreadsheetbench-v1-912-copy-input-baseline.json`, `docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json`, `docs/eval/spreadsheetbench-v2-run-smoke.json`
- artifactExport: proven - Candidate workbook exports must be reopened/scored from agent output before evaluator access opens.
  Evidence: `docs/eval/spreadsheetbench-live-room-proof.json`
- officialSubmission: proven - Full model-generated candidate workbook outputs are ready for the published scorer; submission alone does not promote a score.
  Evidence: `docs/eval/official-benchmark-task-coverage.json`, `docs/eval/spreadsheetbench-v1-912-model-run.json`, `docs/eval/spreadsheetbench-v1-verified-400-model-run.json`, `docs/eval/spreadsheetbench-v2-321-model-run.json`
- officialScorer: proven - Local workbook scores remain proxy evidence until accepted upstream V1 and V2 scorer receipts are imported.
  Evidence: `docs/eval/official-benchmark-readiness.json`, `docs/eval/spreadsheetbench-v1-accepted-official-scorer-receipt.json`, `docs/eval/spreadsheetbench-v2-accepted-official-scorer-receipt.json`

### BankerToolBench

- Source: BankerToolBench full 100-task suite
- Product surface: NodeRoom
- Task shape: official banking task -> NodeRoom fresh-room task -> generated deliverable package -> full-suite gate receipt
- Official scorer semantics: preserved

- officialTaskBundle: proven - Official task bundle is represented in the full-suite gate receipt and staged task evidence.
  Evidence: `docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json`, `docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json`, `docs/eval/bankertoolbench-stage-smoke.json`, `docs/eval/bankertoolbench-run-positive-smoke.json`, `docs/eval/bankertoolbench-official-contract.json`
- productTaskManifest: proven - Each official task is normalized into a NodeRoom fresh-room task with expected deliverable artifacts.
  Evidence: `proofloop/benchmarks/bankertoolbench/adapter.json`, `docs/eval/bankertoolbench-live-room-proof.json`
- nodeRoomRunSpec: proven - NodeRoom run spec covers all official tasks in the full-suite receipt.
  Evidence: `docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json`
- artifactExport: proven - Generated Excel, PowerPoint, Word, and PDF deliverables are packaged and reopened before scoring.
  Evidence: `proofloop/benchmarks/bankertoolbench/adapter.json`, `docs/eval/bankertoolbench-live-room-proof.json`
- officialSubmission: proven - Full-suite gate imports the official-style scoring receipt without changing the scorer claim.
  Evidence: `docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json`, `docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json`, `docs/eval/bankertoolbench-official-contract.json`
- officialScorer: proven - Official semantic score is only claimed from the full-suite gate receipt.
  Evidence: `docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json`, `docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json`, `docs/eval/bankertoolbench-official-contract.json`

### OpenRouter on Convex

- Source: NodeRoom model-route harness
- Product surface: NodeRoom
- Task shape: model-route eval case -> NodeRoom/Convex run contract -> route receipt
- Official scorer semantics: not_applicable

- officialTaskBundle: not_applicable - Model-route harness is an internal product benchmark, not an official public scorer.
  Evidence: `docs/eval/openrouter-convex-benchmark.json`
  Blockers: Model-route harness; not a public official benchmark score lane.
- productTaskManifest: proven - Model route cases are already expressed as NodeRoom/Convex product tasks.
  Evidence: `docs/eval/openrouter-convex-benchmark.json`
- nodeRoomRunSpec: proven - Run through the current NodeRoom Proof Loop command and receipt contract.
  Evidence: `docs/eval/openrouter-convex-benchmark.json`
- artifactExport: proven - Product evidence exports are the suite receipt bundle, trace, scorecard, cost ledger, and verifier receipt.
  Evidence: `docs/eval/openrouter-convex-benchmark.json`
- officialSubmission: not_applicable - Model-route harness is an internal product benchmark, not an official public scorer.
  Evidence: `docs/eval/openrouter-convex-benchmark.json`
  Blockers: Model-route harness; not a public official benchmark score lane.
- officialScorer: not_applicable - Model-route harness is an internal product benchmark, not an official public scorer.
  Evidence: `docs/eval/openrouter-convex-benchmark.json`
  Blockers: Model-route harness; not a public official benchmark score lane.

### Proximitty underwriting PR0

- Source: Synthetic underwriting Proof Loop suite
- Product surface: NodeRoom
- Task shape: synthetic underwriting task -> NodeRoom proof-loop run -> local receipt bundle
- Official scorer semantics: not_applicable

- officialTaskBundle: not_applicable - Synthetic underwriting demo; no official finance benchmark score should be claimed.
  Evidence: `proofloop/suites/proximitty-underwriting-pr0.json`
  Blockers: Synthetic underwriting suite; do not label as an official finance benchmark score.
- productTaskManifest: proven - Suite config defines product tasks, traces, receipts, clips, and local-first memory.
  Evidence: `.proofloop/runs/latest/run-result.json`, `.proofloop/runs/2026-07-02T20-31-20`
- nodeRoomRunSpec: proven - Run through the current NodeRoom Proof Loop command and receipt contract.
  Evidence: `.proofloop/runs/latest/run-result.json`, `.proofloop/runs/2026-07-02T20-31-20`
- artifactExport: proven - Product evidence exports are the suite receipt bundle, trace, scorecard, cost ledger, and verifier receipt.
  Evidence: `.proofloop/runs/latest/run-result.json`, `.proofloop/runs/2026-07-02T20-31-20`
- officialSubmission: not_applicable - Synthetic underwriting demo; no official finance benchmark score should be claimed.
  Evidence: `proofloop/suites/proximitty-underwriting-pr0.json`
  Blockers: Synthetic underwriting suite; do not label as an official finance benchmark score.
- officialScorer: not_applicable - Synthetic underwriting demo; no official finance benchmark score should be claimed.
  Evidence: `proofloop/suites/proximitty-underwriting-pr0.json`
  Blockers: Synthetic underwriting suite; do not label as an official finance benchmark score.

### Accounting proof-loop

- Source: Accounting Proof Loop suite
- Product surface: NodeRoom
- Task shape: accounting benchmark registry task -> NodeRoom proof-loop run -> receipt bundle
- Official scorer semantics: not_applicable

- officialTaskBundle: not_applicable - Accounting product runs are product-path evidence unless each upstream official scorer is imported.
  Evidence: `proofloop/accounting/benchmarks/benchmark-registry.json`
  Blockers: Accounting suite pins external benchmark families, but local proof-loop runs are product-path evidence.
- productTaskManifest: ready - Accounting registry pins benchmark-family tasks into product proof-loop cases.
  Evidence: `proofloop/accounting/proofloop.accounting.config.json`, `proofloop/accounting/benchmarks/benchmark-registry.json`
- nodeRoomRunSpec: ready - Run through the current NodeRoom Proof Loop command and receipt contract.
  Evidence: `proofloop/accounting/proofloop.accounting.config.json`, `proofloop/accounting/benchmarks/benchmark-registry.json`
- artifactExport: ready - Product evidence exports are the suite receipt bundle, trace, scorecard, cost ledger, and verifier receipt.
  Evidence: `proofloop/accounting/proofloop.accounting.config.json`, `proofloop/accounting/benchmarks/benchmark-registry.json`
- officialSubmission: not_applicable - Accounting product runs are product-path evidence unless each upstream official scorer is imported.
  Evidence: `proofloop/accounting/benchmarks/benchmark-registry.json`
  Blockers: Accounting suite pins external benchmark families, but local proof-loop runs are product-path evidence.
- officialScorer: not_applicable - Accounting product runs are product-path evidence unless each upstream official scorer is imported.
  Evidence: `proofloop/accounting/benchmarks/benchmark-registry.json`
  Blockers: Accounting suite pins external benchmark families, but local proof-loop runs are product-path evidence.

### Notion SDR/BDR proof-loop

- Source: Notion SDR/BDR Proof Loop suite
- Product surface: NodeRoom
- Task shape: sales workflow task -> NodeRoom/Notion proof-loop run -> receipt bundle
- Official scorer semantics: not_applicable

- officialTaskBundle: not_applicable - Sales workflow suite is a product benchmark, not a public official scorer.
  Evidence: `proofloop/notion/proofloop.notion.config.json`
  Blockers: Product workflow benchmark, not an official public benchmark score.
- productTaskManifest: ready - Notion config defines product-facing workflow tasks.
  Evidence: `proofloop/notion/proofloop.notion.config.json`
- nodeRoomRunSpec: ready - Run through the current NodeRoom Proof Loop command and receipt contract.
  Evidence: `proofloop/notion/proofloop.notion.config.json`
- artifactExport: ready - Product evidence exports are the suite receipt bundle, trace, scorecard, cost ledger, and verifier receipt.
  Evidence: `proofloop/notion/proofloop.notion.config.json`
- officialSubmission: not_applicable - Sales workflow suite is a product benchmark, not a public official scorer.
  Evidence: `proofloop/notion/proofloop.notion.config.json`
  Blockers: Product workflow benchmark, not an official public benchmark score.
- officialScorer: not_applicable - Sales workflow suite is a product benchmark, not a public official scorer.
  Evidence: `proofloop/notion/proofloop.notion.config.json`
  Blockers: Product workflow benchmark, not an official public benchmark score.

### Finch / FinWorkBench

- Source: Finch / FinWorkBench
- Product surface: NodeRoom
- Task shape: official Finch workflow task -> ProductTaskManifest -> NodeRoom run -> content_parts.jsonl submission -> canonical GPT-5-mini judge
- Official scorer semantics: preserved

- officialTaskBundle: ready - Official task bundle must be locked by repository/dataset revision before product expansion.
  Evidence: `docs/eval/proofloop-official-task-bundles/finch.json`
- productTaskManifest: partial - Current codebase has a local compatibility ProductTaskManifest; full official task-id expansion is still required.
  Evidence: `proofloop/benchmarks/finch/adapter.json`, `docs/eval/proofloop-external-adapter-live-room-runs/finch.json`, `docs/eval/proofloop-external-adapter-runs/finch.json`, `docs/eval/proofloop-adapter-blockers/finch.json`
  Blockers: Expand all 172 official Finch task ids into ProductTaskManifest rows.
- nodeRoomRunSpec: proven - Strict prod browser run spec exists for the local compatibility task through NodeRoom.
  Evidence: `proofloop/benchmarks/finch/adapter.json`, `docs/eval/proofloop-external-adapter-live-room-runs/finch.json`, `docs/eval/proofloop-external-adapter-runs/finch.json`, `docs/eval/proofloop-adapter-blockers/finch.json`
- artifactExport: proven - Export one NodeRoom model-output artifact per official Finch task id.
  Evidence: `proofloop/benchmarks/finch/adapter.json`, `docs/eval/proofloop-external-adapter-live-room-runs/finch.json`, `docs/eval/proofloop-external-adapter-runs/finch.json`, `docs/eval/proofloop-adapter-blockers/finch.json`, `docs/eval/proofloop-official-outputs/finch.json`, `docs/eval/proofloop-official-task-bundles/finch.json`, `.tmp/official-benchmarks/proofloop-official-outputs/finch/model-output-manifest.json`, `.tmp/official-benchmarks/proofloop-official-outputs/finch/eval_set/noderoom-source-workbook-baseline/content_parts.jsonl`, `.tmp/official-benchmarks/proofloop-official-outputs/finch`
- officialSubmission: proven - Submit content_parts.jsonl built by upstream prompt_build_pipeline.py to call_gpt_judge.py.
  Evidence: `docs/eval/proofloop-official-scores/finch.json`, `docs/eval/proofloop-official-outputs/finch.json`, `docs/eval/proofloop-official-task-bundles/finch.json`, `.tmp/official-benchmarks/proofloop-official-outputs/finch/model-output-manifest.json`, `.tmp/official-benchmarks/proofloop-official-outputs/finch/eval_set/noderoom-source-workbook-baseline/content_parts.jsonl`, `.tmp/official-benchmarks/proofloop-official-outputs/finch`, `.tmp/official-benchmarks/finch-canonical-hashbound/finch-judge-receipt.json`, `docs/eval/proofloop-official-score-imports/finch.json`
- officialScorer: proven - Upstream official scorer or judge output must be imported without changing the rubric.
  Evidence: `proofloop/benchmarks/finch/adapter.json`, `docs/eval/proofloop-adapter-blockers/finch.json`, `docs/eval/proofloop-official-scores/finch.json`, `docs/eval/proofloop-official-task-bundles/finch.json`, `docs/eval/proofloop-official-outputs/finch.json`, `.tmp/official-benchmarks/proofloop-official-outputs/finch/model-output-manifest.json`, `.tmp/official-benchmarks/proofloop-official-outputs/finch/eval_set/noderoom-source-workbook-baseline/content_parts.jsonl`, `.tmp/official-benchmarks/proofloop-official-outputs/finch`, `.tmp/official-benchmarks/finch-canonical-hashbound/finch-judge-receipt.json`, `docs/eval/proofloop-official-score-imports/finch.json`, `.proofloop/lanes/finch/blocker-analysis.json`

### FinAuditing

- Source: FinAuditing
- Product surface: NodeRoom
- Task shape: official FinSM/FinRE/FinMR row -> ProductTaskManifest -> NodeRoom run -> prediction JSONL -> official evaluator notebook
- Official scorer semantics: preserved

- officialTaskBundle: ready - Official task bundle must be locked by repository/dataset revision before product expansion.
  Evidence: `docs/eval/proofloop-official-task-bundles/finauditing.json`
- productTaskManifest: partial - Current codebase has a local compatibility ProductTaskManifest; full official task-id expansion is still required.
  Evidence: `proofloop/benchmarks/finauditing/adapter.json`, `docs/eval/proofloop-external-adapter-live-room-runs/finauditing.json`, `docs/eval/proofloop-external-adapter-runs/finauditing.json`, `docs/eval/proofloop-adapter-blockers/finauditing.json`
  Blockers: Expand FinSM, FinRE, and FinMR test rows into ProductTaskManifest rows.
- nodeRoomRunSpec: proven - Strict prod browser run spec exists for the local compatibility task through NodeRoom.
  Evidence: `proofloop/benchmarks/finauditing/adapter.json`, `docs/eval/proofloop-external-adapter-live-room-runs/finauditing.json`, `docs/eval/proofloop-external-adapter-runs/finauditing.json`, `docs/eval/proofloop-adapter-blockers/finauditing.json`
- artifactExport: proven - Export official-format prediction JSONL for FinSM, FinRE, and FinMR.
  Evidence: `proofloop/benchmarks/finauditing/adapter.json`, `docs/eval/proofloop-external-adapter-live-room-runs/finauditing.json`, `docs/eval/proofloop-external-adapter-runs/finauditing.json`, `docs/eval/proofloop-adapter-blockers/finauditing.json`, `docs/eval/proofloop-official-outputs/finauditing.json`, `docs/eval/proofloop-official-task-bundles/finauditing.json`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing/FinSM.predictions.jsonl`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing/FinRE.predictions.jsonl`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing/FinMR.predictions.jsonl`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing/manifest.json`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing`
- officialSubmission: proven - Submit official prediction JSONL rows with prediction and ground_truth fields to the evaluator notebooks.
  Evidence: `docs/eval/proofloop-official-scores/finauditing.json`, `docs/eval/proofloop-official-outputs/finauditing.json`, `docs/eval/proofloop-official-task-bundles/finauditing.json`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing/FinSM.predictions.jsonl`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing/FinRE.predictions.jsonl`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing/FinMR.predictions.jsonl`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing/manifest.json`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing`, `.tmp/official-benchmarks/finauditing-official/finmr-judge-receipt.json`, `docs/eval/proofloop-official-score-imports/finauditing.json`
- officialScorer: proven - Upstream official scorer or judge output must be imported without changing the rubric.
  Evidence: `proofloop/benchmarks/finauditing/adapter.json`, `docs/eval/proofloop-adapter-blockers/finauditing.json`, `docs/eval/proofloop-official-scores/finauditing.json`, `docs/eval/proofloop-official-task-bundles/finauditing.json`, `docs/eval/proofloop-official-outputs/finauditing.json`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing/FinSM.predictions.jsonl`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing/FinRE.predictions.jsonl`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing/FinMR.predictions.jsonl`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing/manifest.json`, `.tmp/official-benchmarks/proofloop-official-outputs/finauditing`, `.tmp/official-benchmarks/finauditing-official/finmr-judge-receipt.json`, `docs/eval/proofloop-official-score-imports/finauditing.json`, `.proofloop/lanes/finauditing/blocker-analysis.json`

### MBABench (formerly WorkstreamBench)

- Source: MBABench / WorkstreamBench
- Product surface: NodeRoom
- Task shape: official MBABench spreadsheet workstream -> ProductTaskManifest -> NodeRoom run -> judge case folder -> official LLM judge
- Official scorer semantics: preserved

- officialTaskBundle: ready - Official task bundle must be locked by repository/dataset revision before product expansion.
  Evidence: `docs/eval/proofloop-official-task-bundles/workstreambench.json`
- productTaskManifest: partial - Current codebase has a local compatibility ProductTaskManifest; full official task-id expansion is still required.
  Evidence: `proofloop/benchmarks/workstreambench/adapter.json`, `docs/eval/proofloop-external-adapter-live-room-runs/workstreambench.json`, `docs/eval/proofloop-external-adapter-runs/workstreambench.json`, `docs/eval/proofloop-adapter-blockers/workstreambench.json`
  Blockers: Expand the 38 locked public MBABench ModelOff task ids into ProductTaskManifest rows before claiming an official score.
- nodeRoomRunSpec: proven - Strict prod browser run spec exists for the local compatibility task through NodeRoom.
  Evidence: `proofloop/benchmarks/workstreambench/adapter.json`, `docs/eval/proofloop-external-adapter-live-room-runs/workstreambench.json`, `docs/eval/proofloop-external-adapter-runs/workstreambench.json`, `docs/eval/proofloop-adapter-blockers/workstreambench.json`
- artifactExport: proven - Export MBABench judge case folders with NodeRoom ai_attempt.xlsx files and locked solution workbooks.
  Evidence: `proofloop/benchmarks/workstreambench/adapter.json`, `docs/eval/proofloop-external-adapter-live-room-runs/workstreambench.json`, `docs/eval/proofloop-external-adapter-runs/workstreambench.json`, `docs/eval/proofloop-adapter-blockers/workstreambench.json`, `docs/eval/proofloop-official-outputs/workstreambench.json`, `docs/eval/proofloop-official-task-bundles/workstreambench.json`, `proofloop/benchmarks/workstreambench/scaffold-official-cases.ts`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench/case-manifest.json`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench`
- officialSubmission: proven - Submit MBABench judge case folders to the released official LLM judge/rubric.
  Evidence: `docs/eval/proofloop-official-scores/workstreambench.json`, `docs/eval/proofloop-official-outputs/workstreambench.json`, `docs/eval/proofloop-official-task-bundles/workstreambench.json`, `proofloop/benchmarks/workstreambench/scaffold-official-cases.ts`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench/case-manifest.json`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench/task_0/judge_results/scores.json`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench/task_0/judge_results/ai_judgement.json`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench/task_0/judge_results/_metadata.json`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench/task_0/judge_results/token_tracking.json`, `.tmp/official-benchmarks/workstreambench-official/mbabench-sweep-receipt.json`, `docs/eval/proofloop-official-score-imports/workstreambench.json`
- officialScorer: proven - Upstream official scorer or judge output must be imported without changing the rubric.
  Evidence: `proofloop/benchmarks/workstreambench/adapter.json`, `docs/eval/proofloop-adapter-blockers/workstreambench.json`, `docs/eval/proofloop-official-scores/workstreambench.json`, `docs/eval/proofloop-official-task-bundles/workstreambench.json`, `docs/eval/proofloop-official-outputs/workstreambench.json`, `proofloop/benchmarks/workstreambench/scaffold-official-cases.ts`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench/case-manifest.json`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench/task_0/judge_results/scores.json`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench/task_0/judge_results/ai_judgement.json`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench/task_0/judge_results/_metadata.json`, `.tmp/official-benchmarks/proofloop-official-outputs/workstreambench/task_0/judge_results/token_tracking.json`, `.tmp/official-benchmarks/workstreambench-official/mbabench-sweep-receipt.json`, `docs/eval/proofloop-official-score-imports/workstreambench.json`, `.proofloop/lanes/workstreambench/blocker-analysis.json`
