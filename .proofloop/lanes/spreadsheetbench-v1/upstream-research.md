# SpreadsheetBench V1 full 912-task official score Research

Generated: 2026-07-04T02:24:04.971Z
Blocker: spreadsheetbench-v1-full-official-score

## Classes

- missing_model_run
- missing_official_scorer

## Official Sources Checked

- https://github.com/RUCKBReasoning/SpreadsheetBench
- https://huggingface.co/datasets/KAKA22/SpreadsheetBench

## Conclusion

Local model-run work remains: the 912-task bundle is staged, but full model outputs are not complete.

## Original Blockers

- Full public 912-task SpreadsheetBench V1 bundle is staged and deterministically scored: 912/912 tasks, 2,729 agent-visible workbooks, 2,729 evaluator answer workbooks, 95/912 copy-input baseline pass.
- All 912 tasks need model-run evidence before strict official-score promotion; cheaper OpenRouter proxy judges can triage product quality but cannot replace the SpreadsheetBench workbook scorer for the official claim.
