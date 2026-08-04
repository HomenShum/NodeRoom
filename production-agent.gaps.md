# production-agent.json — declared gaps

The contract in `production-agent.json` declares only what exists in this repo. Where reality
and `schemas/production-agent.v1.schema.json` disagree, the contract stays truthful and this
note records the resulting validation failures instead of faking compliance.

## Known validation failures (intentional)

1. **`release.canary` omitted.** The schema requires an automatic-rollback deploy canary.
   NodeRoom has none — no traffic-split deploy, no automatic rollback. Declaring one would
   be fabrication. Closing this gap means building a canary deploy path first.
2. **`release.judgeRegression.trigger` omitted.** The real trigger is a nightly cron
   (`0 9 * * *`) plus `workflow_dispatch` in `.github/workflows/nightly-judge.yml`. The
   schema enum only allows `on-commit | on-pr | pre-deploy`; all three would be false.

## Truthful-but-lossy mappings (schema shape vs. reality)

- **SLO latency is p95, not p99.** `scripts/slo-gate.ts` gates `p95RunMs <= 2500`. The
  schema's prose asks for p99-latency-ms; the repo does not measure p99, so the contract
  declares `p95RunMs`.
- **Cost fuse is per-run USD, not per-day.** `convex/agent.ts:643` caps `maxCostUsd` at $2
  per run. The schema only models `maxSpendUsdPerDay`, so the contract declares
  `maxTokensPerRun: 250000` and records the $2/run fuse in `onTrip` text.
- **Circuit breaker is consecutive-failure cooldown, not windowed error-rate.**
  `src/nodeagent/models/openRouterFreeModels.ts:285-287` trips on the first failure
  (cooldown 5min doubling per consecutive failure, 30min cap). Expressed as
  `errorRateThreshold: 1` (any failure of the last call trips the route).
- **Context strategy citations** (no free-text field in the schema's `context` block):
  retrieval-extraction = nodemem memory pack with budget-proportional trim and a 1200-token
  full / 600-token bounded budget (`convex/nodemem.ts:474`); summarization =
  `contextCompactor` `compactMessages` (`src/nodeagent/core/runtime.ts:915`).
- **Retry `maxDelayMs: 23400`** = third-retry base 18000ms (2000 * 3^2) plus max 30% jitter
  (`retryBackoffMs`, src/nodeagent/models/adapter.ts:192).

## Operational note

The nightly judge job needs the `GOOGLE_GENERATIVE_AI_API_KEY` repo secret (already
referenced by `design-gate.yml`). If unset, `scripts/gemini-demo-media-judge.ts` throws and
the job fails honestly rather than skipping green.
