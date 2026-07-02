# FinAuditing official score Research

Generated: 2026-07-02T20:46:40.282Z
Blocker: finauditing-official-score

## Classes

- missing_judge_credentials
- missing_official_scorer
- missing_output_exporter
- missing_task_bundle

## Official Sources Checked

- proofloop/benchmarks/finauditing/adapter.json
- docs/eval/proofloop-official-task-bundles/finauditing.json

## Conclusion

Accepted judge credentials are external, but official-format prediction export is local scaffold/run work.

## Original Blockers

- finauditing: official scorer receipt docs/eval/proofloop-official-scores/finauditing.json is blocked_external; scored receipt is still required before claiming score.
- finauditing: official task bundle lock docs/eval/proofloop-official-task-bundles/finauditing.json is staged, but NodeRoom still needs official-format FinSM/FinRE/FinMR prediction JSONL and an accepted FinMR judge path; OpenAI credentials are one path, while cheaper OpenRouter proxy judges are product-gate evidence only unless accepted upstream.
