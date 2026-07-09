# ProofLoop Preprod Readiness

Generated: 2026-07-08T19:48:48.066Z

Source rubric: [kevincui1034/preprod-check](https://github.com/kevincui1034/preprod-check) 1.2.0, MIT.

This receipt ports the preprod-check categories into a deterministic ProofLoop release gate. Agents may propose findings, but Critical/High findings must be verified by evidence before they block release.

## Summary

- Package version: 0.1.1
- Git commit: 8ef3fd5a2961b431118f5ff94132d4d0ee8ab8b2 (dirty)
- Release gate: passed
- Checks: 18 passed, 0 failed, 2 manual, 0 skipped
- Critical/High: 16/17 verified passed
- Blocking findings: 0
- Active waivers: 0
- Live checks passed: yes

## Checks

| Status | Severity | Category | Check | Evidence |
|---|---|---|---|---|
| pass | low | release safety | `preprod-source-attribution` - Preprod-check source attribution is recorded | https://github.com/kevincui1034/preprod-check |
| pass | critical | release safety | `prod-gate-chain` - Production gate chains security, typecheck, tests, browser product memory, build, and dist security | package.json:scripts.prod:gate |
| pass | high | release safety | `npx-proofloop-package-proof` - Published npx proofloop package is registry-verified end to end | docs/eval/proofloop-npx-package-proof.json<br>docs/eval/PROOFLOOP_NPX_PACKAGE_PROOF.md<br>https://www.npmjs.com/package/proofloop |
| pass | critical | perimeter | `static-security-headers` - Static Vercel security headers are configured | vercel.json<br>scripts/security-gate.ts |
| pass | critical | perimeter | `live-security-headers` - Production URL serves required security headers | https://noderoom.live<br>docs/eval/proofloop-preprod-readiness.json |
| pass | high | release safety | `live-story-smoke` - Production story smoke has run against the live URL | node scripts/story-route-dogfood.mjs --base-url https://noderoom.live<br>https://noderoom.live |
| pass | critical | perimeter | `browser-provider-egress` - Browser bundle is guarded from direct model-provider egress | scripts/security-gate.ts<br>tests/providerEgressPolicy.test.ts<br>src/nodeagent/guardrails/egressPolicy.ts |
| pass | critical | perimeter | `ssrf-upload-boundary` - SSRF and upload-storage boundaries have executable tests | tests/fetchSourceSsrf.test.ts<br>tests/fetchSourceNetworkGuard.test.ts<br>tests/convexFetchSourcePolicy.test.ts<br>tests/uploadedFileStorageContract.test.ts |
| pass | critical | perimeter | `secret-env-boundary` - .env.local is gitignored and tracked files are scanned for secret-shaped values | .gitignore<br>scripts/security-gate.ts |
| pass | critical | access | `auth-tenancy-boundary` - Room auth and private artifact tenancy boundaries have tests | convex/lib.ts<br>tests/authSessionPolicy.test.ts<br>tests/privateArtifactVisibility.test.ts<br>tests/convexBoundaryPolicy.test.ts |
| pass | high | money & abuse | `billing-credit-integrity` - Credit ledger and charge settlement paths have tests | convex/credits.ts<br>tests/creditLedger.test.ts<br>tests/convexCredits.test.ts |
| pass | high | money & abuse | `agent-cost-step-caps` - Agent runs have step, deadline, and cost accounting caps | convex/agent.ts<br>tests/openAiTokenLimit.test.ts<br>tests/costSimulator.test.ts |
| pass | high | money & abuse | `rate-limit-abuse` - Room join abuse is rate-limited and capped | convex/rooms.ts<br>scripts/security-gate.ts |
| pass | high | AI safety | `ai-llm-safety` - Prompt-injection, provider egress, and benchmark contamination defenses are tested | tests/promptInjection.test.ts<br>tests/providerEgressPolicy.test.ts<br>tests/benchmarkContamination.test.ts<br>src/nodeagent/guardrails/egressPolicy.ts |
| pass | high | reliability | `performance-scalability` - SLO and architecture budget gates are present | scripts/slo-gate.ts<br>scripts/architecture-budget-check.ts<br>tests/roomsMetaPhase2.test.ts |
| pass | medium | reliability | `logging-trace-workpapers` - Trace workpapers and ProofLoop artifacts are tested | tests/nodeagentTraceSpine.test.ts<br>tests/proofloopArtifacts.test.ts<br>src/nodeagent/traces/<br>src/eval/proofloopArtifacts.ts |
| pass | high | operations | `feature-kill-switch` - Known risky lanes have explicit feature gates or kill switches | convex/agent.ts<br>convex/roomActivity.ts<br>src/nodeagent/guardrails/egressPolicy.ts<br>docs/runbooks/PROOFLOOP_PREPROD_RUNBOOK.md |
| pass | high | operations | `release-runbook` - ProofLoop preprod release runbook is tracked | docs/runbooks/PROOFLOOP_PREPROD_RUNBOOK.md |
| manual | high | operations | `backup-restore-rehearsal` - External backup restore rehearsal evidence is attached | docs/runbooks/PROOFLOOP_PREPROD_RUNBOOK.md |
| manual | low | legal | `legal-compliance-surface` - Privacy, ToS, and data-deletion posture are a product/legal decision | docs/runbooks/PROOFLOOP_PREPROD_RUNBOOK.md |

## Manual Evidence Still Required

- backup-restore-rehearsal: Attach a dated restore rehearsal receipt before treating restore-readiness as proven.

## Live Probe

- URL: https://noderoom.live
- Root status: 200
- Headers ok: yes
- Story smoke: pass

| Header | Expected | Actual | Status |
|---|---|---|---|
| content-security-policy | default-src 'self' | default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://*.convex.cloud https://*.convex.site wss://*.convex.cloud wss://*.convex.site https://openrouter.ai; media-src 'self' blob: data:; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests | pass |
| content-security-policy | object-src 'none' | default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://*.convex.cloud https://*.convex.site wss://*.convex.cloud wss://*.convex.site https://openrouter.ai; media-src 'self' blob: data:; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests | pass |
| content-security-policy | frame-ancestors 'none' | default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://*.convex.cloud https://*.convex.site wss://*.convex.cloud wss://*.convex.site https://openrouter.ai; media-src 'self' blob: data:; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests | pass |
| strict-transport-security | max-age=63072000 | max-age=63072000; includeSubDomains; preload | pass |
| strict-transport-security | includeSubDomains | max-age=63072000; includeSubDomains; preload | pass |
| x-content-type-options | nosniff | nosniff | pass |
| x-frame-options | DENY | DENY | pass |
| referrer-policy | strict-origin-when-cross-origin | strict-origin-when-cross-origin | pass |
| permissions-policy | camera=() | camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=() | pass |
| permissions-policy | microphone=(self) | camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=() | pass |
| cross-origin-opener-policy | same-origin | same-origin | pass |

## Verified Critical/High

- `prod-gate-chain` (critical) via package script token check
- `npx-proofloop-package-proof` (high) via npm run benchmark:proofloop:npx-package -- --strict
- `static-security-headers` (critical) via vercel.json required header scan
- `live-security-headers` (critical) via live URL header probe
- `live-story-smoke` (high) via Playwright story-route dogfood
- `browser-provider-egress` (critical) via security-gate provider host scan
- `ssrf-upload-boundary` (critical) via required security test file presence
- `secret-env-boundary` (critical) via git check-ignore plus security-gate secret-pattern scan
- `auth-tenancy-boundary` (critical) via auth helper and test file presence
- `billing-credit-integrity` (high) via credit ledger implementation and tests
- `agent-cost-step-caps` (high) via agent run cap token scan plus tests
- `rate-limit-abuse` (high) via rooms.ts rate-limit token scan
- `ai-llm-safety` (high) via AI safety test file presence
- `performance-scalability` (high) via SLO and architecture gate file presence
- `feature-kill-switch` (high) via feature gate token scan plus runbook
- `release-runbook` (high) via tracked runbook file presence

## Recommendations

- Run the static preprod receipt before every ProofLoop release claim.
- Run the live preprod receipt against noderoom.live before claiming production is healthy.
- Treat unwaived Critical/High failures as ship blockers; keep manual ops checks visible until external evidence exists.
- Keep preprod findings as ProofLoop work items with owner, expiry, evidence, and waiver history.
