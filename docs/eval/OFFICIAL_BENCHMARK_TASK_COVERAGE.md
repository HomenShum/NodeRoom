# Official Benchmark Task Coverage

Generated: 2026-07-10T14:12:02.270Z

This is the no-shorthand ledger for the external benchmark question: have we staged and run every published task, or only a subset/fixture? It deliberately separates full official tracks, verified subsets, and NodeRoom's internal multi-user conflict suite.

## Summary

- Tracks complete: 5/5
- Declared task targets represented in this ledger: 1739
- Staged tasks: 1739
- Deterministic runner tasks: 1639
- Model-run cases: 1733
- Model-run attempts: 1733
- Local/proxy output receipts: 1233
- Strict full coverage ready: yes

## Policy

- Do not collapse sampled N=5 evidence into a full official benchmark claim.
- A task is staged only when the agent-visible manifest is separated from evaluator gold and scorer metadata.
- A task is model-run only when candidate artifacts are emitted from an agent workspace before evaluator access opens.
- Full official coverage requires every published task for the named benchmark track, not only a verified subset or fixture.
- NodeRoom multi-user conflict tasks are an internal benchmark family; they complement SpreadsheetBench/BankerToolBench but do not replace them.

## Coverage Tracks

| Track | Status | Task Targets | Staged | Deterministic Run | Model Cases / Attempts | Proxy Output Receipts | Pass Rate | Blockers |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `spreadsheetbench-v1-full-912` | complete | 912 | 912 | 912 | 912 / 912 | 912 | 0.098 | none |
| `spreadsheetbench-v1-verified-400` | complete | 400 | 400 | 400 | 400 / 400 | 0 | 0.035 | none |
| `spreadsheetbench-v2-full-321` | complete | 321 | 321 | 321 | 321 / 321 | 321 | 0.000 | none |
| `bankertoolbench-full-100` | complete | 100 | 100 | 0 | 100 / 100 | 0 | 0.000 | none |
| `noderoom-multi-user-conflict` | complete | 6 | 6 | 6 | 0 / 0 | 0 | 1.000 | none |

## Evidence

### SpreadsheetBench V1 full benchmark

- Local scope: full public 912-task bundle staged and scored through the isolated model runner
- Sources: [https://github.com/RUCKBReasoning/SpreadsheetBench](https://github.com/RUCKBReasoning/SpreadsheetBench), [https://huggingface.co/datasets/KAKA22/SpreadsheetBench](https://huggingface.co/datasets/KAKA22/SpreadsheetBench)
- Evidence: `docs/eval/spreadsheetbench-v1-912-stage.json`, `docs/eval/spreadsheetbench-v1-912-copy-input-baseline.json`, `docs/eval/spreadsheetbench-v1-912-model-run.json`, `docs/eval/spreadsheetbench-v1-912-local-proxy-output-receipts.json`, `docs/eval/official-benchmark-readiness.json`

### SpreadsheetBench Verified 400 subset

- Local scope: verified-400 expert annotated subset
- Sources: [https://github.com/RUCKBReasoning/SpreadsheetBench](https://github.com/RUCKBReasoning/SpreadsheetBench), [https://shortcut.ai/blog/posts/spreadsheetbench-verified](https://shortcut.ai/blog/posts/spreadsheetbench-verified)
- Evidence: `docs/eval/spreadsheetbench-v1-full-stage-smoke.json`, `docs/eval/spreadsheetbench-v1-copy-input-full-smoke.json`, `docs/eval/spreadsheetbench-v1-verified-400-model-run.json`

### SpreadsheetBench 2 full workflow benchmark

- Local scope: full public 321-task bundle staged with evaluator isolation
- Sources: [https://spreadsheetbench.github.io/](https://spreadsheetbench.github.io/), [https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2](https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2)
- Evidence: `docs/eval/spreadsheetbench-v2-full-ingest.json`, `docs/eval/spreadsheetbench-v2-full-stage.json`, `docs/eval/spreadsheetbench-v2-stage-smoke.json`, `docs/eval/spreadsheetbench-v2-321-model-run.json`, `docs/eval/spreadsheetbench-v2-321-local-proxy-output-receipts.json`, `docs/eval/spreadsheetbench-chart-visual-probe.json`

### BankerToolBench full investment-banking benchmark

- Local scope: full official 100-task clean generic-only full-suite receipt
- Sources: [https://github.com/Handshake-AI-Research/bankertoolbench](https://github.com/Handshake-AI-Research/bankertoolbench), [https://huggingface.co/datasets/handshake-ai-research/bankertoolbench](https://huggingface.co/datasets/handshake-ai-research/bankertoolbench)
- Evidence: `docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json`, `docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json`, `docs/eval/bankertoolbench-stage-smoke.json`, `docs/eval/bankertoolbench-run-positive-smoke.json`, `docs/eval/bankertoolbench-official-contract.json`

### NodeRoom multi-user conflict suite

- Local scope: internal deterministic conflict suite
- Sources: `evals/multiUserCoordinationProof.ts`
- Evidence: `docs/eval/multi-user-coordination-proof.json`, `evals/multiUserCoordinationProof.ts`

