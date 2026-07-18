# Room Parity Gap — current room vs the clean-room reference

Captured: 2026-07-17. Governed by `docs/design/UI_CONTRACT.md` (reference artifacts are
design evidence, adopted property-by-property as KEEP / REFINE / REJECT — never lifted
wholesale).

**Reference:** clean-room mockup supplied in-chat 2026-07-17 (Claude Design artifact,
"NodeRoom · Q3 diligence": binder tree with counts, decluttered tab strip, per-sheet
header with `DATAFRAME v42` + `Room trace · 42` + `Entity graph`, populated variance
chips, receipt-card chat with version chips and accepted-patch event lines, minimal
footer).
**Current:** `.qa/evidence/20260717-postmerge/local-room-desktop.png` (built app,
memory demo room, first-visit state).

## Why the app doesn't open "immediately" on the clean room

1. **First-run chrome is once-ever, by contract.** The walkthrough dock + expanded
   panels auto-open only when `localStorage noderoom:tour:v1 !== "done"`
   (RoomShell.tsx:262) and mark themselves done immediately. `e2e/tour.spec.ts` and
   `e2e/prod-remaining-fixes.spec.ts` pin this: dock visible on first demo entry,
   dismissible, gone after. Fresh-profile screenshots ALWAYS show the noisy state —
   steady-state users do not.
2. **The remaining distance is real parity debt**, itemized below.

## Slices (ordered; each = one PR with pixel proof)

| # | Property | Verdict | Notes |
|---|---|---|---|
| 1 | Per-sheet header: title + filter + `DATAFRAME vNN` chip + `Room trace · N` + `Entity graph` on the artifact itself | REFINE | Version/kicker data already computed (Artifact.tsx `sheetKicker`, `dataframeMeta`); today it renders in the FOOTER as an all-caps kicker. Promote to header, quiet mono chip. |
| 2 | Footer consolidation: `N rows · double-click a cell to edit` + `N of N cols` only | REFINE | Undo stays (reference omits it but recoverability beats parity — B7). Kicker moves up (slice 1). |
| 3 | Demo seed shows the POPULATED moment: variance chips (+24% …) + notes filled, like the landing loop's end state | REFINE | The reference sells the ledger full. Check e2e/state-capture deps on empty variance cells first. |
| 4 | Variance/computed cells as semantic chips (green = reconciled+sourced success state) | REFINE | Matches landing loop's committed-value styling; green stays success-only. |
| 5 | Binder: hierarchical categories with counts (Sheets > Financials 2 …, Docs, Notebooks, Uploads) + inline meta on pinned rows (`Sheet · v42 · agent`) | REFINE | Current: flat Pinned/Recent/Room-sheets. Needs artifact taxonomy from store; medium. |
| 6 | Tab strip: fold overflow into `+3 ∨` dropdown; move Export XLSX / Shared to a quieter right cluster | REFINE | Current `+3` chip exists but row still crowds. |
| 7 | Chat: accepted-patch EVENT LINES (`✓ Homen accepted the patch v42 → v43 · 2 cells · sourced`) + pinned-cell chips in messages | REFINE | Receipt cards + version chips already exist; event lines and cell-pin chips are missing. |
| 8 | Drop walkthrough dock entirely | REJECT | Once-ever + dismissible + tested contract; it replaced the auto-tour deliberately. |
| 9 | Drop Undo / status ribbon / credits from footer | REJECT | Honesty & recoverability surfaces (B5/B7); reference is a mockup, prod carries obligations. |

## Open investigations

- Prod landing stats render `— rooms live · — cells committed today` (live screenshot
  2026-07-17). Memory mode shows demo numbers with a DEMO tag. Verify
  `convex/metrics.landingMetrics` on prod: honest-empty or broken query? If broken, P1.
- "Try sample" on prod is a small text link vs memory-mode's primary button — decide
  intended hierarchy for signed-out prod visitors (B11).
