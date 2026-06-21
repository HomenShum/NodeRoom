# NodeRoom design grounding — master roadmap

> One decision document over four grounded workstream specs. Recommendation-first. Proof > argument. Scope-gravity is named and cut, not absorbed.
>
> Current-status note: this is the pre-implementation roadmap. The June target pass implemented the
> MVP shell role migration, Copilot tabs, shell-level status/tape, deterministic Signal Tape privacy
> selectors, and typed intake/preflight contracts. Treat the tables below as design grounding and
> backlog sequencing; use `docs/TARGET_2026_06.md` and `docs/qa/production-matrix.json` for current
> built-vs-gap status.
>
> Source specs (read these for the full ticket-level detail):
> - `docs/synthesis/specs/A_UI_SHELL.md` — desktop/mobile UI shell
> - `docs/synthesis/specs/B_INTAKE_SCHEDULER.md` — intake classifier + preflight planner + scheduler
> - `docs/synthesis/specs/C_UNIVER_RUNTIME.md` — workbook runtime (adopt Univer vs extend)
> - `docs/synthesis/specs/D_NODEROOMBENCH.md` — four-layer eval stack + NodeRoomBench
>
> The single most important finding across all four: **~80% of every proposal is a restatement of doctrine and code that already exists in this repo.** The net-new surface is small, specific, and identified below. Do not re-derive what is already canonical in `docs/TARGET_2026_06.md`, `docs/NODEAGENT_ARCHITECTURE.md`, `docs/architecture/AGENT_SCRATCHPAD_CELL_COLLAB.md`, and the existing `evals/`.

---

## Executive decision — the highest-leverage moves, in priority order

| # | Move | Tag | Why (one line) |
|---|------|-----|----------------|
| 1 | **Shell restructure**: make Work Surface the non-optional center; merge the two `Chat` instances into one right `Copilot.tsx` with a Room/Private lane switch | `[net-new]` | Single biggest architectural unlock (`TARGET_2026_06.md` L174-175/L194-195); every other UI ticket (status strip, binder sections, split mode) is cheaper once the 4-peer flex is gone. |
| 2 | **Preflight planner** (`src/nodeagent/core/intakePreflight.ts`): run the *existing* `expandElementIdsWithSpreadsheetDependencies` at PLAN time; persist `intendedReadSet`/`writeSet`/`expandedAffectedSet` on `agentJobs` | `[net-new]` | Already designed-but-unbuilt in `AGENT_SCRATCHPAD_CELL_COLLAB.md §5`; reuses proven closure code; unblocks the classifier, scheduler, and planHash dedupe. |
| 3 | **Intake classifier** (`src/nodeagent/core/intakePreflight.ts`): cheap LLM emits ONE Zod-validated `IntakeDecision` union, never spawns/locks/writes; deterministic `scheduler.ts` acts | `[net-new]` | The genuinely missing router (queue vs parallel vs steer). Mirrors the proven "LLM proposes, harness executes" split (`MANAGED_LOCK_PERF.md`) — keeps it inside the architecture budget. |
| 4 | **VERDICT: EXTEND the home-grown workbook engine — do NOT adopt Univer as runtime** | `[fix-conflict]` | The three "load-bearing lessons" Univer would teach (runtime state machine, COMMAND/MUTATION/OPERATION, mutation-layer collab) are *already* implemented. Univer's free wins are exactly what it Pro-locks or what NodeRoom already owns. Adopt only behind the existing adapter on a measured >100ms/20k-cell trigger. |
| 5 | **Status Strip before Signal Tape** (`src/ui/StatusStrip.tsx`) | `[net-new]` | Smaller (M vs L), zero new backend — consolidates info that already exists (`store.listTraces` / `listProposals` / `lastRun()` telemetry); closes the L176 gap. Signal Tape is a larger ambient feed with a real privacy-leak risk. |
| 6 | **Runtime-independent grid + eval wins**: range selection (Shift/Ctrl+Arrow/click-drag), Web Worker calc, headless numeric golden tie-out, and agent intent-claim overlays | `[partial]` | Spreadsheet human presence plus server-side agent intent heartbeat shipped as `presenceClaims` on 2026-06-20; remaining work is browser proof for agent-intent conflict/proposal behavior, notebook/deck targets, and stronger eval coverage. |
| 7 | **NodeRoomBench = thin `index.ts` re-export + reporting doc-lint** — NOT a parallel harness; spend net-new eval effort only on Layer 3 (format + dynamic-correctness perturbation) and a real fetch→cache→run public-source adapter | `[fix-conflict]` | Layers 1/2/4 and the honesty standard already exist and are solid. `architectureBudget.ts` forbids a new framework layer without a failing eval. The novel differentiator is the dynamic-correctness check, not re-speccing the suite. |
| 8 | **Gate Signal Tape on a privacy-filtered, bounded selector** (`selectSignalFeed`: `channel==='public'` only, `MAX=60` + eviction, sorted by ts) | `[fix-conflict]` | A naive `store.listTraces` ticker leaks private-channel summaries the rest of the app carefully protects. Applies the agentic-reliability checklist (BOUND/HONEST_STATUS/SSRF). |

