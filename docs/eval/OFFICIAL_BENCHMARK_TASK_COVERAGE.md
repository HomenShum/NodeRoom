# Official Benchmark Task Coverage

Generated: 2026-07-08T21:36:21.182Z

This is the no-shorthand ledger for the external benchmark question: have we staged and run every published task, or only a subset/fixture? It deliberately separates full official tracks, verified subsets, and NodeRoom's internal multi-user conflict suite.

## Summary

- Tracks complete: 2/5
- Declared task targets represented in this ledger: 1739
- Staged tasks: 1739
- Deterministic runner tasks: 1321
- Model-run cases: 106
- Model-run attempts: 118
- Strict full coverage ready: no

## Policy

- Do not collapse sampled N=5 evidence into a full official benchmark claim.
- A task is staged only when the agent-visible manifest is separated from evaluator gold and scorer metadata.
- A task is model-run only when candidate artifacts are emitted from an agent workspace before evaluator access opens.
- Full official coverage requires every published task for the named benchmark track, not only a verified subset or fixture.
- NodeRoom multi-user conflict tasks are an internal benchmark family; they complement SpreadsheetBench/BankerToolBench but do not replace them.

## Coverage Tracks

| Track | Status | Task Targets | Staged | Deterministic Run | Model Cases / Attempts | Pass Rate | Blockers |
|---|---:|---:|---:|---:|---:|---:|---|
| `spreadsheetbench-v1-full-912` | partial | 912 | 912 | 912 | 0 / 0 | 0.104 | Run all 912 tasks through the model runner or an approved chunked official-policy runner before claiming a model score. |
| `spreadsheetbench-v1-verified-400` | partial | 400 | 400 | 400 | 3 / 15 | 1.000 | 397 verified task(s) still need model-run evidence; current N=5 smoke covers 3/400 cases.; Full verified-score promotion still needs official scoring parity, not only local workbook scoring. |
| `spreadsheetbench-v2-full-321` | partial | 321 | 321 | 3 | 3 / 3 | 0.000 | Run every staged V2 task through the model runner, static workbook scorer, and rendered/VLM chart grader where applicable. |
| `bankertoolbench-full-100` | complete | 100 | 100 | 0 | 100 / 100 | 0.000 | none |
| `noderoom-multi-user-conflict` | complete | 6 | 6 | 6 | 0 / 0 | 1.000 | none |

## Evidence

### SpreadsheetBench V1 full benchmark

- Local scope: full public 912-task bundle staged and scored with deterministic copy-input baseline
- Sources: [https://github.com/RUCKBReasoning/SpreadsheetBench](https://github.com/RUCKBReasoning/SpreadsheetBench), [https://huggingface.co/datasets/KAKA22/SpreadsheetBench](https://huggingface.co/datasets/KAKA22/SpreadsheetBench)
- Evidence: `docs/eval/spreadsheetbench-v1-912-stage.json`, `docs/eval/spreadsheetbench-v1-912-copy-input-baseline.json`, `docs/eval/official-benchmark-readiness.json`

### SpreadsheetBench Verified 400 subset

- Local scope: verified-400 expert annotated subset
- Sources: [https://github.com/RUCKBReasoning/SpreadsheetBench](https://github.com/RUCKBReasoning/SpreadsheetBench), [https://shortcut.ai/blog/posts/spreadsheetbench-verified](https://shortcut.ai/blog/posts/spreadsheetbench-verified)
- Evidence: `docs/eval/spreadsheetbench-v1-full-stage-smoke.json`, `docs/eval/spreadsheetbench-v1-copy-input-full-smoke.json`, `docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json`

### SpreadsheetBench 2 full workflow benchmark

- Local scope: full public 321-task bundle staged with evaluator isolation
- Sources: [https://spreadsheetbench.github.io/](https://spreadsheetbench.github.io/), [https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2](https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2)
- Evidence: `docs/eval/spreadsheetbench-v2-full-ingest.json`, `docs/eval/spreadsheetbench-v2-full-stage.json`, `docs/eval/spreadsheetbench-v2-stage-smoke.json`, `docs/eval/spreadsheetbench-v2-run-smoke.json`, `docs/eval/spreadsheetbench-chart-visual-probe.json`

### BankerToolBench full investment-banking benchmark

- Local scope: full official 100-task clean generic-only full-suite receipt
- Sources: [https://github.com/Handshake-AI-Research/bankertoolbench](https://github.com/Handshake-AI-Research/bankertoolbench), [https://huggingface.co/datasets/handshake-ai-research/bankertoolbench](https://huggingface.co/datasets/handshake-ai-research/bankertoolbench)
- Evidence: `docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json`, `docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json`, `docs/eval/bankertoolbench-stage-smoke.json`, `docs/eval/bankertoolbench-run-positive-smoke.json`, `docs/eval/bankertoolbench-official-contract.json`

### NodeRoom multi-user conflict suite

- Local scope: internal deterministic conflict suite
- Sources: `evals/multiUserCoordinationProof.ts`
- Evidence: `docs/eval/multi-user-coordination-proof.json`, `evals/multiUserCoordinationProof.ts`

