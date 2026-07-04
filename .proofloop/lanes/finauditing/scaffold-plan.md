# FinAuditing official score Scaffold Plan

## Required Changes

- keep official-format FinSM/FinRE/FinMR prediction exporters reproducible
- wire FinBen/FinAuditing evaluator command
- block only at judge credential layer after predictions exist

## Remaining Local Classes

- missing_official_scorer

## Commands

- `run/import FinAuditing scorer output with an accepted FinMR judge path, use npm run benchmark:proofloop:harness-economics for proxy triage, then npm run benchmark:proofloop:adapter-blockers -- --id finauditing --strict`
- `npm run proofloop -- setup finauditing --doctor`
- `npm run benchmark:proofloop:adapter-blockers -- --id finauditing`
- `npm run benchmark:proofloop:official-outputs -- --id finauditing`
- `npm run benchmark:proofloop:adapter-blockers -- --id finauditing --strict`

## Stop Rule

Do not promote this lane to official score until official-output-manifest.json and official-score-receipt.json are claimable.

Judge credentials can block official promotion, but they must not block local exporter/output scaffolding.
