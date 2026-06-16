# NodeRoom Source Of Truth

One page. If a slide, README, or design note names something this table does not, this table wins.

## Wedge

NodeRoom is the live room where humans and AI agents do startup-banking diligence together: multiple people ask, multiple agents research with cited sources, findings land in a shared sheet, no write silently clobbers another, and every agent change is traceable and reviewable.

## Landed Source Of Truth

`src/nodeagent/**` is the canonical source tree. The old `src/agent/**` tree was removed after the repo import graph moved to NodeAgent, and the previous shared formula/rebase entrypoints were folded into nodeagent-owned modules.

The selected recursive-reasoning architecture is: **Omnigent outside, NodeAgent
inside, Convex underneath**. NodeAgent owns reasoning frames, context packs,
entity/facet cache, OKF evidence, verification, and managed writes. Omnigent is
an optional outer meta-harness for model/harness choice, policies, sessions, and
sandboxing; it is not the durable memory layer.

## Vocabulary Reconciliation

Design-intent names now live in `src/nodeagent/**`. Convex remains the durable backend, but frontend code, tests, scripts, and evals should import nodeagent modules directly.

| Design-intent name | Repo reality | Status |
|---|---|---|
| `src/nodeagent/{core,models,skills,guardrails}` namespace | Canonical implementation under `src/nodeagent/**`. | aligned |
| Pi Agent Core / pi-ai runtime | Custom `runAgent` loop in `src/nodeagent/core/runtime.ts` on the AI SDK, run inside Convex `"use node"` actions. | aligned to repo reality |
| Linkup search SDK + `linkupLogs` | `src/nodeagent/skills/search/fetchSource.ts`: SSRF-hardened bounded URL fetch with https-only, private-IP rejection, timeout, byte caps, and egress allowlist. | roadmap dependency; current bounded fetch is live |
| OpenRouter adaptive routing matrix | `AGENT_MODEL`, `AGENT_RESEARCH_MODEL`, model catalog helpers, and OpenRouter free/paid discovery scripts. | simpler than the design notes |
| MCP server exposing `nodeagent_*` tools | None. Tools are guarded by Convex permissions and schemas. | absent; do not build until there is a consumer |
| `.agent/` rules directory | Truth lives in `src/nodeagent/models/prompts/systemPrompt.ts`, `src/nodeagent/skills/spreadsheet/cellMutator.ts`, and `docs/NODEAGENT_ARCHITECTURE.md`. | absent; avoid duplicate drift |
| Convex Workflow + Workpool durable jobs | `@convex-dev/workflow` and `@convex-dev/workpool` are wired through Convex config/job files. | built |
| "Fable-like" recursive context / multi-frame reasoning | Harness-native frames in `src/nodeagent/core/reasoningFrames.ts`, context utilities in `contextPack.ts`, durable `agentReasoningFrames`, entity/facet `entityWorkItems`, room-local `entityResearchCache`, and a frame-claimed durable runner through `runReasoningFrame`. | built for durable room-work/entity-facet jobs; live multi-slice route proof remains hardening |
| Formula engine | `src/nodeagent/core/formulaEngine.ts`, imported by UI/engine and test-covered. | built and tested |
| Semantic Rebase | `SmartResolver` plus deterministic draft merge path. LLM resolver packet tables remain target-state. | partially built |
| Downstream connectors | `downstreamPublish` prepares Gmail, Notion, Slack, Linear, LinkedIn, and CRM draft artifacts only. | draft handoff; live OAuth is roadmap |

## Strongest Current Claims

- No-clobber wedge: per-cell CAS, locks, proposals, and traces prevent silent overwrites. Evidence: `tests/noClobberWedge.test.ts`, `tests/multiUserCoordinationProof.test.ts`, `convex/artifacts.ts`, `convex/locks.ts`.
- Finance and professional workflows: internal GTM/finance catalog, finance model, SpreadsheetBench-like, BankerToolBench-like, and OpenRouter-on-Convex harness tests are present. These are internal benchmark-faithful gates, not official public scores.
- Company research loop: `companyResearchPlan` and world-model context builders read pending/stale rows, fetch bounded sources, write evidence/review state, and preserve CRM fields.
- Private streaming agent: private replies stream to the requester's lane and persist. Do not claim generalized public token streaming.
- Multi-agent workbench: visible memory-mode demo and judged media exist. Startup diligence now has a two-clip evidence path: live create/join plus scripted synthesis/private/downstream.
- Fresh startup room: live mode now starts a new "Startup Banking Diligence War Room" by default. The `startup-diligence-live-join` walkthrough proves teammate join-by-code; `startup-diligence-war-room` proves the broader diligence workflow.
- OKF production path: the public Room NodeAgent has a Convex-backed OKF retrieval port, actor-aware public/private partitioning, literal source opening, retrieval telemetry, and an evidence write gate that can downgrade weak source-backed writes to `needs_review`.
- Harness-native recursive reasoning: room-work/entity-facet flows materialize
  durable phase/child frames, cache-first work items, job-detail frame trees, and
  frame-claimed durable slices that execute through `runReasoningFrame`. Safe
  claim: durable jobs with reasoning frames use this layer; fast inline/private
  consults are not forced through frames by default.
