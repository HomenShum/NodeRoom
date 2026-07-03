# Finch / FinWorkBench official score Research

Generated: 2026-07-03T22:15:26.870Z
Blocker: finch-official-score

## Classes

- missing_judge_credentials
- missing_official_scorer
- missing_output_exporter
- missing_task_bundle

## Official Sources Checked

- proofloop/benchmarks/finch/adapter.json
- docs/eval/proofloop-official-task-bundles/finch.json

## Conclusion

Official judge credentials are external, but output generation/exporter work still has to complete first.

## Original Blockers

- finch: official scorer receipt docs/eval/proofloop-official-scores/finch.json is blocked_external; scored receipt is still required before claiming score.
- finch: official task bundle lock docs/eval/proofloop-official-task-bundles/finch.json is staged, but NodeRoom still needs one official-output artifact per Finch task id and an accepted upstream judge/scorer path; Azure OpenAI credentials are one path, while cheaper OpenRouter proxy judges are product-gate evidence only unless accepted upstream.
