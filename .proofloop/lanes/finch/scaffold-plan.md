# Finch / FinWorkBench official score Scaffold Plan

## Required Changes

- retry upstream Finch content_parts rendering against the complete model-output manifest
- wire accepted Finch judge command adapter when credentials exist

## Remaining Local Classes

- none

## Commands

- `npm run benchmark:proofloop:official-preflight -- --strict`
- `run/import the accepted Finch Azure scorer or judge output, then npm run benchmark:proofloop:adapter-blockers -- --id finch --strict`
- `npm run proofloop -- setup finch --doctor`
- `npm run benchmark:proofloop:adapter-blockers -- --id finch`
- `npm run benchmark:proofloop:official-outputs -- --id finch`
- `npm run benchmark:proofloop:adapter-blockers -- --id finch --strict`

## Stop Rule

Do not promote this lane to official score until official-output-manifest.json and official-score-receipt.json are claimable.

Judge credentials can block official promotion, but they must not block local exporter/output scaffolding.
