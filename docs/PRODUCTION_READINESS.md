<!-- Provenance: production-readiness audit + research/judge workflow wf_ac097fb8-b4d (2026-06-10),
     ground-truthed against the tree. The honest answer to "are we production-proven end to end?" -->

# Production readiness — gate by gate

"Production-proven end to end" is not a badge you self-award; it is a **per-gate** claim, and each
gate is only as proven as its strongest evidence. This matrix is the honest accounting: what is
**PROVEN** (a deterministic test exercises the failure mode), what is **IMPLEMENTED** (the control
ships but its proof needs a live deployment), and what still **NEEDS A LIVE AUDIT** (cannot be
settled in `convex-test` alone). NodeRoom is **live beta** until every NEEDS-LIVE-AUDIT row clears.

## Scope of this audit

This file covers the public-room production safety spine: no-clobber writes,
agent job reliability, public abuse controls, and deployment-only audit gates.
It does **not** claim that every product surface is production-complete. Broader
workflow gaps such as upload/view E2E, parser/OCR routing policy, resizable
panels, full browser privacy specs, professional spreadsheet eval expansion,
and SLO dashboards remain tracked in [`GAPS_NOT_DONE.md`](GAPS_NOT_DONE.md).

Security, accessibility, privacy, incident-response, retention/deletion, and
load/chaos readiness now have a dedicated teachable layer in
[`SECURITY_PRODUCTION_READINESS.md`](SECURITY_PRODUCTION_READINESS.md) plus local
Visual Plans under `plans/`. That layer is deliberately phrased as architecture
and regression primitives, not as a compliance claim: NIST CSF, OWASP ASVS,
WCAG 2.2, GDPR, and HIPAA-adjacent obligations require deployment evidence,
policies, access reviews, monitoring, restore drills, and vendor/legal work
before they can be represented as complete.

## Release gate status

`npm run prod:gate` is wired as a strict local release gate. It runs the
moderate-or-higher production dependency audit first, then QA matrix freshness,
content fluency, proof staleness, the deterministic SLO/load gate, app and
Convex typechecks, unit/runtime tests, deterministic memory-mode browser product
flows, and the production build.
`npm run prod:gate:live` adds the live Convex product gate, and
`npm run prod:gate:live:agent` adds the live provider-agent gate.

As of 2026-06-15, the moderate-or-higher production dependency audit passes:
`npm audit --omit=dev --audit-level=moderate` reports 0 production
vulnerabilities after the AI SDK provider upgrade and production transitive
overrides. Convex's transitive esbuild advisory is mitigated with an npm
override to `esbuild@0.28.1`, ExcelJS's transitive uuid advisory is mitigated
with an override to `uuid@11.1.1`, and the vulnerable production `ws` path is
pinned to `8.21.0`; these paths are covered by the full `npm run prod:gate`
compatibility floor. Secret scanning remains a pre-release manual requirement
until a dedicated scanner is added to the gate.

## Still open outside the core public-room gates

| Area | Status |
|---|---|
| Files, parser, OCR, and provider file cache adapters | Convex-mode uploads now store the raw file in Convex File Storage first, register an `uploadedFiles` row, and link parsed artifacts back to `sourceStorageId`; provider extraction preserves page/bbox/source-storage evidence metadata and the live provider parser is gated by provider-route/file-egress policy. The full parser/OCR worker path is not yet audited across PDF, DOCX/PPTX, images, screenshots, and layout. |
| Full browser E2E for every surface | Some browser specs exist; the red QA row stays until public/private chat, files, spreadsheet, wall, proposals, and job controls are covered together. |
| Long-running job operations | Workflow/Workpool continuation exists; job cancel/retry is requester-or-host gated, stale running-job leases are swept by cron, and `/free` carries artifact metadata into egress checks. Live `/free` polling evals, model quarantine, and provider request-idempotency hardening still need expansion. |
| Professional GTM/finance scale | Fixture catalog exists; more row-level evals and one live provider smoke per critical workflow are still needed. |
| Production observability | Retention and deterministic `npm run slo:gate` now exist; dashboards, trace export, trace-size caps, live browser/load proof, and SLO alerting are not yet complete. |

