# SpreadsheetBench V1 full 912-task official score Scaffold Plan

## Required Changes

- convert staged 912-task bundle into chunked model-run work queue
- serialize model route and harness version on every candidate workbook
- write official score receipt only after scorer import

## Remaining Local Classes

- missing_model_run
- missing_official_scorer
- missing_task_bundle

## Commands

- `run all 912 SpreadsheetBench V1 tasks through the model runner, use npm run benchmark:proofloop:harness-economics to select cheap proxy routes for product iteration, then npm run benchmark:official:task-coverage -- --strict`
- `npm run benchmark:proofloop:harness-economics`
- `npm run benchmark:spreadsheetbench:run-chunked -- --suite v1 --all --model deepseek/deepseek-v4-pro`
- `npm run benchmark:official:task-coverage -- --strict`

## Stop Rule

Do not promote this lane to official score until official-output-manifest.json and official-score-receipt.json are claimable.
