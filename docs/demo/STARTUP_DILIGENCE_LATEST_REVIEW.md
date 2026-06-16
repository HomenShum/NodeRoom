# Startup Diligence Latest Review

Status: current demo and claim boundary after OKF production hardening. This is the safe public story for NodeRoom, not a production-completeness claim.

Date: 2026-06-16

Main commit: `2e2bfbf Merge OKF production hardening`

## Current Thesis

NodeRoom is a live AI diligence workroom. Convex keeps the room authoritative. OKF turns room work into portable, searchable evidence. The public Room NodeAgent uses OKF retrieval plus managed CAS writes to update shared artifacts without silently clobbering humans. Private agents stay private by default, and only act in the room when explicitly promoted. Trace Lens and Banker Coach make the work inspectable enough for humans to review, defend, and turn into client-ready work.

The hard boundary remains:

> NodeRoom does not claim autonomous client-ready banking output. It makes agent work evidence-backed, inspectable, reviewable, and safer to turn into client-ready output.

## What Is Proven On Main

| Layer | Current status | Evidence |
|---|---|---|
| Clean merged repo | `main` matches `origin/main` at `2e2bfbf` | `git status --short --branch` |
| Convex live ledger | Room state, artifacts, locks, proposals, jobs, traces, streams, and OKF rows persist in Convex | `convex/schema.ts`, `convex/rooms.ts`, `convex/artifacts.ts`, `convex/agentJobs.ts`, `convex/okf.ts` |
| Room NodeAgent OKF access | Production RoomTools include a Convex-backed OKF retrieval port | `convex/convexRoomTools.ts`, `src/nodeagent/retrieval/tools/okfTools.ts` |
| OKF permissions | OKF concepts, chunks, retrieval events, graph edges, and Trace Lens output are filtered by room, visibility, and owner | `convex/okf.ts`, `tests/convexOkfRuntime.test.ts` |
| Evidence-bearing writes | Unsupported source-backed cell writes are downgraded to `needs_review` instead of being marked complete | `src/nodeagent/skills/spreadsheet/cellMutator.ts`, `tests/okfEvidenceWriteGate.test.ts` |
| Managed no-clobber write path | Agent writes use lock/CAS/proposal/review paths rather than overwriting human work | `convex/artifacts.ts`, `convex/locks.ts`, `tests/noClobberWedge.test.ts`, `tests/multiUserCoordinationProof.test.ts` |
| Trace Lens review surface | Cmd/Ctrl-click review mode exposes proof, trace, OKF concepts/events, and gated builder/code context | `src/ui/traceLens/TraceLensPanel.tsx`, `src/ui/traceLens/useTraceLens.tsx`, `api.okf.traceLens` |
| Banker Coach review surface | Coach cards summarize evidence, review state, handoff readiness, and Trace Lens/OKF context | `src/ui/artifacts/BankerCoachPanel.tsx`, `src/ui/artifacts/CoachCards.tsx` |
| Startup demo media | Latest startup join and war-room clips are rendered and media-judged as publishable with P2 polish notes | `docs/walkthroughs/startup-diligence-live-join.mp4`, `docs/walkthroughs/startup-diligence-war-room.mp4`, `docs/eval/MEDIA_JUDGE.md` |

## OKF Architecture

The current safe architecture statement is:

> Convex is the live room ledger. OKF is the portable evidence graph. NodeAgent retrieves OKF candidates, opens literal sources, checks support, and then writes through managed CAS/proposal paths.

Current OKF runtime pieces:

- `okfConcepts`: room-scoped concepts such as Company, Source, Spreadsheet Cell, Metric, Agent Trace, Review Round, Coach Cue, and Eval Result.
- `okfChunks`: searchable chunks with compact vectors and full-text fields.
- `okfEdges`: graph links and citations between concepts.
- `okfOutbox`: indexing jobs and retry state.
- `retrievalEvents`: tool/query telemetry with provider, model, latency, visibility, owner, and hit ids.
- `ConvexRoomTools.okf`: live RoomTools port for the production room agent.

Safe claim:

> OKF is production-wired for the Room NodeAgent and review UI.

Do not claim yet:

> OKF is a complete graph browser, multimodal OCR system, or warehouse-scale analytics engine.

## Public Vs Private Agent Behavior

| Agent mode | OKF tool access | Shared-room writes | Demo wording |
|---|---:|---:|---|
| Public Room NodeAgent | Yes, through `ConvexRoomTools.okf` and `*ForAgent` queries | Yes, through managed lock/CAS/proposal tools | "The room agent searches shared OKF evidence before writing reviewable artifacts." |
| Private default consult | No tools by default; summarized private room context | No | "Your private agent is a read-only streamed consult unless you promote work into the room." |
| Private Room/publish mode | Yes, through the same room-agent tool path with owner attribution | Yes, only after explicit room/publish action | "Private reasoning can become room work only through an explicit promoted action path." |

