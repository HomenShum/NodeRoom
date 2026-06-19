# Agent Harness & Tools — Review vs the Deep-Review Docs

> Question: *does the agent harness **architecture** and **tools** need to change?*
> Reviewed against `6-14-2026-deep-review.txt` (the harness-engineering doc) and `6-15-2026-deep-review.txt`
> (the newest "Banker Coach Mode" / Trace Lens vision), mapped to the live `src/nodeagent/**` + `convex/agent.ts`.

## Verdict

**Architecture: NO re-architecture needed.** The 6-14 harness thesis is essentially *done* and should not be
touched. **Tools: the change is ADDITIVE and concentrated in the OUTPUT/EVIDENCE layer** — the banker-coach
tools already exist and are wired, but their **outputs are ephemeral** (not persisted, not telemetered). The
one genuinely net-new primitive 6-15 asks for is **Trace Lens** (a click-to-context inspector), which is absent.

This matches 6-15's own instruction ([L860](../../6-15-2026-deep-review.txt#L860)): *"I would **not** reorganize
everything… add a thin coach-artifact layer."*

### "pi-agent-core" — clarified
`src/nodeagent/models/piAiAdapter.ts` is a **9-line wrapper** whose `createPiAiAdapter()` just returns
`model('gemini-2.5-flash')` from `adapter.ts`. "pi-agent-core" / pi.ai is a **naming label over the local
`AgentModel` seam**, not an external framework. The real runtime is 100% the local harness
[`src/nodeagent/core/runtime.ts:runAgent`](../../src/nodeagent/core/runtime.ts) (drives both the interactive
and durable lanes). Treat any "orchestrated via pi-agent-core" framing as a wrapper alias.

## What the 6-14 harness already satisfies (do NOT invent gaps here)

| 6-14 prescription | Implemented in |
|---|---|
| "LLM routes intent, harness schedules work, ledger commits truth" | `core/runtime.ts` single loop; `intakePreflight.ts` typed `IntakeEvent` + `PlanPreview` (readSet/writeSet/affectedSet), gated at `convex/agent.ts:178` (`scheduling===run_now`) |
| Agent writes nothing directly; emits patch bundles; harness owns durable CAS writes | `MANAGED_LOCK_TOOLS` (`write_locked_cell(s)`, `write_locked_cell_result(s)`); model never touches the DB |
| Adaptive OpenRouter routing in the *harness*, not the UI; logs model/cost/latency | `core/adaptiveRouter.ts` (4-lane: extract/speed/deep/coding) |
| Context engineering / world model (chunk, semantic search, compact, checkpoint) | `core/worldModel.ts` (JIT render + UNTRUSTED fence), `core/contextCompactor.ts`, `search_sheet_context` tool |
| Semantic rebase = structured review, CAS commits the final write | `convex` semanticConflicts/proposals/locks/drafts tables; `skills/spreadsheet/semanticRebase.ts` |
| Exactly-once across resume boundaries | `core/journal.ts` (replay completed steps instead of re-billing) |

The no-clobber / lock→draft→merge spine — the actual wedge — is **real and complete**.

## The gaps (all in the 6-15 coach/output/inspector layer)

### Already built & wired (the good news)
`PRODUCTION_ROOM_TOOLS` already includes the **banker-coach suite** (`skills/bankerCoach/tools.ts`):
`build_evidence_cards`, `generate_banker_coach_cues`, `create_review_round_update`, `export_downstream_draft`
(honest "draft only, no provider send" — security PASS), `compute_runway_milestones`,
`validate_chart_against_source_cells`, `render_chart_artifact`. So the coach *brains* exist — they just leak their output.

### Architecture gaps (prioritized)

