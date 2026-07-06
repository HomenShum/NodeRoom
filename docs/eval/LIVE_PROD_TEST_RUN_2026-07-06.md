# Live Prod Test Run - 2026-07-06

Target: `https://noderoom.live`

## Passed

- Direct in-app browser load: production landing page loaded, `create-room` present.
- `npm run qa:story:prod`: passed with `ok=true` on `https://noderoom.live`.
- `npm run proofloop:live:underwriting`: passed in room `NRGN60LHKZI`; 10/10 correct, accuracy `1.0`, backend status `completed`.
- `npm run proofloop:live:underwriting:verify`: passed against canonical receipt `docs/eval/underwriting-hmda-live-proof.json`.
- `npx playwright test --config playwright.real-flow.config.ts e2e/underwriting-hmda-live.spec.ts`: initial prod browser run passed before the browser receipt path fix.
- `npx playwright test --config playwright.real-flow.config.ts e2e/uploaded-artifact-live-rendering.spec.ts`: passed 2/2 after correcting the XLSX binder-title assertion.
- `npx playwright test --config playwright.config.ts e2e/public-nodeagent-real-room.spec.ts`: passed 2/2 against prod after updating stream-child selectors.
- `npx tsc --noEmit --pretty false`: passed.
- `npx tsc --noEmit --project convex/tsconfig.json --pretty false`: passed.

## Failed Or Blocked

- `npm run proofloop:live:browser` initially failed before running due stale cockpit module resolution. Fixed imports to `proofloop/cockpit/overlay.ts`.
- Isolated `proofloop/live-browser-proof.spec.ts` one-task prod run reached room `PLMR8X7H6R`, proved fresh room, focus mode, visible stream, job detail, room trace, and prompt `@nodeagent`, but failed because the Q3 variance job did not complete within 90s and remained `running 1/1000`.
- BTB live-prod paid-model attempt reached room `NRJ7R50G7RX`, uploaded BTB fixture files, and passed live browser gates for fresh room, focus, visible stream, and job detail, but the model route `z-ai/glm-5.2` failed with OpenRouter `402 Insufficient credits`.
- BTB live-prod free-route attempt reached room `NRPIEYTYV2L`, uploaded BTB fixture files, and passed live browser gates for fresh room, focus, visible stream, and job detail, but the resolved route `z-ai/glm-4.7-flash` also failed with OpenRouter `402 Insufficient credits`.
- UI cancel for the BTB retrying job returned `Action failed - try again`; local Playwright runners were stopped to avoid waiting on 1000 retries.

## Fixes Applied During Run

- `e2e/uploaded-artifact-live-rendering.spec.ts`: match normalized XLSX binder title instead of raw filename.
- `proofloop/live-browser-proof.spec.ts`: import cockpit TypeScript module directly and force plain proof-loop goals through `@nodeagent`.
- `e2e/benchmark-ui-bankertoolbench.spec.ts`: import cockpit TypeScript module directly.
- `e2e/public-nodeagent-real-room.spec.ts`: accept current stream DOM (`agent-progress-card`, `step-start`, and `tool-*` parts).
- `e2e/underwriting-hmda-live.spec.ts`: write browser-specific proof to `docs/eval/underwriting-hmda-live-browser-proof.json` by default so it cannot overwrite the canonical verifier receipt.
- Root cause for free-route BTB credits: `/free` jobs with uploaded-file context were silently promoted from `openrouter/free-auto` to the configured file-egress model `z-ai/glm-4.7-flash`. Local fix now blocks that by default and requires `FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION=1` for an explicit paid promotion.
- Provider `402 Insufficient credits` is now classified as non-retryable so benchmark jobs fail fast instead of sitting at `retrying */1000`.

## Post-Fix Local Verification

- `npm test -- --run tests/providerEgressPolicy.test.ts tests/agentJobsRuntime.test.ts tests/agentJobsSource.test.ts`: passed.
- `npx tsc --noEmit --pretty false`: passed.
- `npx tsc --noEmit --project convex/tsconfig.json --pretty false`: passed.
- `npm run nodeagent:frame:smoke`: passed.
- `npm run omnigent:nodeagent:smoke`: passed.
- `npm test -- --run tests/frameRunner.test.ts`: passed.

## Final Deployed Live-Prod Slate

After deploying the Convex/runtime fixes and re-running the production suite:

- Convex production-serving deployment `zealous-goshawk-766`: synced with `npm run convex:deploy`.
- Vercel production deployment: `dpl_2shHR2jQwCufMaghDG2Dt1VbFRhh`, aliased to `https://noderoom.live` and `https://nodeagent.live`.
- `npm run proofloop:live:prod -- --continue-on-failure`: passed after that redeploy.
- Final corrected receipt after Convex-env provider preflight: `docs/eval/live-prod/live-prod-20260706T231618Z/suite-receipt.json`.
- Production URL: `https://noderoom.live`.
- Passed steps: QA story, HMDA live underwriting, HMDA verifier, uploaded artifact rendering, public `@nodeagent`, and deterministic generic ProofLoop browser.
- Generic ProofLoop Q3 variance task passed in room `PLMR9UBI6H` with `5/5` required patterns in `22015ms`.
- BTB was not run in the final slate because the provider preflight receipt failed with `provider_insufficient_credits`. The corrected receipt verifies `OPENROUTER_API_KEY` is present in the production-serving Convex env, but the remaining credit bucket is below the configured threshold. The suite recorded this as an explicit provider-gated skip instead of starting a doomed benchmark job.

## Current Truth

The live underwriting path is green on prod with verifier receipt. General prod upload/render, public NodeAgent smoke, and the scoped generic ProofLoop Q3 browser task are green against deployed prod. BTB remains provider-credit-gated only: the harness now checks the production-serving Convex env, verifies the OpenRouter key is present, writes a redacted preflight receipt, and skips BTB when credits are below threshold. Provider `402` errors are classified as non-retryable so prod cannot burn a `1000`-retry loop on insufficient credits.
