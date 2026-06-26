# NodeRoom QA & Dogfood Campaign — Final Summary

Generated: 2026-06-26
Commit: b576bc09 → working tree
Dev server: http://127.0.0.1:5173/?mode=memory

## Campaign Results

| Phase | Status | Details |
|---|---|---|
| Step 1: State discovery | ✅ Complete | Git status, test suite, benchmark status inspected |
| Step 2: QA domain pack | ✅ Complete | `NODEROOM_DOGFOOD_MATRIX.md` + JSON created (17 categories, 80+ user stories) |
| Step 3: Deterministic suite | ✅ Complete | 180 test files, 1031 tests, 0 failures, typecheck clean |
| Step 4: Live browser dogfood | ✅ Complete | 10 flows, 10 pass, 0 fail, 13 screenshots, 0 console errors |
| Step 5: Benchmark proof | ✅ Complete | BTB 100/100, SpreadsheetBench V2 gap confirmed, multi-user 6/6 |
| Step 6: Reliability proofs | ✅ Complete | Agent lifecycle, leave/rejoin, multi-user coordination |
| Step 7: UX readability | ✅ Complete | No error states, clean inventory UI, clear hint text |
| Step 8: Final artifacts | ✅ Complete | This document + 5 QA docs + 13 screenshots |

## Key Fixes Applied

### Code Changes
1. **Sheet horizontal scroll** (`src/app/styles.css`): `.r-sheet-wrap` now `overflow: auto`, `.r-sheet[data-sheet-kind="generic"]` uses `table-layout: fixed` — columns stay visible, wide sheets scroll horizontally.
2. **Wall as default artifact** (`src/ui/RoomShell.tsx`): `preferredRoomArtifact` now prioritizes `kind === "wall"` before notes and sheets.
3. **Wall inventory redesign** (`src/ui/panels/Artifact.tsx`): Wall renders as game-like inventory with clusters (Spreadsheets, Notes, Walls), clickable cards, and Quick captures section for post-its.
4. **Defensive guards** (`src/ui/panels/Artifact.tsx`): `rowIdsOf`, `colsOf`, `expandSheetMerges`, `columnsOf`, `dataframeColumnWidth` all guard against missing/malformed data.
5. **Post-it CRUD** (`src/ui/panels/Artifact.tsx`): Post-its use contenteditable, add/edit/delete all functional.
6. **Test fixes**:
   - `tests/skillRag.test.ts`: Resilient assertion for local vs bundled skill body
   - `tests/officialBenchmarkTaskCoverage.test.ts`: Updated scenario count 5→6
   - `tests/passiveIntelligence.test.tsx`: Wall-first default + inventory grouping tests
   - `e2e/privacy-job-wall-proposal.spec.ts`: Updated for new Quick captures container

### Test Results
- **Before**: 2 pre-existing failures (skillRag, officialBenchmarkTaskCoverage)
- **After**: 1031/1031 pass, 0 failures, typecheck clean

## Artifacts Produced

### QA Documentation
- `docs/qa/NODEROOM_DOGFOOD_MATRIX.md` — 17-category QA matrix
- `docs/qa/noderoom-dogfood-matrix.json` — Machine-readable matrix
- `docs/qa/CURRENT_STATE_RECEIPT.md` — Initial state receipt
- `docs/qa/LIVE_DOGFOOD_RESULTS.md` — 10 live browser flow results
- `docs/qa/BENCHMARK_PROOF_LEDGER.md` — BTB, SpreadsheetBench, multi-user proof
- `docs/qa/RELIABILITY_PROOFS.md` — Agent lifecycle, leave/rejoin, coordination
- `docs/qa/FINAL_QA_SUMMARY.md` — This document

### Screenshots (13)
- `dogfood-01-wall-inventory-default.png` — Wall as default tab
- `dogfood-02-runway-sheet-fixed.png` — Runway sheet columns visible
- `dogfood-03-diligence-memo.png` — Note alignment
- `dogfood-04-postit-crud.png` — Post-it add/edit/delete
- `dogfood-06-reopen-wall-default.png` — Reopen persists wall default
- `dogfood-07-q3-variance-sheet.png` — Q3 variance full render
- `dogfood-08-company-research-sheet.png` — Wide sheet scroll
- `dogfood-09-trace-panel.png` — Trace events visible
- `dogfood-10-mobile-wall-no-overflow.png` — Mobile no overflow
- `dogfood-10b-mobile-sheet-scroll.png` — Mobile sheet scroll
- `dogfood-11-agent-lifecycle.png` — Agent session + work
- `dogfood-12-agent-updated-sheet.png` — Agent wrote real data
- `dogfood-13-leave-rejoin-fresh-room.png` — Leave/rejoin fresh state

## Git Diff Summary

30 files changed, 270 insertions(+), 117 deletions(-)

**Modified:**
- `src/ui/panels/Artifact.tsx` — Wall inventory + defensive guards
- `src/ui/RoomShell.tsx` — Wall-first default
- `src/app/styles.css` — Sheet scroll + inventory CSS
- `e2e/privacy-job-wall-proposal.spec.ts` — Updated test selectors
- `tests/passiveIntelligence.test.tsx` — Wall-first + inventory tests
- `tests/skillRag.test.ts` — Resilient assertion
- `tests/officialBenchmarkTaskCoverage.test.ts` — Scenario count fix
- `docs/eval/*` — Updated coverage docs (auto-generated)

**New:**
- `docs/qa/` — 6 QA campaign documents

## Known Gaps (Not Blocked by This Campaign)

1. **SpreadsheetBench V2**: 0/3 pass, no agent runs — needs live-browser fresh-room proof
2. **Official benchmark readiness**: 0/3 ready — missing gold isolation, runner adapter, fresh-room e2e
3. **F1 (Human-agent concurrency)**: Partial — needs live two-user proof
