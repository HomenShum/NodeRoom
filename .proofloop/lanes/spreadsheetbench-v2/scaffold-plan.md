# SpreadsheetBench V2 full 321-task official score Scaffold Plan

## Required Changes

- keep the full 321-task official bundle staged under agent/evaluator isolation
- add rendered chart/visual scorer hook
- run model matrix across staged V2 tasks

## Remaining Local Classes

- missing_model_run
- missing_official_scorer

## Commands

- `run all 321 SpreadsheetBench V2 tasks and scorer/chart grader, use npm run benchmark:proofloop:harness-economics for proxy-model routing, then npm run benchmark:official:task-coverage -- --strict`
- `npm run benchmark:proofloop:harness-economics`
- `npm run benchmark:spreadsheetbench:stage -- --track spreadsheetbench-v2 --root .tmp/official-benchmarks/spreadsheetbench-v2-full/spreadsheetbench-v2 --output-root .tmp/official-benchmarks/staged-v2-full --json-out docs/eval/spreadsheetbench-v2-full-stage.json`
- `npm run benchmark:spreadsheetbench:run-chunked -- --stage-root .tmp/official-benchmarks/staged-v2-full --output-root .tmp/official-benchmarks/run-v2-full-model --json-out docs/eval/spreadsheetbench-v2-full-model-run.json --mode model-edit-plan --model deepseek/deepseek-v4-pro --chunk-size 25`

## Stop Rule

Do not promote this lane to official score until official-output-manifest.json and official-score-receipt.json are claimable.