| P | Gap | Current state | Change | Effort |
|---|---|---|---|---|
| **P0** | **Analytics sink UNWIRED in production** — coach/run events fire into a null sink | `analytics/coachEvents.ts` fully implemented but `setNodeRoomAnalyticsSink` is referenced **only in tests**; `agent.ts`/`agentJobRunner.ts` never set a sink; no ClickHouse/warehouseOutbox | In `runRoomAgent` + `runFreeAutoJobSlice`, set a sink → fire-and-forget Convex insert into a new `agentAnalyticsEvents` table (restored in `finally`); reuse `gateway.redactPII` | **S** |
| **P0/P1** | **CoachCue / EvidenceCard / ReviewRound not persisted** — recomputed client-side every render (`src/ui/bankerCoachPacket.ts`), so coach output isn't durable, reviewable, or benchmarkable | No `coachCues`/`evidenceCards`/`reviewRounds` Convex tables | Add the 3 tables + insert mutations + room-scoped queries; persist keyed by `roomId/artifactId/runId`; UI reads rows instead of recomputing | **M** |
| **P1** | **EvidenceCard locator THROWN AWAY** — 6-15 wants claim→page/sheet/row/**bbox**/cell→`supportLevel`→`opensIn`; the data already exists but is flattened | `engine/types.ts:61-75 CellEvidence` *already* carries page/row/column/bbox/url — but `coachArtifacts.ts:51-66` collapses it to a single `sourceRef` string | Stop flattening: forward the structured locator; add `supportLevel` (strong/partial/weak/contradicts/manual_only) + `opensIn`; wire EvidenceCarousel to open source split-screen at the exact locator | **M** |
| **P1** | **Trace Lens absent** — the one genuinely net-new 6-15 primitive (zero hits outside the doc) | No SurfaceRegistry, no `data-surface-id`, no Context Packet, no Review/Builder exposure tiers | Minimum slice: `src/ui/SurfaceRegistry.ts` (static surfaceId→files/tables/queries/skills map) + `data-surface-id` on ~6 RoomShell surfaces + `TraceLensPanel.tsx` on Alt/Cmd-click. **SECURITY:** default external view to Review Mode (proof only) — never leak file paths/backend fn names | **L** |
| P2 | Audience-scoped cues (analyst/associate/vp_md/client_ready) + Talk Track; `CoachCue` has no `audience`, severity vocab differs | `coachArtifacts.ts` cues are one flat list, severity `info/watch/risk` | Add `audience`+`targetRefs`; align severity to `info/review/warning/blocker`; re-project per audience | M |
| P2 | Two-rubric coach gate (NodeRoomBench vs Official Benchmark) | cues emitted unconditionally | Thread a `coachMode`; in `official_benchmark`, emit only a generic checklist (no evaluator gold) | S |
| P2 | SurfaceComment (anchored comment → Workplan task → code-edit prompt) | absent; depends on Trace Lens | After Trace Lens: add the table + convert-to-task action | M |

### Tool gaps

| P | Gap | Change | Effort |
|---|---|---|---|
| P1 | Per-integration **named** dry-run handoffs bundled into one `export_downstream_draft`; its `downstream_draft_prepared` event lands in the null sink | Honest-status already correct → just ensure the event reaches a live sink (covered by the P0 analytics fix), or split into 5 named tools if per-integration telemetry matters; add Attio if CRM coverage needed | S |
| P1 | No tool resolves a **claim → source @ exact locator, split-screen, with a supportLevel verdict** | Add `resolve_evidence(claimId/cellRef)` → source artifact + locator (reuse `CellEvidence`) + `supportLevel` + `opensIn` (mostly plumbing on existing data) | M |
| P2 | Modeling-hygiene checks partial (only chart-vs-cells) | Add `validate_tie_outs`, `detect_private_source_in_public_output` (highest-value, security), etc. → emit coach cues | M |
| P2 | Trace-Lens context-packet generator; walkthrough/media export | Build with Trace Lens (internal-mode only); media export stays OUT of the core path | M/L |

## Top 3 moves (recommended order)

1. **[P0 · S] Wire the analytics sink in production** (`agent.ts` + `agentJobRunner.ts` → Convex insert + redaction). Cheapest fix, biggest honesty/observability payoff; unblocks the eval & coach-feedback loop. Today, coach/handoff events are silently dropped.
2. **[P0/P1 · M] Persist CoachCue + EvidenceCard as first-class Convex tables**, forwarding the **already-existing** `CellEvidence` locator instead of flattening it. Makes coach output durable, reviewable, and benchmarkable — the core of 6-15's "agent output → banker trust" pipeline.
3. **[P1 · L] Build the Trace Lens minimum** (SurfaceRegistry + `data-surface-id` + click inspector), **Review-Mode-gated** so code paths never leak to external users. The one net-new primitive; also pays off NodeRoom's own multi-agent build (click-to-code-edit packets).

Everything else (audience re-projection, two-rubric gate, media export, SurfaceComment) is **P2 — defer**.

> Bottom line: **the harness doesn't need to change — its evidence/output layer needs to stop being
> ephemeral, and Trace Lens is the one new thing to add.** Notably, the streaming gap (issue #5) is the
> same theme: the runtime is right, but the *output* (tokens / coach cues / evidence) isn't reaching a
> durable, visible surface.
