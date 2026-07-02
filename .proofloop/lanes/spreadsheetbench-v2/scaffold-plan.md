# SpreadsheetBench V2 full 321-task official score Scaffold Plan

## Required Changes

- stage full 321-task official bundle
- add rendered chart/visual scorer hook
- run model matrix across staged V2 tasks

## Remaining Local Classes

- missing_model_run
- missing_official_scorer
- missing_task_bundle

## Commands

- `stage the full SpreadsheetBench V2 321-task bundle, run all tasks and scorer/chart grader, use npm run benchmark:proofloop:harness-economics for proxy-model routing, then npm run benchmark:official:task-coverage -- --strict`
- `npm run benchmark:proofloop:harness-economics`
- `npm run benchmark:spreadsheetbench:v2:stage -- --all`
- `npm run benchmark:spreadsheetbench:run-chunked -- --suite v2 --all --model deepseek/deepseek-v4-pro`

## Stop Rule

Do not promote this lane to official score until official-output-manifest.json and official-score-receipt.json are claimable.
