# Spreadsheet interaction parity — checklist & status

Scope: this checklist covers spreadsheet interaction muscle memory inside
NodeRoom's grid. It is not a literal Google Sheets feature-parity claim, and it
is not live collaboration proof by itself. Live coediting claims must cite the
Convex browser gates separately.

The rigorous "feels like Excel / Google Sheets" spec, researched 2026-06-11 from Microsoft's Excel
keyboard/edit docs, Google's Sheets shortcut reference, Handsontable's per-shortcut Excel-vs-Sheets
parity tables, fortune-sheet's implementation constants (the Sheets-look open-source grid), Glide
Data Grid's interaction docs, and Univer's collaboration docs. Each item: expected behavior →
status in `ExcelGridSheet` (`src/ui/panels/Artifact.tsx`).

Status legend: ✅ shipped + e2e-asserted (`e2e/excel-grid.spec.ts` "spreadsheet keyboard model") ·
✓ shipped · ◻ residual (honest gap, not claimed).

## The state machine (the one design decision everything hangs on)

`nav → enter-mode edit → edit-mode edit`. An editor opened by TYPING is in **enter mode**: arrow
keys COMMIT the draft and move the selection. An editor opened by **F2/double-click/Enter** is in
**edit mode**: arrows move the caret. Microsoft documents the two modes explicitly; Handsontable's
parity table calls the distinction the most-missed detail. Implemented via `editing.seed`
(`seed !== null` = enter mode).

## MVP view modes (local presentation, shared truth)

`ExcelGridSheet` now exposes a local segmented workbook mode bar: `Excel`, `Sheets`, and `Evidence`.
This is intentionally a browser preference, persisted in localStorage, not room state.
Changing the style never changes the artifact, selected cell, lock/CAS write path, or trace.

- `Excel`: uploaded-workbook fidelity first (file formats, merged cells, formula bar).
- `Sheets`: collaborative muscle memory first (Google-Sheets-like spacing and selection chrome).
- `Evidence`: agent-review first (provenance/formula emphasis for demos and audits).

The walkthrough target is `workbook-style-toggle`: upload a generated workbook, switch to
`Sheets`, then `Evidence`, and feed the rendered clip to the Gemini media judge.

## P0 — must-have

| # | Behavior | Status |
|---|---|---|
| 1 | Arrows move selection one cell (not editing) | ✅ |
| 2 | Edge behavior: clamp at A1/bounds, never wrap | ✅ |
| 3 | Type-to-replace: printable key replaces content, opens enter-mode editor | ✅ |
| 4 | Enter while editing: commit + move DOWN | ✅ |
| 5 | Shift+Enter while editing: commit + move UP | ✓ |
| 6 | Enter not editing: open editor (Sheets model — documented fork vs Excel's move-down) | ✅ |
| 7 | Tab/Shift+Tab while editing: commit + move right/left | ✅ |
| 8 | Tab/Shift+Tab not editing: move right/left | ✓ |
| 9 | Escape: cancel edit, restore committed value, stay put | ✅ |
| 10 | F2: edit mode, caret at end | ✓ |
| 11 | Delete/Backspace (not editing): clear cell, NO edit mode | ✅ |
| 12 | Outside click while editing: commits the draft (never silently discards) | ✓ (blur path) |
| 13 | Single click selects, never edits | ✅ |
| 14 | Double-click edits (caret-at-end v1; caret-at-click-position is the full target) | ✓ |
| 15 | Active-cell ring: 2px accent on top of gridlines (Excel green #107C41 on this paper) | ✓ |
| 16 | Fill-handle nub: 6×6px accent square, 1px white border, bottom-right, crosshair cursor | ✓ (visual; drag-to-fill ◻) |
| 17 | Editing overlay: white bg, accent ring, shadow, never clipped | ✓ (overflow-visible; width-growth beyond cell ◻) |
| 18 | Gridlines 1px light gray behind chrome | ✓ |
| 19 | Range tint with untinted anchor | ◻ (single-cell selection only today) |

## P1 — strongly expected (residuals, honest)

| # | Behavior | Status |
|---|---|---|
| 20 | Ctrl+Arrow data-region jumps | ◻ |
| 21 | Shift+Arrow / Ctrl+Shift+Arrow selection extension | ◻ |
| 22 | Enter-mode vs edit-mode arrow semantics | ✅ shipped |
| 23 | Home/Ctrl+Home/Ctrl+End navigation | ◻ |
| 24 | Home/End in editor move the caret | ✓ (native input) |
| 25 | Alt+Enter in-cell line break | ◻ (single-line input) |
| 26 | Delete/Backspace in editor = text editing | ✓ (native input) |
| 27 | Ctrl+A select-all | ◻ |
| 28–31 | Click-drag ranges · Shift+click extend · header click selects row/col · column resize | ◻ |
| 32 | Active row/col header tint | ✓ (`th.hl` / rowhead `hl`) |
| 33 | Header chrome (near-white bg, gray labels) | ✓ |
| 34 | Frozen headers under scroll | ✓ (sticky) |
| 35 | Copy marching-ants | ◻ |
| 36 | Remote edit on a SELECTED cell updates in place, selection untouched | ✓ (reactive store) |
| 37 | Remote edit on the cell you're EDITING: local draft wins until commit | ✓ (uncontrolled input; commit goes through CAS — a stale baseline surfaces conflict-as-data, stricter than Sheets' LWW) |
| 38 | Presence: other editors' cells outlined in THEIR color + name flag | ✓ for LOCKS (holder flag) · ✓ for bounded per-cell spreadsheet presence via `presenceClaims` and `e2e/realtime-presence.spec.ts`; server-side agent intent claims exist, while browser conflict/proposal proof for those claims is still next |
| 39 | Honest commit status (failed write reverts visibly) | ✓ (conflict toast + revert — the repo's core contract) |

## P2 — power-user (all ◻, ranked for later)

Ctrl+click multi-range · Ctrl+Shift+Home/End · Shift+Space/Ctrl+Space row/col select ·
PageUp/PageDown · fill-handle drag (Ctrl+D/Ctrl+R) · selection-border drag-move · Name-box
type-to-navigate · formula-bar editing · marching-ants paste flow.

## Collaboration note (where this grid is deliberately STRICTER than Sheets)

Sheets resolves same-cell races with last-writer-wins. NodeRoom's contract
(`convex/artifacts.ts`: app-level CAS) surfaces a stale-baseline write as **conflict-as-data**
instead of silently overwriting — the agent or human re-reads and rebases. Parity in feel,
stronger in truth. Full design: `docs/architecture/AGENT_SCRATCHPAD_CELL_COLLAB.md`.
