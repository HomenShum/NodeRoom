# Workbook runtime: adopt Univer vs extend the home-grown engine

Status note after implementation drift cleanup: partial range selection,
copy/paste, fill-down, and main-thread formula recompute exist in the current
grid. Drag-select, Ctrl+Arrow/Ctrl+A, multi-cell Delete, and worker-backed calc
are still backlog. Treat this file as a decision/spec archive, not a complete
current implementation inventory.

## Decision

**Extend the home-grown engine. Do NOT adopt Univer as the workbook runtime now, and never as the collaboration authority.** The three load-bearing lessons a Univer adoption would buy — "spreadsheet is a runtime not a React table" (interaction state machine), command/mutation/operation separation, and mutation-layer collaboration with base-version + actor — are already implemented (`src/ui/panels/Artifact.tsx` `ExcelGridSheet`, `convex/artifacts.ts` `applyCellEditCore`, `src/engine/types.ts` `ChangeOp`). The features Univer OSS gives "for free" (real-time collab, import/export, history) are exactly what it Pro-locks or what NodeRoom already owns; adoption pays an MB-scale bundle + inverted-ownership cost (you sync INTO Univer's workbook model) for little net gain. Adoption also forks the kind-agnostic element contract — sheet/note/wall share ONE lock/CAS/draft mechanism (`types.ts` L1-12) and Univer models a workbook, not an element bag. The strategic decision is already documented with a measured revisit trigger (`docs/UI_EXCEL_PAPER.md` L59-81: >100ms latency / scroll jank at the 20k-cell cap). This spec therefore scopes (1) a strictly-bounded de-risking POC behind the existing adapter type, and (2) the genuinely-missing, runtime-independent work: range selection, a Web Worker calc engine, a numeric golden tie-out, and per-cell human presence. If the perf trigger ever fires for a *rendering* failure, prefer Glide Data Grid + HyperFormula; reserve Univer only for the narrow case where you specifically want its formula engine AND can absorb inverted ownership.

## Current state (do not re-spec)

| Capability | Where | Status |
|---|---|---|
| Deterministic in-memory engine: rooms, artifacts, per-element CAS, affected-range locks + lease TTL, drafts + smart-merge, sessions, proposals, traces, messages; every collection BOUNDED, every op idempotent, conflict-as-data | `src/engine/roomEngine.ts` (MAX bounds L30-31, CAS `applyOpInternal` L334-368, locks L242-301, drafts+merge L385-411) | solid |
| Convex mirror of the same contract (lock gate → CAS gate → proposal gate → apply → trace → receipt) | `convex/artifacts.ts` `applyCellEditCore` L222-316; `applyCellEdit` mutation args L319-330 | solid |
| COMMAND (intent) vs MUTATION (CAS write) vs OPERATION (ephemeral UI) separation — already the architecture | intent: `docs/NODEAGENT_ARCHITECTURE.md` L243; harness write: `applyCellEditCore`; ephemeral UI: `ExcelGridSheet` `sel`/`editing` local state L604-612, single CAS commit funnel L676-685 | solid |
| `ChangeOp {opId, artifactId, elementId, kind, value, baseVersion}` + conflict-as-data `EditResult` | `src/engine/types.ts` L234-250 | solid |
| Formula dependency index feeding lock expansion | `src/app/spreadsheetIndex.ts` `buildDependencies` L207-226, `expandFormulaReferences` L228-244 (cap `MAX_FORMULA_DEPENDENCIES`); `STACK.md` L39 | solid |
| Finance-grade DOM render layer: file numFmts/styles/widths/merges, formula bar, evidence strip, lock outline + name flag, per-cell inline styles | `ExcelGridSheet` L686-832 (formula bar L713-719, evidence strip L720-727, merges L744-749, inline styles L766-774, lock flag L813); `numberFormat.ts` `formatExcelNumber`; `captureCellStyle` in `spreadsheetParser.ts` | solid |
| Bounded render-only style sidecar `meta.excelGrid` (CAS path never reads it) | `types.ts` `ExcelCellStyle`/`ExcelGridMeta` L114-145; caps in `spreadsheetParser.ts` (styles 4k / numFmts 64 / merges 200) | solid |
| Runtime-adapter boundary + Univer-vs-Glide-vs-react-data-grid verdict with dated revisit trigger | `docs/architecture/MVP_WORKBOOK_STACK.md` `WorkbookRuntimeAdapter` L47-54, ranking L56-60; `docs/UI_EXCEL_PAPER.md` L59-81 | solid (decision already made) |
| Keyboard state machine: enter-mode vs edit-mode, type-to-replace, Tab/Enter/arrow commit semantics | `ExcelGridSheet` `onGridKeyDown` L661-675, input `onKeyDown` L797-810 | partial (single-cell only; no range) |
| Headless golden = formula-STRING grading (refs/tokens present), explicitly NOT numeric recompute | `evals/financeModelGold.ts` `normalizeExcelFormula` L204, `formulaMentionsAllRefs` L215, `formulaMentionsAllTokens` L220; `UI_EXCEL_PAPER.md` L55-57 | partial (no value tie-out) |

**Do not re-derive or re-build:** the command/mutation/operation separation; the Convex CAS write path (`applyCellEdit` already has base version + actor proof + conflict-as-data); the dependency-index-driven lock expansion; the adopt-vs-extend decision; the EvidenceBadge/ProposalBadge/lock-outline visuals (they exist as CSS classes today).

## Net-new work (sequenced)

Order is by leverage-per-effort. Steps 1-3 remove most of the pro-Univer argument and are runtime-independent. Step 4 is the only Univer-touching work and is a spike, not a migration. Step 5 is optional and gated on a real measurement.

### Step 1 — Range selection + extension semantics (L) — strongest pro-Univer argument, build in-house

- **Files:** `src/ui/panels/Artifact.tsx` `ExcelGridSheet` (selection model L604), `src/ui/styles.css` (range tint class), `e2e/excel-grid.spec.ts`.
- **What:** replace single-cell `sel: string | null` with `selection: { anchor: string; focus: string }`; derive the rect for rendering and keyboard. Add Shift+Arrow (extend), click-drag range, Ctrl+Arrow data-region jump (walk until empty/non-empty boundary using `art.elements`), Ctrl+A (select used range from `grid.rows`/`grid.columns`), Shift+Tab/Shift+Enter wrap inside an active range. Fill-handle drag is a follow-on (P2, defer).
- **Reuse:** the existing `move()` clamp (L644-649) and `data-cell-key` scroll-into-view (L626-629). Multi-cell Delete routes each cell through the SAME `doCommit` funnel (L633) — no new write path.
- **DoD:** `SPREADSHEET_PARITY_CHECKLIST.md` P1 items 19-21, 28-31 flip to ✅; e2e: drag-select B2:D4 tints 9 cells, Ctrl+ArrowDown jumps to the last contiguous data row, Delete over a range commits N CAS writes and N trace rows; locked cells inside a range are skipped (not silently committed). Selection never appears in `art.elements` or any Convex write (OPERATION stays ephemeral).

### Step 2 — Web Worker calc engine for live recompute (L) — runtime-independent

- **Files:** new `src/engine/calc.worker.ts`; wire into `ExcelGridSheet` display path (replaces "cached file value only" at L757-759); reuse `expandFormulaReferences` for the dirty set.
- **What:** off-main-thread formula evaluation so typing stays instant. On commit, post `{ changedCells, snapshot }` to the worker; worker walks the dependency graph (dirty-range only, NOT full sheet), evaluates, posts back `{ cellId → value }`; grid renders the recomputed display while CAS truth stays the raw cell payload. The calc result is OPERATION-tier (display only) — it is NEVER written back through `applyCellEdit`.
- **License gate (blocking, see open questions):** decide HyperFormula (GPL/commercial dual-license — legal check required) vs formula.js (MIT). Default to formula.js unless the finance models need INDIRECT/OFFSET/array semantics formula.js can't do.
- **DoD:** editing `F7=E7*(1+...)` updates `F7`'s displayed value and every downstream dependent within one frame budget; main thread never blocks >16ms on a 600-row sheet; worker has a hard eval timeout (TIMEOUT, see risks); cached file values still render when no formula is present (no regression to `UI_EXCEL_PAPER.md` L55-57 behavior for non-formula cells).

### Step 3 — Headless numeric golden tie-out (L) — upgrades the eval, runtime-independent

- **Files:** new `evals/financeModelHeadless.ts` alongside `evals/financeModelGold.ts`; reuses the Step-2 calc engine (Node entry, not the Worker).
- **What:** upgrade the contract from "agent wrote the right formula EXPRESSION" to (additionally) "the workbook computes the right number." Load the gold xlsx (`PRIVATE_FINANCE_MODEL_GOLD_ENV`), apply the agent's written formulas, recompute, compare F7/G7/F8/F12… against the Answer Key sheet within tolerance. Keep `formulaMentionsAllRefs`/`formulaMentionsAllTokens` (L215-222) as the structural gate; ADD a numeric gate.
- **DoD:** a deterministic per-formula report `{ cell, formulaMatch: bool, numericMatch: bool, expected, actual, withinTolerance }`; an agent that hardcodes the answer number passes the value check but is caught by the formula-ref check, and an agent that writes a structurally-correct-but-wrong-math formula is caught by the numeric check. No HONEST_SCORES floor: a missing/unevaluable formula scores 0, never a partial-credit default.

### Step 4 — Univer de-risking POC behind the adapter (XL) — spike, NOT migration

- **Files:** new `src/ui/workbook/UniverAdapter.tsx` implementing the EXISTING `WorkbookRuntimeAdapter` type (`MVP_WORKBOOK_STACK.md` L47-54); a throwaway `NodeRoomConvexSyncPlugin` that wraps `commit → applyCellEdit` and replays Convex reactive patches as Univer mutations. Univer is NOT added to `package.json` for production until the POC passes — pin an exact version in a spike branch only.
- **What it must answer (the make-or-break):** can Univer's mutation model map onto element-level CAS (per-element version + conflict-as-data) WITHOUT cursor/selection jumps when a remote reactive patch replays? Sheet-kind ONLY. The adapter's `commit` MUST route through `applyCellEdit` — Univer is a VIEW, never truth.
- **Hard pass gates (all required):** (a) remote patch replay does not move the local user's selection/edit caret; (b) a CAS conflict surfaces as data through the SAME `onError` path, not a Univer-internal toast; (c) the note/wall element contract is provably unaffected (run the existing note/wall e2e green); (d) bundle delta is measured and recorded. Spike React-19 peer compatibility FIRST (per the Glide adoption protocol in `UI_EXCEL_PAPER.md` L70-72). If any gate fails, close the branch and the verdict stands as "extend."
- **DoD:** a written POC report with the 4 gate results + measured bundle delta; the spike branch is deleted; `MVP_WORKBOOK_STACK.md` gets one line recording the outcome. No production dependency lands from this step.

### Step 5 — Per-cell human presence (M) — runtime-independent, initial slice shipped

- **Files:** shipped Convex `presenceClaims` table and `convex/presence.ts`; render `HumanActiveCell` border/name flag in `ExcelGridSheet`.
- **What:** live, non-lock selection broadcast (the "someone is looking at B7" border). Spreadsheet human focus/edit presence is TTL-bounded, advisory, never CAS, and never in `art.elements`.
- **DoD:** initial DoD is covered by `e2e/realtime-presence.spec.ts`; server-side agent intent heartbeat is covered by `tests/presenceClaims.test.ts`. Remaining DoD is disconnect expiry coverage, live browser proof for agent intent conflict/proposal behavior, and extending the same pattern to notebook blocks and deck components.

## Interfaces / types

The render-extension surface is the thing that must survive a future runtime swap. Formalize the inline CSS-class visuals (`ExcelGridSheet` L765) into a registry behind the EXISTING `WorkbookRuntimeAdapter.showRemoteState` (`MVP_WORKBOOK_STACK.md` L52), so the SAME overlay code works whether the renderer is the DOM table or a future Glide/Univer canvas.

```ts
// src/ui/workbook/renderExtensions.ts — overlay layer, runtime-agnostic.
// An extension is a pure function from (cell, room state) → optional visual decoration.
// It NEVER mutates room state; it reads CAS/lock/proposal/presence and returns paint instructions.
export type CellDecoration = {
  className?: string;                 // "evidence" | "formula" | "locked" | "human-active"
  outline?: { color: string; label?: string };  // lock outline / HumanActiveCell border
  badge?: { kind: "evidence" | "proposal" | "formula-protected"; text: string };
};

export type RenderExtension = {
  id: "lock-outline" | "evidence-badge" | "proposal-badge" | "formula-protected" | "human-active";
  decorate(input: {
    elementId: string;
    element: Element | undefined;          // src/engine/types.ts
    payload: CellPayload | null;
    lock: Lock | null;                     // lockedByOther result
    proposal: Proposal | null;
    presence: CellPresence[];              // Step 5
    me: Actor;
  }): CellDecoration | null;
};

// Per-cell human presence (Step 5) — ephemeral, TTL-bounded, NEVER CAS.
export type CellPresence = {
  roomId: string;
  artifactId: string;
  elementId: string;     // single anchor cell (selection focus)
  actor: Actor;          // kind:"user"
  color: string;
  expiresAt: number;     // TTL bound; row is pruned past this
};

// Range selection (Step 1) — OPERATION-tier UI state, replaces `sel: string | null`.
export type GridSelection = {
  anchor: string;        // "B2"
  focus: string;         // "D4"  (anchor === focus for a single cell)
};

// Calc worker contract (Step 2) — display-only, never written back through CAS.
export type CalcRequest = {
  reqId: string;
  changed: Array<{ cellId: string; formula?: string; value: unknown }>;
  snapshot: Record<string, { value: unknown; formula?: string }>;  // bounded to used range
};
export type CalcResponse =
  | { reqId: string; ok: true; computed: Record<string, unknown> }   // cellId → display value
  | { reqId: string; ok: false; reason: "timeout" | "cycle" | "error"; partial?: Record<string, unknown> };

// Univer POC adapter (Step 4) — implements the EXISTING WorkbookRuntimeAdapter (MVP_WORKBOOK_STACK.md L47-54).
// commit() MUST route through applyCellEdit; Univer is a view, never truth.
```

## Risks & mitigations (8-point agentic-reliability checklist)

- **BOUND** — `presenceClaims` (Step 5) MUST keep per-room caps + TTL eviction so an agent loop / flapping selection cannot flood the channel. Range selection (Step 1): cap selected-cell count for batch Delete (reuse the `MAX_FORMULA_DEPENDENCIES`-style cap) so Ctrl+A on a 20k-cell sheet can't fan out into 20k CAS writes in one keystroke. Calc snapshot (Step 2) is bounded to the used range, not the full theoretical grid.
- **HONEST_STATUS** — calc worker failure (cycle/timeout) returns `{ ok: false, reason }` and the grid shows the cached file value, NOT a fabricated computed number. A failed Univer POC gate (Step 4) closes the branch — no "it mostly works" merge.
- **HONEST_SCORES** — headless golden (Step 3): a formula that fails to evaluate scores 0, never a partial-credit floor; numeric tie-out uses an explicit tolerance, not a generous default that masks wrong math. Keep the structural ref/token gate so a hardcoded answer number can't buy a passing score.
- **TIMEOUT** — calc worker gets a hard per-recompute budget (AbortController-equivalent: terminate + return `reason:"timeout"`); the dependency walk has a depth/iteration cap so a malicious or cyclic formula can't spin the worker forever.
- **SSRF** — none of these steps fetch external URLs. If the headless golden ever loads a workbook from a path/URL, validate it's the configured `PRIVATE_FINANCE_MODEL_GOLD_ENV` local file only; reject remote URLs.
- **BOUND_READ** — headless golden caps the loaded workbook size (reuse upload parser caps); the calc snapshot posted to the Worker is size-capped to the rendered/used range, not an unbounded blob.
- **ERROR_BOUNDARY** — the Worker `onmessage`/`onerror` and the Convex presence subscription (Step 5) both have explicit error handling; a dropped Worker message degrades to cached-value display, a dropped presence patch degrades to no-border — neither throws into the React tree.
- **DETERMINISTIC** — the headless golden report (Step 3) sorts cells by address before emitting so the eval output is byte-stable across runs (no map-iteration-order flakiness); the calc dependency walk is topologically ordered, not insertion-ordered.

## Definition of done (scenario-based)

1. **Analyst drag-selects and bulk-clears (Step 1):** a real analyst click-drags B2:D4, sees 9 cells tinted, presses Delete; exactly 9 CAS writes land, 9 trace rows appear, and a cell inside the range that another member holds a lock on is SKIPPED (surfaces the existing `locked` feedback, not a silent overwrite). Selection state appears in NO Convex write.
2. **Live recompute under typing burst (Step 2):** an analyst types a forecast formula into F7 then immediately tabs through F8…F20 entering more; the displayed values of all downstream dependents update within frame budget, the main thread never janks >16ms, and a deliberately cyclic formula returns `reason:"cycle"` and falls back to cached display instead of hanging.
3. **Adversarial agent vs the numeric golden (Step 3):** an agent that hardcodes the Answer-Key number fails the formula-ref gate; an agent that writes `=E7*1.5` (right shape, wrong growth) passes the ref gate but fails the numeric gate; the report is byte-identical across two runs.
4. **Univer POC gate (Step 4):** in a two-browser session on a sheet-kind artifact, User A is editing B7 while User B commits a remote edit to D2 — A's caret does NOT jump; a CAS conflict surfaces through the shared `onError`; the note and wall e2e specs stay green proving the element contract is unforked; bundle delta is recorded. If any gate fails, the spike branch is closed and `npm run build` is unchanged (no Univer in `package.json`).
5. **Per-cell presence (Step 5):** two browsers show active-cell borders (color + name), visually distinct from a lock outline; on disconnect the border disappears within the TTL window; the artifact ledger receives zero presence writes.
6. **Regression floor:** `e2e/excel-grid.spec.ts` (styled-workbook upload, 33.7% render, merged header, formula bar, inline-edit v2) stays green through all steps; `tests/numberFormat.test.ts` and `tests/spreadsheetParser.test.ts` unchanged.