---

## Already built — stop re-specifying

Concrete, with file evidence. Re-proposing any of these is pure scope-gravity.

### UI shell (workstream A)
- **The entire region taxonomy** (Deal/Room Binder + Work Surface + Copilot + Signal Tape + Status Strip), the four-role "owns / must-not-own" contract, "binder is navigational not operational", "people = header avatars never a column", and the four responsive bands — all written verbatim in `docs/TARGET_2026_06.md` L17-96, mirrored in `docs/ARCHITECTURE.md` L150-156 and the `RoomShell.tsx` header comment. **[solid]**
- **Three resizable desktop columns + thin top bar** — `src/ui/RoomShell.tsx` L214-222, layout state L37, `startResize` L152-173. **[solid]**
- **Tabbed Work Surface** (the `[Q3 Model][Proof][Source][Gold]` pattern) — `src/ui/panels/Artifact.tsx` L25-31 (`TABS`), tab bar L88-94. **[solid]**
- **Copilot building blocks already exist** (work queue, agent streams, agent cards, cancel/retry steering, private-vs-room lane, promote-to-public) — `src/ui/Chat.tsx` L474-752 — just not yet unified into one column. **[partial]**
- **Mobile/compact collapse + 44px touch floors + reduced-motion contract** — `styles.css` L613, L624-660; `RoomShell.tsx` `isCompact` L30. **[solid/partial]**

### Intake / scheduler (workstream B)
- **"Chat claims are evidence, not auto-verified source truth"** is a HARD, TESTED invariant, not an aspiration — `evals/chatIntakeRuntime.ts:388` `chatClaimsStayManual` + a negative-control plan that fabricates a `source` citation and MUST fail; `fetch_source` tool says "NEVER cite a source you did not fetch". **[solid]**
- **Formula-dependency closure** — `expandElementIdsWithSpreadsheetDependencies` (`convex/locks.ts:22`) backed by the `spreadsheetDependencies` table. The work is *calling it at plan time*, not writing new closure code. **[partial — runs at lock-grant, not plan time]**
- **Strong reservation level + TTL + janitor + host Yoink** — `convex/locks.ts` proposeLock/releaseLock, `sweepExpiredLocks`, `hostForceReleaseLock`. This IS the "Commit Lease"; only the soft Intent-Claim level is missing. **[solid]**
- **Conflict-as-data + draft/proposal fallback** — `convex/artifacts.ts` four-gate write, `convex/drafts.ts` smart-merge, review-mode `pendingApproval`. The scheduler's *outcomes* all exist; only the plan-time *decision* is missing. **[solid]**
- **Atomic idempotency dedupe** — `src/nodeagent/core/idempotency.ts:25-41` (FNV-1a) + `convex/agentRuns.ts:claimOrReuse` (race-safe). Extend to planHash; don't rebuild. **[partial — exact-goal only]**
- **Durable job lifecycle + queue index + spend ceilings** — `convex/schema.ts:229-282` (`agentJobs` status union, `by_status_nextRunAt`), `runtime.ts:249-255` `checkSpendCeiling`. **[partial]**

