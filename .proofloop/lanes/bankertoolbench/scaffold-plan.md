# BankerToolBench model/harness quality sweep Scaffold Plan

## Required Changes

- cluster low-reward tasks by unmet criteria
- run model/harness sweep against official scorer
- promote best route only after score/cost receipt

## Remaining Local Classes

- harness_quality_failure

## Commands

- `npm run proofloop -- setup bankertoolbench --doctor`
- `npm run benchmark:bankertoolbench:official-contract`
- `npm run proofloop -- compare-models bankertoolbench`
- `npm run benchmark:bankertoolbench:fullsuite-gate -- --assert`

## Stop Rule

Do not promote this lane to official score until official-output-manifest.json and official-score-receipt.json are claimable.
