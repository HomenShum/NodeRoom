# Startup Diligence Proof Ledger

Status: source-of-truth ledger for the public startup-diligence demo.

| Claim | Status | Evidence | Demo Wording |
|---|---|---|---|
| Humans and agents edit shared artifacts without silent clobbering | Built and tested | `tests/noClobberWedge.test.ts`, `tests/multiUserCoordinationProof.test.ts`, `convex/artifacts.ts`, `convex/locks.ts` | "No write silently overwrites another user's intent." |
| Private NodeAgent streams and persists a private reply | Built and tested | `convex/streaming.ts`, private stream UI and tests | "Your private NodeAgent streams to your own lane." |
| Public room agent leaves durable job/write/proposal traces | Built and tested | `convex/agentJobs.ts`, `convex/agentRuns.ts`, `convex/agentSteps.ts`, `tests/agentJobsRuntime.test.ts` | "The room sees durable status, writes, and trace receipts." |
| Company research loop writes sourced CellPayload-style evidence | Built and tested | `src/nodeagent/core/plans.ts`, `src/nodeagent/core/worldModel.ts`, `tests/researchHarness.test.ts`, `tests/professionalWorkflows.test.ts` | "Research cells carry evidence and review state." |
| Spreadsheet/finance workflows are evaluated | Built and tested internally | `tests/financeModelReliability.test.ts`, `tests/professionalRuntimeLive.test.ts`, `docs/eval/*` | "Internal professional workflow evals are green." |
| Multi-agent work queue is visible in the demo | Built in memory demo | `src/ui/Chat.tsx`, `docs/walkthroughs/multi-agent-workbench.mp4`, `docs/eval/gemini-media-judges/latest.md` | "One prompt can fan out into concurrent room work lanes." |
| Fresh room creation and teammate join flow | Built, captured, rendered, media-judged | `src/ui/App.tsx`, `src/ui/Landing.tsx`, `scripts/walkthroughs/capture.ts`, `scripts/walkthroughs/specs.ts` feature id `startup-diligence-live-join`, `docs/walkthroughs/startup-diligence-live-join.mp4`, `docs/walkthroughs/startup-diligence-live-join.gif`, `docs/eval/MEDIA_JUDGE.md` | "Start a fresh diligence room, share the code, and a teammate joins the same room." |
| Downstream Gmail/Notion/Slack/Linear/LinkedIn/CRM outputs | Draft handoff only | `src/nodeagent/skills/integration/downstreamPublish.ts`, `src/ui/RoomShell.tsx`, `src/ui/panels/Artifact.tsx` | "Downstream-ready drafts, not live connector writes." |
| LiteParse/local parser fallback | Dependency and smoke lane present | `package.json`, `src/app/liteparseAdapter.ts`, `scripts/liteparse-smoke.ts`, `tests/documentParserPlan.test.ts` | "Provider-first parsing with local LiteParse fallback under Node." |
| Dedicated startup diligence walkthrough | Recaptured/rendered/media-judged | `startup-diligence-live-join` scripts a three-user CardioNova/runway join flow; `startup-diligence-war-room` scripts CardioNova intake, five-company batch diligence, runway/milestone work, no-clobber proof, private banker lane, and draft-only downstream handoff; Gemini judge run `20260614T233419Z` rated both MP4s `publish` (`10.9/16` live join, `11.7/16` war room) | "Startup diligence walkthrough is aligned to the latest product target, with live shell proof plus deterministic agent-package proof." |
| Startup live-eval proof manifest | Contract eval and provider-produced eval green; N=5/p95 pending | `npm run eval:startup-diligence:live`, `npm run eval:startup-diligence:provider`, `scripts/startup-diligence-live-eval.ts`, `scripts/startup-diligence-provider-eval.ts`, `tests/startupDiligenceLiveEval.test.ts`, `docs/eval/startup-diligence-war-room-live.json`, `docs/eval/startup-diligence-war-room-live-results.json`, `docs/eval/startup-diligence-provider-results.json`, `docs/eval/startup-diligence-war-room-live.md` | "The repo distinguishes live shell proof, deterministic UI proof, Convex contract proof, provider-produced proof, and the remaining N=5/p95 promotion gate." |
| OKF-backed room agent retrieval | Built, privacy-hardened, deployed | `convex/convexRoomTools.ts`, `convex/okf.ts`, `src/nodeagent/retrieval/tools/okfTools.ts`, `tests/convexOkfRuntime.test.ts`, `tests/okfRetrieval.test.ts` | "The room agent can search shared OKF evidence through the live Convex RoomTools port." |
| OKF privacy partitioning | Built, tested, live-smoked | `convex/okf.ts`, `tests/convexOkfRuntime.test.ts`, production smoke on 2026-06-16 proved owner-private concept/event visibility did not leak to a peer | "OKF retrieval is partitioned by room, visibility, and owner." |
| Evidence write gate | Built and tested | `src/nodeagent/skills/spreadsheet/cellMutator.ts`, `tests/okfEvidenceWriteGate.test.ts` | "Weak or unsupported source-backed claims become needs-review, not complete." |
| Trace Lens review surface | Built and browser-smoked | `src/ui/traceLens/TraceLensPanel.tsx`, `src/ui/traceLens/useTraceLens.tsx`, `src/ui/artifacts/CoachCards.tsx`, `api.okf.traceLens`, `docs/demo/STARTUP_DILIGENCE_LATEST_REVIEW.md` | "Reviewers can inspect proof, trace, OKF context, and gated builder context from the surface." |
| Runway/milestone package | Helper and room artifact proven by contract eval | `src/nodeagent/skills/finance/runwayForecaster.ts`, `src/nodeagent/components/RunwayChart.tsx`, `tests/nodeagentAlignment.test.ts`, `scripts/startup-diligence-live-eval.ts`, `docs/eval/startup-diligence-war-room-live-results.json` | "Runway math and chart artifact generation are proven in the contract eval; provider-produced assumptions still gate production proof." |
| Live OAuth connector publishing | Roadmap | No user OAuth adapters wired or live-tested | Do not claim. |
| ClickHouse feedback analytics | Roadmap | No ClickHouse dependency or service | Do not claim. |
| Speculative shadow workflow/prescience layer | Roadmap | Design notes only | Do not claim as current product. |
| Official SpreadsheetBench/BankerToolBench score | Blocked until official-data runs | `docs/PRODUCTION_GUARANTEE_MATRIX.md`, `tests/officialBenchmarkReadiness.test.ts` | "Benchmark-faithful internal suite, official score pending." |

