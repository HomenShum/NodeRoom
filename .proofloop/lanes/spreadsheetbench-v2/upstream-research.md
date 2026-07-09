# SpreadsheetBench V2 full 321-task official score Research

Generated: 2026-07-08T21:36:31.791Z
Blocker: spreadsheetbench-v2-full-official-score

## Classes

- missing_model_run
- missing_official_scorer

## Official Sources Checked

- https://spreadsheetbench.github.io/
- https://github.com/RUCKBReasoning/SpreadsheetBench-2
- https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2
- docs/eval/spreadsheetbench-v2-full-stage.json

## Conclusion

Full V2 staging is available; model/scorer execution remains local scaffold/run work before official score promotion.

## Original Blockers

- Full public SpreadsheetBench V2 bundle is staged locally: 321/321 tasks, 321 agent-visible workbooks, 321 evaluator answer workbooks, zero gold/scorer leaks.
- All 321 V2 tasks need model-run, workbook scorer, and rendered chart-grader evidence; proxy judges can improve candidates but cannot stand in for the V2 scorer path.