## The no-clobber spine — PROVEN

| Gate | Evidence |
|---|---|
| Per-element CAS (no silent overwrite) | `convex/artifacts.ts` `applyCellEditCore`; ladder L2/L3 + `tests/lockFencing.test.ts` |
| Affected-range locks, read-only for non-holders | `convex/locks.ts`; ladder L4 |
| Lease-epoch fencing (TTL < slice budget) + renewal | `convex/artifacts.ts`, `convex/lib.ts`; `tests/lockFencing.test.ts` (6/6) |
| Lock TTL janitor (status + session + smart-merge) | `convex/crons.ts` → `locks.sweepExpiredLocks`; tested |
| Host lock takeover (host-only) | `convex/locks.ts` `hostForceReleaseLock`; tested |
| Draft-for-merge / proposal review (host-gated approval, cross-room blocked) | `convex/artifacts.ts` `resolveProposal` (`requireActorProof` + host role) |
| Private-draft `ops` redaction (no cross-member leak) | `convex/rooms.ts` `full`; `tests/lockFencing.test.ts` |

## Core agent reliability — PROVEN offline

| Gate | Evidence |
|---|---|
| Durable slices + exactly-once journal (no double-bill on retry) | `tests/gatewayAndJournal.test.ts`, `tests/agentJobsRuntime.test.ts` |
| Idempotency (no concurrent double-run) | `tests/idempotencyRuntime.test.ts` |
| Stale job-lease janitor | `convex/crons.ts` -> `agentJobs.sweepExpiredJobLeases`; `tests/agentJobsRuntime.test.ts` proves expired `running` jobs become fenced failures and late stale slices hit `lease_mismatch`. |
| Per-run + per-slice token **and** USD spend ceilings | `src/nodeagent/core/runtime.ts` `priceStep` wired into `convex/agent.ts` + `agentJobRunner.ts`; `tests/gatewayAndJournal.test.ts` |
| Error-path handoff preserves unexecuted tool calls (resume-cursor integrity) | `src/nodeagent/core/runtime.ts`; `tests/gatewayAndJournal.test.ts` |
| PII/secret outbound redaction | `src/nodeagent/gateway.ts`; tested |
| Provider route allowlist and free-route fail-closed policy | `src/nodeagent/guardrails/egressPolicy.ts`; `tests/providerEgressPolicy.test.ts` |
| Provider-parser route/file-egress policy | `src/nodeagent/models/providerParserLive.ts`, `src/nodeagent/guardrails/egressPolicy.ts`; `tests/providerParserLive.test.ts`, `tests/providerEgressPolicy.test.ts` |
| Private-agent provider egress gate | `convex/agent.ts`, `convex/streaming.ts`, `convex/streamingModel.ts`; `tests/agentJobsSource.test.ts` |
| Deterministic SLO/load gate | `scripts/slo-gate.ts`; `docs/eval/slo-gate.json` |

These are offline or deterministic proofs of the core mechanisms. They do not
replace live provider/load evidence for OpenRouter data policy, high-concurrency
lease races, cron SLA, or public abuse behavior under real traffic.

## Abuse & safety surface (public, anonymously-joinable) — PROVEN