## Latest Local Verification

- `npm run typecheck -- --pretty false`: pass on 2026-06-16.
- `npx tsc --noEmit --project convex\tsconfig.json --pretty false`: pass on 2026-06-16.
- `npm run build`: pass on 2026-06-16; Vite reports only existing chunk-size warnings.
- `npm test -- --run`: 111 files, 579 tests pass on 2026-06-16.
- `npx vitest run tests/convexOkfRuntime.test.ts tests/okfEmbeddingProvider.test.ts tests/providerEgressPolicy.test.ts tests/okfEvidenceWriteGate.test.ts --reporter=dot`: 4 files, 18 tests pass on 2026-06-16.
- `npm run qa:matrix:check`, `npm run security:gate`, `npm run slo:gate`, and `npm run content:fluency:check`: pass on 2026-06-16.
- `npm run test:product:live`: 17 Playwright/backend specs pass against the deployed backend on 2026-06-16.
- Convex production deploy to `aromatic-bass-102`: pass on 2026-06-16.
- Vercel production deployment for `noderoom.live` / `nodeagent.live`: ready on 2026-06-16.
- Production OKF privacy smoke: pass on 2026-06-16; owner-private concept and retrieval event were visible to the owner, hidden from peer search and Trace Lens.
- Live browser smoke: `https://noderoom.live` returned 200, rendered the expected app shell/title, and reported no console errors on 2026-06-16.
- `npx convex dev --once`: synced Convex functions on 2026-06-14 after `FunctionPathNotFound` blocked live create.
- `npm run walkthroughs -- startup-diligence-war-room` and `npm run walkthroughs -- startup-diligence-live-join`: pass, 19 war-room segments and 13 live-join segments captured on 2026-06-14 against `http://127.0.0.1:5178`.
- `npm run walkthroughs:render -- startup-diligence-live-join` and `npm run walkthroughs:render -- startup-diligence-war-room`: pass, wrote MP4 and GIF for both startup clips on 2026-06-14; Remotion emitted a nonfatal zod version warning.
- `npm run media:gemini-judge -- --only startup-diligence --include-ignored`: publish for both startup MP4s on 2026-06-14, run `20260614T233419Z`; live-join scored `10.9/16`, war-room scored `11.7/16`; remaining defects are P2 presentation polish only: rapid user-perspective transition, dense trace text, and subtle Public-to-Private switch.
- 2026-06-14 target alignment update: `src/ui/Chat.tsx`, `scripts/walkthroughs/specs.ts`, and `scripts/walkthroughs/capture.ts` now reflect the CardioNova/bulk diligence/runway/no-clobber/private-handoff product target, and the MP4/GIF files have been regenerated from that script.
- Live-root guard rejects poisoned persisted session ids and skips room-scoped Convex subscriptions for unusable ids.
- Browser/Playwright visual pass: fresh live create/join renders the Startup Banking Diligence War Room, seeded Mercury/Ramp/Brex research, LinkedIn/CRM handoffs, Maya and Priya together in room `NR2TY6MLO9T`, Priya's public chat message, and no guided-tour overlay.
- `npm run eval:startup-diligence:live`: pass on 2026-06-14, 8/8 checks; writes `docs/eval/startup-diligence-war-room-live-results.json` and updates `docs/eval/startup-diligence-war-room-live.json`. This is a Convex contract proof with `providerProducedContent: false`.
- `npm run eval:startup-diligence:provider`: pass on 2026-06-14, 8/8 checks; Gemini 2.5 Flash generated the CardioNova `CellPayload` and final copy after Gemini 3.5 Flash returned no parseable JSON, wrote `docs/eval/startup-diligence-provider-results.json`, and recorded route/cost/runtime evidence (`ms=4238`, `costUsd=0.0008165`).