This split is intentional. It keeps the default private lane cheaper and safer, while preserving a tool-backed path for user-approved room actions.

## Trace Lens And Banker Coach

Trace Lens is now a review-mode primitive:

- It can show the business proof for a surface.
- It can show runtime trace context and OKF telemetry.
- It keeps builder/code context gated.
- It should be used in the demo to explain why a cell, chart, or coach cue exists.

Banker Coach is now safe to describe as:

> A banker-readable review surface generated from room artifacts, traces, and OKF telemetry.

Do not describe it as:

> A fully durable banker workflow operating system where every coach cue and review round is automatically persisted as a first-class object.

That durable lifecycle is the next layer.

## Safe Demo Claims

Use these:

- "The room is live in Convex."
- "The agent searches OKF-backed room evidence before making source-backed writes."
- "Weak evidence becomes `needs_review` instead of being marked complete."
- "Agent edits go through managed lock/CAS/proposal paths."
- "Trace Lens lets a reviewer inspect the evidence and runtime context behind a surface."
- "Private agents stream privately by default and do not mutate shared artifacts unless the user promotes the work."
- "Downstream handoffs are draft-only until a human approves them."
- "The benchmark work is internal and benchmark-faithful; official benchmark scores are not claimed."

## Claims To Avoid

Avoid these until new proof exists:

- "Autonomous client-ready banking output."
- "Private consults use the full OKF tool graph by default."
- "Full OKF graph explorer is shipped."
- "Every Banker Coach cue is a durable workflow object."
- "Gemini/LiteParse multimodal extraction is fully production-proven for every file type."
- "ClickHouse or warehouse-backed long-retention analytics is live."
- "Official SpreadsheetBench or BankerToolBench dominance."
- "Live OAuth connector publishing."

## Engineer Receipt Cards

| Receipt | Files to point at | What it proves |
|---|---|---|
| Convex as ledger | `convex/schema.ts`, `convex/rooms.ts`, `convex/artifacts.ts`, `convex/agentJobs.ts` | Durable room state, jobs, writes, traces, and permissions live in Convex. |
| OKF port wiring | `convex/convexRoomTools.ts`, `src/nodeagent/retrieval/types.ts`, `src/nodeagent/retrieval/tools/okfTools.ts` | The production room agent has a real OKF retrieval port. |
| Privacy partition | `convex/okf.ts`, `tests/convexOkfRuntime.test.ts` | Public/redacted/private OKF rows are filtered by requester and owner. |
| Evidence write gate | `src/nodeagent/skills/spreadsheet/cellMutator.ts`, `tests/okfEvidenceWriteGate.test.ts` | Weak evidence cannot silently become a complete source-backed cell. |
| No-clobber | `convex/artifacts.ts`, `convex/locks.ts`, `tests/noClobberWedge.test.ts` | Agent writes cannot silently overwrite live human intent. |
| Trace Lens | `src/ui/traceLens/TraceLensPanel.tsx`, `src/ui/traceLens/useTraceLens.tsx`, `src/ui/artifacts/CoachCards.tsx` | Review surfaces can expose proof, trace, and gated builder context. |
| Private consult boundary | `convex/streaming.ts`, `convex/streamingModel.ts`, `convex/agent.ts` | Default private consults are read-only streamed replies. |

## Three-Minute Video Implications

The next walkthrough should make these beats explicit:

1. Start in a fresh startup-banking diligence room.
2. Show a teammate joining by room code.
3. Ask the room agent to enrich company diligence with source-backed evidence.
4. Show cells written as evidence/review payloads, not loose scalar claims.
5. Show a weak/unsupported write becoming `needs_review`.
6. Cmd/Ctrl-click a cell or coach cue to open Trace Lens.
7. Show a private consult staying private.
8. Promote or act in-room only after an explicit user action.
9. Show downstream Gmail/Notion/Slack/Linear/LinkedIn/CRM outputs as drafts only.

## Next Proof Gates

These are the remaining promotion gates before stronger public claims:

1. Add browser proof for Trace Lens and OKF privacy:
   - public OKF / Trace Lens visible to room members,
   - private concept not visible to another user,
   - promoted redacted concept becomes visible,
   - evidence click opens literal source.
2. Add the durable Coach Cue / Review Round lifecycle if the demo wants to claim first-class banker workflow objects.
3. Add private-consult OKF retrieval only if the product wants to claim that private consults use the full OKF graph by default.
4. Promote the startup provider eval only after repeated N=5/p95 route stability passes.
5. Update README wording only after the browser proof exists, not before.