- Trace Lens and Banker Coach: review surfaces expose proof, trace, OKF telemetry, and gated builder context. Do not claim a full graph explorer or durable banker workflow object lifecycle yet.

## Authority Docs

1. [ARCHITECTURE.md](ARCHITECTURE.md) - layer map and managed-write contract.
2. [NODEAGENT_ARCHITECTURE.md](NODEAGENT_ARCHITECTURE.md), [AGENT_RUNTIME.md](AGENT_RUNTIME.md), [HARNESS_RECURSIVE_REASONING.md](HARNESS_RECURSIVE_REASONING.md), and [NODEAGENT_ADOPTION.md](NODEAGENT_ADOPTION.md) - the real agent harness, selected frame/cache/verifier upgrade, and runnable adoption path.
3. [architecture/CONVEX_AS_LEDGER.md](architecture/CONVEX_AS_LEDGER.md) - Convex-as-ledger boundaries and scaling rules.
4. [AGENT_EVAL.md](AGENT_EVAL.md) - agent evaluation method.
5. [demo/STARTUP_DILIGENCE_DEMO_PLAN.md](demo/STARTUP_DILIGENCE_DEMO_PLAN.md) - the next public demo script.
6. [demo/STARTUP_DILIGENCE_PROOF_LEDGER.md](demo/STARTUP_DILIGENCE_PROOF_LEDGER.md) - claim-by-claim proof ledger.
7. [demo/STARTUP_DILIGENCE_LATEST_REVIEW.md](demo/STARTUP_DILIGENCE_LATEST_REVIEW.md) - current safe demo/interview claim boundary after OKF production hardening.
8. [demo/NEXT_PRODUCT_DEMO_PUSH_REVIEW.md](demo/NEXT_PRODUCT_DEMO_PUSH_REVIEW.md) - repo/browser review for the next push.
9. [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md), [GAPS_NOT_DONE.md](GAPS_NOT_DONE.md), and [WEDGE.md](WEDGE.md) - readiness, gaps, and the frozen wedge.
10. [showcase/noderoom-diligence-deck.html](showcase/noderoom-diligence-deck.html) - lightweight deck scaffold.

## Do Not

- Do not recreate legacy agent entrypoints. New agent work belongs under `src/nodeagent/**`; legacy path reintroduction is blocked by import guards.
- Do not bypass Convex as durable backend. NodeAgent owns the agent implementation surface; Convex owns durable jobs, permissions, locks, writes, streams, and audit persistence.
- Do not imply JPM or bank affiliation. Use "startup-banking diligence" or "JPM-style workflow reference" only.
- Do not claim live OAuth connectors until user-authorized adapters exist and pass live tests.
- Do not claim official SpreadsheetBench or BankerToolBench scores until official fixtures, adapters, runs, and scorer outputs are recorded.
- Do not claim full production LiteParse/OCR worker coverage beyond the installed adapter/smoke lane.
- Do not describe recursive reasoning as a provider-specific "Fable mode" or as
  Omnigent YAML memory. It is a NodeAgent/Convex harness capability.
- Do not claim private consults use the full OKF tool graph by default; default private consults are read-only streamed replies unless promoted into room action.
- Do not claim Trace Lens is a full OKF graph explorer or full code-provenance system.
- Do not claim every Banker Coach cue/review round is automatically persisted as a first-class workflow object.

## Current Verification Snapshot

2026-06-16, `main` / `origin/main` at `2e2bfbf`:

- `npm run typecheck -- --pretty false`: pass.
- `npx tsc --noEmit --project convex\tsconfig.json --pretty false`: pass.
- `npm run build`: pass.
- `npm test -- --run`: 111 files, 579 tests pass.
- Focused OKF/provider/evidence gate: 4 files, 18 tests pass.
- `npm run qa:matrix:check`, `npm run security:gate`, `npm run slo:gate`, and `npm run content:fluency:check`: pass.
- `npm run test:product:live`: 17 Playwright/backend specs pass against the deployed backend.
- Convex production deployment: `aromatic-bass-102`, schema validation complete.
- Vercel production deployment: `noderoom.live` / `nodeagent.live` ready.
- Production OKF privacy smoke: owner-private concept/event visible to owner, hidden from peer search and Trace Lens.
- Live browser smoke: `https://noderoom.live` returns 200, renders expected app shell/title, and reports no console errors.

Browser/media evidence:

- Direct Playwright create/join verification renders the Startup Banking Diligence War Room with Mercury/Ramp/Brex research rows, a fresh room code, Maya and Priya in the same room, Priya's chat message, no guided-tour overlay, and Gmail/Notion/Slack/Linear/LinkedIn/CRM handoffs.
- `docs/walkthroughs/startup-diligence-live-join.mp4` shows a host creating a fresh room and a second user joining by code.
- `docs/walkthroughs/startup-diligence-war-room.mp4` shows the scripted research/enrichment, private lane, and downstream draft handoff story.