### Workbook runtime (workstream C)
- **A mature home-grown engine already exists in BOTH forms** — `src/engine/roomEngine.ts` (517 lines, bounded collections, per-element CAS, leases, drafts+merge) and the Convex prod mirror `convex/artifacts.ts:applyCellEditCore` L222-316. The decision is NOT greenfield. **[solid]**
- **COMMAND/MUTATION/OPERATION separation is already the architecture** — "commandText is not authorization, it is just intent" (`NODEAGENT_ARCHITECTURE.md` L243); harness-owned CAS write; ephemeral `sel`/`editing` UI state never persisted (`Artifact.tsx` L604-612). **[solid]**
- **Mutation-layer collab contract (the "sync plugin" Convex side)** — `ChangeOp{...,baseVersion}` (`types.ts` L234-243) + `applyCellEdit` returning conflict-as-data. Only the Univer-*side* bridge would be new. **[solid]**
- **Formula dependency index already feeds lock expansion** — `spreadsheetIndex.ts` `buildDependencies` L207-226 + `expandFormulaReferences` L228-244. **[solid]**
- **Finance-grade render layer with all custom overlays** (lock outline, evidence/proposal/formula-protected badges, number formats, merges, formula bar) — `Artifact.tsx ExcelGridSheet` L601-833. **[solid]**
- **The adapter boundary AND the Univer-vs-alternatives verdict already exist** — `MVP_WORKBOOK_STACK.md` `WorkbookRuntimeAdapter` L47-60; `UI_EXCEL_PAPER.md` "Grid-engine contingency — verdict 2026-06-11" L59-81 (Glide #1, Univer #2, revisit trigger >100ms latency at 20k-cell cap). **[solid]**

### Eval stack (workstream D)
- **Layer 1 (Outcome)** final-state-vs-gold — `evals/runEval.ts` + `cases.ts` + `financeModelRuntime.ts:218-258`. **[solid]**
- **Layer 2 (Formula)** AST/equivalence match AND value recompute — `financeModelGold.ts:204-223` + `financeModelLive.ts:219-264` `evaluateFormulaValue` (real sandboxed recompute). **[solid]**
- **Layer 4 (Trajectory)** read/write/lock/draft/release/CAS/no-clobber/privacy — `AGENT_EVAL.md:226-242`, `financeModelRuntime.ts:238-258`, `ladder.ts` L1-L7, `multiUserCoordinationProof.ts`. **[solid]**
- **Harness-honesty reporting** (model+harness+tool+budget+evaluator, never a raw score; failure-owner attribution; capability-vs-leaderboard proof levels) — `financeModelLive.ts:429-501` `LiveReport`, `classifyRunFailure`, `professionalProofLedger.ts:16-22`, `MODEL_EVAL_MATRIX.md:97-110`. **[solid]**
- **Append-only eval store + cross-commit regression diff** — `evalStore.ts`, `evalDiff.ts`, `docs/eval/eval-runs.jsonl`. **[solid]**
- **Public-source case DEFINITIONS** (FinanceBench, TAT-DQA, SEC XBRL with gold values + validators) — `docs/demo/public-gold-demo-manifest.json`. Net-new work is EXECUTION (fetch+run), not the case list. **[partial]**

---

## Scope-gravity drop-list — proposals to DROP

Cut these. Each is either already built or not worth the cost now. Cite the doc/code instead of re-deriving.

**DROP — already canonical doctrine (cite, don't re-spec):**
1. The region taxonomy + four-role contract + four responsive bands → `TARGET_2026_06.md` L17-96.
2. "Binder is navigational, full streams stay in Copilot" → `TARGET_2026_06.md` L49-53.
3. "People = header avatars, never a column" → already built, `RoomShell.tsx` L205-208.
4. "Trace becomes a main-stage artifact, not permanent bottom content" → already the Work Surface contract, `TARGET_2026_06.md` L57/L176.
5. COMMAND/MUTATION/OPERATION as a thing to *design* → already implemented architecture.
6. "First confirm whether NodeRoom has its own engine" → confirmed: solid, bounded, idempotent (`roomEngine.ts` + `artifacts.ts`).
7. Re-deciding adopt-vs-extend from scratch → adapter boundary + dated verdict + revisit trigger already exist.
8. The four-layer eval naming for Layers 1/2/4 + the honesty standard → all solid; codify the *naming*, don't re-derive the *concept*.

**DROP — no-op / phantom work:**
9. **"Artifacts wrongly in a bottom drawer" correction → NO-OP.** No bottom drawer exists in the repo. Artifacts already live in the center Artifact panel; the only bottom element is the scrollable `TraceStrip`. Reallocate this effort to the genuinely-missing center-stage SPLIT mode (`TARGET L197` — no split code exists today).

**DROP — reuse the existing mechanism, don't build a parallel one:**
10. A fresh formula-dependency closure for the affected set → reuse `expandElementIdsWithSpreadsheetDependencies`.
11. A brand-new strong "Commit Lease" → the existing managed lock + TTL + release-in-finally already IS it. Build ONLY the soft, advisory Intent-Claim.
12. A new idempotency/dedupe substrate → extend `src/nodeagent/core/idempotency.ts` into planHash.
13. A new `formula_protected` conflict class/table → map onto the EXISTING dependency-closure lock + `approvalPolicy=host_review` (a new weakened/parallel gate is forbidden without human approval, `NODEAGENT_ARCHITECTURE.md:37`).
14. A `NodeRoomConvexSyncPlugin` as net-new → the Convex side is fully built; only the Univer-side bridge is new, and only if Univer is adopted.
15. Univer's formula engine to power the dirty-range planner → the planner already exists and is wired (`spreadsheetIndex.ts` + STACK.md L39).

**DROP / DEFER — not worth the cost now:**
16. **Adopting Univer as the workbook runtime → DEFER** behind the documented measured trigger. Its free features (collab, import/export, history) are Pro-locked or already owned; adoption pays inverted-ownership + MB-bundle cost for ~zero current gain.
17. **True in-flight steering (mutating a running job) → DEFER.** It is the only XL with no existing substrate (runtime loop has no inbound channel). v1 routes `steering_patch` → cancel + re-enqueue merged goal via existing idempotency reuse.
18. A separate NodeRoomBench package with its own cases/gold/runners/validators tree → make it a thin `index.ts` re-export; `architectureBudget.ts` forbids a new framework layer.
19. Re-defining the public-source case list → already in the manifest; the gap is fetch+run.

---

## Cross-workstream sequencing — what unblocks what

The dependency graph is the reason ordering matters. Two notable findings:
- **Univer's formula-dep analysis does NOT unblock the affected-set planner.** That planner is unblocked by the *existing* `expandElementIdsWithSpreadsheetDependencies`. The C→B dependency that the Univer proposal implies does not exist.
- **The UI shell does NOT depend on the scheduler.** The shell restructure (A1) is a pure CSS-grid + component-merge refactor. But the *display surfaces* for B's output (PlanPreview card, Status Strip values) land more cleanly *after* the Copilot unification, so do A1 first.

Recommended global ordering:

```
PHASE 0 (parallel, no cross-deps):
  A1  Shell restructure (Work Surface non-optional center + unified Copilot)   ──┐
  B2  Preflight planner (reuse existing closure; persist sets on agentJobs)    ──┤
                                                                                 │
PHASE 1:                                                                         │
  B3  Intake classifier + deterministic scheduler   ◀── needs B2 (affected set) │
  B-planHash  Normalized-target dedupe              ◀── needs B2 (persisted set)│
  A5  Status Strip                                  ◀── lands cleaner after A1 ──┘
  C-presence  presenceClaims shipped for human spreadsheet focus/edit + server-side agent intent; extend browser proof + notebook/deck targets

PHASE 2 (each independent; leverage order):
  C-range   Range selection (Shift/Ctrl+Arrow/click-drag)   ── removes most pro-Univer rationale
  C-calc    Web Worker + small calc engine
  C-golden  Headless numeric golden tie-out (upgrades financeModelGold)
  D-L3      Layer 3: format rubric + dynamic-correctness perturbation
  A-binder  Seven-section binder hierarchy + agent/person click semantics  ◀── needs C-presence
  A-resp    Two missing responsive bands + four-band e2e specs

PHASE 3 (gated / largest):
  A4  Signal Tape (LAST — privacy-filtered bounded feed)
  D-public  Real fetch→cache→run public-source adapter (SSRF-fenced)
  B-steer   True in-flight steering (XL; only after classifier+scheduler+preflight prove value)
  C-spike   Univer POC behind WorkbookRuntimeAdapter (de-risking SPIKE, not migration; only if measured trigger fires)
```

**Critical shared dependency:** spreadsheet human presence and server-side agent
intent now exist as `presenceClaims`, and human cell presence is consumed by the
grid. The remaining shared dependency is planner-owned affected-set semantics,
browser proof for agent intent conflict/proposal behavior, and notebook/deck
target presence. Resolve the reservation-model fork (Option A vs B,
`NODEAGENT_ARCHITECTURE.md:786-797`) before letting scheduler policy depend on
intent claims, or they become a third overlapping concept (locks + agentLeases +
intentClaims).

**Hard gate across all of B and D:** every part ships behind a scripted eval rung with a negative control BEFORE any live/UI claim — mirror `evals/chatIntakeRuntime.ts` (a plan that satisfies the contract + a wrong-route plan that MUST fail). This is the repo's required proof pattern.

---

## Citation integrity

Independently fact-checked against arXiv / GitHub / vendor docs. Every external reference resolves to a real source. Three caveats matter for a pitch/benchmark doc.

**Verified — safe to cite as-is:**
- BankerToolBench (arXiv:2604.11304) — verified; note the "best model" is named **GPT-5.4** (fails ~half the rubric, bankers rate 0% client-ready).
- BlueFin (arXiv:2605.30907) — verified; "<50% average, particular weakness in **dynamic correctness**" — directly motivates our Layer 3 perturbation check.
- Finch / FinWorkBench (arXiv:2512.13168) — verified; GPT-5.1 Pro 38.4%, Claude Sonnet 4.5 25.0% (the 25.0% is in the **v3 full text**, not the v1 abstract — cite v3).
- APEX-Agents (2601.14242), SpreadsheetBench (2406.14991), SpreadsheetAgent (2604.12282), WildClawBench (2605.10912), Claw-SWE-Bench (2606.12344), Harness-Bench (2605.27922), ADK Arena (2606.05548), AI Agents That Matter (2407.01502), AgentLens (2605.12925), HAL (2510.11977), AHE (2604.25850), Search-Time Contamination (2508.13180), SWE-Bench+ (2410.06992), ImpossibleBench (2510.20270) — all verified, stats accurate.
- Tooling/data: OpenHands 1.8.0 (2026-06-10), OpenHands/benchmarks, LangGraph/Deep Agents, AutoGen, CrewAI, FinanceBench, TAT-QA/TAT-DQA, SEC EDGAR APIs, Univer — all verified accurate.

**WRONG-DETAILS — MUST be corrected before citing:**
- ⚠️ **"WorkstreamBench" (arXiv:2605.22664) DOES NOT EXIST.** The ID resolves to a real paper titled **"MBABench: Evaluating LLM Agents on End-to-End Spreadsheet Tasks in Finance"**. The taxonomy (Accuracy / Formula / Format) and findings are right; the *name* was hallucinated by an early WebSearch. **DO NOT cite "WorkstreamBench" in any pitch/benchmark/README — it will not survive a reviewer's arXiv lookup. Rename to MBABench.**
- ⚠️ **SheetAgent / SheetRM (arXiv:2403.03636)** — ID and paper are real, but the cited stat is wrong: the improvement is **20–40%**, not 20–30%. Correct the upper bound before citing.

**Likely-fabricated:** none. Every ID resolved (HTTP 200) to a real paper or repo. The only fabrication was the *name* "WorkstreamBench" over a real ID.

**Blunt warning:** the single highest-risk citation is **"WorkstreamBench"** — it reads authoritative but the name is fake. Ban it from any external-facing doc until renamed to MBABench. Second-watch: the Finch Claude-25.0% figure (v3-only) and the SheetAgent 20–40% range.

---

## Harness-honesty one-pager

Paste-ready. This is already the enforced norm in code (`LiveReport`, `classifyRunFailure`, `professionalProofLedger`); this section just codifies the template.

> ### NodeRoom reporting standard
> **Never report a raw model score.** Every result string is reported at the **configuration level**, adjacent to its route + harness + budget:
>
> `model + harness + tool policy + budget + evaluator → score`
>
> **Required fields on every reported result** (`LiveReport`, `financeModelLive.ts:429-501`):
> - `requestedModelName` / `modelName` (what was asked for vs what served)
> - `roomVariant` (base / distractors / concurrent_edit)
> - `costUsd`, `ms`, `toolCalls`
> - `failureOwner` ∈ {provider | model | harness | tool_contract} via `classifyRunFailure`
> - `evaluator` + `proofLevel` ∈ {live_provider | partial_live_provider | live_provider_catalog | deterministic_runtime | deterministic_catalog | contract_shape}
> - `caseSetHash` (deterministic sorted hash, so cross-commit diffs are honest)
>
> **Proof tiers are not interchangeable** (`PROFESSIONAL_WORKFLOW_EVALS.md` L57-90): a live-provider *catalog* proof proves **route comprehension, not full tool execution**. A capability claim ≠ a leaderboard claim. Cases with blockers need deeper domain runners before they become a product claim.
>
> **ALLOWED:** report a model+harness pass rate with cost/budget inline; report `failureOwner`; report a deterministic-runtime proof distinct from a live-provider proof; show cost/runtime as a **range with sample size** from recorded `agentRuns` telemetry.
>
> **DISALLOWED:** a bare model score ("GPT-5.4 = 72%") with no harness/budget; a 2xx on a failure path; a hardcoded score floor / partial-credit floor; web-searching the benchmark answer (enforce an SSRF/host allowlist on the public-source runner — doubles as the no-cheat fence, per Search-Time Contamination arXiv:2508.13180); answer-key leakage into the agent's context; case-specific hardcoding; a confidently-quoted point estimate where only a range is honest.
>
> **Doc-lint (Step in D):** every score string in `docs/eval/*.md` must sit adjacent to route+harness+budget. Several committed docs still quote bare tallies ("18/28 routes", "5/5") — fail the lint on those.

---

## Open decisions for Homen

The genuine forks. Each needs an owner decision before its dependent work starts.

1. **Is the 4-peer-panel MVP shipping to users NOW, or is the June-target shell migration in-flight?** `TARGET_2026_06.md` L189 warns against claiming the target shell is already shipped. Confirm you are not mid-migration before A1 starts.

2. **Adopt Univer vs extend the engine.** *Recommendation: EXTEND.* The fork is whether the kind-agnostic element model (sheet/note/wall share ONE lock/CAS/draft mechanism, `types.ts` L1-12) is a hard invariant you refuse to fork. If yes → Univer can only ever be a sheet-only VIEW behind the adapter, never the authority — which materially lowers its value. Owner decision required.

3. **Build NodeRoomBench now vs after the demo.** *Recommendation: thin re-export now, real public-source adapter in Phase 3.* The fork: does the benchmark need to be externally shareable (requiring rights-cleared or fully-synthetic gold, since the RareLiquid/Ben Chon workbook is private-by-default), or does it stay private with only redacted summaries?

4. **Reservation-model migration (blocks scheduler-owned intent policy, not human spreadsheet presence).** Option A (keep locks canonical) vs Option B (generalize into `agentLeases`), `NODEAGENT_ARCHITECTURE.md:786-797`. The low-level agent intent heartbeat exists; the scheduler must not treat it as a third write-control concept until this is decided.

5. **Should the public chat survive as a distinct surface, or fully fold into Copilot?** `ARCHITECTURE.md` L157 flags the multi-author public feed as deliberately custom vs the 1:1 assistant-ui thread. Unifying under Copilot forces a room-wide-vs-agent-directed UX decision.

6. **Classifier cost on a public, anonymously-joinable room.** Run on EVERY message, or only after a cheap deterministic prefilter? Does it count against `roomSpendSince`/`globalSpendSince`? This is a real cost-and-abuse vector.

7. **Layer 2 comparator depth.** Keep the current normalized-string + required-refs/tokens match, or build a true parsed-AST comparator (so `F49+F48 == F48+F49`)? The current normalizer does NOT treat reordered operands as equal.

8. **Layer 3 grading: deterministic rubric vs LLM-judge.** *Recommendation: deterministic.* An LLM judge here would be the first non-deterministic core gate (`AGENT_EVAL.md` reserves judges for P2 narration only).

9. **Calc-engine license.** True Excel semantics (HyperFormula, GPL/commercial — license check required) vs lightweight evaluator (formula.js, MIT) for the finance formulas the agent actually writes. Decide before C-calc.

10. **Who authorizes a PlanPreview spend on a multi-user public room** — only the requester, or the host? Align with the existing host-review/`approvalPolicy` surface to avoid a new permission concept.
