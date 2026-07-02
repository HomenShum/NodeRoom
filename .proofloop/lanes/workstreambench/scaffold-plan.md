# WorkstreamBench official score Scaffold Plan

## Required Changes

- continue upstream research
- create proxy suite receipt with proxy_only flag
- refuse official claim until upstream bundle/scorer is released or supplied

## Remaining Local Classes

- none

## Commands

- `obtain the official WorkstreamBench task bundle and scorer/rubric from an upstream release or authors, lock it in docs/eval/proofloop-official-task-bundles/workstreambench.json, use npm run benchmark:proofloop:harness-economics for proxy triage, import a scored receipt, then npm run benchmark:proofloop:adapter-blockers -- --id workstreambench --strict`
- `npm run proofloop -- setup workstreambench --doctor`
- `npm run benchmark:proofloop:adapter-blockers -- --id workstreambench`
- `npm run proofloop -- blocker research workstreambench-official-score`
- `npm run benchmark:proofloop:adapter-blockers -- --id workstreambench --strict`

## Stop Rule

Do not promote this lane to official score until official-output-manifest.json and official-score-receipt.json are claimable.
