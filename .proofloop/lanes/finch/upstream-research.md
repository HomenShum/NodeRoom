# Finch / FinWorkBench official score Research

Generated: 2026-07-08T21:36:32.791Z
Blocker: finch-official-score

## Classes

- missing_judge_credentials
- missing_official_scorer
- missing_output_exporter

## Official Sources Checked

- proofloop/benchmarks/finch/adapter.json
- docs/eval/proofloop-official-task-bundles/finch.json

## Conclusion

Official model-output artifacts are complete; upstream content_parts rendering and accepted judge import remain before official score promotion.

## Original Blockers

- finch: official scorer receipt docs/eval/proofloop-official-scores/finch.json is blocked_external; scored receipt is still required before claiming score.
- finch: official task bundle lock docs/eval/proofloop-official-task-bundles/finch.json is staged and NodeRoom model-output artifacts are complete in docs/eval/proofloop-official-outputs/finch.json; upstream content_parts rendering and an accepted Azure judge/scorer receipt are still required before claiming an official score. Cheaper OpenRouter proxy judges are product-gate evidence only unless accepted upstream.
