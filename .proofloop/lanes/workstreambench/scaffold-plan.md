# WorkstreamBench official score Scaffold Plan

## Required Changes

- convert the locked public ModelOff dataset into MBABench judge case folders
- write ai_attempt.xlsx outputs from NodeRoom without opening solution workbooks to the agent
- run/import the accepted MBABench judge output only after provider spend is explicitly approved

## Remaining Local Classes

- none

## Commands

- `npm run benchmark:proofloop:official-preflight -- --strict`
- `run/import the accepted MBABench official judge output after provider spend approval, then npm run benchmark:proofloop:adapter-blockers -- --id workstreambench --strict`
- `npm run proofloop -- setup workstreambench --doctor`
- `npm run benchmark:proofloop:adapter-blockers -- --id workstreambench`
- `npm run benchmark:proofloop:adapter-blockers -- --id workstreambench --strict`

## Stop Rule

Do not promote this lane to official score until official-output-manifest.json and official-score-receipt.json are claimable.

Judge credentials can block official promotion, but they must not block local exporter/output scaffolding.
