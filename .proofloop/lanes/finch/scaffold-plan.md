# Finch / FinWorkBench official score Scaffold Plan

## Required Changes

- add Finch content_parts exporter
- add NodeRoom output manifest per official task id
- wire accepted Finch judge command adapter when credentials exist

## Remaining Local Classes

- missing_official_scorer
- missing_output_exporter
- missing_task_bundle

## Commands

- `emit NodeRoom outputs for every official Finch task id, run/import the accepted upstream Finch scorer or judge output, use npm run benchmark:proofloop:harness-economics for proxy triage, then npm run benchmark:proofloop:adapter-blockers -- --id finch --strict`
- `npm run proofloop -- setup finch --doctor`
- `npm run benchmark:proofloop:adapter-blockers -- --id finch`
- `npm run proofloop -- blocker scaffold finch-official-score`
- `npm run benchmark:proofloop:adapter-blockers -- --id finch --strict`

## Stop Rule

Do not promote this lane to official score until official-output-manifest.json and official-score-receipt.json are claimable.

Judge credentials can block official promotion, but they must not block local exporter/output scaffolding.
