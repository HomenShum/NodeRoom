# production-agent.json — declared gaps

The contract in `production-agent.json` declares only what exists in this repo. Where reality
and `schemas/production-agent.v1.schema.json` disagree, the contract stays truthful and this
note records the resulting validation failures instead of faking compliance.

## Known validation failures (intentional)

1. **`release.canary` omitted.** The schema's canary block requires `trafficPercent > 0`
   — a genuine traffic split. What exists instead (`.github/workflows/deploy-smoke.yml`)
   is a 100% deploy with a post-deploy smoke check and automatic rollback: on every
   Ready Vercel production deployment (`deployment_status` success, plus
   `workflow_dispatch` as the manual path) it greps the raw HTML of
   https://noderoom.live for the boot-shell testid and the landing `<title>` via
   `scripts/ship-prod-verify.mjs`, and on failure runs `vercel rollback` to the
   previous Ready deployment. That is `rollbackMode: automatic` but NOT a traffic
   split; declaring any `trafficPercent` would be fabrication, so the omission stands
   and the machinery is recorded here.

   **True traffic canary: deliberately skipped.** The frontend is a static Vite SPA;
   the risky surface is the Convex backend (`zealous-goshawk-766`), which deploys
   separately (`npm run ship:prod`) and is shared by every client at 100%. A
   cookie-sticky edge-middleware split could only serve two static shells against the
   one shared backend: it cannot canary Convex functions at all, and a canary frontend
   built against newer Convex function signatures would run version-skewed against the
   non-canary backend — the split is either a no-op (frontend-only change) or actively
   dangerous (frontend+backend change). A meaningful canary here means per-cohort
   Convex deployments, which Convex does not provide on this setup.
2. **`release.judgeRegression.trigger` omitted.** The real trigger is a nightly cron
   (`0 9 * * *`) plus `workflow_dispatch` in `.github/workflows/nightly-judge.yml`. The
   schema enum only allows `on-commit | on-pr | pre-deploy`; all three would be false.

## Truthful-but-lossy mappings (schema shape vs. reality)

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

## Operational notes

The deploy-smoke rollback needs the `VERCEL_TOKEN` repo secret (scope
`team_RRpVnMU6vxwAeiOQPTMkKGcZ`). If unset, the workflow still fails loudly on a bad
deploy but tells you to roll back manually instead of doing it itself. The
`deployment_status` trigger only fires while the Vercel GitHub integration is
connected; if it disconnects, run the workflow manually via `workflow_dispatch`.

The nightly judge job needs the `GOOGLE_GENERATIVE_AI_API_KEY` repo secret (already
referenced by `design-gate.yml`). If unset, `scripts/gemini-demo-media-judge.ts` throws and
the job fails honestly rather than skipping green.