| Gate | Evidence |
|---|---|
| **Prompt injection** — room content reaches the model as fenced DATA, never instructions; forged fence-close neutralized | `src/nodeagent/core/worldModel.ts` `fenceUntrusted` + `systemPrompt.ts` TRUST BOUNDARY; `tests/promptInjection.test.ts` (4/4, incl. a behavioral "agent touches only its target despite a hostile sibling cell") |
| **Join rate limit + member cap** (10 joins/min sliding, 32 members/room) | `convex/rooms.ts` |
| **Room-code entropy floor** (server-enforced `[A-Z0-9]{6,12}`, ≈2.2B space) | `convex/rooms.ts` |
| **Cumulative daily USD cap per room** (bounds the SUM across `/ask` runs, not just one run) | `convex/agentRuns.ts` `roomSpendSince` + gate in `convex/agent.ts`; `tests/productionGates.test.ts` |
| **Global monthly USD cap with breach attribution** (`GLOBAL_MAX_USD_PER_MONTH`, default $75 — the $100-experiment gate; the breach error reports distinct rooms so it self-diagnoses as growth vs runaway; bounded read fails closed on truncation) | `convex/agentRuns.ts` `globalSpendSince` + gate in `convex/agent.ts`; `tests/productionGates.test.ts`; env armed on dev **and** prod (`0.50`/slice, `$3`/room-day, `$75`/month) |
| **Create/join/leave server contract** | `tests/createRoomAtomicity.test.ts` proves atomic starter-room creation; `tests/authSessionPolicy.test.ts` proves production identity can be required and `leave` revokes the member proof. Full live browser join recovery remains a live-audit item. |
| **Production identity mode** | `NODEROOM_REQUIRE_CONVEX_IDENTITY=1` makes room create/join require Convex Auth identity while token-only anonymous rooms remain available for demo/local mode. |
| **Telemetry retention** (traces/agentSteps/operation-events pruned past the window, product data untouched) | `convex/retention.ts` + `convex/crons.ts`; `tests/productionGates.test.ts` |
| Field-length caps (name/title) | `convex/rooms.ts` |

## IMPLEMENTED — control ships, proof needs the live deployment

| Gate | What ships | Why not yet PROVEN |
|---|---|---|
| Free-route data-policy filter | `OPENROUTER_REQUIRE_NO_TRAINING=1` excludes routes that *declare* training (`src/nodeagent/models/openRouterFreeModels.ts` `permitsTraining`) | Whether OpenRouter reliably exposes a per-model training flag — and honors it — is **unconfirmed**. The recommended `.env.example` value is on, while the code default remains off so existing deployments do not silently filter every model if the field is missing. Confirm with OpenRouter, then prove with a live provider audit. |
| Provider allowlist fail-closed mode | `PROVIDER_EGRESS_REQUIRE_ALLOWLIST=1` or `NODEROOM_PRODUCTION=1` blocks external providers unless `NODEAGENT_ALLOWED_PROVIDERS` / `PROVIDER_EGRESS_ALLOWED_PROVIDERS` is explicit. | Requires deployment env review and live smoke to confirm the intended provider list is set in staging/prod. |

## NEEDS A LIVE AUDIT — cannot be settled offline

1. **OpenRouter's actual data policy** — confirm the `/free` lane's providers honor a no-training flag; until then the README privacy note (keep sensitive data out of `/free`) is the real control.
2. **Rate-limiting under real concurrency** — Convex doesn't expose client IP, so the cap keys on actor/room; `npm run slo:gate` covers deterministic in-memory concurrency, but a staging load test (many concurrent anon joins) must confirm buckets hold.
3. **Cost-injection under live models** — a hostile prompt ("emit 250k tokens") is bounded by the per-run cap, but the cumulative daily cap needs a live run to confirm it trips.
4. **Lock fencing under high concurrency** — deterministic SLO/load and isolated unit proofs exist; 100+ live agents racing the same lock at the 5-min TTL boundary still needs a staging load test.
5. **Cron SLA** — the retention, lock-lease, and job-lease janitor crons assume reliable execution; production must monitor success + alert on a missed run.

## Bottom line

Every gate that *can* be proven offline **is** proven (tests above). The remaining work to retire
"beta" is a live security audit + load test of the five rows in the last section — not new
features. When those clear, this file's header line is the only thing that changes.
